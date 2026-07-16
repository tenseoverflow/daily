import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";

// Browser binding from wrangler types is BrowserRun; puppeteer.launch accepts it at runtime.
type BrowserBinding = Parameters<typeof puppeteer.launch>[0];
import { FEEDS } from "./config";
import type { Env, RankedHeadline, ScrapedArticle } from "./types";

const ARTICLE_SELECTORS = [
  "article",
  "[itemprop='articleBody']",
  ".article-body",
  ".article__body",
  ".article-content",
  ".content-body",
  ".text",
  "main",
];

function feedForUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FEEDS.find((f) => f.hosts.some((h) => host.includes(h)));
  } catch {
    return undefined;
  }
}

function looksPaywalled(text: string): boolean {
  const t = text.toLowerCase();
  if (text.trim().length < 400) return true;
  return (
    t.includes("tellijatele") ||
    t.includes("ainult tellijatele") ||
    t.includes("logi sisse") ||
    t.includes("subscribe") ||
    t.includes("paywall")
  );
}

function extractFromHtml(html: string, fallbackTitle: string): {
  title: string;
  text: string;
} {
  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
    html.match(/<title[^>]*>([^<]+)/i);
  const title = (titleMatch?.[1] || fallbackTitle).trim();

  let best = "";
  for (const sel of [
    /<article[\s\S]*?<\/article>/i,
    /itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/div>/i,
    /class=["'][^"']*article[^"']*body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) {
    const m = html.match(sel);
    if (m) {
      const chunk = m[1] ?? m[0];
      const text = chunk
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > best.length) best = text;
    }
  }

  if (!best) {
    best = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  }

  return { title, text: best.slice(0, 12000) };
}

async function extractPageText(page: Page): Promise<string> {
  return page.evaluate((selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent && el.textContent.trim().length > 200) {
        return el.textContent.replace(/\s+/g, " ").trim();
      }
    }
    return document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
  }, ARTICLE_SELECTORS);
}

async function loginAripaev(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("https://www.aripaev.ee/login", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  const emailSel =
    'input[type="email"], input[name="email"], input[name="username"], input#email, input#username';
  const passSel = 'input[type="password"], input[name="password"], input#password';

  await page.waitForSelector(emailSel, { timeout: 15000 });
  await page.click(emailSel, { clickCount: 3 });
  await page.type(emailSel, email, { delay: 15 });
  await page.click(passSel, { clickCount: 3 });
  await page.type(passSel, password, { delay: 15 });

  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => undefined),
    page.evaluate(() => {
      const btn =
        document.querySelector<HTMLButtonElement>(
          'button[type="submit"], input[type="submit"]',
        ) ||
        Array.from(document.querySelectorAll("button")).find((b) =>
          /logi|sisene|sign in|login/i.test(b.textContent || ""),
        );
      btn?.click();
    }),
  ]);
}

async function loginDelfi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Delfi login UI shifts; try common account entry points.
  const candidates = [
    "https://www.delfi.ee/",
    "https://account.delfi.ee/login",
    "https://www.delfi.ee/login",
  ];

  for (const url of candidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Open login modal / link if present
    await page.evaluate(() => {
      const el = Array.from(
        document.querySelectorAll("a, button, span"),
      ).find((n) => /logi sisse|sisene|login/i.test(n.textContent || ""));
      (el as HTMLElement | undefined)?.click();
    });

    const emailSel =
      'input[type="email"], input[name="email"], input[name="username"], input#email';
    const passSel = 'input[type="password"], input[name="password"]';

    try {
      await page.waitForSelector(emailSel, { timeout: 5000 });
      await page.type(emailSel, email, { delay: 15 });
      await page.type(passSel, password, { delay: 15 });
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 })
          .catch(() => undefined),
        page.evaluate(() => {
          const btn =
            document.querySelector<HTMLButtonElement>(
              'button[type="submit"], input[type="submit"]',
            ) ||
            Array.from(document.querySelectorAll("button")).find((b) =>
              /logi|sisene|sign in|login/i.test(b.textContent || ""),
            );
          btn?.click();
        }),
      ]);
      return;
    } catch {
      // try next candidate
    }
  }
}

