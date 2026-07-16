import type { FeedConfig } from "./types";

/**
 * Default Estonian news sources.
 * Delfi’s topic URL is an HTML index (not a live RSS feed), and their old
 * Feedburner feed is stale — we scrape delfi.ee headlines instead.
 */
export const FEEDS: FeedConfig[] = [
  {
    id: "aripaev",
    name: "Äripäev",
    url: "https://www.aripaev.ee/rss",
    kind: "rss",
    hosts: ["aripaev.ee"],
    requiresLogin: true,
  },
  {
    id: "delfi",
    name: "Delfi",
    url: "https://www.delfi.ee/",
    kind: "html",
    hosts: ["delfi.ee"],
    requiresLogin: true,
  },
  {
    id: "err",
    name: "ERR",
    url: "https://www.err.ee/rss",
    kind: "rss",
    hosts: ["err.ee"],
    requiresLogin: false,
  },
];

export const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
