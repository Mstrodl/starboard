const Bolt = require("@slack/bolt");
const secrets = require("./secrets.json");
const db = require("better-sqlite3")("./starboard.db");

// Hardcoded IDs because fuck you
const STARBOARD_CHANNEL = "C022LQWRE0J";
const MINIMUM_STARS = 2;
// const MINIMUM_STARS = 1;

const app = new Bolt.App({
  token: secrets.slackToken,
  appToken: secrets.slackAppToken,
  socketMode: true,
});

app.start().then(() => {
  console.log("Ready!");
});

async function resolveMessage(ctx) {
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
    client: ctx.client,
  });
});

async function updateStarboard({messageId, channelId, client}) {
  const postId = db
    .prepare("SELECT postId FROM posts WHERE messageId == ?")
    .pluck()
    .get(messageId);
  const count = db
    .prepare("SELECT COUNT(*) FROM stars WHERE messageId == ?")
    .pluck()
    .get(messageId);

  console.log(count, postId);

  if (count >= MINIMUM_STARS) {
    const content = `⭐ *${count}* <#${channelId}>

https://cshrit.slack.com/archives/${channelId}/p${messageId.replace(".", "")}`;
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
        "INSERT INTO posts (messageId, channelId, postId) VALUES (?, ?, ?)"
      ).run(messageId, channelId, response.message.ts);
    }
  } else if (postId) {
    await client.chat.delete({
      channel: STARBOARD_CHANNEL,
      ts: postId,
    });
    db.prepare("DELETE FROM posts WHERE messageId == ?").run(messageId);
  }
}
