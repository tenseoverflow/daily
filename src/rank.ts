import { AI_MODEL, intVar } from "./config";
import type { Env, Headline, RankedHeadline } from "./types";

interface RankRow {
  id: string;
  score: number;
  reason: string;
}

function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function heuristicRank(headlines: Headline[], topN: number): RankedHeadline[] {
  const keywords = [
    "eesti",
    "valitsus",
    "riigikogu",
    "nato",
    "sõda",
    "ukraina",
    "majandus",
    "börs",
    "inflatsioon",
    "pank",
    "euroopa",
    "energia",
    "kaitse",
    "investeering",
  ];

  const scored = headlines.map((h) => {
    const hay = `${h.title} ${h.description}`.toLowerCase();
    let score = 40;
    for (const k of keywords) {
      if (hay.includes(k)) score += 6;
    }
    if (h.source === "aripaev") score += 4;
    if (h.source === "err") score += 3;
    if (h.publishedAt) {
      const ageH =
        (Date.now() - new Date(h.publishedAt).getTime()) / (1000 * 60 * 60);
      if (ageH < 12) score += 10;
      else if (ageH < 24) score += 5;
    }
    score = Math.min(99, score);
    return {
      ...h,
      importanceScore: score,
      importanceReason: "Heuristic ranking (AI unavailable or parse failed)",
    };
  });

  return scored
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, topN);
}

export async function rankHeadlines(
  env: Env,
  headlines: Headline[],
): Promise<RankedHeadline[]> {
  const topN = intVar(env.TOP_HEADLINES, 8);
  if (headlines.length === 0) return [];

  const catalog = headlines.slice(0, intVar(env.MAX_FEED_ITEMS, 40)).map((h) => ({
    id: h.id,
    source: h.sourceName,
    title: h.title,
    description: h.description.slice(0, 220),
    publishedAt: h.publishedAt,
  }));

  const prompt = `You are an Estonian morning news editor. Pick the ${topN} most important headlines for a busy professional living in Estonia.

Score importance 0-100 based on: national impact, business/economy relevance, geopolitics/security, uniqueness (avoid duplicates), and freshness.

Return ONLY a JSON array (no prose) with objects:
{"id":"...","score":87,"reason":"one short sentence in English"}

Headlines:
${JSON.stringify(catalog, null, 2)}`;

  try {
    const result = (await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Return only valid JSON arrays. No markdown unless required for JSON.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
      temperature: 0.2,
    })) as { response?: string };

    const text = result.response ?? "";
    const arr = extractJsonArray(text);
    if (!arr) return heuristicRank(headlines, topN);

    const byId = new Map(headlines.map((h) => [h.id, h]));
    const ranked: RankedHeadline[] = [];

    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const r = row as RankRow;
      const base = byId.get(String(r.id));
      if (!base) continue;
      ranked.push({
        ...base,
        importanceScore: Number(r.score) || 0,
        importanceReason: String(r.reason || "Selected by model"),
      });
    }

    if (ranked.length === 0) return heuristicRank(headlines, topN);

    return ranked
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, topN);
  } catch (err) {
    console.error("rankHeadlines AI error:", err);
    return heuristicRank(headlines, topN);
  }
}
