-- Site visits: one row per person per day (Israel date), counting how many times they opened the site. Shown on the owner's permissions page.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, last INTEGER NOT NULL,
  PRIMARY KEY (day, id)
);
