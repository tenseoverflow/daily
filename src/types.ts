export type Env = Cloudflare.Env & {
  /** Äripäev (iseteenindus) login email. */
  ARIPAEV_EMAIL?: string;
  /** Äripäev (iseteenindus) login password. */
  ARIPAEV_PASSWORD?: string;
  /** Delfi / Piano login email. */
  DELFI_EMAIL?: string;
  /** Delfi / Piano login password. */
  DELFI_PASSWORD?: string;
  /** Optional bearer token protecting the digest API + site. */
  DIGEST_ACCESS_TOKEN?: string;
  /** AI backend: workers | cursor | auto */
  AI_PROVIDER?: string;
  /** Cursor user/service API key (crsr_...). */
  CURSOR_API_KEY?: string;
  /** Cursor Cloud Agents API base (default https://api.cursor.com). */
  CURSOR_API_BASE_URL?: string;
  /** Cursor model id from GET /v1/models (default composer-2). */
  CURSOR_MODEL?: string;
};

export type FeedKind = "rss" | "html";

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  kind: FeedKind;
  /** Host substrings that belong to this source when matching article URLs. */
  hosts: string[];
  requiresLogin?: boolean;
  /** Publisher account login page used for scrape auth + setup docs. */
  loginUrl?: string;
}

export interface Headline {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  description: string;
  publishedAt: string | null;
}

export interface RankedHeadline extends Headline {
  importanceScore: number;
  importanceReason: string;
}

export interface ScrapedArticle {
  url: string;
  title: string;
  text: string;
  scraped: boolean;
  error?: string;
}

export interface SummarizedArticle extends RankedHeadline {
  summary: string;
  scraped: boolean;
  scrapeError?: string;
}

export interface DigestRecord {
  id: string;
  date_local: string;
  status: "pending" | "running" | "ready" | "error";
  overview: string | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface DigestArticleRecord {
  id: string;
  digest_id: string;
  rank: number;
  source: string;
  title: string;
  url: string;
  published_at: string | null;
  importance_score: number;
  importance_reason: string | null;
  summary: string | null;
  scraped: number;
  scrape_error: string | null;
}

export interface DigestView {
  id: string;
  dateLocal: string;
  status: DigestRecord["status"];
  overview: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  articles: Array<{
    id: string;
    rank: number;
    source: string;
    title: string;
    url: string;
    publishedAt: string | null;
    importanceScore: number;
    importanceReason: string | null;
    summary: string | null;
    scraped: boolean;
    scrapeError: string | null;
  }>;
}
