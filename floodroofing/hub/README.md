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
- **Back Costing → Monthly trend** — toggle **Labour hours** or **Avg GP/hr**,
  with a **basis** toggle:
  - **By work done that month (est)** *(default)* — each job's hours are split into
    the calendar months they were **actually logged** (from time entries), and
    every hour is valued at that job's GP/hr. **Unfinished jobs are estimated** —
    revenue × the average completed margin, spread over their priced hours — so a
    live month isn't understated. This answers "how productive were the guys in
    June, from the hours they logged in June". Jobs with no time-entry data yet
    fall back to their invoice month, so history stays populated.
  - **By completed jobs** — the simpler view: each finished job's whole GP + hours
    land in one month (where ≥60% of its hours were worked, else its invoice
    month). A month reflects whole jobs, not the hours worked that month.

  The Command Centre's **GP/hour by month** chart uses the *work-done (estimated)*
  basis.

## Workload — tick done + editable remaining hours

The Per-active-job table on the Workload tab has:
- A **✓ tickbox** per job — tick it to mark the job done; its hours drop out of the
  forward-workload total (and the Dashboard's). Done jobs sink to the bottom,
  greyed out.
- An **editable Remain h** field — defaults to priced − actual, but you can type
  the real remaining hours if the pricing was off (more or less left to do). The
  total and working-days use your edited value.

Both are saved on the device (`fwDone`, `fwRemOverride`) and survive re-syncs.

## Earned P&L — deposit-free, completion-basis (P&L tab)

The P&L tab now opens with a **custom "Earned" P&L** that fixes the biggest flaw
in the Xero P&L: Xero books the **50% deposit as revenue the moment you invoice
it**, so a month where you *sell* a lot but haven't *built* it looks fantastic —
even though almost none of that money is earned yet. This statement ignores that.

**The accounting model — cost-to-cost percentage-of-completion:**
- A customer **deposit is a liability** (Customer Deposits / Unearned Revenue), not
  sales. Nothing is booked to income just because you invoiced a deposit.
- Revenue is recognised by **cost-to-cost**:
  `% complete = costs to date ÷ total estimated cost`, then
  `earned revenue = % complete × contract price`.
  Recognised COGS = costs to date; recognised GP = earned revenue − costs to date.
- A **finished (100%-invoiced)** job recognises its full contract value; a job
  **still in progress recognises only its % that month — never the full sale**, even
  if a 50% deposit has been invoiced.
- Total estimated cost per live job = estimated materials (its priced materials, or
  **~50% of contract** if not priced — editable via *Cash → material share*) plus
  estimated labour, derived from the crew's real GP margin in back-costing. Costs to
  date use **each job's own cumulative labour + materials** from its Fergus
  `financialSummary` (`costsIncurred`) — the full spend on the job, read by going
  through every job (only if a job has no labour posted do we infer it from hours
  progress). This is *not* the ~1-week `/timeEntries` feed — that feed is only used
  for the weekly GP-per-hour rolling chart, never for this P&L.

So a pure 50%-deposit job with **no costs** on it is 0% complete → earns **$0**, and
the whole deposit sits as a liability; a job whose costs are half-spent earns ~50%
of the contract; a fully built job recognises 100% (with any un-invoiced balance
held as a contract asset).

The card shows:
- **Earned P&L statement** for the month — Recognised revenue, Materials, Labour,
  Other job costs, GP (and GP%), Overheads (from Xero), Net profit (and NP%).
- **Comparison to Xero** — how much of Xero's headline revenue this month was
  really **deposits / unearned** (i.e. the distortion you're removing).
- **Live-jobs WIP** tiles (the balance-sheet side): total **contract** value,
  **earned so far** (revenue recognised), **deposits held — liability** (billed but
  not yet earned = overbilled), and **work done, not billed** (contract asset / CIP
  = underbilled).
- **Earned-vs-Xero** 12-month chart so you can see the two revenue lines diverge.

Populated from **Fergus back-costing** (completed months, for the monthly statement)
+ **Forward Workload** (live jobs, for the WIP / balance-sheet calc), so re-sync
Back Costing and Workload to refresh it.

### Reconciliation — proof the two P&Ls tie out

Under the Earned-vs-Xero chart, a **Reconciliation** block proves the earned P&L and
Xero agree on the total for **completed jobs**: it shows *Completed jobs — earned* =
*…invoiced (= what Xero books)* — an **identical total** (this P&L spreads it over the
work, Xero splits it 50% deposit / 50% completion, but the sum is the same). The only
standing difference is on **live jobs**: *deposits held* (Xero booked, not yet earned)
minus *work done, not billed* (earned, not yet in Xero) — a net timing figure that
reverses to zero as each job finishes. That net is exactly the gap between the two
revenue lines on the chart.

### Earned P&L Trend — scroll + 3-mo rolling

A dedicated trend card (mirroring the Xero P&L Trend): **9 months at a time, swipe ↔**
to scroll back the years, ‹ › to nudge a month. Toggle **Earned vs Xero** (both
revenue lines, so you can watch the deposit-timing gap open and close) or
**Rev / GP / NP** (the earned statement over time), and **Monthly** vs **3-mo rolling
avg**. It reads off the month-allocated earned figures, so a job's revenue sits in the
months it was worked.

### Full dated labour history — ⤓ Load full labour history

`financialSummary` only gives each job's *cumulative* cost, but every time entry in
a job's **phase → Labour** section carries its own date. The **⤓ Load full labour
history (dated)** button at the bottom of the Earned P&L card walks every job (active
+ back-costed), pulls those dated entries from each phase, and buckets the hours by
real calendar month. This is the complete history — not the ~1-week `/timeEntries`
feed. Run it once after a Fergus sync.

With it loaded, the Earned P&L **spreads each job's earned revenue and costs across
the months its labour was actually logged** — a job worked Jan–Mar lands in Jan, Feb
and Mar weighted by hours, instead of the whole job dumping into one month. That's
what makes the **earned line smoother than Xero's** lumpy 50%-deposit / 50%-on-
completion recognition (the whole point of percentage-of-completion). GP-per-hour and
the back-costing trend also sit in the right months. Jobs with no dated hours fall
back to the whole job in its dominant/invoice month.

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

**"Every job a roofer was on" (≥10% of hours):** the lead-roofer dropdown in
**All Back Costing** no longer shows only the jobs someone *led* — pick a roofer
and it lists every job where they were the lead **or** logged **≥10% of the total
hours**. Each row shows that roofer's hours and share (e.g. `24h · 30%`).
Because Fergus only exposes ~1 week of time entries at a time, per-job roofer
hours are **accumulated across syncs** (`jobRooferHrs` / `jobRooferTot`), so
attribution gets more complete the longer the nightly sync runs. For older jobs
whose entries Fergus no longer serves, tap **+ crew** under the job name to add a
roofer by hand (saved as `crewOverride`); manual tags show as blue chips with an
`×` to remove. A roofer counts as "on" a job via lead, ≥10% auto share, or a
manual tag.

**Show/hide columns:** above the table, **▦ Columns** opens tick-boxes for every
column (all on by default; Job is locked on). **Roofer view** hides the money
columns (Sales, COGS, GP, GPM, GP/hr, NP, NP/hr) in one tap so you can show a
roofer their jobs + hours without the financials; **Show all** restores them. The
choice is saved per device (`bcColsHidden`).

## Monthly revenue/GP — spread by the job's FULL hours

Each month gets `job value × (hours that month ÷ the job's full hours)`. The denominator
is the job's **full** hours (`max(dated hours, total actual/estimated hours)`), never just
the hours captured in the dated labour history. This matters when the history is
incomplete: a 100-hour job with 20h in July and 80h in June, where only July's 20h were
captured, shows **20% in July** — not 100% crammed into July. Uncaptured months simply
don't show until their hours are loaded (conservative — never inflated). Open jobs are
capped the same way so they can never allocate more than 100% of their value. Run **⚙ →
Master refresh** (full labour history) for complete month-by-month coverage.

## Blown-out jobs — ⚠ OVER HRS

GP/hr and revenue/hr value each hour of work at the job's rate = (GP or sale) ÷ hours.
For a **completed** job that's ÷ actual hours; for an **open** job it's ÷ priced hours
(the landing estimate) — **except once the crew passes the priced hours** (blown out),
where it switches to ÷ **actual** hours so the real, lower profitability shows instead
of a flattered one. Blown-out rows (actual > priced) are flagged **⚠ OVER HRS** in red
in the GP-jobs modal so they're visible, never hidden.

## Cashflow forecast — inflow/outflow timing

The whole-business 13-week forecast (Cash tab + dashboard chart) times cash like this:
- **A/R (invoices already sent, unpaid)** — each lands **3 days after its due date**
  (the AR sync now captures each invoice's due date; falls back to ~10 days if absent).
- **Final invoices (unbilled remainder of active jobs)** — paid **N weeks after the
  job's scheduled finish** (default **3 weeks**, editable in Cash settings). The finish
  date is your **imported schedule** date when available (see below), otherwise the
  capacity-based estimate; a manual payment-day pick on the calendar always overrides.
- **Materials** (~50% of job revenue, still-to-buy) — ordered ~N weeks before a job
  finishes but paid on the **20th of the month *after* ordering** (supplier terms), and
  existing **A/P** lands on the **next 20th**.
- **Wages + overheads** — weekly burn from Xero (or your manual figure).

So it now factors in both A/R and A/P, on their real payment terms.

### Auto-reconcile bank vs Xero (no double-counting already-paid invoices)

The forecast's opening balance is the **live bank** total, which already includes money
that's landed. But Xero keeps listing an invoice as unpaid until it's reconciled — so a
payment that's already in the bank would be counted **twice** (once in the balance, once
as a future A/R inflow). `reconcileBank()` matches recent Akahu bank **credits** to unpaid
Xero invoices by near-exact amount (preferring a description/name match, one deposit per
invoice, last ~45 days) and marks those invoices as already received, so `renderCashflow`
**excludes them from future inflows**. It only runs when the opening balance IS the live
bank feed (`cfAutoRecon`, on by default; toggle in Cash → cashflow settings). It's a
best-guess match, so the cashflow detail window shows exactly what it matched under
**"Already in the bank — auto-reconciled"** (with the matched bank line), separate from
**"A/R still expected"**, and the weekly note tallies the reconciled amount. Reconciling in
Xero remains the permanent fix. (Supplier-side / A/P reconciliation needs per-bill data and
is a planned follow-up.)

### Cashflow detail window (tap the dashboard cashflow panel)

Tapping the **Cashflow forecast** panel on the dashboard opens a full breakdown
(`openCmdDetail('cf')`, fed by `window.__cfDetail`): a hero showing the lowest
projected balance and the week it hits, a KPI strip (opening cash, total in /
out over 13 weeks, weekly burn), a sign-coloured 13-week bar strip, the
**week-by-week projected balance table** (Open / In / Materials / A/P /
Wages+OH / Close, with the low week highlighted), and two "money coming in"
tables — **job finals** (each job, its finish date, the final-invoice amount
and the week it lands, tagged 📅 sched / picked / est by date source) and
**A/R already invoiced**. The **"Lands" cell on each job final is tappable** (✎):
`editJobPayDate(id)` opens the **"Active jobs — expected payment date" calendar as a
pop-up right there on the dashboard** (`openPayCal`), stacked over the forecast
detail and focused on that job (its row flashes and scrolls to its date). You pick
the real expected payment day without leaving the dashboard.

The pop-up is the **same calendar** as the one on the Cash tab — both render via
`renderCfCalendar(sched, finOv, hostId)` from the one shared store (`cfFinishOv`)
and the one shared schedule (`window.__cfSched`). Each row shows the **auto-forecast
date as a blue •** (remaining hours ÷ capacity + flashings tail + payment lag — the
exact date the cashflow forecast uses) and **your pick as a green ✓**. A change in
either place saves immediately and shows in both, and `pickPayDay` re-runs
`renderCashflow()` so the **forecast updates too** (and the open pop-up / forecast
detail refresh in place). A manual pick overrides the schedule/estimate; tap the
same day again to clear it.

## Command-centre — Expected A/P on the 20th

Supplier bills are paid on the **20th**, but Xero's A/P only shows bills that have been
*invoiced and processed* — so it understates what you'll actually pay. The **Expected A/P**
tile projects the next two 20ths (`window.__apExp`, built in `renderCashflow`):
- **Current A/P** (already invoiced in Xero) lands on the **very next 20th**.
- **Materials ordered on jobs but not yet invoiced/processed** — each active job's still-to-buy
  materials (`matPct × sale − aMat`, i.e. estimated total materials minus what's already
  recorded) — land on the **20th of the month after they're ordered** (order timing from the
  schedule: finish − materials-lead). Because `aMat` is subtracted, bills already in Xero A/P
  aren't double-counted.

The tile shows the next 20th's total (`Current A/P + that month's materials`) with the
following 20th in the sub-line (e.g. *"20 Aug $37k · then 20 Sep: $40k"*); if today is before
the 20th, "next" is this month's 20th. Tapping it opens a per-20th breakdown (current A/P +
each job's materials) with the double-count note.

Both assumptions are **tunable**: the popup has inline inputs for **materials % of a job's
value** (`cashDepPct`) and **order lead weeks** (`cfMatLead`) that recompute the projection
live (`setExpApCfg`), and both also sit together in **Cash → cashflow settings** (`cf-matpct`
mirrors the Cash-tab deposit/materials %).

## Command-centre live-bank tiles

The command centre shows tap-through tiles for your **everyday bank accounts** — the
`…-00`, `…-02` and `…-03` accounts (OPEX / Material / Sales) — with their live Akahu
balances. Tapping any of them opens **Bank accounts — live** (`openCmdDetail('bank')`),
which lists **every** connected account with its balance, marks which are in the
forecast, and totals "in forecast" vs "all accounts". The tiles are blank until the live
bank is synced on the Cash tab. Which suffixes appear is set by `CMD_BANK_SUFFIXES`.

## Mobile command-centre header

On narrow screens the header lays out cleanly: the **Command Centre** title + a compact
sync line on the first row, and the period toggle (Week/Month · This/Last) as its own
full-width row of even chips — no more cramped stacked cluster.

## Command-centre — Sales (work booked + revenue won) & 4-bar tiles

Every comparison tile now shows **four** bars: **This · Last · 3-avg · 6-avg** (the
6-period average sits next to the 3-period one; `curRoll` returns `roll`/`roll6`, buckets
widened to `off+7`). Two Sales tiles were added, both driven by quotes **accepted** in the
period (`acceptedAt`):
- **Work booked / wk|mo** — weeks of work won: each accepted quote's value ÷ the real
  revenue-per-hour (`fergusProd().revPerHr`) = booked labour hours, ÷ weekly capacity
  (`capacity().perDay×5`) — the same maths as Forward Workflow. Tapping it opens a
  **Work booked** detail listing each won quote with its $ and estimated weeks.
- **Revenue won / wk|mo** — sum of accepted-quote values that period (`countInBuckets(...).val`).

## Command-centre tiles — This · Last · 3-mo avg

The comparison tiles (Enquiries / Quotes / Conversion / GP) draw **three** vertical
bars: this period, the period before it (**Last**), and the rolling 3-period average.

## Dashboard layout & command-centre bars

Dashboard order: **Command Centre** (KPI tiles) → **Revenue · GP · OPEX · Net profit**
→ **Sales** (quotes sent + conversion) → **Marketing enquiries + Cashflow forecast**
(side by side; cashflow drawn as zero-baseline bars) → Cash at a glance → P&L. The
old full-width Forward Workflow box is removed — it's already a Command-Centre tile.
The command-centre comparison tiles (Enquiries / Quotes / Conversion / GP) now draw
**vertical bars** (This period vs rolling avg), matching the Revenue·GP bar look.

## Dashboard “Gross profit” card — Revenue · GP · OPEX · Net profit

The dashboard command-centre GP card shows **Revenue, Gross profit, OPEX and Net
profit** with two views (toggle chips): **Monthly bars** — a **smooth left/right
scroll** through 12 months (fixed left $-axis in $50k steps; opens at the latest
month) with **GP% / OPEX% / Net-profit% (of revenue), the month's avg GP/hr (GP ÷
hours), and total hours worked** printed under each month's bars. **Hours worked = all
hours the guys logged that month across every job.** Fergus's API doesn't expose dated
historical time entries (the per-phase labour endpoints 404 and the global
`/timeEntries` only holds ~1 week), so hours come from each job's **full** hours in its
`financialSummary`, placed in its work-month; the dated month-by-month split is only
used when it's ≥90% complete (otherwise the thin recent slice would under-count). GP/hr
= earned GP ÷ those hours. For exact by-day monthly hours, import the Business Activity
Report — that's the only source Fergus computes that way.

**Monthly GP/hr is consistent everywhere.** The dashboard card and the GP-jobs drill-down
now use the **same** denominator for the headline rate: total earned GP ÷ **every** hour
the guys were on the tools that month (`monthLoggedHrs`, i.e. the Business Activity Report
figure when imported). In the drill-down, each row still shows that job's own GP/hr (GP ÷
hours worked on it), but the **Total — GP ÷ all hours** row divides by all hours, and the
gap between job-logged hours and all hours is shown as a **Non-job hours** line
(toolbox / travel / yard) so the hours reconcile and the total rate isn't flattered.

### Import the Business Activity Report (exact hours)

⚙ → **Fergus Business Activity Report → Import report CSV**. Export the report from
Fergus (Reports → Business Activity, choose the months, Export CSV) and import it. The
hub parses it (a transposed CSV: rows = metrics, columns = months) and stores each
month's exact **Hours logged**, billable hours, revenue, cost of sales, GP, materials
and labour in `barReport`. `monthLoggedHrs` then returns the report's exact hours for
any covered month, falling back to the live estimate otherwise. Note: the report
export is manual — Fergus's API doesn't expose it. **Clear** reverts to the live
estimate.

### Import your job schedule (real cashflow finish dates)

⚙ → **Job schedule → Import schedule CSV**. Export your active-jobs schedule from Excel
(File → Save As → CSV). The hub auto-detects the columns by header keyword — a **job
number** (`Job No` / `Job #` / …), a **site/address** (`Site` / `Address` / `Client` /
…), and a **finish date** (`Finish` / `Completion` / `Due` / `Scheduled` / `Date` / …).
If no date header is found it falls back to whichever column parses as dates most often.
Dates are flexible: ISO, `D/M/Y` (NZ day-first), or `4-Nov` / `30 Jul` / `Nov 4` — a
missing year is inferred (a date more than ~3 months in the past rolls to next year,
since schedule dates are finishes). **Only finish dates within the next ~3 months are
used** (`schedHorizonMs()`): anything further out is treated as tentative and dropped —
those jobs fall back to the capacity estimate. This is enforced both at import (beyond-3-
month rows are skipped and counted) and at lookup (`schedFinishFor` ignores stored dates
past the horizon, so an older import self-corrects without re-importing). Both importers
parse **quoted CSV fields**
(`parseCSV`), so addresses containing commas are handled. Each job is matched to the
forecast **by job number first, then by address substring**, and its finish date drives
the final-invoice, materials and A/R timing (§ *Cashflow forecast*). A 📅 marks
schedule-sourced jobs on the payment calendar and in the cashflow detail window. Manual
payment-day picks still override; **Clear** reverts to the capacity estimate. Stored in
`schedFinish` and included in the JSON backup.

