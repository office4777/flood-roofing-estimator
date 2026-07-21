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

## Growth — 100% Fergus (guys on the tools × real $/hr)

The Growth tab is built **only from Fergus** — no P&L, no Excel back-costing, and
no assumed crew counts. It answers: *for the guys actually logging hours on-site,
how much profit are they getting through now, and what would growth look like?*

Three real inputs, all from Fergus:
- **Guys on the tools** — everyone logging on-site hours in Fergus time entries
  (auto-counted on each sync; helpers/labourers included, not just lead roofers).
- **Hours/week** — the hours those guys actually logged, over the window Fergus
  exposes (÷ the span in weeks).
- **GP/hr and revenue/hr** — from **Fergus back-costing only** (`bcFergus` rows,
  last 12 months): gross profit and sales ÷ the hours the guys logged.

**Profit now** = hours/week × (52/12) × GP/hr — the gross profit the on-tools crew
generates per month (back-costing already nets off materials + on-site labour).
**Growth** simply scales the *real* hours: `scenario guys × hours-per-guy/week ×
GP/hr`. The "If you add guys" table shows Hrs/mo, Rev/mo, GP/mo and GP/yr per
headcount. Everything is editable if a sync window looks light — override the guys
count or hours/week — and an optional **office overhead $/mo** turns gross profit
into net (it stays 0, i.e. pure back-costing GP, until you enter one, so the tab
never touches your P&L).

## Average job value per month

Two cards work out the **average value of a job** each month, and both count
**jobs, not invoices** — because ~90% of jobs bill a 50% deposit + a 50% final,
counting invoices would double the job count.

- **Back Costing → Average job value** — back-costing **revenue ÷ number of jobs**
  per month. One back-costing row = one job (revenue = the greater of priced or
  claimed), and a job lands in the month ≥60% of its hours were worked (else its
  invoice month). Shows Month · Jobs · Revenue · Avg/job, newest first, with an
  all-time average.
- **P&L → Average job value** — the Xero **P&L revenue ÷ number of jobs** that
  month. The job count comes from Fergus back-costing (not the invoice count).
  Only months that have both a Xero P&L figure and a job count appear, so pull
  Xero history + sync Fergus to fill more months.

## Trend graphs (Workload + Back Costing)

Two more P&L-style line graphs (12 months, with a **3-mo rolling avg** toggle):

- **Workload → Forward workload trend** — backlog man-hours captured at the
  **start of each month** (the first time the app opens that month). History
  accrues from now on.
- **Back Costing → Monthly trend** — toggle **Labour hours** or **Avg GP/hr**
  (month GP ÷ month hours) per month. A job is counted in the month **≥60% of its
  hours were worked** (from time entries), not its invoice month — falling back to
  the invoice month for jobs without time-entry data yet (Fergus only exposes
  recent time entries, so this refines as months accrue).

## Workload — tick done + editable remaining hours

