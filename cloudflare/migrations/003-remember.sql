-- Stay logged in: keep Discord tokens (encrypted) and when the role was last checked
ALTER TABLE users ADD COLUMN tok TEXT;
ALTER TABLE users ADD COLUMN chk INTEGER DEFAULT 0;
