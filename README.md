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

### Secrets

```bash
npx wrangler secret put NEWS_EMAIL
npx wrangler secret put NEWS_PASSWORD
npx wrangler secret put DIGEST_ACCESS_TOKEN   # optional site lock
```

`NEWS_EMAIL` / `NEWS_PASSWORD` are used for Äripäev and Delfi login during scrape. ERR is open.

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
