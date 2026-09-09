# Daily

Personal Estonian morning news digest running as a Cloudflare Worker. See `README.md` for
the full product description, API surface, and deploy instructions.

## Cursor Cloud specific instructions

Standard commands live in `package.json` scripts (`test`, `typecheck`, `dev`, `db:migrate`)
and `README.md`. Notes below cover only non-obvious caveats for running this locally in the
cloud VM.

- Run the dev server with `npx wrangler dev --local` (not plain `npx wrangler dev`). The `AI`
  binding defaults to a *remote* Workers AI resource; plain `wrangler dev` tries to open a
  remote proxy session and aborts with "No credentials found" in this non-interactive VM
  (no Cloudflare login). `--local` disables all remote bindings so the Worker boots on
  `http://localhost:8787`. With `--local`, `env.AI` shows "not supported" and `env.BROWSER`
  (Browser Rendering) is unavailable — this is expected here.
- The pipeline degrades gracefully when AI and Browser Rendering are unavailable: ranking
  falls back to a keyword heuristic (`src/rank.ts`) and summaries fall back to RSS blurbs
  (`src/summarize.ts`). So `POST /api/run` still produces a real `ready` digest from live
  Äripäev/ERR/Delfi feeds without any Cloudflare account, AI provider, or publisher logins.
  Paywalled articles will show `scraped: false` ("Likely paywalled or sparse HTML") — expected
  without `--remote` + credentials.
- Run `npm run db:migrate` once to create the local D1 database before starting `wrangler dev`;
  local D1 state persists under `.wrangler/` (gitignored).
- Full AI ranking/summaries, and authenticated paywall scraping, require either
  `wrangler dev --remote` with a Cloudflare account plus publisher secrets in `.dev.vars`. None of these are needed to
  boot the app or run the pipeline end-to-end locally.
- There is no ESLint/build step. `npm run typecheck` (`tsc --noEmit`) is the closest lint;
  Wrangler bundles on dev/deploy.
