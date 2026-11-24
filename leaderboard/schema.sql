CREATE TABLE IF NOT EXISTS scores (
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  territory TEXT NOT NULL,
  length INTEGER NOT NULL,
  pace INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (name_key, territory, length, pace, difficulty)
);
