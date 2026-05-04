# Flood Roofing Estimator

NZ roofing estimation SaaS — satellite imagery, AI analysis, sheet layout diagrams, Fergus integration.

## Quick Start

See `docs/SETUP.md` for full deployment instructions.

## Structure

```
frontend/     → Static HTML app (Vercel)
backend/      → Node.js API server (Railway)
docs/         → Setup guides, database schema
```

## Tech Stack

- Frontend: Vanilla HTML/JS/CSS (single file, no build step needed)
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Auth: Supabase Auth + JWT
- Payments: Stripe
- Hosting: Vercel (frontend) + Railway (backend)
- AI: Anthropic Claude API
- Integrations: Fergus job management API
