# Flood Roofing — Operations Hub

Two single-file apps (open in a browser — no build step):

- **`FloodRoofing_Hub_v6.html`** — the full desktop hub: schedule, to-dos, email
  triage, job board, back costing, quotes, marketing/ROI, Xero P&L, invoicing,
  crew & leave.
- **`FloodRoofing_Financials.html`** — a lean **mobile** app: Dashboard, Forward
  Workload, Back Costing (incl. ModSpace + Lead Roofer performance), Xero P&L.
  Built for the phone.

## Back Costing — revenue rule & colours

- **Revenue** for every job = the **greater of the priced/quoted amount and the
  claimed/invoiced amount**. So jobs with invoiced extras that were never quoted
  (claimed > priced) show the higher claimed figure as revenue; un-invoiced jobs
  fall back to the price.
- **Row colours** in the All Back Costing list are by **net profit**: green when
  NP is positive, red when NP is negative.

## Back Costing — by job type

The "Back-costing by job type" card (Pole Sheds, Re-Roof's, Re-Roof & Gutter,
Gutter only, Other) now shows a **Date** column for every job and lists each
group **most-recent first**.

## Performance by Lead Roofer (mobile app)

A card in the Back Costing tab that rolls up back-costing by lead roofer. **Swipe
left/right** (or use the ‹ › arrows / dots) to move between roofers
(Nick, Ethan, Axel, Justin, Jacob). For the selected roofer it shows the latest
month's combined **revenue, GP $ & %, GP/hr**, a **rolling 3-month GP/hr**, and a
per-month table (newest first) with each month's GP/hr and its trailing
3-month GP/hr.

**GP/hr** = a job's GP divided by the **total hours logged on that job by
everyone** (not just the lead's hours, and regardless of which month they were
entered) — summed across the roofer's jobs in the month.

The Back Costing tab is laid out as an accordion: **Performance by Lead Roofer**
and **All Back Costing** are open at the top; everything else (ModSpace, 12-Month
History, Materials %, This/Last Month, 3-Month Rolling, Overhead Recovery,
by-job-type, Excel↔Fergus, Invoice diagnostic) is a collapsed card you tap to
expand.

**How a job's lead roofer is decided:** whoever **logged the most hours** on the
job (others may help a little). On each Fergus sync the app pulls all time
entries from `/timeEntries` (Fergus ignores per-job filtering, so they're fetched
in bulk and grouped by each entry's own `jobId`), totals each person's hours per
job (using `paidDuration`, or start→end time), matches the logged names to your
roofers, and assigns the job to the top one. Jobs are tagged with their lead
roofer in the "All Back Costing" list, which also has a **lead-roofer dropdown**
to filter to one roofer (or "Unassigned").

If roofer figures don't appear, open **🔍 Debug a job** in the ModSpace card,
enter a job number, and tap Check — it prints which time endpoint worked, the
names + hours it found, and the matched roofers, so the mapping can be confirmed.

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

Figures come from each job's Fergus **Financial Summary** (the
`/jobs/{id}/financialSummary` endpoint — the same data as the "Financial
Summary" tab in Fergus): revenue = Billable/Priced Amount, material = Current
Material Costs, labour = Current Labour Costs, hours = Logged/Incurred Hours,
GP = revenue − total current costs. The extractor is shape-tolerant (handles
lump-sum quotes and nested `{value}` fields), and a job whose summary fails to
load is tagged "No data" (with a one-time retry on sync) rather than shown as
$0. The card's **🔍 Debug a job** box dumps the raw figures for any job number.

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
