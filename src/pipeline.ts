import {
  beginDigest,
  ensureSchema,
  localDate,
  logStep,
  saveDigestError,
  saveDigestSuccess,
} from "./db";
import { rankHeadlines } from "./rank";
import { collectHeadlines } from "./rss";
import { scrapeArticles } from "./scrape";
import { summarizeArticles, writeOverview } from "./summarize";
import type { Env } from "./types";

export interface PipelineResult {
  digestId: string;
  dateLocal: string;
  articleCount: number;
  status: "ready" | "error";
  error?: string;
}

export async function runDailyDigest(env: Env): Promise<PipelineResult> {
  await ensureSchema(env.DB);
  const dateLocal = localDate(env.TIMEZONE || "Europe/Tallinn");
  const digestId = await beginDigest(env.DB, dateLocal);

  try {
    await logStep(env.DB, digestId, "start", `Building digest for ${dateLocal}`);

    const headlines = await collectHeadlines(env);
    await logStep(
      env.DB,
      digestId,
      "rss",
      `Collected ${headlines.length} headlines`,
    );
    if (headlines.length === 0) {
      throw new Error("No headlines collected from configured feeds");
    }

    const ranked = await rankHeadlines(env, headlines);
    await logStep(
      env.DB,
      digestId,
      "rank",
      `Ranked top ${ranked.length} headlines`,
    );

    const scraped = await scrapeArticles(env, ranked);
    const scrapedOk = scraped.filter((s) => s.scraped).length;
    await logStep(
      env.DB,
      digestId,
      "scrape",
      `Scraped ${scrapedOk}/${scraped.length} articles`,
    );

    const summarized = await summarizeArticles(env, ranked, scraped);
    const overview = await writeOverview(env, summarized, dateLocal);
    await saveDigestSuccess(env.DB, digestId, overview, summarized);
    await logStep(env.DB, digestId, "done", "Digest ready");

    return {
      digestId,
      dateLocal,
      articleCount: summarized.length,
      status: "ready",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveDigestError(env.DB, digestId, message);
    await logStep(env.DB, digestId, "error", message);
    return {
      digestId,
      dateLocal,
      articleCount: 0,
      status: "error",
      error: message,
    };
  }
}
