-- Each person's highest rank, read from their Discord roles at login and on every background check
ALTER TABLE users ADD COLUMN rank TEXT;
