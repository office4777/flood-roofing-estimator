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

## Usage

`GET /admin/usage?days=30` (same `ADMIN_TOKEN`) answers one question: of the
businesses that signed up, how many reached each milestone.

```
signed_up → setup_done → sample_opened → roof_drawn → job_saved
          → price_book_saved → quote_sent → quote_accepted → order_sent
```

A business counts once per milestone however many times it hits it, so one
busy subscriber can't hide ten who never got started. Nine allow-listed names,
no third party, no cookie, no page tracking — the browser can only report
`sample_opened` and `roof_drawn`, and every other milestone is recorded on the
server at the route that does the thing. What is stored is which milestone a
business reached and when: never a customer, an address or a price.

## Tech Stack

- Frontend: Vanilla HTML/JS/CSS (single file, no build step needed)
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Auth: Supabase Auth + JWT
- Payments: Stripe
- Hosting: Vercel (frontend) + Railway (backend)
- AI: Anthropic Claude API
- Integrations: Fergus job management API
