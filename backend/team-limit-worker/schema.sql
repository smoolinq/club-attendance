CREATE TABLE IF NOT EXISTS creators (
  creator_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  team_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  team_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES creators(creator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_creator_id ON teams(creator_id);