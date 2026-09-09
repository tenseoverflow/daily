import type {
  DigestArticleRecord,
  DigestRecord,
  DigestView,
  Env,
  SummarizedArticle,
} from "./types";

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY,
        date_local TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        overview TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      )
    `),
    db.prepare(`
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
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_digest_articles_digest
        ON digest_articles(digest_id, rank)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS run_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digest_id TEXT,
        step TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `),
  ]);
}

export function localDate(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function logStep(
  db: D1Database,
  digestId: string | null,
  step: string,
  message: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO run_log (digest_id, step, message, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(digestId, step, message, new Date().toISOString())
    .run();
}

export async function beginDigest(
  db: D1Database,
  dateLocal: string,
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id, status FROM digests WHERE date_local = ?`)
    .bind(dateLocal)
    .first<{ id: string; status: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE digests
         SET status = 'running', error = NULL, completed_at = NULL
         WHERE id = ?`,
      )
      .bind(existing.id)
      .run();
    await db
      .prepare(`DELETE FROM digest_articles WHERE digest_id = ?`)
      .bind(existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO digests (id, date_local, status, created_at)
       VALUES (?, ?, 'running', ?)`,
    )
    .bind(id, dateLocal, new Date().toISOString())
    .run();
  return id;
}

export async function saveDigestSuccess(
  db: D1Database,
  digestId: string,
  overview: string,
  articles: SummarizedArticle[],
): Promise<void> {
  const stmts = [
    db
      .prepare(
        `UPDATE digests
         SET status = 'ready', overview = ?, completed_at = ?, error = NULL
         WHERE id = ?`,
      )
      .bind(overview, new Date().toISOString(), digestId),
  ];

  articles.forEach((a, index) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO digest_articles (
            id, digest_id, rank, source, title, url, published_at,
            importance_score, importance_reason, summary, scraped, scrape_error, image_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          digestId,
          index + 1,
          a.sourceName,
          a.title,
          a.url,
          a.publishedAt,
          a.importanceScore,
          a.importanceReason,
          a.summary,
          a.scraped ? 1 : 0,
          a.scrapeError ?? null,
          a.imageUrl ?? null,
        ),
    );
  });

  await db.batch(stmts);
}

export async function saveDigestError(
  db: D1Database,
  digestId: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE digests
       SET status = 'error', error = ?, completed_at = ?
       WHERE id = ?`,
    )
    .bind(error, new Date().toISOString(), digestId)
    .run();
}

function toView(
  digest: DigestRecord,
  articles: DigestArticleRecord[],
): DigestView {
  return {
    id: digest.id,
    dateLocal: digest.date_local,
    status: digest.status,
    overview: digest.overview,
    createdAt: digest.created_at,
    completedAt: digest.completed_at,
    error: digest.error,
    articles: articles.map((a) => ({
      id: a.id,
      rank: a.rank,
      source: a.source,
      title: a.title,
      url: a.url,
      publishedAt: a.published_at,
      importanceScore: a.importance_score,
      importanceReason: a.importance_reason,
      summary: a.summary,
      scraped: !!a.scraped,
      scrapeError: a.scrape_error,
      imageUrl: a.image_url,
    })),
  };
}

export async function getLatestDigest(env: Env): Promise<DigestView | null> {
  await ensureSchema(env.DB);
  const digest = await env.DB.prepare(
    `SELECT * FROM digests ORDER BY date_local DESC, created_at DESC LIMIT 1`,
  ).first<DigestRecord>();
  if (!digest) return null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM digest_articles WHERE digest_id = ? ORDER BY rank ASC`,
  )
    .bind(digest.id)
    .all<DigestArticleRecord>();

  return toView(digest, results ?? []);
}

export async function getDigestByDate(
  env: Env,
  dateLocal: string,
): Promise<DigestView | null> {
  await ensureSchema(env.DB);
  const digest = await env.DB.prepare(
    `SELECT * FROM digests WHERE date_local = ?`,
  )
    .bind(dateLocal)
    .first<DigestRecord>();
  if (!digest) return null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM digest_articles WHERE digest_id = ? ORDER BY rank ASC`,
  )
    .bind(digest.id)
    .all<DigestArticleRecord>();

  return toView(digest, results ?? []);
}

export async function listDigestDates(env: Env): Promise<string[]> {
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT date_local FROM digests WHERE status = 'ready'
     ORDER BY date_local DESC LIMIT 30`,
  ).all<{ date_local: string }>();
  return (results ?? []).map((r) => r.date_local);
}
