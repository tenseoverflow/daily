import { AI_MODEL } from "./config";
import type { Env, RankedHeadline, ScrapedArticle, SummarizedArticle } from "./types";

function clip(text: string, max = 5000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function runPrompt(env: Env, prompt: string): Promise<string> {
  const result = (await env.AI.run(AI_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You write crisp morning news briefs for a reader in Estonia. Prefer English unless the user asks otherwise. Be factual. No fluff.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 700,
    temperature: 0.3,
  })) as { response?: string };
  return (result.response ?? "").trim();
}

function fallbackSummary(h: RankedHeadline, article: ScrapedArticle): string {
  const base = article.text || h.description || h.title;
  const sentence = base.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  return sentence.slice(0, 480) || h.title;
}

export async function summarizeArticles(
  env: Env,
  ranked: RankedHeadline[],
  scraped: ScrapedArticle[],
): Promise<SummarizedArticle[]> {
  const byUrl = new Map(scraped.map((s) => [s.url, s]));
  const out: SummarizedArticle[] = [];

  for (const h of ranked) {
    const article = byUrl.get(h.url) ?? {
      url: h.url,
      title: h.title,
      text: h.description,
      scraped: false,
    };

    let summary: string;
    try {
      summary = await runPrompt(
        env,
        `Summarize this news article for a morning briefing in 3-5 short sentences.
Include the key facts, why it matters, and any numbers/names that matter.
Title: ${article.title || h.title}
Source: ${h.sourceName}
Body:
${clip(article.text || h.description || h.title)}`,
      );
      if (!summary) summary = fallbackSummary(h, article);
    } catch (err) {
      console.error("summarize error", h.url, err);
      summary = fallbackSummary(h, article);
    }

    out.push({
      ...h,
      title: article.title || h.title,
      summary,
      scraped: article.scraped,
      scrapeError: article.error,
    });
  }

  return out;
}

export async function writeOverview(
  env: Env,
  articles: SummarizedArticle[],
  dateLocal: string,
): Promise<string> {
  if (articles.length === 0) {
    return `No ranked headlines for ${dateLocal}.`;
  }

  const bullets = articles
    .map(
      (a, i) =>
        `${i + 1}. [${a.sourceName}] ${a.title} (score ${a.importanceScore}) — ${a.summary}`,
    )
    .join("\n");

  try {
    const overview = await runPrompt(
      env,
      `Write a short morning overview (4-7 sentences) for ${dateLocal} based on these ranked stories. Group themes; mention the most important 2-3 items by name. Do not invent facts.\n\n${bullets}`,
    );
    return overview || bullets;
  } catch (err) {
    console.error("overview error", err);
    return articles
      .slice(0, 3)
      .map((a) => a.title)
      .join(" · ");
  }
}
