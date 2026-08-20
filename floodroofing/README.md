# RoofMap

NZ roofing estimation SaaS — satellite imagery, AI analysis, sheet layout diagrams, Fergus integration.

## Quick Start

See `docs/SETUP.md` for full deployment instructions.

## Structure

```
frontend/     → Static HTML app (Vercel)
backend/      → Node.js API server (Railway)
tests/        → Product test suites (see below)
tools/        → One-off generators, e.g. the sample job
docs/         → Setup guides, database schema
```

## Tests

```
npm install                 # once, at the repo root
npx playwright install chromium

npm test                    # everything
npm run test:api            # the backend suites only (fast, no browser)
npm run test:ui             # the browser suites only
node floodroofing/tests/run.mjs plans      # one suite by name
```

The backend suites boot the real Express app against an in-memory stand-in
for PostgREST (`tests/fakepgrst.mjs`) — no database needed. The browser
suites drive the real `index.html` in Chromium. Both run in CI on every push
that touches `frontend/`, `backend/` or `tests/`.

## Error monitoring

Unhandled server errors, hand-rolled 500s, uncaught exceptions and frontend
crashes all land in one recorder. Set these on the backend to get told about
them; without any of them it logs and keeps a rolling window in memory.

| Variable | What it does |
|---|---|
| `ERROR_WEBHOOK_URL` | POSTs each new error once per 15 minutes. Slack and Discord incoming webhooks both work as-is. |
| `ERROR_EMAIL_TO` | Same, by email, through whichever mail transport is configured. |
| `ADMIN_TOKEN` | Opens `GET /admin/errors` (header `x-admin-token`, or `?token=`). Without it that route 404s. |

Errors are grouped by shape, so the same bug hitting forty times is one entry
and one alert. Tokens, passwords and data-URIs are redacted before anything is
stored or sent.

## Tech Stack

- Frontend: Vanilla HTML/JS/CSS (single file, no build step needed)
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Auth: Supabase Auth + JWT
- Payments: Stripe
- Hosting: Vercel (frontend) + Railway (backend)
- AI: Anthropic Claude API
- Integrations: Fergus job management API
