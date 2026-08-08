CREATE TABLE IF NOT EXISTS crit_canvases (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
