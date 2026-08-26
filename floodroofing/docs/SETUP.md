# RoofMap — Setup Guide

## Overview
- **Frontend:** `frontend/` → deployed to Vercel (free)
- **Backend:** `backend/` → deployed to Railway (~$5/month)
- **Database:** Supabase (free tier)
- **Payments:** Stripe

---

## Step 1 — GitHub Setup (do this first)

1. Go to github.com → sign up
2. Click "New repository" → name it `flood-roofing-estimator`
3. Set to **Private**
4. Don't add README (we'll push existing code)

On your PC (after installing Git from git-scm.com):
```bash
cd C:\Users\Admin
git clone https://github.com/YOUR_USERNAME/flood-roofing-estimator.git
# Copy the floodroofing folder contents into it, then:
git add .
git commit -m "Initial commit"
git push
```

---

## Step 2 — Supabase Database

1. Go to supabase.com → New project → name it "floodroofing"
2. Save your database password somewhere safe
3. Go to **SQL Editor** → paste contents of `docs/database.sql` → Run
4. Go to **Settings → API** → copy:
   - Project URL → `SUPABASE_URL`
   - Service role key (secret) → `SUPABASE_SERVICE_KEY`

---

## Step 3 — Deploy Backend to Railway

1. Go to railway.app → Login with GitHub
2. New Project → Deploy from GitHub repo → select your repo
3. Set root directory to `backend/`
4. Add environment variables (Settings → Variables):
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   FERGUS_API_KEY=fergPAT_...
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   JWT_SECRET=make-up-something-long-and-random
   STRIPE_SECRET_KEY=sk_live_... (add later)
   FRONTEND_URL=https://your-app.vercel.app (add after Vercel deploy)
   ```
5. Railway gives you a URL like `https://floodroofing-backend.railway.app`
6. Test: open that URL + `/health` — should show `{"ok":true,...}`

### Error monitoring (do this before the first paying customer)

Without these the app still records every error, but only into the container
log — where nobody reads it, and where it is gone after a restart. A
subscriber who hits a bug and doesn't ring you is a silent cancellation.

```
ERROR_WEBHOOK_URL=https://hooks.slack.com/services/...   # or a Discord webhook
ERROR_EMAIL_TO=you@yourcompany.co.nz                     # or instead of the webhook
ADMIN_TOKEN=<a long random string>                       # opens /admin/errors
```

Then `https://<backend>/admin/errors?token=<ADMIN_TOKEN>` lists what has gone
wrong lately, grouped, newest first. Without `ADMIN_TOKEN` that route 404s.

### Custom domains for subscribers (Business plan)

```
VERCEL_TOKEN=<a Vercel personal token>
VERCEL_PROJECT_ID=prj_...
VERCEL_TEAM_ID=team_...
```

---

## Step 4 — Deploy Frontend to Vercel

1. Go to vercel.com → Login with GitHub
2. Import your repository
3. Set root directory to `frontend/`
4. Add environment variable:
   ```
   VITE_API_URL=https://floodroofing-backend.railway.app
   ```
5. Deploy → Vercel gives you `https://your-app.vercel.app`
6. Go back to Railway → add `FRONTEND_URL=https://your-app.vercel.app`

---

## Step 5 — Stripe (when ready for payments)

1. stripe.com → Create account → activate with business details
2. Create two products in Stripe dashboard:
   - "RoofMap Monthly" → $X/month → copy Price ID
   - "RoofMap Yearly" → $X/year → copy Price ID
3. Add to Railway environment variables:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PRICE_MONTHLY=price_...
   STRIPE_PRICE_YEARLY=price_...
   STRIPE_WEBHOOK_SECRET=whsec_... (from Stripe webhook settings)
   ```
4. In Stripe → Webhooks → Add endpoint:
   - URL: `https://floodroofing-backend.railway.app/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_succeeded`,
     `invoice.payment_failed`
5. Stripe → Settings → **Customer emails** → turn **"Successful payments" OFF**.
   RoofMap sends its own tax invoice from `accounts@` (below); leaving Stripe's
   receipt on means the subscriber gets two emails for one payment.

---

## Step 5b — The platform's own mailboxes

Two things the platform sends are addressed differently from everything else,
and both are now sent from their own mailbox rather than a shared `noreply@`:

| What | From | Reply-To |
|---|---|---|
| Subscription tax invoice / declined payment | `accounts@roofmap.co.nz` | `accounts@roofmap.co.nz` |
| Feedback and integration requests (`/feedback`) | `support@roofmap.co.nz` | **the user who sent it** |

Railway environment variables (all optional — these are the defaults):

