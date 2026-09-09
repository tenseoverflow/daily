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

function looksLikeChrome(text: string): boolean {
  const t = text.toLowerCase();
  const chromeHits = [
    "logi sisse",
    "esimene kuu",
    "omx baltic",
    "omx tallinn",
    "nasdaq",
    "s&p 500",
    "cookie",
    "küpsiste",
  ].filter((k) => t.includes(k)).length;
  return chromeHits >= 2;
}

function looksPaywalled(text: string): boolean {
  const t = text.toLowerCase();
  if (text.trim().length < 400) return true;
  if (looksLikeChrome(text)) return true;
  return (
    t.includes("tellijatele") ||
    t.includes("ainult tellijatele") ||
    t.includes("logi sisse") ||
    t.includes("subscribe") ||
    t.includes("paywall")
  );
}

function usableArticleText(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || looksPaywalled(cleaned) || looksLikeChrome(cleaned)) {
    return fallback.trim();
  }
  return cleaned;
}

function extractFromHtml(html: string, fallbackTitle: string): {
  title: string;
  text: string;
  imageUrl?: string;
} {
  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
    html.match(/<title[^>]*>([^<]+)/i);
  const title = (titleMatch?.[1] || fallbackTitle).trim();

  const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  const imageUrl = imageMatch?.[1]?.trim();

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

  return { title, text: best.slice(0, 12000), imageUrl };
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

const EMAIL_SEL =
  'input[type="email"], input[name="email"], input[name="username"], input#email, input#username, input[autocomplete="username"]';
const PASS_SEL =
  'input[type="password"], input[name="password"], input#password, input[autocomplete="current-password"]';

async function fillAndSubmitLogin(
  page: Page,
  email: string,
  password: string,
  timeoutMs = 15000,
): Promise<boolean> {
  try {
    await page.waitForSelector(EMAIL_SEL, { timeout: timeoutMs });
    await page.click(EMAIL_SEL, { clickCount: 3 });
    await page.type(EMAIL_SEL, email, { delay: 15 });
    await page.waitForSelector(PASS_SEL, { timeout: timeoutMs });
    await page.click(PASS_SEL, { clickCount: 3 });
    await page.type(PASS_SEL, password, { delay: 15 });

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
    return true;
  } catch {
    return false;
  }
}

async function loginAripaev(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Official Ä-konto portal (SSO used across aripaev.ee)
  await page.goto("https://iseteenindus.aripaev.ee/et/login", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  let ok = await fillAndSubmitLogin(page, email, password, 20000);
  if (!ok) {
    // Fallback: main-site login entry (SSO plugin)
    await page.goto("https://www.aripaev.ee/login", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    ok = await fillAndSubmitLogin(page, email, password, 20000);
  }
  if (!ok) {
    throw new Error("Äripäev login form not found");
  }

  // Warm SSO cookie onto the news domain
  await page
    .goto("https://www.aripaev.ee/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    })
    .catch(() => undefined);
}

async function loginDelfi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Delfi auth is Piano ID (auth.piano.delfi.ee), opened from the site UI.
  // Account hub: https://www.delfi.ee/klient/konto
  const candidates = [
    "https://www.delfi.ee/klient/konto",
    "https://www.delfi.ee/",
  ];

  for (const url of candidates) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    // Give Piano SDK a moment, then open "Logi sisse"
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => {
      const el = Array.from(
        document.querySelectorAll("a, button, span, div"),
      ).find((n) =>
        /^(logi sisse|sisene|login)$/i.test((n.textContent || "").trim()),
      );
      (el as HTMLElement | undefined)?.click();
    });

    // Piano may render in an iframe
    const frames = page.frames();
    for (const frame of [page.mainFrame(), ...frames]) {
      try {
        const emailHandle = await frame.waitForSelector(EMAIL_SEL, {
          timeout: 4000,
        });
        if (!emailHandle) continue;
        await emailHandle.click({ clickCount: 3 });
        await emailHandle.type(email, { delay: 15 });
        const passHandle = await frame.waitForSelector(PASS_SEL, {
          timeout: 4000,
        });
        if (!passHandle) continue;
        await passHandle.click({ clickCount: 3 });
        await passHandle.type(password, { delay: 15 });
        await frame.evaluate(() => {
          const btn =
            document.querySelector<HTMLButtonElement>(
              'button[type="submit"], input[type="submit"]',
            ) ||
            Array.from(document.querySelectorAll("button")).find((b) =>
              /logi|sisene|sign in|login|jätka|continue/i.test(
                b.textContent || "",
              ),
            );
          btn?.click();
        });
        await new Promise((r) => setTimeout(r, 3000));
        return;
      } catch {
        // try next frame / candidate
      }
    }
  }

  throw new Error("Delfi/Piano login form not found");
}

function credentialsForSource(
  env: Env,
  sourceId: string,
): { email?: string; password?: string } {
  if (sourceId === "aripaev") {
    return { email: env.ARIPAEV_EMAIL, password: env.ARIPAEV_PASSWORD };
  }
  if (sourceId === "delfi") {
    return { email: env.DELFI_EMAIL, password: env.DELFI_PASSWORD };
  }
  return {};
}

async function ensureLoggedIn(
  browser: Browser,
  env: Env,
  sourceId: string,
  logged: Set<string>,
): Promise<void> {
  if (logged.has(sourceId)) return;
  const { email, password } = credentialsForSource(env, sourceId);
  if (!email || !password) {
    console.warn(`Missing credentials for ${sourceId}; skipping login`);
    return;
  }

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
    const raw = (await extractPageText(page)).slice(0, 12000);
    const title = (await page.title()) || headline.title;
    const imageUrl = await page.evaluate(() => {
      const meta = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
      return meta?.content?.trim() || undefined;
    });
    const text = usableArticleText(raw, headline.description || headline.title);
    const scraped =
      text.length > 200 &&
      !looksPaywalled(text) &&
      text !== (headline.description || "").trim();
    return {
      url: headline.url,
      title,
      text,
      scraped,
      error: scraped ? undefined : "Extracted text too short or paywalled",
      imageUrl,
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
  const { title, text, imageUrl } = extractFromHtml(html, headline.title);
  const body = usableArticleText(text, headline.description || "");
  const scraped =
    Boolean(body) &&
    body !== (headline.description || "").trim() &&
    body.length > 400 &&
    !looksPaywalled(body);
  return {
    url: headline.url,
    title,
    text: body || headline.description || headline.title,
    scraped,
    error: scraped ? undefined : "Likely paywalled or sparse HTML",
    imageUrl,
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