async function ensureLoggedIn(
  browser: Browser,
  env: Env,
  sourceId: string,
  logged: Set<string>,
): Promise<void> {
  if (logged.has(sourceId)) return;
  const email = env.NEWS_EMAIL;
  const password = env.NEWS_PASSWORD;
  if (!email || !password) return;

  const page = await browser.newPage();
  try {
    if (sourceId === "aripaev") await loginAripaev(page, email, password);
    else if (sourceId === "delfi") await loginDelfi(page, email, password);
    logged.add(sourceId);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function scrapeWithBrowser(
  browser: Browser,
  env: Env,
  headline: RankedHeadline,
  logged: Set<string>,
): Promise<ScrapedArticle> {
  const feed = feedForUrl(headline.url);
  if (feed?.requiresLogin) {
    await ensureLoggedIn(browser, env, feed.id, logged);
  }

  const page = await browser.newPage();
  try {
    await page.goto(headline.url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const text = (await extractPageText(page)).slice(0, 12000);
    const title = (await page.title()) || headline.title;
    return {
      url: headline.url,
      title,
      text,
      scraped: text.length > 200,
      error: text.length > 200 ? undefined : "Extracted text too short",
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function scrapeWithFetch(headline: RankedHeadline): Promise<ScrapedArticle> {
  const res = await fetch(headline.url, {
    headers: {
      "User-Agent":
        "DailyDigest/1.0 (+https://github.com/tenseoverflow/daily; personal RSS digest)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    return {
      url: headline.url,
      title: headline.title,
      text: headline.description,
      scraped: false,
      error: `HTTP ${res.status}`,
    };
  }
  const html = await res.text();
  const { title, text } = extractFromHtml(html, headline.title);
  return {
    url: headline.url,
    title,
    text: text || headline.description,
    scraped: !looksPaywalled(text) && text.length > 400,
    error:
      looksPaywalled(text) || text.length <= 400
        ? "Likely paywalled or sparse HTML"
        : undefined,
  };
}

export async function scrapeArticles(
  env: Env,
  headlines: RankedHeadline[],
): Promise<ScrapedArticle[]> {
  const results: ScrapedArticle[] = [];
  const needBrowser: RankedHeadline[] = [];

  for (const h of headlines) {
    const fetched = await scrapeWithFetch(h);
    if (fetched.scraped) {
      results.push(fetched);
    } else {
      needBrowser.push(h);
      // keep fallback text for later if browser also fails
      results.push(fetched);
    }
  }

  if (needBrowser.length === 0) return results;

  let browser: Browser | null = null;
  const logged = new Set<string>();
  try {
    browser = await puppeteer.launch(env.BROWSER as BrowserBinding);
    for (const h of needBrowser) {
      try {
        const scraped = await scrapeWithBrowser(browser, env, h, logged);
        const idx = results.findIndex((r) => r.url === h.url);
        if (scraped.scraped || (scraped.text?.length ?? 0) > (results[idx]?.text.length ?? 0)) {
          results[idx] = scraped;
        } else if (results[idx] && !results[idx].text && h.description) {
          results[idx] = {
            ...results[idx],
            text: h.description,
          };
        }
      } catch (err) {
        const idx = results.findIndex((r) => r.url === h.url);
        if (idx >= 0) {
          results[idx] = {
            ...results[idx],
            scraped: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }
  } catch (err) {
    console.error("Browser launch/scrape failed:", err);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }

  // Ensure every headline has at least description text for summarization
  return results.map((r) => {
    if (r.text?.trim()) return r;
    const h = headlines.find((x) => x.url === r.url);
    return {
      ...r,
      text: h?.description || h?.title || "",
    };
  });
}
