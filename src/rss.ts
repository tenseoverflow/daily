import { FEEDS, intVar } from "./config";
import type { Env, FeedConfig, Headline } from "./types";

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    )
    .trim();
}

function stripTags(html: string): string {
  return decodeXml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function tagContent(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

function slugToTitle(slug: string): string {
  const words = slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      if (w.length <= 2) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  return words.join(" ");
}

function hashId(source: string, url: string): string {
  let h = 0;
  const s = `${source}|${url}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `${source}-${h.toString(16)}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "DailyDigest/1.0 (+https://github.com/tenseoverflow/daily; personal RSS digest)",
      Accept: "application/rss+xml, application/xml, text/xml, text/html, */*",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return res.text();
}

export function parseRssItems(
  xml: string,
  feed: FeedConfig,
  limit: number,
): Headline[] {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, limit);
  const out: Headline[] = [];

  for (const match of items) {
    const block = match[0];
    const title = stripTags(tagContent(block, "title"));
    const link = stripTags(tagContent(block, "link")) || stripTags(tagContent(block, "guid"));
    if (!title || !link) continue;

    let url = link;
    try {
      url = new URL(link, feed.url).toString();
    } catch {
      continue;
    }

    const description = stripTags(tagContent(block, "description"));
    const publishedRaw = stripTags(tagContent(block, "pubDate"));
    let publishedAt: string | null = null;
    if (publishedRaw) {
      const d = new Date(publishedRaw);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    out.push({
      id: hashId(feed.id, url),
      source: feed.id,
      sourceName: feed.name,
      title,
      url,
      description,
      publishedAt,
    });
  }

  return out;
}

/** Scrape Delfi homepage article cards when RSS is unavailable/stale. */
export function parseDelfiHtml(html: string, feed: FeedConfig, limit: number): Headline[] {
  const re =
    /https?:\/\/(?:[a-z0-9-]+\.)?delfi\.ee(\/artikkel\/(\d+)\/([a-z0-9-]+))/gi;
  const seen = new Set<string>();
  const out: Headline[] = [];

  for (const m of html.matchAll(re)) {
    const path = m[1];
    const id = m[2];
    const slug = m[3];
    if (!slug || slug === "kommentaarid" || path.includes("/kommentaarid")) {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    const url = `https://www.delfi.ee/artikkel/${id}/${slug}`;
    out.push({
      id: hashId(feed.id, url),
      source: feed.id,
      sourceName: feed.name,
      title: slugToTitle(slug),
      url,
      description: "",
      publishedAt: null,
    });

    if (out.length >= limit) break;
  }

  return out;
}

export async function collectHeadlines(env: Env): Promise<Headline[]> {
  const perFeed = Math.ceil(intVar(env.MAX_FEED_ITEMS, 40) / FEEDS.length);
  const batches = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const body = await fetchText(feed.url);
        if (feed.kind === "html") {
          return parseDelfiHtml(body, feed, perFeed);
        }
        return parseRssItems(body, feed, perFeed);
      } catch (err) {
        console.error(`Feed ${feed.id} failed:`, err);
        return [] as Headline[];
      }
    }),
  );

  const merged = batches.flat();
  const byUrl = new Map<string, Headline>();
  for (const h of merged) {
    if (!byUrl.has(h.url)) byUrl.set(h.url, h);
  }
  return [...byUrl.values()];
}
