# Flood Roofing Hub — Team mode API

Turns the single-user Hub into a **shared company dashboard**: everyone signs in
and sees the same data + settings, kept fresh by a nightly auto-sync.

It's tiny and separate from the `fergus-proxy` (which still holds your Fergus/
Xero/Akahu keys and does the actual API reads). This project only stores the
**computed dashboard state** for your one company, plus a simple shared login.

```
Hub (phone/desktop) ──sign in──> hub-api /api/auth ──> bearer token
Hub ──load/save state (token)──> hub-api /api/state ──> Upstash Redis (one JSON blob)
Nightly GitHub Action ──drives the Hub headless──> refreshes + pushes state
```

Auth is a **signed bearer token, not cookies**, so the Hub works whether it's a
local file or hosted — no CORS/cookie headaches.

## What you need

- A Vercel account (you already have one for `fergus-proxy`).
- A free **Upstash Redis** store (via Vercel's Marketplace/KV — 2 clicks).
- Your existing `fergus-proxy` URL + `PROXY_SECRET` (for the nightly sync only).

## Deploy (~10 min)

### 1. Deploy this folder as its own Vercel project

From this `hub-api` folder:

```powershell
npx vercel deploy --prod
```

- Set up and deploy? **Yes**
- Link to existing project? **No** (makes a new project, e.g. `flood-hub-api`)
- Accept defaults.

Copy the production URL it prints (e.g. `https://flood-hub-api.vercel.app`).

### 2. Add a Redis store

In the Vercel dashboard → your `flood-hub-api` project → **Storage** → **Create
Database** → **Upstash Redis** (Marketplace) → connect it to this project.
That auto-adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the project's env.

### 3. Add the auth env vars

Project → **Settings → Environment Variables** (Production):

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | any long random string (keep it secret) |
| `HUB_USERS` | `office:PICK_A_PASSWORD,manager:PICK_ANOTHER` |
| `HUB_PM_USERS` | *(optional)* `pm` — usernames that are restricted "project managers" |
| `CRON_SECRET` | any long random string (used by the nightly sync) |

`HUB_USERS` is a comma-separated list of `username:password`. Add one per person.
Change a password by editing this var and redeploying.

**Restricted project-manager login.** List any usernames in `HUB_PM_USERS` (comma-separated) to give
them a cut-down view: the Hub hides the **Cash** tab, **Growth** tab, **P&L** tab, **bank-account
balances**, and all the money figures/charts on the Dashboard (revenue, GP, AR-vs-A/P, A/P-due, P&L).
They keep Workload, Back Cost, Marketing and the workload/pipeline side of the Dashboard. Example:
`HUB_USERS=office:ownerpw,pm:pmpassword` **and** `HUB_PM_USERS=pm`. The PM signs in on the normal login
screen. Note this is a **cosmetic hide** — the shared data still reaches their browser, so it's an
access-convenience barrier for a trusted employee, not a hard security boundary.

### 4. Redeploy so the vars take effect

```powershell
npx vercel deploy --prod
```

### 5. Turn on team mode in the Hub

Open the Hub → **⚙ → Team mode** → paste the API URL → **Connect & sign in** →
enter a username/password from `HUB_USERS`. The device joins the shared dashboard.
Do the same on your office manager's device. Done.

> First person to sign in has an empty shared dashboard — just run a **Refresh**
> (or wait for the nightly sync) and it fills in for everyone.

## Nightly auto-sync (optional but recommended)

The workflow `.github/workflows/hub-nightly-sync.yml` drives the real Hub headless
each night and pushes fresh data, so the dashboard is current even if nobody opens
the app. It reuses all the in-app sync logic — nothing is re-implemented here.

Add these **GitHub repo secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `HUB_API_URL` | this project's URL (`https://flood-hub-api.vercel.app`) |
| `HUB_SYNC_USER` | a username from `HUB_USERS` (e.g. a dedicated `sync` user) |
| `HUB_SYNC_PASS` | that user's password |
| `PROXY_URL` | your `fergus-proxy` production URL |
| `PROXY_SECRET` | the `PROXY_SECRET` from the proxy |

Scheduled Actions only run from the **default branch**, so this starts once this
branch is merged. You can also run it on demand: Actions → **Hub nightly sync** →
**Run workflow** (pick `refresh` or `master`). It runs `refresh` nightly by default.

## API reference

| Route | Method | Auth | Body / result |
| --- | --- | --- | --- |
| `/api/auth` | POST | — | `{user,pass}` → `{token,user}` |
| `/api/state` | GET | Bearer | → `{data:{fr3_*:...}, meta}` |
| `/api/state` | POST | Bearer or `X-Cron-Secret` | `{data}` → `{ok,meta}` |

## Notes / limits

- **One company.** State is a single shared blob (`hub:state`). Last write wins —
  fine for a small office; if two people sync at the exact same second, one push
  supersedes the other (the next refresh reconciles it).
- **No financial keys here.** Fergus/Xero/Akahu keys stay on `fergus-proxy`. This
  project only ever sees the already-computed dashboard numbers.
- **Passwords are plain in `HUB_USERS`** (env-var secret). Fine for a couple of
  internal users; if you later sell this to other companies it needs proper
  hashing + per-company isolation (a bigger build).
