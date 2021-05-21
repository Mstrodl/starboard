CREATE TABLE stars(
  channelId TEXT NOT NULL,
  authorId TEXT NOT NULL,
  messageId TEXT NOT NULL,
  UNIQUE(messageId, authorId, channelId) 
);

CREATE TABLE posts(
  messageId TEXT NOT NULL PRIMARY KEY,
  channelId TEXT NOT NULL,
  postId TEXT NOT NULL UNIQUE,
  authorId TEXT,
  UNIQUE(messageId, channelId)
);
