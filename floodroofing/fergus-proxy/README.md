# Fergus Proxy (for the Operations Hub)

A tiny, **standalone** serverless function that lets the Operations Hub read
from Fergus on **any device — including a phone**.

It is completely separate from the RoofMap estimator and the toolbox. Deploying
it creates its **own** Vercel project called `fergus-proxy`. It does **not**
touch `flood-roofing-estimator` or `flood-roofing-toolbox`.

## Why it's needed

The Hub is a single HTML file. A phone browser can't call the Fergus API
directly (blocked by CORS) and can't run the desktop PowerShell proxy. This
function sits in the middle: the Hub calls it, it adds your Fergus key
(kept here on the server, never in the file) and forwards the request to
Fergus.

It is locked down: **GET only**, upstream pinned to `api.fergus.com`, and every
request must carry a shared secret.

## One-time deploy (≈3 minutes, from your Windows PC)

1. Install Node.js if you don't have it: https://nodejs.org (LTS).
2. Open **PowerShell** in this `fergus-proxy` folder and run:

   ```powershell
   npx vercel deploy --prod
   ```

   - When asked **"Set up and deploy?"** → Yes
   - **Scope** → your `office4777's projects` team
   - **Link to existing project?** → **No** (this is important — it makes a new
     project called `fergus-proxy`)
   - Accept the defaults for the rest.

3. Add the two secrets, then redeploy so they take effect:

   ```powershell
   npx vercel env add FERGUS_API_KEY production
   # paste your Fergus Personal Access Token (fergPAT_...)

   npx vercel env add PROXY_SECRET production
   # paste any long random string — e.g. a password-manager-generated one.
   # Keep a copy: you'll paste this same value into the Hub.

   npx vercel deploy --prod
   ```

4. Copy the **Production URL** it prints (looks like
   `https://fergus-proxy-xxxx.vercel.app`).

## Wire it into the Hub

Open the Hub, go to **Full Schedule**, tap **⚙ Fergus Setup**, and paste:

- **Proxy URL** → the production URL from step 4
- **Proxy secret** → the same `PROXY_SECRET` value you set above

Then tap **⟳ Sync Accepted Jobs**. It now works on your phone.

## Environment variables

| Name             | Value                                                        |
| ---------------- | ----------------------------------------------------------- |
| `FERGUS_API_KEY` | Your Fergus Personal Access Token (`fergPAT_...`)            |
| `PROXY_SECRET`   | Any long random string; the same value goes into the Hub    |

## Test it

```
https://YOUR-PROXY-URL/api/fergus/users/me
```

Without the secret header you should get `401 Bad or missing X-Proxy-Secret` —
that confirms it's locked down and running.
