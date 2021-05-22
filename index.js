const Bolt = require("@slack/bolt");
const secrets = require("./secrets.json");
const db = require("better-sqlite3")(__dirname + "/starboard.db");

const STARBOARD_CHANNEL = secrets.starboardChannel;

const app = new Bolt.App({
  token: secrets.slackToken,
  appToken: secrets.slackAppToken,
  socketMode: true,
});

app.start().then(() => {
  console.log("Ready!");
});

async function resolveMessage(ctx) {
  if (ctx.payload.reaction != "star") return;

  let messageId = ctx.payload.item.ts;
  let channel = ctx.payload.item.channel;

  if (ctx.payload.item.channel == STARBOARD_CHANNEL) {
    const response = db
      .prepare("SELECT messageId, channelId FROM posts WHERE postId == ?")
      .get(ctx.payload.item.ts);
    if (response) {
      messageId = response.messageId;
      channel = response.channelId;
    }
  }
  const {messages} = await ctx.client.conversations.history({
    channel,
    latest: messageId,
    inclusive: true,
    limit: 1,
  });

  // No self-starring
  if (messages[0].user == ctx.payload.user) return;

  return {
    channel,
    messageId,
    authorId: messages[0].user,
    message: messages[0],
  };
}

app.event("reaction_added", async (ctx) => {
  const resolution = await resolveMessage(ctx);
  if (!resolution) return;

  try {
    db.prepare(
      "INSERT INTO stars (messageId, authorId, channelId) VALUES (?, ?, ?)"
    ).run(resolution.messageId, ctx.payload.user, resolution.channel);
  } catch (err) {
    if (err.code == "SQLITE_CONSTRAINT_UNIQUE") {
      return;
    } else {
      throw err;
    }
  }

  await updateStarboard({
    messageId: resolution.messageId,
    channelId: resolution.channel,
    authorId: resolution.authorId,
    message: resolution.message,
    client: ctx.client,
  });
});

app.event("reaction_removed", async (ctx) => {
  const resolution = await resolveMessage(ctx);
  if (!resolution) return;

  db.prepare(
    "DELETE FROM stars WHERE messageId = ? AND authorId = ? AND channelId = ?"
  ).run(resolution.messageId, ctx.payload.user, resolution.channel);

  await updateStarboard({
    messageId: resolution.messageId,
    channelId: resolution.channel,
    authorId: resolution.authorId,
    message: resolution.message,
    client: ctx.client,
  });
});

app.shortcut("reload_stars", async (ctx) => {
  console.log("Reload stars called");

  await ctx.ack();

  if (ctx.payload.channel.id == STARBOARD_CHANNEL) {
    console.log("Ignoring request to reload stars on starboard channel");
    return;
  }

  // Just in case I get resolveMessage() working for this...
  const message = ctx.payload.message;
  const resolution = {
    messageId: message.ts,
    message,
    authorId: message.user,
    channel: ctx.payload.channel.id,
  };

  const reactions = await ctx.client.reactions.get({
    full: true,
    channel: resolution.channel,
    timestamp: resolution.messageId,
  });

  const star = reactions.message.reactions?.find(
    (reaction) => reaction.name == "star"
  );

  const users = new Set(star?.users);

  const postId = db
    .prepare("SELECT postId FROM posts WHERE messageId == ?")
    .pluck()
    .get(resolution.messageId);

  if (postId) {
    const channelReactions = await ctx.client.reactions.get({
      full: true,
      channel: STARBOARD_CHANNEL,
      timestamp: postId,
    });
    const star = channelReactions.message.reactions?.find(
      (reaction) => reaction.name == "star"
    );
    if (star) {
      for (const user of star.users) {
        users.add(user);
      }
    }
  }

  // Get rid of old stars:
  db.prepare("DELETE FROM stars WHERE messageId == ? AND channelId == ?").run(
    resolution.messageId,
    resolution.channel
  );

  for (const user of users) {
    // No self-starring
    if (user == message.user) continue;
    try {
      db.prepare(
        "INSERT INTO stars (messageId, authorId, channelId) VALUES (?, ?, ?)"
      ).run(resolution.messageId, user, resolution.channel);
    } catch (err) {
      if (err.code != "SQLITE_CONSTRAINT_UNIQUE") {
        console.log(err.code);
        throw err;
      }
    }
  }

  await updateStarboard({
    messageId: resolution.messageId,
    channelId: resolution.channel,
    authorId: resolution.authorId,
    message: resolution.message,
    client: ctx.client,
  });
});

async function updateStarboard({
  messageId,
  authorId,
  channelId,
  message,
  client,
}) {
  const postId = db
    .prepare("SELECT postId FROM posts WHERE messageId == ?")
    .pluck()
    .get(messageId);
  const count = db
    .prepare("SELECT COUNT(*) FROM stars WHERE messageId == ?")
    .pluck()
    .get(messageId);

  console.log(count, postId);

  const minimumStarCount = message.thread_ts ? 1 : 3;

  if (count >= minimumStarCount) {
    const {permalink} = await client.chat.getPermalink({
      channel: channelId,
      message_ts: messageId,
    });
    const content = `⭐ *${count}* <#${channelId}>

${permalink}`;
    if (postId) {
      await client.chat.update({
        channel: STARBOARD_CHANNEL,
        ts: postId,
        text: content,
      });
    } else {
      const response = await client.chat.postMessage({
        channel: STARBOARD_CHANNEL,
        text: content,
      });
      db.prepare(
        "INSERT INTO posts (messageId, channelId, postId, authorId) VALUES (?, ?, ?, ?)"
      ).run(messageId, channelId, response.message.ts, authorId);
    }
  } else if (postId) {
    await client.chat.delete({
      channel: STARBOARD_CHANNEL,
      ts: postId,
    });
    db.prepare("DELETE FROM posts WHERE messageId == ?").run(messageId);
  }
}
