# Flood Roofing — Operations Hub

Two single-file apps (open in a browser — no build step):

- **`FloodRoofing_Hub_v6.html`** — the full desktop hub: schedule, to-dos, email
  triage, job board, back costing, quotes, marketing/ROI, Xero P&L, invoicing,
  crew & leave.
- **`FloodRoofing_Financials.html`** — a lean **mobile** app: Dashboard, Forward
  Workload, ModSpace Backlog, Back Costing, Xero P&L. Built for the phone.

## ModSpace Backlog (mobile app)

A ModSpace-only view of the backlog. It filters the synced **active** Fergus
jobs down to the ones whose customer or site name mentions ModSpace
(`modspace` / `mod space` / `mod-space`) and shows:

- **All together** — one combined summary: number of ModSpace jobs in the
  backlog, total remaining man-hours, the forward workload in working days (same
  crew capacity as the Workload tab), total contract value, invoiced-so-far,
  still-to-invoice, and materials still to buy.
- **Each job** — a card per job (sorted by biggest backlog first) with a
  progress bar (invoiced %), its backlog hours, ≈ days, priced/actual hours,
  contract value, invoiced, still to invoice, and materials still to buy.

Fully-invoiced ModSpace jobs are treated as done and excluded from the backlog
(noted at the bottom), same rule as the Workload tab. Data comes from the same
Fergus sync — tap **⟳ Sync active jobs** here or on the Workload tab.

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
