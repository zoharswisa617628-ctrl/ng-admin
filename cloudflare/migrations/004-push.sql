-- Phone notifications
CREATE TABLE IF NOT EXISTS push_subs (    -- one row per device that turned notifications on
  endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, keys TEXT NOT NULL, ua TEXT, at INTEGER
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user);
CREATE TABLE IF NOT EXISTS notif_sent (   -- which alerts were already sent (so each goes out once)
  key TEXT PRIMARY KEY, at INTEGER
);
