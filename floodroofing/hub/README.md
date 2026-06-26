# Flood Roofing — Operations Hub

Two single-file apps (open in a browser — no build step):

- **`FloodRoofing_Hub_v6.html`** — the full desktop hub: schedule, to-dos, email
  triage, job board, back costing, quotes, marketing/ROI, Xero P&L, invoicing,
  crew & leave.
- **`FloodRoofing_Financials.html`** — a lean **mobile** app: Dashboard, Forward
  Workload, Back Costing (incl. ModSpace), Xero P&L. Built for the phone.

## ModSpace back costing (mobile app)

A card at the top of the **Back Costing** tab, scoped to ModSpace jobs only. It
filters the back-costing rows down to the jobs whose customer/site name (or
brief) mentions ModSpace (`modspace` / `mod space` / `mod-space`) and shows:

- **Each job** — one card per ModSpace job (completed jobs first, then in-progress;
  each sorted by revenue), with a GP-margin bar, a status chip (Completed /
  In progress) and: revenue, material cost ($ and % of revenue), labour cost
  ($ and %), gross profit ($ and %), GP/hr, and actual hours.
- **All combined** — one total across every ModSpace job: revenue, material
  cost ($/%), labour cost ($/%), gross profit ($/%) and GP/hour.

Includes **every Active + Completed** ModSpace job (not just finished ones), so
in-progress jobs show too — flagged "In progress" because their revenue is the
full contract while costs are only what's booked so far (GP looks high until the
job finishes). Quote-sent / to-price / archived jobs are excluded (no actuals to
back-cost). Tap **⟳ Sync jobs from Fergus** to refresh.

## Sync progress bar

A thin 0–100% progress bar lives in the header on **every** page. It appears
whenever a Fergus/Xero sync runs (Refresh, or any "Sync" button) and shows the
live phase + count (e.g. "Fergus jobs 21/50", "Xero P&L 8/12"), filling to 100%
and fading out when the sync finishes. A full Refresh splits the bar 0–65% for
Fergus and 65–100% for Xero.

## Forward Workload (mobile app)

Totals the **remaining labour hours** on Fergus **active/accepted** jobs
(priced/quoted hours − actual labour booked, floored at 0), then converts that
to working days using your crew: `days = remaining hours ÷ (teams × guys-per-team
× hours-per-day)` (defaults 4 × 2 × 8 = 64 h/day). Teams/size/hours are editable
in the app. Jobs with no priced hours in Fergus count as 0 and are flagged.

## Fergus on mobile (what changed in v6)

Earlier versions could only reach Fergus through a desktop PowerShell proxy on
`localhost`, so **Fergus sync didn't work on a phone**. v6 reaches Fergus
through a small hosted proxy instead, which works on any device.

Setup (one-time):

1. Deploy the proxy — see [`../fergus-proxy/README.md`](../fergus-proxy/README.md).
   It becomes its own Vercel project (`fergus-proxy`) and does **not** touch the
   RoofMap estimator or the toolbox.
2. In the Hub: **Full Schedule → ⚙ Fergus Setup** → paste the proxy URL and the
   `PROXY_SECRET` you set on the proxy.
3. Tap **⟳ Sync Accepted Jobs**.

## Security

No API keys are stored in this file. The Fergus key lives on the proxy
(server-side). The proxy URL/secret and any Xero credentials are entered in the
app and kept in the browser's local storage only — safe to commit and share.
