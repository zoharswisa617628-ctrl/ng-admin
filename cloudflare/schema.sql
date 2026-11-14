-- New Gamers Admin database (Cloudflare D1)
CREATE TABLE IF NOT EXISTS docs (
  path TEXT PRIMARY KEY,      -- team/<key> (shared) or data/users/<discordId>/state (private)
  v    TEXT NOT NULL,         -- the document as JSON
  by   TEXT,                  -- Discord ID of who wrote it last
  at   INTEGER NOT NULL       -- when (ms)
);
CREATE INDEX IF NOT EXISTS docs_at ON docs (at);

CREATE TABLE IF NOT EXISTS doc_history (  -- previous versions of shared docs (kept 14 days) — restore from the permissions page
  path TEXT NOT NULL, v TEXT NOT NULL, by TEXT, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS doc_history_path ON doc_history (path, at);

CREATE TABLE IF NOT EXISTS users (      -- everyone who ever logged in (for names and the permissions page)
  id TEXT PRIMARY KEY, name TEXT, avatar TEXT, last TEXT, ok INTEGER,
  sv INTEGER DEFAULT 0,                 -- session version: raising it logs that person out everywhere
  tok TEXT,                             -- their Discord tokens, encrypted (to re-check the role in the background)
  chk INTEGER DEFAULT 0,                -- when the role was last checked (ms)
  rank TEXT                             -- highest rank from their Discord roles (see RANK_ROLES)
);

CREATE TABLE IF NOT EXISTS access (     -- exceptions: allow = in without the role, deny = out despite it
  id TEXT PRIMARY KEY, mode TEXT NOT NULL, note TEXT, by TEXT, at TEXT
);

CREATE TABLE IF NOT EXISTS discord_cache (  -- names and pictures of Discord users who never logged in (fetched on demand)
  id TEXT PRIMARY KEY, name TEXT, avatar TEXT, at INTEGER NOT NULL
);
-- Site visits: one row per person per day (Israel date), counting how many times they opened the site. Shown on the owner's permissions page.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, last INTEGER NOT NULL,
  PRIMARY KEY (day, id)
);
