import { describeAiConfig } from "./ai";
import { getDigestByDate, getLatestDigest, listDigestDates } from "./db";
import { runDailyDigest } from "./pipeline";
import type { Env } from "./types";

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401, {
    "WWW-Authenticate": 'Bearer realm="daily"',
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = env.DIGEST_ACCESS_TOKEN;
  if (!token) return true;

  const auth = request.headers.get("Authorization") || "";
  if (auth === `Bearer ${token}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("token") === token) return true;

  const cookie = request.headers.get("Cookie") || "";
  if (cookie.split(";").some((c) => c.trim() === `daily_token=${token}`)) {
    return true;
  }

  return false;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({
      ok: true,
      timezone: env.TIMEZONE,
      digestHour: env.DIGEST_HOUR,
      credentials: {
        aripaev: Boolean(env.ARIPAEV_EMAIL && env.ARIPAEV_PASSWORD),
        delfi: Boolean(env.DELFI_EMAIL && env.DELFI_PASSWORD),
      },
      loginPages: {
        aripaev: "https://iseteenindus.aripaev.ee/et/login",
        delfi: "https://www.delfi.ee/klient/konto",
      },
      ai: describeAiConfig(env),
      authRequired: Boolean(env.DIGEST_ACCESS_TOKEN),
    });
  }

  if (!isAuthorized(request, env)) return unauthorized();

  if (path === "/api/digest/latest" && request.method === "GET") {
    const digest = await getLatestDigest(env);
    if (!digest) return json({ digest: null });
    return json({ digest });
  }

  if (path === "/api/digest" && request.method === "GET") {
    const date = url.searchParams.get("date");
    if (!date) return json({ error: "Missing date" }, 400);
    const digest = await getDigestByDate(env, date);
    if (!digest) return json({ error: "Not found" }, 404);
    return json({ digest });
  }

  if (path === "/api/digests" && request.method === "GET") {
    const dates = await listDigestDates(env);
    return json({ dates });
  }

  if (path === "/api/run" && request.method === "POST") {
    const result = await runDailyDigest(env);
    return json(result, result.status === "ready" ? 200 : 500);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // Optional cookie bootstrap: /?token=...
    if (env.DIGEST_ACCESS_TOKEN) {
      const token = url.searchParams.get("token");
      if (token && token === env.DIGEST_ACCESS_TOKEN) {
        const dest = new URL("/", url.origin);
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest.toString(),
            "Set-Cookie": `daily_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          },
        });
      }

      if (
        !url.pathname.startsWith("/assets") &&
        request.method === "GET" &&
        !isAuthorized(request, env)
      ) {
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><title>Daily</title>
<style>body{font-family:Georgia,serif;background:#0f1c24;color:#e8eef2;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:28rem;padding:2rem;text-align:center}code{color:#9ad7c8}</style></head>
<body><main><h1>Daily</h1><p>This digest is private. Open with your access token once:<br><code>/?token=YOUR_TOKEN</code></p></main></body></html>`,
          { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runDailyDigest(env).then((result) => {
        console.log("scheduled digest", result);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