```
ACCOUNTS_EMAIL=accounts@roofmap.co.nz
SUPPORT_EMAIL=support@roofmap.co.nz
SUBSCRIPTION_GST_RATE=15        # 0 turns the GST lines off entirely
SUBSCRIPTION_GST_NUMBER=        # printed on the subscription invoice when set
```

A From address is only honoured when it is on the **same domain** as
`EMAIL_FROM` — we cannot send as a domain we have not proven we own, and a
subscriber's address belongs in Reply-To, never in From.

**If you send through the Google Apps Script relay** (`GAS_MAIL_URL`), both
addresses must be set up in Gmail → Settings → **Accounts → Send mail as** on
the account behind the relay, and the script has to pass the alias through:

```js
const opts = { htmlBody: p.html || p.htmlBody, name: p.fromName, replyTo: p.replyTo };
if (p.from) opts.from = p.from;          // only works for a verified alias
GmailApp.sendEmail(p.to, p.subject, p.text, opts);
```

Without that, Gmail quietly falls back to the relay account's own address —
the mail still sends, it just does not carry the alias.

---

## How Updates Work (the whole point!)

When Claude (or you) makes a change:

1. Edit file on Claude's side
2. Push to GitHub: `git add . && git commit -m "fix" && git push`
3. Railway + Vercel auto-deploy in ~60 seconds
4. You refresh your browser — done ✅

No file copying. No server restarts. Works from any computer.

---

## Pricing

What the landing page sells, and what `PLANS` in `backend/server.js` enforces.
Per business, not per seat — an office of three shares one price book, one job
number counter and one set of jobs, and charging them three times for that
makes no sense to them.

| Plan | NZD/month + GST | Seats | Slug | Own domain | Fergus |
|---|---|---|---|---|---|
| Trial (14 days) | free | unlimited | ✓ | ✓ | ✓ |
| Solo | 149 | 1 | — | — | — |
| Team | 299 | 5 | ✓ | — | — |
| Business | 549 | unlimited | ✓ | ✓ | ✓ |

The trial deliberately unlocks everything, so a business can judge the whole
product before choosing.

These sit above the cheapest software in the category and well below what
per-report measuring costs a busy shop — the overseas products charge roughly
$40–65 a roof, so twenty roofs a month is past $1,000 before anything is
priced. Undercutting everybody while being the only product that measures on
the roof reads as a doubt, not a bargain.

To change them: the three numbers on `frontend/landing.html`, and the limits
in `PLANS`.

---

## What's Already Built

**Accounts and businesses**

✅ Registration, login, password reset  
✅ 14-day free trial, everything unlocked  
✅ Jobs, settings and price book shared across a whole business, not per user  
✅ Team invites, roles, and a record of who made a job and who ordered material  
✅ One shared job-number counter, handed out atomically  
✅ Plan limits enforced on the server, not by hidden buttons  
✅ Row-level security so one business can never see another's data  
✅ Per-business branding — no new subscriber inherits ours  
✅ `<slug>.roofmap.co.nz`, and automated custom domains on Business  

**The work**

✅ Roof measuring from aerial imagery, on desktop and on a phone at the property  
✅ Offline drawing and saving, syncing when the signal returns  
✅ Cut lists, flashing schedules, back trays, material orders, job packs  
✅ Customer proposals accepted online, with the customer's own selections  
✅ Fergus push  
✅ A seeded price book and a worked sample job, so day one isn't an empty screen  

**Keeping it running**

✅ Error monitoring — server, browser, and alerts  
✅ Trials that actually expire, with a countdown in the app  
✅ Usage milestones — whether a trialist actually got anywhere  
✅ 22 test suites in CI on every push  
✅ Terms of Service and Privacy Policy  
✅ Duplicate job-number guard  

## Still To Build

- [ ] **Stripe** — the code paths exist but billing is off (`BILLING_ENABLED=false`). Needs keys, price IDs, and a webhook.
  Note: with billing off, `requireSubscription` is a no-op, so **nothing is gated and trials don't stop anybody**.
  The trial dates are recorded correctly and the countdown shows in the app; the gate only bites once
  `BILLING_ENABLED=true`. Turn it on knowing every existing trial starts being enforced from that moment.
- [ ] **Open registration** — currently invite-only (`REGISTRATION_INVITE_CODE`).
- [ ] **Paid hosting.** Vercel and Railway hobby tiers are non-commercial by licence. This has to change before the first invoice.
- [ ] **A restore drill.** Backups exist and have never been restored under pressure. An untested backup is a hope.
- [ ] Legal review of the Terms and Privacy Policy, and the placeholders in them filled in.
- [ ] Trial-ending and welcome emails.
- [ ] A colour/material visualiser — the one feature competitors sell hardest that RoofMap doesn't have.