If your schedule is a **colour-coded Gantt** (e.g. the Flood Roofing Master File, where
each work-day is a coloured cell and dates run along the top row), a flat CSV export
loses the colours — so send the workbook and the finish dates are read from it directly:
the finish is the end of each job's last real contiguous work block, ignoring the shared
"current fortnight" background band and isolated tentative marks, with the column dates
anchored off the header row. That produces the importable CSV above.

### Automatic weekly master refresh

⚙ → Sync has a **"Auto-run a master refresh weekly"** toggle (on by default). A closed
web page can't self-schedule, so this fires a full master refresh the first time you
open the hub each week (≥7 days since the last one) — hands-off, non-blocking, and it
stamps `masterSyncMs` so it runs at most once a week., plus each bar's
**$ value in white above the bar (angled, rounded to the nearest $1000, e.g. 56k)** — and **3-mo rolling trend**, a smooth line
of each series over 12 months (each point = trailing-3-month average). The bar view shows **~6 months at a
time** with **larger fonts and a taller plot** (columns sized to fit; scroll for the rest). The other
command-centre charts (Sales quotes/conversion, Marketing enquiries, Cashflow) keep their compact
fit-width look but gain **smooth left/right scrolling** when the screen is too narrow to fit them.
Revenue &amp; GP are *earned from Fergus* by work done that month (each hour
valued at its job's real/estimated GP/hr); OPEX is your Xero operating overhead; and
**Net profit = GP − OPEX** (drawn below the $0 line when a month runs at a loss). The
y-axis is in **$50k increments**. `groupBarChart` takes an optional `{step}` for the
fixed axis and now supports negative bars; the GP-jobs modal chart uses the same
four series and axis so the two match.

## Help popups — tiny “?” buttons

The long explanatory paragraphs that used to sit under cards and settings fields are
gone. In their place, a small **?** next to a card title or field label opens a short
popup with the explanation (a `HELP` registry keyed by topic → `showHelp('key')`), so
the screens stay clean but the “why/how” is one tap away. Covered: the Earned P&L,
its reconciliation and trend, the Xero P&L trend, average job value (both), data
health, AR, supplier bills, the weekly cashflow + payment calendar, overrun/tail
allowances, and the wages/overhead/account-code settings.

## Team mode — shared dashboard for the office

By default the Hub is single-user (all data in this browser's localStorage). **Team
mode** turns it into a shared company dashboard: everyone signs in and sees the same
data + settings, kept fresh by a nightly auto-sync. It's opt-in and completely
inert unless a Team API URL is set — the single-user path is byte-for-byte unchanged.

- **Backend:** a tiny separate Vercel project (`floodroofing/hub-api`) — a shared
  state store (Upstash Redis, one JSON blob) + a shared login. Bearer-token auth (no
  cookies) so it works whether the Hub is a local file or hosted. See its README to
  deploy (~10 min).
- **Turn on:** ⚙ → **Team mode** → paste the API URL → **Connect & sign in** (a
  username/password from the API's `HUB_USERS`). A boot-time bootstrap pulls the
  shared state into localStorage before the app reads it, then the app runs normally;
  every `S.set` debounce-pushes the state back (`teamPush`/`__teamFlush`). Device-only
  keys (`hubApiUrl`, `hubToken`) never leave the device.
- **Nightly auto-sync:** `.github/workflows/hub-nightly-sync.yml` drives the real Hub
  headless (`window.__teamHeadlessSync`) and pushes fresh data — so the dashboard is
  current even if nobody opens the app. It reuses all the in-app sync/compute logic
  rather than re-implementing it server-side.
- **Sign out / standalone:** ⚙ → Team mode → Sign out, or clear the API URL to go
  back to standalone.

## Two refresh modes — everyday vs master

**All sync + backup lives in ⚙ (top-right)** — one place. Tap the gear to open
**Settings & sync**; the two refresh buttons sit at the top, backup/import below.
Every tab that used to have its own sync button now just points to ⚙, so there's a
single source of truth for "get fresh data". (The one exception is the optional
**live-bank (Akahu)** feed, which stays on the Cash tab as it's a separate
integration with its own login.)

### Live bank feed (Akahu) — per-account picker

The **Bank — live** card on the Cash tab reads balances + recent transactions from
**Akahu** via the proxy (set `AKAHU_APP_TOKEN` + `AKAHU_USER_TOKEN` on the proxy to
switch it on). Each connected account shows its own balance and a **tap-to-toggle** —
only the ticked accounts are summed into **"Total cash now"**, which becomes the
forecast's opening balance (`window.__bankTotal`). Choices are stored per account in
`bankIncl` (in the JSON backup). **Default:** every account counts *except* ones whose
name contains "tax" (e.g. `TAX`, `Income TAX saving`) — those are set-asides for IRD, so
counting them would overstate spendable cash. The card header shows "N of M accounts in
forecast" and the full total across every account, so you always see the whole position
too. `bankIncluded()` decides inclusion (explicit choice wins over the name default);
`toggleBankAcct()` flips one and re-runs the forecast.

- **⟳ Refresh (recent + changed)** — the everyday one, a few seconds. Pulls the
  active workload, recent completed jobs for back-costing, the current Xero P&L
  months, **cash (Xero balance sheet + A/R + A/P)**, and marketing. For dated labour
  it only re-pulls jobs whose Fergus `lastModified` changed since last time (i.e.
  jobs someone logged hours on) — finished jobs from months ago are skipped.
- **⤓ Master refresh (all history)** — the full backfill, a few minutes. Walks
  **every job (all statuses)**: financialSummary + full dated labour, back-costs all
  completed jobs, and loads the Xero P&L back to **2018**. Run it once at setup, then
  ~monthly (the button shows when it last ran).

The everyday refresh stays fast because a per-job cache (`jobLabourSync`, keyed by
`lastModified`) records which jobs have already been pulled — master fills it for
everything, and Refresh only touches what actually moved. So you never re-pull
hundreds of finished jobs every morning.

**Keeping your data across app updates.** All synced data lives in this device's
localStorage, tied to this exact file — so opening a *new* copy of the HTML starts
empty. To carry a master refresh forward without re-syncing: tap **⤓ Export backup**
(on the dashboard or in ⚙) before switching, open the new file, then **⤒ Import
backup**. The backup is every `fr3_` key — back-costing, dated labour, Xero months,
jobs, settings — so everything comes straight back.

**Running in the background / on your phone.** The progress bar is a thin strip at
the top, not a blocking screen — so you can move between tabs and use the app while
a sync runs. Both refreshes request a **screen Wake Lock**, so if you just set the
phone down (app open) it won't sleep and stall the sync. A web page *cannot* keep
running once you switch to another app or lock the screen — mobile browsers suspend
background tabs, and that's unavoidable for a single HTML file. To make that safe,
**Master refresh checkpoints every few jobs** (persisting `jobMonthHrs` +
`jobLabourSync` as it goes) and skips anything already pulled, so if it's
interrupted you just tap **Master refresh** again and it resumes where it stopped —
you can complete the big backfill in chunks around your day.

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
and fading out when the sync finishes. A full **Refresh** now pulls Fergus
workload, Xero P&L **and marketing** (enquiries + quotes), so the dashboard's
enquiry/quote/conversion tiles stay current — marketing is no longer only updated
from the Mktg tab. On open, marketing also auto-refreshes if it's more than ~6h
old, and the Command Centre header shows the Fergus · Xero · Mktg sync times so
you can spot stale data (e.g. "this week = 0" just means marketing hasn't been
synced since the enquiries came in — hit Refresh).

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

## Command Centre (top of the Dashboard)

A single-screen summary at the top of the Dashboard — the whole business in five
seconds, and it shines on a desktop browser (stacks on the phone). Six
tiles that each show a **mini bar comparison** — the selected period vs its
**rolling average** — for **Enquiries**, **Quotes sent**, **Conversion**, and
**GP** (with its avg GP/hr), plus value tiles for **Accounts receivable**,
**Accounts payable**, and **Forward workflow** (weeks booked). A live **alerts
feed** sits underneath (cash forecast dipping negative, gap exceeding what you're
owed, under 3 weeks of work booked, GP margin under 20%, GP/hr sliding >10%).

**Every tile is clickable** — it opens a detail popup listing the related jobs:
enquiries/quotes for the selected period, the GP jobs behind the figure, the
unpaid invoices behind Accounts receivable, the supplier codes behind Accounts
payable, and the active jobs behind Forward workflow.

Two toggles in the header (stacked for clarity) drive the whole dashboard — tiles
**and** charts:
- **Week / Month** — weekly compares against a **3-week** rolling average, monthly
  against a **3-month** one.
- **This / Last** — compare the current period, or step back to the previous one.

Every chart has a **hover tooltip** — point at any bar or line and a card shows
that period's exact value(s) and the rolling average.

Below the tiles a **Performance** section — four full-width panels, inline
SVG/HTML, no libraries, theme-aware. Each of the first three has a
**Weekly / Monthly** toggle; every chart shows the raw value as bars with its
**rolling-average** as an overlaid line (weekly → 3-week rolling avg, monthly →
3-month rolling avg):

1. **Marketing — enquiries** per week/month + rolling average.
2. **Sales — quotes sent & conversion** — two charts: quotes sent per period, and
   the conversion rate (won ÷ sent) per period, each with its rolling average.
3. **Gross profit** per period + rolling average. Monthly GP is the back-costed
   work-done figure; weekly GP is estimated as the hours the guys logged that week
   × GP/hr from completed back-costing (weekly builds up as time entries accrue).
4. **Cashflow forecast — next 13 weeks** (line, all accounts, with a $0 baseline).

It all reuses the existing calculations, so it's a view, not a second set of
numbers. (The Profit & Loss trend, GP/hr, revenue-by-type, lead-roofer
leaderboard and money-to-collect tables still live on the P&L and Back Costing
tabs.)

## Backups, snapshots & data health

- **Backup (⚙ Connect → Data & backup):** everything lives in this browser only,
  so **Export a backup** to a JSON file regularly (or to move to another
  phone/PC), and **Import** to restore. This is your safety net.
- **Weekly KPI snapshots:** the full KPI set is saved once per week, so the
  Command Centre's week-on-week deltas and future trends have real depth.
- **Data health (P&L tab):** Fergus back-costing revenue vs Xero P&L revenue,
  trailing-12-month totals plus per-month variance — a big gap (amber/red) flags
  missed invoices or mis-coded jobs.

## Growth & productivity — rolling and completed-only

The Growth tab's hours/week now **averages the last 8 weeks** of logged hours
(accumulated across syncs), so one quiet or flat-out week doesn't swing it. GP/hr
and revenue/hr come from **completed jobs only** — an in-progress job books full
revenue on partial cost, which would overstate productivity. Marketing shows a
**$-weighted conversion** (accepted $ ÷ quoted $) alongside the count, and the
Cash materials card shows the **material % by job type** learned from
back-costing as guidance for the deposit %.

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
