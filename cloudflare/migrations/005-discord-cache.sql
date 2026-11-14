-- names and pictures of Discord users who never logged in (fetched on demand, kept for a few days)
CREATE TABLE IF NOT EXISTS discord_cache (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, at INTEGER NOT NULL);
