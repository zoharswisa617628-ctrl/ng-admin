-- Upgrade an existing database to the hardened version
ALTER TABLE users ADD COLUMN sv INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS doc_history (path TEXT NOT NULL, v TEXT NOT NULL, by TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS doc_history_path ON doc_history (path, at);
