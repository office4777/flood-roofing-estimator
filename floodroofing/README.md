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

## Public pages

| URL | File | What it's for |
|---|---|---|
| `/` | `frontend/landing.html` | The pitch. A signed-in visitor is forwarded straight into the app. |
| `/signup` | `frontend/signup.html` | Four fields, above the fold on a phone. The only conversion point. |
| `/terms`, `/privacy` | `terms.html`, `privacy.html` | See below. |
| `/index.html` | `frontend/index.html` | The app itself, and the PWA's `start_url`. |

Routing lives in `frontend/vercel.json`. **The app is at `/index.html`, not `/`** —
if that ever moves, `manifest.webmanifest`'s `start_url` and `sw.js`'s precache
list have to move with it or an installed RoofMap opens the sales page.

## Terms and Privacy Policy

`frontend/terms.html` and `frontend/privacy.html`, styled by `frontend/legal.css`
and linked from the sign-up form, the site footer and Settings → Team.

**Not yet reviewed by a lawyer, and five fields are still placeholders.** Search
both files for `[` and fill in:

| Placeholder | Where |
|---|---|
| `[NZBN]` | terms §1 |
| `[GST number]` | terms §1 |
| `[registered address]` | terms §1, terms §15, privacy §13 |
| `[Supabase region]` | privacy §7 |

`tests/legal.mjs` ties the documents to the code: it fails if a third-party
host is called that the privacy policy doesn't name, if the AI stops being
opt-in, if the milestone count drifts from `USAGE_EVENTS`, or if either page
stops being reachable from the sign-up form. It also lists the remaining
placeholders on every run.

**When you add a provider — a new AI model, a different mail sender, Stripe
going live, any analytics — add its row to the table in privacy §5 in the same
commit.** A privacy policy that is out of date is worse than not having one.

## Tech Stack

- Frontend: Vanilla HTML/JS/CSS (single file, no build step needed)
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Auth: Supabase Auth + JWT
- Payments: Stripe
- Hosting: Vercel (frontend) + Railway (backend)
- AI: Anthropic Claude API
- Integrations: Fergus job management API
