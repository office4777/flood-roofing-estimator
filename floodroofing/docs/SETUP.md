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
   - URL: `https://floodroofing-backend.railway.app/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## How Updates Work (the whole point!)

When Claude (or you) makes a change:

1. Edit file on Claude's side
2. Push to GitHub: `git add . && git commit -m "fix" && git push`
3. Railway + Vercel auto-deploy in ~60 seconds
4. You refresh your browser — done ✅

No file copying. No server restarts. Works from any computer.

---

## Pricing Suggestions

- **Free trial:** 14 days (already coded)
- **Monthly:** NZD $49-99/month per user
- **Yearly:** NZD $490-990/year (save ~2 months)
- **Future:** Team plans, white-labelling for other roofing companies

---

## What's Already Built

✅ User registration + login  
✅ 14-day free trial  
✅ JWT authentication  
✅ Job saving (cloud, per user)  
✅ Stripe subscription checkout  
✅ Stripe customer portal (manage/cancel)  
✅ Claude AI proxy (keys server-side only)  
✅ Fergus API proxy  
✅ Satellite tile proxy  
✅ Subscription enforcement  
✅ Row-level security (users see only their data)  

## Still To Build (Phase 2)

- [ ] Login/register UI in the app
- [ ] Job list / dashboard
- [ ] Pricing page
- [ ] Email notifications (welcome, trial ending)
- [ ] Team/multi-seat plans
- [ ] White-label for other roofing companies
