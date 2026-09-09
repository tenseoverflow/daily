CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  date_local TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  overview TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS digest_articles (
  id TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  importance_score REAL NOT NULL DEFAULT 0,
  importance_reason TEXT,
  summary TEXT,
  scraped INTEGER NOT NULL DEFAULT 0,
  scrape_error TEXT,
  image_url TEXT,
  FOREIGN KEY (digest_id) REFERENCES digests(id)
);

CREATE INDEX IF NOT EXISTS idx_digest_articles_digest
  ON digest_articles(digest_id, rank);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digest_id TEXT,
  step TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