The Per-active-job table on the Workload tab has:
- A **✓ tickbox** per job — tick it to mark the job done; its hours drop out of the
  forward-workload total (and the Dashboard's). Done jobs sink to the bottom,
  greyed out.
- An **editable Remain h** field — defaults to priced − actual, but you can type
  the real remaining hours if the pricing was off (more or less left to do). The
  total and working-days use your edited value.

Both are saved on the device (`fwDone`, `fwRemOverride`) and survive re-syncs.

## P&L Trend line graph

The P&L tab opens with a **12-month line graph**. Two toggles:
- **$ trend** (Revenue / Gross profit / Net profit) or **% margins** (GP% / Opex% / NP%).
- **Monthly** or **3-mo rolling avg** (each point smoothed by the trailing 3 months).

It shows **9 months at a time** with a bold **$0 / 0% baseline** and **every month
labelled** (faint vertical gridlines). **Swipe ↔** to scroll back through the years
(3 months per swipe; ‹ › nudge a single month), back ~10 years. Tap **⤓ Load full
history (2018+)** once to backfill every month's P&L from Jan-2018 — it pulls only
the months not already cached (slow first run, fast after) so the trend has years
of data. Drawn as inline SVG from the Xero monthly P&L (no libraries).

## Overhead Recovery — auto values shown

The Monthly OPEX and Field-staff inputs default to "auto"; the resolved auto
value now shows beneath each (e.g. "auto = $74.3k/mo · 6-mo Xero avg", "auto = 8
· from crew") so you can see exactly what the rate is calculated from.

## Accordion layout (all tabs)

Every tab uses tap-to-expand accordion cards; the most-used card on each tab
stays open at the top:

- **Dashboard** — order is Forward Workflow → Cash at a glance → This Month →
  3-Month Rolling (all open); Last Month is collapsed. Each metric in **This
  Month** shows its **% change vs last month** (green/red, ▲/▼).
- **Back Costing** — Performance by Lead Roofer and All Back Costing open at the
  top; everything else collapsed. This Month also shows % vs last month.
- **Marketing** — This Month open (now includes a **Conversion** box: accepted ÷
  quotes sent); Quote Conversion, This Week and all the history strips collapsed.
- **Cash** — Cash at a glance open; Bank, the 13-week/6-month projections, the
  payment calendar and Settings collapsed.

Any card tagged `acc-card` is auto-wrapped into a `<details>` dropdown at load.

**How a job's lead roofer is decided:** whoever **logged the most hours** on the
job among your roofers (helpers/labourers like Luke or Aron don't count toward
"lead"). On each Fergus sync the app pulls **all** time entries from
`/timeEntries` — Fergus caps `pageSize` (200 errors; it auto-detects the biggest
it accepts, ≤50) and ignores per-job filtering, so they're paged through in
parallel and grouped by each entry's own `jobId`. It totals each person's hours
per job (`paidDuration`, or start→end time), matches names to your roofers, and
assigns the job to the top roofer. Jobs are tagged with their lead in the "All
Back Costing" list, which also has a **lead-roofer dropdown** filter.

**Important limitation:** Fergus's public API (`/timeEntries`) only exposes
roughly the **last week** of time entries and ignores job/date filters — the full
per-job labour history shown in the Fergus web UI isn't reachable through the
read-only token. So auto-assignment only covers jobs worked in the last few days.
For everything else, set the lead manually: in **All Back Costing**, each job row
has a small **lead-roofer dropdown** under the job name. Manual picks are saved on
the device (`leadOverride`) and override the auto value; the Performance by Lead
Roofer card and the lead filter use the effective lead (manual if set, else auto).

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

## Cash — "Deposit-funding gap" (was "Deposit cash position")

The red headline number is the **deposit-funding gap**, not a loss and not
money you're "behind". It answers a deliberately worst-case question: *if I had
to pay every current supplier bill AND buy 100% of the remaining materials for
all live jobs right now, using only the deposit cash I'm holding, how short am
I?* It **ignores every final and invoice you'll still collect**.

To keep that in perspective the popup now leads with a green **"Still to collect
— not counted in the gap"** card: uninvoiced priced work + Xero AR = the total
still coming in, and how many times over it covers the gap. The at-a-glance tile
and the reconciliation waterfall are relabelled **Deposit-funding gap**, and the
bottom line spells out the money still to collect. The real "will I run short?"
answer is the **13-week / 6-month whole-business forecast** lower down, which
*does* include the finals.

**Supplier bills still in your inbox (not yet in Xero):** the Reconciliation card
has an optional **"Supplier bills in your inbox, not yet in Xero"** input. Those
invoices are for materials you've *already bought*, so the app moves that amount
**out of "materials still to buy" and into A/P** — the gap only worsens if you've
been billed for **more** materials than the 50%-of-sale forecast already
reserved. Type a rough total to stress-test it; if it's within what the forecast
expected, the gap doesn't move.

## Cash forecast — how finish dates are estimated

The 13-week and 6-month cash forecasts estimate when each active job finishes by
laying jobs end-to-end against your crew capacity (`teams × size × hrs × 5`) and
walking forward: `finish ≈ today + cumulative remaining hours ÷ weekly capacity`.
Cash lands at `finish + payment lag`. Two realism buffers (both editable in Cash →
Settings):

- **Job overrun allowance (default 20%)** — pads every job's remaining hours,
  since jobs run over. This **cascades**: padding a job also pushes back the jobs
  queued behind it.
- **Finishing tail (default 3 days)** — small flashings almost always add a few
  days to *close* a job, so this is added to each job's own finish date but **not**
  to the crew's next job (they move on while waiting on flashings).

You can still override any job by tapping its real expected payment day in the
"Active jobs — expected payment date" calendar; a manual pick wins over the
estimate.

## Cash — "Due in" uses the quoted price, not Fergus's estimate

The Cash "at a glance" **Due in** buckets (and their drill-down tables) show
**uninvoiced money = the job's quoted/priced amount − what's already been
invoiced**. It deliberately ignores Fergus's `chargeableAmount` (the assumed
time-&-materials/costs figure Fergus shows when a job isn't fixed-price), so a
job with no real quote contributes **$0** rather than an estimated amount. Only
genuinely priced work shows as "still to collect". (Re-sync Fergus once so jobs
carry the quoted figure.)

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
