# Starboard

> Give funny messages ⭐s and they'll show up here. Funny internet points but for Slack.

Starred messages get put into a hall of fame (or shame, if you prefer) along with the number of stars received.

## Setup

1. Copy `secrets-example.json` to `secrets.json` and add your Slack tokens and the ID of the **#starboard** channel
2. Initialize the database: `cat schema.sql | sqlite3 starboard.db`
3. Install deps: `pnpm i`
4. Run the app! `node index.js`

## Why?

- Slack pins are limited to 100 messages
- Voting on funny messages is cool
- Funny internet points
