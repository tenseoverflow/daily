# Daily

Personal morning news digest for Estonia. Every day at **09:00 Europe/Tallinn** it:

1. Polls Äripäev + ERR RSS, and scrapes Delfi homepage headlines (their public RSS topic page is not a live feed)
2. Ranks the most important headlines with Workers AI
3. Screen-scrapes the top stories (Browser Rendering + your login secrets for paywalls)
4. Summarizes them into a short briefing you can read on the web

## Stack

- Cloudflare Workers (`scheduled` cron + HTTP API)
- D1 (digest storage)
- Workers AI (ranking + summaries)
- Browser Rendering / Puppeteer (authenticated scrape)
- Static site in `public/`

### AI providers

| `AI_PROVIDER` | Behavior |
|---------------|----------|
| `workers` | Cloudflare Workers AI |
| `cursor` | [Cursor Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints) (no-repo agent → `run.result`) |
| `auto` (default) | Workers AI → Cursor |

```bash
# Cursor API (create key at cursor.com/dashboard → API Keys)
# npx wrangler secret put CURSOR_API_KEY
# AI_PROVIDER=cursor
# Omit CURSOR_MODEL to use your account default, or pick one:
# curl -sS https://api.cursor.com/v1/models -H "Authorization: Bearer $CURSOR_API_KEY"
# CURSOR_MODEL=composer-2.5
```

Notes:
- Cursor has no OpenAI-style `/v1/chat/completions`; Daily uses a **no-repo cloud agent** per prompt and reads the finished run’s `result`. That is slower and uses Cloud Agent quota — 
- If you see `invalid_model`, unset `CURSOR_MODEL` or set it to an id returned by `GET /v1/models` for your key.

## Setup

```bash
npm install
npx wrangler login
npx wrangler d1 create daily_digest
```

Put the returned database id into `wrangler.jsonc` → `d1_databases[0].database_id`.

```bash
npm run db:migrate:remote
```

### Secrets (per publisher)

| Secret | Used for | Login page |
|--------|----------|------------|
| `ARIPAEV_EMAIL` / `ARIPAEV_PASSWORD` | Äripäev paywall scrape | [iseteenindus.aripaev.ee/et/login](https://iseteenindus.aripaev.ee/et/login) |
| `DELFI_EMAIL` / `DELFI_PASSWORD` | Delfi paywall scrape (Piano ID) | [delfi.ee/klient/konto](https://www.delfi.ee/klient/konto) (Logi sisse) |
| `DIGEST_ACCESS_TOKEN` | Optional site lock | — |

```bash
npx wrangler secret put ARIPAEV_EMAIL
npx wrangler secret put ARIPAEV_PASSWORD
npx wrangler secret put DELFI_EMAIL
npx wrangler secret put DELFI_PASSWORD
npx wrangler secret put DIGEST_ACCESS_TOKEN   # optional
```

ERR is open and needs no credentials. Confirm each account works in a normal browser on the login page above before deploying secrets.

If you set `DIGEST_ACCESS_TOKEN`, open the site once as `https://<worker>/?token=YOUR_TOKEN` to set a cookie.

## Develop

```bash
# apply local schema
npm run db:migrate

# local API/UI (AI remote; browser scrape needs --remote)
npx wrangler dev
# or fully remote bindings:
npx wrangler dev --remote
```

Manual run:

```bash
curl -X POST http://127.0.0.1:8787/api/run
```

## Deploy

```bash
npm run deploy
```

Cron is `0 6 * * *` UTC ≈ **09:00 in Tallinn during EEST**. Adjust `triggers.crons` in `wrangler.jsonc` if you want winter EET (08:00 UTC) instead.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + config flags |
| GET | `/api/digest/latest` | Latest digest |
| GET | `/api/digest?date=YYYY-MM-DD` | Digest by local date |
| GET | `/api/digests` | Recent ready dates |
| POST | `/api/run` | Run pipeline now |

## Notes

- Delfi’s `https://www.delfi.ee/teema/56816374/rss-uudisvood` is an HTML topic page, not RSS. Daily uses homepage article links instead.
- Login selectors on publisher sites can change; scrape falls back to public HTML / RSS descriptions when auth fails.
- For personal use only — respect publisher terms and your subscription.
