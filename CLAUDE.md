# RoofMap (flood-roofing-estimator)

RoofMap is a production SaaS for NZ roofing companies (roofmap.co.nz), run by
Flood Roofing Ltd in Whangarei. Real customers use it daily — treat every ship
accordingly.

## Layout

- `floodroofing/frontend/app.html` — the app: one very large HTML file
  (CSS + markup + JS, ~62k lines). Edit it with careful, count-asserted
  replacements; when scripting edits with Python, always read/write with
  `encoding='utf-8', errors='surrogateescape'` (the file contains emoji).
  Syntax-check after scripted edits by feeding each inline `<script>` to
  `new Function()` — a stray quote in a 62k-line file is otherwise found by
  a customer.
- `floodroofing/frontend/sheet-plan.js` — the sheet engine (plain global
  script loaded last, not a module): `renderRoofSheetPlan` → per-roof
  `_renderRoofSheetPlanInner`, the ridge-claim takeoff
  (`_ridgeClaimSections`), the `_sheetsAcross` rounding rule and the
  section/group data the Job Pack reads (`window._lastSheetSections`,
  `window._lastSheetCounts.groups`).
- `floodroofing/frontend/sw.js` — service worker, network-first with a 5 s
  timeout, so a reload picks up a new build. "Still seeing the old numbers"
  means the app was not reloaded, not that the ship failed.
- `floodroofing/backend/server.js` — the entire Express backend, including the
  idempotent boot migration DDL list (search `create table if not exists`).
  New columns are added there as `alter table ... add column if not exists`.
- `floodroofing/tests/*.mjs` — self-contained suites. `run.mjs` runs them all
  (293 as of 2026-10-30 — 66 in its `API` list, 227 in `UI` — four at a time,
  plus the sheet-layout gate on a full run; `JOBS=1` for one at a time), or
  one by name: `node floodroofing/tests/run.mjs inboxui`, or a whole half:
  `run.mjs api` is the exact command CI's Backend job runs, 66 suites in
  about 44 seconds, and it is what to run before ANY server ship. A NEW
  suite must be added to the `API` or `UI` list in `run.mjs` or it never
  runs — and every suite on disk is in one of them today, which is worth
  re-checking rather than assuming. Pipe the runner through `tail` and
  you get tail's exit code, not the runner's — use `set -o pipefail`.
  Run the full gate in the background and never `pkill -f tests/run.mjs`
  from the same shell (it kills its own command).
- `floodroofing/docs/ci_sheet_tests.js` — the sheet-layout gate (37 shapes;
  Big-L expects 66 strips). Runs alone in ~40 s and has its own GitHub
  workflow, so run it first after any engine change.
- `floodroofing/tests/fakepgrst.mjs` — in-process fake PostgREST. No DDL
  defaults (set every column explicitly on insert), no `in` filter (returns
  all rows), DELETE returns deleted rows. Failure seams on the db object:
  `__fail500 = 'table'` (+ `__failMsg` for the error text), `__failInsert`,
  `__missing = ['column']`.
- Test fixtures worth knowing: `fixtures-report41.json` is the five-roof job
  behind reports 51 and 52; `fixtures-report50.json`, `fixtures-doublel.json`
  and `fixtures-tee.json` are the hip-and-valley shapes the owner counted by
  hand. `tools/sheet-shots.mjs` renders any fixture to PNGs of the layout,
  the calc check and the cut list — send those to the owner BEFORE the gate
  when the counts are in question.
- `floodroofing/hub/FloodRoofing_Financials.html` — the owner's Finance Hub
  (the phone app: Command Centre, P&L strips, back costing, cash), a second
  single-file app with its own README. It is served by GitHub Pages straight
  from `main` (a "pages build and deployment" run follows every push), NOT
  through Vercel — and the Tests workflow ignores `floodroofing/hub/**`, so a
  hub-only push to main never triggers the promote; run the promote by hand
  (`workflow_dispatch`) if production needs to carry it. Xero figures live in
  localStorage under `fr3_xeroMonthly`, which is how a headless screenshot
  gets seeded. The Dashboard's bar-graph panels were removed 2026-09-20.
  THE HUB WEARS ROOFMAP'S LOOK (2026-10-24, the owner: "fully redesign ... look like roofmaps colours ...
  phone first ... a more expansive computer version (auto detect)"). It is a re-skin only: no sync, sum or id
  changed. Light by default (`fr3_look`, device-only); 1024 px and wider gets a sidebar (`html.is-desktop`);
  the forward workflow is a card on the Command Centre (`fwHeroHtml`), with the By Month strip (`.d-month`) straight
  under it on both layouts (2026-10-25); tiles are stat cards (`.kpi.sc`,
  `_scIco`, `_scSpark`); `mb()` carries a marker on every tab. Back Cost opens on its 12-Month History strip (`#bc-strip-card`, 2026-10-25, an open card,
  no longer a closed fold) with All Back Costing (2026-10-24) the next card, its year / type / roofer / search and job count folded
  behind a Filter button beside Show all · Roofer view (`toggleBcFilter`, `bcFilterSync` counts what is on, 2026-10-25), grouped by month (`_bcTot`, the foot's own arithmetic), the two newest open and the rest behind a "See previous month" button under the last one shown, one more a press (`bcMoreMonths`, `_bcMonthsShown`, back to two on a change of filter, 2026-10-25): a phone gets `#bc-list`, two lines per
  job (number + `_bcShortAddr`, then the figures) and a total closing each month; a computer keeps the table with a
  band and a subtotal per month; on a phone each month fits one screen (`_bcFitMonth`), its jobs scrolling between band and total. The P&L tab OPENS on a crew strip
  (2026-10-25, `renderCrewStrip`, `#pl-crew`): one card a month from Jul 2024 with the crew on the tools above the Xero
  figures and Rev / NP per person. The "Flood Roofing P&L — earned" card (the earned month, work in progress,
  earned vs Xero and the reconciliation) was taken off the P&L tab on 2026-10-25 at the owner's ask; `renderEarnedPL`
  returns on its missing `#epl-body`, and the Earned P&L Trend card below it stays. Under Last 12 Months (2026-10-25): Rolling 3-month and 6-month averages (`renderPlRolling`, the Command Centre's own rolling cards, `#pl-roll3`/`#pl-roll6`), then P&L by year (`renderPlYears`, `#pl-years`) — one swipeable card a financial year, Xero's April – March named for the year it ends in (`plFyOf`, `plFyMonths`), the year's totals plus an average a month, and on the year still running a RUN-RATE (`plRunRate`, `.py-rr`: the complete months so far plus their average for each month left, the month in progress counted as one left, beside the year before); Average job value is a closed fold (`#pl-avgjob-acc`). Money a million and up reads in millions across the hub (`fmtM` inside `fmtK`: $1.064m, $2.32m, $1m — never $1064k). The Workload tab (2026-10-25) carries Per active job straight under the hero
  (`#work-jobs-card`); a phone gets `#work-list`, one row a job with no sideways scroll — tick, job number over
  `_bcShortAddr`, priced, actual, the editable Remain h and the cross-out; a tap on the job number opens the customer, the whole address, the job title and the job's revenue under it (`wkToggleOpen`, `_wkMoreHtml`; the sync keeps `client`/`site`/`title` on each job, an older one is split out of its name) — and a computer keeps `#work-tbl`. `CREW_SEED` is the owner's three weekly pay-run exports (July–June years, newest
  run first, UNDATED — each run dated by lining its hours up with the timesheet export, exact on Sep 2024 – Mar 2025): every
  week 26 Aug 2024 – 16 Oct 2026, a person counted in a month when paid a day's hours in it, office staff left
  out (the owner, Paula, Hannah, Chris Mitchell, Matthew Anderson-Smith — "never on the tools"; Ethan from 27 Jul 2026, into project management); counts and hours only, no names (the hub is a public page). Tapping the number types a month in (`crewEdit`,
  `fr3_crewMonthly`, which wins; blank = back to the payroll figure). Under it, CREWS (2026-10-25, `CREW_TEAMS`, `crewTeamsFor`, `crewTeamsEdit`): the
  team leaders on the tools that month by the same rule — four now (the owner: "usually we have a two-man crew, so a
  leader and an apprentice"), each counted in every month he was paid a day, the first crew handed from one leader to
  the next in the week of 27 Jul 2026 so it counts once, and a fifth leader on the tools Sep 2024 – May 2026; plus a
  CONTRACT leader never on the payroll, added by hand from his invoices (31 Oct 2024, Nov 2024, 28 Apr – 19 Jun 2025:
  +1 on the tools, his invoiced hours and +1 crew in those five months, noted 'incl. a contract leader'); 1 crew in
  Aug 2024, 2 from Sep 2024 (3 in Oct–Nov 2024), 2 in Dec 2024 – Apr 2025 (3 in Apr), 3 from May 2025 (4 in May–Jun),
  4 from Jan 2026, 5 in May 2026 (one leader starting as another left), 4 since — with people a crew and Rev / NP per crew; typed crews ride
  in the same `fr3_crewMonthly` entry as `c` and never touch the head count.
  THE GROWTH TAB IS THE P&L OVER THE CREWS (2026-10-25, the owner: "fully recalculate the growth tab to suit the
  actual numbers of my guys on the tools for the P&L months", then "it's more important to work it out per crew
  instead of per guy"). It was 100% Fergus (back-costing $ per LOGGED hour x the hours logged). Now
  `growthMonths()` = complete months with a Xero revenue, a head count AND a crew count (never the current month,
  never a `part` month), `growthModel` sums the window (`growthCfg.win`: 3 / 6 / 12 / all, default 12) and divides by
  the CREW-months: revenue, GP and NP a crew a month (weighted), with guys a crew, revenue and GP an hour PAID and
  revenue a guy beside them. The month table (`#g-mtbl`, fits a phone) shows each month's own figure a crew, the
  head count under its crews. Growing (`growthCfg.crews`, `gSetCrews`): each crew brings the window's GP a crew and
  is a leader and an apprentice (`G_NEW_CREW` = 2 guys); the overheads (Xero opex, or the `g-ohmo` box) are held
  flat. Typed crew numbers on the P&L strip are the ones used. `fergusProd` / `teamWork` stay — the Command Centre still reads them. CASH AT A GLANCE OPENS FROM THE COMMAND CENTRE (2026-10-25, "it won't let me click any of
  these"): `#cash-modal` is written inside `#page-cash`, so opened from the Command Centre it was
  `.open` inside a hidden page and every tap did nothing. `openCashDetail` moves it onto the body
  on first open. Total owed to you opens the three due-in lists and the AR list job by job
  (`CASH_DETAIL_GROUPS.owed`), then the balances; on a phone the job name wraps so Due in is never
  off the right. `tests/hubui.mjs` (101, UI list) drives both
  layouts and every tab, and `tools/hub-shots.mjs` screenshots it from `tests/_hubseed.mjs`. Send the owner
  screenshots before shipping a hub change; he asked for them.
  A/P NEXT MONTH IS THE CALENDAR MONTH AFTER THIS ONE (2026-10-28, the owner: "A/P next month should show
  xero's bills to pay next month (88.3k)"): `apExp.next` is the next 20th and `foll` the one after, and from the
  20th on `next` IS next month — the tile and its `expap` popup read `foll` and showed the month after next
  (December's $525 of bills over November's $88k). `apNextMonthSlot()` picks whichever of the two falls in the
  month after now and pairs it with `apBillsDueInMonth`; the cashflow popup still shows both 20ths. `hubui` pins
  it on the 28th and the 10th. THE TILE IS XERO'S BILLS ALONE, AND THE MATERIALS ARE ON THE CASH TAB
  (2026-10-28, the same morning: "remove the 'Materials likely paid 20 Nov' ... put them as likely due in
  December 20th and move it to the cash tab (keep next months in the command center). also remove 'last month'
  from the home tab"): the `expap` tile and popup carry the bills only; `apExp.all` keeps every active job's
  still-to-buy and `renderMatDue()` lists it on the Cash tab's `#cash-matdue-card` under the 20th of the month
  after next (`matDueMs`), biggest first — the 13-week forecast's own week-by-week materials are unchanged. The
  Last Month card (`.d-last`, `#met-last`) is gone from the Command Centre; Cash at a glance takes the row. `hub-cash-peek.yml` → `hub-api/scripts/cash-peek.js` prints what the shared Cash
  state holds (bill count, bills by due month, bills due this month) from the Actions log.
  THE REPORTS TAB (2026-10-29, the owner: "put the two review/powerpoint creation buttons into their
  own tab called Reports"): `#page-reports` / `#nav-reports` (last in the bar and the swipe `order`)
  carries two cards — Team meeting (`#rep-mtg-btn` → `openMeeting`, the PowerPoint deck, `pm-hide`)
  and Back-costing review (`#rep-bcr-btn` → `openBcReview`). The button on the Command Centre's P&L
  row and the card on the Back Cost tab are gone; the modals are unchanged. `hubui` (107) pins it.
  THE WEEKLY TOOLBOX TALK IS ON IT TOO (2026-10-30, the owner: "incorporate the toolbox app into this
  financials app? Put it in the reports tab too"): the private `office4777/flood-roofing-toolbox` repo
  (a Next.js page on Vercel — the Monday meeting sheet, its notes in that browser's localStorage, a
  Fergus API route for the open jobs, open-meteo for Kerikeri's weather) rebuilt in the hub as
  `#tbx-modal` (`openToolbox` / `renderToolbox` / `tbxStep`, card `#rep-tbx-btn`). Same sections in the
  same order (meeting details, direction & updates, team culture, weather Mon–Fri with the auto-fill
  button, jobs on the go, housekeeping, special events, H&S, other comments, attendance & signatures);
  the notes live in `fr3_tbx[<Monday>]` and so ride the TEAM SYNC (one sheet for the office and the
  yard); the jobs are the Workload sync's `fwJobs` with priced vs actual hours and a used-% badge (the
  old app's "Load Fergus data" and its crew / schedule columns are gone — Fergus's partner API never
  filled them); the attendance list is whoever logs hours (`teamWork.persons`) unless the office types
  its own (`fr3_tbxStaff`, "Edit the list") — NO NAMES IN THE SOURCE, the hub is a public page; Present
  ticks are kept on the week. Print / Save PDF is `tbxPrint` (`body.tbx-printing`, an injected
  `@page` A4 portrait, the meeting deck's own pattern). `hubui` (118), `hub-shots` renders it.
  THE FERGUS LINK ON IT IS THE CALENDAR (2026-10-31, the owner: "make sure all the functions to the toolbox
  work, like the fergus link (showing the scheduled jobs the guys are on this week and what they were working
  on last week) and the weather forecast", then, when the first build read the timesheets alone, "the old
  toolbox app actually did give me the team schedule. I think it was pulled from the calendar"). He was
  right and the old app's own history was not the guide: its first commit read `/api/v2/calendar_events`
  (Fergus's web app's own API, never answerable with a partner key) and v7–v15 probed for site visits and
  gave up. Asked directly — `hub-schedule-probe.yml` → `hub-api/scripts/fergus-schedule-probe.js`, run on
  demand where the proxy secrets live, three runs on 2026-10-31 — the partner API answers GET
  `/calendarEvents`: every booking on the company calendar with `userName`, `eventType`
  (JOB_PHASE / QUOTE / OTHER), `jobId`, `title` ("#3228a Deb Allen - 52 Kerikeri Road …"), `startTime` /
  `endTime` IN UTC, no paging; the week now running by default, and ONLY `filterDateFrom` / `filterDateTo`
  as full ISO date-times move the window (a plain date is a 400; from/to, start/end, startDate/endDate and
  a dozen more are silently ignored). `/users` lists the staff. No site-visit, schedule, booking or roster
  route exists; `/jobs/{id}/phases` is the job's phases. THE CREWS SECTION (`tbxLoadFergus`,
  `_tbxFergusHtml`, `#tbx-fg`): the STAFF SCHEDULE GRID (`#tbx-cal`, a row a person, a column a day,
  Saturday / Sunday only when booked, each job its own tint, day off red; `tbxCalCompact` puts each event
  on its AUCKLAND day — 7 am Monday NZDT is 18:00Z Sunday — and drops an OTHER event under 90 minutes, the
  Toolbox itself and the 15-minute run-throughs; a phone gets `.tbx-cal-list`, one block a person); THIS
  WEEK job by job (`#tbx-week`: Scheduled from the calendar with the days, last week's crew and the hours
  logged so far from the timesheets, a Notes / changes box typed and shared, `fr3_tbx[<Monday>].crew`; a job
  only the calendar knows is named from its title, `tbxCalTitle`); LAST WEEK person by person from the TIME
  ENTRIES (`#tbx-last`, newest first, `/timeEntries?pageSize=100&sortField=timeEntryDate&sortOrder=desc`,
  stopping at the first page wholly before last Monday; no job = "Toolbox / yard / other"). The read is kept
  in `fr3_tbx[<Monday>].fergus` (`cal` compact, `calErr`). THE FORECAST asks open-meteo for `weather_code`
  (reads `weathercode` too), matches days by `daily.time`, says in words when the week is past its 16 days,
  and reports the API's own `reason` on a refusal — it cannot be fetched from the cloud container (the proxy
  refuses the host), so `hubui` (120) pins it, and the calendar, with stubs.
  `hub-backcost-csv.yml` → `hub-api/scripts/backcost-csv.js` (2026-10-28/29) exports every back-costed
  job as a CSV (`months`, `keep_all`), the source of the owner's 29 Oct back-costing report.
  TWO ON-DEMAND REPORTS RUN WHERE THE PROXY SECRETS LIVE (GitHub Actions, 2026-10-27):
  `hub-backcost-report.yml` (the GP-margin target per revenue band from the hub's rows) and
  `hub-labour-check.yml` → `hub-api/scripts/labour-check.js`, RoofMap's labour auto-calc against the
  hours logged on every back-costed non-shed job, plus whether each job's scaffold was bought in
  (Xero supplier bills naming the job — Fergus's API exposes NO supplier invoices, ten shapes 404).
  Findings and how to read them: `docs/LABOUR_CHECK_2026-10-27.md`. The short version: only 6
  finished jobs carry RoofMap's itemised quote so far; on the 147 office-quoted jobs with an area the
  calculator is right under ~$14k and ~40 % low from $25k up (crews log 0.5 man-h/m², the calculator
  prices ~0.3); the missing time is travel, own-crew scaffold, strip-off — drivers it does not have.
  Re-run it once more RoofMap-quoted jobs have finished (the exact fit needs 8+).
  THE MARKETING SYNC FALLS BACK THROUGH REQUEST SHAPES (2026-10-18): Fergus
  began answering 500 to `/enquiries?…sortField=createdAt…` on 9 Sept and
  `syncMarketing` swallowed it, so the nightly's "marketing" step read ✓ for
  six weeks while every enquiries / quotes / conversion tile on the Command
  Centre went blank. `fergusPaginateAny` tries the sorted shape, then
  plainer ones (401/403 stop at once); enquiries that fail every shape are
  recorded (`mkt.enqErr`, a `marketing-enquiries` diag line) and the sync
  carries on with jobs + quotes; jobs or quotes failing every shape THROWS
  (`syncMarketing({rethrow:true})` from the master and the refresh), so the
  step reads ✗. Read the nightly's job log for "Timestamps: … Mktg a -> b"
  before believing a green run.
- `floodroofing/tools/` — generators, never their output (`.gitignore` keeps
  it that way). `demo-shots.mjs` → `demo-slideshow.mjs` → `demo-record.mjs`
  build the sales demo; `restore-check.mjs` verifies a backup restore;
  `build-og-card.mjs` renders the link-preview card.
  `check-app-syntax.mjs` is the app.html syntax gate described above — it
  parses every inline `<script>` with `new Function()` and prints
  `blocks 6 bad 0`; run it after ANY scripted edit to that file.
- `.vscode/` + `.claude/settings.json` — the editor setup, committed so every
  machine inherits it: tasks for the gate, the sheet gate, one suite, the
  syntax check and the sitemap; debug configs that put a breakpoint in a suite
  or run one with the browser visible; formatting off everywhere and LF pinned
  (`.gitattributes`), because the promote check compares app.html with the live
  site byte for byte. `floodroofing/docs/VSCODE.md` is the step-by-step and the
  handover for working on a laptop rather than from the phone.

## Pipeline — how changes reach users

main → GitHub Tests CI → promote workflow → `production` branch → Railway
(backend) + Vercel (frontend). Never push `production` directly.

Discipline (non-negotiable):
1. Develop and commit on the session's designated `claude/...` branch only.
   NO PREVIEW STEP (owner's rule, 2026-09-22, replacing the preview-first
   rule of the same morning — "I don't have time to check previews"):
   build the batch, run the gate, ship to main as soon as it is green, and
   report what shipped. The branch's Vercel preview still exists
   (`https://flood-roofing-estimator-git-claude-8454b2-office4777s-projects.vercel.app/app`,
   from `list_deployments` + `list_deployment_aliases` on the Vercel MCP)
   for a screenshot when words are not enough, never as a gate.
2. ONE TEST RUN PER SHIP (the owner, 2026-10-01: "anyway we can speed up
   these?" — "yes do them"). Run the AFFECTED suites locally (and the
   sheet-layout gate after any engine change), commit, and push straight to
   main: main's Tests run is the gate — the promote only runs when it is
   green, so a red run ships nothing; fix forward. No PR run first (it ran
   the same suites again and cost ~10 minutes a ship). The browser suites run
   on FOUR machines at once (`strategy.matrix.shard` in tests.yml, `SHARD=k/4`
   in run.mjs), so a ship is ~5–7 minutes from push to live. The full local
   run (`node floodroofing/tests/run.mjs`) is still the tool for a wide change;
   on Windows it cannot exit 0 (signup, dupjobui, restoredrill).
3. Ship with `git push origin HEAD:main` (fast-forward only). Batch several
   commits into one ship when possible.
4. The pipeline lands about 5–7 minutes after the push to main (Tests CI,
   sharded, ~4 min; promote ~1–2 min). Watch the promote for that SHA
   rather than waiting a fixed time.
5. **A ship is not done until the promote workflow is green** — WHEN there
   is one. `tests.yml` triggers only on `floodroofing/frontend/**`,
   `backend/**`, `tests/**`, `package.json` and its own file, and the
   promote is a `workflow_run` ON Tests — so a commit touching only
   CLAUDE.md, `docs/`, `tools/` or `hub/` runs NO Tests and therefore NO
   promote, and production stays where it was. That is right (nothing in
   such a commit reaches a user) but it means waiting for a promote that
   will never come. Check that a Tests run exists for the SHA before
   watching for its promote; if a docs-only commit really must go live,
   it has to ride with a code change or be dispatched by hand.
   When there IS a promote, it verifies
   both halves, and both are the proof:
   - the FRONTEND, by fetching roofmap.co.nz/app and comparing it byte-for-byte
     with app.html at the promoted commit;
   - the BACKEND, by reading `build` from the Railway service's `/health` and
     comparing it with the promoted SHA. A failed backend deploy used to be
     completely silent — promote went green, the site served the new
     app.html, and the API behind it ran the old code, which is the worst
     shape a half-ship can take because the frontend calls endpoints and
     columns that are not there yet. That step is forgiving where it cannot
     TELL (no answer, or a build of `unknown`): those warn and pass, because
     a check that cries wolf gets ignored and is then worth nothing on the
     day it is right. Only a backend definitely serving a different commit
     fails it.

   The frontend step waits 20 MINUTES and the backend 10, raised from 8 and 7
   on 2026-09-18 after three promotes in a row went red on Vercel builds that
   were still running and then landed fine — one of them left a real change
   unshipped because the red was assumed to be the usual false alarm. Vercel
   builds here have taken up to 18 minutes. Waiting longer costs a slow
   workflow on a slow day; giving up early costs the whole point of the check.

   A PROMOTE RUN'S `head_sha` IS NOT THE COMMIT IT PROMOTED (2026-10-19, and
   it cost a wrong conclusion). The promote is a `workflow_run` event, so the
   API reports main's tip at trigger time, not the SHA the run checked out and
   verified. Two ships pushed minutes apart therefore look like one. Read the
   LOG instead: the backend step prints "Waiting for … /health to report build
   <sha>", then either "Live after Ns" (verified), or one of its two forgiving
   warnings, or the hard error. That line is the only statement of which
   commit a promote actually put live.
   Neither `production` containing the commit nor a 201 from the Vercel deploy
   hook is proof. Both were true on three ships that never went live.
   If that step goes red, the FIRST thing to check is the Vercel project's
   **Settings → Build and Deployment → Ignored Build Step**. It must be
   `Custom` with the command `exit 1` (exit 1 = build, exit 0 = skip). On
   `Automatic`, Vercel skips any commit whose SHA it has already deployed —
   and the SHA always reaches Vercel first as a preview of the `claude/...`
   branch, so EVERY promote was a repeat and was skipped. That single setting
   cost most of a night and three ships reported as live that never were.
   Failing that, tell the owner to open Vercel → Deployments → newest →
   **Promote to Production**. Never report a change as live on the strength
   of the branch or the hook alone.

## THE SHEET LAYOUT DIAGRAM — THE OWNER'S RULES (read before touching it)

The owner has had to teach this logic to new sessions over and over (his
words, 2026-10-27: "i keep having to teach a new session the logic and it
keeps getting lost"). These are HIS rules, in the order they apply. The long
history of how each came about is the "THE SHEET LAYOUT IS THE PUZZLE" bullet
under Conventions, and `docs/SHEET_LAYOUT.md`; this list is what to obey.

THE PROCESS, every time:
- NEVER put a sheet-layout change live without sending him before/after
  pictures (`node floodroofing/tools/sheet-shots.mjs <fixture> <outdir>`)
  and getting his "go".
- Before showing him, diff EVERY fixture's tally against the previous commit
  (lay each `tests/fixtures-*.json` as `tests/sheetlayout.mjs` does and print
  `_sheetPuzzleBuild({}).tally`). Any shape that moved beyond the one he asked
  about goes in the pictures too, with the reason.
- EVERY SHIP OF A SHEET-LAYOUT CHANGE UPDATES THIS SECTION (the owner,
  2026-10-27: "every push live for the sheet layout diagram fixes, changes
  should also update the claude.md file"). A new rule he teaches is written
  here in his own words before the ship, not after.
- `tests/sheetlayout.mjs` pins each rule on the shapes he counted. The
  37-shape gate (`docs/ci_sheet_tests.js`) is the ENGINE's count and must stay
  byte-identical; the puzzle never feeds it.

THE GEOMETRY, never broken:
1. Sheets run perpendicular to the gutter (to the ridge only where a face has
   no gutter), never parallel to a gutter or ridge, 45° to a hip or valley
   only, and never across a roof line.
2. A sheet is never FLIPPED. An offcut may be spun, so its HAND (long side
   left or right looking from the square end to the cut) must match the
   piece it feeds.

THE LAY:
3. PLAIN HIP FIRST. Picture the biggest block with the longest sheets as a
   plain rectangle and lay it exactly as a plain hip: each long slope as ONE
   run of full-width sheets along the whole rectangle, the closer lapped at
   the far hip corner; each hip END cut from the slopes' hip-cut offcuts, each
   half of an end from the OPPOSITE slope's offcuts (the hand decides). Which
   block is the rectangle: against a slope, the larger area (a T's bar, not
   its stem); against a hip end, the longest sheets.
4. THEN THE COOKIE CUTTER. Everything else is cut OUT OF the plain hip's
   sheets where they lie, not laid afresh:
   a. A wing standing in front of the main's SLOPE (Big-L, reports 70, 72,
      73): its end takes the slope's columns. In each column the slope's
      sheet is cut at the valley — the top piece stays on the slope, the foot
      (✂) slides along the column onto the wing's end. The wing's triangle
      comes out of the slope's own sheets.
   b. A wing standing in front of the main's hip END (reports 71, 74–76): each
      row of the end is the main's end strip — the wing's piece plus what is
      left of the main's end between the valley and its hip — one strip fed
      from one offcut, the foot carried.
5. THE MAIN KEEPS ITS SHEETS. In 4b the hip at the wing's far end IS the
   main's hip moved along, so on the slope the main and the wing share, the
   strips that hip cuts are the MAIN's sheets at the main's length (report
   76: "the same number of purple sheets as there is orange sheets ... the
   missing purple sheets should go where green sheets d40 ... d56 are") —
   their offcuts are the ones the plain hip feeds that end from. The wing's
   own block only gets its full strips between.
   c. ONE ROOF MAY CARRY BOTH (report 77, the DOUBLE CASCADE, 2026-10-27:
      "double cascade sheet layout not correct, do your best using the new
      logic"): a 14 × 10 m main with a wing off its north slope flush with the
      west wall (4a) and a lower block off its east hip end flush with the
      south wall (4b). Every slope facing the wing's way is a candidate, not
      only the longest (the longest north slope there was the lower block's
      2.2 m one, which a 4 m end can never come out of), and the wing must
      stand behind the template ITSELF — not merely somewhere along its
      gutter line followed through the roof (the lower block's end lies on
      the line of the top wing's east gutter, with the main's own east end
      between). 75 → 69 sheets, 9 extras → 2.
6. A HIP-CAP CORNER IS NOT A LONGER SHEET. A strip a hip crosses only at a
   corner, where a hip runs onto a lower ridge (≤ 100 mm past the lower
   block), is the lower block's sheet — "c31 should be a green sheet because
   c31 wouldn't be able to utilize it's offcut properly".
7. THE DUTCH GABLET is a hip end with its apex cut off: ordered WHOLE across
   its gutter (hip-cut strips included), its offcuts feeding the slopes'
   corners across its hips, the corners laid as complements (the gablet from
   its corners in, the slope from the gablet's wall out).
7b. A MONO EXTENSION IS THE PLAIN ROOF WITH LONGER SHEETS (2026-10-31,
   "inside of a step creating a whole hip and valley set, it simply extends
   the roof plain down ... if it's in the middle of a ridge line that's
   pretty simple, just those sheets would be longer, however if it's on a hip
   area, the full lengths sheets would again need to be longer and making
   sure the offcuts are sufficiently long enough to carry on a offcut
   triangle set"). A bump no roof line runs into (reports 78/79's mono
   extension, or a shallow bump left unchosen) is laid as if it were not
   there (`_pzMonoBase`, in `_pzRoofGeom`), then every strip over it is
   carried down onto it (`_pzMonoExtend`, last in `_sheetPuzzleBuild`): a
   sheet over it is longer by the bump's depth up the slope (its own block,
   never grouping the slope's other sheets with it), and a piece cut from an
   offcut makes its DONOR that much longer, so the offcut still reaches — on
   a hip end the corner sheets feeding the rows over the bump. 18 × 12 hip
   with a 1 × 4 m bump anywhere: 48 sheets, 6 × 7.74 + 42 × 6.63, nothing
   extra (was 48–64 sheets with up to 16 × 7.73 and 36 offcuts wasted on a
   hip end). Report 78's roof as mono: 47 → 44 sheets, 202 → 186 m.

THE FILL:
8. Feed each side of an end IN ORDER from its home offcuts (the same face, or
   across the hip that cut them; a valley makes no home), one run of sheets at
   a time (C21, then C20 beside it). Where the offcuts run short, PUSH one
   full sheet in at the head of the run so every offcut moves one strip
   outward, rather than ordering short extras. A valley tail may be laid from
   its point. Slivers are scraps trimmed off an offcut.
8b. A NICK AT THE GUTTER END IS NOT A CUT (report 77): a strip a valley clips
   by under a tenth of a cover (76 mm) at its gutter end is square there — the
   roofer trims the corner at the valley — so an offcut can feed it, as a
   nick under the ridge cap (≤ 50 mm) already was. It took report 76's
   pushed-in E1 out: 177 → 176, still 48 orange and 48 purple.
8c. THE CLOSER CARRIES THE LONGEST ROW (report 76, 2026-10-27: "double check
   that the purple offcuts from sheets C28 through to C48/49 can't be moved
   slightly over and be used in place of F1 ... usually it would work"). A
   run's last sheet is lapped flush at the corner, as the plain hip closes;
   where only a sliver of it shows (95 mm on report 76) it used to be trimmed
   off its neighbour's offcut, so its own near-whole offcut never existed and
   the end's longest row was an extra. Before any extra is ordered, such a
   closer becomes a sheet of its run when its offcut feeds the open piece —
   one sheet for one, never more steel. Report 76: E1 is now ↺C49 (49
   purple, 48 orange, 176, nothing extra); report 20's small hip, 74 and 50
   lose an extra each the same way; no tally moves anywhere.
8d. OFFCUTS GO NEXT TO EACH OTHER, NEXT TO THE SHEETS THEY CAME FROM
   (2026-10-31, the owner: "always try and bunch up the offcuts so they go
   next to each other rather than used in opposite areas of the roof.
   Because a roofer is likely to focus on one lot of sheets, cut them, lay
   those first lots of sheets, and then straight away lay the offcut sheets
   ... prioritize laying offcuts in order next to each other. It makes it
   simple and easy and utilizes the right offcuts in the right spot").
   Rule 8's series made general: when more than one offcut fits a piece,
   prefer the one whose sheet lies nearest to it and whose neighbours feed
   the pieces beside it, so a run of offcuts lands as a run. It ranks after
   rule 10's less steel — a lay that is nearer but orders more steel loses —
   and decides between lays and fits that tie on steel. On the double
   cascade mock it is already as close as the steel allows: the corner by
   C5 and the triangle by C7 can only come off C6 or C16. NOT YET BUILT.
9. An extra is a sheet at its OWN length — never two extras cut from one
   sheet ("e1 should just be a full sheet with a small amount of wasteage").
10. WHEN TWO LAYS ARE BOTH LEGITIMATE, the roof is laid both ways and the one
    ordering LESS STEEL is kept, then the one USING MOST OF ITS OFFCUTS
    (2026-10-31, the owner correcting the old order: "The rule should not be
    fewer sheets first. It should be less steel first and utilizing most of
    the offcut"; before that, "it should go which ever way is most
    efficient"). NOT YET BUILT: the engine still keeps fewer sheets, then
    less steel (`opts.noTipLay`, `opts.noApexTmpl` and the late-step
    comparisons in `_sheetPuzzleFill`). Changing it moves fixtures, so it
    ships with the efficiency moves below and before/after pictures.
    WHAT IT DECIDED ON THE DOUBLE CASCADE (report 77 redrawn at a true 45°,
    tested as a mock, not built): today 69 sheets / 295.02 m with extras
    G1 and H1. Moves he asked for, each a real fit (spin, never flip): G1
    off E20's offcut; H1 off C15's offcut; C15's two-cut corner triangle off
    C16's offcut carrying the far-north valley piece and the two-cut
    triangle beside C17; the blue E17 (a 5.13 m sheet with a 2.20 m piece)
    ordered as a red F7 at 2.20; C6's offcut carrying the 1.26 m corner by
    C5 (which was an extra, "I don't like G1 gold") and the triangle by C7,
    once C6's own 0.39 m sliver at the west corner moved onto C16 → 67
    sheets, 284.92 m, nothing extra. Finding it took a search over every
    assignment of the loose pieces to the offcuts with room, each sheet's
    set packed in every order — a first-fit pass reports "no fit" where an
    arrangement exists, so the engine's version must search the same way.
    THE PRE-CUT PACKS AGAINST THE FIRST CUT (asked the same day: "bring that
    small double cut C16 right to the edge of the main C16"): the mock places
    each offcut piece as LOW as it fits, flush with the sheet's own cut, so
    the leftover is one clean piece at the far end; `_sheetPrecutPlan` still
    places it as high as it fits.

THE PICTURE:
11. EVERY LABEL STARTS AT THE GUTTER (2026-10-27: "start all the sheet
    labelling near the gutter line so the labels are all inline and easy to
    read"): the number (big, up to 16px) starts a few
    pixels in from the piece's own gutter end — the higher of its two bottom
    corners — so a face's labels make one line along its gutter. Only where
    that does not fit (a triangle narrowing to the gutter) does a label move
    to the middle of its piece. THE SMALL CORNER TRIANGLES ARE LABELLED TOO
    ("add in smaller labels to the missing labels on the small triangle
    sheets in the corners"): the number alone at 7–5px, at the first spot in
    the piece where it fits, on a white halo; one too small even for that
    has its number just outside the roof's corner on a hairline, a second at
    the same corner one line further out. Only a sliver under 300 mm goes
    without. THE NUMBER ONLY, NO LENGTH ON A SHEET (2026-10-27: "remove
    the sheet measures on each individual sheet, it's confusing"); the
    lengths are in the colour-coded key over the picture.
    NOTHING ELSE BUT THE KEY (2026-10-27: "delete all the info underneath
    the diagram, then at the top, delete the line that starts with 'each face
    div...' just have the colour coded guides"): no explanation line under
    the title, no ORDER / block / end-face lines under the picture — the
    title, the key chips (block, count × length; hatched; ✂) and the roof.
    THE KEY IS PAINTED AS THE SHEETS ARE (2026-10-27: "the colour code
    doesn't match the same exact colour as the sheets"): a block's chip is
    its 30% tint with the 90% edge, the hatched chip white with the 65%
    hatch, the ✂ chip the 22% tint with a dashed edge — the first block's
    colour on the two examples. `_renderSheetPuzzleCanvas`, `pc._lbl`; pinned in
    `sheetlayout.mjs`.
11b. THE SHEET PRE-CUT LAYOUT IS THE JOB PACK'S PAGE 2 (2026-10-31: "show
    the 7 orange sheets of full 5.01m length layed out in a rectangle format
    side by side ... as they would be before they are cut, and show the
    required cut lines and label each of the cut sheets as they are labeled on
    the sheet layout diagram ... call this the Sheet Pre-Cut Layout ... fit on
    one a4 sheet on the job pack on the 2nd page"). `_renderSheetPrecutCanvas`
    / `_sheetPrecutPlan` in sheet-plan.js: every ordered sheet of the layout's
    blocks, full length, square end at the bottom, block by block in the
    layout's colours (one-row blocks share a shelf, rows evened out, one scale
    for the page, the largest that fits). On each sheet: its own piece on the
    square end (spun end for end if that piece is square at its top), the feet
    carried under it (✂), then every piece cut from its offcut — tried spun
    and straight, flush either side, the highest place it fits (a scrap last)
    — red cut lines, grey waste, labels as on the layout. Pieces are read in
    one frame for every face (standing at the gutter looking up the slope), so
    a spin is a plain 180° turn and nothing is flipped; a straight-cut piece
    (rule 8's `cutShortPx`) is drawn as cut; what the fill's own tolerances
    let run past the sheet (a hip cap over a corner, an offcut up to
    `_PZ_FIT_MM` short) is clipped to it. Page type `precut`
    (`_jpRenderPrecut`), in `_jpDefaultPages` after the header; the v9
    migration puts it after the first job header of every pack without one.
    THE SHEETS LIE AS THEY ARE CUT ON THE GROUND (the same day: "the sheets
    would be laid out on the ground and the roofer would use a chalk line to
    ping the lines ... lay out, say, 10 sheets and cut the corner so they're
    all in line ... so all the offcuts ... makes perfect triangles"): a
    block's sheets cut by one hip or valley (one face, one cut direction, a
    corner nick included) are a RUN (`_pzChalkRuns`, `_pzCutLine`), ordered so
    the cut is one straight line across them, rising or falling — so on a
    north slope numbered from the west the run reads A8 … A1. Runs first,
    each kept on one row where it fits, a gap between runs; uncut sheets last.
    `sheetlayout.mjs` pins every sheet once at its length and every piece
    inside its sheet with none overlapping on five shapes, and the page fitting.
    A RUN IS ONE ROOF LINE, AND THE FIRST CUT IS RED (the same afternoon: "those
    purple sheets, they're not cut in a continuous line, they're all staggered
    ... prioritize the main first cut line, so it's all nicely in line ...
    maybe show [a second cut] in a different line color"). On an L the main's
    slope carries sheets cut by its hip AND sheets whose feet come off at the
    wing's valley — two lines leaning the same way on one face, which a run
    keyed on face + lean interleaved. `_pzCutLine(s, pz)` reads the cut back
    into the face's own frame (`abs` = its intercept, through the centroids,
    spun or not) and `_pzChalkRuns(sheets, pz)` clusters sheets whose cuts lie
    within 120 mm of one line. The sheet's own pieces are outlined RED (the
    first cut, one chalk line a run), everything cut out of an offcut BLUE
    underneath (the second cut). Pinned on the Big-L and an L with a wing.
11c. ONE PICTURE A PAGE, FITTED, A WIDE ROOF TURNED (2026-10-31: "made the
    details roofmap fit the whole page, then move the sheet layout to the 2nd
    page, then the sheet cut layout to the third page, make them fit to the
    page and if the roof in longer east/west than it is north/south, rotate it
    automatically 90deg to fit the screen better"). `_jpDefaultPages` is
    header (the Detailed map alone, fitted by `_jpFitDefaults`), `sheetplan`,
    `precut`, cutlists; the v10 migration takes the app's own untouched Sheet
    layout picture off page 1 and puts a `sheetplan` page straight after the
    header (a sized one stays, never two). A picture wider than
    `JP_ROT_WIDE` (1.05) × its height is turned a quarter ANTICLOCKWISE
    (north to the left): the map whole (`_cvRotIfWide`, `opts.rotWide` on the
    app's own untouched pictures only), the sheet layout with its title and
    key left upright and only the roof under them turned and grown to fill the
    page (`_jpRotWidePuzzle`, reading `cv._pzHeadH` / `_pzRoofW` / `_pzRoofH`
    from `_renderSheetPuzzleCanvas`). The pre-cut layout is not turned.
    `quickwins.mjs` pins the order and the migration, `sheetlayout.mjs` the
    fit and the turn on the 18 × 12 m hip.

THE ORDER:
12. THE SHEET LAYOUT IS THE COUNT (2026-10-27: "for the sheet quantity in the
    job pack and the pricing, use the quantities from the new sheet layout
    diagram instead of the sheet calc check"). `_lastSheetCounts.groups` (the
    cut list) is the layout's tally per roof, set in `_renderRoofSheetPlanInner`
    (`fromPuzzle`; the engine's groups kept as `engineGroups`), and the cut
    list's bump-out splitter and label relabeller do not run on it. The
    pricing's sheets row is `_sheetPuzzleTallyFor(_matSelectedRoofIndices())`
    — the metre run, or the m² of steel (length × cover) on an m² price. Each
    roof is laid out on its own and cached against its geometry
    (`_pzTallyOfRoof`). TWO GUARDS: a layout that orders less steel than the
    roof's own area is never the order (`_pzTallyCovers`, the engine stands
    in), and the pricing is all-or-nothing across the roofs in scope. A roof
    with no pitch of its own is laid at the job's pitch box, as the engine and
    the barges are (reports 70–76 were drawn at 0°: counts unchanged, lengths
    now ×1/cos 15°). Suites that pin the ENGINE's count set
    `window.__SHEET_COUNT_ENGINE` (monocount, cutlistwire, report51, report9,
    sheetclaim). THE SHEET CALC CHECK IS WITHDRAWN (`CALC_CHECK_HIDDEN` in
    app.html): not offered in the Maps panel or page types, a stored page not
    shown — its code and every stored page kept; `false` brings it all back.
    What it moved, measured: the hand-counted double-L 73 → 89 (the layout
    orders 34 one-off extras there), the T 71 → 74, report 75 110 → 130,
    report 71 62 → 70; typesnap's roofing quotes +2% (sheets line only).
    THE DOUBLE-L'S MIDDLE BLOCK IS A SQUARE PYRAMID (10 × 10 m, four
    triangles, no slope run), and every one of its strips is ordered at its
    own length — the 34 extras. Rule 9 forbids two extras from one sheet, but
    a pyramid's strips pair across each hip (v and L − v off one full sheet)
    exactly as a plain hip's end is fed from its slope; nothing does that yet.
    Since report 77 its top wing's end is laid on the pyramid's north face
    (the hip end it stands in front of) rather than the lower block's north
    slope 10 m away: 89 → 90. Put to the owner, not yet answered.

(2026-10-27 later: the pushed-in E1 below is GONE — rule 8b — and F1, then
E1, the one extra, is fed from the purple closer C49 — rule 8c. A48 and A47
STAY ORANGE, re-measured: they lie below the main's ridge, the south half of
the plain hip's end, whose cut is the opposite hand to every purple offcut
(a purple offcut there would have to be flipped), and every purple offcut
C29–C49 is already on the 21 rows above them, one each.)
ASKED, 2026-10-27, NOT DONE — report 76's wing end: he wants the strips
where E1 (pushed in), A47/A48 (orange offcuts) and F1 (an extra) stand fed
from the purple hip-cut sheets' offcuts. Measured: the north half of the
combined end from its top corner to the wing's ridge is 23 strips, the
purple hip-cut sheets on that side (C28–C30 at the main's hip, C31–C48 at
the wing's) give 21 offcuts; A47, A48 and E1 lie between the main's ridge
and the wing's lower ridge, which in the plain hip is the SOUTH half of the
main's end (orange); and the purple run is lined up from the west corner,
so each offcut is ~130 mm short of the strip beside it and the top one (F1)
runs out. Tried and dropped, each worse than 177: the purple run started at
the wing's corner (F1 still short — the wing's SE hip is drawn 1 px off 45°,
~30 mm over 7 m), the corner closer ordered as a purple sheet (F1 fed, but
49 purple and 178 sheets), and the wing's rows cut apart from the main end's
strips (193 — the 4.48 m strips come back as extras). ASKED AGAIN the same
day ("the offcuts to purple sheets C28-48 should be long enough to be also
used where Red F1, Yellow A48, A47 and possibly sheet E1 are") and measured
again: purple C29–C48 are 20 usable offcuts, 1.02 → 15.14 m (C28's is
0.28), for the 20 rows from the top corner down to the MAIN's ridge
(0.74 → 15.22 m, F1 the last); A48 and A47 lie under the main's ridge, the
south half of the plain hip's end, whose cut is the opposite hand to every
purple offcut; and C48's offcut is 87 mm short of F1 because the purple run
ends 95 mm short of the wing's corner. Also tried and dropped: the end's row
grid shifted −0.5…+0.5 of a cover (never under 177), and the shared slope
laid from both ends and lapped where the wing's hip starts (179). Laid from
the wing's corner with the closer ordered, F1 IS fed at 177 sheets — a swap,
not a saving, and 49 purple to 48 orange.

## Conventions

- The public pages (`landing`, `pricing`, `fergus`, `early-access`, `signup`)
  must agree with the `PLANS` table in server.js about what each tier gets.
  `tests/sitecopy.mjs` pins it; change the table and the pages together.
- THREE PLANS, NO FOUNDING RATE, AND A ROOF TRIAL (2026-10-23, the owner:
  "swap the 14-day clock for '3 real roofs or 30 days, whichever comes
  first' ... only new trial users not existing trial users, also amend the
  pricing tiers and drop the top tier off", then "fully remove the 30% off
  for 12months").
  THE TIERS: Measure $79 (1 person: measuring, cut list, job pack, and now
  MERCHANT ORDERS — `PLANS.measure.order` is true; no customer quotes), Trade
  $149 (1 person, adds quotes, notifications, follow-up, invoicing, quote
  analytics), Team $299 (5 people, adds Fergus, the schedule board, the
  subdomain and own-address email, and now the team INBOX, chat and tasks,
  the own DOMAIN and priority support). Business is OFF SALE:
  `PLANS_ON_SALE = ['measure','solo','team']`, `/billing/checkout` refuses it
  for a company not already on it, `PLAN_TIERS.business.retired` keeps it on
  the billing screen only for a business on it, and `PLANS.business` stays so
  those businesses keep their limits. `_BIGGEST_PLAN_SEATS` comes from the
  plans on sale, so a full Team is told "Enterprise". The trial row matches
  Team, inbox and domain included. Every `needs: 'Business'` is now 'Team'.
  NO COUPON: checkout always sends `allow_promotion_codes` and never
  `discounts` (`EARLY_ACCESS_COUPON` and `_earlyAccessEligible` are gone, and
  so is the founding paragraph in the waitlist invite). A business already on
  the coupon keeps it — that is Stripe's state. No page, the app or the terms
  may promise a founding rate (`seo.mjs`, `trialui`, `billingui`).
  THE ROOF TRIAL: `_newTrialRow` gives a new business `trial_roof_limit` 3
  (`TRIAL_ROOFS`, 0 = back to 14-day trials) and `trial_ends_at` +30 days
  (`TRIAL_ROOF_DAYS`); a row with no limit is a 14-day trial and is never
  counted. A REAL ROOF (`_drawHasRealRoof`) is an outline of 3+ corners with
  a scale, on any roof tab, never TEST-1, a SAMPLE ref or `isSampleJob`.
  `trial_roofs` (company_id, user_id, job_id = the version ROOT, unique per
  company) is the ledger; `_trialRoofGate` runs on `POST /jobs` and
  `PUT /jobs/:id` — counts the job the first time a save carries a real roof
  (`trialRoofCounted` in the answer), refuses a 4th with 403
  `TRIAL_ROOFS_USED`, and re-reads the subscription fresh before refusing so
  a business that has just paid is never stopped by a minute-old memo. A
  failed check lets the save through. The three counted jobs keep working
  until day 30; deleting one does not give its roof back. `/subscription`
  `.trial` carries `days`, `roofs_limit/used/left` and `roof_jobs` (roots).
  THE APP: `_planGateHtml` shows "N of 3 free roofs left · M days left" from
  day one on a roof trial (amber at 1 roof or 3 days); `_trialRoofsBlocked()`
  stops `autoGenerateRoof` on a 4th roof and opens the plans window
  (`window.__roofsUsedGate`) with "Back to my roofs", because the account is
  still live; `api()` opens the same window on `TRIAL_ROOFS_USED`.
  THE EMAILS: the drip's last step is day 26 "Four days left" on a roof trial
  (`_dripStepDay`), with the roofs left; the gone-quiet alert names roofs
  left; the trial-ended email no longer says "14-day". THE FUNNEL is on the
  analytics page (`trialFunnel` in analytics.js): signed up → 1st → 2nd →
  3rd real roof → paid, by signup week over 13 weeks, from `trial_roofs` for
  roof trials and from the jobs themselves for older signups, blocked
  signups left out. `tests/trialroofs.mjs` (API), `trialui`, `analytics`.
- THE SIGN-UP QUESTION is asked in TWO places — `signup.html` and the app's own
  `login-setup-view` — and they must not drift. Since 2026-10-07 it reads "What
  has drawn you here the most?" and takes ONE answer (radios; it was "What
  interests you most about RoofMap?" with as many ticks as they liked). The
  field is still a LIST on the wire and in `profiles.interests`: accounts from
  before hold several, and a page cached from before the change still sends
  several, so the server takes what it is given. `INTERESTS` in server.js holds
  the keys and labels; the signup alert says "Drawn here by".
  `tests/signup.mjs` pins both forms (it reads app.html off disk for the
  second), `tests/register.mjs` the server.
- Sitemap dates come from git: after committing any public-page change, run
  `node floodroofing/tools/sitemap-dates.mjs` and commit the sitemap before
  the gate. `tests/seo.mjs` fails on a stale date (skipped on shallow clones).
- Every company-scoped table needs `company_id` AND `user_id` from day one —
  `_scopeCompany()` filters on both.
- A SESSION TOKEN'S COMPANY IS NOT EVIDENCE (2026-10-08, ethan@): a token
  carries `cid` and lasts 30 days, and `requireAuth` took it on trust — so an
  account signed in while it was in the wrong business STAYED there for a
  month. Jobs, settings and the Fergus key are all read by company, so the app
  opened onto nothing and there was no way to tell from inside it; signing out
  and back in was the only cure and nobody knew to try it. `requireAuth` now
  checks the token's `cid` against `_memberCompaniesOf(userId)` (read-only,
  never creates a company, cached a minute) and uses the real one on a
  mismatch, so a session heals itself on the next request. A lookup that FAILS
  leaves the token's claim alone — auth never breaks because a lookup did, and
  the safe direction is leaving somebody where they were, not moving them
  nowhere. `_companyCache` grew a 60 s TTL at the same time; it had none, so a
  membership repaired in the database could not reach a running server.
- AN INVITATION NOBODY CLICKED (2026-10-08): the teammate misses the invite
  email and signs up on the sign-up page, which is the obvious thing to do —
  that makes them a business of their own and a blank screen, while the invite
  sits unaccepted and unmentioned. The office read it as "Fergus has
  disconnected on his account"; it never can be, because the Fergus key is the
  COMPANY's (`_companySettingsRow` reads by company_id), so the right business
  shares the office's key and the wrong one has nothing. `GET
  /auth/pending-invite` reports an unaccepted, unexpired invite for the
  signed-in address to a company they are not in (+ `jobsLeftBehind`), the app
  shows `#joinInviteBar` once per sign-in (`_joinInviteCheck`,
  `sessionStorage.fr_join_asked`), and `POST /auth/join-invite` takes it — no
  emailed token and no new password, because the invite is addressed to an
  email and they have signed in as it. Same seat check as the emailed link,
  and an invite addressed to anyone else is refused however its id is passed.
  Joining moves the PERSON, not their work, so the app says what stays behind.
  `tests/joininvite.mjs`.
- Test seams: `__TEST_MAIL_FETCHER`, `__TEST_MAIL_JSON`, `__TEST_SMTP_FAIL`,
  `__TEST_AI` (routed by system-prompt sniffing). Suites import server.js
  in-process, so seams are set as globals before import.
- New behaviour ships with test pins in the matching suite; UI suites drive
  the real app.html in Playwright with route stubs.
- Secrets: never print ADMIN_TOKEN or DB connection strings; creds are
  AES-encrypted at rest via MAIL_CRED_KEY/JWT_SECRET derivation.
- No model identifiers in commit messages or code comments beyond the
  standard commit trailer.
- Error monitoring emails the owner on uncaught exceptions and 5xx — silence
  false alarms at the source rather than muting the reporter.
- An UNPROMPTED platform email (the trial drip, the trial-ended email) is
  HELD, never sent from a company address. `_allowedFromAddress` drops a
  From outside the verified sending domain back to `EMAIL_FROM`, which on
  this deployment WAS office@floodroofing.co.nz — so RoofMap's onboarding
  mail was reaching strangers out of the owner's roofing inbox. (Since
  2026-10-02 Railway has `EMAIL_FROM = RoofMap <support@roofmap.co.nz>`,
  `RESEND_API_KEY` set, and roofmap.co.nz + quotes.roofmap.co.nz VERIFIED in
  Resend — DNS on Vercel: DKIM `resend._domainkey`, `send` MX/SPF in Resend's
  Tokyo region, DMARC to support@. So platform mail sends; nothing is held.) All three
  sweeps (drip, trial-ended and the gone-quiet alert to support@, which
  reached the owner from office@ on 2026-09-21) bail on
  `_platformMailboxSendable(MAIL_SUPPORT)` BEFORE they stamp their
  watermark, so no trial loses its place, and sending resumes by itself once
  roofmap.co.nz is verified in Resend or `EMAIL_FROM` points at it. Mail
  somebody asked for (an invoice, a cancellation, a requested link) is never
  held — a person who pressed a button and got nothing is worse off than one
  who got the right thing from an odd address. `tests/platformfrom.mjs`.
  And the platform's mail NEVER takes the Google relay: when Resend refuses
  a `platform:true` message, `_dispatchMailInner` holds it and pages
  ("Platform email HELD") instead of falling back — the relay is one Gmail
  account that sends as the owner's roofing company, which is exactly how
  the trial email once reached a stranger from office@floodroofing.co.nz.
  Requested mail still degrades to the relay. And with NO Resend at all a
  `platform:true` message is HELD too (`relay-is-not-platform`), because the
  relay is the Flood Roofing Gmail and sends as it whatever From it is
  handed; `GAS_RELAY_IS_PLATFORM=true` declares a relay that really is
  RoofMap's (the suites whose fake relay stands in for one set it).
  `tests/platformrelay.mjs`,
  with a fake Resend that refuses everything (`RESEND_API_BASE`).
- ONE COPY OF EACH PICTURE (2026-09-23): the quote's versions (sent,
  accepted, drafts) hold `@media:<key>` in place of every embedded picture
  and the picture lives once in `S.quote.versions.media` (`_qvPackAll` on
  load and at every snapshot; read a version ONLY through `_qvQuoteOf`).
  `/q/:token` never sends `versions` to the customer. Job 3245's six
  condition photos times every version was the slow open, save and send.
  `tests/quoteversions.mjs`.
- THE PROFITABILITY TOTAL IS THE QUOTE (2026-09-23): `_profitFigures
  ('total')` is the main roof (with folded roofs) + `_profitSelectionItems`
  (an optional roof only once the customer takes it) + other quote lines =
  `_quoteMoney().sub`. `calcLabour` applies the auto hours to EVERY priced
  roof, not just the tab on screen, and `_setRoofMode` recalculates labour
  before re-baking the lines. The Pricing panel is all excl. GST and says
  so on every heading; the gutter heading is the card's bottom line
  (`_gdCardTotal`). The steel choices (grade, profile, thickness) show
  prices relative to the current pick. `tests/profititems.mjs`, `gphr.mjs`.
- THE PHOTO LISTS ARE A VIEWER (2026-09-23): the PHOTOS pop-out's two lists
  (`PV_KEYS`: `ferg`, `job`) hold every photo in a `.pv-slot` of ONE fixed
  height (74% of the list, neighbours peeking); zoom scales the picture
  inside its slot (`--pv-z`, origin `--pv-ox/oy`), so nothing reflows. ▲ ▼
  (`_pvStep`), the arrow keys only while the pointer is over the panel
  (`_PV.over`), and a swipe slide to the next one (smooth `scrollTo`). The
  plain wheel does not scroll the list; Ctrl + wheel zooms towards the
  pointer; a zoomed photo drags inside its slot. `_grabPan` no longer runs on
  these two boxes. The pop-out is on the Quote tab too (`jp-second`, under
  PRICING, one out at a time). `tests/photoviewer.mjs`.
- JOBS TO PRICE is the FIRST STATUS BOARD TILE (key `toprice`, since
  2026-09-24; `_hbToPriceOn()` = Fergus linked): Fergus's own "To Price" jobs
  (`GET /jobs?filterJobStatus=To Price`, the partner API's enum), kept a
  minute (`_hbToPriceLoad`, the Home ↻ refreshes it); `_hbToPriceHtml()` is the
  table in the board's list box; a row opens the job through
  `useFergusJobInModal`. On the Quote tab the PHOTOS drawer starts where the
  Pricing drawer does (`body[data-tab="quote"] #fergusRoofPanel`), so its tab
  sits under PRICING's instead of on it.
- A NEW JOB NEVER SHOWS THE LAST JOB'S ROOF PICTURE: `clearAll` and a
  stateless `restoreFromJob` call `_roofPrevReset()`.
- THE CUSTOMER'S OPEN READS SLIM when `DATABASE_URL` is set
  (`_findQuoteForCustomer`: the quote minus `versions` in the SQL; the
  "opened" stamp is `jsonb_set` on `share` only, `_saveShareBack`). `/q/`
  answers carry `Server-Timing` (db slim|full, total); `/health.features.
  directDb` says whether the slim path is available. The Fergus proxy reads
  only `user_id, company_id, jms_keys, updated_at` for the key, and
  `httpsRequest` gives up after 60 s. A hand-pressed Push to Fergus reports
  as soon as Fergus has the quote; its two quote saves finish behind it.
- A QUOTE MAY TAKE OFF ANY CHOICE (2026-09-23): the selections window
  (`_qselOpen`) locks nothing; it keeps at least one per group
  (`canEmpty` for gutters/extras) and `_selRepickHidden` moves a pick that
  was taken off onto the first choice left. `_selFixed` honours a quote
  hide on the first row. "+ Add profile option" (`_qpfOpen`) adds a profile
  for THIS job (`S.quote.customProfiles`, merged by `_selProfilesAll`) or,
  ticked "Add to saved profiles", to Settings. A profile may carry `img`
  (`_qpfPicSet`); `_qbProfileFigure` shows it on the profile AND colour
  sections, draws only `corrugate`/`5rib`, and shows NOTHING for any other
  profile without a picture. A second click on the picked colour clears it.
  Guttering and Old roof carry "Delete this page" too; deleting Guttering
  resets the gutter pick to none. The cover's "Swap photo" is
  `S.quote.coverPhoto` {src, offX, offY (percent of the frame), zoom}, moved
  and zoomed like the condition slots, first in `_qbHeroSrc` and the A4.
  `tests/profilecustom.mjs`.
- ONE WRITE TO THE JOB ROW AT A TIME (2026-09-22): `saveCurrentJob` and
  `_publishQuoteOnly` go through `_jobWriteQueued`; a save asked for while
  one runs waits, a third joins the waiting one. Autosave is HELD
  (`AUTOSAVE._hold`) while a quote email is being sent. Before this,
  autosave every 2 s plus the send's publish queued multi-MB row rewrites
  on the database's row lock until the statement timeout cancelled them —
  "Publishing the customer quote link…" for ten minutes, 39 timeouts on
  `/jobs/:id`, and every other request (Settings, the test email) stuck
  behind them. The revision trigger `_job_backup_upd` checks the cheap
  "snapshot in the last 10 minutes" test BEFORE comparing the two drawings.
  `tests/quoteeditor.mjs` pins the queue.
- A HUNG REQUEST NEVER BLOCKS THE QUEUE OR A JOB OPEN (2026-09-22): every
  `/jobs…` request in `api()` aborts after 2 minutes (`__API_TIMEOUT_MS`
  seam) with "The server did not answer in time … kept on this device";
  `_jobWriteQueued` waits on its predecessor at most that long plus 5 s;
  `_saveBeforeSwitch` waits 20 s (`__SAVE_SWITCH_WAIT_MS`) then drafts
  locally and lets the open go ahead. Job 3245 "would not open" because
  the open waited on a save stuck behind a request that never answered.
- SETTINGS THAT NEVER CAME FROM THE SERVER ARE NEVER WRITTEN BACK TO IT
  (2026-09-22): `saveSettings` keeps them on the device and says so when
  `window.__settingsLive` is false (the read failed and a local copy or the
  defaults stood in). The server, too, keeps a stored Fergus key and the
  `quote_defaults.email` addresses over BLANKS in an incoming save unless
  the save says `__cleared` (the app sets `jms_keys.__cleared` when the
  office empties the field on a live screen). A blank copy autosaved
  during the database stall is how the owner's key and email addresses
  vanished — "Fergus disconnected again". UI suites that call
  `saveSettings` must stub GET /settings with an object, not `[]`.
  `tests/ferguskey.mjs`, `tests/quotedomain.mjs`.
- THE OFFICE READS THE LIVE PRODUCTS on a draft (2026-09-22):
  `_selectables()` answers the quote's send-time `selectablesSnapshot`
  only for the customer, while printing, on a frozen version
  (`S._qvViewing`) or a locked job; otherwise Settings' products. A grade
  added in Settings could never be offered on a quote that had ever been
  sent before this. `tests/selectables.mjs` plays both sides.
- SAVE BUTTONS SHOW THEY SAVED: every Save / Save now button goes through
  `_saveClick(btn, 'settings'|'job')` — a spinner for at least a second,
  then a green "✓ Saved 3:41 pm" or a red "Not saved", then back. The
  Settings nav is sticky with dark-blue group headers; the Quote tab's Job
  type (scope) card is hidden and the scope lives in the More menu, which
  is always shown now; the template picker is a solid light-blue button.
  `tests/quoteeditor.mjs`.
- THE SEND RECORDS ITSELF BEFORE FERGUS (2026-09-22): after the email
  POST, `_qvMarkSent()` and the light `_publishQuoteOnly()` (tried twice,
  then a forced full save) come FIRST; a failure is said in `#qaMsg`. Then
  the Fergus push (`pushQuotePricingToFergus` THROWS to its silent caller
  now), whose failure leaves a lasting Quote-tab message naming Push to
  Fergus; then the sent version is re-stamped so it carries the Fergus
  plan. Job 3245 went out during the stall above and was neither in Quotes
  sent nor marked sent in Fergus, with nothing on screen to say so.
  `tests/emailpush.mjs`.
- A SAVE REFUSED FOR A DUPLICATE JOB NUMBER (2026-09-22) attaches by
  itself when the existing record is plainly the same job (same client or
  same address, `_dupJobIsSame`): with work on screen (`_screenHasWork`)
  the save goes ONTO that record, with nothing drawn yet that record is
  opened; only a different client's record still gets the "already
  exists" question. `tests/dupjobui.mjs`.
- A SAVE NOBODY PRESSED NEVER ASKS A QUESTION (2026-10-13, the owner: "when i
  am in a job (3264), then click change job and open another job (3302) a
  window appears saying 'job 3264 already exists' ... it should just let me
  open job 3302 and auto save the job 3264 as I'm opening job 3302 without any
  warning box appearing"). Two faults on that one path:
  THE DUPLICATE CHECK READ THE SCREEN, NOT THE SAVE. `_saveCurrentJobNow`
  takes `client` and `addr` off `#jobClient` / `#jobAddr` WHEN THE SAVE RUNS,
  and on a job switch the incoming job has already filled those in — so
  3264's save was matched against 3302's name, `_dupJobIsSame` found nothing
  alike, and the "already exists" question was asked instead of the record
  being attached to. It compares `body.client_name` / `body.site_address` now:
  what is actually being written.
  AND A BACKGROUND SAVE MAY NOT PUT A MODAL ON SCREEN. `saveCurrentJob({quiet:
  true})` is passed by the switch-save (`_saveBeforeSwitch`) and by EVERY
  autosave — autosave fires on input events, including the ones
  `restoreFromJob` raises while the next job is being laid out, which is how a
  dialog about the job you just left lands on top of the job you are opening.
  A quiet save still attaches when the record is plainly the same job; when it
  is not, it keeps a device draft and says so on the working pill, and never
  asks. It must NOT quietly create a second record either: landing there means
  the number belongs to a record the save cannot identify itself with, which
  is confused state, and a draft is the safe place for it. A save the office
  PRESSED still asks — then the question is the point, because they are
  looking at it. `tests/dupjobui.mjs`.
  NOT REPRODUCED END-TO-END, and worth saying so: the exact path that loses
  `S.currentJobId` on his machine was not pinned down — `_saveBeforeSwitch`
  skips the server save entirely when there is neither a `currentJobId` nor a
  `linkedJobId`, so a plain switch could not be made to raise the dialog here.
  Both fixes above are right on their own merits and together close every
  route by which that dialog can reach a switch; if it is ever seen again, the
  thing to find out first is whether the job was FERGUS-LINKED (`linkedJobId`
  set, `currentJobId` still null), which is the one shape that reaches
  `saveCurrentJob` with no record to PUT onto.
- EXCLUSIONS on the modern proposal: `S.quote.custExcl` (edited beside
  the inclusions in `_qdescOpen`, kind `'x'`; `_qbExclusionLines`). When
  any exist the two lists get "What's included" / "What's excluded"
  headings and the exclusions a red cross (`.qb-excl-row`); a quote with
  none reads as before. `tests/quotedesk.mjs`.
- THE GUTTER IS GUTTER MATERIAL, NOT ROOFING MATERIAL (2026-09-22): the
  roofing material table no longer carries a Gutter row. A steel or
  Classic gutter is itemised on the Guttering & Downpipes card like the
  Typhoon kit: the spouting $/lm, a bracket at the product's own spacing
  (800 mm on a steel gutter — per-product since 2026-10-19, see THE EXTERNAL
  BRACKET'S RATE; `GUTTER_STEEL_BRACKET_SPACING_M` is dead) and a dropper
  every 8 m, never fewer
  than one per run (`GUTTER_DROPPER_SPACING_M`), priced from Settings →
  Price book `gutter.bracket_ea` / `gutter.dropper_ea` (defaults $4.20 and
  $16.50 until the owner sets his). The customer's gutter delta reads the
  same lines, so the pricegold baseline moved on every box-gutter
  combination. `tests/gutterprice.mjs`, `tests/chainwalk.mjs`.
- DELETE THIS PAGE / INSERT … PAGE on the modern sections (2026-09-22):
  the grade, profile and thickness sections carry "Delete this page from
  this quote" (`_qbSectionRemove` → `S.quote.modernParked`, the same store
  the template editor uses; the condition page is still the A4 page
  toggle) and each carries its own edit button (`profile`, `thickness` in
  `QE_INLINE` → `_qselOpen('profile'|'thickness')`). A section taken out
  leaves an "+ Insert … page" placeholder where the default order puts it
  on the computer preview (`_qdWithPlaceholders`, `.qd-parked`) and a strip
  under the phone book (`.qb-parked`) — office only, never the customer or
  paper (`_qbParkedForOffice`). `tests/quoteeditor.mjs`.
- THE GRADE AND GAUGE PERCENTAGES ARE WORKED ON THE RAW MATERIAL COST
  (2026-09-22): `S.quote.materialRaw` is stamped beside `materialBase`
  (the figure before the quantity buffer and the mark-up);
  `_selMaterialBaseRaw()` reads it, or divides the buffer and mark-up back
  out of `materialBase` on an older quote. `_selGradeDelta` (percentage
  path) and `_selGauge55Delta` use it, so the pricegold baseline moved on
  every grade-swap and 0.55 combination.
- THE CUSTOMER'S DOWNLOAD PDF OF A MODERN QUOTE (2026-09-24) is the
  one-page layout they are looking at, with their picks, not the A4 (which
  on a modern quote is little more than the cover): `printCustomerQuote` →
  `_printModernQuote`, `window.__PRINTING_MODERN` (makes `_qpDeskActive`
  true and `_qpBookActive` false even on a phone), `html.print-modern`
  print rules hide the bar, nav, rail, accept block and every button but
  the option cards (`.qb-opt`, `.qb-sw`, `.qb-undecided`). Classic quotes
  and the acceptance record (`_buildQuotePdf`) still print the A4.
  `tests/quotedesk.mjs`, `tests/quotebook.mjs`.
- THE OFFICE'S PRINT / PDF BUTTON MAKES THE MODERN QUOTE'S OWN PDF
  (2026-10-13, the owner: "i want to be able to print/pdf the modern quote,
  but when i click the print/pdf button the attached is what it produces"
  — a classic A4 of a quote he was looking at in the modern layout, the
  cover and little else). `printQuote()` was the A4 path for every style;
  on a modern quote it now goes to `_printModernQuoteFile()`, which builds
  the SAME document the customer's own Download PDF builds
  (`_buildQuotePdf({scale:2})` → `_buildModernQuotePdf`, one 1100px capture
  sliced across A4 sheets) and SAVES it rather than opening the browser's
  print dialog — html2canvas has already made the sheets, and handing them
  to a print dialog only lets the browser re-paginate them. Classic quotes
  print the A4 exactly as before.
  THE PRICE BOX PRINTS (the same message: "exactly how it looks in the app
  just with the pricing box that's on the right hand side of the quote").
  The rail was in the print rules' hide list from the day the modern PDF was
  built, on the reasoning that a sticky side panel is screen furniture. It
  is not — it is the sub-total, the GST, the total and What you chose, and
  a quote PDF without them is not a quote. `.qd-rail` is out of that list;
  the wrap becomes a column, the rail takes `order:-1` and
  `align-self:stretch` so it leads the first sheet full width, and
  `.qd-rail-in` is un-stuck (`position:static`, no shadow) so html2canvas
  captures it where it sits. `.qd-rail-links` (Review, the jump links) stay
  hidden — nothing on paper is clickable.
  AND THE OFFICE'S OWN PROMPTS DO NOT: an empty photo slot, an empty
  caption and the grey "Click to write a short description of the roof's
  condition" line are office furniture that the customer never sees but the
  office's own PDF carried — four dashed boxes filled most of a sheet.
  `.qp-cond-empty`, `.qp-cond-cap-empty`, `.qp-placeholder` and
  `.qb-para-empty` are hidden in both print layers.
  THE FILE IS NAMED FOR THE JOB (`_quotePdfFilename()`): "Quote 3301 - Pole
  Shed - Aron Flood.pdf" — the quote's `ref`, Roofing or Pole Shed from
  `quoteKind`, then the client, each part dropped if it is blank, Windows'
  forbidden characters stripped and the whole thing capped at 100
  characters. `tests/quotedesk.mjs`, `tests/quoteeditor.mjs`.
  AND THE CAPTURE IS THE WIDTH IT SAYS IT IS (2026-10-13, the owner on the
  first such PDF: "pdf looks terrible"). Every sheet after the first was
  sliced down its right-hand edge, mid-sentence — the hero ran off the page,
  "the best corrosion resistance on the marke", the colour swatches' last
  column gone. `_buildModernQuotePdf` sets `#qpRoot` to `QP_PDF_MODERN_W`
  INLINE and hands html2canvas the same figure as `windowWidth`, so the clone
  lays the quote out at that width — but
  `html.qp-desk .report-preview #qpRoot{width:auto!important}` BEAT the inline
  style, and an element measured at the office's own screen width (876px on a
  1440 window, 722 on 1100, 622 on 1000) was handed content laid out at 1100.
  The canvas kept 876 of it. The width is pinned in CSS now, under
  `html.pdf-modern`, with the `!important` it takes to win, so the box
  measured and the box drawn are the same box. A LESSON WORTH THE WORDS: an
  inline style is not a guarantee in this stylesheet, and any capture whose
  canvas comes from one measurement and whose layout comes from another will
  clip in exactly this way.
  THE PRICE BOX IS NOT REPEATED AT THE TOP (2026-10-13, the same message:
  "remove the pricing box from the top of the quote, keep the price just at
  the bottom of the pdf"). It was pulled to the front earlier that day so the
  money was not lost with the nav, but the Review section at the END already
  carries the sub-total, the GST, the total and What you chose — so the front
  copy was the quote opening on its own price and saying it all twice. The
  rail is furniture again, and with it goes the flex column it needed: the
  wrap prints as a plain BLOCK, which is also the only layout html2canvas
  lays out the way the browser does (its flexbox support is partial, and
  `order` / `align-self` inside a capture is exactly where it drifts).
  BUNCHED UP (the same message: "you can bunch it up a bit more too"): the
  on-screen rhythm — 22px between sections, 26/28px inside every card, a 21:8
  hero — is sized for a page you scroll, and on A4 it bought a sheet of air
  per section. Section gaps, card padding and the hero come down in the print
  rules only, so the screen is untouched; and `_pdfAddSlicedCanvas` may give
  up a sheet's last QUARTER to find a clean break rather than its last half
  (0.22/0.78, was 0.45/0.55), which is where the empty bottoms came from.
  Nine sheets to about three. `tests/quotedesk.mjs`.
- THE PROPOSAL'S TITLE is `S.quote.proposalTitle` (default
  `QB_PROPOSAL_TITLE` "Re-Roof Proposal", `_qbProposalTitle()`), edited in
  Edit description's Title box on a modern quote; saving the default
  deletes the field. `tests/quotedesk.mjs`.
- THE PHOTO LISTS' WHEEL (2026-09-24): a plain wheel turns ONE photo per
  notch (deltas added up to a notch, then locked 380 ms so a flick never
  skips); past the first or last photo it is left to scroll the page;
  Ctrl + wheel still zooms. `tests/photoviewer.mjs`.
- THE STATUS BOARD is ONE ROW however many tiles (`grid-auto-flow:column`),
  four across under 900px, two in site mode. `tests/photoviewer.mjs`.
- A SEND UPLOADS THE QUOTE TWICE, NOT FOUR TIMES (2026-09-24): with roof
  photos the quote is megabytes. The send publishes it for the link and
  once more for the sent record; its Fergus push is called with
  `linkReady` so it does not publish it again before or after the push;
  the light publish that carries the Fergus plan and the one full save run
  behind the closing window. `tests/emailpush.mjs` counts the uploads.
- `/quote-activity` reads through the direct pg pool when there is one
  (`_quoteShareRowsPg`, 30 s budget, the share without `fergus`/`priced`),
  the REST read after it; the 60 s per-office cache is cleared by every job
  or quote write and every customer event. The Home board retries a failed
  feed by itself twice (5 s, 15 s) and shows the error text.
- THE BACKGROUND GOES TO NOTHING (2026-09-24): the View menu's Background
  slider (`#bgOpacity`) at 0 skips the PICTURE only — it used to `return`
  out of `redrawAll`, so the lines went with it. The quote's roof plans
  (`_qpInteractiveRoofBlock`, both modern maps) carry an office-only
  "Background picture shown/hidden" switch (`_qpRoofBgSwitchHtml`), the same
  `S.quote.roofMapShowBg` as the A4's button, so every map and the customer
  follow it; `_toggleRoofMapBg` saves through `_scheduleAutosave` (it called
  a non-existent `autosaveJob`, so the choice was never saved).
  `tests/bgclear.mjs`.
- THE CUSTOM PRICE BOOK (Settings → Pricing → Custom Price Book,
  2026-09-24, `set-custompb`, `_cpb*`): `price_book.custom_book` =
  `{items:[{id, code, desc, unit, supplier, cost, markup, replaces}],
  defaultMarkup, editedAt, acct}`. Upload a CSV (columns found by name, or
  by content) or a PDF (pdf.js text lines, `_cpbRowsFromLines`; the AI
  reader `_cpbAiRows` over `/claude`, text only, runs ONLY on the "Read it
  with AI" button — the privacy policy's words; `tests/legal.mjs` counts the
  call sites); the
  supplier is read from the file/filename (`_cpbGuessSupplier`); a preview
  says new / re-priced / unchanged, and the same supplier + code (or
  description) RE-PRICES an existing item keeping its mark-up and link.
  `replaces` is a PB_CSV_TARGETS path or `sheet:<product>`; `_cpbApply`
  writes cost × (1 + markup%) there — at the end of `collectPriceBookFromUI`
  (so the form cannot put the old number back) and in `mergeSettings` — and
  the job's own material mark-up still goes on top; nothing in the pricing
  engine changed. One item per default (`_cpbLink` unlinks the previous).
  Linked defaults are read-only on Quote's Product Options
  (`_cpbMarkLinkedInputs`, base grade only) and the job's material rows show
  the supplier's product (`_cpbBrandRows`, label only — values unchanged).
  NEVER LOST: every edit stamps `editedAt`; the SERVER keeps the stored book
  over an older or missing one and an empty one needs `__cleared` (set by
  deleting the last item); `price_book_revisions` keeps the replaced book
  (at most one per 10 min unless items dropped; 30 kept) — GET
  `/settings/custom-book/revisions`, POST `/settings/custom-book/restore`
  (keeps what it replaced too); the save's echo never replaces a newer book
  typed mid-save (`_cpbKeepNewer`); a book only this device's copy holds
  (same `acct`) is kept and sent on load (`_cpbReconcileOnLoad`, reading the
  copy BEFORE the server's answer overwrites it). Settings autosave skips
  `[data-noautosave]` and file inputs. `tests/custompb.mjs`,
  `tests/custompbsrv.mjs`.
- THE CUSTOMER'S COPY IS KEPT READY (2026-09-24): `_qStampCustomerCopy`
  (products, `share.priced`, `recommended`, `sentTotal` — never `sentAt`)
  runs at the send AND before every autosave on the Quote tab, so the job
  save carries it. `__qWritten` = `{id, fp, fpNoShare}` (`_qWrote`) records
  the quote as last written by a job save or a light publish; the send's
  link step skips the upload when `_qServerHasThis()`, or sends the share
  alone (`PUT /jobs/:id/quote-share`, merged into the stored share, customer
  events kept) when only the share differs (a first send's new token).
  `sentAt` is stamped once the email is away (`deferSentAt`); the sentTo
  job save is gone (the record carries it). `tests/emailpush.mjs`.
  The Quote tab's switch reads "Customer preview: Computer | Phone".
- THE ROOF CANVAS IS NEVER PINNED TO A PIXEL WIDTH (2026-09-24):
  `_canvasFreeSize` — the stylesheet gives the width, the height keeps the
  picture's shape (`cv._aspect`, report 26), `fitCanvasToWrap` re-derives
  the height from the width it has, `#canvasWrap` is watched and
  `_setPopReserve` re-fits after the Photos panel slides. A picture placed
  with the panel open used to leave a dead strip once it closed.
  `tests/bgclear.mjs`, `tests/canvassetup.mjs`.
- THE FERGUS PHOTOS ARE LOADED ONCE (2026-09-24): `_FPC` per linked job —
  `_fergusListPhotos(force)` memoised five minutes (↻ = fresh, uploads
  forget it), `_fergusDownloadBlob` memoised per file URL (160 kept); the
  Photos panel warms every quote slot and a pick is instant (Fergus's
  "thumbnail" is the photo). The proposal slot picker downscales like the
  others. Server list cache keyed by company + job (`_flKey`).
  `tests/photoviewer.mjs`. Rotate background image runs −100°…100°.
- QUOTE DRAFTS AND TEMPLATES (2026-09-25, `tests/quotedrafts.mjs`):
  the Viewing menu is rendered into `#qaViewingHost` in the header, left of
  "Change quote template" (was "Select from saved templates"); it lists the
  working draft, Sent, Accepted and saved drafts only (no New draft / Save
  this draft). Switching (`_qvOpenDraft`, `_qvNewDraft`, `_qChangeTemplate`)
  asks NOTHING: `_qvKeepWorking()` saves the working draft first when
  `_qvWorkedOn` — a draft started from a template or a new job's default
  (`tplFresh`) is untouched while `_qContentFp` (the office's content keys
  `Q_CONTENT_KEYS`, incl. lineItems) equals its baseline `tplFp`; no
  baseline counts as worked on. `_qChangeTemplate(id)` makes a NEW draft:
  the job's pricing, client, share and versions kept, `Q_FRESH_DROP` (photos,
  custom wording, hides) dropped, the template applied. THE TEMPLATE EDITOR
  (`_qtOpen`) works on a COPY (`_QT.job` holds the job's quote, viewing,
  lock and autosave hold; `_scheduleAutosave` is a no-op while it is open)
  and `_qtClose` puts the job's quote back untouched — its saves write
  templates only; `_qt*` and `_qChangeTemplate` are in `_LOCK_OK_CALLS`.
- SAVING IN THE BACKGROUND (2026-09-25): switching jobs no longer waits —
  `_saveBeforeSwitch` snapshots the job NOW (`_jobSaveDetach`), writes a
  device copy, and `_jobSaveSendDetached` PUTs it through the write queue
  (3 tries; the device copy is deleted on success, `_draftMarkSyncedFor`).
  The working pill ends a save it showed on "✓ Saved h:mm" (green,
  `_workingFlash`, `__saveOkAt`) or a red "Not saved — …". The send shows
  the Sent version only after its last save lands (`__qSendTail`) — it used
  to switch first, and the save was refused.
- PUSH TO FERGUS CANCEL (2026-09-25): the pill carries Cancel
  (`_workingWrap(name, label, cancel)`, `_fergusPushCancel`, `_FPUSH`); the
  push checks between steps; after Fergus created the new version it is
  voided again and the rev restored; the create request is never aborted.
- THE ROOF'S FIGURES ARE IN THE LEFT MENU (2026-09-28, moved 2026-09-29;
  `#navRoofStats` inside `#navJobBox`, `_roofStatsRender`): three plain rows
  in the job's grey box — Roof area (m², along the pitch,
  `_matBasicCollectRoofs`), Flashings (every measured line EXCEPT the gutter,
  at the length drawn on the map, `measM`; the row's tooltip breaks it down by
  type) and Gutter (its own trade, its own price, never inside a flashing
  total). THE JOB BOX ITSELF sits UNDER the tab buttons now (it was at the top
  of the nav), above "Signed in as". More than one roof puts a small
  "Viewing all" button above the rows (`_roofStatsMenu`) that drops a TICK BOX
  per roof (`_roofStatsToggle`, `_ROOF_STATS.off` holds the ones ticked off, so
  a new roof is counted without being asked for); the button then names them —
  "Viewing Main Roof & Garage", or "Viewing 3 roofs" past two. The last roof
  left cannot be unticked. It filters THE FIGURES ONLY: every roof stays on the
  canvas and the active roof never changes. One roof shows no button at all.
  `#roofStatsBar` under the canvas is kept for the PLAYGROUND alone, which
  hides the sidebar and whose whole teaser is the blurred area.
  `tests/roofstats.mjs`, `tests/playground.mjs`.
- THE SCAFFOLD IS ITS OWN LINE ON EVERY SUMMARY (2026-09-29): scaffolding is
  priced into every job, so it sat inside "main scope of work" and the customer
  never saw a figure for it — until one added guttering, watched the small
  "Platform scaffolding upgrade" appear and read it as the price of the whole
  scaffold. `_custBarRows()` now splits the base in two: a `base` row
  ("Re-roof — main scope of work", short "Re-roof") and a `scaffold` row
  ("Scaffolding — edge protection" / "— full working platform", short
  "Scaffolding"), and `buildAcceptSummaryRows` (the A4) does the same instead
  of its old grey "of which scaffolding … already in the figure above".
  NO TOTAL MOVES — the two rows add to exactly what the one row read, and
  `pricegold` is unchanged because `_quoteMoney` and `_qpSelectionChanges` are
  untouched; the platform uplift stays its own change row, which now reads as
  an increase on a scaffold price the customer can already see. The figure
  comes from `_qpBaseScaffold()` → the LINES THE BASE IS MADE OF (the
  "Scaffolding" line `_syncQuoteBaseLineItems` keeps, plus any custom line with
  `_area:'scaffold'`), never from `_selScaffoldBasePrice()`, which answers 0 on
  a platform job and under the low-roof tick because it exists to price the
  +25%. No split on an option-priced quote, or when no line says scaffolding.
  Rows carry `short` for the narrow summaries (the phone bar, the rail).
  `tests/scaffoldline.mjs`.
- NO PRICE, NO SEND (2026-09-29): `openQuoteEmail` runs `_pricesBeforeSend`
  after the branding gate, same shape (`true` = it took over and will re-call
  the send itself). `_unpricedItems()` walks every roof the quote prices
  (`_pricingRoofTabIdxs`, folded roofs scoped in with `_matSelOverride
  (_pricingRoofGroup(i))`, an excluded roof skipped, a `MATERIAL_DELETED` row
  skipped) and flags each material row whose rate is 0 or missing while the job
  uses some of it — the same test the table's red `🚩 No price` row makes. The
  window (`#unpModal`, `_UNP`, `.unp-*`) gives each one a red ✕, a $ box and
  "📖 From price book"; a price goes on as a price typed for THIS job
  (`_onMatOverride`, `MATERIAL_OVERRIDES`), turns the row green and, where
  `_cpbPathForVariant` knows a price-book field for it, offers "Save $X as my
  default price" — which links (or makes) a Custom Price Book item, never a
  direct price-book write, so Settings shows it and `_cpbApply` keeps it. The
  footer's "Email quote" is `disabled` until every row is green, and `_unpSend`
  refuses anyway. The PRACTICE job is never held up. Custom quote lines typed
  at $0 are not checked — only the price-book-driven material rows.
  `tests/unpriced.mjs`.
- A PLAIN WHEEL OVER THE CANVAS NEVER ZOOMS (2026-09-29): it scrolls the page,
  pointer over the drawing or not. Ctrl + wheel is the zoom (`onCanvasWheel`,
  routed from the document wheel handler). The old exception — a sketch with no
  aerial behind it zoomed on a plain wheel — is gone. `tests/roofstats.mjs`.
- A SENT QUOTE IS NEVER LOST TO A SAVE THAT HAS NONE (2026-09-29, job 3261:
  a quote sent 21 Sept came back a week later reading an older total with the
  Viewing menu offering "Draft" alone). Three holes, all closed:
  the SERVER keeps the stored `quote.versions` (sent, accepted, drafts, media)
  and the stored `share` when an incoming `PUT /jobs/:id` carries a quote with
  NO versions — the price book's rule, `versions.__cleared` to mean it — and
  a row it cannot read refuses the save (503) rather than letting it through
  blind; `_resolveJobMoved` CARRIES the other side's versions the way it
  already carried `share`, `accepted` and `fergusAutoPushedFor` (it did not,
  so a stale screen wrote its empty store over theirs); and that same function
  no longer blanks `S._jobLoaded` after two refusals to force a save with NO
  `base_updated_at` — which switched the server's two-people-one-job guard off
  and let one screen overwrite the row whole. It keeps their stamp, gives up
  after four, and the work stays in a device draft. `tests/jobversions.mjs`
  (server), `tests/savemoved.mjs` (app). The office's own recovery is
  History → Roof map history: `job_revisions` keeps the EIGHT newest snapshots
  per job, one per 10 minutes, and a restore is itself snapshotted — so tell
  the owner to stop saving a damaged job before anything else.
- EVERY SEND IS KEPT (2026-10-02): `versions.sent` is the LATEST send (every
  "was it sent?" reader uses it) and `_qvMarkSent` moves the one it replaces,
  whole, into `versions.sentEarlier` (oldest first, packed by `_qvPackAll`).
  `_qvSends()` lists them; the Viewing menu shows "Sent quote 2 · latest",
  "Sent quote 1" (numbered only past one); `_qvView('sent', id)` opens any
  of them and an earlier one says the link shows the latest.
  `tests/sendexact.mjs` sends twice.
- THE OPTIONS WRITE WHAT'S INCLUDED / EXCLUDED (2026-10-02,
  `_qbOptionLines`): on the modern proposal each office option adds its
  picked choice's description (else "Title — choice") after the office's own
  lines; a pick that leaves it out (`_selExtraRowIsOut`: a name like
  Exclude / None / Not included, or `row.out`) puts the option's TITLE under
  What's excluded instead. The gutter does the same while its section is on
  the quote ("Supply & install new <gutter>", or "New guttering" excluded).
  A line the office already wrote is not repeated; the generated rows carry
  `.qb-incl-auto` (suites pinning the office's own lines skip them).
- CUSTOM OPTIONS ON THE QUOTE (2026-10-02, `_qco*`, `tests/customopts.mjs`):
  `S.quote.customExtras` (Settings' extras shape) merged by
  `_selExtrasOffered` — so pricing, `share.priced`, the customer and the
  acceptance (server.js checks `quote.customExtras` too) all see them; one
  with a Settings option's id is this quote's own edit of it. "+ Insert
  custom option" (`_qcoInsertMenu`, the `__addopt` placeholder from
  `_qcoWithInsert`, office only) stands ABOVE the roof colour (else the first
  option, else Review) and offers New (`_qcoEdit(null)`) or Select from saved
  (`branding.saved_options`, plus any Settings option hidden on this quote).
  Each option section carries Edit this section (`_qcoEdit(id)`: title,
  words, 2–8 choices, first = no charge, a Recommended radio = the pick),
  Save this custom option (`_qcoSave`, upsert by title, `rec` kept) and
  Delete this page (`_qcoDelete`: removes a quote option, hides a Settings
  one via `selHide.extras`). `customExtras` is in Q_CONTENT_KEYS,
  Q_FRESH_DROP and a template's `wording`. `tests/sendexact.mjs` sends one.
- EXTRAS — INCLUDED ITEMS, ON EVERY JOB TYPE (2026-10-30, the owner: "each
  line is an included item, for instance the customer want customer coloured
  downpipes and leaf diverters ... both show as included as show the price ...
  make sure the price effects the overall quote price and make sure they show
  in the quote summary"). `S.quote.inclExtras` = [{id, name, desc, price ex
  GST}] (`_ix*`): not a choice, every line is IN. The section `inclx` ("Extras")
  goes just ahead of Review / Your total (`_ixAppend`, in `_qdSectionsRaw`,
  `_qbPages`, `_gjSections`, `_psModernSections`); "+ Insert Extras"
  (`__addinclx`, office only, while there are none) stands above "+ Insert
  custom option"; the window is `_ixEdit` / `_ixSave` (name, words, price);
  ✎ / ✕ per row, Delete this page clears them; never on an accepted quote.
  THE PRICE is in `_qpSelectionChanges` (live), `_qpSelectionChangesPriced`
  (from `share.priced.inclx`, stamped by `_qpBuildPriced` only when there are
  any, so a quote without extras stamps the same block — typesnap pins it) and
  `_poleShedSelItems`, as "Extras — <name>" rows; `_ixView()` is what is SHOWN
  and charged (the stamped list where `_qpPriced()` answers, else live), so the
  section, the summary rows, the picks ("<name>: Included", `_qbPicksAuto`
  wraps `_qbPicksAutoBase`) and the total agree. Profitability counts them at
  cost (`inclx`). The server lists them in `_quoteChoiceLines` ("Extra
  (included): …", the stamped list first) — the acceptance email and the
  Fergus description. In Q_CONTENT_KEYS, Q_FRESH_DROP and a template's
  `wording`. `tests/inclextras.mjs` (29, UI; roofing, pole shed, gutters),
  `custevents.mjs`.
  THE EDIT RAIL IS ONE COLUMN (the same day: "tidy up those buttons, make them
  in line and single row (wider if they have to)"): `_qeRailSync` makes every
  rail button the widest one's width, one line each (`white-space:nowrap`),
  all at one left edge beside the nearest block with the hands in a column,
  and widens the gutter to fit (`--qe-gutter` on `#quoteProposal`, never
  under 186px). `tests/quoteeditor.mjs`.
- THE "UPDATED …" LINE (2026-10-02): `window.APP_BUILT_AT` (UTC ISO) in
  app.html, rendered by `_appUpdatedRender` as "Updated 7:48 am 2/10" (NZ
  time, light grey, full date on hover) in the sidebar's `.hdr-right` band
  under the company block, and on the canvas label (`#appBuildLbl`). Stamped
  at every commit touching app.html by `.githooks/pre-commit` →
  `tools/stamp-build.mjs --staged`; each machine runs
  `git config core.hooksPath .githooks` once. `tests/buildstamp.mjs` fails a
  stamp more than 30 min behind app.html's last commit (skipped on shallow
  clones and an uncommitted app.html). The bug report records
  `build <APP_BUILT_AT>` too (`tests/fbcontext.mjs`).
- SETTINGS → EMAIL (2026-10-02, `tests/emailsettings.mjs` server,
  `emailtpl`/`tenantbrand`/`maildomainui` app): a Fergus-style list
  (`EMX_ITEMS`, `#emxList`, `_emxShow`, remembered in `localStorage.fr_emx`)
  of every email the business sends — Quote to customer, Quote follow-up,
  Quote accepted → customer, Invoice, Schedule updates (the old
  `#schedTplSection`, re-homed into `#emxSchedHost`, its own Save), Quote
  accepted → office, Customer asked a question, Material order — each a
  pane (`#emxPane-<k>`) with an Automatic on/off switch where it is
  automatic, Sends to (office ones), Also send a copy to (CC), Customer
  replies go to, Subject, Message, click-to-insert tags (`EMX_TAGS`,
  `_emxTag`), Reset and Preview (`_emxPreview`, sample figures). At the TOP,
  big: "Send a copy of every RoofMap email to" (`#emCopyAll` →
  `copy_all`) and the default "Customer replies go to" (`#emReplyTo` →
  `reply_to`). All under `quote_defaults.email`: `<kind>_subject`,
  `<kind>_body` ('' = the standard wording, `EMX_DEFAULTS` in app.html =
  the `*_EMAIL_DEFAULT` constants in server.js — the suite compares them),
  `<kind>_cc`, `<kind>_reply_to`, `accept_cust_on` / `accept_office_on` /
  `question_on` (absent = on, false = off), `question_to`; the old ids
  (`emQuoteCc`, `emAcceptTo`, `emOrderCc`, `emQuoteSubject/Body`,
  `emReminderOn/Days`) are kept. `_emxFill` / `_emxCollect` do the rest.
  SERVER: `_emailCopies(row, own, toList)` = the email's CC + `copy_all`,
  deduped, minus the To; `_tenantMailIdentity(row, kind)` takes the reply-to
  from `<kind>_reply_to`, then `reply_to`, then Branding email;
  `/email/send-order` takes `kind:'quote'|'order'` and adds the master copy
  (never on a practice `test:true` send); the follow-up, invoices
  (`invoice_subject`, an intro from `invoice_body` above the fixed invoice
  block), schedule sends (`sched_cc`), the question email and the office
  acceptance email (now with the company's name, reply-to = the customer,
  its own subject/body when edited, `_quoteChoiceLines` — Paint Roof and
  added roofs included) all go through it. THE CUSTOMER'S CONFIRMATION:
  `_acceptCustomerEmail(job, quote)` from `POST /q/:token/event` on the
  FIRST accept only (`_firstAccept`), to `share.sentTo` → `quote.email`;
  total, every selection, a "View your accepted quote" button, and the
  "Need a last-minute change? Please ring us on {office_phone}" paragraph
  in a yellow box (`_tplEmailHtml`). The blank-save guard keeps `copy_all`
  too. The app's quote/order windows show the master copy in their CC
  (`_emailMergeCopies`).
- THE WEBSHED IMPORT READS THE SHED (2026-10-12, the owner: "i want the
  uploaded imported webshed pdf to auto show the data in the quote ... it's
  missing the width, the length, height, number of bays"). It always was.
  `_parseShedDimsFromPdf` scraped the PDF's TEXT layer, and a WebShed export's
  text layer holds the contact block and the "View & Edit in 3D" URL and
  NOTHING else — every dimension is drawn inside each page's JPEG, so the
  scrape could never find one and those four fields stayed blank on every
  import. The size is in the PDF's own Title metadata, which jsPDF writes from
  the shed's configuration: `7.2m (W) x 12.6m (L) x 3.48m (H)`.
  `_parseWebShedTitle` reads it (falling back to the first three figures in
  WebShed's own order when the labels are missing, and to NOTHING rather than
  a guess when there is no size in it) → `psWidth`/`psLength`/`psHeight`, and
  the height seeds `hiEave` with `loEave` a fall below it so the price is
  never worked out on one height. `_parseWebShedLink` takes the 3D URL out of
  the text layer into `psDesignLink`, which already renders the customer's
  "view the design" button. THE BAY COUNT IS NOT IN THE FILE AT ALL — not the
  metadata, not the text, only drawn on the plan — so `_parseWebShedBays`
  reads it off the FILENAME (`3-Bay.pdf`, `3 bay shed.pdf`) and a file that
  does not say leaves the field blank rather than inventing one;
  `_syncSpecFromEst` then writes `psBays` as `3 @ 4.2m` and never overwrites a
  count the file gave with the one worked back out of the pole grid. Every
  field stays hand-editable, as they always were. `tests/poleshed.mjs`.
- THE ROOF'S SETTINGS COME TO YOU (2026-10-12, the owner on roof 7 of a real
  job: "i need to rotate the roof 90deg, however i don't think it easy to tell
  how to do this"). `#roofTypePanel` was a dropdown behind a 9px arrow on a
  roof button, and opening it sat in the flow and shoved the toolbars and the
  canvas down the page — so the one control he needed arrived by pushing
  everything else out of the way, if he found it at all. It is now
  `position:absolute` over the page from the roof bar, and `_roofPanelReveal()`
  SLIDES it down (`.rtp-anim`, a 0.34s drop, dropped under
  `prefers-reduced-motion`) ONE SECOND after "Draw the roof" — the roof lands
  first so the panel reads as its own event, and Rotate 90° is what a roofer
  reaches for next. It carries a full-width `.rtp-close` bar with an up arrow,
  and the roof buttons' own arrow is a 13px chip rather than a 9px glyph.
  THE GUARD IS `TOUR.open`, and it matters that it is: the 29-step tour, the
  first-roof walkthrough and the getting-started coach ALL run through the one
  tour engine, so that single flag covers every walkthrough. There is no
  `TOUR.active` and no `COACH.running` (COACH holds only `idleMs`) — both were
  written first and would have left the guard dead, sliding a panel over a
  tour card. `_onbActive()` is checked beside it. `tests/roofmenu.mjs`.
- THE STEP-DOWN GABLE'S JUNCTION BARGE RUNS RIDGE TO RIDGE (feedback report
  12, 2026-10-12: "step-down gable isnt right, the barge going down from the
  top ridge line to the lower ridge line shouldn't carry through to the
  gutter"; SETTLED by the owner 2026-10-13: "the south west long barge is
  correct, but the north west long barge shouldn't go all the way to the
  gutter"). Where two blocks meet, `buildStepGableRoofLines` carves the SHARED
  stretch out of the outline pieces and stamps it: an apron on the narrower
  block AND a barge on the wider one. His L carried a 4.93 m barge behind the
  apron, a 90 mm stub where the two ridges missed, and the real 4.85 m barge
  below the wing.
  THE STUB: splitting the shared stretch at the wider block's ridge left a
  sliver wherever that ridge does not line up with the wing's edge, and a
  90 mm flashing is not something anybody can order or fit. Anything under
  0.25 m is dropped.
  THE BARGE: it is now the stretch between the TWO RIDGES
  (`ovm = (ob.v0 + ob.v1) / 2`, clipped to the shared stretch), not the whole
  shared stretch down to the gutter — 2.42 m on his L, not 4.93 m. THE
  GEOMETRY AGREES, which is why this is a fix and not a preference: both
  blocks slope at the same pitch off the same eave line, so from the eave up
  to the LOWER block's ridge the two roof planes sit at exactly the same
  height — there is no wall standing above that roof and nothing to flash.
  Past the lower ridge its roof falls away while the taller one keeps
  climbing, and that triangle is the barge. Two ridges that line up leave no
  wall and no barge at all.
  WHY IT SURVIVED SO LONG, worth keeping: `tests/stepgable.mjs` pinned the old
  behaviour as right, from what was believed to be the owner's own sketch —
  and he has since said that drawing "wasn't my drawing, it was the auto
  drawing", so the pin was pinning the app's own output back at itself. It
  also pinned the barge LOOSELY (anywhere inside the shared stretch), so the
  bug fitted through it. Both are fixed: the pin now asserts the exact
  ridge-to-ridge extent, rotated as well.
  The order does not move — 40 sheets, measured both ways, and the
  37-shape sheet gate is unchanged. THE APRON, SETTLED 2026-10-23 (feedback
  report 18: "the length of the apron should only the the same length as the
  barge on the very far right"): it runs only where the WIDER block's roof
  stands above the narrower one's, each roof's height being its distance to
  the nearer of its own gutters. Where the two share a gutter line they are
  one plane from that gutter up to the lower ridge, so the apron is the lower
  block's ridge to its OTHER gutter: 4.85 m → 2.42 m on report 12's L, gutter
  to ridge on report 18's. A low block standing in the middle of a tall one
  shares no gutter and keeps the whole stretch. Worked from the two height
  profiles at their breakpoints, not sampled; under 0.25 m is dropped like
  the barge sliver. `tests/report12.mjs`, `tests/stepgable.mjs`,
  `tests/report17.mjs`.
- THE GABLE + HIP & VALLEY L IS TWO GABLE ROOFS JOINED AT THE CORNER
  (2026-10-23, feedback reports 17, 19 and 20, all one roof drawn three ways:
  "missing a valley"; "closing the shape up slightly breaks it"; "there should
  be another small hip on the bottom side of the horizontal ridge which breaks
  up the vertical ridge and then there should be another valley too").
  `_gableHvL(outline)` runs first in `buildGableRoofLines_legacy` and takes
  every square-walled six-corner L (in its own frame, like the step gable);
  anything else returns null and keeps the old skeleton-and-patch path. ITS
  RULE, read off his three reports and matching all three: the NARROWER arm
  runs straight through to a gable on the outside wall at both ends; the
  WIDER arm stops at the corner in a HIP END whose face is the same plane as
  the narrow arm's far slope. So a wide arm over a narrow one (17, 19) is its
  ridge to a hip end, two short hips onto the narrow ridge, and a valley each
  side — 17 had lost the outside one, 19 threw two hips corner to corner
  across the wing. A narrow arm over a wide one (20) is its ridge stopping at
  the wide arm's north slope and coming out again below its south slope to
  its own gable, the wide arm's hip end between them as two small hips, and a
  valley each side of the narrow arm — the old path ran the ridge through to
  the far wall. ARMS THE SAME WIDTH (within 4 %, or 4 px) are the classic
  corner — ridges meeting, a valley in from the inside corner, a hip in from
  the outside one — line for line what the old path drew for an equal L; an
  L drawn a few pixels off used to fall through to the skeleton and get the
  report-20 fault. Built in a canonical frame (notch top-right) and reflected
  back; barges tagged starter/finish per end, nearer foot first, as
  `buildRectilinearRoofLines` tags them. `tests/report17.mjs` (33; 21 fail on
  the old builder, every safety pin passes on both).
- A POLE SHED IN THE MODERN STYLE IS A POLE SHED (2026-10-12, found while
  building the shed's modern styling — it was not a styling gap but a live
  bug). `_qdSectionsRaw` (the one-page computer layout) and `_qbPages` (the
  phone book) are written entirely around a ROOFING quote, and neither ever
  asked what kind of quote it was. A shed set to Modern therefore rendered
  the roofing sections — steel grade, profile, thickness, colour, guttering,
  old roof, review — with NO shed content on them at all: no dimensions, no
  drawings, no consent block, no shed price. And `_quoteStyle()` falls back
  to MODERN, so a brand-new pole shed quote came out as a re-roof quote and
  that is what the customer's link would have shown. (Job 3287's screenshot
  is exactly this: Pole Shed in the job details, the roofing nav on the
  Quote tab.) Both renderers now branch on `quoteKind` to
  `_psModernSections()`. SUPERSEDED IN BOTH HALVES, and the history matters
  only as the reason the code looks as it does: the section list is now the
  one in A MODERN POLE SHED LOOKS LIKE A MODERN ROOFING QUOTE (2026-10-20)
  plus `psprofile` and `psgutter` (2026-10-21) — read that bullet, not this
  one, for what renders. And the modern sections no longer WRAP the A4's
  blocks: `_buildPoleShedPages(…, wantParts)` / `_psParts()` still exist and
  the CLASSIC document still uses them, but every `_psm*` function reads the
  shed's own helpers instead, so the facts stay shared while the presentation
  forks. Classic still renders the six A4 pages
  unchanged and a roofing quote is untouched; `tests/poleshed.mjs` pins the
  section KEYS rather than page text, because the shed's own wording
  legitimately contains phrases like "Steel grade" and "Old roof".
  THE PHONE HALF OF THAT IS DONE (2026-10-13): the A4's two-column grids
  collapse, spec rows stack label-above-value and the chapter band is cut down,
  all scoped to `.ps-body` — see the customer-total bullet. THE COMPUTER HALF
  WAS DONE ON 2026-10-20 (the cross-breed bullet above): the sections are
  `.qb-*` cards now, not the A4's typography inside them.
- TWO SHEDS ON ONE QUOTE (2026-10-12, the owner: "a 2nd import webshed pdf
  button called 'Add another plan option' ... switch between the two options
  should change the photos imported in the quote so the customer can see the
  different plans as they click between them, this should work in the quote
  and in the pricing just how the separate roofs work").
  A PLAN IS A WHOLE SHED — its drawings, its dimensions, its own price —
  stored whole in `S.quote.shedPlans[]`, and the PICKED one is copied into
  the live fields. That is the trick the rest hangs on: every reader
  downstream (the pages, the A4, the customer's frozen copy, the Fergus push,
  `_poleShedMoney`) already reads `psWidth`/`psSubtotal`/the photo slots and
  must not learn that plans exist. `_psPlanCapture` lifts the live quote into
  a plan (`PS_PLAN_FIELDS` + the three slots in `PS_PLAN_SLOTS`: hero 6,
  floor plan 1, elevations 2, plus the estimator), `_psPlanApply` lays one
  back out, and `_setPsPlan` is just the two in order — stash what is on
  screen back into the plan it came from, then lay the other one out. Nothing
  is lost either way, which is what lets the customer click back and forth.
  PLAN 1 IS THE PRICE: `_psPlanDeltaAt(i)` is that plan's subtotal less plan
  1's, shown on the option chip. The TOTAL needs no seam at all —
  switching swaps `psSubtotal` itself, so `_poleShedMoney` is already
  answering for the shed on screen and `_poleShedSelDelta` must NOT count it
  again. `_psPlanSubtotalAt` reads the LIVE field for the picked plan and the
  stored one for the others, never both, or a shed re-priced on screen reads
  at its import price.
  `_psPlanAddAnother` banks the current shed, makes a blank plan, CLEARS the
  slots and the dimension fields (a half-copied previous shed would read as
  this one's until every field was overwritten) and opens the file picker;
  `_psPlanRecordImport` runs at the end of every import so the first one
  becomes plan 1 — without it a single-shed quote carries no plan and the
  first shed would be lost to the second import — and names a plan after its
  file. The customer picks on the options page (`planPanel`, first because it
  is the biggest choice there), the office gets `_psPlanBarHtml` above the
  drawings with rename and remove. `_setPsPlan` refuses on an accepted quote.
  `tests/poleshed.mjs`.
- THE SHED'S DRAWINGS ARE THE SECOND PAGE (2026-10-12, same batch): the floor
  plan used to fill the lower half of the shed-details page while the
  elevations had a page of their own, so the two drawings a customer wants
  side by side were on different sheets. They now share one page in equal
  halves, that page is the sheet straight after the cover, and the spec page
  (renamed "Your Shed Details", chapter 2) sits below it. POLESHED_CHAPTERS
  swapped to match. Pole-shed only — `_buildPoleShedPages` runs solely when
  `quoteKind === 'poleshed'`, and nothing in the roofing document moved.
- A REPEATED OUTLINE CORNER IS NOT A CORNER (2026-10-12, feedback report 11,
  info@wellingtonroof.co.nz — he rebuilt the reports 9/10 roof on that
  morning's build, typed `lowPitch` 10, and the sheets STILL did not break at
  the change of pitch). Not the roof type: the report says `Auto roof type:
  dutch`, the path that DOES break. His outline came through as
  `[[814,465],[1633,465],[1633,827],[814,827],[814,827]]` — a plain rectangle
  with the last point stored TWICE, a zero-length edge. Everything that
  COUNTS corners then reads the wrong shape, and the one that bites is
  `if (isDutch && outline && outline.length > 4)` in `_enumSimpleGableMono`:
  the branch for a dutch on an L or T outline, which builds the roof with
  `_ccHipBandSections` + `_ccBuildCookiePlan` and RETURNS — before
  `_sgmChangePitchBands` is reached — and that model has no change-of-pitch
  pass at all. So a rectangle was sheeted as an L and measured straight
  through the line at the full 6.20 m rafter: the documented hip-path
  limitation turning up on a roof that should never have been on that path.
  Fixed at both ends: `_olDropRepeats` in sheet-plan.js drops repeated
  corners as the engine takes its copy of `DRAW.outline` (so jobs ALREADY
  SAVED come right, his among them, and both plain-average centroids stop
  being skewed by the extra point), and `_outlineDropRepeats` in
  `finishCurrent` drops them as an outline is finished, so no new one carries
  one. Under half a pixel apart is the same point at any scale the app draws
  at. A zero-length edge adds nothing to the shoelace area and nothing to a
  ray cast, so nothing already right moves — the roof with no change of pitch
  is unchanged at 82 sheets. A genuine L or T dutch still takes the hip-band
  branch and still does not break at a change of pitch; that is the
  limitation above, not this bug. `tests/report11.mjs`.
- A PENETRATION IS EDITABLE AFTER IT IS PLACED (2026-10-12, two client error
  reports from info@wellingtonroof.co.nz on build 470e22d, eight seconds
  apart: `showPenEditor` setting, then `updatePenetration` reading, `.value`
  of null). One cause: both still used `#editPenLabel`, a single free-text
  box that has not been in the page for as long as this repo's history goes
  back — the editor's markup is `editPenType` + `editPenW` + `editPenD`. So
  clicking any penetration with the select tool threw BEFORE the panel was
  filled (it opened showing the previous selection's numbers) and the type
  dropdown threw out of its own `onchange`, writing nothing. A penetration
  was place-once: the entry popup was the only way to set its size and
  nothing about it could be corrected afterwards. The editor now shows what
  the penetration IS — one Diameter for a round pipe (stored in `sizeLabel`
  as plain mm, the shape `_penDiamMm` reads to pick the back-tray), Width AND
  Length for a boxed opening (`widthMm`/`lengthMm` + a `350×850 mm` label, the
  shape `_placeBoxedPen` writes and the order line parses) — plus the
  Full/Short back-tray choice the entry popup asks for and a Delete button
  beside the Delete key. `_setPenBackTrayMode` called `autosaveJob`, which
  does not exist, so a tray switched to short on the Job Pack card was never
  saved; it schedules a real autosave now. `tests/penedit.mjs`.
- A SELECTION SURVIVES A MEASURING PASS (2026-10-12, found reproducing the
  above): `_loadRoofToCurrent` clears `selectedSection/Line/Pen` and
  `currentPts`, which is right for a real roof SWITCH — the indices point
  into another roof's arrays. But `_matEachSelectedRoof` and
  `_materialsCostForRoofIdx` walk every roof and come back through the same
  function, and they run off the back of an ordinary redraw. So a second
  after clicking a penetration the selection was gone while its editor sat
  open on screen, and every edit in it quietly did nothing; half an outline
  tapped out went the same way. `_roofScopeEnter` now puts both back when it
  restores the roof it started on. Pinned in `tests/penedit.mjs`.
- THE ROOF MAP RIDES WITH THE FEEDBACK REPORT (2026-10-13, the owner: "can
  the submit feedback also auto attached a picture of the canvas so i can see
  what they're talking about?"). The geometry already went as JSON, which is
  what makes a report reproducible — but "the roof map is not square and
  distorts ridges and hips" is a thing you have to SEE, and asking a roofer to
  screenshot their own screen is asking them to do our job. `_fbCanvasShot()`
  copies `#roofCanvas` onto a white ground (JPEG has no alpha, so an unpainted
  canvas would come out black), downscales to 1400px and returns a JPEG;
  `_sendFeedback` puts it FIRST in the PDF, labelled "attached automatically",
  with the roofer's own screenshots after it. `_feedbackShotsToPdf` takes a
  `[{src, label}]` list now rather than reading `_feedbackShots` itself.
  THREE THINGS IT MUST NEVER DO, all pinned in `tests/fbcontext.mjs`: break
  Send Feedback, attach a blank canvas (nothing drawn → nothing attached), or
  throw on a canvas it is not allowed to read — a cross-origin aerial TAINTS
  the canvas and `toDataURL` raises a SecurityError on it, which is exactly
  the roofer most likely to be reporting a roof. Every step is guarded and a
  failure costs the picture, never the report.
- A LINE THAT GOES NOWHERE IS NOT A LINE (2026-10-13, feedback report 13,
  info@wellingtonroof.co.nz: "attached satellite roof map is not square and
  distorts ridges and hips"). His roof carried SIX change-of-pitch lines, two
  of them the same point twice with `measM` null. The hand-drawn line store in
  `finishCurrent` pushed whatever two points it was handed, so a double-tap —
  or a click landing twice on one snap point — stored a line with no length:
  nothing is drawn, so nothing can be clicked to delete it, and it is not
  harmless, because `_roofHasChangePitch` reads the LIST. Two invisible ones
  are enough to tell a roof it changes pitch, show the Lower pitch box and
  send the sheet engine down the band path. Ends under half a pixel apart are
  the same point at any scale the app draws at — the rule `_olDropRepeats`
  already applies to outline corners. `tests/roofmeasure.mjs`.
  THE REST OF REPORT 13 IS NOT A BUG AND NEEDS THE OWNER. That roof carries
  TWO COMPLETE STRUCTURES: an unmarked ridge + 4 hips, and the app's own
  `autoGenerated` gable (ridge, 2 gutters, 4 barges) whose ridge sits 0.74 m
  from the hip one — which is exactly what "distorts ridges and hips" looks
  like. It is NOT the stale-structure bug of report 64: stripping the
  `autoGenerated` mark and regenerating was tried and clears correctly. The
  report says `Tool in use: hip`, so he was DRAWING the hips by hand, and the
  app keeps hand-drawn lines on purpose ("lines drawn elsewhere stay"). He was
  fighting an auto roof that did not match his building — his own first
  sentence is "Can we overwrite dimensions & manually move preset flashing
  lines". Whether hand-drawn structure should REPLACE the auto structure is a
  product decision, not a fix; ask him. CORRECTED 2026-10-14: the note here
  used to add "`Roof image: none` on that report" — that field was broken and
  read `none` on EVERY report ever sent (see the bullet below), so it was no
  evidence either way. His outline being a perfect axis-aligned rectangle
  still stands, and still means no amount of squaring the picture would have
  helped.
- SCOTT'S QUICK WINS (2026-10-13, info@wellingtonroof.co.nz, relayed by the
  owner; `tests/quickwins.mjs`). Four things a roofer could not do, and one
  button that was not where a roofer looks.
  AN APRON COULD NOT BE LABELLED FROM THE MAP. Clicking a line on the canvas
  opens `promptLineMeasurement`'s popup; its `typeOpts` held seven PLAIN types
  (`unknown ridge valley gutter hip barge outline`) while the sidebar editor's
  `#editLineType` offered fourteen with subtypes. So a head apron the app had
  drawn read "Unknown" on the one surface a roofer actually clicks, and the way
  to say what it was lived somewhere they were not. The two lists are now ONE
  (`LINE_MEAS_TYPE_OPTS`, beside the popup it feeds — change one and change the
  other) and the popup reads the compound `type|subtype` value back the way
  `updateLine()` does, so the cut list's barge/apron split works from either
  surface. A type changed with NO figure typed re-derives `measM` from `planM`
  at the new type's slope factor: an apron lies level where a barge runs up the
  rake, so the metres belong to the type that was set.
  A SAVED JOB COULD NOT BE FOUND BY ITS NUMBER. Both boxes matched
  `client_name + site_address`, and `GET /jobs` never sent a number at all —
  the number lives in `draw_state.state.quote.ref` — so there was nothing to
  match, while the Home box's placeholder has always said "client, address or
  job number". The list now carries `job_no:draw_state->state->quote->ref` (a
  jsonb path, the way the schedule board reads it, so the multi-megabyte column
  stays in the database) on BOTH column lists, so neither the un-migrated
  fallback nor the timeout retry drops it. `_savedJobMatches(j, q)` is the one
  matcher both boxes use; digits on their own match loosely (`3287` finds
  `03287`), and both surfaces SHOW the number they can now be searched by.
  THE SHEET CALC CHECK IS A PAGE OF THE PACK (`calccheck`,
  `_jpRenderCalcCheck`). It was only ever a picture to place by hand from the
  Maps panel, so the page that proves the sheet count was missing from every
  pack nobody had thought to place it on. It reads the SAME sections the panel
  reads (`window._lastSheetSections` via `_jpCaptureCalcCheck` /
  `_jpCaptureCalcCheckCombined`), covers the roofs the pack covers, and sits
  AFTER the cut lists because its own last line reads "should match the cut
  list above". New packs carry it; the v6 -> v7 migration appends it to an
  existing pack ONLY where it is still the shipped shape (`header,cutlists`)
  and no calc-check picture has been placed — a pack the office has arranged is
  theirs. With nothing worked out yet the engine's own "nothing to check yet"
  card renders, so the page is never a blank box.
  THE MAP'S DETAIL LABELS HAVE A SIZE (`fr_detail_text_scale`,
  `_detailTextScale()`, "Details text" in the View menu beside Sheet text and
  Outline text). A penetration's size (9px), the back-tray it calls up (8px)
  and a clearlite's length (10px) were hard-coded while the measurements and
  the sheet lengths each had a slider. 8px is not a size you read off a phone
  on a roof. The boxed penetration's label keeps its shrink-to-fit — the slider
  raises the cap, the box still decides what fits.
  SAVE IS IN EVERY VIEW (`#navJobSaveBtn` in `#navJobBox`). It was on Map
  Roof's site toolbar and inside three windows, and nowhere on the Job Pack or
  the Quote tab. The left menu is on every tab, so this is. ALWAYS shown,
  including on a job never saved, which is the job that needs it most;
  `saveCurrentJob` carries its own guards and `_saveClick` says what happened.
  ANSWERED, 2026-10-20: "snap grid kept at maximum zoom" was in that list and
  was too vague to act on — the grid is already screen-constant at every zoom.
  Scott clarified: "to clarify I'm thinking it's the contrast of the grid, the
  thin light blue lines could be darker contrast to allow better snap /
  alignment with structure edges". He is right, and the cause was not the
  colour: the snap grid was painted BEFORE the aerial, so the photo went
  straight over it. On the one job where a grid earns its keep — lining an
  outline edge up with a wall — there was nothing to line up with. It is
  painted AFTER the picture now, in mid-slate, and its ink follows what is
  behind it (0.42 over a photo, 0.17 on a blank page: measured line-against-
  ground contrast 1 → 14 over an aerial, and barely moved on white, where the
  old pale grid was right). Screen-constant at every zoom, exactly as before.
  The ALIGNMENT grid stays orange and stays louder — that one is only up while
  the rotate slider is being dragged and is meant to be shouted.
- A HEAD BARGE seeds a sheet measure on the map (roof side only).
- MAP ROOF, 2026-09-25 (`tests/roofmeasure.mjs`): the roof image boxes are
  always open with no frame (`_setRoofBg` forces open; `#roofBgBar`
  hidden); Roof map history moved into the History popup (`#jobHistModal`,
  folded) — it is the door onto the job's backups, so it is kept. The
  BUILDING OUTLINE tool never selects a line on its first click (only the
  section tool does). THE MEASURING TAPE (`#btn-tape`, tool `tape`):
  `DRAW.tapes = [{a, b}]` in image px (saved in the draw block, in undo,
  cleared by clearAll), click-click placement snapped level/plumb (Shift =
  free), drawn by `_tapeRender` (grey, end ticks, outward arrows, the length);
  selected (`DRAW.selTape`) it has end handles, a rotate handle (turns about
  its middle, keeps its length, catches square angles) and a red ✕; drag the
  line to move; Delete/Esc. `_tapeMouseDown/Move/Up/Click` come first in the
  canvas handlers; it is a drawing aid, nothing counts it.
- PRICING, 2026-09-25 (`tests/pricebookpick.mjs`): any material row's
  $/unit is an input — a price typed for THIS job (`MATERIAL_OVERRIDES[k]
  .price`, read by `_matOvPrice` at every site: the table, the materials
  total, the job bar, the Fergus lines). MATERIAL_OVERRIDES /
  MATERIAL_DELETED are now SAVED with the job (`state.matOv` / `matDel`),
  reset on restore and clearAll (they used to leak into the next job and die
  on reload). Custom lines are qty × unit (`amount` stays the total every
  reader uses; old lines read as 1 × amount; `_qCustomNorm`), and their
  autosave works (it called a missing `autosaveJob`). "📖 Add from price
  book" beside every "+ Add custom line" opens THE PRICE BOOK WINDOW
  (`_pbPickOpen(area)`, `#pbkModal`): Custom Price Book items with search,
  folders on the left (`custom_book.folders`, item `.folder`), edit mode with
  Add folder / ✎ / ✕, Ctrl/Shift selection and drag onto a folder (or move
  to…), and a Defaults tab whose "Change default item" links an item to a
  RoofMap default (`_cpbLink`). Also on Settings → Custom Price Book as
  "Folders & defaults".
- THE THREE PRICING TABS EACH SAY WHAT THEY ARE (2026-09-30): Quote's
  Product Options is the CHOICES (grades, profiles, gutters a customer picks
  between), Default Items (`set-defaultpricing`) is the PRICES of
  everything RoofMap measures off the roof, Custom Price Book is the
  supplier's own list that can take over any of those prices. Each opens
  with one line naming the other two — keep those three lines in step when
  anything moves between the tabs. Default Items runs in one order:
  supplier upload, roofing by grade, underlay (products + $/roll together),
  fixings (screws + rivets + the screw products), guttering and downpipes,
  pipe penetrations, one-off items, backup last. `#pbExtrasList` is "One-off
  items you add yourself" — it is NOT the Custom Price Book and must never
  be named as if it were. The two uploads are different on purpose: this
  tab's CSV (`#pbUploadFile`, `handlePriceBookUpload`, `tests/pbcsv.mjs`)
  writes straight onto RoofMap's own items; the Custom Price Book's keeps
  the supplier's list as its own and links a line to an item.
- THE JOB'S LOCK IS IN THE LEFT MENU AGAIN (2026-09-30), under the selected
  job: `#navJobLockSide`, a plain status strip, not a coloured button. Locked
  with the quote sent it reads "Locked — Quote sent" with a small green tick
  (`_quoteWasSent()` = `share.sentAt`), and `#navJobMore` then reads "Click
  for new version or info" instead of "Click for more info". The button
  inside the job details window (`#navJobLockBtn`, moved there 2026-09-29)
  stays; ONE renderer, `_jobLockRender`, draws both and the chip's wording,
  and `_qvMarkSent` calls it. `tests/joblock.mjs`.
- THE HISTORY WINDOW SITS ABOVE THE JOB DETAILS WINDOW (10048/10049 against
  9998/9999): History is opened from a button inside that window, and at
  8999 it opened behind the thing that launched it.
- A TYPED PRICE MAY BECOME THE DEFAULT (2026-09-30, `tests/pricebookpick
  .mjs`): the material row's $/unit goes through `_matPriceTyped(ovk, path,
  bookPrice, value)` — it sets the job override as before, then asks "Would
  you like to save this as the new default price?" whenever the typed figure
  differs from the book's by more than half a cent, both on a row with no
  price and on one whose price changed. Yes runs `_matSaveAsDefault`: the
  figure is written into the set the job is priced from (a steel grade with
  its own prices keeps its own, else the book), `renderPriceBookUI()` puts it
  on the Settings inputs so the save reads it back, then `saveSettings(true)`.
  A row priced from a Custom Price Book item is NEVER asked — `_cpbApply`
  would write the item's price back over the answer at the next save. The
  render passes the path (`_cpbPathForVariant`) and the book price down, so
  the question knows its row without rebuilding the table.
- RIDGING HAS TWO WIDTHS (2026-09-30): the Ridge / Hip cap row is a real
  two-option row — `standard` at `price_book.ridge_lm`, `wide` at
  `ridge_wide_lm` (a graded key, its own Settings input `#pbRidgeWideLm`, its
  own PB_CSV_TARGETS pattern ahead of the plain ridge one, and 0 until the
  owner prices it). The pick starts from the job's `#orderRidging` choice and
  `_onMatOverride` writes it back there, so the cut list and the price never
  disagree.
- DEFAULT ITEMS is its own Settings → Pricing sub-tab (named "Default item
  pricing" until 2026-10-20; `set-defaultpricing`, 2026-09-30): the price
  book block moved out of the
  bottom of Quote's Product Options, where nobody looking for a price found
  it. `set-pricebook` (the wizard, old links, the suites) is an alias for it
  now, and it is what `openPriceSettings()` opens; Quote's Product Options
  keeps the products list alone.
- EVERY SIDE PANEL SITS OVER THE PAGE (2026-09-30, the owner's): Photos,
  the Job Pack maps and Pricing never squeeze the page — `_setPopReserve`
  keeps only the toggle strip (72px) whatever it is passed, and a drag on a
  panel's edge (`_sidepopResizeStart`) widens it over the page. On the Quote
  tab Pricing stops 46px short of the right edge so the folded PHOTOS tab
  never covers it. The open Photos panel therefore covers the right of Map
  Roof (the sample-job banner's button, the canvas's right third): UI
  suites that click there fold it first (`_fergusPanelClose()`).
  EXCEPT THE JOB PACK (2026-10-01): there an open Maps or Photos panel
  reserves its width again (`_setPopReserve` on `data-tab=materials`, and
  `_jpRoom` while dragging), so the pages move left clear of it — and
  `_fitDocZoom` always sizes them from the width WITHOUT a panel (reserve 72),
  so their zoom never changes; `.jp-pages` is `align-items:safe center` so a
  page wider than the room lines up left instead of under the menu. PHOTOS
  STARTS CLOSED on Map Roof (2026-10-01): it opens only once opened in this
  session (`fr_fergus_panel_open === '1'`). `tests/photoviewer.mjs`,
  `tests/bgclear.mjs`.
- THE OUTLINE SNAPS SQUARE BY ITSELF within `AUTO_SQUARE_TOL_DEG` = 20°
  (back to the original on 2026-10-01 after 6° and 12° — the owner: "roll
  back to the old snap points"). An outline OUTSIDE it (a dog-leg, a splay)
  is not squared but LINED UP: `_outlineSnapParallel` groups the walls by
  direction modulo 90° within `PARALLEL_SNAP_DEG` (10°), gives each group
  its length-weighted direction and rebuilds the corners where the walls now
  meet (no corner further than 12% of its shorter wall, or nothing moves).
  A corner DRAG on such an outline uses `_stretchParallelOutline` (every
  wall keeps its direction) instead of the square stretch, which flattened
  the bent wing. Picking Building outline shows the Shift tip (`#shiftTip`,
  "hold Shift … to turn the snapping off", `fr_shift_tip_off`). The snap
  while drawing (`snap()`, `SNAP_AXIS_PX` 24) has not changed since
  2026-09-07. `tests/report60.mjs`, `tests/squarecorner.mjs`.
- THE QUOTE'S SUMMARY IS THE OFFICE'S TO WORD (2026-10-01,
  `tests/quotesummary.mjs`): "Edit summary" (`QE_INLINE.summary`,
  `_qsumOpen`) on the Your-quote section — the main line's words
  (`S.quote.summaryBaseLabel`, read by `_custBarRows`) and "What you chose"
  as `S.quote.summaryPicks = [{k, label, value}]` (a `k` row is an automatic
  pick, its blanks following the customer's choice; no `k` = the office's own
  line). `_qbPicks()` applies them over `_qbPicksAuto()` (keyed
  [label, value, key]); a section deleted from the quote (`_qModernParkedKeys`)
  takes its pick with it — AND ITS PRICE (`_qpSelectionChanges` and, not on
  an accepted quote, `_qpSelectionChangesPriced` skip a parked grade /
  profile / thickness; `_qbSectionRemove` puts the pick back to the standard
  one, like the gutter). The priced lines' words are editable too
  (`S.quote.summaryRowLabels`, keyed by the line's own label, read in
  `_custBarRows`; the money never). Saving the automatic list deletes the fields. Both
  are in Q_CONTENT_KEYS and Q_FRESH_DROP. AN OFFICE OPTION (extra group) shows
  its pick (`_qbExtraGroup` hands `current` the row's ID — it was handed the
  row, so nothing ever showed picked) and Recommended on the roofer's pick
  (`_qbExtraRec`, `recommended.extras` stamped with the other choices — it was
  always the first row).
- SAVE AS TEMPLATE on the Quote tab (2026-10-01, `#qaSaveTplBtn`,
  `_qtSaveQuoteAsTemplate`): names the open quote (the proposal title offered,
  a same-named template replaced only on "Replace template") into
  `branding.quote_templates` and saves Settings. `_qtSnapshot` carries
  `wording` too — proposalTitle, custDesc, custExcl, summaryPicks,
  summaryBaseLabel, selHide — and `_qtApplySnapshot` sets every one of them
  from a template that has `wording` (deleting what it lacks). Never prices,
  the customer or photos. "QUOTE LAST SENT TO FERGUS" (`S.fergusSent`) is
  the job's own: reset on opening a job (before its state is assigned) and on
  a new job, and redrawn (`_renderFergusSent`) — it showed the previous job's
  date. `tests/quotesummary.mjs`.
- A HIP END ON A GABLE (report 61, 2026-10-01, `tests/report61.mjs`): a
  selected gable-end barge's popup offers "Convert this gable end to a hip
  end", a hip on such an end the way back, and on a plain RECTANGULAR hip
  roof a hip offers "Convert this hip end to a gable end" (the roof becomes
  a gable whose OTHER end stays hipped). `DRAW.hipEnds = {starter, finish}`
  per roof (ROOF_FIELDS, the draw block, snapshots; reset by clearAll and by
  picking a shape or rotating, like ridgeBreaks; `DRAW._keepHipEnds` guards
  the hip→gable regen). `buildGableRoofLines` = `_applyHipEnds(
  _buildGableRoofLinesBase(...))`: an end that is two barges meeting at a
  ridge end loses them, its wall becomes a gutter, the ridge stops short by
  the run (45° in plan; both ends on one ridge meet at most in the middle)
  and two hips run up — lines flagged `hipEnd` (in LINE_FLAG_KEYS). Works on
  the straight gable and the dog-leg. REPORT 64: a conversion first runs
  `_hipEndClearStructure()` — every ridge/hip/valley the gable builder (any
  end combination) or the hip builder would draw on this outline goes,
  autoGenerated or not (a roof carried an earlier structure without the mark
  beside the new one, and its stray ridge split the hip end's gutter into
  barges); lines drawn elsewhere stay. A starter/finish barge offers the
  conversion without the autoGenerated mark. `tests/report64.mjs`. The sheet count does not change (the
  hip end is cut from the same sheets).
- THE DOG-LEG GABLE (report 60, 2026-10-01, `fixtures-report60.json`): a
  gable on an outline that is a bent STRIP (`_doglegStrip`: 2(k+2) corners,
  two long sides pairing across at each of k bends, each wing's two sides
  within 12°, each bend 8–80°, the ends within 30° of square) is drawn by
  `buildDoglegGableLines` from the top of `buildGableRoofLines` (only when
  the outline is NOT rectilinear at 20°, so no square gable ever reaches
  it): a ridge down each wing's centre line meeting where they cross, a
  VALLEY from the inside (reflex) bend corner and a HIP from the outside one,
  gable barges (starter/finish) on both ends. The ridges carry `dogleg`
  (in `LINE_FLAG_KEYS`). The sheet engine (`_doglegSections` in
  sheet-plan.js, ahead of the ridge-claim) counts each wing square to its
  own ridge: each slope its own span along the ridge ÷ cover
  (`_sheetsAcross`), at that wing's run, plus one valley spare — 7+7 @ 2.11
  and 5+5 @ 2.02 + 1 = 25 on the report's roof.
- GUTTER PRICES (2026-09-30): 125mm Colorsteel box gutter is ONE row at
  `gutter.box125_lm` ($21/lm, BRACKETS INCLUDED) plus an 80mm dropper every
  8 m (`dropper_ea`); Marley Classic is itemised like Typhoon
  (`classic_spouting_lm`, `classic_bracket_ea` one per 500 mm, outlets,
  joiners, angles, stop ends — NZ retail less GST until the owner types
  trade prices; `_gutterClassicInv`). `_gutterSupply` answers 0 for "not
  priced" so a blank never reads as free. A custom line on the gutter card
  (`_qCustomTotal('gutter')`, `_gutterCustomBase`) is part of the GUTTER —
  in `_gutterMaterialCharge`, the card, the profitability cost and the
  Fergus gutter lines — never pushed as a separate quote line (it used to
  move the quote's total and not the Pricing tab's). `tests/gutterprice.mjs`,
  `tests/chainwalk.mjs`, pricegold regenerated.
- GETTING STARTED (2026-09-30, `startCoach`, tour kind `'coach'`,
  `tests/coach.mjs`): a new account (`ui_flags.first_roof === 'offer'`)
  meets a welcome (guides in Settings → Guides), then pointers on its OWN
  roof: the picture box (quiet while the aerial finder / PDF picker is up)
  until `DRAW.bgImg`; ZOOM + DRAG (`c-zoom`: the Zoom buttons and the canvas
  both lit — a step's `also` is the second ring `#tourRing2` — waiting on
  `DRAW.zoom`/`IMG_OFFSET`, `manual` so it never jumps on mid-drag, card
  ABOVE the controls via `side:'top'`); ROTATE (`c-rotate`: the Rotate bar
  and the canvas, "snap points work best when the picture is square to the
  canvas", waiting on `IMG_ROTATION`/`IMG_FINE_ROTATION`); Building outline; NOTHING while corners go in (a step's
  `quiet()` hides the whole card) until 4+ corners and 2.5 s idle
  (`COACH.idleMs`) → "press Enter"; silent over the roof-type window; the
  real-measurement tip; Job Pack; Quote; a last card (guides,
  support@roofmap.co.nz, the Help bubble). Photos folded, sample banner held
  back. EVERY SIGN-IN until "Don't show this again" (2026-10-01, the
  owner's): any account whose `ui_flags.first_roof` is not `'never'` gets it
  once per sign-in (`sessionStorage.fr_coach_seen`); Finish = `done` and
  Not now = `stopped` close it for this sign-in only; the button on the first
  and last cards (`__coachNever`) or the footer tick (`#tourDontShow`, read
  BEFORE the card is removed) write `'never'`. No flag from the server = no
  guess, nothing starts. Settings → Guides → "RoofMap tutorial in 60sec"
  (`data-tour="set-coach"`) runs it on demand. The practice job is Settings →
  Guides only (a practice walkthrough left part-way still resumes). The
  walkthrough answers (`fr_first_roof`, `fr_first_roof_at`, `fr_tour_done`,
  `fr_about_done`) are wiped by `_frWipeBusinessLocal` at every sign-in/out
  — the owner's own "done" on his laptop swallowed a new trial's welcome.
- THE SUPPORT DESK (2026-09-30): the Help bubble offers an unanswerable
  question to "a real person" (and has a "Talk to a real person" chip);
  `POST /support/messages` stores it (`support_messages`: company_id,
  user_id, sender user|support, author, email, company, body, read_at — one
  conversation per user_id) and emails support@ with Reply-To them. The
  owner answers on `/admin/support/page` (the API's origin; admin token or
  an ANALYTICS_OWNERS login, like analytics) → `POST /admin/support/reply`
  stores it and emails them the CONVERSATION (their messages and the
  replies, text + HTML) as `platform:true` from support@roofmap.co.nz — and
  NEVER from Flood Roofing (the owner, 2026-10-01: "it can never come from
  Flood Roofing"): held until the platform can send as roofmap.co.nz, and
  the page says so; the bubble pops the reply open either way. The bubble polls `GET
  /support/messages` every 90 s and POPS OPEN on an unread reply (once per
  page, `SUP.popped`), marking it read. After every answer it asks "Did this
  help?" — "No — connect me with a real person" sends their question with
  the chat so far (`transcript`, in the email to support@ only); the header
  carries "Message a real person" (`#frHelpPerson`); the suggestions fold
  away once the chat starts.
  `tests/supportdesk.mjs`, `tests/helpsupport.mjs`.
- THE CANVAS COACH (2026-10-12, the owner: "after i've either imported the
  satellite image to the canvas or upload a picture from fergus/pc upload, the
  first action it the building outline, however the first action should be the
  move button to first locate the image properly"). Four hints in order, each
  waiting on what the one before it asked for: a big "Drag the roof to centre
  it" over the top of the canvas, gone the moment they press on the picture;
  one second after they let go, "Now zoom in on the roof" ringing the + button;
  one second after the LAST zoom click (every click restarts the wait), "Square
  the building up" ringing the Rotate background image slider, whose wording
  changes to "Outlines work best when building is square" the moment it is
  touched and which clears two seconds after they let go; then, only if nothing
  is drawn yet, "Now outline your Roof" on the Building outline button.
  `CC`, `_ccStart`, `_ccShow`, `_ccPlace`, `_ccOn(what)` — one entry point the
  hooks call (`_applyCanvasBg` with NO stored view, `onCanvasMouseDown` /
  `onCanvasMouseUp` while panning, `adjustZoom`, the slider's pointerdown /
  pointerup, `setTool('outline')`, `clearAll`).
  A SATELLITE CAPTURE DOES NOT GO THROUGH `_applyCanvasBg` — `placeBlob` sets
  `DRAW.bgImg` itself, deliberately, to skip a canvas conversion — so
  `_afterAerialPlaced` starts the coach too (and `applyAerialToCanvas`, the
  older tile path). Without that it missed the ONE path the owner was on when
  he asked for it.
  DELIBERATELY NOT THE TOUR ENGINE: that claims the onboarding arbiter and
  runs once per account, and these come back with EVERY picture ("these should
  appear all the time except when in any tutorial or guide or onboarding
  mode"). `_ccSuppressed()` READS the arbiter rather than claiming it
  (`_onbActive()`, `TOUR.open`, `#tourWrap`, `#setupWizard`, `#setupGuide`,
  customer mode). The card is `pointer-events:none` apart from its ✕ — it must
  never swallow the very drag it is asking for — and the ✕ hides the tips for
  THIS picture only, because nothing is written down. `_ccStart` picks the Move
  tool, because `onCanvasMouseDown` returns unless `DRAW.tool === 'select'` and
  a drag would otherwise drop an outline corner. `tests/canvascoach.mjs`.
  A FIFTH STEP, THE FINE ADJUSTMENTS (2026-10-13, the owner: "add a step
  between 3 and 4 ... when they have finished sliding the bar across, have a 1
  second delay then add a step to click the fine rotate adjustments, 2 seconds
  after the final adjustment (timer restarts on every click) then do step 4").
  The slider gets a roof close to square; `−.1` / `+.1` are what land it, and
  nothing pointed at them. One second after the slider is let go the card rings
  `#rotImgFine`; every nudge restarts a two-second wait, so a run of clicks is
  never cut short; then step 5. `_nudgeFineRotate` is where the hook lives
  (not the two buttons' onclick) so the typed box and Reset report the same
  way, and `_rotImgClose` reports `finedone` — "Done" is the roofer saying the
  angle is right, so the coach does not sit out its two seconds waiting for a
  nudge that is not coming. A STEP WITH NOTHING TO POINT AT IS SKIPPED, never
  shown ringing the top left corner: that row is hidden until the slider opens
  it and "Done" closes it again, so `_ccShow('fine')` falls through to the
  outline step when `#rotImgFine` is not on screen — without that the sequence
  would STRAND there, the outline hint waiting on a nudge that cannot be made.
  AND THE LAST CARD TAKES ITSELF AWAY after four seconds (`CC_OUTLINE_MS`;
  "only show that build outline box for 4 second then make it disappear") —
  the four before it wait on the roofer doing the thing they ask for, but this
  one asks for a click on a button that stays lit for the rest of the job.
  NOTHING ELSE DROPS OPEN OVER THE FIRST CARD (2026-10-15, the owner: "stop
  the 'canvas view' popdown window from opening automatically as soon as i've
  used a satellite image or uploaded a background image, just run through the
  5 steps"). `_afterAerialPlaced` opened the CANVAS VIEW menu (`#viewMenu`,
  the "Edit font size" button) by itself 350 ms after a capture, and the
  first-roof walkthrough's `adjust` step and the playground's
  `_tryPictureReady` did the same — all three from the days when the rotate
  control lived inside that menu. It has not since 2026-09-24 (`#rotImgWrap`
  is its own slider on the toolbar), so what dropped open over the coach's
  own "Drag the roof to centre it" card was Snap to grid and three text-size
  sliders: nothing to do with squaring a picture up. All three opens are
  gone; the menu opens on its own button and only there. `closeViewMenu()` in
  the walkthrough's outline step is kept — a menu the roofer opened by hand
  should still shut before the outline card points at the button under it.
  `tests/canvascoach.mjs`, and the two suites that had pinned the menu OPEN
  (`playground.mjs`, `onboarding.mjs`) now pin it shut.
- THE ROOF SETTINGS PANEL IS PLAINLY A LAYER (2026-10-13, the owner: "change
  the background colour of the drop-down 'Roof settings' window ... it looks
  confusing and doesn't look like a collaspable menu, looks like the key
  buttons have just disapeared"). `#roofTypePanel.rtp` was WHITE, hanging over
  a white page: a 1px `#e3e6ea` line and a soft shadow were the only things
  saying it was on top, so it read as the toolbars having vanished and some
  controls appearing where they used to be. It is tinted slate (`#eef3f9`),
  edged `#b9c7d8`, and carries a 3px `#0099cc` top border — the same "this is
  a layer" language the quote page's navy bands use — and `.rtp-close` is
  solid navy, because a pale grey bar on a tinted panel no longer reads as a
  button. `tests/roofmenu.mjs`.
- THE ROOF PANEL SHOWS ITSELF AND PUTS ITSELF AWAY (2026-10-14, the owner:
  "only show it for 3 seconds then do a 0.5 second collapse time to show the
  user it collapses, also do a 0.5sec open time aswell, can you also narrow it
  up"). The panel exists to say "the roof's settings live here, and Rotate 90°
  is one of them"; once said it is over the drawing. `_roofPanelAutoHide` gives
  it 3 s, then `.rtp-anim-out` (`rtpLift`, 0.5 s) and `display:none`. The slow
  fold is the POINT — a panel that vanishes teaches nothing about where it
  went; one that visibly folds says the roof button brings it back.
  ONLY THE AUTOMATIC REVEAL CLOSES ITSELF: `_toggleRoofMenu` cancels the timer,
  so a panel opened on purpose stays until it is closed. AND IT NEVER CLOSES
  UNDER THEIR HAND — `pointerenter`, `pointerdown` and `focusin` drop the timer
  for good, because three seconds is barely time to read the row, let alone
  reach it, and a menu that shuts while you are reaching for it is worse than
  one that never opened.
  NARROWER: it was pinned to both edges (`left:.75rem; right:.75rem`), so on a
  wide screen the controls sat in the left third with Delete roof flung to the
  far right and a metre of tinted nothing between — which reads as a page, not
  a dropped menu. `width:max-content`, anchored left, capped at
  `min(1100px, 100% - 1.5rem)` so a long roof or sheet name cannot force a
  needless wrap. `tests/roofmenu.mjs` pins the width and the 0.5 s open.
- THE ROOF PANEL NO LONGER CAUTIONS ABOUT THE TYPE (2026-10-13, the owner:
  "remove the warning caution about the roof type in orange in the roof
  settings that appears"). `#roofTypeHint` was an amber box that appeared
  whenever a gable or a mono-pitch was picked on a footprint with an internal
  corner — "a wing may end up without its own ridge. Consider Hip & Valley".
  The roofer picking the shape is the one standing on the roof, and the
  step-down gable, the dog-leg gable and the gable↔hip-end conversions have
  all since made a gable on a non-rectangle an ordinary thing to want, so it
  argued with a correct choice. The element, its `site-mode` hide rule and the
  function's body are gone; `_updateRoofTypeHint` stays as an empty stub
  because six call sites reach it from the redraw and roof-switch paths.
  `suggestRoofType` still uses `_roofReflexCount` to OFFER a type in the
  outline popup, which is an offer and not a warning.
- THE SUPPORT BUBBLE'S FIRST READ KEEPS TRYING (2026-10-13). `supportStartPolling`
  fired its first read ONCE, at four seconds, and `supportAvailable()` wants
  `window.api` — which lives in app.html, 60k lines a loaded machine may still
  be parsing at that mark. When it was not ready the one read was dropped and
  the next was NINETY SECONDS later, so a reply waiting for them sat unseen
  that whole time. It retries every 1.5s until it goes, giving up after ~45s.
  BE ACCURATE ABOUT WHAT THIS DID AND DID NOT FIX: it is a real latent bug on a
  slow machine, but it was NOT the cause of `helpsupport` failing about one run
  in six. That was the SUITE: `addInitScript` was on the first page rather than
  the CONTEXT, so the second page — the "signing back in" one — got `fr_token`
  only if `file://` localStorage happened to carry over, which in Chromium it
  does not reliably do. Instrumented rather than reasoned about: the failing
  runs report the token missing and ZERO polls. On the context now; eight runs
  green where it used to fail one in six. It had taken a promote down with it
  twice.
- A TAB IN THE BACKGROUND STILL READS ITS MESSAGES (2026-10-13,
  `help-bot.js`): `supportStartPolling`'s FIRST read carried the same
  `visibilityState !== 'hidden'` test as the 90-second repeats, so a tab the
  browser restored on start-up, or one opened behind another, skipped it — and
  a support reply waiting for them sat unseen until a tick happened to land
  while that tab was in front. The first read is unconditional now, the repeats
  still skip a hidden tab, and a tab coming back to the front reads again
  (throttled to 20 s) rather than waiting out the rest of its ninety seconds.
  This is also what made `tests/helpsupport.mjs` fail about one run in three —
  Playwright's second page boots hidden — including the Tests run that skipped
  a promote on 2026-10-13. Pinned there with a page that boots hidden.
- EVERY ROOF PRICES LIKE THE MAIN ROOF (2026-10-12, the owner: "the add
  custom material line or from price books has disapeared from the addition
  roofs ... please check every other thing from the main roof is on the
  additional roofs too"). Three things were main-roof-only and are now on
  every pricing tab: "+ Add custom line" / "📖 Add from price book" on roof
  materials, roof labour AND scaffolding, and "+ Add labourer".
  CUSTOM LINES ARE KEYED BY THE TAB, not just the area: `S.quote.customLines`
  holds the main roof's under the bare area name (so every quote written
  before this prices exactly as it did) and an extra roof's under
  `'<area>#<idx>'` — `_qCustomArea(area, idx)`, `_qCustomBaseArea`. One store
  keyed by area alone is WHY they were hidden: the same line would have shown
  on every tab, so $800 of asbestos disposal typed on the Asbestos Roof would
  have grown the main roof's materials by $800 too. The main roof's lines
  still reach the quote as line items of their own
  (`_syncQuoteBaseLineItems`); an EXTRA roof is priced as a lump, so its lines
  go INSIDE that lump — `_roofCustomTotal(area, idx)` answers 0 for roof 0 and
  nothing is ever counted twice. Material's goes on AFTER the grade factor (a
  typed $ figure is not graded steel); labour's is inside
  `_labourPriceForRoof` / `_labourCostForRoof`, the one seam every reader goes
  through. FOLDING a roof in takes away its tab, so `_setRoofMode` moves its
  lines onto the main roof's (`_qCustomFoldInto`) where they stay visible and
  can be taken off; `_qCustomBaseLines(area)` prices the main roof's plus any
  folded roof's for a job saved before that. `_qCustomRemap` is in
  `_roofRemap`, so the lines move when the roofs are renumbered and go when
  the roof is deleted. The Fergus push and the pricing CSV read the same
  helpers. EXTRA LABOURERS are per roof too (`_roofLabourExtras`,
  `_addLabourerTo`, `_updateLabourerOn`, `_removeLabourerFrom`; the three bare
  names stay as roof-0 wrappers) — a crew taken on for the asbestos strip is
  that roof's cost, not the house's. `tests/roofcustom.mjs`.
- EACH ROOF MAY BE CHARGED AT ITS OWN RATE (2026-10-12, the same morning:
  "let me adjust my labour hourly rate seperately on the different roofs it's
  currently locked and says shared, i want to be able to price a base price on
  the main roof then a cheaper labour price for the optional roofs"). An extra
  roof's Lead/Apprentice cost and charge-out boxes were read-only, printed
  "shared". They are inputs now: `_roofLabourRates(idx)` takes the main
  table's rates and lets `S.quote.roofLabour[idx].leadPrice/appPrice/leadCost/
  appCost` override any of them, `_setRoofLabourRate(idx, key, val)` writes
  one and a BLANK (or the ↻ beside it) deletes it so the roof goes back on the
  shared rate — a rate left alone follows the main table, so no quote that
  already exists moves. A roof on its own rate says THIS ROOF in purple.
  `tests/roofcustom.mjs`.
- WHAT THE ROOF ON SCREEN COMES TO, beside the frozen roof map (2026-10-12,
  the owner: "put the total price less gst for the total revenue on the
  different roof i'm pricing on the right on the frozen roof map ... Labour
  $x, Material $x then total $x +gst"). `_pricingRoofPriceHtml` /
  `_pricingRoofParts(ri)` draw a card in the yellow band beside the map
  (`.pr-map-row` / `.pr-price*`, stacked under 760px): Labour, Material,
  Scaffolding when it is priced, then Total and "+ GST = $y" at the quote's
  own GST rate. Every figure is read through the helpers the cards read, so
  the panel cannot disagree with the green totals above it — the MAIN roof's
  total is `_quoteMoney().sub` to the cent and an extra roof's is what that
  roof is quoted at. Scaffolding earns its own line rather than being left
  out: a total that reads less than the roof is quoted at is worse than a
  third row. It follows the roof switch (`_renderPricingRoofSwitchBar`, which
  every recalc reaches). `tests/roofcustom.mjs`. THE MAIN ROOF'S CARD CARRIES
  ITS OPTIONS (2026-10-29, job 3306: it read $36,622.54 beside a quote of
  $39,280.83, the gap the RI-925 / 0.55 row): `_pricingRoofParts(0).options`
  lists every pick that is not another roof (`_profitSelectionItems`, key !==
  'roof') as its own row and the total includes them. And the card is redrawn
  (`_prMatChanged`) by a custom line added or taken off (`_qCustomChanged`, the
  debounced live re-render), a material row's ✕ (`_deleteMatRow`,
  `restoreDeletedMatRows`) and a quote pick (`_setProposalOption`) — it sat
  still when a material line was removed. `tests/pricingcard.mjs` (21).
- EACH PLAN OPTION IS PRICED ON ITS OWN (2026-10-13, the owner: "it won't let
  me price the two plans seperately, like i said it should act like the
  seperate roofs in a roofing job (remeber only change it for a pole shed job
  type)"). A separate roof has its own pricing tab; a shed's plan options had
  ONE set of pricing between them and the Pricing drawer had no plan switch in
  it at all, so pricing the 4-bay wrote over Option A. `_psPricingCapture` /
  `_psPricingApply` ride inside `_psPlanCapture` / `_psPlanApply`, so a plan
  carries the state that drawer edits — labour hours and labourers, the
  scaffold, the typed custom lines, the buffer and mark-up — beside its
  drawings and its estimator. THE CREW'S RATES ARE SHARED, exactly as they are
  across roof tabs (they are the crew's, not the shed's), and so is the way
  labour is charged. `_psPlanSwitchHtml` puts the plan chips where the roof
  switch goes (`_renderPricingRoofSwitchBar`, `_pricingRoofTabsHtml`) and
  `_psPlanPriceHtml` fills the band beside them with that plan's shed price,
  its difference from the first plan and the GST. NOTHING IN A ROOFING JOB
  MOVES: every path is behind `_psPricingPlans()`, which answers null unless
  `quoteKind === 'poleshed'` AND there is more than one plan.
  `tests/poleshed.mjs`.
- A PLAN OPTION IS NAMED WHEREVER IT IS OFFERED (2026-10-13, the owner: "let
  me rename the two options, put a little edit pencil symbol button which lets
  me change the name of either option, put it everywhere it has the two option
  buttons aswell as in the pricing tab, also add plan option to the first page
  aswell as the inside the price box on the right hand side of the quote").
  Renaming existed, but as ONE "Rename" button that renamed whichever plan
  happened to be on screen — so naming the other one meant switching to it
  first, and nothing said which name you were about to change.
  `_psPlanPencilHtml(i, kind)` is a ✎ per option, on all three surfaces that
  offer them: the office strip above the drawings (`_psPlanBarHtml`), the
  Pricing drawer's chips (`_psPlanSwitchHtml`) and the customer's options page
  (`planPanel` in `_buildPoleShedSelections`, whose local `opt()` grew an
  `after` argument for it — every other caller passes five arguments and is
  unchanged). IT IS NEVER NESTED INSIDE THE OPTION'S OWN BUTTON: a button
  inside a button is not valid markup and the browser breaks the inner one out
  of its parent, which would land the pencil somewhere else entirely — the
  strip wraps each option in a span, the drawer positions it over the cell
  (`.ps-plan-pen-abs`), and the options page row is a div. Its click calls
  `event.stopPropagation()` so renaming never also switches the plan.
  RENAMING IS A QUOTE EDIT, not a label on a button — the name is on the
  cover, in the customer's price box and on their options page — so
  `_psPlanRenamePrompt` takes the same two guards every other change takes:
  never in customer mode (they pick a shed, they do not name one) and never on
  an accepted quote. Cancel and an empty box both keep the name. THE SECOND
  GUARD WAS DEAD UNTIL 2026-10-13: it was `_qpAcceptedLock()` alone, which
  READS `__CUSTOMER_MODE`, so it is the customer's lock and answers false for
  the office every time — the office could rename a plan on an accepted quote.
  `S.quote.accepted` is tested directly beside it now, here and on the add-ons.
  AND THE QUOTE SAYS WHICH SHED IT IS: a "Plan option" cell on the cover's
  meta grid beside Reference and Deposit, and a row at the top of the computer
  rail's price box (`_qdRail`, which is that layout's alone). Both only where
  there is more than one plan — one plan is just "the shed", and labelling it
  reads as though a choice were missing. The customer sees both (it is a fact
  about the quote they are reading); only the pencil is office-only.
  `tests/poleshed.mjs` (111).
- A POLE SHED'S CUSTOMER TOTAL IS THE SHED'S OWN ENGINE (2026-10-13, the owner
  on a quote he had ALREADY SENT: "the options to switch between plans doesn't
  even change the price, neither does switch to zincalume, the total doesn't
  change, plus, the extra price to upgrade to the 4-bay shed in the customer
  quotes says an extra roughly 71k whereas the app quote shows the correct
  etra cost of about 16k"). Three faults, all in the customer's copy.
  THE TOTAL NEVER MOVED because every customer-facing figure comes through
  `_custBarTotalValue()`, and that read `_qpBaseSub()` (the roofing LINE
  ITEMS) + `_qpSelectionDeltaSum()` (the roofing grade / profile / gutter
  picks). Neither knows a shed exists — not `psSubtotal`, not the plan
  options, not one of the shed's own add-ons — so the customer could pick
  anything and the number sat still. `_poleShedMoney()` is the shed's engine
  and already drove the A4's shed pages; `_custBarTotalValue` and
  `_custBarRows` branch to it on `quoteKind === 'poleshed'`, which is the one
  seam the rail, the phone's bottom bar, the Review page and `share.sentTotal`
  all come through. `_qpBaseSub` is untouched (see OPEN AND URGENT).
  THE ROWS BESIDE IT are the shed's too: the shed (named for the picked plan)
  then one row per pick that moves money, from `_poleShedSelItems()` —
  a new list that `_poleShedSelDelta()` now SUMS, so what the customer reads
  and what they are charged cannot disagree. It also ends the shed reading
  "Re-roof — main scope of work" over a pole shed.
  THE +$71,225.11 (chased three times; SETTLED 2026-10-13 PM, see below) was
  `_psPlanSubtotalAt(i)` reading the live `psSubtotal` for the PICKED plan and
  taking a missing one as a price of zero, which makes the delta the OTHER
  plan's whole price. The first fix fell back to that plan's stored subtotal,
  which was not enough — the owner reopened the live link and it still read
  +$71,225.11.
  THE BUTTONS HE ASKED FOR: `_psPlanSwitchHtmlCust(where)` is a real switcher
  for the CUSTOMER (unlike the office's rename pencil) on page one and in the
  computer rail's price box — each button naming the plan and what the swap
  does to the price, read against the plan ON SCREEN rather than plan 1. A
  label naming the pick, which is what the first attempt shipped, was not what
  he asked for.
  THE SHED ON A PHONE (same message: "the quotes mobile version is hard to
  read and not made properly"). The shed sections are the A4's own blocks —
  deliberate, so the two styles cannot drift — but the A4 is a two-column
  document and inside a phone-width page its grids kept both columns and ran
  off the right edge: a 132px `specRow` label beside a ~60px value,
  "Mono-pitch (flat)" set one word per line, the second column's headings off
  screen. `_psModernSections` marks every shed section `.ps-body`, and rules
  scoped to it under `html.qp-book` / `html.qp-phone-preview` collapse the
  two-column grids, stack each spec row label-above-value, cut the A4's 36px
  gutters and shrink the chapter band. Scoped to the shed: the computer
  layout and every roofing quote are untouched. `tests/poleshed.mjs` (111).
- A PLAN OPTION'S PRICE COMES FROM THE SHED'S ONE ENGINE (2026-10-13 PM, the
  owner on job 3287's LIVE customer link: "customer quote still showing +71k for
  the 4 bay vs 3 bay where as the user quote in the app i quoted $54,490.78 for
  the 3bay and $71,225.11 for the 4bay" — so the swap costs $16,734.33). The
  total beside it was already right ($62,664.40 incl / $54,490.78 excl, and
  $60,536.90 / $52,640.78 on Zincalume), which is what gives the fault away:
  THE CHIP AND THE TOTAL WERE READING DIFFERENT SOURCES FOR THE SAME NUMBER.
  `_poleShedMoney().base` takes `_shedBaseFromDrawer()` OVER `psSubtotal`, and
  in customer mode that is `quoteSubtotal()` — the frozen line items. A shed
  priced by its TAKE-OFF (which is how a shed has been priced since this
  morning) therefore reaches `_psPlanSubtotalAt` with no `psSubtotal` at all;
  its stored-field fallback answered 0 too, because the 3-bay plan was banked
  before it was priced; and 71,225.11 − 0 is the other shed's whole price
  offered as the cost of swapping. Three fixes, and all three were needed:
  1. THE PICKED PLAN'S PRICE IS `_poleShedMoney().base` — the one engine the
     total reads. The chip and the total then cannot disagree, because there is
     nothing left for them to disagree about.
  2. A PLAN WITH NOTHING STORED, ON A FROZEN COPY, IS THE SHED AS SENT
     (`quoteSubtotal()`). Without it the difference VANISHED the moment the
     customer took the 4-bay — +$16,734.33 on the chip, then nothing. The
     office is deliberately left out of this fallback: there a blank plan has
     no price YET, and lending it the quote's own total would invent one.
  3. SWITCHING PLAN MOVES A FROZEN COPY'S PRICE. `_shedBaseFromDrawer`'s
     customer branch returned the line items whatever was picked — but they
     are fixed at the send, so they can only ever price ONE of the sheds, and
     taking the 4-bay left the total sitting still. The picked plan's own
     stored price answers for it where it has one, line items as the fallback.
  AND A DIFFERENCE NEEDS BOTH SIDES: `_psPlanDeltaAt` answers 0 rather than
  subtracting from an unknown, so an unpriced plan can never again present the
  other one's whole price as what it costs. Nothing is a better answer than a
  wrong number. Pinned to the cent on his own figures in `tests/poleshed.mjs`
  (167), sent copy and switch and Zincalume and back again.
- THE SHED'S MEASURES COME OFF ITS OWN ESTIMATOR (2026-10-13, the owner: "can
  you work on adding the measures of the shed into the empty info lines, which
  should change between the two plans"). Width, Length, Height, Bays and Bay
  amount sat BLANK on Your Shed Details for job 3287. Those fields are only
  filled when the WebShed PDF names them — the size is in the PDF's Title
  metadata and the bay count only in the filename — and that plan's did not.
  The ESTIMATOR knew all along: it prices the shed off `W`, `L`, the eave
  heights and the pole grid, so the figures were there and simply not read.
  `_psSpecFromEst(est, name)` derives them and `_psSpecGet(field)` is what the
  spec rows, the cover chips and `_psPlanSize` read: what the office TYPED
  wins, else the shed's own measurements, else blank.
  DERIVED, NEVER STORED, and that is the point twice over. It is read from a
  RENDER, and a render that writes is how a frozen copy gets today's figures
  stamped onto it (the shed take-off taught that one). And it has to FOLLOW THE
  PLAN ON SCREEN, which a stored value cannot: `_psPlanApply` swaps `shedEst`
  with the plan, so a derived row changes when the customer picks the other
  shed while a typed one stays the office's. The row is still contenteditable
  and the `[data-qfield]` focus handler clears the derived text first, so the
  first keystroke lands in an empty box.
  A PLAN NAMED "3-Bay Shed" HAS THREE BAYS. The count worked back out of the
  pole grid (`poles / across`, `across` = 3 over 7 m else 2) is a GUESS, and on
  a 7.2 x 12.6 shed with 8 poles it answers 2 for a shed the office, the file
  and the button the customer presses all call a 3-bay. `_psBaysFromName` reads
  the count off the plan's name FIRST and the grid is the fallback — the same
  rule the WebShed import follows, that a count somebody STATED beats one
  worked backwards. The bay CENTRE then falls out right too: 12.6 / 3 and
  16.8 / 4 are both 4.2 m, which is the figure on the plan. A mono-pitch names
  BOTH eave heights ("3.48m – 2.9m"), because naming one of them builds the
  wrong shed. `tests/poleshed.mjs` (192).
- A SHED'S QUOTE TALKS ABOUT A SHED (2026-10-13, the owner: "can you change the
  default wording for the Pole Shed quote in a Pole Shed job type, still relates
  to a roofing job instead of a Pole Shed, also the 'the old roofing we take it
  away' from the price box on the right of the quote shouldn't be there").
  THE PRICE BOX'S "YOUR CHOICES" was `_qbPicksAuto()`, written entirely around a
  RE-ROOF — Roof profile, Guttering, Gutter brackets, Downpipes, The old roofing
  — none of which the shed's own options page offers, and a new shed has no old
  roofing to take away. `_psPicksAuto()` lists the SHED'S picks instead (plan
  option where there is more than one, steel grade, thickness, roof & wall
  colour, roller door finish, then each add-on they TOOK), keyed `psplan`,
  `psgrade`, `psthickness`, `pscolour`, `psroller` and `ps:<addonId>` so Edit
  summary can still re-word any of them. Zincalume says "Plain silver —
  unpainted" rather than leaving the colour blank, and an add-on left OFF is not
  listed, the way a quote with no gutter has no gutter line.
  THE QUOTE EMAIL: `POLESHED_EMAIL_DEFAULT` ("Your pole shed quote {ref}", "the
  opportunity to quote your new shed{address}") is the standard wording FOR A
  SHED, picked in `_quoteEmailTemplate` on `_psIsShed()`. The FOLLOW-UP is the
  SERVER'S — it goes out on a sweep, so the app's swap cannot reach it and a
  shed quote nobody answered was chased with "Just checking in on the roofing
  quote we sent"; `REMINDER_EMAIL_POLESHED` in server.js, chosen on
  `quote.quoteKind` off the row the sweep already has in hand.
  NEITHER `QUOTE_EMAIL_DEFAULT` NOR `REMINDER_EMAIL_DEFAULT` IS TOUCHED: they are
  what Settings → Email shows as the standard wording, and `tests/emailsettings
  .mjs` compares the app's `EMX_DEFAULTS` against the server's constants. An
  office that has written their own wording wins over both, because
  `em.quote_subject` / `em.reminder_subject` is still read first either way.
  `tests/poleshed.mjs` (179) pins the shed and the roofing quote side by side.
- A QUOTE THAT SAYS IT IS A POLE SHED IS ONE (2026-10-13, the owner: "wheres
  the switcher from roofing to pole shed job type gone? the phyllis job is now
  missing the pole shed specific quote"). `_poleShedsAvailable()` reads
  `S.settings.branding`, so a job opened BEFORE the settings read lands saw
  branding `{}`, the company-name fallback answered FALSE, the Roofing / Pole
  Shed toggle was hidden — and `_syncQuoteKindToggle` REWROTE the saved quote
  to `'roofing'`. Job 3287 lost its shed quote that way, and the one control
  that could put it back was hidden on the very job that needed it. A READ
  THAT HAS NOT HAPPENED IS NOT A "NO" — the same rule as `_mustRead` and as
  settings that never came from the server. There are two questions now:
  `_poleShedGateBranding()` / `_poleShedsKnown()` say whether we can answer at
  all (live branding, else the device's last good `fr_settings` copy), and
  `_poleShedsAvailable()` answers — OFFERING the type when it is unknown,
  because hiding the switch costs a real job and showing it to somebody else
  for a boot is free. BOTH demotions (`quoteKind` and `_pendingJobType`) are
  now behind `_poleShedsKnown()`, so an account that genuinely does not sell
  pole sheds still gets a shed job put back to roofing rather than stranded —
  the behaviour `tests/poleshed.mjs` already pinned, which is what caught the
  first, too-blunt version of this fix.
- A POLE SHED IS PRICED LIKE A ROOFING JOB (2026-10-13, the owner, answering
  the question above: "the pricing estimator should estimate the sheds
  material cost (and labour cost if it already does) then i should be able to
  edit everything just like i can with a roofing quote, should let me add
  material line items and labour lines, pretty much an exact copy of the
  roofing quote"). A shed has no roof DRAWN, so the Pricing drawer read "No
  quantifiable items yet" and its labour, materials and scaffold fed nothing —
  the quote's price was one figure the estimator wrote and the office could
  type over.
  THE SHED ESTIMATOR IS THE TAKE-OFF NOW. `_shedTakeoffBuild()` turns its
  items into the same row shape a roof's take-off has, so everything already
  built on those rows works for nothing: the qty and $/unit boxes, the ✕,
  `MATERIAL_OVERRIDES` / `MATERIAL_DELETED`, the buffer and the mark-up, "+
  Add custom line" and "📖 Add from price book", the materials total, the
  profitability panel, the pricing CSV and the Fergus push. The estimator's
  OWN markup item is dropped (the table marks up once) and its HOURLY labour
  lines are dropped — they seed the Labour card instead (`_shedLabourToHours`,
  man-hours split between lead and apprentice, and never once the office has
  typed hours: the same `labourHrsManual` rule the roofing auto-calc follows).
  TAKEN ONCE, THEN THE OFFICE'S — the Job Pack cut list's rule, learned from
  three feedback reports: a list re-derived on every render is a list that
  shifts under them. `_shedTakeoff()` stores it on the quote as `shedTakeoff`
  the first time and reads it from then on; `_shedTakeoffReset(ask)` (the
  link under the table, and the estimator's Apply) takes it again and drops
  the edits that hung off the old rows. Each PLAN OPTION carries its own
  take-off and its own row overrides (`_psPricingCapture`,
  `_psShedOvSnapshot` — `shed_`-prefixed keys only, so nothing else in
  MATERIAL_OVERRIDES is touched).
  THAT STORE IS A WRITE ON A READ, and it is read from a render — so a FROZEN
  version (the sent or the accepted copy) and the CUSTOMER'S own copy are
  priced from the list without it being kept on them: they are what went out,
  and nothing a render happens to do may change them. `window.__CUSTOMER_MODE
  || S._qvViewing || _qpAcceptedLock()` returns the built list and stores
  nothing; the office's working draft still keeps its take-off. BE ACCURATE
  ABOUT WHAT THAT GUARD CATCHES: `_qvQuoteOf` deep-clones a version, so a
  write while a frozen copy is on screen only ever reached the clone and the
  stored `versions.sent` was never reachable from a render — measured with
  the real `_qvView`/`_qvBackToDraft` pair, not assumed. The case that was
  LIVE is `_qpAcceptedLock()` without a frozen view: the working draft of an
  ACCEPTED shed job, which is the real quote and is autosaved, so opening one
  quoted before the take-off existed would have stamped today's estimator
  onto it. Pinned in `tests/poleshed.mjs`.
  A SHED'S QUANTITIES KEEP THEIR DECIMALS (`decimalQty` on the row,
  `_matOrderQty(qty, unit, keepDecimals)`): the rounding exists so a roofing
  order comes out in whole sheets and screws, and rounding 25.08 m³ of
  concrete to 25 both misprices the shed and makes every small edit jump.
  THE PRICE IS `quoteSubtotal()` — the same engine, the same lines, as a
  roofing quote — through `_shedBaseFromDrawer()`, in THREE cases and this
  order, because an existing quote must not move: a total the office TYPED on
  the quote page wins (`psSubtotalManual`, set by that field's own blur);
  else, if there is a take-off to price, the drawer's total; else the stored
  `psSubtotal`, so a shed priced before any of this by typing one number
  reads exactly as it did. `psSubtotal` is STAMPED with the drawer's figure
  (never over a typed one), because the plan chips, the A4 and the customer's
  copy all read that field — and NEVER A ZERO. That stamp runs on every
  recalc, including ones that land mid-open before the material table has
  been rendered and the lines built; a shed is never worth nothing, so a zero
  there is "not worked out yet", not an answer. It wrote $0 over job 3287's
  $64,585 on the open, found by testing the open in the order it really
  happens. `_shedBaseFromDrawer` falls through to the stored figure on a zero
  for the same reason. A SHED HAS NO ROOF TABS: `_psIsShed()` turns off
  the per-roof keying in the material table, the labour card,
  `_materialsCostForRoofIdx` and `_syncQuoteBaseLineItems`, and the roofing
  steel-grade percentage with it — a shed's cladding is priced at its own
  rate in the estimator. Its tabs are its PLAN OPTIONS.
  NO OFFCUT BUFFER ON A SHED, AND ITS PERCENTAGES ARE ITS OWN FIELDS
  (`shedMatQtyBuffer` / `shedMaterialMarkup`, read and written by
  `_roofMatQtyBufferPct` / `_roofMatMarkupPct` and their setters when
  `_psIsShed()`): the quantity buffer prices in extra steel for a ROOFING
  job's offcuts and `defaultQuote()` seeds it at 5%, but a shed's quantities
  come out of the estimator, which already carries its own allowances AND its
  own 5% on materials — charging the roofing buffer on top read 3% dearer the
  moment a shed quoted before this was reopened ($64,585 → $66,519 on job
  3287). A shed defaults to 0 and the estimator's own mark-up. SEPARATE
  FIELDS, not a seeded value: the first version wrote 0 into the roofing
  field, which worked until a job was switched back to Roofing and quietly
  kept the shed's 0% where the roofing default is 5% — a silent change to a
  roofing price. What is left is a ~0.5% difference from the estimator's own
  total, and it is honest: the drawer charges labour at the roofer's real
  rates and adds the scaffold the estimator has no concept of.
  A POLE SHED HAS NO ROOFING GUTTER SECTION (the owner, 2026-10-13: "also
  guttering should be apart of the main price" → "i mean remove the gutter
  pricing section" → "gutter shouldn't be a default optional extra in the
  quote either"). The shed's guttering is the "Box gutter + downpipes" line
  in its own take-off, so it IS the main price; the roofing card beside it
  priced a run off a drawing a shed does not have and read "$625 · not on
  the quote", which says the opposite of the truth. `_gutterExcluded()`
  answers TRUE for a shed — the existing, already-wired meaning of "not
  priced here AND not offered anywhere on the customer's quote" — and
  `renderGutterDownpipePricing` hides the card outright rather than showing
  the excluded box. `tests/poleshed.mjs` (72).
- THE SHED'S OPTIONS PAGE IS THE OFFICE'S (2026-10-13, the owner on a shed he
  had sent: "the cover photo is blurry, can you also allow me to move the cover
  photo and zoom in just like i can with the photo slots ... also in the options
  allow me to add, delete or edit the different add-ons. then make the sections
  bigger and one selection per row instead of jammed in next to each other like
  that, just like the roofing type shows", then "also delete the pricing totals
  on page 3 & 4"). `tests/poleshed.mjs` (154).
  THE COVER MOVES AND ZOOMS. It was a `background-image` on a 330px band, which
  can only ever be centred and cropped — a shed sitting low in a render had its
  roof cut off and nothing could be done about it. It is an `<img>` carrying the
  SAME `offX/offY/zoom` transform the condition slots carry, inside a frame
  tagged `.qp-cond-photo[data-cp-idx="6"][data-cp-hero]`, which is what
  `_qpApplySlotTransform`, `_qpCondPhotoDragStart` and `_qpCondPhotoWheel`
  already look for — so the drag, the wheel and the −/+/↺ buttons are the
  existing ones rather than a second copy that could drift. `_qpRerenderOneSlot`
  branches on the cover and rebuilds the PAGE, or a reset would swap a dashed
  16/9 thumbnail in where the cover band was.
  AND IT IS NOT DOWNSCALED LIKE A SITE PHOTO. `_downscalePhoto(url, cb, big)`:
  900px at quality 0.6 is sized for a photo a third of the page wide, and
  blowing that across a full-bleed cover (and further again in the PDF) is what
  "blurry" was. A cover gets 2000px at 0.86. `_qpCondSlotIsCover(idx)` is the
  one place that says which slot that is (`PS_HERO_SLOT` = 6), and every path a
  picture arrives by — upload, drag-and-drop, the Fergus picker — passes it.
  THE ADD-ONS ARE A LIST THE OFFICE OWNS: `S.quote.psAddons` =
  `[{id, label, summary, price, on}]`, with ✎ / ✕ per row and + Add on the band
  (`_psAddons`, `_psAddonsWrite`, `_psAddonToggle`, `_psAddonEdit`,
  `_psAddonAdd`, `_psAddonDelete`). NOTHING ALREADY QUOTED MOVES, and that is
  the whole trick: a quote with NO list of its own is READ as the three
  built-ins (`PS_ADDON_BUILTINS`) at their `POLESHED_ADDONS` prices with their
  on/off taken from the three original flags (`psSelWallUnderlay`,
  `psAddSliding`, `psAddWindow`), so every shed sent before this prices and
  reads to the cent exactly as it did and no migration pass runs over saved
  jobs. The list materialises only when somebody edits it, and a built-in's old
  flag is kept in step anyway so a copy saved halfway reads right from either
  side. The SUMMARY wording is kept separate from the option's label on a
  built-in ('Sliding door' vs 'Add sliding door') or an already-sent quote's
  summary rows would quietly re-word themselves; an add-on the office writes
  uses its own label for both. A new add-on starts OFF, so adding one never
  moves a price by itself. `_poleShedSelItems` reads the list, and
  `_poleShedSelDelta` sums THAT, so what the customer reads and what they are
  charged still cannot disagree.
  THE CUSTOMER PICKS, THE OFFICE WRITES (`_psAddonEditable`): ticking an add-on
  is the customer's — it is what the page is for — but adding, renaming,
  re-pricing and deleting are office-only AND never on an accepted quote.
  `_qpAcceptedLock()` cannot carry that second test by itself: it reads
  `__CUSTOMER_MODE`, so it answers false for the office every time.
  `S.quote.accepted` is tested directly beside it (the plan rename had the same
  dead guard and was fixed with it).
  ONE SELECTION PER ROW: the page's closing `1fr 1fr` grid put Steel grade
  beside Roller door finish, which on a phone ran off the edge and on paper read
  as two unrelated columns. Each section is a full-width band now, sized to
  match — 12px band, 14px rows, 18px radios, colour chips 6 across at 46px — the
  way the roofing quote gives grade, profile and thickness a section each.
  NO TOTALS ON PAGES 3 AND 4. The running total follows the customer anyway
  (the rail on a computer, the bar under the book on a phone, both through
  `_custBarTotalValue`) and page 5 carries the breakdown; each option still
  shows what IT adds, which is what page 3 is for. Both money builders were
  DELETED rather than hidden — a money block nothing calls is how a second copy
  of the arithmetic starts, and `_poleShedMoney` is the shed's one engine. The
  one thing page 4's card held that page 5 did not, the hand-typed subtotal
  (`psSubtotalManual`, the office's override of the Pricing drawer), MOVED onto
  page 5's subtotal row rather than going with the card; deleting it would have
  taken away a control nobody asked about.
- THE MODERN SHED IS EDITABLE LIKE THE MODERN ROOFING QUOTE (2026-10-25, the
  owner: "make the pole shed modern quote fully editable like the roofing
  modern quote ... edit the profiles and gutter ... the name and price of the
  ad-on ... delete section and add a custom section ... every section
  description is editable. Also fix the first page, the info and Cover photo
  don't stretch the full width"). `tests/poleshed.mjs` (251).
  THE COVER: a box with an aspect-ratio, a max-height and no width of its own
  has the max-height carried across the ratio into its WIDTH — a 640px render
  in an 890px section. `.qd-hero` / `.qb-hero.ps-hero` carry `width:100%`; the
  shed's cover body is ONE column (`.ps-cover-body`: chips, the opening letter,
  the facts as a grid below). The opening letter is the text box itself
  (`.ps-intro`, `data-qfield="psIntro"`) — no second copy in an office box —
  and the hero's h1 binds to `psSubtitle` on a shed (it was bound to the
  roofing `coverTitle`, which the shed's cover never reads). `_qeCommitInline`
  writes nothing on a click in and out, so a fallback title never becomes a
  saved one.
  EDIT THIS SECTION on psgrade / psthickness / psgutter / psroller
  (`_psChoiceOpen`, `S.quote.psChoiceEdit[sec] = {title, rows:{id:{label, desc,
  price, off}}}`): the heading, each choice's name, words and price (ex GST)
  and whether it is offered. The window opens on what the quote says now and
  keeps only what differs from the standard (`_psChoiceDefaults`), so nothing
  quoted before moves. ONE PRICE HELPER, `_psChoicePrice`, read by the cards,
  `_poleShedSelItems` (the total), `_psPicksAuto` and the classic A4 cards; the
  first choice is never charged. A choice taken off while it is the pick goes
  back to the standard. The profile section uses the roofing quote's own
  editor (`edit:'profile'` → `_qselOpen('profile')`). Office only, never on an
  accepted quote (`_psAddonEditable`).
  THE ADD-ON EDITOR IS A WINDOW (`_psAddonEdit(id|null)` → `_psAddonSave`;
  name, `desc`, price) — the two prompts are gone, and the button reads Edit.
  DELETE THIS PAGE on every shed section but the cover, the plan option and
  the total (`_psmDelBtn`, `o.del` in `_psmOptPage`), through
  `_qbSectionRemove`, which puts a shed pick back to its standard; a parked
  section is no price (`_psParked`, modern only, never on an accepted quote) —
  except a gauge the PROFILE forces. The phone book now takes the same
  arrangement (`_qbPages` → `_qModernApply`). QD_LABELS name the shed keys.
  CUSTOM SECTIONS: "+ Insert custom option" stands above the add-ons on a
  shed; the quote's OWN custom options (`_psOwnExtra` — `customExtras` only, a
  Settings option like Paint Roof is a re-roof product and is not offered) are
  sections `extra<gi>` keyed as the roofing quote keys them, priced in
  `_poleShedSelItems` and listed in the picks. Every section's paragraph is a
  `_qSecPara`, including the locked thickness (`psthicklock`), the consent
  wording (`psexempt` / `psconsented`) and the deposit note (`psdeposit`).
  THE "AVAILABLE AS OPTIONS" LIST FOLLOWS THE PRICES (2026-10-25, the owner:
  "Make the Zincalume options line follow the edited price"): `_psGet
  ('psOptions')` runs every line through `_psOptionsFollow` — a line naming
  Zincalume, or 0.55, and carrying ONE dollar figure reads
  `_psChoicePrice('psgrade','zincalume')` / `('psthickness','0.55')`. Read
  through, never stored, so the default keeps following; a line with two
  figures is the office's own and is left as written. Classic, modern and the
  office box all read `_psGet`.
- LOOKING AT A SENT QUOTE ON A PHONE IS NOT EDITING IT (2026-10-12, job 3296:
  "i just tried to click the mobile version after i sent the quote but it
  wouldn't let me, it should letting me view the mobile version but not make
  any edits while it's locked"). `_setQuotePreviewMode` moves `QP_PREVIEW`
  and writes nothing to the quote, but it was not in `_LOCK_OK_CALLS`, so
  Computer | Phone raised "This is the sent quote". It is now; the Style
  switch writes `S.quote.style` and stays behind the lock.
  `tests/quotepreview.mjs`.
- THE JOB TYPE IS NOT A SETTING (2026-10-12, job 3296: "this job was set as a
  'pole shed' in the job type, all jobs should default to 'Roofing' job type,
  maybe it's because i switched from the phyllis job which was a pole shed
  job" — he was right, and that is exactly it). `window._pendingJobType` is
  the New/Edit Job modal's ONE-SHOT answer, read by `defaultQuote()`, and
  nothing ever put it back: once a pole-shed job had been through that modal
  every quote built afterwards was born a pole shed. `_clearPendingJobType()`
  now runs in `_resetQuoteForFreshJob` and in `restoreFromJob`, and — because
  `Object.assign(S, snap.state)` puts the stored quote back WHOLE, so the
  default cannot reach a job that has one — `restoreFromJob` also normalises
  `S.quote.quoteKind` to 'roofing' unless it says 'poleshed'. A quote that
  never said what it was is a roofing quote. `tests/poleshed.mjs`.
- The phone's roof plan FOLLOWS the computer's and vice versa
  (`_QP_MAP_PARTNER`: desk↔book, desksum↔booksum) until each has been
  moved itself; only a frame's own `roofMapViews[key]` is ever written.
- THE PRODUCT LIST SURVIVES A RELOAD, AND SO DOES THE EMAIL WORDING
  (2026-10-28, the owner: "the gutter profile pictures i upload ... disappear
  after an app reload" and "my custom email quote template keeps reverting
  back to default after an update or reload"). `mergeSettings` had NEVER
  carried `selectables`, so every load set `S.settings.selectables` to
  nothing: the quote fell back to the shipped defaults, opening Settings
  seeded those (`_selWorking`), and the next settings save from anywhere
  wrote them over the stored list — gutter and profile pictures, own grades,
  profile rates, own options. It is carried now (absent stays absent), the
  setup wizard leaves it out when empty, and the server treats `null` like a
  missing key. A list already overwritten is gone; the office re-uploads.
  THE EMAIL WORDING: every settings save carries the whole email block, and
  the standard wording is stored as `''` — so a tab or device that loaded
  before a custom wording was written sent it back blank on its next save
  (any of ~28 saves made off the Settings tab). The server now keeps a stored
  `*_subject` / `*_body` over an incoming blank unless the save names it in
  `email.__reset`, which the app sets only for a wording emptied or Reset on
  a live screen (`window.__emxTouched`, `_emxTouch`); the mark is dropped
  once a save lands. Returning to a tab re-reads the wording (not while on
  the Settings tab), and a pending settings autosave is flushed on
  `pagehide` / hidden. `tests/settingssave.mjs` (app), `tests/ferguskey.mjs`
  (server).
- A SENT QUOTE STAYS LOCKED (2026-10-28, job 3299: "this quote has been sent,
  why is the quote not locked?"). Opening a sent job locks it, but choosing
  the Draft from the Viewing menu after a send called `_qvBackToDraft()` with
  no options, which unlocks. The menu item passes `{relock:true}`: a job whose
  quote has been sent (`_quoteWasSent()`) keeps its lock and the first edit
  asks. The Viewing menu reads "locked" or "editing" to match
  (`_jobLockRender` re-renders the bar). New draft / Change template / Open
  saved draft still unlock — they are the office asking to edit.
  `tests/joblock.mjs`.
- GUTTERS ONLY IS A THIRD JOB TYPE (2026-10-28, the owner: "add an job type
  called 'Gutters only' and the canvas is very basic, only allows to draw the
  gutter line, the quote gets changed to suit gutter ... no steel grade, no
  profile, no thickness, no 'the old roofing', re-roof in the summary changes
  to 'Gutters', the roofmap & aerial image just shows the aerial image and the
  gutter lines, no basic map"). `S.quote.quoteKind === 'gutters'`
  (`_isGutterJob`, `_gutterJobSync` puts `body.gutter-job` on), offered as
  `#jtBtn_gutters` in the job details window and in the Quote tab's More menu
  (`_setJobType`). THE CANVAS: Move, the Gutter line (`#btn-gjgutter`), the tape
  and Custom Scale; no outline, no roof-lines menu, and a roof tool asked for
  anyway becomes the gutter line; gutter lines need no outline to count.
  THE QUOTE is the modern layout (`_gjSections`): cover, a Guttering Proposal,
  the gutter (no "No new guttering"), its colour (`gcolour`), brackets and
  downpipes, the quote's own options and the total — no grade, profile,
  thickness, roof colour or old roofing. The summary's first line is "Gutters —
  <the gutter>" with the scaffold beside it, the picks are `_gjPicksAuto`, the
  map is the aerial and the gutter lines alone, and the Pricing drawer is the
  scaffold and the gutter card with no platform uplift. THE GUTTER'S COLOUR
  (`_gjPalette`): the Colorsteel chart for the box gutter, Marley Typhoon's own
  eight (`MARLEY_TYPHOON_COLOURS` — White, then the Stratus range: Black, Grey
  Friars, Ironsand, Gull Grey, FlaxBlack, Titanium, Copper — from the owner's
  chart off marley.co.nz), White only and compulsory for Marley Classic; a
  colour the new gutter does not come in is cleared on a change of gutter, one
  both come in is kept. The SERVER keeps the customer's gutter colour, lists a
  gutters job's own picks in the acceptance email and the Fergus text, and
  follows it up as a guttering quote (`REMINDER_EMAIL_GUTTERS`). Roofing, pole
  shed and tender are untouched. `tests/gutteronly.mjs` (26, UI list).
- THE ROOF BUTTON OPENS THE ROOF'S WINDOW (2026-10-29, the owner: "add a rotate
  90deg inside the pop-up roof type selector, also change the 'Roof settings'
  window to be the pop-up selector ... just add the make main roof and delete
  roof buttons in it too, also when that window opens and i click the different
  roofs, change them live in the canvas"). `_roofSetupPopup(opts)` has two
  modes: 'new' (the outline closing — pitch box, Skip for now, Draw the roof)
  and 'settings' (`_toggleRoofMenu` → the roof bar's button). In both a shape
  click BUILDS it on the canvas at once (`autoGenerateRoof`; the shape it
  already is is not rebuilt, so a turn survives), a sheet click sets it, and
  Rotate 90° / Snap square act at once; Make main roof / Delete roof sit at its
  foot. Skip for now puts back the state from when the window opened
  (`_captureSnapState`); a click outside or Esc keeps what is on the canvas. It
  sits right on a wide screen over a light backdrop and drags by its title.
  The picture of the shape the roof IS is drawn from its own lines
  (`_roofPreviewSvg(..., own)`), so a turned roof shows turned. The settings
  mode BORROWS `#roofPitchRow` and `#gableRidgeSlideRow` from the old panel
  and puts them back on close, so every handler and sync is the one that always
  ran (`#_rsLent` shares the panel's field CSS). The drop-down panel is retired
  behind `_ROOF_PANEL_DROPDOWN` (false; true brings it and its slide-in back —
  `tests/roofmenu.mjs` pins it with the switch on) and is still the phone's
  site-mode sheet. THE SETTINGS MODE IS A DROP-DOWN AGAIN (2026-10-29 later,
  "make the roof setting act as the old drop down window acted ... 15%
  smaller ... drop down over 0.5sec then collapse over 0.5sec ... hard to the
  left side of the canvas ... drag the canvas roofmap around without it
  closing"): no backdrop — the wrap (`.rs-drop`) sits in the page just before
  `#roofTypePanel`, absolute, flush with the canvas's left edge; the card is
  `zoom:.85` (on the card, not the wrap, so the title drag moves the wrap in
  screen pixels); `rtpDrop` in, `rtpLift` out, and a click on the canvas
  never closes it (Done, Esc or the roof button). A closing window is renamed
  `_rsModalClosing` with its ids stripped while it folds, the borrowed rows
  already home. Focus uses `preventScroll`. The NEW-roof window is unchanged.
  `tests/roofwindow.mjs` (23).
- A QUOTE KEEPS THE PRODUCTS IT WAS BUILT WITH (2026-10-29, the owner on job
  3306: Duplicate this quote off Sent quote 2 "deleted the custom roof profile
  and changed the price total"). A draft read Settings' product list alone and
  RI-925 was no longer in it (the list the reload bug of 2026-10-28 wrote
  over); and `_qStampCustomerCopy`, on every Quote-tab autosave, stamped that
  poorer list over the quote's own `selectablesSnapshot`. `_selMergeCarried`
  now adds to Settings' grades / profiles / gutters / extras any row the
  quote's own snapshot carries that Settings has NO row for, in `_selectables()`
  and in the stamp; a product Settings REMOVED keeps its row there
  (`removed:true`) and stays removed. AS SENT, AND AS WORKED OUT TODAY: a sent
  quote's base lines are frozen, the Pricing drawer works the job out again
  from today's roof, price book, products and typed prices — the owner saw the
  two disagree by $4,723.06 on 3306 and read it as lost custom pricing (cause
  NOT yet known: the drawer itself showed materials at cost, revenue = cost).
  `#prAsSent` (`_asSentInfo` / `_asSentRender`, from `renderProfitability`) says
  part by part (`_qBaseParts` of the frozen lines vs `_qBaseToday`) where they
  differ, on the sent/accepted view and on a draft duplicated from one
  (`S.quote.dupFrom`, in Q_FRESH_DROP); "Keep the sent prices on this draft"
  (`_asSentCarry`) adds a visible "As sent …" custom line per card for the
  difference. THE SAME NOTE IS ON THE QUOTE TAB (`#qAsSentBar` under the Viewing sentence, `_asSentBarRender`, 2026-10-29: he duplicated with the drawer shut and never saw it), and on a duplicate it names an "Options" difference too: `dupFrom.sub` is the version's EMAILED total ex GST (`_asSentVersionSub(S._qvViewing.total)` — never `_quoteMoney()` on the sent view, which reads live option prices), found by `dupFrom.at` for a draft duplicated before it was recorded; what the three base lines do not explain is `diffs.other`, carried as an "As sent — options" material line. `tests/dupcarry.mjs` (18). ASK THE OWNER what that box names on
  job 3306 before guessing at the cause.
- A settings PUT echoes the row back. MERGE that echo into `S.settings`,
  never replace with it: a backend that predates a field echoes the row
  without it and silently undoes what was just saved.
- The app and the API are different origins. A response header a `fetch()`
  needs to read (`Content-Disposition`, say) must be named in
  `Access-Control-Expose-Headers` or the browser withholds it.
- A function that both alerts AND swallows its error makes every caller's
  `catch` dead code. If any caller can recover, throw — see `openJob`'s
  `quiet` option.
- A failed database read is an ERROR, never an empty result. `_mustRead()`
  turns a PostgREST failure into a 503 `UPSTREAM_UNAVAILABLE`; reading it as
  "no rows" once logged the owner out of his company, dropped the Fergus
  key and showed "No subscription found" after a reload.
- THE UNDERLAY HAS A DEFAULT PRODUCT, AND THE PRICE SHEET DOWNLOADS AS CSV
  (2026-10-11, info@wellingtonroof.co.nz). `price_book.defaultUnderlayProduct`
  names the office's default paper and `populateOrderDropdowns` puts it in
  `#orderUnderlay` ONLY when that box is empty — a job that has chosen its
  paper is never overwritten, which is the rule the whole thing rests on.
  The `#pbDefaultUnderlay` DROPDOWN that used to set it is gone (2026-10-20):
  the key is now a Default radio on the papers table — see A PAPER IS ONE
  PRODUCT, which supersedes this half. `refreshDefaultUnderlayPicker` is dead
  code that early-returns on the missing element; four call sites still reach
  it.
  `_pbExportCsv` (beside Copy my price book) writes one row per item RoofMap
  prices off the roof: Steel grade, Item, Unit, Price. It walks
  `PB_CSV_TARGETS` + the sheet variants per grade, and a grade with no prices
  of its own is LEFT OUT rather than listed at the base grade's numbers,
  which would read as a price somebody had set.
  THE PRICING PAGE HAS ITS OWN CSV (2026-10-12, the clarification: "the
  intention was for a Quote Pricing sheet to be available as Download CSV
  beside" Save pricing as PDF — a different sheet from the price book's),
  AT THE PDF'S LEVEL OF DETAIL (the same day, once the first version
  shipped: "can it be available with the same level of detail as the Save
  Pricing as PDF? Current Download pricing as CSV option is set for summary
  only." He was right — it was the profitability list alone, and the PDF
  prints the whole page). `saveScopePricingAsCsv` / `_scopePricingRows`
  write one nine-column sheet — Section, Item, Detail, Qty, Unit, Rate,
  Charge-out, Cost, Hours — with a blank row between sections, covering
  every card on `#tab-scope` in the order it is printed: Job (ref, client,
  roof area, pitch), Scaffolding (type, price, cost), Roof labour (how it is
  charged, lead and apprentice hours at their rates, the total), Roof
  materials (EVERY row of the material table with its qty, unit and $/unit,
  honouring `MATERIAL_OVERRIDES`/`MATERIAL_DELETED` exactly as
  `_materialsTotalFromRows` does, then the buffer, the mark-up and the
  total), Guttering (each material line, buffer, mark-up, labour by hour or
  by the metre, the platform uplift, downpipes, the card total — or one row
  saying it is excluded), Job profitability (the panel's own list), Totals
  (TOTAL, gross profit, GP%, GP/hr) and Per square metre. Read through the
  SAME helpers the cards read, never a second copy of the arithmetic, so a
  figure in the file cannot disagree with the one on screen. All ex GST and
  the header says so. Named for the quote's ref so two jobs do not
  overwrite each other.
  `tests/pbdefaults.mjs`.
- A 5 MB PAGE IS NOT A 30-SECOND LOAD, EXCEPT ON A BUSY RUNNER (2026-10-20):
  `roofmenu` died at 30.4 s on a main run with nothing but `TimeoutError`, and
  a red main SKIPS THE PROMOTE, so one slow `file://` load of app.html held a
  whole ship. Playwright's default NAVIGATION timeout is exactly 30 s and no
  suite had ever raised it; the re-run went green, which is the signature.
  `tests/_navtimeout.cjs` is preloaded into every suite by `run.mjs`
  (`NODE_OPTIONS=--require`, so `playwright` is patched before a suite's own
  import binds a name) and arms each context and page with 90 s
  (`TEST_NAV_TIMEOUT_MS` to change it). ONLY the navigation timeout: waiting
  longer for a page costs nothing on a green run, while waiting longer for a
  button that will never appear only makes a real failure slower to find.
  That is one lever instead of ~200 `goto` calls across 100 suites, which is
  200 chances to fumble an edit. Proved by measurement, not assertion: with
  the preload at 3000 and 8000 ms a hanging server times out at 3003 and 8003.
- ONE BUTTON PER GUTTER YOU SELL (2026-10-20, the owner: "the default pricings
  'Guttering & spouting' section should show each of the gutter options listed
  in the 'quotes product options' show them as buttons to select to switch
  between the gutter types at the top ... one button for each and any different
  gutter entered in the 'gutter profiles' list"). `#pbGutTabs` is one chip per
  row of `selectables.gutters` (`_pbGutTabsRender`, `_pbGutSelect`,
  `window.__pbGut`), and only the picked product's `[data-gut-pane]` is on
  screen — three blocks stacked down the page put the one he wanted in the
  middle of two he does not sell.
  A GUTTER THE OFFICE ADDED HAD NO PRICE BOXES ANYWHERE, so its supply quoted
  at $0 and the shortfall only showed as a quote that came out low.
  `_gutterMaterialLines` has read `<id>_lm` for a non-itemised product since
  custom gutters were allowed, but nothing ever WROTE that key and
  `_gutterMaterialPerLm` only knew the three shipped ids. `_pbGutGenericRender`
  draws a pane per unlisted product with a `[data-gut-pb]` box, the collector
  reads them, and `_gutterMaterialPerLm` falls through to `<id>_lm` for any id.
  `collectPriceBookFromUI` now starts `pb.gutter` from what is STORED and
  overwrites the known ids, so a save made on a page showing one pane cannot
  wipe the rates behind the others.
  THE BRACKET BOXES ARE ON BOTH SURFACES, ONE NUMBER (the same message: "why
  does the Gutter section ... still not show the external and the internal
  bracket prices ... the 125mm box gutter is missing it's brackets pricing").
  `_pbGutBracketsHtml` renders spacing / per-run / internal $/ea / external
  $/ea / flat ext $/lm inside each pane, and `_pbGutBracketEdit` writes the
  GUTTER'S OWN ROW through `_selEdit` — the accreditation-logos rule, two
  surfaces onto one store, never two boxes for one number (which is the fault
  the external rate was stuck behind for a fortnight).
  PRICING THE TWO BRACKETS ON A NON-ITEMISED PRODUCT DOES NOT MOVE THE BASE,
  and that is deliberate: the box gutter's $/lm already includes its brackets,
  so `_gutterMaterialLines` still charges no bracket line there and
  `_bracketExtTotal` uses the pair only to work the UPGRADE out. The pane says
  so in words.
  AND HIS "BOTH SAY INCLUDED" WAS A CACHED PAGE, not a live bug: the Gutter
  profiles table in his screenshot is the five-column shape from before
  2026-10-19, with that day's wording absent. Driven on the current build the
  upgrade reads +$314.64 on a 45.6 m run at his own 6 $/lm. An ACCEPTED quote
  keeps the figures it was sent with, so a rate typed after the send never
  reaches it — tell him to reload before judging, and that the frozen copy is
  frozen on purpose. `tests/gutterprice.mjs` (59).
- A PAPER IS ONE PRODUCT, NOT THREE ROLL SIZES (2026-10-20, the owner: "remove
  the m2 options for paper, instead when i '+add underlay' is asks for the
  name, $ and m2, then in the 'underlay' section it just lists the underlays
  I've add and asked me which one is my default like the 'steel grades' has").
  A roll size is a FACT ABOUT THE PAPER, not a choice beside it: the office
  buys DriStud RU24 and its roll is 50 m² whatever is typed in a box below, so
  the three 50/75/100 price boxes priced a paper nobody had said they used.
  A catalog row is `{name, price, m2}` now (`materials_catalog.underlays`),
  rendered as a little table with a DEFAULT radio — the steel grades' base
  column, which is what he asked it to look like — and the old
  `#pbDefaultUnderlay` dropdown is gone with the boxes.
  NOTHING ALREADY PRICED MOVES, and that is what the shape is for.
  `_underlayProducts()` fills a row's blank price or roll size from
  `price_book.underlay` (the old per-roll-size map, which the settings save
  KEEPS rather than clearing — it is also what a Custom Price Book line linked
  to `underlay.75` still writes into), and with NO papers on the list at all
  the three roll sizes stand in as products, exactly as they did. A fresh
  account ships that list empty, so without the fallback every one of them
  would have stopped ordering paper.
  `_underlayPick()` is the paper this device is working on (the Job Pack's own
  picker, else the ticked default, else the first) and `_underlayRollM2()` its
  roll — the quote's material breakdown, the priced take-off, the Job Pack's
  consumables card and the printed strip all read those two, so the rolls on
  the pack and the rolls on the quote cannot disagree.
  A VARIANT MAY CARRY ITS OWN QUANTITY (`_matRowQtyRaw`): a 100 m² paper is
  fewer rolls than a 50 m² one for the same roof, so the count has to follow
  the product picked rather than sit at the row's default. FOUR readers took
  `ov.qty ?? r.autoQty` by hand — the table, the materials total, the pricing
  CSV and the Fergus push — and four hand-copies is how the consumables
  formulas drifted; they go through the one helper now. A typed override still
  beats both. `_cpbPathForVariant` answers '' for a named paper (its price
  lives on its own row, so there is no price-book field to link or save into)
  and still answers `underlay.<n>` for a legacy roll size.
  THE BACK-TRAYS were already length × $/lm (`_backTrayEachPrice`); what was
  missing was the page saying so, so every box is labelled ($/lm) and the
  section says it in a line of its own.
  AND THE TAB IS "DEFAULT ITEMS" (same message), with its one
  "Roofing sheets, flashings & back-trays" band split into a Steel grade
  picker over three tiles — one band over three unrelated lists is the fault
  the settings tiles were built to fix. `tests/pbdefaults.mjs` (45).
- RELOCATE BACKGROUND IMAGE (2026-10-20, the owner: "if i've drawn a
  building/roof outline and want to swap the back ground image ... i want to be
  able to reposition the background image seperate to the roof outline"). He is
  right that there was no way: `IMG_OFFSET` and `DRAW.zoom` move the whole
  COORDINATE SYSTEM — the drawing is stored in IMAGE pixels, so panning and
  zooming move the picture and the roof lines together, which is exactly right
  while tracing and useless once the picture underneath has been swapped.
  `DRAW.bgAdjust = {dx, dy, scale}` is a second offset and size applied ONLY
  where the picture is painted. The outline does not move and, above all,
  `DRAW.scaleMetresPerPx` does not either: the scale belongs to the DRAWING,
  not to whatever photo happens to be behind it, so a relocate can never
  silently reprice a job.
  `BG_RELOCATE` is a MODE, not a setting — off on load, the button says so
  (`#btnBgRelocate`, far right of the Edits row as asked), and the blue strip
  under it (`#bgRelocateBar`) reports where the picture has got to, with "↺ Put
  it back" and Done. `_panOrigin()` / `_panApply()` are the one seam the drag
  goes through, and `adjustZoom` sizes the PICTURE (0.2–5) while the mode is on.
  THE DRAWING IS HELD STILL, which is the bargain: the mode's branch is the
  FIRST thing in `onCanvasMouseDown`, ahead of every hit-test, or a press
  inside the outline would land on a corner, a junction or a gablet handle and
  drag the roof; `setTool` refuses anything but `select` and says why, BEFORE
  `finishCurrent()` can commit something half-drawn.
  `_bgRelocateOff()` is called from `_releaseJobContent()` — the one list every
  job-change path goes through — because leaving a drawing-locking mode on
  across a job switch would refuse the next job's first corner with a message
  about a picture nobody had swapped. It does NOT put the tool back there: a
  job being laid out has its own tool, and calling `setTool` mid-restore runs
  another tool's instructions over it.
  `bgAdjust` rides in the draw block and is held across the picture's
  ASYNCHRONOUS load in `_BG_ADJUST_PENDING` — a module-level var, NOT a
  property of DRAW, because `restoreFromJob` rebuilds DRAW and anything parked
  there is gone by the time the image arrives. A new picture starts where it is
  put.
  THE NUDGE IS IN IMAGE PIXELS, NOT SCREEN PIXELS (the owner, within the hour
  of it shipping: "now the quote aerial is way off!"). It was stored in screen
  pixels, which is what a drag hands you, and that is wrong twice. The picture
  slid out from under the roof the moment the office ZOOMED after lining it up
  — the same screen offset is a different amount of ground at every zoom — and
  the QUOTE'S OWN ROOF MAP, which works entirely in image pixels, could not use
  the figure at all: `_qpRoofMapSvg` drew the photo at 0,0 where it had always
  drawn it while the canvas showed it 1156px away. `_panOrigin` / `_panApply`
  convert through `getImgTransform().s`, the canvas paint multiplies by it, and
  `roofMapGeom.bgAdj` carries it to the quote (carried forward like the frame
  and the rotation when a render has no live picture to read).
  AND THE CANVAS SIZES THE PHOTO ABOUT ITS CENTRE, not its top-left — `dispW`
  changes and `ix` re-centres — so an image pixel q lands at the drawing
  coordinate `bgW*(1-scale)/2 + dx + q*scale`. The SVG places it the same way,
  and rotates about the photo's centre moved by the nudge. Measured against the
  canvas rather than reasoned about: the first version anchored top-left and
  was 100px out at 125%.
  `tests/bgclear.mjs` (23) is a tripwire on both halves: seven pins fail on the
  pre-relocate build with `BG_RELOCATE is not defined`, and three more take one
  image pixel through BOTH renderers and require the same drawing coordinate
  out of each, before the move, after it, and at a different view zoom.
- A ZOOM STEP IS A PROPORTION (2026-10-20, the owner mid-job: "the plus/minus
  zoom jumps too much between clicks, it should also let me enter an exact
  number (the 311% text should be editable), also as you can see the number
  doesn't change of the zoom when in 'moving picture only' mode"). Three faults
  in one small control, two of them older than the relocate mode.
  `ZOOM_STEP` is 1.08 and `_zoomStep(cur, dir)` multiplies: a flat ±0.1 is a
  tenth of the picture at 100% and a twenty-fifth at 250%, and on the PICTURE's
  own size — which starts at 1 and is often taken down to 0.4 — one click moved
  it a quarter (his screenshots: 40% to 50%). `adjustZoom` takes the sign of
  its argument and nothing else now, so its two callers are unchanged.
  `#zoomLabel` IS A SPAN, contenteditable, and stays one: a dozen places in
  app.html set that element's `textContent`, and every one of them would stop
  showing anything the day it became an `<input>`. `_zoomLabelFocus` /
  `_zoomLabelKey` / `_zoomLabelCommit` take a typed figure (with or without the
  %), clamp it, and a figure that is not one leaves the zoom where it was.
  `#roofZoomStepper` is exempt from the job-lock typing guard — zoom only
  LOOKS, which is why `adjustZoom` was already in `_LOCK_OK_CALLS`.
  EVERY READOUT GOES THROUGH `_zoomLabelSync()`. Eight places used to write
  that element's text by hand from `DRAW.zoom` (Fit, the pinch gesture,
  Ctrl+wheel, a picture being placed, a job being restored…), which is how a
  box that is sometimes showing the picture's size instead goes wrong: press
  Fit while relocating and it would read the view's zoom under a caption
  saying "Picture size:". Ctrl+wheel takes the proportional step too, so one
  control does not feel coarser than the other at the same zoom.
  AND THE BOX SHOWS WHAT IS MOVING: while the picture is being relocated,
  `_zoomLabelSync` puts the PICTURE's size in it and the caption beside it
  (`#zoomCaption`) reads "Picture size:" instead of "Zoom:" — the view's own
  zoom is not moving, so showing it was showing a number that never changed.
  `tests/canvassetup.mjs` (43).
- THE THREE BASE LINES ARE KNOWN BY A KEY, NOT BY THEIR WORDS (2026-10-22,
  feedback report 69, info@wellingtonroof.co.nz: "Total 33,069.63 is double
  counting Scaffolding; 1st as single line item and 2nd again in item#3 Other
  lines in Quote"). The quote's lines card lets the office retype any line's
  description, and `_syncQuoteBaseLineItems` found its own Labour / Materials
  / Scaffolding lines by `desc === 'Scaffolding'` — so the moment the office
  reworded one for the customer the sync could not find it, added a fresh one
  at the top, and the quote carried the scaffold TWICE: once under the
  office's words (which `_profitFigures` then listed as "Other lines on the
  quote") and once under its own. Reproduced with one `updateQuoteLine` and a
  `calcLabour`. `_base: 'labour'|'materials'|'scaffold'` is the key now,
  stamped on the line the first time the sync sees it, so a renamed line stays
  the base line and keeps being priced; `_profitFigures` and
  `_qpScaffoldInLines` read the key. A QUOTE ALREADY CARRYING THE PAIR HEALS
  on its next sync: the office's reworded line (its words start with the
  stem — scaffold / labour / material — and it carries the base figure) is
  kept as the base line and the duplicate with the sync's own exact name is
  dropped; a custom "Scaffolding extra week" at its own price is never taken
  for the base line. `tests/profititems.mjs`.
- THE TOTAL IS A SHEET OF ITS OWN, AND EVERY SHEET CARRIES ITS OWN ROOF AREA
  AND GUTTER (2026-10-22, feedback report 68, the same roofer: "With Multiple
  Roofs the Quote Total and Main Roof return same the same results for Main
  Roof. Quote Total should be for sum all Roof area 200.6 m² as shown in Job
  Pack All Roofs view. Each CSV export view (Total / Main / R2/R3) shows the
  same Total Guttering length for total job"). Three faults in
  `_scopePricingRows` and one in `_profitFigures`, all reproduced on a
  three-roof job first. The CSV's scope was the roof TAB alone, so with the
  profitability panel's Quote Total pill lit it still exported the main roof
  — the two sheets were the same sheet. The pill decides now: Quote Total on
  the main tab prints the whole quote (the labour, materials and scaffolding
  cards are the Main Roof's, the only cards there are, and "This sheet
  covers" says so; each optional roof the customer took is its own row under
  Job profitability); a roof's pill, or the drawer on an extra roof's tab,
  prints that roof. `_profitFigures('total').area` adds every optional roof
  the total counts (it was the main roof's alone, so the per-m² figures were
  worked on a third of the roof). And the Guttering section is the sheet's
  own: the Quote Total sheet prints the quote's gutter (priced ONCE, over
  every roof it covers — the card's own bottom line); a roof's sheet prints
  the metres on that roof and the roofs folded into it, the material at that
  length, its own downpipes, no platform uplift, a total marked "this roof's
  share", and names where the whole figure is. `tests/profititems.mjs` (26).
- EACH SHAPE IS A PICTURE OF THIS OUTLINE (2026-10-22, feedback report 67: a
  gable with a step-down AND a valley junction, "it made it very strange and
  complicated and wrong … instead of a list of roof types to select, can it
  instead show all possible roof types as boxed pictures with the roof type
  name under … each boxed roof picture should show the roof map as the
  outline is drawn but with roof type lines drawn in"). `_roofSetupPopup`'s
  six shape buttons are a 3 × 2 grid of pictures now: `_roofPreviewSvg(type,
  outline)` draws the outline in the gutter colour and that shape's lines in
  the map's own colours (`LINE_COLORS`), the name under each, SUGGESTED still
  on the footprint's own guess, the old hint as the button's title. The
  pictures come from `_roofPreviewLines`, which runs THE SAME BUILDERS the
  button then runs (`_roofLinesForType`, the dispatch lifted out of
  `autoGenerateRoof`) with the orientation the build would decide
  (`_roofOrientForOutline`, lifted out of the same function) — and moves
  NOTHING on the roof: every DRAW field the builders read is set for the call
  and put back, the drawing's own lines are never touched, a builder that
  throws gives an empty picture. `tests/canvassetup.mjs` pins six pictures,
  the colours, the roof untouched, and that the picture picked is the roof
  built, type for type. The `#_rsTypes` and `data-rstype` hooks the tour
  and nine suites click are unchanged. The report's own roof — whether the
  gable-hv builder draws that step-down-with-a-valley right — is NOT this
  fix and was not reproduced; he wrote that he "had to delete and add custom
  lines", and the picker is what he asked for instead.
- A PRICING EXPORT IS THE TAB IT WAS TAKEN FROM (2026-10-20, Scott at
  info@wellingtonroof.co.nz, relayed by the owner: "when the Roof 2 Option is
  included, the Quote Total and Main Roof totals are the same, but the Roof 2
  total shows correctly ... CSV exports appear to be a mix of Total, Main and
  Roof 2 data"). Both halves were one fault. `_profitFigures(view)` adds
  `_profitSelectionItems()` to every view, and an OPTIONAL ROOF is one of those
  items — so the main roof's view carried the other roof's whole price and read
  identical to the quote total, while the roof's own tab, which does not take
  that path, was right all along. A selection that IS another roof is counted
  on `'total'` only, and on that view its cost and hours are the roof's own
  (`one(it.roofIdx)`), so the margin is honest rather than revenue with no cost
  under it. A grade, a gutter or a bracket is still the main roof's, as it was.
  AND `saveScopePricingAsCsv` ALWAYS ASKED FOR `'total'`, whichever tab was on
  screen, while every other row in the file came from the tab — which is the
  "mix" exactly. `_scopePricingRows` reads the tab's own scope now, says in its
  first rows which roof the sheet covers, and on a roof's sheet appends the
  whole quote's TOTAL / gross profit / GP% at the foot so the one figure a
  reader goes looking for is not missing. A single-roof job is unchanged — one
  pricing tab means the scope IS the total. `tests/profititems.mjs` (20).
- A MODERN POLE SHED LOOKS LIKE A MODERN ROOFING QUOTE (2026-10-20, the owner:
  "the classic is ok but the modern needs alot of work, i want it to look more
  like the style and look as the roofing modern quotes, because at the moment
  the look of the modern pole shed quote looks like a cross between the classic
  and modern roofing quote"). He is describing exactly what it was. Since
  2026-10-12 the shed's modern sections WRAPPED the A4's own blocks — one
  source of truth for what a shed is, which was right then and is still right
  about the FACTS, but it carried the A4's chapter bands, its `--ed-*`
  typography, its two-column grids and its navy money card into a layout built
  out of white `.qb-*` cards. Hence the cross-breed.
  SO THE FACTS STAY SHARED AND THE PRESENTATION FORKS, which is how the roofing
  quote has always worked: `_qbGrade` reads `_selGrades()` and the A4 reads the
  same list, and neither renders the other's markup. Every `_psm*` function
  reads the shed's own helpers — `_psGet`, `_psSpecGet`, `_psPlans`,
  `_psAddons`, `_poleShedMoney`, `_paletteForGradeId` — so the two styles
  cannot drift about what the shed IS, while each looks like itself. CLASSIC IS
  UNTOUCHED, and so is every roofing quote.
  AND IT IS A DECISION PER SECTION, like the roofing quote: the shed's one
  "Choose Your Options" page became six sections (`psplan`, `psgrade`,
  `psthickness`, `pscolour`, `psroller`, `psaddons`), each a full-width band of
  `.qb-opt` rows with a Recommended badge on the roofer's own pick and the
  price difference at the right. `psplan` only where there is more than one
  plan, `pscolour` not on Zincalume, `psaddons` not when there are none and the
  quote is the customer's — the roofing quote's own rule, and the numbering
  closes up behind each. The nav, the scroll-spy, the rail, the phone book's
  page turning and the PDF slicer's break rows all come free, because they are
  keyed on the classes the roofing quote uses.
  THE REVIEW SECTION IS KEYED `review`, NOT `psreview`: the rail's "Review
  quote" button and the narrow screen's bottom bar both scroll to `#qd-review`,
  so a shed with its own key had a Review button that went nowhere.
  THE COVER'S HERO IS STILL SLOT `PS_HERO_SLOT` — the same picture the A4 uses,
  so the two can never show different sheds — presented in the roofing cover's
  `.qb-hero` frame and keeping the slot's drag / wheel / zoom handlers, which
  are found by `.qp-cond-photo[data-cp-idx]`. It stays a `<figure data-cp-hero>`
  because `_psPdfFitCover` grows exactly that element to fill the PDF's first
  sheet. Its headline reads `S.quote.psSubtitle` STRAIGHT OFF THE QUOTE rather
  than through `_psGet`, which falls back to `POLESHED_DEFAULTS` — that default
  is "Colorsteel option", a spec line, and it was the cover's title.
  THE DELTAS READ GST-INCLUSIVE on the option cards (`_psmDelta` = `_qbIncl`),
  like every roofing card and like the total in the rail beside them. The A4
  prints them ex GST with "+GST" beside; nothing in the arithmetic moved.
  `_psPlanSwitchHtmlCust` is untouched and keeps its own wording.
  `_qbOptionPage` says "Recommended for your SHED" on a shed — the one word
  that gives a shared renderer away.
  THE ADD-ONS ARE THE ONE MULTI-PICK LIST, so the row is a tick box and the
  office's pencil sits OUTSIDE the button that ticks it: a button inside a
  button is not valid markup and the browser breaks the inner one out of its
  parent (the plan rename pencil's lesson). `.ps-ao-hit` is named in the PDF
  layer's "hide every button" exception, or every add-on would print as an
  empty box.
  THE OFFICE KEEPS EVERYTHING IT HAD: the spec rows are still contenteditable
  `[data-qfield]`, the consent switch is a segmented control, the WebShed
  import and `_psPlanBarHtml` sit above the drawings, and the wording lists and
  the subtotal override live in `.ps-office` boxes that say "Office only". None
  of it reaches paper — `.no-print` only fires under `@media print`, which an
  html2canvas capture is NOT, so `.ps-office`, `.ps-ao-tools`, `.ps-draw-tools`,
  `.ps-seg` and `.ps-draw-hole` are named in the `pdf-modern` layer.
  DEAD CSS WAS DELETED, NOT LEFT TO MATCH NOTHING: the phone overrides written
  against the A4's grids (`[style*="grid-template-columns:1fr 1fr"]`, `.ed-h1`,
  `.ed-heading-band`, the 36px gutters) and the print rules for `.ps-draw-col`,
  `.ps-draw-empty`, `.ps-tap-note`, `.ps-accept-card` and `.ed-ofpages` all went
  with the blocks they were written for. `.ps-draw-img`, `.ps-draw-wrap` and
  `.ps-spec-empty` are reused ON PURPOSE so the 2026-10-20 PDF sizing work
  keeps paying off. `tests/poleshed.mjs` (213).
  STILL THE OWNER'S CALL: the A4/classic shed is unchanged, which he said was
  fine — but the two now differ in more than typography, so if he wants the
  classic brought closer, that is its own job.
- A SHED PICKS ITS PROFILE, AND ITS GUTTER COMES COMPLETE (2026-10-21, the
  owner: "add the profile selection and gutter selection for the pole shed
  like the roofing quote has, however the pole shed only option should be
  125mm box gutter with downpipe compulsory with gutter selected"). Two new
  sections on the shed's modern quote, `psprofile` after `psgrade` and
  `psgutter` after the colour, both in the `.qb-opt` idiom the roofing quote
  uses, so the nav, the scroll-spy, the rail and the phone book's page turning
  all come free.
  THE PROFILE LIST IS THE COMPANY'S OWN — `_selProfiles()`, the same products
  Settings → Quote's Product Options maintains and the roofing quote offers.
  A business that sells RI-925 sells it on a shed too, and a second list of
  shed profiles is a second place to forget one. `_psProfileCost(id)` prices
  it off the SHED'S own measurements (`_psCladArea()` = the estimator's roof
  area + wall area, which is what it already worked out to price the
  cladding), at the profile's own `rate`/`rateUnit`; an `lm` rate divides the
  area by the sheet's cover, the figure an lm rate is quoted against.
  BLANK IS THE WHOLE COMPATIBILITY STORY, exactly as it is on the roofing
  quote: no rate means `_psProfileCost` is null, every delta is 0,
  `_psProfileDeltasSnapshot()` returns null and `_poleShedSelItems` pushes no
  row — so every shed quoted before today reads to the cent as it did, and
  nothing migrates. `_psBaseProfile()` (`q.psBaseProfile`, stamped at recalc)
  is the profile the shed was PRICED at, so the quoted one reads "Included"
  and the others read the real difference either way round. The deltas are
  FROZEN onto the quote as `psProfileDeltas` because the customer's copy has
  no price book AND no estimator — the FR-14015 lesson twice over.
  A SECTION OFFERING ONE OPTION IS NOT A DECISION: `_psmProfile` returns `''`
  with fewer than two profiles, and `_psPicksAuto` leaves the row out with it,
  so the two cannot disagree about whether there was a choice.
  THE GUTTER IS ONE PRODUCT AND IT IS ALREADY IN THE PRICE. `PS_GUTTER_ID` =
  `box125`; there is no brackets-and-downpipes section the way a re-roof has
  one, because the downpipes are not a second decision. The shed's take-off
  carries "Box gutter + downpipes" as a priced line (guttering IS part of the
  main price, 2026-10-13), so the gutter reads Included and the only money is
  DECLINING it: `_psGutterAllowance()` credits what that line actually
  charged — `_shedMaterialRows()` filtered to the gutter rows through
  `_materialsTotalFromRows`, so the typed quantity, the typed $/unit, the
  buffer and the mark-up all come with it. Not the rate card's guess, or
  declining the gutter would take off a different figure from the one it put
  on; a row the office DELETED credits nothing, because nothing was charged.
  Frozen as `psGutterAllow` for the same reason as the profile deltas.
  A PROFILE ROLLED IN ONE GAUGE DECIDES THE GAUGE (`_psProfileLock`, the
  roofing quote's `_setProposalOption_profile` rule): `_setPsProfile` forces
  `psSelThickness`, the thickness section becomes one static "Locked for
  5-Rib" card naming the profile, and the PROFILE'S card carries the upgrade
  — the card is the all-in cost of the choice, which is `_qbProfile`'s own
  semantics. The money is still counted ONCE, on the thickness row of
  `_poleShedSelItems`, which is the one engine `_poleShedSelDelta` sums.
  `tests/poleshed.mjs` (222). THREE PINS THAT HAD TO MOVE WITH IT, and they
  are the stale-pin lesson again: the suite asserted a shed offered no profile
  section, no guttering row and an exact picks list — all three were pinning
  the absence of what he has now asked for.
- A QUOTE LEAVES AS THE ROOFER, OR IT SAYS WHY (2026-10-21, the owner with two
  emails side by side: quote 3320 on 18 Oct went out as `Flood Roofing
  <floodroofing@quotes.roofmap.co.nz>`, reply-to office@floodroofing.co.nz,
  signed by quotes.roofmap.co.nz — and quote 3305 the next day went out as
  `RoofMap <support@roofmap.co.nz>`. "why did my quote get sent through
  support@roofmap.co.nz?")
  BOTH HALVES FAILED TOGETHER, which is what names the cause. The From NAME
  and the From ADDRESS come from one place — `_tenantMailIdentity` over the
  settings row — so a quote wearing neither is not two bugs, it is that read.
  And no commit between those two sends touches the path at all (checked:
  only ec4621f landed between them, and it is the jobs list and the version
  naming). NOT A REGRESSION IN THE CODE, therefore: a read that failed.
  `/email/send-order` called `_companySettingsRow(req)` — `select('*')` — to
  find a company name and a reply-to. On THIS table that drags the logo, the
  cover hero, four accreditation logos, every profile and gutter picture and
  the whole custom price book across the wire, on the hot path of every quote.
  The Fergus proxy was narrowed for exactly this reason on 2026-09-23; the
  mail path never was. And it sat inside `try { ... } catch (e) {}`, so a slow
  or failed read left the identity at `{null, null}` and the quote went out
  from the PLATFORM address, nameless, with no reply-to, and nothing anywhere
  said so. `_mailIdentityOf` reads three jsonb paths instead
  (`cname:branding->>company_name`, `bemail:branding->>email`,
  `emcfg:quote_defaults->email`), PostgREST extracting them server-side the
  way the jobs list does for the job number; `_mailIdentityRow` builds the
  small stand-in row the route's own helpers (`_emailCopies`,
  `_termsWantedFor`, `_tenantMailIdentity`) read, which is the whole of what
  the fat read was for.
  NOT CACHED, and that was a round. A 60 s TTL went in first and broke the
  terms switch and the CC list — `termsoftrade` caught it — because this one
  read also carries `quote_defaults.email`, which the old fat read fetched
  fresh every send: turning the terms on and sending straight away got a
  quote without them. Narrowing the read is what makes a per-send read
  affordable; caching it was paying for the cost the narrowing had already
  removed, in staleness.
  A FAILURE IS NOW LOUD AND STILL SENDS. One retry after 120 ms (what takes
  this path out is a moment, not a condition), then the COMPANY RECORD'S own
  name (`_companyNameOf`) so the customer still sees their roofer, and a
  `recordError('mail-identity', …)` naming the company and what the envelope
  fell back to. The quote still goes — "a person who pressed a button and got
  nothing is worse off" — but it can never again go wrong in silence.
  THE OFFICE MAY NAME ITS OWN MAILBOX on the shared subdomain (the same
  message: "i want other users to enter their own xxxxx@quotes.roofmap.co.nz
  (defaults to their business name)"). `quote_defaults.email.sender_local`,
  Settings → Email → Sent from: a box for the mailbox NAME with the domain
  shown beside it and unerasable, because an address half-typed into a free
  text field is a From line nobody can send from. A BLANK BOX IS THE
  STANDARD: no key means `_tenantLocalPart(company_name)`, so every account
  that never opens that box keeps the address it has been sending from, and
  the default rides in the PLACEHOLDER. `_tenantLocalClean` takes a TYPED
  name literally (lowercase, alphanumeric, 2–30) where `_tenantLocalPart`
  drops the legal suffix — "Kauri Roofing Ltd" defaults to kauriroofing, but
  somebody who types kauriroofingltd means it. Cleaned on the way out as well
  as in, so a row from an older build can never put a space or an @ in a From
  line. `GET /email/domain` reports `tenant {domain, name, derived, local,
  typed, address}` so the page shows the address its mail actually wears.
  UNIQUENESS IS NOT ENFORCED, deliberately and worth knowing: two businesses
  both trading as Flood Roofing would derive the same mailbox. The address is
  IDENTITY, not a mailbox — replies follow Reply-To — so a collision is
  cosmetic rather than a leak, and checking it at send time would be a query
  per quote to prevent something nobody has hit. Revisit if it ever happens.
  `tests/sendername.mjs` (16, in run.mjs's API list) is the tripwire: it
  drives the real server against a fake Resend with TENANT_MAIL_DOMAIN set
  and pins the actual From line, the typed mailbox, the blank-is-the-default
  rule, and — with `db.__fail500 = 'user_settings'` — that a failed read still
  sends, wears the company's name and is reported.
- SETTINGS SECTIONS ARE TILES (2026-10-08, the owner on the pricing settings
  pages: "These pages are hard to seperate the different sections, make it
  easier to tell the different sections, maybe more of a boarder/tile type
  sections more similar to the quote tab"). A bold run of text on a white page
  is not a boundary — by the fourth heading you cannot tell whether a field
  belongs to the section above it or the one below. `.set-sec` /
  `.set-sec-hd` / `.set-sec-note` / `.set-sec-sub` (scoped to `.settings-sub`)
  are the SAME shape as the Pricing drawer's cards: a bordered white tile with
  the quote page's navy band across its head. `.set-sub-hd` is a block INSIDE
  a tile (Downpipes under Guttering, which the documented tab order keeps
  together) — a dashed rule and small caps, plainly a step down from a band.
  Carried by Quote's Product Options (`renderSelectablesUI` — one wrapper in
  `section()`, one in the fixed groups, one for Your own options), Default
  item pricing and Labour pricing. Settings → Suppliers still uses the old
  flat `border-bottom` divider; convert it the same way when it next comes up.
- LABOUR CHARGED BY AREA, THE GUTTER BY THE METRE (2026-10-08, the owner:
  "make the labour pricing switchable between the current hourly or m2, for
  the gutter make the labour switchable from hourly to LM ... let the user set
  their default m2/lm rates in settings, alway if they adjust it in the
  pricing tab ask if they would like to save as the new default, make the
  switch between hourly and m2/lm two big buttons at the top of each labour
  pricing section"). `tests/labourmode.mjs`.
  THE MODE CHANGES THE PRICE, NEVER THE COST — the one rule the rest hangs on.
  Hours come off the drawing and are what the job really takes, so cost stays
  hours × cost/hr and GP, GP/hr and the whole profitability panel stay honest
  whichever way it is charged out. An extra labourer added on an m² job shows
  up in the cost and the margin, not on top of a price the rate already covers.
  `S.quote.labourMode` is `'hourly'` (default) or `'m2'`, `S.quote
  .gutterLabourMode` `'hourly'` or `'lm'`; `S.quote.labourM2` /
  `gutterLabourLm` are THIS job's rates and 0 means "use the Settings
  default" (`labour_pricing.labour_m2` / `gutter_lm`, also 0 = never set).
  With NO rate anywhere the hourly figure stands — a switch must never price a
  roof at nothing. Three seams carry it, and there are only three:
  `calcLabour` (roof 0 → `S.labour`), `_labourPriceForRoof` (every other roof)
  and `_gutterLabourCharge` (one caller, so the gutter card, the customer's
  gutter price and the profitability panel cannot disagree).
  `_labourModeButtonsHtml` / `_gutterLabourModeButtonsHtml` draw the two big
  buttons plus the rate box; `_setLabourM2` / `_setGutterLabourLm` save the
  job's rate and then ask `_labourRateAskDefault`, which reuses the material
  rows' own `_matDefaultAsk` dialog (same question, so not a second dialog
  saying the same thing differently) and writes Settings → Labour pricing.
  THE $/m² ON THE PROFITABILITY PANEL IS A BOX YOU TYPE IN (`#profitLabM2`,
  `_profitLabM2Typed`): by the m² the typed figure IS the rate; by the hour it
  is a TARGET, spread over every charge-out rate exactly as the ± buttons do,
  so the figure lands where it was typed. `_profitNudge` moves the RATE in m²
  mode — spreading a dollar over charge-out rates nothing reads any more would
  move the number on screen not at all. `gphr.mjs` reads that box's `.value`.
  BOTH NUDGES WORK IN BOTH METHODS. The $/m² step is settled BEFORE
  `_profitNudge`'s `hrs > 0` guard, because a job priced by area may carry no
  hours at all and the ± beside the rate is then the only control there is;
  GP/hr stays behind the guard, since there is no figure per hour without
  hours, and on an m² job it spreads its dollar over the roof's m² instead.
  Every path goes through `calcLabour`, which re-renders the labour table, the
  gutter card AND the profitability panel, so one adjustment moves all three.
  NOTHING REVERTS ON A SWITCH: the four typed figures live in four separate
  places (`labour.leadPrice`/`appPrice`/hours, `labourM2`, `gutterLabour.*`,
  `gutterLabourLm`), all on `S.quote` and so saved with the job, and a mode is
  only a choice of WHICH to read, never a reset. `labourmode.mjs` flips both
  switches twice each and checks all four come back to the cent rather than to
  the Settings default.
  Removed with this: a dead `gutLabHtml` in `renderGutterDownpipePricing` —
  a full second copy of the gutter labour block that nothing referenced and
  that silently absorbed the first attempt at these buttons.
- A CHANGE OF PITCH BREAKS THE ROOF (2026-10-08, feedback reports 9 and 10,
  info@wellingtonroof.co.nz: "when applying / using change in pitch how /
  where can you enter 2nd pitch? ... the job pack sheet lengths don't appear
  to reflect different sheets for change in pitch" — it did nothing at all:
  deleting both lines left the count byte-identical, and a roof carried ONE
  pitch). The owner: "a change of pitch should always break a roof and split
  the sheets and then make two different roof pitches by default always show
  the roof pitch on the roof on the canvas and add another roof pitch to edit
  separate to the main roof pitch whenever there is a change of pitch line or
  another roof outline."
  `DRAW.calPitch` is still THE roof's pitch — everything that knows about one
  keeps reading it, so nothing that worked before moves — and `DRAW.lowPitch`
  is the pitch BELOW the line: a ROOF_FIELD (on `_newEmptyRoof`, in the undo
  snapshot and in `_roofGeometryPayload`), 0 meaning "not typed yet" with the
  roof's own pitch standing in, so drawing the line breaks the sheets at once
  without inventing an angle the roofer never gave. "Lower pitch"
  (`#roofLowPitchInput`, `setRoofLowPitch`) appears in the roof panel only
  where there IS one (`_roofHasChangePitch`, `_syncLowPitchRow`, re-read from
  `autoCalcLineMeasurements` so it shows the moment the line is drawn);
  another ROOF OUTLINE already carries its own pitch pair, and neither leaks
  across. In the engine `_sgmRayDistCp` stops a ray at the line so the ridge
  walk makes the UPPER face only, and `_sgmChangePitchBands` sheets the band
  below it at `lowPitchFactor`, tiled across the LINE's own length (never the
  eave — on a dutch the corners beyond it are the hip ends). Breaking a roof
  orders no extra steel: more sheets, the same square metres.
  ONLY the gable / mono / dutch enumerator does this. The hip-and-valley path
  has no band pass and still measures straight THROUGH a change of pitch —
  deliberate, and pinned: a stopped ray with nothing sheeting what lies
  beyond it would UNDER-order the roof, which is worse than the fault being
  fixed.
  TRIED AND REVERTED on 2026-10-11, and the reason is worth keeping. Making
  `_runFromOutline` treat a change-of-pitch line as an edge (it is a six-line
  loop beside the outline-edge one) does break the hip path's sheets
  correctly, and a band-spec pass (`_cpBandSpecs` in that reverted branch —
  it is NOT in the tree, do not grep for it) can add the bands. But on a HIP
  the band does
  not stop where the line does: the line runs along the two long sides only,
  and the corners and the hip ends beyond its ends are then covered by
  nothing. A 25.4 x 11.2 m hip at 25/10 degrees ordered 300 m2 for a 307 m2
  roof. The dutch is safe from this because its `isDutch` end block already
  sheets the ends; the hip has no such block. Doing it properly means
  covering the eave the band actually runs along, which needs a real roof to
  measure against — ask for the feedback report (Send Feedback on that job)
  rather than reasoning it out from a screenshot.
  THE PITCH IS ON THE CANVAS BY DEFAULT now (it was off until asked for, and
  `tests/roofpitch.mjs` pinned that); a roof with a change of pitch draws
  BOTH — the lower one in the middle of each band — and either plate is the
  click-to-remove target. `tests/report9.mjs`.
- THE DUTCH GABLE COUNTED ITS HIP ENDS TWICE (2026-10-08, feedback report 10,
  the same roofer: "not sure re orange main sheet counts" — he was right).
  `_sgmUncoveredGutters` sheets a stretch of ridge-direction gutter no ridge
  spans from that gutter to the far edge: right for a block beside a straight
  gable's ridge end, wrong on a dutch, where the ridge stops short of BOTH
  ends precisely because there are hips there and the `isDutch` block already
  counts each as its own short-sheet face. So every hip end was counted again
  as a sheet spanning the whole building eave-to-eave over the ridge — 92
  sheets and 397 m² of steel for a 313 m² roof, 27% over, on every dutch
  gable quoted. The rule is skipped on a dutch (`if (!isDutch)`); hip and
  gable on the same outline were already right and are unmoved at 68 sheets.
  It survived because the 37-shape sheet gate covers hip ONLY and no suite in
  the repo had ever counted a dutch gable. `tests/report9.mjs` does now.
- Sheet counting rule (the owner's, pinned in `tests/report52.mjs`): each
  roof counts its OWN gutter ÷ sheet cover, rounded up from a tenth of a
  sheet (10 m / 0.762 = 13.12 → 14; 13.05 → 13). Overlapping roofs never
  change each other's count. Every count site goes through `_sheetsAcross`.
- THE SHEET LAYOUT IS THE PUZZLE (2026-10-21, the owner, after the morning's
  block-cut rebuild: "Boy oh boy it's very wrong! Don't try to use my sheet
  calculation method, alot of it's wrong anyway so start fresh, i want a full
  new build, start by dividing the roof inside sheet width without filling
  any colour yet, lets make the puzzle then fill it afterwards"). The picture
  reads NOTHING from the counting pass (`window._lastSheetSections` is the
  calc check's and the legend's; the earlier rebuild drew from it and that is
  what he threw out). `_sheetPuzzleBuild` at the foot of sheet-plan.js takes
  the roof's own outline and lines, cuts them into FACES (a planar
  arrangement — ridge, hip, valley, apron and change of pitch split the roof
  where they cross or meet; gutters, barges and a line along a wall cut
  nothing), and divides each face into strips one sheet cover wide, SQUARE TO
  ITS GUTTER (no gutter → its ridge → an apron / change of pitch), each strip
  clipped to the face so no piece ever runs past a roof line. HIS RULES, in
  his words, and the suite pins each: sheets perpendicular to gutter and
  ridge, never parallel; 45° to a hip or valley only; nothing past a roof
  line. THE FILL IS ROOF WIZARD'S BLOCK CUTTING (the same afternoon: "Try to
  use roof wizards logic and methods"; `_sheetPuzzleFill`): a face with a
  full strip is ordered as BLOCKS at one length each (the longest piece,
  rounded up to 10 mm; grouped by the level the full strips top out at, a
  cut strip joining the longer neighbour only when it is no longer than
  that block's sheets); every cut sheet's offcut goes into a pool with its
  HAND (long side left or right, looking from the square end to the
  diagonal — a spin keeps it, a flip reverses it, and a sheet is never
  flipped); a hip END, and any strip longer than its block, is cut from the
  pool — same hand, the offcut containing the piece square end to square
  end, the NEAREST fit first — or ordered as an extra sheet of its own.
  WHERE THE STRIPS START is what makes the offcuts match and is decided in
  the builder — THE PLAIN HIP OVER THE RECTANGLE, THEN THE COOKIE CUTTER
  (2026-10-22, the owner on the Big-L, first in words — "imagine the L-shape
  and a rectangle (always picturing the larger area with the longest sheets
  as the rectangle) and run the exact same logic as the plain hip … using
  the offcuts in the same locations … like a cookie cutter" — and then,
  when the first build missed it ("You haven't really followed the
  instructions … It's quite different"), in three sketches over the plain
  hip: the yellow main rectangle laid exactly as the plain hip; the red
  north-west corner, cut off by the valley, pushed 6 m north onto the
  wing's small north face; the purple top strips of the west end pushed up
  with it onto the top of the wing's west slope): flush at a barge; a hip
  END (one top vertex, a hip each side, one of them reaching the gutter
  or dropping half the face's depth) from its APEX; a slope between two hips as ONE RUN of full-width sheets
  along the whole side of its rectangle (`_pzVirtualSpan` follows the
  gutter through the roof: 18 m under an L's wing where the wall shows 12)
  from the END A CUT WING STANDS AT (decided after adoption, so the
  mirrored L is the L to the sheet), else from the WORLD-LOW corner, the
  plain hip's own, agreed across every parallel slope of the roof, unless
  no parallel slope has a real corner there (a T's stem runs from its
  free end); a face's gutter is every gutter edge on its line (a cross's
  slope has a wing in the middle and a real corner either side); the remainder a LAPPED full
  sheet at the far hip corner (`widthMm` shows 0.47, `lapMm` 0.29), so the
  18 × 12 m hip still closes at 48 with two slivers over. THE COOKIE
  CUTTER: a hip end that faces the same way as a slope, stands in front of
  that slope's gutter line inside its rectangle, and is at least a sheet
  narrower on each side (`lay = 'grid'`, `f.template`) takes the SLOPE'S
  columns instead of its apex. Column for column, the slope's valley-cut
  piece and the end's hip-cut piece tile along one sheet (the valley and
  the wing's hip are parallel 45° lines exactly the wing's length apart,
  so the two pieces add up to the plain hip's own column sheet): the top
  piece is the sheet, joins the slope's block and leaves the offcut above
  the hip in the plain hip's own place; the piece under it is its FOOT,
  carried along the column (`✂C5`, `strungTo`, drawn in the block's tint
  with a dashed edge) and costs nothing; a column with only the end's piece
  is the plain hip's corner sheet slid north whole (`viaTemplate`, ordered
  in the slope's block) — unless its column is clipped at the wing's own
  corner (a cross's stub: cut from an offcut, never a whole sheet); a wing
  at the rectangle's far END takes the lapped corner sheet on its corner
  column (`f.endLo/endHi`), a corner mid-rectangle is never lapped. The step-0 chain test in `_sheetPuzzleFill`
  (`tiles`: same column, square at the eave, the lower piece's top cut
  meeting the upper's bottom cut edge for edge in each face's own eave
  coordinates) is the proof; where it fails nothing is strung. A T's bar,
  5.2 m deep beside a 6 m stem, is NOT sliced from the stem — within a
  sheet of each other, the plain hip's own offcuts fit its ends exactly
  and that is the T he called 95% right. WHICH CUT STRIPS ARE THE
  RECTANGLE'S SHEETS: on a slope, those at its real corners (their offcuts
  feed the hip ends); the strips beyond its own gutter under the main (a
  wing slope's valley end) try the POOL first and fall back on the block —
  "the orange sheets at the hip are full length and cut into a triangle by
  the hip, then the offcuts get placed on the same face at the valley … so
  the number of orange sheets = the length of that gutter divided by sheet
  width" (8 on the Big-L's wing, was 12); on a hip end that also carries
  a run of full sheets (the L's west face) every cut strip is an end piece
  from the pool with the block as fallback, which is how the purple strips
  come from D6–D9. THE SERIES (2026-10-22, the owner on the 10 m wing:
  "the blue B7 sheet should be a green offcut, if the green offcuts
  couldn't make it all the way to the end then a 7th Blue B sheet should
  be used next to B6 to push the green offcuts outwards … orange offcuts
  A5 & A6 in the bottom left corner should have been purple offcuts to the
  sheets C8 & C9, again if the offcuts are too short … add another full
  sheet in the middle of the apex to push all the offcuts down one making
  them longer"; on the Z: "the green offcuts D18, D17, D16, they should
  actually be the offcuts to the red sheets F5, F6, F7, and F8"): each
  SIDE of an end face (the hand tells a hip end's halves apart; a slope's
  valley run is a side) is fed IN ORDER (`seriesFeed`), longest piece from
  biggest home offcut, the plain hip's own pairing. WHERE AN OFFCUT IS AT
  HOME (`homeOf`): its own face (a wing's valley from its own hip-cut
  sheets, and the face's own lead the series) or the face across the HIP
  that cut it — the top offcut carries the edge at the sheet's head, the
  bottom one the edge at its foot (`touchTop`/`touchBot`); a VALLEY makes
  no home, which is what sent the main's valley offcuts onto the Z's wing
  while its own F5–F8 sat in the pool. A SERIES IS ONE RUN OF SHEETS
  (2026-10-22, the owner on the Z: "the green D20 is out of place"): after
  C21 the next strip takes C20, the sheet beside it in its block, whenever
  it fits, before a bigger offcut from elsewhere — the wing's own D20 is at
  home on the end face and by size alone landed between C21 and C20; it
  waits now for the strip the C run cannot fill, under the wing's sheets.
  What the series leaves open takes
  the pool at large (`matchPool`: home 600/300, then surplus, then 0.04 mm
  per mm of distance — distance alone was tried and is the wrong guide).
  THE PUSH (`pushPass`): a piece still open whose run of strips is
  series-fed up to it gets ONE full sheet ordered at the run's HEAD — the
  apex (an `extra: 'push'` block, "pushed in") or next to the last full
  strip (the pool-first block's own sheet, the 7th B next to B6) — and
  every offcut between moves one strip outward. A pool-first strip pushes
  before it falls back on its block; a hip end's piece only after the late
  pass, because a bar end's 0.31 m sliver is fed by a valley strip that is
  not a sheet until then (a push for it cost the T two sheets an end, the
  first time). Scraps: a sliver under a third of a sheet wide and under a
  sheet and a half long, or the two-cut triangle where a valley meets a hip
  (under half a sheet wide, under a sheet long) — that triangle used to
  take D8's whole offcut, which is why B7 was ordered. A pool-first stub
  under half its block's length is an extra at its own length, never cut
  from a 7.73 m sheet. THE STRAIGHT CUT (2026-10-22, the owner: "Does E1
  actually have to be a full sheet or can it be the offcut to D1? …
  offcut D2 wouldn't work there because it going straight along the
  ridge a little, in real life the offcut to green D1 should be a
  straight cut"): the strip where a wing's ridge dies into the main's hip
  is bounded by the hip then a short LEVEL run along the ridge, so its
  short side read longer than the hip alone makes it and no offcut was
  that shape — which is what forced the pushed-in sheet at the apex. A
  roofer cuts it ONCE along the hip and the ridge cap covers the run, so
  the builder gives such a piece `cutShortPx` (the diagonal continued,
  only where the level run is on a RIDGE) and the fit and the offcut are
  worked from it; the piece still draws at the roof's shape. THE BIG-L
  COMES TO 64 (was 78, the engine's legend says 66): 48 × 7.73 and
  16 × 3.32, the 16th the B sheet heading the top run where the 3.52
  extra for the junction strip stood, nothing pushed; the west end's
  south half from C9 down to C1 (the wing's whole sheets and the
  valley-cut heads among them), its north half D1–D6 (D6 on the junction
  strip), its top from D7–D9; the east end from D16–D24 and C24–C16; the
  10 m wing 62 (48 × 7.73 + 14 × 5.52, was 63): D1's offcut at the apex,
  D3 on the junction strip, a seventh B beside B6, D4–D9 outward from it,
  exactly as he marked it; the T 74 (75 until the evening of 2026-10-22,
  78 before, 80 before that), its stem
  slopes' short valley strips off the bar's own valley-cut sheets. EVERY
  L HOLDS (2026-10-22, the owner: "used same logic/mechanics on different
  sizes and orientations of the l-shape … also … a both with a wing off
  the top and the buttom"): mirrored, turned and wing-off-the-bottom are
  64 to the sheet with the same `1,2,3,4,✂5,✂6,✂7,✂8` wing; a 24 × 12 L
  with a 4 × 8 wing, a 10 m wing (cut) and a 13 m wing (within a sheet,
  keeps its apex); wings off the top AND bottom at one end both cut, 80
  with nothing pushed; a cross (wing mid-slope both sides) 81 and nothing
  extra; a Z (wings at opposite ends) 81 with a push at the east apex
  (the east wing having taken a hand of offcuts the plain hip's east end
  would have had) and its corner stub a 1.16 m extra. `docs/SHEET_LAYOUT.md` has the
  detail. The footer carries
  the tally per length, the blocks, the feet carried, how many end pieces
  came from offcuts, how many sheets were extra and how many offcuts are
  left. THE PUZZLE'S TALLY AND THE ENGINE'S LEGEND ARE DIFFERENT NUMBERS
  (the Big-L: 64 against 66) and nothing reconciles them — which one is
  the order is his call, not yet asked.
  `_renderSheetPuzzleCanvas({thumb, roofIdxs, lines})` draws it: one tint per
  block with the sheet's number (A12) up each piece, a hatched piece for one
  cut from an offcut (↺A12), the roof lines in the map's colours, the tally
  and block schedule (the F1… face badges and their arrows were taken off
  on 2026-10-23, the owner: "it's pushing the sheet label out of line and
  making it look messy" — the footer names a face by its block, "Beside A:"). The live card
  passes `roofIdxs:[-1]` and `__origDrawLines` (DRAW.lines is the counting
  pass's borrowed copy at that point); the captures pass roof indices, and
  the all-roofs picture is ONE frame now, not a stack. An L's wing and main
  west slopes come out as ONE face because they are one plane — right, and
  the sheets run straight through. `_ccColumnsFor` / `_ccNumberColumns` stay
  in sheet-plan.js for the calc check and are not used by the puzzle. The
  engine is untouched (37-shape gate and every count pin byte-identical).
  History: the cascade picture is saved in `docs/legacy-sheet-layout-draw.js`
  (last live `b81e5c5`); the block-cut rebuild is `fcaab9a` only. The git
  proxy refuses tag pushes — use the SHAs. `SHEET_LAYOUT_HIDDEN` stays as the
  one switch that withdraws the picture. THE DUTCH GABLE (2026-10-22, the
  owner: "do the dutch gable now, aswell as a dutch gable T & L shape") is
  a hip end with its apex cut off and is laid like one: `isGablet` reads a
  face whose top is a chain of apron/barge edges with a hip either side
  reaching the gutter, and lays it from the chain's midpoint as a hip end
  is laid from its apex (`f.gablet`, `f.hipApexD` = where the hips would
  meet). A GABLET IS ORDERED WHOLE AND FEEDS THE SLOPES (the owner, the
  same evening, putting a first misreading right: "the number of those
  short sheets (blue and purple looking at the plain rectangle) should be
  full sheets the whole length of that gutter line, then the offcuts cut at
  the hips should be used in the orange and green areas on the other side
  of the hip"): every strip across a gablet's gutter is one of its short
  sheets, hip-cut ones included, and a slope's corner strip cut by a
  gablet's hip is pool-first (`gabletHips`, `p.gabletFace`) — fed from
  THAT gablet's offcuts (`homeFor`), else its own slope's, else one more of
  the gablet's short sheets when it is no longer than they are
  (`fallbackOf`, ordered only after the late match), else the slope's own
  sheet. A sheet is never flipped, so the offcut a gablet strip leaves at
  one hip fits the slope corner at the gablet's OTHER hip: the north
  slope's west corner is fed from the west gablet's south half, the plain
  hip's own pairing run the other way — never carried to the far end of
  the house. THE CORNERS ARE LAID AS COMPLEMENTS (2026-10-23, the owner:
  "all offcuts of the short sheets aren't being used so it's not as
  efficient as it can be"): the gablet's two hip halves are laid from their
  CORNERS in (a full sheet at the corner, the narrow strip against the
  gablet's wall) and the slope's corner beside it from the WALL out
  (`f.walls`, each with the side its gablet is on; a full sheet against the
  wall, the narrow strip at the corner). The two grids are each other's
  complement across the hip — a gablet sheet's offcut is exactly the
  slope's piece the same distance from the wall, because the gablet's
  sheet is the end's depth rounded up — so every hip-cut short sheet is
  used whole. Laid from the house corner, the slope's strip beside the wall
  straddled it (a 6.62 m sheet for a 3.3 m piece). The run between two
  walls starts at one and laps its closer on the other; a slope with one
  wall laps at its plain hip corner as an ordinary run does. A strip
  clipped exactly along a face's own edge picked up a zero-width spike up
  that edge (`_pzDespike` drops it). Each gablet corner on a slope is its
  OWN series in `seriesFeed` (the T's bar has one under each gablet; the
  junction strip leading the hand used to make both gablets home to both
  ends). The plain dutch is 64 (32 × 6.63 + 32 × 3.32), NOT ONE OFFCUT
  LEFT OVER — 20 m less steel than the 68 before and 80 m less than the
  72 before that. The cookie cutter applies to a gablet (the dutch L's wing gablet takes
  the north slope's 7.73 sheets slid up whole, C1–C6, feet of C7–C8), which
  needed two things: a slid-up sheet whose piece is a FULL strip of the end
  is still the rectangle's cut sheet, not a full strip of the template's
  block (it made a block of 1.66 shorts); and a RECTANGULAR offcut (hand 0,
  the 6 m left over each) fits either hand in `fitScore` — those feed the
  main's west hip end's valley side where six extras stood. The dutch L is
  81 (40 × 7.73, 20 × 3.87, 20 × 3.32, one 1.79 valley stub; a 7.73 pushed
  in at the west apex); the north slope is the wing gablet's template and
  keeps its old lay, the south slope is laid from the east gablet's wall. AND THE COOKIE CUTTER'S DEPTH TEST
  MEASURES THE HIP END, not the gablet face: a gablet is shallower by the
  gablet's height, so the dutch T's bar ends read a sheet narrower than the
  stem and were sliced from it (ten 3.32 sheets for 1.43 strips); on
  `hipApexD` the bar keeps its centre line as the hip T keeps its apex —
  87 with its gablets ordered whole (27 × 3.32, 3.23, 35 × 2.87, 8 × 1.66,
  16 × 1.44), no gablet's offcut left over; the six that are come off the
  stem's valley sheets and the junction strips. TWO FILL RULES WIDENED WITH IT, and they moved the HIP T: the push
  follows a run fed from the pool at large as well as one the series fed
  (a valley stub at the end of such a run was an extra at its own length);
  and a two-cut triangle EXACTLY half a cover wide (a stem slope's clipped
  last column, 0.82 m) is a scrap trimmed off any offcut, where `<` had
  kept it out by a hair and it was ordered as an extra sheet. That scrap
  frees the offcut that had been feeding it, so the hip T's bar end comes
  wholly off offcuts with nothing pushed: 74, not 75; the 13 m wing 72, not
  73. Every other hip shape byte-identical, dumped and diffed.
  THE GABLE + HIP & VALLEY T GIVES TWO SHEETS BACK (2026-10-23, the owner:
  "The offcuts to blue B9, B10 and purple C9, C10, they're not being
  utilized anywhere. They could be utilized in D14, D15, E15, E14"). Two
  changes, both scoped. A top end within 50 mm of square on a strip at least
  half a cover wide is cut SQUARE — the stem's top strip clipped 33 mm off
  the little hip where its ridge starts, read as cut at both ends, and no
  offcut could ever feed it. And a last pass (`swapPass`, end of
  `_sheetPuzzleFill`): a pool-first strip that fell back on its block gives
  its sheet back when a piece already fed can move onto an offcut lying
  unused and hand its own offcut over (the bar's last strip ↺C10 onto D14's
  offcut, so D15 takes C10's); slivers trimmed off the given-back sheet move
  to the snuggest offcut left. A sheet is never flipped, so B's offcut lands
  on the EAST stem slope and C's on the west. 74 → 72. GABLE ROOFS ONLY:
  the pass skips any roof with a hip end or a cookie-cutter end, because on
  the 24 × 12 L and the cross it saved a sheet each by moving pieces the
  owner had already called perfect ("that ones perfect"). Every hip and
  dutch picture is pixel-identical but the hip T's footer, whose "offcuts
  left over" reads 10, not 12 — two 33 mm nicks no longer counted. B9's and
  C9's offcuts (0.95 → 0.11 m) are still over: nothing left on that roof is
  short enough for them.
  TWO EXTRAS FROM ONE SHEET WAS TRIED AND WITHDRAWN (2026-10-23): an extra's
  sheet lengthened until its remainder, spun, fed another open piece saved
  1–2 m of steel on the gable + hip & valley Ls, but the owner: "Offcut e2
  doesn't make any sense, same with e1, e1 should just be a full sheet with a
  small amount of wasteage". A 6.71 m sheet cut into a 4.04 m strip and a
  3.36 m one is not a cut a roofer makes. Every extra is a sheet at its own
  length again; do not bring the pairing back. `rules()` lets a face with no
  gutter at all run off its ridge (the narrow arm's stub on these Ls); a
  face that has a gutter still must run off it.
  AND THE TWO VALLEY TAILS FEED EACH OTHER (the owner, the same evening, on
  report 20: "purple sheets c10,11,12,13, those off cuts should fill the area
  which has purple offcuts 12, 13 and green offcut E2. Then offcuts to green
  sheets D10,11,12,13 should fill the area of orange sheet A6 … offcuts don't
  need to start on the edge/barge as a full sheet, they can start in a valley
  area or hip area from the shortest first and only use half of the longest
  sheet if necessary" — then "they don't have to go specifically where i
  said … it should go which ever way is most efficient"). Two changes. A FACE
  WITH NO GUTTER THAT NARROWS TO A
  POINT AT A VALLEY, its barge across the wide end, is laid from the point
  (`f.tipLay` / `f.tipT`, `_pzStripsOf`): its k-th strip is the k-th
  valley-cut sheet's offcut from the valley opposite, and only the strip at
  the barge is part-width. The roof is laid BOTH ways (`opts.noTipLay`) and
  the one ordering fewer sheets kept, then less steel, the point on a tie —
  report 17's stub has no valley opposite and stays flush at its barge. And ON A
  GABLE ROOF THE LATE STEP ORDERS THE POOL-FIRST STRIPS LONGEST FIRST, ONE AT
  A TIME, RE-MATCHING AFTER EACH (`lateOk` / `lateOrder`): both sides of the
  junction are pool-first, and ordered in one pass A6 became a sheet before
  D13's 2.83 m offcut — its exact fit — existed. Hip roofs keep the single
  pass. Report 20: 48 → 47 sheets (A6 off D13's offcut); 17 and 19 are
  unchanged at 37 and 34 — their corner pieces have no offcut long enough
  and the right hand, and are honest sheets of their own. `unusedList`
  carries each offcut's hand.
  THE SHEET NUMBER IS THE BIG TEXT (2026-10-23, the owner: "can you make
  the number of sheet bigger? So, for example, A7 ... And keep the
  measurements ... small like it is"): the label is sized to the strip, up
  to 16px, shrinking only as far as it must to stay in its piece (the
  length beside it was taken off on 2026-10-27, rule 11). Every label sits at its piece's middle, so
  the numbers run in one line down a slope; one that does not fit there (a
  hip-cut triangle) slides along its strip to where it reads largest
  instead of being dropped. `docs/SHEET_LAYOUT.md` has the lay. `tests/sheetlayout.mjs` (246): plain
  hip 4 faces / 80 pieces (24+24+16+16; a full strip 6 m / cos 25° = 6.62 m)
  laid as one run from the west with the lapped corner sheet, filled as
  2 × 24 with all 32 end pieces from offcuts of the opposite slope, gable 23
  full strips and a 0.47 m closer from the barge, a change of pitch as its
  own band at the lower pitch, Big-L 6 faces / 113 laid the plain hip's way
  (both main slopes from the west along 18 m; the wing's end on the north
  slope's columns as C1–C4 whole and ✂C5–✂C8 feet, each foot tiling with
  its sheet's valley cut edge for edge; the west and east ends' exact
  label sequences; the wing's slope 8 with its valley from its own
  offcuts; 48 × 7.73 + 15 × 3.32 + one 3.52 extra), the T keeping its
  apex-laid bar ends at 74, the dutch, the dutch L and the dutch T as
  above (the exact label sequences of each gablet, B1 → ↺B1 on its own
  side), every fed piece
  the hand of its offcut (a foot is not spun), the hand-counted fixtures
  covered exactly once, five roofs in one frame. `tools/sheet-shots.mjs` is still the way to LOOK before the gate.
  THE BIGGER BLOCK IS THE RECTANGLE (feedback report 70, 2026-10-27, the
  owner: "use the plain hip logic first, then slice the sheets ... like a
  cookie cutter ... there should be 30 sheets (same as the green southside)
  then that whole north triangle should be cut from the purple sheets"). The
  cookie cutter used to need a hip end "at least a sheet narrower each side"
  of the slope, and wholly in front of its gutter line — report 70's 10 m wing
  stands only 4.17 m out from a 22.78 × 11.39 main, its end 5.00 m deep beside
  a 5.69 m slope, its apex past the gutter line, so it kept its own apex with
  four extras ordered for it. Now an end is cut from a slope when its GUTTER is
  in front of the slope's, its depth fits the slope's sheets, and its own block
  (`_pzBlockArea`: the outline's run inward through the end's middle × its
  gutter) is SMALLER than the slope's rectangle (span × depth through the
  slope's middle). The T keeps its apex ends because the bar is the bigger
  block, not because it is "within a sheet"; a 13 m wing on 18 × 14 keeps its
  apex because its block (13 × 20) is the bigger. Report 70: north slope 30
  sheets, the wing's triangle C1–C7 whole + ✂C8–✂C13 feet, 75 → 74 sheets.
  `fixtures-report70.json`; 3 pins in `sheetlayout.mjs` fail on the old engine.
  AND A WING IN FRONT OF THE MAIN'S HIP END (feedback reports 71–76,
  2026-10-27: "make sure the same logic carries through on these attached
  roofs too"). 72 and 73 already did (a wing before the main's SLOPE). In
  71, 74, 75 and 76 the wing's end faces the same way as the main's own hip
  END: the main's end is the template now (`apexOf`, `adoptOn`,
  `f.adoptedBy`; its apex cells carry `k` from `anchorT`), each column's
  wing piece and the main end's leftover (valley to hip) are one end strip
  — square at the main's gutter, cut once at its hip, `sheetOneCut` with its
  own hand — fed from one offcut as the plain hip's end strip is, the foot
  carried. Against a hip end THE LONGEST SHEETS decide the rectangle, not
  the area (75/76: the wing is the longer block but 13.5 m sheets beside
  15.3 m). AND THE MAIN'S SLOPE KEEPS ITS SHEET COUNT (report 76, the
  owner: "the plain hip logic would mean there should be the same number of
  purple sheets as there is orange sheets ... the missing purple sheets
  should go where green sheets d40 ... d56 are"): on the slope the main and
  the wing share, the strips cut by the hip at the wing's FAR end (a hip
  bounding an end adopted onto a hip-end template, `adoptedHips`) join the
  face's LONGEST run — the main's sheets at the main's length, whose
  offcuts are the plain hip's own for that end. AND A HIP-CAP CORNER
  (`_PZ_HIP_CAP_MM` = 100, the same message: "c31 should be a green
  sheet"): a strip a hip crosses only at one corner, where the hip runs down
  onto a lower ridge (82 mm on 76), is the LOWER block's sheet
  (`p.capMm` keeps the block at its own length). The roof is still laid
  BOTH ways (`opts.noApexTmpl`), fewer sheets then less steel kept. 71: 74 →
  70 (paired now: the rows its wing's far hip cuts are the main's 8.50s),
  74: 137 → 125, 75: 142 → 130, 76: 183 → 177 (48 orange, 48 purple; 176 since rule 8b),
  and REPORT 50 (hand-counted) 41 → 38: the bottom slope carries the strips
  its wings' far hips cut at 2.82, three short extras gone. Every other
  fixture's tally is byte-identical (diffed against the previous commit).
  Fixtures 71–76; `sheetlayout.mjs` 369.
  THE T GABLE (a plain gable on a T outline) draws oddly because the gable
  BUILDER's lines are odd there — not the puzzle's fault; not pinned.
- SUPERSEDED 2026-10-31 BY RULE 11c (the sheet layout is page 2 now, the
  pre-cut layout page 3, a wide roof turned) — kept for the v8 migration's sake.
  THE JOB PACK'S PAGE 1 CARRIED THE SHEET LAYOUT (2026-10-27, the owner: "add
  the sheet layout diagram to the job pack by default, always fit to size so
  both pictures can fit inside the screen ... for the display maps, have them
  all default clicked ... detailed map at the top, then sheet layout below,
  then flashing ref below, then basic map below that"). `_jpDefaultPages` is
  header (Detailed map + Sheet layout, ids `def_dt_` / `def_sl_`) and cut
  lists; the v8 migration adds the Sheet layout under an untouched default
  Detailed map. `_jpFitDefaults` stacks every untouched default picture on a
  page at one common width, each at its own shape, the stack as big as the
  space under the header allows; a moved or resized picture (`userSized`) is
  the office's. `JP_MAP_KINDS_ALL` is in the owner's order, all ticked, the
  ticks stored under `JP_MAP_KIND_KEY` (`fr_jp_map_kind2_`) so a device's old
  ticks do not stand. `tests/quickwins.mjs`, `jpmaps.mjs`, `jpallroofs.mjs`.
- THE ROOF COLOUR SECTION DELETES LIKE THE OTHERS (2026-10-27, "in the roofing
  quote, allow me to delete the roof colour section"): `_qbColour` carries
  Delete this page (office only), `_qbSectionRemove('colour')` parks it and
  `_qbPicksAuto` already drops its pick. `tests/quoteeditor.mjs`.
- A PRICE-BOOK MATERIAL IS A MATERIAL (2026-10-27, Scott at
  info@wellingtonroof.co.nz, now a paying customer: "Include Address in CSV
  export. For custom pricing suggest adding a tag if the item is a Materials
  item. Then when the item is selected for a job or roof it can be listed and
  directly included in the Materials list and total for Materials at Cost.
  All other Custom Price Book items included in a job can then be listed with
  separate total as … 3. Other lines on the quote"). He had found a real
  contradiction: "📖 Add from price book" made a CUSTOM LINE at the item's
  SELL price, outside the buffer and mark-up; the CSV printed it under Roof
  materials while the profitability list counted it under "Other lines on the
  quote · at cost" — so the item's own mark-up read as zero margin.
  A Custom Price Book item has `kind` 'material' | 'other' (`_cpbKind`; NO
  KIND = MATERIAL, the owner's call — a supplier list is almost all
  materials), a Type select on Settings → Custom Price Book and a chip in the
  price-book window. `_pbkAddToJob`: a MATERIAL goes to `S.quote.cpbMat[key]`
  (`_cpbMatAdd`; keyed like customLines, 'material' / 'material#<idx>';
  {id, cpbId, code, desc, unit, supplier, qty, cost}, the cost frozen at add)
  whichever card's button was pressed, and `_cpbMatRows` makes each a row of
  `_buildMaterialPriceRows` (`cpb:<id>`, priced at COST, `decimalQty`) — so the
  qty/$ boxes, the buffer and the JOB's mark-up (the item's own mark-up is NOT
  used, the owner's answer), S.materials, the profitability, the CSV's
  Materials at cost and the Fergus push all take it for nothing; its ✕ removes
  the entry (`_cpbMatRemove`), it follows `_qCustomRemap` / `_qCustomFoldInto`,
  and a shed keeps the old custom line. An OTHER item stays a custom line at
  its price; `_qCustomLineCost(row)` reads its real cost off the book by
  `cpbId`, so "Other lines on the quote" carries price-book items at cost and
  their mark-up shows as margin (hand-typed lines stay at cost). `cpbMat` is in
  the server's CUSTOMER_HIDDEN_FIELDS — it carries supplier cost.
  THE CSV (`_scopePricingRows`): Site address under Client; on the main roof's
  and the Quote Total sheet the lines typed on the scaffold / labour /
  material cards leave those sections for an "Other lines on the quote" block
  (each at charge and cost, then Total other lines — the panel's own item to
  the cent); an extra roof's sheet keeps them in its cards (it is priced as a
  lump). Lines already on jobs did not move. `tests/pricebookpick.mjs`,
  `custompb.mjs`, `profititems.mjs`.
- The Job Pack cut list belongs to the office once touched. The first
  edit (quantity, length, hide, add row) freezes it in
  `DRAW.matSheetFrozen`; it is rebuilt only when the roof's groups change,
  carrying the edits onto the nearest new rows, and "Reset from map" throws
  the freeze away. Never re-derive a row the office has typed on.
  A MULTI-ROOF job pack lists sheets one roof at a time ("Main Roof
  sheets", "Roof 2 sheets"; report 54) and each roof keeps its own freeze,
  overrides, hidden rows and extras under `DRAW.matSheetByRoof[idx]`;
  `_jpSheetScope(idx, fn)` swaps a roof's set into the job-level slots the
  row builder and setters read, so every onclick on a roof's section goes
  through `_jpSheetScoped(idx, 'fnName', …)`. `_jpSheetRowsAll()` is what
  the order email and the supplier order read. All of these stores (and
  `S.jobPack`) are saved with the job since 2026-09-18 — before that a
  reload dropped every typed quantity.
- Which roofs a job pack covers is saved on the job (`S.jobPack.roofSel`)
  and, until the office picks by hand, FOLLOWS THE QUOTE: the main roof,
  roofs folded into its price, and an optional roof once the customer adds
  it (`_jpQuotedRoofIndices`). The map pictures, the clearlite, the sheets
  and every quantity follow that pick; a pricing pass that needs one roof's
  group uses `_matSelOverride()`, never the saved pick. Tests that read the
  whole job's list call `_jpSelectAllRoofs()` first.
- The customer's quote on a PHONE (a MODERN quote; see the style bullet)
  is a book, not the A4 pages reflowed:
  `_qbRender()` into `#qpRoot` behind `html.qp-book`, one page on screen with
  arrows to turn it, driven by `_qbPages()` (cover, condition, Re-Roof
  Proposal, then a page per choice, then the total). It is phone width AND
  customer mode AND not printing — `_qpBookActive()`. A wider customer
  screen gets the one-page computer layout (next bullet); the office's
  Document view, every print and the PDF are the A4 document, untouched. The
  book reads the SAME helpers as the paper (`_qpBaseSub`, `_qpCardDeltas`,
  `_custBarRows`, `_qpInteractiveRoofBlock`), so the two cannot disagree about
  a figure; never give the book pricing of its own. A page that does not apply
  is simply not in the list (no gutter → no brackets page; Zincalume → no
  colour page) and the numbering closes up. The price appears on the Re-Roof
  Proposal page and not before it. `_fitCustomerView` settles the `qp-book`
  class BEFORE its printing guard, or a Save-as-PDF prints the A4 document
  with the phone's layout rules still applied. `tests/quotebook.mjs`.
  The office can LOOK at that book without sending anything: the Quote tab's
  Document / Computer / Phone switch (`_setQuotePreviewMode`,
  `QP_PREVIEW.phone`) frames the same book as a phone inside the preview card under
  `html.qp-phone-preview`. That class is deliberately NOT `qp-book` — the
  customer's layer takes the page's scrolling away and the app around the
  frame has to keep working. Both print paths drop the frame and re-render
  before capturing, because a print is always the A4 document. The book's
  cover photo resolves through the SAME chain as the paper's (slot
  assignment → the company's `branding.hero_photo` → the built-in fleet
  shot), never a job photo. `tests/quotepreview.mjs`.
  The two roof profiles are DRAWN from the Roofing Industries profile sheets
  in real millimetres (`_qbCorrugateGeometry` 76.2mm pitch / 19mm high / 762
  cover; `_qbRibGeometry` TrimRib S, 190mm rib pitch / 25mm high / 63mm rib
  base / 32mm top / 127mm pan with a 45×5mm stiffener / 760 cover), at ONE
  scale across both so a customer comparing them sees that a 5-Rib really is
  the deeper sheet. Change the numbers only against those sheets.
  The LAST page draws the roofs the quote covers read-only
  (`_qpInteractiveRoofBlock({readOnly:true})`, which drops the include/exclude
  buttons and the "tap to add" labels in the map itself) — the choosing was
  done on page three and re-offering it under the Accept button invites a
  change nobody meant. Accept on a phone does NOT open the confirmation
  popup: the name and the terms tick are on the page (`#qbAcceptName`,
  `#qbAcceptTerms`) and `acceptQuoteDigitally` validates them and goes
  straight to `_acceptQuoteFinalize`. The computer layout asks inline the
  same way; only the A4 document (the office's Document view) still opens
  the popup, because it has no inline name field and the record needs one.
  No path can record an acceptance without a name and a tick. On the book the
  roofer's quoted choice on each option page carries a "Recommended for your
  roof" pill (the `isDefault` item); the arrows read Back / Next; and after
  acceptance the LAST PAGE LEADS with `_qbAcceptedBlock` ("Quote accepted",
  who and when, what happens next, Save a copy as PDF) — no popup on the book,
  because the page is the confirmation. The office gets the acceptance email;
  since 2026-10-02 the customer gets a confirmation too (server-side, see
  Settings → Email) unless the office switched it off — the page cannot know
  which, so the block still never promises one. It carries "Need a
  last-minute change? Please ring … on <phone>" instead.
- The customer on a COMPUTER (or tablet, anything wider than 720px) gets
  the same quote as ONE PAGE (on a MODERN quote; see the style bullet): `_qdRender()` into `#qpRoot` under
  `html.qp-desk` when `_qpDeskActive()` (customer mode, not phone width,
  not printing). It is built from the book's own renderers (`_qbGrade`,
  `_qbColour`, `_qbSummary`…) wrapped in sections — grade, profile and
  thickness share one Roofing section, the gutter kit sits beside the
  gutter — with a sticky summary rail (`_qdRail`: `_custBarRows()`, the
  total incl. GST, `_qbPicksList()`, Review) and a section nav with a
  scroll-spy (`_qdSpyTick`). The A4 is what a print or PDF captures:
  `_buildQuotePdf` raises `__PRINTING_QUOTE` BEFORE its first render (the
  phone's acceptance PDF used to capture the book's page) and, in customer
  mode, drops an opaque veil (`#qpPdfVeil`, "Recording your acceptance…")
  over the page while the A4 is on it — the owner saw "the old quote style
  for a few seconds" on accept; `_pdfDone` lifts it on every exit. The old customer
  `#custBar` and its side panel are hidden under `qp-desk`; the rail is the
  panel. A pick re-renders through `refreshQuoteProposal`, so the hook
  saves and restores the scroller's position (`_qdScrollSave`) — for the
  book too (the page's own scroller, `_qbScrollEl`); the save must happen
  BEFORE the A4 render wipes the layer, which is why it lives in the hook
  and not in `_qbRender`. A tap used to throw a phone back to the top. Accept is
  inline like the phone (`#qbAcceptName`/`#qbAcceptTerms`, no popup). The
  office's View switch is three-way — Document (A4, the editing surface),
  Computer (`QP_PREVIEW.desk`, `html.qp-desk-preview`), Phone — and
  `'desktop'` still means Document. `tests/quotedesk.mjs`.
- On the computer layout STEEL GRADE, PROFILE and THICKNESS are each a
  full-width section of their own (`grade`, `profile`, `thickness` in
  `_qdSections`, rows like the guttering's) since 2026-09-20 — the owner
  found the three-column "Roofing" grid confusing. `_qdRoofing` is gone.
- THE PLATFORM SCAFFOLD UPLIFT (25% of the scaffold when a gutter is
  added) rides ON THE GUTTER'S CARD (`_qpCardDeltas().gutter[id]` includes
  it; `.gutterUp[id]` is the amount, `_qbGutterUpNote` says so under the
  card) as well as being its own summary row, so card and summary agree.
  It is nothing when the scaffold is already a platform OR the office
  ticks "Upgrade to platform scaffolding isn't required for the gutter
  install" (`S.quote.gutterNoPlatform`, one flag; the tick is rendered by
  `_gutterNoPlatformTickHtml(where)` on the quote's gutter section (office
  only), the Pricing tab's scaffold tile and its gutter panel;
  `_setGutterNoPlatform` re-renders all three). Every uplift reads
  `_selScaffoldBasePrice()`, which answers 0 in both cases.
  `tests/platformscaff.mjs`.
- THE OFFICE READS LIVE PRICES. `_qpPriced()` hands back the frozen
  `share.priced` block only in customer mode or on an ACCEPTED quote; the
  office editing a draft after a send sees live figures (a scaffold
  switched to platform used to leave the old uplift on the office's own
  preview). `tests/pricegold.mjs` plays the customer with
  `window.__CUSTOMER_MODE = true`; its baseline is regenerated with
  `REGEN=1` and the diff must be only prices that meant to move.
- A SENT (or accepted) quote can be INSPECTED in full: opening the Pricing
  drawer (`_togglePricingPanel` and friends in `_LOCK_OK_CALLS`) asks
  nothing; the "This is the sent quote" question comes at the first real
  change. `tests/quoteversions.mjs`.
- THE QUOTE'S STYLE (report 56): `S.quote.style` is `'classic'` or
  `'modern'`, saved with the quote and sent to the customer; a quote with
  none takes `settings.quote_defaults.style`, then the test seam
  `window.__DEFAULT_QUOTE_STYLE` (the document-centred office suites set
  it to `'classic'` in their init script), then modern. The Quote tab is a
  flex column ordered by CSS (`#tab-quote > …{order}`): the rail wrapper
  `.qe-wrap` carries the proposal card's order or the action bar lands
  under the preview.
  Classic is the document — the A4 on a computer, the same A4 reflowed on
  a phone (`customer-mobile`), edited by clicking the page. Modern is the
  one-page layout and the book. `_qpBookActive`/`_qpDeskActive` return
  false on a classic quote. The Quote tab's View switch is Computer / Phone
  ONLY (no Document view; `'doc'`/`'desktop'` still map to Computer) plus a
  Style switch. THE TEMPLATE PICKER is a big "Select from saved
  templates" menu at the top of the tab (`#qaTplMenu`, `_qaTplMenuRender`:
  Default quote, every saved template, Edit quote template); applying one
  stamps `S.quote.templateId/templateName` and the Viewing button reads
  "Draft · Short quote". "Edit quote template" is its own header button
  (the header buttons are 13.5px since 2026-09-22). The Job type choice
  (Roofing / Pole Shed) lives in the More menu, which is hidden where pole
  sheds are not sold (`#qaMore`, `#qkDraftToggle`, `_qkMenuRender`;
  `tests/poleshed.mjs`, `tests/quotetpl.mjs`).
  THE TEMPLATE EDITOR (`_qtOpen`, `_QT.open`) edits whichever layout the
  quote is in: a classic quote its A4 pages (`q.pages`/`q.parked`), a
  modern quote the SECTIONS of its one-page layout (`_qtRenderRailModern`:
  drag or the arrows to reorder, ✕ to take out, ↩ to put back; cover,
  proposal and the total are fixed; the roof condition is the A4's page so
  taking it out is `toggleProposalSection('condition')`). The arrangement
  is `S.quote.modernOrder` / `S.quote.modernParked`, applied to
  `_qdSections` AND `_qbPages` by `_qModernApply` so the computer and the
  phone agree; a template snapshot carries them and the quote's `style`.
  In the editor `_qpDeskActive` is true for a modern quote and the stage
  gives `#qpRoot` a 1180px working width (`#qtEditWrap.qt-modern`); the
  book is never shown there. `tests/quotetpl.mjs`, `tests/quoteeditor.mjs`.
  The preview's classes are DERIVED from mode + style + the
  printing flag by `_qpPreviewClassesSync()` (`qp-desk-preview`,
  `qp-phone-preview`, `qp-classic-phone` = the reflow inside the phone
  frame) — never toggle them by hand; `printQuote` and both PDF paths raise
  `__PRINTING_QUOTE` and call it, so paper is always the A4. The EDITOR
  RAIL down the left of the preview (`#qeRail`, above the preview on a
  phone) carries "Edit description" (`_qdescOpen`, which edits the modern
  `custDesc` lines or the classic `scope` bullets by style) and "Edit this
  quote's selections" (`_qselOpen`); each lights the part of the page it
  edits (`_qeSpot`: the one-page block, the book turned to that page, or
  the A4's `[data-qe="desc"]`). SINCE 2026-09-20 THE RAIL IS GONE: the
  buttons sit ON the preview beside what they edit (`_qeInlineBtn(what)`,
  office only — empty in customer mode and while printing): "Edit
  description" under the Re-Roof Proposal heading, "Edit this quote's
  selections" on the roofing section / the book's grade page / the A4's
  selections page, "Edit gutter selections" on the guttering
  (`_qselOpen('gutter')` = the same window filtered to gutters, brackets
  and downpipes), "Edit roof condition" on the condition section
  (`_qeOpenCondition` opens the Quote tab's card). `_qpOptPageWrap` is
  where the book's pages get theirs. SINCE 2026-09-21 (evening) those
  in-page buttons are the ANCHORS of an EDIT RAIL on a wide office screen
  (`_qeRailSync`, `html.qe-rail-on` from 1280px): the preview gets a
  186px left gutter, each button is redrawn in `#qeRail` level with its
  anchor and pulled in close beside the block, a 👉 emoji hand between
  them (`.qe-rail-btn`, `.qe-rail-line`; the hand stops short of the
  block's card, which paints over the rail),
  the in-page button is made invisible and taken out of the flow, and the
  rail re-lays after every render, resize and scroll inside the preview.
  Narrower screens keep the buttons on the page. Per-quote hides live in `S.quote.selHide
  [kind][id]` and are honoured by `_selGrades/_selProfiles/_selGutters`
  (via `_selLive(list, kind)`), `_selFixed` and `_selExtras`
  (`_selExtrasOffered` is the list before hides); the base grade, the
  first profile, each fixed group's first row and whatever is picked can
  never be hidden. "Edit default selections" jumps to Settings → Quote's
  Product Options. On the modern previews the office can also click the
  cover title and the condition summary (`_qeBindModernEdits`).
  `tests/quoteeditor.mjs`; `tests/quotepreview.mjs` for the switches.
- THE RECOMMENDED CHOICE on the customer's quote is whatever the roofer had
  picked in the app when it was sent: `S.quote.recommended` is stamped from
  `proposalOptions` at every send (`_qbRecSnapshot`, beside
  `share.priced`), the customer's renderers mark that row `isDefault`
  through `_qbRecPick`/`_qbRecMark`, and in the office the LIVE pick is the
  recommendation so the Phone / Computer previews show what would go out. A
  quote sent before the stamp falls back to the priced base. Recommended is
  a badge, not a price — a recommended gutter still shows what it adds;
  "Included" only ever means it costs nothing more. The Re-Roof Proposal
  page has no price box of its own; the bar under the book carries it.
- On the book the colour page LEADS with "Undecided — I'll choose later"
  (`QB_COLOUR_UNDECIDED`, saved as the colour `'Undecided'`, read back as
  "Undecided — to be confirmed" in the picks): a customer who cannot pick
  a colour tonight must still be able to accept tonight. From the proposal
  page on, a green "Ask a question?" sits top right (`.qb-ask`,
  `customerQuery`); `_qbPriceFrom(pages)` is the proposal's real index, not
  2 — it moves when there is no condition page. A page taller than the
  screen shows a "Scroll" pill at the right until the bottom is reached
  (`_qbScrollHintSync` on the page's scroller, `_qbScrollEl`). The
  proposal's lines are tightened (`.qb-split .qb-incl-row`) so page 3 fits
  a phone without scrolling, and it carries no GST note.
- ACCREDITATION LOGOS (2026-10-07, the owner's RANZ / Sitewise Gold / LBP):
  `branding.accred_logos` = up to four `{src, alt}`, COMPANY-WIDE like the
  cover hero and for the same reason — a roofer's RANZ membership is the same
  on every quote they will ever send, so nothing is per-quote and nothing new
  rides in versions, templates or the frozen customer copy. `_accredStripHtml
  (where, plain)` draws them over the hero on the cover (`qb-accred-cover`,
  TOP LEFT and small, no chip behind them — the owner, 2026-10-07: the chip
  was a white box around artwork that already comes on a white ground, and
  the hero's own tools are top right, its title bottom left) and as a centred
  row on the last page (`qb-accred-foot`), in `_qbCover`, `_qdCover` and
  `_qbSummary` — so the book, the one-page layout and the computer's Review
  all carry them. NOTHING IS SHOWN WHEN NONE ARE SET: the customer never sees
  an empty slot where a credential would go. The office gets a ✕ per logo and
  ONE "+ Logo" at a time (four dashed holes on a photograph is a form, not a
  quote); Settings → Branding (`#brAccredSlots`, `_accredSettingsRender`)
  shows the same store filled out to four, and either place writes the other.
  `_accredShrink` keeps a logo as PNG — the JPEG shrinker fills a transparent
  background with black — and files under 180 KB (an SVG among them) are kept
  exactly as they came in. The A4's cover `trustLogosHtml` prefers the
  company's own, and the line of words under it ("Member of Roofing
  Association NZ · Licensed Building Practitioner · Site Safe · Sitewise Gold
  · Colorsteel Authorised") now follows them — it was printed on EVERY
  company's cover, gated on nothing, asserting credentials they may not hold,
  while the logos above it were gated to the account that supplied them.
  `tests/accredlogos.mjs`.
- The cover's facts (phone and computer) are ONE list, `_qbCoverMeta()`:
  Quote, Date, Expires (`_qbExpiryText`: the date plus the validity's days,
  or the validity verbatim when it is already a date), Prepared by
  (`branding.prepared_by_name` from Settings → Branding, else the quote's
  `preparedByName`), Phone, Email. No roof area, no pitch, no "Prepared
  for … by …" line — the owner took them off.
- The customer's DESCRIPTION of the work is `CUST_DESC_DEFAULT` (six lines,
  `{grade}` filled from the chosen steel grade by `_qbInclusionLines`),
  shown on the Re-Roof Proposal of the phone and the computer. The office
  rewrites it per quote with "Edit description" (`_qdescOpen`), saved as
  `S.quote.custDesc`; saving the default DELETES the field so a later
  default change reaches quotes nobody customised. The A4 keeps its own
  long inclusions list.
- THE MODERN QUOTE'S CONDITION SECTION sits straight after the cover,
  AHEAD of the Re-Roof Proposal since 2026-09-23 (`_qdSections`/`_qbPages`:
  cover, condition, proposal, grade …; `_qModernApply` moves it there
  whatever order a quote or template saved), so no price shows on it. The
  office sees it whenever the page is in the quote (`_qbCondSectionOn`),
  with the three fixing buttons (Lead-head Nails / Twist Shank Nails / Tek
  Screws → `_setCondFixingType`, which now writes `conditionSummary` too
  and syncs the Quote tab's inputs via `_condSyncInputs` so a later
  `readQuoteFromInputs` cannot clobber it), "Edit wording" (the presets,
  `_condPresetsOpen` → `settings.quote_defaults.condition_presets`, read
  by `_condFixingDesc`), four photo SLOTS (the A4's `_qpCondPhotoSlotHtml`)
  and "Delete this page from this quote" (`_qbCondRemovePage` =
  `toggleProposalSection('condition')`; the card's tick puts it back). The
  customer only gets it when there is something on it (`_qbHasCondition`),
  as a gallery. The price shows on it because it follows the proposal.
- THE PARAGRAPH IS THE TEXT BOX (2026-10-13, the owner on the condition
  summary: "the edit text box is tiny and hard to edit, don't pop-up a window,
  just let me edit the text, so that whole area is like a text box i can
  edit"). `_qeBindModernEdits` opened `_styledPrompt` with a single-line
  `<input>` — and the `multi` argument that function had always taken was
  accepted and NEVER USED, so a five-line paragraph about a roof's condition
  was edited through a box one line tall, scrolling sideways. The bound block
  is `contenteditable` now (`plaintext-only` where the browser has it, so
  pasted markup cannot get into a field stored as a plain string), marked
  `.qe-edit`, which draws the box only on hover and while editing — office
  only, since `_qeBindModernEdits` never runs in customer mode, and neutered
  in both print layers. The cover title goes the same way.
  SAVED ON THE WAY OUT, never per keystroke: `refreshQuoteProposal()` rebuilds
  `#qpRoot`, so committing on every letter would tear the element out from
  under the caret. Blur commits (`_qeCommitInline`), Esc restores what was
  there, Enter commits (the field is one string and the renderer a single
  `<p>`, so a line break has nowhere to go) and Shift+Enter is left alone. The
  Quote tab's own `#qdCondSummary` is kept in step, and an emptied field
  deletes the key so the grey placeholder comes back. THE JOB LOCK NEEDED
  NOTHING: the document's `beforeinput` guard fires for a contenteditable
  exactly as for an input, so a sent quote still asks before the first letter
  lands. `tests/quoteeditor.mjs`.
- A CUSTOM LINE MOVES THE FIGURES UNDER IT (2026-10-13, the owner: "a custom
  line in the gutter section in the material doesn't actually add to the cost,
  it does nothing to the cost of the gutter, make sure anywhere that allows a
  custom line actually adds and effects the cost"). `_qUpdCustom` always calls
  `_qCustomChanged(area, true)` — keepFocus, so the card is deliberately NOT
  re-rendered while they type, or the input would be torn out from under the
  caret. The row's own total was patched in place (`data-cl-total`) and the
  quote's total recomputed, but the only card that got a live figure of its
  own was MATERIAL (`#matTotalShown`). On the GUTTER card the Material
  subtotal, the buffer, the mark-up, the Material line and the card's bottom
  line all sat at whatever the last full render computed — so a $1,499.82 line
  showed $1,499.82 on its own row and changed nothing beneath it. Labour and
  scaffolding were the same. The stored figure was right all along, which is
  why the quote's total did move; but a number that sits still while you type
  it is indistinguishable from one that is being ignored, and nobody should
  have to take it on trust. `_qCustomLiveRerender(baseArea)` now re-renders
  the owning card (`_qCustomRenderArea`: labour/scaffold → `calcLabour`,
  material → `renderMaterialPriceTable`, gutter →
  `renderGutterDownpipePricing`) 280 ms after the LAST keystroke and puts the
  focus and the caret back — found by `data-cl-qty` / `data-cl-unit` /
  `data-cl-desc` (the description box grew one so it can be found too).
  Debounced rather than per-keystroke because the material table is long and
  redrawing it on every letter is what the keepFocus path existed to avoid;
  `setSelectionRange` is tried inside its own `try` because a number input
  refuses it in some browsers, and a refusal costs the caret position and
  nothing more. `tests/gutterprice.mjs` types a real line and reads the card
  before and after the beat — and the pin only passes with the Pricing drawer
  actually open, because `focus()` on a card that is not rendered does nothing.
- The EXISTING ROOF CONDITION card is on the Quote tab again (2026-09-20;
  `#qCondCard`, it was `display:none` for a while) with a tick
  (`#qCondInclude`, `_qCondIncludeToggle`) that is the same page move as
  the Proposal sections card and the page editor (`toggleProposalSection
  ('condition')`), read back from the page list by `_qCondIncludeSync`,
  never a flag of its own. Its Summary field is `conditionSummary`, the
  paragraph the phone and the computer show. `_qbHasCondition()` answers
  false when the page is out of the document, so the tick reaches the
  modern layouts as well as the A4. `tests/quoteeditor.mjs`.
- STEP-DOWN GABLE (`stepgable`, 2026-09-21): the owner's L — a main
  gable and a lower wing, each its own gable at its own height, ridges the
  same way, no hip or valley. `buildStepGableRoofLines(outline, flip)`
  cuts the outline into rectangles by lines through its reflex corners
  ACROSS the ridge direction (an L → two blocks, a T → three), gives each
  block a ridge down its middle, gutters along the ridge and rake barges
  across it; where blocks meet, the WIDER block keeps its barge (the gable
  wall) and the narrower gets an `apron`. Ridge direction is
  `DRAW.roofBaseHoriz`, flipped by Rotate roof 90°, like the straight
  gable (it is in the "don't rotate the lines" set in `autoGenerateRoof`
  and the regen switch). The sheet engine reads it as `gable`
  (`_rspRoofType`) — one column per ridge. Grabbing a ridge must not
  re-label it `gable`. `tests/stepgable.mjs`.
- BREAK UP RIDGE (2026-09-24, generated straight gables only): the
  ridge's popup offers "✂ Break up ridge" (`_ridgeBreakBoxRender`,
  `_ridgeBreakAdd`); `DRAW.ridgeBreaks = [{a, b, off}]` per roof
  (ROOF_FIELDS, saved in the draw block) — where the section starts/ends
  along the ridge (fractions of the roof's length that way) and how far it
  moved (signed fraction of the half-bay from the ridge, so it follows a
  ridge slide). `buildGableRoofLines` → `_gblPushRidge` draws: ridge pieces,
  the moved section as a HEAD APRON (`breakRole:'mid'`), and at each end a
  barge AND a side apron (`breakRole:'conn'`, `slopeRun` → measured up the
  slope via `_lineSlopeType`); pieces share `ridgeChain`, and
  `_carryLineFlags` keeps these flags through every regen copy. The sheet
  engine (`_enumSimpleGableMono`) counts a chain's pieces with break points
  as fixed region boundaries and each SIDE as one face (one round-up); the
  canvas labels the section both sides (no rake-barge substitution for it).
  Drag the section across the roof or its ends along the ridge
  (`DRAG_RBREAK`, claimed before the ridge slide); Moved/Length in metres;
  Remove break. Each change takes ONE snapshot before it changes, then the
  light `regenerateAutoRoofLines('gable')`. Picking the shape, rotating or
  changing type clears the breaks; a ridge slide or corner drag keeps them.
  `tests/ridgebreak.mjs`.
- REPORT 58 (2026-09-25, `tests/report58.mjs`, `fixtures-report58.json`):
  `_sgmSplit` splits a face at a STEP (a jump over 0.05 cover between
  neighbouring samples) as well as on the old 0.9-cover drift, so sheets
  over a jog in the gutter reach it; `_sgmUncoveredGutters` sheets the
  stretches of a ridge-direction gutter no ridge spans (a block beside the
  ridge's end) from the gutter to the far edge, never twice; the gable
  builder makes a ridge-direction edge with the ridge OUTSIDE it a HEAD
  BARGE (measured level, `_lineSlopeType`); `_bargeLenForRun` only borrows a
  barge that starts at the ridge; gable sections carry `roofLines`, drawn
  over the columns on the Sheet calc check in the map's colours; the map's
  sheet measures have ONE arrow, pointing downhill at the gutter
  (`hit.downhill`); a broken ridge's section and ends show resize cursors;
  `_roofGeometryPayload` carries roofType/rotation/ridgeBreaks and line flags.
- UNDO CARRIES EVERY ROOF: `_captureSnapState` syncs the active roof and
  stores `roofs` + `activeRoofIdx`; `_applySnapState` restores them and
  the active roof's scalars, then re-renders the roof bar. Before this a
  snapshot held only the active roof's arrays, so undoing past a second
  outline left the earlier roof's lines drawn twice on site (the owner's
  "undo makes multiple lines"). Older snapshots without `roofs` still load.
- SITE MODE always has the roof-shape sheet or its handle: `_applyTabletMode`
  folds the panel into the handle (`rtp-collapsed`) when the panel is
  hidden, and `_phoneRoofSheet(true)` SHOWS the panel (type, Rotate, roof
  switch) — the handle used to only remove the class. The bottom bar's
  Flashings button is now Markup (`#ttbMarkup`, `_siteNotesToggle`, icon
  `--ico-markup`, a pencil over a squiggle; lit for the notes tools);
  flashings stay in the Lines menu (`#btn-siteflash`). `tests/sitebars.mjs`.
- THE ROOF PLAN on the office's Computer and Phone previews carries the
  three-way control per roof — Part of main (compulsory), Separate extra
  (the customer's option), Exclude (drawn crossed out, never offered) —
  the A4 always had (`_roofModeRowsHtml`, shared by `_qpInteractiveRoofBlock`
  and `_buildRoofPreviewsHtml`; `_setRoofMode`; classes `.rm-*`, buttons at
  least 12px with 6/12 padding — `tests/roofrename.mjs` pins the size).
  Never for the customer, never on paper. Rename · Delete under an Include
  button is one line of text links (`_roofRenameLinkHtml(idx, {inline:true})`).
  EVERY MAP FRAME KEEPS ITS OWN VIEW: `roofMapView` (the A4), `roofMapViewAccept`,
  and `roofMapViews[key]` for the rest (`desk`, `desksum`, `book`, `booksum`);
  a frame without one starts from the A4's. Before 2026-09-22 every key but
  `accept` collapsed to `main`, so zooming the proposal's plan zoomed the
  review's. `tests/quoteeditor.mjs`.
- THE PRICING DRAWER (`#tab-scope`, slid out on the Quote tab) OVERLAYS
  the quote since 2026-09-21: `_openPricingPanel` keeps `--pop-reserve` at
  the toggle strip instead of reserving the drawer's width, so opening it
  no longer shoves the Quote tab left and re-flows the preview. The
  Fergus and Job Pack map pop-outs still reserve. It is quiet
  since 2026-09-21: plain white cards, one small uppercase heading each on the
  quote page's navy band (white text, so a heading never reads as content), no
  emoji, no coloured bands (the owner called them childish). Every heading
  carries its FIGURE at the right (`_pxHeadTotals`, refreshed by
  `renderProfitability`, which every recalc reaches: scaffold price, roof
  labour + material, gutter total or "Excluded"/"not on the quote", GP %)
  and a chevron: a click on the heading folds the section (`_pxToggle`,
  remembered per section in `localStorage.fr_pricingFold`, applied by
  `_openPricingPanel`); a folded section still prints in full
  (`html.print-scope` rule). The card ids (`scaffoldCard`,
  `roofPriceTile`, `gutterDownpipeCard`, `profitCard`) are what the
  walkthrough and the suites point at — keep them.
- JOB PROFITABILITY (Pricing tab) lists what the job is made of and its
  tiles add that list up: `_profitFigures(view).items` — 1. Scaffolding,
  2. Roofing (labour + materials), then the quote's selections from
  `_profitSelectionItems()` (the same rows as `_qpSelectionChanges`, on
  the Total and the main roof's view only): a gutter carries its own
  hours at the labour table's cost rates plus its itemised material with
  the buffer, the platform uplift is a quarter of the scaffold on both
  sides, grades and gauges pass through at cost, brackets and downpipes
  are material less the gutter mark-up. `revenue`, `cost` and `hrsAll`
  are the totals the tiles show; `hrs` stays the roof's own hours because
  the GP/hr nudge moves the roof rates and spreads over those. A pick on
  the quote re-renders the panel (`_setProposalOption`, `_gdChanged`).
  `tests/profititems.mjs`.
- A DRAFT IS NEVER AN ACCEPTED QUOTE. "Create new draft" and "Open saved
  draft" go through `_qvFreshDraft()`, which strips `accepted`/`declined` and
  un-flags an accepted share. The copy used to carry `accepted` with it, and
  the share TOKEN does not change — so the next send handed the customer a
  brand-new quote their browser locked on sight (every option frozen, Next
  dead), while the office saw nothing wrong because the office view does not
  lock. The frozen "Accepted quote" version keeps the acceptance; the draft
  starts clean. `unacceptQuote()` must also REACH the saved job: it leaves any
  frozen version first and saves with `{force:true}`, because plain
  `saveCurrentJob()` returns early and silently on a locked job and an accepted
  job is locked — the office unlocked, reloaded, and the acceptance was still
  there. Both pinned in `tests/quoteversions.mjs`, including a check that a
  customer's browser would NOT lock the new draft.
- The Quote tab bar is three things, not a row of same-weight buttons: the
  actions (`.qa-btn`; one `.qa-btn-primary`, `.qa-btn-warn` for Undo
  acceptance, the rest behind a native `<details class="qa-more">`), ONE
  "Viewing: …" menu (`#qvViewingMenu`, since 2026-09-22: it names what is
  on screen — Draft / Draft N / Sent quote / Accepted quote — and drops the
  versions, New draft, Save this draft and every saved draft as Draft 1,
  Draft 2 …; the three-way selector beside a separate Drafts menu read as
  two controls for one thing), and ONE sentence (`.qv-status`) about the
  customer's link.
  A flat row of "Sent quote · Accepted quote · New draft · Save draft · Saved
  drafts" beside a "link shows this draft, live" badge read as a contradiction
  and the owner called it more confusing than before; the sentence has to say
  BOTH halves when a new draft follows an acceptance ("the link now shows this
  draft, which they have not accepted; the earlier acceptance is kept"). Colour
  means STATUS, not decoration. Menus are `<details>` so they work on a phone
  with no JS; `innerText` of the bar excludes a closed menu's items, so tests
  pin the summary text (`Drafts (1)`), not the items.
- UNDO IS AN EXPLICIT EMPTYING (2026-10-15, a client error report from
  info@wellingtonroof.co.nz on build d8a0000: "empty drawing blocked at save
  — job=draft occurrence=1 roofs=0 activeRoofIdx=-1 outline=0 lines=0
  tab=select hadDrawing=no lkgSource=memory", stack
  `startNewJob` → `_saveBeforeSwitch` → `_writeLocalDraftNow` →
  `snapshotCurrentJob` → `_lkgGuard`).
  The last-known-good guard's own rule is that only an explicit clear may
  empty a drawing, "and those say so by calling `_lkgForget()`" — Clear,
  Delete roof and New job all do. UNDO DID NOT, and it is every bit as
  explicit: the roofer asked for it. So undoing back past the first corner
  left the guard still holding the roof, and the next save — an autosave, or
  the New Job he pressed — was "blocked", paged the office, told him on screen
  that his roof map had gone blank, and PUT THE UNDONE ROOF BACK into the
  draft. The email was the least of it: undo did not stick.
  REPRODUCED FIRST, every field of his report matching (`key=draft`,
  `hadDrawing=no`, `lkgSource=memory`, the same message), and the substitution
  measured — the snapshot came back carrying the four-corner outline he had
  just undone. Two earlier theories were tested and WRONG: `startNewJob` not
  calling `_lkgForget` (it is covered by `clearAll`, which forgets the current
  key) and the Fergus fresh branch stranding a 'draft' entry. Neither
  reproduced; undo did, first try.
  THE FIX IS ONE PLACE: `_applySnapState` is called by `undoLast` and
  `redoLast` and by nothing else, so a `_lkgForget()` at its end — ONLY when
  the drawing is actually empty — covers both. Undoing one line out of twenty
  must leave the guard armed, and does. Redo needs nothing: landing on a
  drawing again, the guard remembers it at the next save, which is how it is
  armed in the first place.
  THE GUARD'S REAL JOB IS UNTOUCHED and pinned beside it: a drawing that
  vanishes with NOBODY asking is still blocked, still put back, and still
  reported. `tests/lkgguard.mjs`.
- CUSTOM SCALE: TWO POINTS, ANYWHERE (2026-10-20, the owner: "change 'set
  scale' to 'Scale a Line' and add another button called 'Custom Scale' where
  the user can enter any custom start point and an end point to set the scale,
  which is really useful on a pdf plan"). The old button said "Set scale" and
  did not say what it wanted — a WALL: `onCanvasClick`'s calibrate branch
  refuses outright without a building outline and then hit-tests
  `_hitAnyRoofWall`. On an imported consent plan that is exactly the wrong
  demand, because the one measured thing on the sheet is its own printed
  dimension line and nothing is drawn yet. It reads SCALE A LINE now, which is
  what it does.
  `customscale` is the new tool: two clicks anywhere, no outline, then the SAME
  `#calPopup` and the SAME `confirmCalibrate`, so there is one piece of scale
  arithmetic and the two cannot drift. `getXY` still snaps level and plumb
  (Shift frees it), which is what a printed dimension usually is; two points
  landing in one place (a double-click) are refused with a sentence rather than
  a scale of infinity.
  THE POPUP NAMES THE TOOL THAT OPENED IT (`_calPopWords`): "Real length of
  this wall" over two points picked off a dimension line is the same wrong
  word the button was renamed to lose. Three sets: wall, custom, and `edit`
  for re-opening an existing reference by clicking it.
  IT STAYS ON SCREEN ONCE A SCALE EXISTS, unlike Scale a Line. Correcting a
  scale normally means clicking a measurement (2026-09-24), and a plan with no
  roof drawn on it has none to click — hiding both would leave a wrong scale
  with no way back. NOT ON THE SITE BAR: that row is a stated nine-button
  budget at 360px (`tests/sitebars.mjs` is mostly width checks, after
  "Calibrate Undo" once ran together as one word) and this is the widest label
  that would be on it; scaling an imported plan is desk work. One line in the
  tablet toolbar to change if he asks.
  `tests/roofmeasure.mjs` (33) is a tripwire: against the old build 7 of the
  new pins fail and every safety pin passes.
- A TAPE ON A PLAN SETS THE SCALE (2026-10-14, the owner on an imported A3
  consent plan: "can't you just base the scale of this physical bar? ignore
  the A3 it shouldn't matter? or am i wrong?").
  HE IS HALF RIGHT, AND THE OTHER HALF IS WORTH KEEPING because it is
  counter-intuitive. The printed scale bar IS the one reference immune to the
  sheet being resized — that part is correct, and the paper size genuinely
  does not matter. But it is also the WORST reference on the sheet. Measured
  on his own file (a Canon iR-ADV scan, 7 pages, A3 exactly at 1190.4 x 841.68
  pt, and NO TEXT LAYER on any page, so reading "1:100" off the drawing is
  impossible on the files he actually receives; pages carry different scales
  anyway — A02b is 1:125, A08 is 1:100): the bar runs about 120 px for 3.75 m,
  so a 2 px reading error is 3%. The drawing's own 31560 mm dimension line
  runs 963 px, where the same 2 px is 0.2%. Three ways of measuring page 1
  gave 0.0313 (bar), 0.0318 (paper theory) and 0.0328 m/px (dimension line) —
  the bar 4.6% short of the dimension and paper theory 3.1% short. THE LONGEST
  DIMENSIONED THING ON THE SHEET IS THE RIGHT REFERENCE, every time.
  So no auto-scaler off the bar. What was missing was the obvious thing: "click
  a measurement to correct the scale" has been the rule since 2026-09-24 and
  `_rescaleFromMeasure` does it for any drawn roof line — but on a freshly
  imported plan there is no roof yet, so there is nothing to click. The
  MEASURING TAPE is what you lay along a dimension before you have drawn
  anything, and it was a drawing aid that counted for nothing. A selected tape
  now carries a ruler button beside its ✕ (`_tapeHandles().scl`,
  `_tapeSetScale`), it goes through `_scaleFromDrawn` — the ONE place the
  scale is set — at slope factor 1, because a tape lies flat on the plan and
  does not run up a rake, and an unscaled tape's label reads "tap the ruler to
  set the scale" instead of a length it cannot know. A figure over 300 is read
  as millimetres: a plan dimensioned in mm is where that slip comes from, and
  nothing a roofer measures on one tape is 300 m. `tests/roofmeasure.mjs`
  pins it on his own 963 px / 31.56 m dimension.
- `autosaveJob` IS NOT A FUNCTION THIS APP HAS, IN FIFTY PLACES (2026-10-14).
  Four had been found one at a time — the back-tray switch, the custom lines,
  the roof-map background toggle, the corner pad — each written up as its own
  bug. Grepping for the rest found FIFTY call sites, every one inside a `try`,
  so every one a silent no-op: a Job Pack page added, moved or deleted, a crop,
  a note, a back-tray / box-flashing / clearlite row edited, a flashing slot
  filled, a roof's sheet type, an outline edge typed to a length, the scale
  itself corrected by `_scaleFromDrawn`, and the office's own pick in
  `_setProposalOption`. Each was saved only if some LATER action happened to
  trigger an autosave, and lost if the roofer closed the tab. All now call
  `_scheduleAutosave`, which carries its own guards (a locked job, the template
  editor, a job with no id) so it is safe everywhere the dead call stood; the
  one in `_setProposalOption` is office-only, because the customer has no job
  to autosave and their own path is the debounced post beside it. ONE comment
  above `onCanvasClick` explains all of them rather than fifty copies.
  THE LESSON: a call guarded by `typeof x === 'function'` or `x && x()` is a
  call that CANNOT fail loudly, so it never shows up as a bug — it shows up as
  "it didn't save my change" months later. Grep for the ghost, not the symptom.
- THE RIDGE / VALLEY JUNCTION IS DRAGGABLE (2026-10-14, the owner: "it won't
  let me click that junction where the two valleys meet the ridge to drag it
  keeping it inline with the connecting ridge"). The solver puts the ridge end
  where the straight skeleton says it goes, and on a real building that is
  often a foot out — but the only way to move it was to delete the generated
  structure and draw three lines by hand. An outline CORNER has had a grab
  handle and a nudge pad for a year; a junction had neither, and it is the
  same kind of point.
  IT DOES NOT TOUCH THE ROOF ENGINE, which is why it is safe on a path this
  file records as broken twice. The lines are already built; moving a junction
  is an edit to the drawn lines, the same shape as the endpoint drag that has
  always existed. `_roofJunctions()` is every point where three or more
  ridge/hip/valley ends meet AND one of them is a ridge — the ridge is not
  decoration, it IS the constraint, so a junction without one (or with two, a
  dog-leg's crossing) has no single axis and is not offered. A gutter or barge
  end is never a junction: that is the building's own corner and the outline's
  to move. `_junctAxis` is the unit vector from the junction down its ridge
  and `_junctMoveTo` projects the drag onto it, so the 40 px of cross-ridge
  movement in a 60 px drag is thrown away — which is the ask, and is also what
  keeps the two valleys symmetrical instead of racking the roof.
  A JUNCTION YOU CAN SEE IS A JUNCTION YOU CAN CLICK: a hollow grab ring is
  drawn on each one in the select tool (never in the Job Pack's captures), and
  the selected one gets the ridge's axis drawn through it dashed, so it is
  plain WHICH way it will move. That is most of what "it won't let me click
  that junction" was.
  THE NUDGE PAD (`#junctRepoPopup`) is the corner pad's twin with one axis
  instead of two: ◀ Shorter / Longer ▶ at 0.01 m, the ridge's own length
  under them, the arrow keys, Escape, a press elsewhere, and a draggable
  header — wired by the SAME function as the corner pad's so neither can be
  the one left undraggable. MIND THE SIGN: the axis points from the junction
  towards the ridge's far end, so a positive step walks the junction up the
  ridge and SHORTENS it. The first version read "Longer" and shortened it;
  `tests/junction.mjs` pins the direction by metres, not by vector.
  AN EXPLICIT ROOF REBUILD STILL WINS — changing the type, rotating, dragging
  an outline corner all run the solver again and the nudge goes with it, which
  is right: those say "work this roof out again". A save and reopen keeps it,
  because the lines are what is stored. Pinned in `tests/junction.mjs`, which
  drives a real mouse.
  THE HIPS SNAP TO 45° AS IT SLIDES (2026-10-27, the owner: "snap the hips
  to 45deg, but also show the hip degrees as i'm sliding it, and also let me
  hold the shift button to remove the 45deg snap point (default the snap
  point to between 42 @ 48deg it snaps to 45deg)"). The angle is each
  hip's PLAN angle against the ridge line; a junction whose hip reads 42–48°
  (`JUNCT_SNAP_TOL_DEG` 3) lands where it is exactly 45 — closed-form,
  because the hip's corner end never moves (`_junctSnapT`). Valleys at the
  junction snap the same way. While dragging, each hip carries a pill —
  green "Hip 45.0° ✓" on the snap, amber off it (`_junctLeanLabels`). Shift
  frees it. The drag reads the RAW cursor (`_junctRawXY`), not getXY's grid
  and corner magnets, which pulled a 40 px slide to 25; and the selection
  follows the junction mid-drag, so the ring and the pad's ridge length no
  longer go blank. `tests/junction.mjs` (23).
  FOUND BESIDE IT: `_cornerRepoNudge` ended with `autosaveJob && autosaveJob()`
  — the same ghost function the back-tray switch, the custom lines and the
  roof-map background toggle were each caught calling, and inside a try, so a
  corner moved with the pad was simply never saved. It schedules a real
  autosave now.
- EACH GUTTER PRODUCT MAY CARRY ITS OWN BUFFER AND MARK-UP, AND EVERY GUTTER
  MATERIAL ROW'S $/unit IS AN INPUT (2026-10-14, the owner: "allow the
  material safety buffer and markup to be applied differently between the
  different gutter options" and "allow me to edit the fixed price of the
  different gutter material lines unit price and ask if i'd like to save this
  new price as default (just like it does for the roofing prices)").
  THE PERCENTAGES: `S.quote.gutterPctByType[id] = {buf, mk}` is that product's
  OWN pair and `gutterMatQtyBuffer` / `gutterMaterialMarkup` stay the job's
  shared fallback — the per-roof labour rates' rule exactly, so a product left
  alone follows the shared figure and no quote already written moves. A blank,
  or the ↻ beside the box, deletes the override; `_gutterPctTidy` removes the
  empty object with it, or the card would say THIS GUTTER over a shared
  figure. `_gutterMatQtyBufferPct(id)` / `_gutterMatMarkupPct(id)` take the
  product, defaulting to `_gutterPricingType()`, and EVERY caller that prices
  a named gutter now passes it — `_gutterMaterialCharge` above all, because
  that is the one function the customer's price for every gutter comes
  through, and reading the picked product there would price a Typhoon at the
  box gutter's mark-up. The profitability panel, the pricing CSV and the
  Fergus push pass theirs too.
  THE $/unit: `_gutterMaterialLines` rows now carry `stash` and `pb` — which
  price each was built from — so the card can render an input and
  `_gutterPriceTyped` can offer the typed figure as the new default through
  the material table's OWN `_matDefaultAsk` dialog (the same question, not a
  second one saying it differently). `_gutterSaveAsDefault` writes
  `price_book.gutter[pb]` directly and NOT through `_matSaveAsDefault`, which
  scopes its write to the steel grade in use — a gutter is not graded steel,
  so a graded write would land where nothing reads it.
  THE TRAP, and it cost a round: `S.quote.gutterUnitPrices` looks like the
  place to keep a typed price and is NOT. It is a FROZEN SNAPSHOT of the price
  book, rebuilt from the book wholesale on every recalc so the customer's copy
  can price gutters with no settings of its own — so a figure written into it
  survived until the next keystroke anywhere on the quote, and the first
  version of this silently did nothing (measured, not reasoned: the charge did
  not move and the store read back the book's 21). Typed prices live in
  `S.quote.gutterPriceTyped`, are read FIRST by `_gutterSupply` /
  `_gutterPrice`, and are layered OVER the snapshot where it is stamped —
  which is also what carries them to the customer. Emptying the box deletes
  both copies. `tests/gutterprice.mjs` pins the recalc explicitly.
- EVERY JOB-CHANGE PATH LETS GO OF THE SAME THINGS (2026-10-14, feedback
  report 13: "data bleed between last open job (3292) as this open job
  (3306)"). `_releaseCurrentJob` has said who the job IS since the Fergus link
  leaked into a new job; what the job CONTAINS was a list living inside
  `restoreFromJob` alone, grown there one feedback report at a time — the
  files, report 53's picture, the struck-off flashings, the quote. The OTHER
  two ways into a job never ran it. `useFergusJobInModal`'s fresh branch (a
  Fergus job RoofMap has never saved, which is the shape the owner was on)
  reset seven things by hand and `newJob` five, so the new job wore the last
  one's JOB PACK PAGES, its struck-off FLASHING TYPES, its CLEARLITE and the
  $/unit PRICES typed over the book on another roof — and because that branch
  never called `_releaseCurrentJob` either, its LOCK, its version list and its
  `base_updated_at` stamp as well. `_releaseJobContent()` is the one list and
  all three paths call it. A list in three places is a list that drifts.
  NOT MOVED to the top of `restoreFromJob`, deliberately: the roof-map history
  restore calls it with a synthetic `{state:{img64}, draw}` to put an old
  drawing back on the CURRENT job, and releasing there would throw away that
  job's pack and its typed prices. It stays inside `if (snap.state)`.
  AND TWO FIELDS OF THE FEEDBACK REPORT HAVE NEVER BEEN TRUE. `Roof image`
  read `d.img || d.bgImage`, and neither is a field of DRAW — the picture is
  `DRAW.bgImg` — so it printed `none` on every report ever sent, including
  this one, whose own attached screenshot shows a PDF plan behind the roof. It
  names `bgFrom` now (linz / mapbox / upload). `Job selected` read `S.job`,
  which this app writes nowhere, so it printed `no` every time; it names
  `currentJobId`, `linkedJobId`/`linkedJobNo` and the quote's `ref`, and adds
  `Job locked`, because WHICH of those is set is exactly what decides the code
  path a report is about. `tests/fbcontext.mjs` had PINNED the broken one by
  setting `S.job` itself — the same mistake as the step-down gable pin, a test
  asserting the app's own output back at itself. Both fixed.
  `tests/jobbgleak.mjs` drives the real `useFergusJobInModal` fresh branch.
- MY DAY'S SECOND DEVICE OPENED ON THE WRONG SCREEN (2026-10-18). `mydayui`
  was failing on main — the two-device half of the feature, which is its
  headline promise — and a red Tests run on main SKIPS THE PROMOTE, so it was
  holding back everything behind it (the Finance Hub marketing fallback and
  the signup blocklist both sat on main, unshipped, while production stayed on
  `30fd6ad`). A red main is never just one suite's problem.
  THE SYNC WAS NEVER AT FAULT, which is where the whole morning would have
  gone: instrumenting the failure showed the joining device with the key, the
  doc pulled, `rev:3`, both days present and "synced 9:40 pm" on screen — and
  `VIEW:'plan'` with nothing on it. `pickView()` runs at BOOT, before
  `pullOnly()` has brought anything down, so it answers "is tomorrow planned?"
  against an EMPTY doc; after 5pm that opens the planning screen, and nothing
  ever re-decided once the real day landed a second later. The office opens My
  Day on the computer in the evening and sees an empty plan screen over a full
  day.
  `pickView` is a named function now and runs a SECOND time, from `pullOnly`,
  the first time a pull actually changes the doc — once (`VIEW_SETTLED`) and
  never over a screen the person picked themselves (`VIEW_BY_HAND`, set by the
  two segment buttons). A view they chose is never taken back off them.
  THE RULE ITSELF IS UNCHANGED, and that is deliberate: the first version of
  this fix also added "…unless today is full", which made an evening with
  tomorrow unplanned open on TODAY and quietly deleted the evening nudge to
  plan tomorrow — the whole point of the app. Re-taking the decision at a
  better moment is the fix; changing what the decision IS is not.
  THE OLD PIN ONLY FAILED AFTER 5PM — it would have passed on a morning gate
  with the bug fully present, which is how it shipped. `tests/mydayui.mjs` now
  pins the clock (`context.clock.setFixedTime`) for a device joining at 9pm,
  and pins the evening nudge itself at 7:30pm with nothing planned, so both
  directions hold at any hour. Against the unfixed page the two new pins fail.
- A CARD THAT ADDS UP AND IS STILL WRONG (2026-10-18, the owner with
  screenshots of his Pricing drawer: "the numbers don't add up properly", and
  then the detail that names the trigger — "i selected roof wo to be apart of
  the main roof which is why they should be priced together"). The price card
  beside the frozen roof map read Labour $8,100.00 / Material $7,347.09 /
  Scaffolding $2,500.00, total $17,947.09 — beside cards reading $13,800.00
  (60 hrs x $140 + 60 x $90), $10,124.16 and $5,500.00, with the profitability
  panel agreeing with THOSE.
  ITS OWN THREE ROWS ADDED TO ITS OWN TOTAL EXACTLY, which is the tell and is
  worth keeping: it was never bad arithmetic, it was ONE RENDER showing an
  older state of the job. A figure that is internally consistent and agrees
  with nothing else on screen is a stale render, every time — do not go looking
  for a sum that is wrong.
  TWO HOLES, both reproduced before anything was changed:
  1. `_renderPricingRoofSwitchBar` had two early returns for "fewer than two
     pricing tabs", and BOTH sat in front of `_renderPricingRoofMap()` — the
     only place that card is ever drawn. Folding Roof 2 into the main roof
     (his own words above) collapses two tabs into one, so from that moment
     the card froze and kept showing whatever was last painted, for the rest
     of the session. Nothing to switch between is a reason to hide the
     BUTTONS, never a reason to stop telling the truth about the money.
  2. Even with the card live, a MATERIAL edit never refreshed it:
     `renderMaterialPriceTable` and `refreshQuoteProposal` do not call the
     switch bar, so a mark-up typed 5% -> 50% moved the card's own figure by
     thousands while the card sat still. `calcLabour` DOES call it, which is
     why labour and the scaffold usually looked right and this hid for so long.
  `_prMapRender()` is the one guarded way in now (a `_PR_MAP_BUSY` flag, because
  `_renderPricingRoofMap` reads the material rows and `renderMaterialPriceTable`
  now asks for a redraw — without it the two could call each other). Both early
  returns call it before returning, and the material render calls it at the end.
  A SINGLE-ROOF JOB STILL SHOWS NO BAND AT ALL: it needs the multi-roof mini map
  and `_qpRoofMapSvg` draws nothing for one roof. That is a gap, not this bug,
  and giving single-roof jobs a card is the owner's call rather than something
  to slip in beside a fix — but on the old build such a job showed the PREVIOUS
  job's card, which is worse than none. `tests/pricingcard.mjs` pins the
  invariant instead of the gap: the card is either absent or correct, never
  stale, so the band can be given to single-roof jobs later without the pin
  fighting it. Run against the old build it fails 10 of 16, every failure the
  same frozen 8,640 / 10,315.39 / 2,500 with rowsAdd true — his screenshot,
  reproduced.
- A NEW PAYING SUBSCRIBER EMAILS THE OWNER (2026-10-28, the owner: "I'm not
  getting any emails to say that somebody's started paying ... email me
  congratulations, new paying subscriber ... give their details", and "in the
  activity report ... also the date that they started paying"). A signup told
  him (`_signupAlert`); the first payment told only the CUSTOMER (their tax
  invoice). `_newPayerNotify` runs from the webhook on a PAID checkout
  (`payment_status === 'paid'`, `amount_total > 0`) and on `invoice.paid` /
  `invoice.payment_succeeded` (`amount_paid > 0`; the subscription id from
  `inv.subscription` or `inv.parent.subscription_details`, Stripe's 2025+
  shape): stamps `subscriptions.paid_since` (the earliest payment, never moved
  later) and, once — claimed by `paid_alert_at`, written before the send —
  emails `NEW_PAYER_ALERT_TO` (default = `SIGNUP_ALERT_TO` = support@) with the
  business, name, email, phone, plan and price, the first payment, paying
  since, signed up (and how many days before paying), and how many businesses
  pay now; Reply-To is the customer. A $0 invoice is not paying. An invoice
  that lands before the checkout has written the row is let go; the checkout
  then sends it. THE BACKFILL (`_paidSinceBackfill`, 75 s after boot, and
  `POST /admin/paid-since/run`) dates every paying row off Stripe — the
  earliest paid invoice above $0 (`GET /v1/invoices?subscription=…&status=
  paid`) — and sends the email they missed to one that started paying in the
  last `NEW_PAYER_RECENT_DAYS` (14); older ones are marked told quietly. As of
  the ship that is WLRR (~22 Oct) and TGM Roofing (~23 Oct), read off the
  daily reports in his Gmail; Signature Roofing (~7–12 Oct) and Flood Roofing
  are older. THE DAILY REPORT (daily.js) reads `paid_since`: each paying
  business's line ends "paying since 23 Oct 2026" ("not recorded" where Stripe
  had no paid invoice), and a "New paying subscribers yesterday" section leads
  when there are any. `tests/newpayer.mjs` (17, API list).
- SHUTTING ONE ACCOUNT OUT (2026-10-18, the owner on a signup alert — "membrane
  roofing" / "Trinity AI", trinityai.group@gmail.com, 14-day Team trial: "Can
  you block this, it's a business growth ai company"). Not every unwanted
  signup is a bot: this one had a real address, a real phone and a plausible
  business name, so the honeypot, the throwaway-domain list, the phone
  requirement and the email confirmation all passed it — and then the trial
  drip, the gone-quiet alert and the owner's own time went to somebody who was
  never going to roof anything.
  `SIGNUP_BLOCKLIST` on Railway is a space/comma list of a WHOLE ADDRESS or a
  bare DOMAIN; `BLOCKED_SIGNUPS_BUILTIN` in server.js carries the ones already
  decided so they work with no env var set. Both are read AT BOOT, so a change
  on Railway needs a restart.
  FOUR CHECK SITES, and three would not have been enough: `/auth/register` (they
  cannot come back), `/auth/login`, `/auth/verify` (the confirmation link signs
  them straight in, so it is a sign-in), and `requireAuth` — which is the one
  that actually CLOSES an existing account, because a session token lasts
  thirty days and shutting the front door would have left theirs running for a
  month. Blocking in requireAuth also means no database change is needed, which
  is what makes this shippable at all: the cloud container has no production
  database access, so a list in the code is the only lever a ship carries.
  A FREE-MAIL DOMAIN IS NEVER BLOCKED AS A DOMAIN (`NEVER_BLOCK_DOMAIN`). Most
  roofers sign up from gmail, so one careless `gmail.com` in that env var would
  refuse every real trial in the country and look, from outside, like the
  product being down. Those domains match only as a whole address, and
  `tests/blocksignup.mjs` puts `gmail.com` ON the blocklist and then registers
  and signs in a real roofer from it — so the pin proves the guard rather than
  the absence of a bug.
  GMAIL IS FOLDED FIRST (`_normaliseEmail`): gmail ignores dots in the local
  part and everything from a `+` on, so trinity.ai.group@ and
  trinityai.group+roofmap@ are the same mailbox and all three are blocked
  together. Only gmail/googlemail are folded — every other provider treats a
  dot as a real character. AND THE LIST ENTRIES ARE NORMALISED THE SAME WAY:
  the first version normalised only the incoming address, so the dotted
  built-in entry could never match itself and the one address this was written
  for sailed through. The suite caught it; the env-var cases passed throughout,
  which is exactly how it would have shipped unnoticed.
  To block another: add it to `SIGNUP_BLOCKLIST` on Railway and restart — no
  ship needed. A ship is only for the built-in list.
- A ROOF REBUILD IS NOT A CLEAR (2026-10-16, feedback report 14,
  info@wellingtonroof.co.nz: "Hip & Valley Detail Disappears — this detail
  disappears after saving, not sure why, have had to redraw 2 times?"). His
  dutch gable has a bump-out in the bottom eave and he had HAND-DRAWN the
  little hip-and-valley structure over it — a 1.76 m ridge, two valleys up
  into the main roof, two hips down to the corners — because no builder draws
  that. Five lines with no `autoGenerated` mark, which is what makes them his.
  THE SAVE WAS NEVER THE CULPRIT, and that is worth saying because it is where
  anyone would look first: `snapshotCurrentJob` → `restoreFromJob` keeps all
  five to the point, measured on the broken build before anything was changed.
  `autoGenerateRoof` did it. It opens with `clearRoofLines()`, which was
  `DRAW.lines = []` — so EVERY rebuild took the office's lines along with the
  builder's: Rotate roof 90°, re-picking the shape, picking a different shape,
  and worst of all `setDutchGabletFrac`, which regenerates on `oninput` and so
  wiped them on the first pixel of a drag — from the roof settings panel that
  slides ITSELF open over the canvas a second after the roof lands. That is as
  close to "it happened by itself" as a control gets, and it is why he could
  not tell what had done it.
  `regenerateAutoRoofLines` — the corner-drag path — has never done this: "a
  line drawn anywhere else is the office's and stays" (report 64). The two
  paths simply disagreed, and the destructive one was on the end of a
  dropdown, a slider and a button. `_clearBuiltRoofLines` (renamed, one
  caller) now uses the REGEN'S filter: the builder's own output goes because
  it is about to be rebuilt, gutters and barges go because
  `autoPopulateGutters` re-lays them off the outline, and anything the office
  drew stays.
  THEN NOTHING DOUBLES UP, which is the other half and the reason this is not
  just a weaker clear: after the new structure is built, `autoGenerateRoof`
  drops any KEPT line that lands within 2 px of one the builder is about to
  draw. A line sitting exactly where the new structure puts its own belonged
  to the OLD structure, not to the office — report 64's stray unmarked ridge
  is precisely that — so a rebuild is idempotent and hip→gable still leaves a
  fresh gable and nothing else.
  MEASURED AGAINST THE PRE-FIX BUILD rather than reasoned about: every case
  with nothing hand-drawn is byte-identical, the 37-shape sheet gate included,
  and his roof's sheet count is unchanged to the millimetre (10597×54,
  12369×13, 5299×52). `tests/report14.mjs` is a real tripwire — run against
  the old build, exactly the four "detail survives" pins fail and all five
  safety pins pass. Pin the gablet fraction before measuring a dutch sheet
  count in a suite: it is a per-roof field that outlives `clearAll`, so an
  earlier case that moved the slider otherwise decides the count.
- A BUMP IS HIP & VALLEY OR A MONO EXTENSION, AND THE OFFICE SAYS WHICH
  (feedback reports 78 and 79, 2026-10-28, the owner on job 3302: "inside the
  fine adjustments window ... show a button to convert this section/corner
  from hip & valley to mono-extension" and "i pulled it too far and it
  converted to a hip & valley (i also don't want it to auto change to a
  mono-extension if i make it short)"). A BUMP (`_outlineBumps`) is a short
  wall standing out from a straight one: A-B-C-D, B and C the outer corners,
  A and D inside corners on one straight wall. On a hip roof the KIND of roof
  over it was decided by its depth: under `_roofSquareUp`'s squaring tolerance
  (5% of the shorter span, ≤24 px — about 0.5 m on his roof) it was squared
  into the wall and got nothing, over it its own little hip end.
  `DRAW.bumpModes[<index of B>] = 'hv' | 'mono'` per roof (ROOF_FIELDS, the
  draw block, the undo snapshot, the feedback payload; a new outline clears
  it). `_hipLinesWithBumps` is the hip builder in both `_roofLinesForType` and
  `regenerateAutoRoofLines`: 'mono' builds the hips with B and C left out (the
  main slope carried over the bump) and adds barges on its two sides; 'hv'
  keeps its outer wall out of the squaring (`_SQ_KEEP`, read by `cluster` in
  `_roofSquareUp`) so it gets its own hip end at any depth, with gutters on its
  short sides. THE CORNER PAD carries the switch (`#cornerBumpRow`,
  `_cornerBumpRowRender`, `_bumpSetMode`), shown only for a bump's corner on a
  hip roof. GRABBING a bump's corner LOCKS the kind on screen
  (`_bumpLockModes` in `_cornerRepoOpen`, `_bumpShownMode` = a hip or valley
  ends at one of its corners), so a drag never changes the kind by itself.
  With no choice made the hip roof is built exactly as before. Found with it:
  a corner grab took the FIRST corner in reach, which on a shallow bump was
  the inside corner below the one aimed at — it takes the nearest now. His
  pictures: report 79's roof 56 sheets with five extras → 47 with none as a
  mono extension. `tests/report78.mjs` (21, a real mouse drag).
- A ROOF PROFILE MAY CARRY ITS OWN PRICE (2026-10-14, the owner: "corrugate
  and 5-rib share the same standard roofing sheet price, but then a profile
  like RI-925 has it's own more expensive price"). He had added RI-925 and
  there was nowhere to price it: a profile was `{id, name, locksGauge,
  coverMm, desc}` and the only money anywhere near it was the 0.55 gauge
  upgrade, which is why both 5-Rib and RI-925 showed the customer the same
  +$2,420.81 and why that figure had nothing to do with either profile.
  `rate` + `rateUnit` ('m2' | 'lm') on the profile, two columns on Settings ->
  Quote's Product Options -> Roof profiles. BLANK IS THE WHOLE COMPATIBILITY
  STORY: `_selProfileRate` answers null, `_anyProfilePriced()` is false, every
  delta is 0 and `_profileDeltasSnapshot()` returns null, so Corrugate, 5-Rib
  and every quote written before this price exactly as they did. Nothing
  migrates and `pricegold` is unmoved.
  ONE PLACE PRICES IT: the sheets row in `_buildMaterialPriceRows` reads
  `_profileInUse()` and, where that profile has a rate, REPLACES the row's
  variants with the profile's own rate, name and UNIT — the unit too, because
  a tray priced by the metre is not priced by the square and the quantity
  basis has to follow (roof area for m2, the sheet run for lm). Everything
  downstream reads `r.variants[].price`, so the material table, the materials
  total, the profitability panel, the pricing CSV, the Job Pack and the Fergus
  push all follow for nothing. A typed `MATERIAL_OVERRIDES` price still wins
  over it, as it does over every book price.
  `_profileSheetCost(id)` is `_gradeMaterialTotal`'s shape exactly —
  `window.__profileOverride` swapped under the row builder, the sheets row
  read back, the override put down — and `_selProfileDelta(id)` is the
  difference from `baseProfile` (the profile the quote was PRICED at, the
  grade rule, so the quoted profile reads "Included" and the others read the
  real difference either way). `_profileDeltasSnapshot()` freezes the map onto
  the quote as `profileDeltas` at every recalc, never on an accepted quote,
  and `_selProfileDelta` reads that map FIRST — the customer's copy has no
  price book, so an un-frozen delta would read $0 on their screen while the
  office showed a figure (the FR-14015 lesson).
  THE DELTA CARRIES THE BUFFER AND THE MARK-UP (`_profileDeltaScale`), unlike
  the grade percentages, and deliberately: this is a straight cost difference
  on a material row, so without the margin the card would under-read by
  exactly the margin while the total moved by the full amount — a card and a
  total disagreeing about money. Both summary builders show the same figure
  (inside the gauge-lock row where there is one, one line per decision), and
  `gradeprices.mjs` pins row and card equal to the cent.
  AND A PICTURE CAN BE ADDED TO A PROFILE ALREADY ON THE LIST (the same
  message: "how do i add a profile photo to an already added roof profile?
  theres nowhere to add it"). `_qpfPicPick(id)` always handled a saved
  profile; it was only offered inside the quote's "Edit this quote's
  selections" window, which is not where somebody who just added RI-925 in
  Settings is standing. The Settings row carries the thumbnail and an add /
  change link now. `tests/gradeprices.mjs`.
- Prices by steel grade: the base grade's sheets, flashings and back-trays
  ARE the price book's top-level fields; any other grade's own set lives
  under `price_book.by_grade[id]` and is used only when it has a price in
  it (`_pbGradeHasPrices`) — then `_pbForGrade(_pbGradeInUse())` feeds the
  material rows, `_gradeFactor` is 1 for it, and the customer's grade delta
  is the real difference on the graded rows (`_gradeDeltasSnapshot`, frozen
  onto the quote as `gradeDeltas`). A grade with no prices of its own still
  runs on the percentage from the Products list. `tests/gradeprices.mjs`.

- MY DAY, THE OWNER'S DAILY PLAN (2026-10-17, his own ask: "I want an app
  where I can plan my day at the end of each day for the next day ... 3 or 4
  main things ... the rest small fill-in tasks ... on my phone and my computer
  ... so I can never really forget about it"). `floodroofing/hub/MyDay.html`
  + `myday.webmanifest` + `myday-sw.js` + `myday-icon.png` — a third
  single-file hub app on GitHub Pages, so a push to main is live in a minute
  and it does NOT ride the RoofMap promote. NOT built into app.html on
  purpose: it is his personal tool, not a product feature, and real customers
  use that file daily.
  TWO SCREENS. TODAY (the big ones as large cards, tap ANYWHERE on the row to
  tick, fill-ins lighter underneath and never counted in "1 of 3 done") and
  PLAN TOMORROW (three numbered boxes, one-tap chips for anything still open
  today). It opens straight onto the planning screen after 5pm when tomorrow
  is bare, which is the whole point of it.
  THE DEVICE IS THE TRUTH: every change hits localStorage at once, so it works
  on a roof with no signal. The server (`/day/:key`) is a POST BOX, not a
  brain — one blob, one revision. The merge is in the APP, per task, last
  write wins with tombstones, so two devices converge whichever order they
  sync in; a PUT whose `baseRev` has moved is REFUSED (409) and handed the
  current copy, and the revision check rides on the write itself
  (`.eq('rev', cur)`) so two saves in the same breath cannot both win.
  THE FLAG THAT SAYS "THE SERVER HAS NOT GOT THIS YET" IS WRITTEN DOWN WITH
  THE PLAN, and it had to be: it was a variable first, and a tick made with no
  signal then survived a reload on the phone and NEVER reached the server, so
  the computer never heard about it. Found by the suite, not by reasoning.
  THE KEY IS THE CREDENTIAL — `/q/:token`'s bargain, and the right one here: a
  password prompt at six in the morning is how a tool like this stops being
  used. SERVER-generated, never caller-chosen (or the endpoint is squatted
  on), rate-limited, and `_dayClean` keeps only the shape the app writes so an
  unauthenticated endpoint cannot become a pastebin. A failed read is a 503,
  never an empty plan — on the phone an empty plan reads as "my list has gone".
  `office4777.github.io` was ALREADY in the CORS allowlist (the Finance Hub);
  the suite has to declare its own origin via `FRONTEND_URL` before booting
  the server, which is why it starts its static server first.
  `tests/dayplan.mjs` (server), `tests/mydayui.mjs` (the real page, two
  browser contexts as his two devices, including offline).

- THE ROOF PANEL FOLDS TWO SECONDS AFTER THE LAST PRESS (2026-10-18): the
  reveal's own window (`RTP_HIDE_MS`, 1.5 s since 2026-10-27 — the owner:
  "close the 'Main Roof — roof settings' drop down menu after 1.5sec of it
  being open"; it was three) is for seeing where the row is; a press on a
  BUTTON inside restarts `RTP_CLICK_HIDE_MS` (2 s) via `_roofPanelAutoHideBump`,
  so a run of presses is never cut short. A field being typed in keeps it open
  until the caret leaves (two seconds between keystrokes is an ordinary pause
  reading a pitch off a plan); `pointerenter` still drops the reveal's timer for
  good; and a panel opened BY HAND (`rtp._rtpAuto = false` in `_toggleRoofMenu`)
  is never closed by a press inside it. `tests/roofmenu.mjs`.
- THE ALIGNMENT GRID IS ORANGE AND THREE TIMES AS FINE (2026-10-18):
  `ALIGN_GRID_COLS` 24 (was W/8), `ALIGN_GRID_COLOUR`/`ALIGN_GRID_LABEL`
  `rgba(255,138,0,…)`. A pale cyan line over a green-and-grey aerial is the one
  colour on the picture you cannot see. The BACKGROUND slider (`#bgOpacity`) is
  out of the Edit font size menu and on the bar beside it; the Edits (Scaled /
  Visual) buttons lost their own row and ride in `#roofToolRight` with the scale
  line, `#scaleIntegrityRow` keeping its id and its place after `btn-calibrate`.
  `tests/canvassetup.mjs` reads the grid off the canvas (count the HUE lean, not
  the exact colour — a 1px line straddles two columns and blends pale).
- EVERY QUOTE SECTION'S DESCRIPTION IS THE OFFICE'S TO WORD (2026-10-18):
  `S.quote.sectionDesc[key]` for `grade`, `profile`, `thickness`, `colour`,
  `gutter`, `disposal` (and `gutterkit`), rendered by `_qSecPara(key, default)`
  which carries `data-qe-sec` + `data-qe-def` and is bound click-to-edit by
  `_qeBindModernEdits` → `_qeCommitSection`. NO key means the built-in, so every
  quote already written reads as it did; emptying it, or typing the built-in back
  word for word, deletes the key (the custDesc rule). NO `{grade}` substitution
  here, deliberately — a field substituted on the way out and read back on blur
  would swallow the token the first time anybody clicked it.
- NOTES ON A QUOTE (2026-10-18): `S.quote.custNotes`, a third list in Edit
  description (kind `'n'`, `_qdescAdd('n')`), shown on the proposal under an
  amber "Please note" heading with a caution triangle per line
  (`.qb-note-hd`/`.qb-note-row`). Not an inclusion (a promise) and not an
  exclusion (something withheld) — the thing the customer has to MIND. Nothing
  generates them, so there is no `qb-incl-auto` half. Both new keys are in
  `Q_CONTENT_KEYS`, `Q_FRESH_DROP` and a template's `wording`.
  `tests/quotewording.mjs` pins both, office and customer.
- A NEW VERSION STARTS BLANK (2026-10-18): `_versionCreate` sends
  `_versionBlankState()` as `draw_state` on `POST /jobs/:id/versions` — the
  client, the site, the job number and the Fergus link, nothing drawn or priced.
  The state is built in the APP because what an empty quote looks like is the
  app's business: a partial quote object handed to `restoreFromJob` is how a
  renderer finds half a quote and throws. With NO `draw_state` in the body the
  endpoint still COPIES, so an older app on a cached page keeps working, and both
  shapes are pinned (`tests/jobsearch.mjs` blank, `tests/jobversions.mjs` copy).
  The default name is `Version N` (`_defaultVersionName(taken, have)`), not
  "Aron's version" — which answers who made it, the wrong half when three sit on
  one job. Rename is on the Edit job details row as well as in the menu.
- ONE JOB IS ONE ROW IN THE SEARCH (2026-10-18): `_jobGroupsOf(list, q)` groups
  the saved jobs by `version_of || id`; a match on ANY version brings the whole
  group (a blank new version has no number of its own yet), the root leads and
  the rest sit under it as `.hb-drop-ver` rows. `_jobTicksHtml` shows a Fergus
  tick and a Quote-sent tick, from `linked_job` / `quote_sent` — two jsonb paths
  `GET /jobs` now sends beside `job_no`. A Fergus job a saved job is LINKED to is
  dropped from the Fergus list (it was a third row for the same job); one nobody
  has started is still offered. `_savedJobMatches` also matches `linked_no`, so
  "3303" finds a job whose own RoofMap number is 06121. `tests/jobsearch.mjs`.
- A FRESH FEED IS NEVER THE CACHED ONE (2026-10-18): `/quote-activity?fresh=1`
  skips `_quoteFeedCache`'s minute. A write marks that cache stale, which is
  enough while one server answers everything — but the mark lives in one
  process's memory, so a send handled by one instance leaves another's
  minute-old copy looking perfectly good and the board paints from before the
  send. The Home ↻ asks fresh, and so does the first visit Home after a send in
  this session (`window.__qSentAt`, stamped by `_qvMarkSent`). It still FILLS the
  cache. `tests/sentboard.mjs` follows a real send to the board at three depths;
  `tests/jobsearch.mjs` pins the bypass against a row changed under the cache.
- A BUSINESS WITH ANY DETAILS ON FILE IS NOT A NEW ONE (2026-10-18):
  `_needsSetup()` asked on `branding.company_name` alone, and that one field can
  be empty on an account whose NAME comes from the company record while its logo,
  phone, email and address have been on every quote for a year — so the "Set your
  business up" wizard met the owner over a quote already carrying his own logo.
  Any of company_name / logo / logo_data_url / phone / email / address / website /
  gst_number / tagline means set up. "I'll set this up later" now holds for the
  sitting (`sessionStorage.fr_setup_later`). The older lesson above it still
  stands: a /settings read that FAILED is not an empty branding.
  `tests/setupguide.mjs`.
- A GUTTER CARRIES A PICTURE LIKE A PROFILE (2026-10-18): `img` on a
  `selectables.gutters` row, set by `_qpfPicPick(id, 'gutters')` →
  `_qpfPicSet(id, src, kind)` (kind defaults to 'profiles', so every existing
  call is unchanged) from Settings → Quote's Product Options AND from the
  quote's "Edit gutter selections" window. `_qbGutterFigure(id)` shows ONLY the
  picked one, and nothing for a product with no picture — the roof profile's
  rule. AND BRACKETS & DOWNPIPES ARE THEIR OWN SECTION: `gutterkit` is pushed
  into `_qdSectionsRaw` under `gutter` when one is chosen, full width, each
  choice in its own `.qb-sub` box; `_qdGutter` is just `_qbGutter()` now and the
  `qd-grid2` two-column row is gone. Same fault and same fix as the
  three-column "Roofing" grid of 2026-09-20. `tests/gutterlook.mjs`.

- THE RIDGE FOLLOWS THE BUILDING, NOT THE SCREEN (feedback report 65,
  2026-10-18: "diagonal straight gable not good, ridge should keep with the
  angle of the roof (2nd roof) not try stay horizontal"). The straight-gable
  builder works in SCREEN axes — bounding box, ridge along its midline, each
  wall sorted into gutter or barge by whether dx or dy is bigger — which is
  right for a building square to the picture and has been for a year. On one
  traced at an angle the midline runs corner to corner ACROSS the roof: his
  8.3 x 6.2 m shed at 44° came out with a horizontal ridge, SIX BARGES AND NO
  GUTTER, and (measured on the old build) NO SHEET GROUPS AT ALL, so it
  ordered no steel either. Not a cosmetic fault.
  THE FIX IS A CHANGE OF FRAME, NOT A CHANGE OF BUILDER: `_roofFrameAngle`
  (the longest wall's direction reduced to (-45°, 45°], the same reference
  `_outlineIsRectilinear` measures against, so "rectilinear" and "which way it
  faces" cannot disagree), `_roofFrameRot`, `_roofFrameCentre`. The outline is
  rotated onto its own walls, the SAME code runs, the lines are rotated back.
  A roof square to the picture rotates by nothing and is byte-identical —
  which is what makes this safe on a path this file records as broken twice.
  Under 2° is hand wobble and is left alone.
  AFTER THE DOG-LEG CHECK, DELIBERATELY: a true dog-leg is not rectilinear in
  ANY frame, so report 60 keeps its own branch ahead of this one; a dog-leg
  with a shallow bend would otherwise read as "rectilinear in the weighted
  mean frame" and be stolen from it.
  `DRAW.roofBaseHoriz` is decided in the frame too — the screen bounding box
  of a roof at 44° is very nearly square whatever shape the building is (his
  measured 202 x 201 px), so the ridge direction was a coin toss on exactly
  the roofs that need it most. A roof ALREADY SAVED keeps the stored value
  (the ridge direction is a decision, not a measurement); Rotate roof 90° is
  the way to turn an older one, and re-picking the shape rebuilds it.
  THE STEP GABLE HAD THE IDENTICAL FAULT and has the identical wrapper: an L
  at 30° gave horizontal ridges and TEN gutters, half across the walls.
  MONO, DUTCH AND HIP WERE ALWAYS RIGHT and are pinned so: the straight
  skeleton and the mono's direction classifier do not care which way the
  picture is turned. The sheet engine needed nothing — once the lines are
  right it counts 22 at 3.18 m on his roof, and the 37-shape gate is
  unchanged. `tests/report65.mjs` is a real tripwire: against the old build
  the ten fault pins fail and all four safety pins pass.
- A POLE SHED'S PDF IS NOT A ROOFING QUOTE'S (2026-10-20, the owner on quote
  3287: "tidy up the pole shed modern quote pdf, needs to look alot tidier do
  this ASAP"). The shed's modern sections ARE the A4's own blocks — deliberate,
  so the two styles cannot drift — so the modern PRINT rules, every one of them
  written against a re-roof, met those blocks for the first time in that file.
  Four landed badly and all four are print-only fixes; the screen is untouched.
  THE DRAWINGS WERE CROPPED. `.qd-sec img{max-height:80mm; object-fit:cover}` is
  right for a condition photo — cropping one loses nothing — and it sliced the
  bottom off the floor plan AND the elevations: "Right" cut in half, a dimension
  line gone with it. A plan is READ, not looked at. `.ps-draw-img` prints
  `contain` with no cap, and `.ps-draw-col`'s `height:820px` (an A4 page's worth,
  meaningless on a sheet sliced out of one long capture) goes to auto with 104mm
  a drawing.
  A SPEC ROW NOBODY FILLED IN PRINTED AS A LABEL WITH A RULE UNDER IT. Job
  3287's Width, Length, Height and Bays are blank because that plan's WebShed
  PDF never named a size and its estimator carries none either — so four empty
  rows in a row, which is most of what "untidy" was. `specRow` marks an empty
  row `ps-spec-empty` and print drops it; the office still sees it, to type in.
  THE ACCEPTANCE FORM WAS ON THE PAPER: a name box, a tick box and a button.
  `.ps-accept-card` is dropped and `.ps-accept-grid` becomes a block, so the
  money takes the full width — which is what that page is for. They accept on
  the link in their email. "Tap to change a selection" and an empty dashed
  drawing box go the same way, and so does the plan switcher's wrap: its
  BUTTONS were already dropped by the button rule, leaving "Choose your plan"
  standing over nothing on the cover (the cover's meta grid names the plan).
  "of 5 pages" is the A4 document's chapter count and read as a contradiction
  beside the sheet number stamped at the foot ("2 of 4"); `.ed-ofpages` is
  print-hidden.
  AND A CHAPTER BAND IS NO LONGER SLICED. `_pdfBreakRows` lifts a section
  boundary 8px rather than 5 and counts `.ed-heading-band` among its row
  candidates, so a sheet stops opening — or closing — on a navy sliver, which
  it did on three sheets out of four.
  NOT FIXED, and it is inherent rather than a bug: the cover sheet is about 60%
  full. The cover is short and the Plans chapter is nearly a whole sheet, so
  nothing can share with either. Do NOT chase it by lowering the slicer's
  section threshold — that splits the two drawings across sheets, which is
  worse. `tests/poleshed.mjs` (201): 8 of the 9 new pins fail on the old build.
- HTML2CANVAS DOES NOT HONOUR `object-fit` (2026-10-20, the owner on the pole
  shed's PDF, second attempt: "pdf still looks terrible compared to the app,
  ratio is all distorted and cover page is nearly all empty"). He was being
  literal: a test render with a circle on it came out an ELLIPSE. The capture
  draws every `<img>` stretched to its box, which is why
  `_inlineCoverImagesForPdf` exists at all — it pre-draws each picture at its
  on-screen crop and swaps the bitmap in. But it SKIPPED a `data:` src as
  "already inline", and every picture that matters is a data URL: the WebShed
  plans, the shed's cover render, every condition photo. So the one class of
  image it was written to rescue was the one class it never touched, and a 16:9
  render was squashed into a 3:1 band on every PDF the app has ever made —
  roofing quotes too. A data URL is skipped only where `object-fit` has nothing
  to say; the baked bitmap is marked `object-fit:fill` **!important** (an inline
  style loses to an `!important` rule, and the print layers set `object-fit` on
  these very images, so without the flag the crop was fitted a second time);
  a `contain` bake fills the box with the nearest painted background first,
  because a JPEG has no alpha and the bars would otherwise come out BLACK; and
  the bake runs at the CAPTURE SCALE, or a picture is quietly halved in
  resolution on its way through.
  A SHEET MILLIMETRE IS 5.24 CSS PIXELS, NOT 3.78. The modern capture lays out
  at `QP_PDF_MODERN_W` (1100px) across a 210mm sheet, so a rule written in CSS
  `mm` inside it names a length 26% shorter than the millimetres it says — the
  first pass at this gave the shed's drawings a "104mm" band that came out 75mm
  on the paper. `QP_PDF_PX_PER_MM` and `QP_PDF_SHEET_PX` (1508px = the 288mm a
  sheet has once `QP_PDF_FOOT_MM` is taken off) are what anything sized against
  the sheet is worked out from.
  A BOX IS NOT A SHAPE. The first fix only said `contain`, which letterboxes a
  drawing inside whatever box it is given — and the box was a fixed band, so the
  floor plan printed small with white down both sides and a white strip under
  it. Each drawing now takes the full width of its card and whatever height its
  own shape asks for (`.ps-draw-img`, capped at 660px ≈ 126mm so the two still
  land on one sheet), and `.ps-draw-wrap` hugs it so a portrait elevation is
  mounted rather than floating in a white field with its label off to one side.
  The selector carries `.qd-sec` and `:not(.qd-logo)` to out-specify the
  catch-all `.qd-sec img{max-height:80mm}` rule, which otherwise wins on
  specificity whatever the pole-shed rules say — that cap is also what held the
  cover band's render down to 302px while the band itself was 905.
  A COVER IS A PAGE, NOT A PARAGRAPH. The shed's cover is a 330px band and a
  title block, about 150mm of a 288mm sheet, and the slicer starts the next
  chapter on a fresh sheet — so the rest of sheet 1 was white. `_psPdfFitCover`
  grows the band (shed only, `PS_PDF_HERO_MIN/MAX`, restored the moment the
  capture is over) until the next chapter starts 18px short of the sheet. The
  render is CONTAINED on its navy ground rather than cropped to a shape nobody
  chose — the drawings' rule applied to the picture the customer sees first —
  and the office's own drag/zoom still moves it inside the band.
  A CHAPTER BAND BLEEDS ABOVE ITS OWN SECTION (23px), so `_pdfBreakRows` cutting
  at the section's top edge landed INSIDE the band: a navy sliver with its cyan
  rule stranded at the foot of three sheets out of four. `push` takes the
  topmost painted edge (the band's own top) and lifts by 1 rather than 8 when it
  finds one — there is no white gap to aim for, because the band is painted over
  the last 8px of the card above it, and lifting further clipped that card's
  bottom border onto the next sheet. Raising the lift is NOT the fix; the bleed
  is whatever the band's margin says. `.ps-spec-row` and `.ps-draw-wrap` joined
  the row candidates at the same time.
  Measured, not reasoned: the whole pipeline runs in a scratch harness with
  html2canvas and jsPDF off `npm pack` (the CDN is blocked here) against a
  static server (a `file://` origin taints the canvas and `rowInk` throws), and
  the PDF goes through `pdftoppm`. Sheets went from 90/64/76/56% full with
  stretched pictures to 91/96/97/73% with true ones. `tests/poleshed.mjs` (213)
  — against the old build the eight fault pins fail and the safety pins pass.
  THE PICTURE'S OWN SHAPE IS THE FLOOR, THE SHEET IS THE CEILING (2026-10-21).
  The 2026-10-20 band grew to fill sheet one and the render was `contain`ed
  inside it, which stops a squash but buys it with navy bars: a 16:9 render in
  a band two-thirds of a sheet tall is a picture with a third of a sheet of
  nothing above it. `_psPdfFitCover` now takes `max(PS_PDF_HERO_MIN, the
  render's own aspect at the band's width, min(PS_PDF_HERO_MAX, what it takes
  to reach the foot of the sheet))` — so the band is never SHORTER than the
  render's shape (no bars, no crop, no squash) and otherwise as tall as the
  sheet allows. On the test shed that is a 905px band carrying a 584px render
  with a navy header above it and the title block below, and a cover sheet
  78% full instead of 56%. A FIX TRIED AND DROPPED: iterating the fit three
  times does nothing, because the `PS_PDF_HERO_MAX` clamp is what binds.
  AND A DRAWING IS NEVER SLICED (`breaks.keep`): `_pdfBreakRows` records each
  `.ps-draw-wrap` as a SPAN, not a boundary, and `_pdfAddSlicedCanvas` — as
  its LAST step, after the section and row searches have already chosen a cut
  — pulls the cut back to the top of any span the cut would land inside,
  provided the whole span fits on a sheet. Promoting `.ps-draw-wrap` to a
  section boundary instead was tried and cost a whole extra sheet: every
  drawing then started its own 58%-full page.
- A CROSSED-OUT ROOF IS CROSSED OUT, NOT THE HOUSE BESIDE IT (feedback report
  66, 2026-10-19: "quotes red cross is confusing, it crosses out part of the
  main roof which looks wrong, it should be a smaller cross in the middle of
  roof 2 keeping within the lines"). The cross was drawn corner to corner of
  the excluded roof's BOUNDING BOX, in two renderers — `_qpRoofMapSvg` and the
  Job Pack's own canvas map — so on a garage standing against a house its arms
  ran straight across the house, and two excluded roofs crossed each other.
  `_roofCrossSvg(cx, cy, size, w)` draws it as the TICK'S COUNTERPART: the
  same size, the same place above the roof's own label, white-haloed the same
  way, and never wider than a third of the roof's short span
  (`_roofShortSpan`), so a long thin lean-to gets a small cross rather than one
  spilling off both ends. `tests/quotepdf.mjs`.
- THE CUSTOMER'S PDF BREAKS WHERE THE PAGE DOES (2026-10-19, the owner on
  quote 3305: "also fix the pdf print still not looking great"). Three faults
  in the one file, all in `_pdfAddSlicedCanvas` and all now pinned in
  `tests/quotepdf.mjs`, which drives the real slicer over a built canvas with
  a recording stand-in for jsPDF — jsPDF and html2canvas come off a CDN the
  test environment cannot reach, and what is worth pinning is the arithmetic.
  THE PAGE NUMBER WAS STAMPED ON THE QUOTE. The slice image was placed 0→297mm
  and "3 of 5" written at 292mm, so it landed on the Marley Classic gutter row
  on one sheet and on "valid for 30 days" on the next. `opts.footMm`
  (`QP_PDF_FOOT_MM` = 9) shortens the usable band and nothing else; the A4
  path, which passes four arguments, is untouched.
  A CARD WAS SLICED IN HALF. Hunting for the whitest row is guesswork on a
  dense page. The page knows its own boundaries — `[data-qd-sec]` for a
  section, `.qb-opt` and friends for a row — so `_pdfBreakRows` collects them
  and the slicer prefers the deepest section boundary past 58% of the sheet,
  then the deepest row boundary past 78%, and only then the old ink search.
  MEASURED IN THE CLONE, WHICH IS THE WHOLE TRICK: html2canvas rasterises a
  COPY in its own iframe, and that copy does not lay out to the same height as
  the live page — 5621.8 CSS px on screen against 5755 in the capture on this
  quote, 2.4%, which by the foot of the document is a whole row of colour
  swatches. Scaling screen coordinates by the canvas's WIDTH ratio therefore
  drifts further out of place the further down you go: the same fault as the
  clipped PDF of 2026-10-13, a capture whose canvas comes from one measurement
  and whose layout comes from another. So `_pdfBreakRows` runs from
  html2canvas's own `onclone`, on the cloned document, where the only
  conversion left is the capture scale. Not reachable → `_qpPdfBreaks` stays
  null and the ink search carries on as before.
  AND IT ENDED ON A BLANK PAGE, carrying one stray border line. A final strip
  under 30% of a sheet whose sampled rows are over seven-eighths blank is
  dropped. Sampled ROWS, not an ink total: one full-width rule would swamp a
  count.
  Page 4 of the fixture still reads 68% full, and that is the honest trade —
  the review section is 203mm tall, so breaking before it is the only clean
  place. The owner's "bunch it up a bit more" (2026-10-13) was about EVERY
  section buying a sheet of air, not about one page in five.
  NOT A BUG, and worth saying so because it looks like one: the review page's
  aerial comes out as a slanted parallelogram with white wedges in two
  corners. That is the canvas view reproduced exactly — the office rotated the
  photo, the map frame on that page is wider than the rotated picture covers,
  and `_qpRoofMapSvg` has reproduced the office's own framing on purpose since
  2026-09-24. Measured against page 2's map of the same roof, which is fine.
- A NUMBER TYPED INTO A CUSTOM LINE GOES IN THE ORDER IT IS TYPED (2026-10-19,
  the owner: "I start typing a 5, and then it jumps to the front, so when I
  type in a 5 and then a 0, it shows up as a 05 … 0005"). `_qCustomLiveRerender`
  rebuilds the owning card 280 ms after the last keystroke and puts the focus
  back — and it tried to put the caret back with `selectionStart` /
  `setSelectionRange`, which CHROME DOES NOT SUPPORT ON `<input type=number>`:
  selectionStart reads null and setSelectionRange is ignored, both measured.
  So nothing was restored and `focus()` alone parks the caret at position 0,
  and the next digit landed in front of the last. Re-assigning the value of a
  focused box parks the caret at its end, which is where somebody typing a
  price is; telling the box it is `type=text` to place the caret properly does
  NOT survive the switch back (measured too). Only the custom lines were
  affected — the material table's own $/unit boxes are `onchange`, so they
  never re-render mid-word. `tests/gutterprice.mjs` types a 5 and three
  noughts with a real keyboard, each past the beat; against the old build the
  box reads "5".
- THE EDIT DESCRIPTION WINDOW IS THREE TIDY GROUPS (2026-10-19, the owner:
  "tidy up this edit description window, it's very untidy"). Each of the three
  lists was its own `flex:1 1 auto; overflow-y:auto` box, so the modal had
  three scrollbars fighting over one height, and `.qdesc-sub` carried no
  horizontal padding at all — "Exclusions" and "Notes" sat hard against the
  left edge while every input beside them was inset 14px, with the
  explanation running on after the heading in the same line. One `.qdesc-body`
  scrolls now; each list is a `.qdesc-grp` card with its heading, its
  explanation on its own line under it (`.qdesc-sub span{display:block}`) and
  its own `.qdesc-add` at its foot; the footer keeps Reset, Cancel and Save.
  `tests/quotewording.mjs` pins the one scroller, the three groups and the
  heading's alignment with the boxes beside it.
- THE EXTERNAL BRACKET'S RATE IS ON THE GUTTER PRODUCT (2026-10-19, the owner:
  "internal and external brackets are saying the same price, can you add in a
  specific cost in the settings gutter profiles for the added price/lm for
  external brackets"). The column was already there — Settings → Quote's
  Product Options → Gutter profiles → Ext bracket $/lm — and he had typed
  6 / 3 / 3 into it. But `_bracketExtPerLm` let the three SHIPPED products jump
  the queue to a pair of Default Items boxes (`ext_bracket_box125_lm` /
  `_marley_lm`), and those save as 0 on any account that has ever pressed Save
  on that page. So the typed rate was honoured for a product the office had
  added itself and ignored for the three it actually quotes, and the customer
  was offered external brackets at no charge. TWO BOXES FOR ONE NUMBER was the
  fault underneath, the same drift "the three pricing tabs each say what they
  are" warns about: the row wins now for every product, the old price-book
  keys stay readable as the fallback for a selectables list saved before the
  column existed, and the two duplicate inputs are gone — with
  `_pbGutKeep` giving the stored figure back on a save so a missing box cannot
  write a 0 over what an older account still falls back to. Everything
  downstream was already wired (`_selBracketExtDelta` → the summary,
  `_qpCardDeltas.bracketExt` → the option card, `_profitSelectionItems`'
  `brackets` row → the Pricing tab), so one read fixed all three.
  AND THE QUOTE WORKS THE UPGRADE OUT BY ITSELF (2026-10-19, same morning: "i
  want seperate gutter spacing per gutter type, (by default 125mm box gutter
  should have a default of 800mm + 1 per run, then Marley tpyhoon and classic
  should have default of 450mm spacing + 1 per run) also add in the cost on
  internal brackets and external brackets so the quote options automatically
  knows the difference"). A GUTTER'S BRACKETS ARE THE GUTTER'S BUSINESS:
  `bracketSpacingMm`, `bracketStartPerRun`, `bracketIntEa` and `bracketExtEa`
  are columns on each `selectables.gutters` row, read through
  `_gutterBracketCfg(id)` / `_gutterBracketCount(id, lm, lines)` (= `ceil(lm /
  spacing) + startPerRun × max(1, runs)`), and `GUTTER_BRACKET_DEFAULTS` is
  what a row that does not say falls back to — 800 mm + 1/run on the box
  gutter, 450 mm + 1/run on both Marleys. A BLANK BOX IS THE STANDARD, never
  0: `_selEdit` DELETES the key rather than storing a 0, or emptying the
  spacing would bracket a gutter at nothing and emptying a price would call a
  bracket free. The default is the box's PLACEHOLDER, not its value, so there
  is one source of truth and the table still reads "800" in grey.
  `_bracketExtTotal(id, lm, lines)` holds the two honest models, in this
  order: both brackets priced each → the real difference × the real count
  (on an ITEMISED product the internal price always resolves from the book, so
  an external price alone is enough); otherwise the flat `Ext $/lm`, which is
  the ONLY honest answer where the brackets are inside the gutter's own $/lm
  — the box gutter's $21/lm includes them, so there is no internal cost to
  subtract and an external price ALONE is deliberately ignored there. A
  difference of nothing or less is nothing: an external bracket cheaper than
  an internal one is a slip in a box, not a discount to offer.
  `_gutterBracketIntEa(id)` reads a figure typed on THIS job's card first,
  then the row, and only then `gutterUnitPrices` and the price book — the row
  ABOVE the snapshot on purpose, because that snapshot is rebuilt from the
  book on every recalc and would otherwise beat the row on the next keystroke
  (the `gutterPriceTyped` trap); the snapshot is still read, because the
  customer's copy has no price book. Once the pair is priced the itemised row
  is renamed to "internal brackets" — the shipped Typhoon wording says
  external because that is the only bracket it ever had a price for, and
  leaving it would have the quote built on the upgrade it is offering.
  `_qpBuildPriced` had no `lines` local and now takes one; the per-run
  brackets are counted per RUN, so the metres alone cannot answer.
  THIS MOVED LIVE PRICES, and only these: Typhoon and Classic went from a flat
  500 mm to 450 mm + 1 per run, so 30 m over two runs is 69 brackets where it
  was 60. `pricegold` was regenerated and the moved set VERIFIED FIRST —
  `marley_typhoon` and `marley_classic` only, and only where the office has
  not overridden the gutter's total. No box-gutter quote moves, and a sent or
  accepted quote is frozen. Check the moved set before regenerating that
  baseline; the key's 5th field is the gutter.
  `tests/matordering.mjs`, `tests/gutterprice.mjs`.
- SETTINGS → MATERIAL CALCULATIONS (2026-10-19, the owner: "add in a settings tab
  called 'Material Ordering' with a sub-tab called wastage, where is shows the
  wastage amount applied to every flashing type … then another sub-tab called
  'Consumables' where the user can adjust the the default calculation for how
  many rolls of paper is requires, how many screws are required …"). Every
  allowance in the take-off was a constant in the code, so a roofer who buys
  9 m flashing, or runs screws at ten a square, had no way to say so.
  `price_book.ordering` holds them — inside the price book because that is the
  jsonb the settings save already carries (`__materials_catalog` rides there
  too) and a new column is a migration for a page of numbers.
  WASTAGE is per flashing type (`ORD_WASTE_KEYS`: ridge, valley, barge, apron,
  change-of-pitch), three figures each — wastage per run, splits over, lap per
  join — read by `_ordWaste(key)` and consumed by `_flashWaste(lens, total,
  typeKey)`, which is the engine the priced take-off and the supplier order
  both come through. CONSUMABLES is `_ordCons()`: underlay waste %, screws per
  m² and the box they round up to, the rivet box and the metres of flashing it
  covers, and spare pipe flashings per size. The gutter bracket spacing and
  starting count were here for one day and moved onto the gutter PRODUCT on
  2026-10-19 (see the external-bracket bullet) — one shared figure cannot be
  right for a steel box gutter at 800 mm and a PVC spouting at 450; the row
  left on the page says where they went.
  EVERY DEFAULT IS WHAT THE CODE ALREADY DID, to the decimal — 0.5 / 8 / 0.1,
  20%, 8 per m² rounded to 100, a box of 100 rivets per 60 lm and 0 spares
  — so no job reprices and no order
  changes until somebody types in the page. A BLANK BOX IS THE STANDARD, never
  0: `_ordNum` falls through on a cleared field, and `_ordCollect` writes only
  what was typed, so a figure RoofMap later improves still reaches an account
  that never touched it. A 0 where something is divided by is floored
  (`screwsRound`, `rivetPack`), and a save made with the
  page never opened leaves the store alone (`_ordCollect` returns on no boxes)
  — the price book's own rule.
  FOUR HAND-COPIES OF THE SAME ARITHMETIC, found by grepping for the
  constants rather than trusting the one call site: the screw, rivet and
  underlay formulas were written out again in the quote's own material cost
  breakdown, the Job Pack's consumables card (`_jpRenderConsumablesSection`),
  the supplier order (`_matRenderConsumables`) and the printed consumables
  strip — so a page that reached only the priced take-off would have had the
  office reading 8 per m² on the pack beside 10 on the quote, with the "incl.
  20% waste" label hard-coded beside an area that had moved. All of them go
  through `_ordCons()` now and `tests/matordering.mjs` drives the two
  renderers and reads their text. The `autosaveJob` lesson in a different
  coat: grep for the ghost, not the symptom.
  NOT WIRED, and worth saying so rather than leaving it to be found: the Job
  Pack's CUT LIST has a second allowance of its own (`_MAT_FLASHING_SPECS[]
  .waste`, 0.5 m on a ridge and 0.4 m on everything else, added per PIECE).
  That is the length you cut to rather than the length you order, the two have
  disagreed since long before this page, and unifying them moves either every
  order or every price — so the Wastage page says in a footnote that it does
  not set it. The owner's call. The pole shed's estimator keeps its own
  underlay and screw rates too (`_shedEstimate`'s `R`), deliberately: a
  different costing model, not the roofing take-off.
  `tests/matordering.mjs` is a tripwire — against the old build the bracket
  pins fail with the owner's own symptom and the ordering pins cannot run.
  RENAMED AND FLATTENED 2026-10-20 (the owner: "Change wording of 'materials
  ordering' to 'material calculations' and remove the two buttons that switch
  between wastage and consumables and put them all in the one line (with
  seperate headers)"). The tab reads MATERIAL CALCULATIONS and the two sub-tab
  buttons are gone: Wastage and Consumables are two `.set-sec` tiles down the
  one page, each under its own navy band, so neither can be the hidden one.
  `_ordSub` and `localStorage.fr_ord_sub` went with them. The panel's id stays
  `set-ordering` and the store stays `price_book.ordering` — renaming either
  would strand every account's typed figures for a change of wording. The
  signup question's "Auto-calculated material ordering" is NOT this page and is
  left alone (`INTERESTS` in server.js, pinned by `tests/signup.mjs` and
  `register.mjs`), and so is the setup guide's own "Material ordering" step.

- THE OFFICE HEARS EVERY ANSWER FROM THE SERVER (2026-10-19, the owner on
  three live jobs: "i didn't get an email to say job #3320 was declined, i
  should get an email" … "when a quote gets accepted like it just was for job
  #3305, i didn't recieve an acceptance email"). Three holes in `POST
  /q/:token/event`, all the same shape — the office's notification was not the
  server's job.
  A DECLINE SENT NOTHING AT ALL. The `declined` branch set a status and
  stopped, so a no only ever showed on the Home board, where it waits for
  somebody to look. `_declineNotify` emails it (`DECLINE_EMAIL_DEFAULT`,
  Settings → Email → "Quote declined", keys `decline_on` / `_subject` /
  `_body` / `_to` / `_cc`), names the customer and what the quote was worth
  (`_acceptVars` falls back to `share.sentTotal`, since a declined quote has
  no `accepted` block), replies to the customer, and raises a `comms_tasks`
  row for today. Switching the EMAIL off does not switch the TASK off.
  AN ACCEPTANCE DEPENDED ON THE CUSTOMER'S PHONE. The office email was only
  ever sent by a SECOND call the customer's browser makes to
  `/q/:token/accept-email` after rendering the quote to a PDF with html2canvas
  and jsPDF off a CDN. On a phone, a long quote, a slow link, or a tab closed
  on the thank-you screen that call never happens — and nothing noticed,
  because the accept had already answered 200. That is job 3305.
  `_acceptOfficeNotify(job, quote, attachment)` is now a function with THREE
  callers: that route (with the PDF, when it arrives), `_acceptOfficeSoon`
  (a 90 s timer — `ACCEPT_OFFICE_GRACE_MS` — long enough for the PDF to land,
  short enough that a roofer hears about a yes while the kettle is on), and
  `_officeOwedSweep` hourly (a restart inside that window, or a provider that
  was refusing; `POST /admin/office-owed/run`), FLOORED at
  `ACCEPT_OFFICE_FROM` (default 2026-10-20, the ship date). That floor is not
  a nicety: `acceptOfficeAt` is a NEW stamp, so on the first run every
  acceptance in the 14-day window reads as "never told" — including the ones
  whose email went out perfectly well from the customer's browser — and the
  sweep would have sent the office a fortnight of duplicate "Quote accepted"
  emails. A worse first impression of the fix than the bug it fixes. Pinned in
  both directions by two fixtures either side of the floor. `share.acceptOfficeAt` is the claim that keeps it
  to ONE email, written by `_shareStamp`, which uses the cheap `jsonb_set`
  path when there is a pg pool and `_saveQuoteBack` when there is not —
  `_saveShareBack` returns SILENTLY with no direct pool, and a claim that is
  never written is a claim that never stops the second email.
  A QUESTION'S ATTACHMENT COULD SINK IT. `_termsFilesFor` was awaited INSIDE
  the `_dispatchMail` arguments, so a failure there threw before the mail was
  handed over, and the function's own catch turned that into a `console.warn`
  nobody reads. It has its own try now, and every one of these notifiers
  reports through `recordError` instead of a warn — including
  `_notifyNoRecipient`, because nowhere to send it is a real fault, not a
  quiet skip. BE ACCURATE: the question path itself WORKS and is pinned
  passing on the old build too, so job 3303's missing email was environmental
  (his settings, the terms lookup, or the provider at that moment) and this
  does not claim to have found it — it makes the next one say so.
  `tests/custevents.mjs` is a real tripwire: against the old build 12 of 23
  pins fail and every safety pin passes.
- A SETTINGS SAVE NEVER READS AN UNFILLED FORM (2026-10-25, job 3334: "Aidan
  accepted job 3334 but it froze and i didn't get the acceptance email"). THE
  REAL CAUSE OF EVERY MISSING OFFICE EMAIL SINCE ~8 OCT, including 3305's and
  3303's (which were put down to the customer's phone and "environmental"):
  `saveSettings` → `collectSettingsFromUI` reads the WHOLE Settings form, which
  is filled only when the Settings tab is opened (`refreshSettingsUI`), and some
  twenty callers save Settings from elsewhere — a price saved as the default on
  the Pricing tab, Save as template, the condition wording, a profile or gutter
  picture, the accreditation logos. On a session that had not opened Settings
  first, each read an EMPTY form: every "Send this email automatically" box
  unticked → `accept_office_on`, `accept_cust_on`, `question_on`,
  `decline_on` all saved FALSE in one write (the server's blank guard keeps the
  ADDRESSES, not a false), the follow-up switch off, and the branding words
  blank (which is also why the setup wizard once met the owner over his own
  logo). Found by booting the app and saving from Map Roof — a probe, not a
  theory. `window.__settingsUiFilled` is set at the END of `refreshSettingsUI`
  and cleared whenever `loadSettings` replaces S.settings; the collector fills
  an unfilled form from S.settings first (a round trip that changes nothing),
  and reads nothing if it still cannot — unless the office is on the Settings
  tab. `tests/settingssave.mjs` (UI; 4 of its pins fail on the old build).
  THE ROWS ALREADY WRITTEN ARE REPAIRED ONCE: `_emailSwitchRepairOnce` (45 s
  after boot, marker `repair:email_switches:20261025` in `platform_state`,
  written BEFORE anything is touched; also `POST /admin/email-switch-repair/run`)
  deletes the three switches from any row where all three read false — nobody
  turns those off together — and `decline_on` with them; then the office-owed
  sweep sends the acceptance emails they held back over the fortnight
  (`acceptOfficeAt` was never stamped on them; `_acceptOfficeCatchUp` now counts
  a switched-off notify as not sent). NOT repaired, and the owner was told to
  check: the follow-up switch (`reminder_enabled`, false by default, so
  unknowable) and any branding words a save blanked. `tests/emailswitch.mjs`.
  THE CUSTOMER'S FREEZE was the background PDF copy of the acceptance: on a
  modern quote it puts `#qpPdfVeil` over the page, and a capture that never
  comes back (pdf libs off a CDN, a six-roof quote, a phone's canvas limit)
  left it there for ever — the acceptance itself was already recorded. Every
  capture registers its own undo (`_pdfAbortReg`; both builders' restores run
  ONCE now), `_pdfAbortNow` runs it from outside, the veil offers "Continue to
  my quote" after 8 s (`_pdfVeilEscape`, `QP_VEIL_ESCAPE_MS`), and
  `_emailAcceptedQuoteToOffice` gives the capture 25 s (`QP_ACCEPT_PDF_MAX_MS`)
  before abandoning it and posting accept-email without the PDF. The veil now
  says "Your acceptance is recorded ✓" — it was "Recording your acceptance…",
  after the fact.
- TWO STRUCTURAL GUARDS ASSERT A SHAPE, SO A REFACTOR TRIPS THEM (2026-10-19,
  learned the expensive way: a red main skipped the promote on both ships
  behind it).
  `tests/sharetoken.mjs` read the `/q/:token/accept-email` route's SOURCE and
  asserted `QUOTE_LINK_EXPIRED` appeared before `_dispatchMail`. Moving the
  send into `_acceptOfficeNotify` left the guard perfectly in place and the
  pin failing on `indexOf` returning -1. It now asserts the guard sits ahead
  of whichever of `_acceptOfficeNotify` / `_fergusOnAccept` / `_dispatchMail`
  are present, so the next move does not break it.
  `tests/crosstenant.mjs` greps each authenticated `:param` route's body for
  `_scopeCompany|_scopeInvoices|company_id`, so a route that delegates its
  scoped read to a helper reads as UNSCOPED. That one was RIGHT to complain:
  `_jobForCaller` was reading the row and checking it in JS afterwards, which
  is one early return away from a leak. It uses `_scopeCompany` in the QUERY
  now. Do that rather than satisfy the regex with a comment.
  AND RUN `node floodroofing/tests/run.mjs api` BEFORE A SERVER SHIP - it is
  the exact command CI's Backend job runs, 58 suites in 38 seconds. Picking
  affected suites by hand is what missed both of these.
- THE CORRESPONDENCE ON A JOB (2026-10-19, the owner: "i should get an email
  saying that on job #3303 that dot bolous asked a question, show the question
  and let me reply to them directly in Gmail, also keep history of that reply
  inside roofmap so i can see the correspondence"). He asked for both halves
  and chose both: reply in RoofMap now, the Gmail half when the mailbox is
  connected.
  `job_messages` is its OWN table, not a field on the quote, for three reasons
  worth keeping: the quote is rewritten wholesale by every save; the customer
  is SERVED the quote, and `_customerQuoteView`'s strip list only applies once
  a quote carries sell prices, so an older one would have leaked the office's
  words; and `msg_id` / `in_reply_to` are what a Gmail reply pulled in later
  threads onto. `_jobMessageAdd` never throws into a caller — losing a line of
  history must not cost the email that carries it.
  EVERY MESSAGE CARRIES A MESSAGE-ID WE CHOSE (`_newMessageId`,
  `<rm-q<job>-<rand>@roofmap.co.nz>`), because that is the only thread handle
  an emailed conversation has. `_questionNotify` stamps one on the outgoing
  notification and stores it beside the question, so the office's own Gmail
  reply quotes it in In-Reply-To and can be matched to the job whenever the
  mailbox is connected — nothing more is needed on that side than reading it.
  `_dispatchMail` takes `messageId` and `inReplyTo` and passes them to Resend
  as headers; the GOOGLE RELAY cannot set one at all, which is exactly why the
  id is STORED rather than only put on the wire.
  `GET /jobs/:id/messages` and `POST /jobs/:id/messages` are both scoped
  through `_jobForCaller` BEFORE anything is read or written — a thread names a
  customer and quotes their words. The reply is emailed to `share.sentTo`, in
  the same subject and thread as the question, from the company's name with
  replies coming back to the office. THE HISTORY IS KEPT EVEN WHEN THE EMAIL
  FAILS and says so on the row (`via: 'not-sent'`, shown in red): a reply the
  office typed is the record of what they meant to say, and losing it because a
  provider was down is the worse of the two failures.
  The office opens it from the Question row on the Home board — where he sees
  one — with `event.stopPropagation()` on the button, or the row's own onclick
  opens the job underneath it. `tests/custevents.mjs` (37) pins the server,
  `tests/sentboard.mjs` (16) drives the whole round trip against the real
  server: the customer asks through `/q/:token/event`, the board offers Reply,
  the reply goes out and comes back in the thread.
  THE REPLY LEAVES AS THE ROOFER, COPIES IN WHOEVER WROTE IT, AND QUOTES
  THE QUESTION (2026-10-23, the owner on job 3303: "i can't see it sent or
  where and how it was sent, it should CC the users email in ... showing the
  customers question and the users answer"). His reply to Dot went out as
  `"Flood Roofing" <support@roofmap.co.nz>`: the route passed `fromName` and
  no `fromAddress`, so Resend fell back to the PLATFORM address — quote
  3305's fault on a second route — with nobody copied in and the answer on
  its own. It now reads its identity through `_mailIdentityOf` (the quote
  send's narrow, loud read), sends from `_tenantSendAddress` with the
  office's `sender_local`, CCs the person who pressed Send (`req.user.email`)
  beside `question_cc` and `copy_all`, and puts the customer's latest
  question above the answer ("Your question" / "Our answer", text and HTML).
  `job_messages.mail_from` / `mail_to` / `mail_cc` (boot migration; the GET
  falls back to the old columns if they are not there yet) keep where it
  went, and the window prints "Emailed to … / Copy to … / From …" under each
  reply. A reply sent before this carries none of that and shows none.
  `tests/sendername.mjs` pins the From line against a fake Resend (4 of its
  new pins fail on the old route, reading support@roofmap.co.nz),
  `custevents.mjs` the CC and the quoted question, `sentboard.mjs` the window.
  ANSWERED FROM GMAIL, AND FOLLOWED BACK (2026-10-23, the owner: "the user
  should be able to reply to the question in their email (mine being Gmail)
  to the customers email address ... if the customer wishes to reply it'll
  reply as an email, those email communications should also appear in RoofMap
  inside the jobs communications"). The question email to the office carries
  the job's details (quote, customer with email and phone, address, sent
  total), the question word for word, Reply-To = the customer and "Reply to
  this email to answer Dot directly", so a plain Reply in Gmail answers them
  from office@. `_jobLinkMail(acct, msgs, folder)` runs in every inbox sync
  (`_inboxSyncAccount`, every 3 min) on the INBOX and — new — the mailbox's
  SENT folder (`fetchNew(conn, pass, lastUid, 'SENT')`, the special-use
  \Sent box, `last_uid.SENT`): a message whose In-Reply-To / References name
  a `job_messages.msg_id` of the account's company joins that job's thread
  (SENT or from the account's own address = office, else customer;
  `via: 'email'`; the quoted history under it cut off by `_mailQuotedCut`), its
  own id stored so the chain carries on. Resend may rewrite a Message-ID, so a
  "Re:" message to or from a job's `share.sentTo` with that job's quote number
  in the subject is matched too — only on a job that has a customer question.
  Never another company's job, never twice (dedupe on msg_id per job). The
  inbox thread gets the `job_id`. IT NEEDS THE MAILBOX CONNECTED: the Inbox is
  `requirePlan('inbox', …, 'Business')` and office@floodroofing.co.nz must be
  connected in Settings → Inbox; `GET /jobs/:id/messages` answers
  `inbox: {connected, emails}` and the window says which. `tests/jobmail.mjs`
  (19, in the API list) plays the whole round trip.
  THE WINDOW IS "HISTORY & COMMUNICATIONS" (the old Job history,
  `#jobHistModal`): Communications first (`#jobHistComms`, the thread through
  `_convoRender(list, target, client)`, `_jhcLoad`, a reply box `_jhcSend`),
  then the Job timeline. THE LEFT MENU (the same message) reads Save job,
  Change job, the lock strip, then `#navJobHistBtn` "🗂 History &
  Communications" (shown with the job's other buttons by `_jobLockRender`,
  a count of the thread's messages once it has been read).
  `tests/jobhistory.mjs` pins the order and the window.
- FILES & PHOTOS ON A JOB (2026-10-27, the owner: "add a 'Files & Photos'
  button below the history and communications button, allow the user to add
  in photo's or files from their computer ... actually open the files from
  within roofmap ... everytime the user exports a pdf or anything, that file
  should automatically also save in the files and photos on that job
  (including a sent job pack, or sent quote ...) ... this button should also
  load any files and photos from fergus if fergus is connnected. then change
  the colour of this new button and the history button to be the same blue as
  'change job' and then put the 'unlocked/locked' button at the bottom").
  THE LEFT MENU: Save job, Change job, History & Communications, Files &
  Photos (`#navJobFilesBtn`, a count once read), then the lock strip — the
  all five the lock strip's grey (2026-10-28, "grey colour the save job and change job too"), class `.nav-job-btn`, words on the left, half-transparent blue under the pointer and solid blue pressed; the tabs (`.nav-btn`) half-transparent navy under the pointer and solid navy pressed or open (2026-10-29, the owner). `tests/jobhistory.mjs` pins the order.
  THE BYTES NEVER GO IN THE JOB ROW (that is how the database stalled in
  September): a private Storage bucket 'job-files' (`_jfStorage()`, the
  tender's `tender/storage.js` made generic: `create(supabase, {bucket,
  seam})`, seam `__TEST_JOBFILES_STORAGE`), a `job_files` row each (boot DDL;
  company_id, user_id, job_id = the version ROOT so every version shares its
  files, name, mime, size, kind 'upload'|'export', source, author,
  storage_path, status 'pending'|'ready'). Routes, each scoped with
  `_scopeCompany` IN THE QUERY: GET /jobs/:id/files, POST …/files/sign (the
  browser PUTs straight to Storage), POST …/files/:fid/landed, GET
  …/files/:fid/url (15 min), DELETE …/files/:fid. A failed read is a 503.
  THE APP: `_jobFilesOpen` — Exported & sent from RoofMap (with the note the
  owner asked for: it only holds what RoofMap exported or sent), Your
  uploads, Site photos on the quote and Kept on the job (`S.photos` /
  `S.files`, the in-row store that predates this, unchanged), From Fergus
  (`/fergus-files/list`, all files, opened through `_fergusDownloadBlob`).
  A file OPENS INSIDE ROOFMAP (`_jfViewer`): picture, PDF in a frame, CSV /
  text as text, else a download — fetched to a blob first, which always
  frames. `_jfKeep(blob, name, source)` is the one call every export and
  send makes (never throws, never asks; nothing for a job never saved, the
  sample job or the customer): `_matDownloadBlob` (every Job Pack / pricing
  / order / Fergus-push file, with a source), the modern quote's Print/PDF,
  Save Job Pack as PDF, Print Job Pack, the pricing CSV, the order email and
  share, and THE SENT QUOTE — `_jfKeepQuotePdf('sent-quote')` builds the
  Sent version's PDF 1.2 s after the send has switched to it.
  `tests/jobfilesapi.mjs` (API), `tests/jobfilesui.mjs` (UI); the older
  `tests/jobfiles.mjs` is the in-row files and is untouched.
- AN ACCEPTANCE REACHES THE FERGUS JOB (2026-10-19, the owner: "can it auto
  automatically upload the accepted quote as it's pdf to the job in fergus,
  can it also add the customers choices … as the job description in fergus
  automatically"). BOTH HALVES ALREADY EXISTED and neither was wired to an
  acceptance: `/fergus-job/description` and `/fergus-files/upload` are
  `requireAuth` routes the OFFICE's browser calls, and a customer accepting has
  no login. `_fergusOnAccept(jobId, attachment)` is the server doing it with
  the company's own key (`_fergusKeyFor({companyId, user})`, no `req`), reached
  from `/q/:token/accept-email` (where the customer's browser has just handed
  over the PDF, so that is the only place the file can come from) and from
  `_acceptOfficeCatchUp`, which writes the DESCRIPTION whether or not the email
  is still owed. The hourly `_officeOwedSweep` retries the description half too,
  but only on a share that actually carries `fergus.jobId` — otherwise every
  acceptance would cost a read an hour for a fortnight for nothing.
  WHY IT MATTERS, beyond the ask: the description written at the office's push
  is the quote AS PUSHED, the roofer's recommended picks, so after an
  acceptance it is out of date on the one question the crew opens the job to
  answer. `_fergusJobSummaryText` takes `extra.full` now, which swaps
  `_quoteSelectionLines` for `_quoteChoiceLines` — the office's own options,
  the extra roofs they took and the priced options as well — and
  `_fergusUpdateJobDescription` already keeps the customer's own words above
  its marked block.
  IT RE-READS THE JOB ITSELF rather than trusting the copy it is handed:
  `_fergusAutoVersionNow` is on a 45 s debounce and writes the same share, so a
  claim decided from a stale copy is a claim that can be made twice — and a
  second attachment on a Fergus job is not something anybody can undo from
  here. `share.fergusAcceptDescAt` / `fergusAcceptFileAt` are the claims and
  `share.fergusAccept` keeps what Fergus answered, the publish and mark-sent
  discipline: read it off the saved job rather than guessing.
  The attachment upload uses global `fetch` directly (multipart), NOT the
  `__TEST_HTTPS` seam, so `tests/custevents.mjs` stubs both — the seam for the
  job read and the description PATCH, a `fetch` wrapper for the upload.

- A CUSTOMER ACCEPTS THE PRICES THE QUOTE STILL CARRIES (2026-10-25, job 3334:
  "Aidan agreed to $34,231.35, fix the accepted total"). The acceptance
  recorded $35,252.82 — the figure the customer's BROWSER reported — while the
  quote read $34,231.35. The acceptance email gave it away: it lists his extra
  roofs at the prices his page used ($1,497.33 / $908.51 / $1,173.01 ×2,
  `acceptedOptions` from `quote.extraRoofs`), and the quote now reads them at
  $1,400.21 / $819.64 / $1,084.14 (`share.priced.extraRoof`). The customer's
  page prices everything from `share.priced` as it was when the page OPENED,
  and the office re-stamps that block on every Quote-tab autosave
  (`_qStampCustomerCopy`) — including, until now, AFTER an acceptance. Whether
  his page was opened before a re-price or the quote was re-priced after he
  accepted cannot be told from here; both doors are shut:
  the customer's accept sends `pricedFp` (`_qpPricedFp` in app.html,
  `_pricedFp` in server.js — sorted-key JSON, FNV-1a, the two MUST give the
  same string) and the server refuses an acceptance made on a block it no
  longer holds (409 `QUOTE_CHANGED`; the page says so and reloads). A page
  from before sends none and is not checked. And an accepted quote is never
  re-priced: `_qStampCustomerCopy` returns on `S.quote.accepted`, and
  `_keepCustomerState` keeps the stored `share.priced` and `sentTotal` on a
  save that has seen the acceptance (Undo acceptance clears `accepted`, so it
  passes). The LINE ITEMS can still move under an accepted quote — the OPEN
  AND URGENT item below is unchanged.
  3334 ITSELF: `ACCEPTED_TOTAL_FIXES` in server.js, run 50 s after boot and by
  `POST /admin/accepted-total-fixes/run` — matched on number, customer AND
  address, acting only while the stored total is still the wrong one (so no
  marker), keeping `accepted.totalCorrected {from, to, at, why}`, setting the
  frozen Accepted copy's total too, and re-writing the Fergus description.
  The office emails already sent still say $35,252.82. `tests/acceptstale.mjs`.
- THE CUSTOMER'S PICKS ARE THE QUOTE'S OWN PRODUCTS (2026-10-30, job 3338:
  "I added color coat MagnaFlow as a steel grade option. The customer selected
  that MagnaFlow, but then the confirmation quote acceptance email still says
  color steel ... the choice between corrugate and fiber rib isn't showing").
  THREE HOLES. The accept handler's allow-list knew only the four built-in
  grades, two profiles and four gutters, so a grade, profile or gutter the
  office ADDED was dropped and the job kept the office's recommended pick; it
  now also takes every id the quote carries (`_quoteProductIds`: the priced
  block's keys, `selectablesSnapshot`, `customProfiles`). The email named
  picks from a fixed word list (`QUOTE_SELECTION_LABELS`); `_quoteSelectionLines`
  reads the quote's own names first (`_quoteProductName`, priced `*Label` then
  the snapshot) and lists the grade and PROFILE even when the customer never
  touched them (`baseGrade` / `baseProfile` / the first profile). And
  `_customerSelections` never SENT `extras` (the office's own options) or a
  gutters job's `gutterColour`, which the server had always taken. JOB 3338
  ITSELF: `ACCEPTED_PICK_FIXES` (55 s after boot, `POST /admin/accepted-pick-
  fixes/run`), acting only while it still reads MAXAM: MagnaFlow + Corrugate in
  the job and the frozen Accepted copy, a "Corrected:" office email
  (`_acceptOfficeNotify(…, {corrected})`) and the Fergus description rewritten.
  THE FERGUS VERSION PUSHED ON ACCEPT CARRIES THE ACCEPTED PRICE (the same day:
  "the latest quote version that was pushed automatically, totals to around
  59,000"): `_fergusAutoVersionNow` did run, but priced the dropped MAXAM and
  `_fergusSelectionChanges` knew nothing of the included Extras — $62,920.95
  less both is the $59,044.57 he saw. The extras are an "Extras" section now
  (ahead of the word-matching rules, so "Flaxpod Downpipes" is not filed under
  Downpipes); an accepted version whose total misses `accepted.total` by over
  $1 is recorded (`plan.auto.mismatch`, recordError); and the 3338 repair
  pushes a fresh accepted version (v4) at the accepted price, voiding the old.
  `tests/custevents.mjs` (51), `tests/inclextras.mjs`.
- AN EMAILED TOKEN LANDS ON /app, NEVER THE ROOT (2026-10-22, a customer's
  reply to his own reset email, forwarded by the owner — tyler@tgmroofing
  .co.nz: "This keeps just taking me back to the home page"). `/auth/forgot`
  linked `/?reset=<token>` and the team invite `/?invite=<token>`, and the
  root has served the LANDING PAGE since the app moved to `/app` — Vercel's
  rewrite sent `/` to app.html only when the query carried `q` (the customer
  quote link), so a reset or invite token opened the marketing home page,
  whose own forwarder read `?q` alone, and the app that reads `_p.get('reset')`
  never loaded. Every password reset and every team invite had been dead
  since that move; the verify link was fine because it already said `/app?`.
  THREE PLACES, and all three are needed: server.js sends `/app?reset=` and
  `/app?invite=` (the shape `verify` always used); `vercel.json` rewrites
  `/?reset=` and `/?invite=` to app.html AHEAD of the plain `/` rule, exactly
  as `/?q=` is, so a link already in somebody's inbox works the moment Vercel
  deploys — the server half waits on Railway and a reset link only lives 30
  minutes; and `landing.html`'s head forwarder names `reset` and `invite`
  beside `q`, for a landing page a browser has cached. `tests/seo.mjs` pins
  the three rewrites in order and the forwarder, `tests/security.mjs` the two
  links in the server source, `tests/teamapi.mjs` the invite link's shape.
- THE NEXT JOB NEVER WEARS THE LAST ONE'S QUOTE (2026-10-12, the owner:
  Phyllis's job open, chose another job, "Job 3287 already exists" against
  Beth Williamson's). `restoreFromJob` does `Object.assign(S, snap.state)`,
  which only overwrites the keys the INCOMING job HAS — so a job saved with
  no `quote` block kept the last job's whole quote: client, totals and its
  `ref`. The server derives a job's number from `draw_state.state.quote.ref`
  (and the jobs list reads `job_no` straight off it), so every autosave then
  tried to CREATE a second record under the PREVIOUS job's number and was
  refused with DUPLICATE_JOB_NO, over and over. The refusal was right; the
  carry-over was the bug. `S.quote` is reset to `defaultQuote()` immediately
  BEFORE that assign — exactly like the picture, the files, the struck-off
  flashings and every other leak already fixed on those lines — so a job
  carrying a quote gets its own back on the next line and one carrying none
  starts clean. `tests/jobbgleak.mjs`.

## A CUSTOMER'S ACCEPTANCE IS THE SERVER'S TO KEEP (2026-10-02, job 3288)

The customer accepted at 3:20 pm NZ on 1 October; at 3:28 pm an office screen
still holding the pre-acceptance quote published it (`PUT /jobs/:id/quote`,
which had no check), and the acceptance, the customer's picks, events and the
frozen Accepted copy were wiped. `_keepCustomerState(req, jobId, inQ)` now runs
on BOTH quote writes (`PUT /jobs/:id` and `PUT /jobs/:id/quote`): if the
stored share is `accepted` and the incoming copy does not carry that
acceptance's frozen copy (`versions.accepted.id`), the acceptance,
`proposalOptions`, `versions.accepted` (+ its media) and the share status are
put back and the response says `keptAcceptance` (the app shows
`_keptAcceptanceNotice` with Reopen the job). Undo acceptance and a new draft
after an acceptance keep the frozen copy, so they pass. Customer events are
always unioned; an opened/queried/declined status is not knocked back to sent
by a copy that has not seen it; a different token is left alone. A read
failure refuses the write (503). `tests/acceptguard.mjs`.

Same job: Paint Roof (an office option, `selectables.extras`) was added in
Settings on another screen two minutes before the send, and the sending screen
stamped the customer's copy from its OLD product list — no Paint Roof, so the
customer never saw it and accepted $3,364.45. `_ensureCustomerLink` now runs
`_qFreshProductsForSend()` first (GET /settings → selectables + price_book);
if that moves the total from what the screen showed, NOTHING is sent and both
figures are named. A Settings save in another tab reaches open tabs (the
`storage` event on `fr_settings`), and a tab coming back after 2+ minutes
re-reads the products (`visibilitychange`). The email window passes the job
lock (typing, ✕, Send — `#quoteEmailModal` in `_lockClickAllowed` and the
beforeinput/change guards), and opening it from the frozen Sent/Accepted view
goes back to the working quote quietly (`_qvBackToDraft({stayLocked:true})`)
— a re-send never asks to make a draft. Saved drafts carry a ✕
(`_qvDeleteDraft`). `tests/sendfresh.mjs`.

THE GATE FOR ALL OF IT: `tests/sendexact.mjs` runs the REAL server
(fakepgrst) with the office app and the customer's page both routed to it:
a quote with an office option picked as recommended, a job-only profile, a
hidden grade, a page taken out, its own title/description/exclusions/summary,
sent the real way (Email quote → Send) — then the customer's page must show
the same sections, options, picks, recommendations, words, summary and total
TO THE CENT; the job must keep `versions.sent` ("Sent quote") and, after the
customer accepts, `versions.accepted` ("Accepted quote") beside it; a stale
office save must not wipe the acceptance; and the office reopening the job
sees both, marked. Extend THIS suite whenever a new kind of customisation is
added to the quote.

## OPEN AND URGENT — an accepted quote's figures still move

The owner, 2026-09-30: "an accepted quote must never ever change, no matter
what updates or fixes are made — the quote $ numbers and selections must
never change after the customer has accepted it." Job 3270 was accepted at
$22,506.39 and the office opened it reading $23,223.94.

THE MECHANISM IS KNOWN. On an accepted quote `_qpPriced()` correctly hands
back the frozen `share.priced` block, so the selection DELTAS are frozen —
but `_qpBaseSub()` (27323) reads `quoteSubtotal()`, the LIVE line items. So
re-pricing the job moves the base under the acceptance: 3270's re-roof line
alone went from $16,081.61 to $19,115.56.

DO NOT simply return the frozen base from `_qpBaseSub()`. That was tried and
reverted: these are not display-only functions. `_qpBuildPriced()` (27123)
reads `_qpBaseSub()` into `share.priced.base`, and `_qStampCustomerCopy` runs
it before EVERY autosave on the Quote tab; `_custBarTotalValue` (31795) feeds
`share.sentTotal` (29022). Overriding either wrote the acceptance's own
figures into the job's line items — `tests/quoteversions.mjs` "opening a saved
draft brings it back as the working draft" caught a $1,000 acceptance total
appearing in the lines. Whatever the fix is, it has to separate what is SHOWN
from what is STAMPED, and that suite is the tripwire.

The likeliest right shape: when a job whose quote has been accepted is
opened, put the ACCEPTED VERSION on screen (`_qvView('accepted')`, 28231 —
existing, tested machinery that locks the job and swaps in the frozen quote)
rather than the working draft, and leave the pricing functions alone.


## Four things that have been broken twice

**The roof engine.** `buildHipValleyLines` runs a real straight skeleton, then
`_skelSnapRectilinear` tidies it: welds junctions the solver left a few pixels
apart, closes an apex where two hips meet and nothing carries on, collapses a
line doubling back on itself, and lets a narrow link's roof die into the face
of a wider wing instead of climbing to its ridge. Do NOT add a shortcut that
returns before the solver — one was added to fix H shapes and it broke every
L, T and U in production. `buildRectilinearRoofLines` survives on the GABLE
path only, where the sheet-layout gate depends on it. `tests/roofreal.mjs`
pins four outlines taken from real feedback reports, structurally: nothing
outside the building, nothing stopping in mid-air, no open apex, no kink,
every ridge level or plumb.

**The drawing scale.** (CLICK A MEASUREMENT TO CORRECT THE SCALE,
2026-09-24: in Scaled edits, typing a line's real length — a wall pill, an
interior line's popup, the line editor, a sheet length via its barge — goes
through `_rescaleFromMeasure(line, m)`: metres per IMAGE pixel = typed ÷
(pixel length × the line's slope factor). NO POINT OF THE DRAWING MOVES; every
roof's measures are recomputed. A value within 6 mm of what it already reads
changes nothing. The wall-stretching solvers (`_applyTrueEdgeMeasure`,
`_applySegmentTrueMeasure`) remain but no click reaches them. The Measure and
Calibrate buttons are gone; "📏 Set scale" (`#btn-calibrate`, `#ttbCal`) shows
only while there is NO scale. `tests/report57.mjs`, `tests/roofpanel.mjs`. WIDENED 2026-09-28: EVERY
measurement corrects the scale, not just a gutter — `_scaleFromDrawn(px, f,
typed, refA, refB)` is the one place it happens and `_rescaleFromMeasure`
(any line) and `_rescaleFromSheetRun` (a sheet measure) both go through it.
A sheet run used to correct the scale only by borrowing a BARGE off that
run, so a gable face worked and a HIP face — which has no rake — fell
through to a label-only override that marked the map off scale; the run's
own plan length does the same job, and the canvas hit now carries it
(`runPx`, which `_bargesForSheetRun`'s short-return guard was also reading
as undefined).)
THE ROOF PANEL (`#roofTypePanel`, 2026-09-24) is one row — shape, Rotate 90°,
Snap square, pitch, sheet (`#roofSheetType`, per roof), ★ Make main roof,
Delete roof — no "Suggested" line. Roof numbers: `_roofRemap(mapFn)` moves
EVERYTHING kept by roof index (modes, labour, labour calc, manual flags,
scaffold, buffer/mark-up by roof, job-pack pick, cut-list freezes,
back-tray/box-flashing keys, pricing tab) and the main roof's job-wide slots
(S.quote.labour hours, S.quote.scaffold, legacy buffer/mark-up); `deleteRoof`
and `makeMainRoof` use it, with `_roofExtraSelByRoof/_roofExtraSelRestore` for
the customer's optional-roof picks. ROTATE IMAGE is its own slider
(`#rotImgWrap`), fine controls in `#rotImgFine` (Done / click-away).
(LINZ, 2026-09-24: the aerial finder defaults to LINZ
Basemaps "aerial" — NZ's own photography, CC BY 4.0 — when the server has
`LINZ_BASEMAPS_KEY` (served by `GET /imagery-config` when the finder opens,
never on page load, never in the playground; `/health.features.linz`).
Google's tile terms forbid tracing buildings off its imagery, so it is not an
option. "Use this view" STITCHES LINZ tiles (`_linzStitch`) into exactly the
Mapbox static picture's geometry — same centre, zoom, bearing, W×H — so the
scale stays `_autoScaleFromAerial(lat, z, true)`; empty or failing tiles
fall back to Mapbox; the "© LINZ CC BY 4.0" credit is stamped into the
picture. `tests/aeriallinz.mjs`.
NEARMAP, built 2026-09-24 and SWITCHED OFF (`NEARMAP_ON = false` in app.html):
a company's own key (`jms_keys.nearmap`, Settings → General row
`#setNearmapRow`, hidden while off) makes "Use this view" ask Nearmap's
coverage API first (`_nearmapCoverage`), stitch that survey's tiles
(`_nearmapTileUrl`, `_tileStitch`) where it has flown, else LINZ, else
Mapbox. Switch on ONLY together with privacy.html v1.2 naming Nearmap in
section 5 — the policy promises 30 days' notice by email for a new
provider — and add Nearmap to `tests/legal.mjs` PROCESSORS then. The server
keeps a jms_keys key a save does not mention (`ferguskey.mjs`).
`tests/aerialnearmap.mjs` runs with `window.__NEARMAP_ON`.) `DRAW.scaleMetresPerPx` is metres per IMAGE pixel. The
canvas size and `DRAW.zoom` have nothing to do with it. Dividing by how large
the photo happens to be drawn makes every measurement move when the roofer
zooms — the same roof read 1.86m at 490% and 2.95m at 310%, on live quotes.
The aerial's own Mapbox zoom does change it, and must.
THE SCALE BAR, though, is drawn in SCREEN pixels, so it divides by `t.s`
(`getImgTransform()`) and does follow the zoom — it did not until 2026-10-06,
so it was out by exactly the zoom, which after an aerial capture starts at
AERIAL_PAD and is never 1. It picks the roundest length that lands between 70
and 200 px (100 mm to a kilometre) instead of a fixed 10 m that was simply not
drawn when it did not fit. `tests/canvassetup.mjs` reads it off the canvas.
A STITCHED AERIAL (LINZ, Nearmap) IS NOT THE SAME THING AS ITS SCALE
(2026-10-06, feedback reports 7 and 8). Two faults, both measured rather than
reasoned — stitch a picture from tiles coloured by `(x+y)` parity and read the
seam spacing off its centre row (`tests/aeriallinz.mjs` does exactly this now;
the stub tiles had to become real 256×256 ones, because a 1×1 PNG blown up to
a tile leaves the rasteriser nothing to resample and the seams then snap to a
64-pixel grid):
  1. `_stitchTileZoom` was `z + 1`. Mapbox serves 512px tiles, so its zoom z is
     256-tile zoom z+1 — right for a CSS pixel, and the picture is asked for
     @2x, which is one level again: `z + 2`. At z+1 the picture covered twice
     the ground per pixel that the scale beside it claimed, so EVERY length
     measured off a LINZ aerial read half its true size and every area a
     quarter. Mapbox's own static pictures were never affected, and LINZ is the
     default in New Zealand, so this was most roofs here. k is unchanged by the
     fix (both Zf and Z move a level), so the tile count per picture is too.
  2. The canvas transform was handed absolute world pixels (`translate(-cx,
     -cy)`, tiles drawn at `t.x*256`). A canvas matrix is kept in 32-bit
     FLOATS, and at tile zoom 21 world pixels are around 5×10⁸, where a float's
     steps are 64 whole pixels — so every tile was rounded onto a 64-pixel grid
     and landed up to 32 px, about 2 m of ground, out of line with the tile
     beside it. Seams measured 256 and 320 apart where all of them should have
     been 265. The transform now holds the picture's own numbers only and each
     tile is drawn at its offset from the centre, worked out in doubles.
     Anything that puts a world coordinate into a canvas transform has this
     bug; keep them small.
A JOB TRACED BEFORE 2026-10-06 ON A LINZ AERIAL STILL READS HALF. The stored
scale and `geoScale` are unchanged by the fix — only new pictures are right —
so such a job is corrected by clicking any measurement and typing the real
length (`_rescaleFromMeasure`), or by capturing the aerial again.

**Publishing a quote in Fergus.** The quote pushed at send arrives as a
Draft and `_fergusPublishQuote(key, quoteId, jobId)` then tries the
publish shapes in `FERGUS_PUBLISH_CANDIDATES` ("METHOD /path"; pin the
right one in `FERGUS_QUOTE_PUBLISH_PATH` once known). Then it is MARKED
SENT (2026-09-22, `_fergusMarkQuoteSent`, `FERGUS_MARK_SENT_CANDIDATES`,
pin `FERGUS_QUOTE_MARK_SENT_PATH`; the real call, from Fergus's partner API
spec on 2026-09-24, is `POST /jobs/quotes/{id}/markAsSent` with
`{isSent:true}` → 204, first in the list — none of the eight guesses before
it was right, which is why published quotes never showed as sent; `markSent:true` on
`/fergus-quote/publish`, and always on the customer-selection versions)
so the job stops saying "Quote has not been sent to customer" — marked,
never emailed: no `/send` or `/email` shape is tried, the quote is read
back and only a status reading Sent/Accepted counts (`_fergusQuoteStatusOf
().sent`), and `share.fergus.sentResult` keeps every attempt. Two rules, both
learned the hard way: NEVER a `/send` shape (that is Fergus emailing the
customer its own copy; the owner sends from RoofMap), and a 2xx is NOT a
publish — the quote is READ BACK (`_fergusReadQuoteStatus`) and only a
status no longer Draft counts; a 2xx that changed nothing moves on to the
next shape and the office is told "still a draft in Fergus — publish it
there by hand". `share.fergus.publishResult` (and `plan.auto.publishResult`
for the customer-selection versions) keeps every attempt and what Fergus
reported, so read that off the saved job before guessing.
`tests/fergusauto.mjs`. The Fergus API docs are unreachable from the build
sandbox (egress blocked), so the true publish path must come from a real
job's `publishResult`.

**Believing one API call.** Twice now a working Fergus link has reported
itself dead because a single request failed: the connection test asks for the
jobs list sorted and paged, and not every partner account answers that query
string. It falls back through plainer requests now — but NOT on 401/403,
where a rejected key must fail on the first call rather than be hammered.
`tests/fergstale.mjs` pins both that and the stale job-mapping recovery.

**The cut list.** Three feedback reports in a row (50, 51, 52) were the
same fault in different clothes: rows re-derived from the roof on every
render, with the office's edits re-attached by each row's original length.
Any re-render that shuffled the rows (a tab switch before the map had
drawn, the bump-out splitter peeling or not, a label matched to a different
row) put a typed quantity on a different row and lost rows. The freeze above
is the fix; the splitter and value-matcher in `_jpBuildSheetRowsAuto` still
run for an untouched list, and the feedback report now carries the whole
cut-list state (`cutList` in `_roofGeometryPayload`) — read that before
guessing.

## Diagnosing a subscriber's integration

Settings → "Something not working?" runs the probes support would run by
hand. It emails the report to support AND offers it as a PDF
(`POST /jms/diagnostic.pdf`, written by a small Courier-only PDF writer in
server.js — no library, deliberately). The report carries the API key's
LENGTH and never the key; keep it that way, `tests/jmsdiag.mjs` pins it. Ask
the owner for that PDF before guessing at a Fergus fault.

## Where things stand — 2026-10-21

Rewrite this section as it is dealt with; a stale list here is worse than
none. Everything below the handover line has been read and either folded
into Conventions or dropped as spent.

**Live now.** FRONTEND and BACKEND = `afe2348` (the left menu's job buttons all grey and centred; a duplicated draft says on the Quote tab how much less it comes to than the quote emailed, with Keep the sent prices; 2026-10-29 8:42 am NZ, promote run 40756495946: backend "Live after 40s"). Before it FRONTEND = `0223665` (the roof window replaces the roof settings drop-down, live shape changes; a duplicated quote keeps its products; As sent vs today in the Pricing drawer; 2026-10-29 7:41 am NZ, Tests run 40746568843 green, promote run 40747190582: "The site is serving 0223665", backend step red reading `c1e1ca4` — `git diff c1e1ca4..0223665 -- floodroofing/backend/` is EMPTY, so the API runs the same code under the older name). BACKEND = `c1e1ca4`. Before it FRONTEND and BACKEND = `c1e1ca4` (a new paying subscriber emails the owner, the daily report says when each started paying; 2026-10-29 6:14 am NZ, Tests run 40732295139 green, promote run 40733008859: site serving, backend "Live after 300s"). Before it FRONTEND and BACKEND = `bae28d6` (feedback reports 78/79: a bump on a hip roof is Hip & valley or Mono extension, switched on the corner pad, a drag never changes it; a corner grab takes the nearest corner; 2026-10-28 4:54 pm NZ, Tests run 40628178495 green on its second attempt after one `hubui` dark-theme-reload check flaked on shard 2 — the hub is untouched by it and the suite passes 104/104 locally — promote run 40629240702: site serving, backend "Live after 40s"). Before it FRONTEND and BACKEND = `e5f3aeb` (the Gutters only job type with Marley Typhoon's own colour chart; 2026-10-28 4:31 pm NZ, Tests run 40626663912 green, promote run 40627066699: site serving, backend "Live after 40s"). Before it FRONTEND and BACKEND = `c3e0ddb` (the product list — gutter and profile pictures, own grades, own options — and the custom email wording survive a reload and a stale tab's save; a sent job stays locked when the Draft is picked from the Viewing menu; 2026-10-28 1:47 pm NZ, promote run 40610866433: site serving, backend "Live after 40s". Its first ship `c189d61` was skipped on a `quotedrafts` timing pin, fixed in `c3e0ddb`). Before it FRONTEND and BACKEND = `bf97a41` (Files & Photos on every job: uploads and every RoofMap export or send kept in the private `job-files` bucket, Fergus files listed, opened inside RoofMap; the left menu Save, Change job, History & Communications, Files & Photos, then the lock; 2026-10-27 10:45 am NZ, Tests run 40588732990 green, promote run 40589303351: site serving, backend "Live after 40s"). Before it `d8a63be` (Scott's pricing CSV: the site address, Custom Price Book items tagged Material join the materials at cost with the job's buffer and mark-up, the rest an "Other lines on the quote" block with its own total; 2026-10-27 10:33 am NZ). Before it FRONTEND = `4cd5ff7` (the sheet layout shows only the colour-coded key over the picture, its chips painted exactly as the sheets are; the hips snap to 45° as a ridge junction slides, `685db36`; the roof settings panel folds after 1.5 s, `4402f73`; 2026-10-27 3:44 pm NZ, Tests run 40439237945 green, promote run 40440098891 green, READY Vercel production deployments carrying the SHA). Before it FRONTEND and BACKEND = `df67204` (the Job Pack's page 1 carries the sheet layout and the layout is the count, the calc check withdrawn, the maps in the owner's order, the roof colour section deletes; feedback report 77, the double cascade, 75 → 69 sheets; rule 8b, a nick at the gutter end is not a cut; rule 8c, the closer carries the longest row — report 76 176 sheets with nothing extra; 2026-10-27 12:38 pm NZ on the owner's "go live on everything", Tests run 40420663514 green, promote run 40421101209: site serving, backend "Live after 40s"; the local full gate 284/285, the one red `tenderapi` failing identically on clean main in the container while main's CI ran it green). Before it FRONTEND = `cb397d5` (the sheet layout of feedback reports 70–76 and 50: the bigger block is the rectangle, a wing before the main's hip end cut from that end's strips, the main keeps its sheets under the wing's far hip, the hip-cap corner; every label starts at the gutter, the corner triangles labelled, the number only with no length; 2026-10-27 10:11 am NZ on the owner's "go live", Tests run 40401137222 green, promote run 40401727845 green on both halves, two READY Vercel production deployments carrying the SHA). Before it FRONTEND and BACKEND = `e756176` (three plans — Business off sale, Team carries the inbox and domain, Measure gains merchant orders; no founding 30%; new trials are 3 real roofs or 30 days; the trial funnel on the analytics page; 2026-10-23 9:29 pm NZ, promote run 39924909749: site serving, backend "Live after 40s"). Before it FRONTEND = `22bbfda` (an L's two valley tails feed each other on gable roofs, a valley tail laid from its point or its barge by efficiency, the two-from-one-sheet pairing withdrawn; report 20: 48 → 47 sheets; 2026-10-23 7:49 pm NZ on the owner's "go live", Tests run 39913358244 green, promote run 39913759918 green, two READY Vercel production deployments carrying the SHA — sheet-plan.js only, so Vercel's list is the proof). BACKEND = `9de484c`, unchanged by it. Before it `9de484c` (the gable + hip & valley L and the step-down apron, feedback reports 17-20; 2026-10-23 7:10 pm NZ, Tests run 39909423842 green, promote run 39909805794: site serving, backend "Live after 60s"). Before it `2b4d6ed` (the sheet layout work that was held on the branch, now shipped on the owner's go: the dutch corners laid as complements, bigger sheet numbers, no face badges, and the gable + hip & valley T at 72 via `swapPass`; 2026-10-23 2:08 pm NZ, Tests run 39881285733 green, promote run 39881688648: site serving and backend "Live after 60s", two READY Vercel production deployments carrying the SHA). Before it `b38b21f` (AI Tendering Phase 1 — a third job type, on ONLY for the owner's three logins via `TENDERING_USERS`, see `docs/ai-tendering/DECISIONS.md`; Roof and Pole Shed unchanged, `tests/typesnap.mjs` holds them to the cent; 2026-10-23 1:06 pm NZ, promote run 39875572053: site serving, backend "Live after 220s"). Before it `d3cef74` (a customer's question
answered from Gmail and followed back onto the job, the History &
Communications window, the left menu reordered; 2026-10-23 10:19 am NZ, promote
run 39856153437: "The site is serving" and "Live after 40s" on the backend —
RAILWAY IS DEPLOYING AGAIN since 9:19 am NZ). Before it `cc65eb6` (a reply to a
customer's question leaves as the roofer, copies the user in and quotes the
question, 9:53 am NZ). HELD ON THE SESSION BRANCH, NOT LIVE: the dutch corners
laid as complements (plain dutch 64, no offcut left over), bigger sheet numbers
and the face badges taken off — the owner asked to see pictures before any
sheet-layout change goes live (2026-10-23: "send me the sheet layout diagram
picture for me to confirm before you go ahead and push it live"), has the
pictures, and has not yet said go. Before that, FRONTEND = `5507b98` (a dutch gablet is ordered whole across
its gutter and its hip offcuts feed the slopes' corners — plain dutch 68,
dutch L 82, dutch T 90; 2026-10-23 8:25 am NZ; sheet-plan.js only, so the
proof is Vercel's two READY production deployments carrying that SHA;
Tests run 39837442876 green first time, slow only because two shards took
9+ minutes to download Chromium). Before it `b1b3200` (password-reset and invite links open
the app, not the landing page — the vercel.json rewrite is what makes links
already in inboxes work; 2026-10-22 9:33 pm NZ; app.html untouched, so the
proof is Vercel's two READY production deployments carrying that SHA, Tests
run 39747212752 green first time). Its server half (`/app?reset=` links,
`_mailIdentityOf` from c54ac58) waits on Railway with everything since
`fcaab9a`. Before it `8a7f392` (the dutch gablet feeds itself from its
own short sheets, the hip T at 74; 2026-10-22 8:57 pm NZ; sheet-plan.js
only, so the proof is Vercel's two READY production deployments carrying
that SHA; Tests run 39742137745 went green on its second attempt after
`quotebook` and `scheduleui` flaked on shard 1 — both pass locally on the
same tree, 92/92 and 83/83, and the diff cannot reach them; one re-run of
the failed shard, not two). Before it `d031790` (the dutch gable, L and T
laid from the gablet's centre line, 8:26 pm NZ; Tests run 39740487454 green,
two READY deployments). Before it `194d4b4` (feedback 67, 68, 69: the pictured
roof-shape picker, the CSV's own sheet per view, the base lines known by a
key, 2026-10-22 4:32 pm NZ; Tests run 39715968496 green; promote run
39716321601's log says "The site is serving 194d4b4", backend step red on
Railway's pause as before; two READY production deployments on Vercel).
Before it `a7764b7` (the sheet layout's one-run series,
the Z's D20 under the wing, 3:35 pm NZ; Tests run 39711708182
green; two READY production deployments carry it on Vercel). Before it
`2f9a59d` (the junction strip's straight cut, D1's offcut at the apex,
3:23 pm NZ; Tests run 39710701159, two READY deployments), and before that
`204b94b` (the offcut series and the pushed-in sheet, 2:47 pm NZ; Tests run
39707359742). Before it `ad51cd1`
(the cookie cutter on every L and the two-wing roof, 1:37 pm NZ; Tests run
39700393231). THE
PROOF IS VERCEL'S OWN RECORD, not the promote log: READY production
deployments carrying the `githubCommitSha` (`list_deployments` with
`target: production`), and they have to be the proof because these ships,
like `4947a46` before them (12:48 pm NZ, verified the same way), changed
`sheet-plan.js` and NOT `app.html` — the promote's frontend step compares
app.html alone, so it passed in one second on a file byte-identical to
12f46b4's and would have said "serving" whether or not the new sheet-plan.js
was up. A ship that
touches only sheet-plan.js / sw.js / help-bot.js is verified by Vercel's
deployment list or by fetching the file itself (this container's proxy
refuses roofmap.co.nz, so the list is the read available here). Before it,
`12f46b4` was verified by promote run 39685318185's own log ("The site is
serving 12f46b4"), `c54ac58` and `8ada6e1` the same way. BACKEND `/health`
still reports `fcaab9a` after FIVE promotes in a row (86bde0a, 8ada6e1,
c54ac58, 12f46b4, 4947a46 each red on the backend step after the full 10
minutes). That is NOT a half-ship in substance for the sheet-layout
commits: `git diff fcaab9a..8ada6e1 -- floodroofing/backend/` is EMPTY, so
the API is running byte-identical server code under an older name — the
same shape as 2026-10-20 below. THE CAUSE IS KNOWN (the owner's screenshot, 2026-10-22
morning NZ): Railway's Deployments tab shows "Limited Access — Deploys have
been paused temporarily", and the banner across the whole Railway dashboard
read "Dashboard and API unavailable, builds paused. We've found the cause and
are working on a fix" — a RAILWAY PLATFORM INCIDENT, not his account (billing
checked: card on file, invoices paid, $1.55 of the $20 included usage) and
not a failed build — there is no deploy entry for either commit at all, and
the running service is healthy (booted 7:58 pm NZ, migrations 161/0, the
sweeps ran, a Stripe checkout completed). So a red backend step with
`/health` stuck on an older build and NO new entry in Deployments means
LOOK AT RAILWAY'S OWN STATUS BANNER / status.railway.com first, then the
workspace billing — not the code or the service settings.
CONFIRMED BY status.railway.com (the owner pasted it, 10:10 am NZ 22 Oct):
"Earlier today an issue affecting multiple systems led us to pause builds
across the platform" — Investigating from 07:24 UTC 21 Oct (8:24 pm NZ),
builds paused in ALL regions, dashboard/API/CLI down for hours, OAuth
sessions invalidated as mitigation, and builds coming back IN STAGES:
Enterprise first (from ~20:30 UTC), then Pro, then Hobby, then Free/Trial —
RoofMap's workspace is not Enterprise, so it waits its turn. Nothing on our
side is wrong and nothing on our side can hurry it.
Once the pause lifts, `production` already carries the commit and Railway
should deploy it by itself; redeploy by hand if it does not. A cloud session
cannot see any of this (the proxy refuses that host). Until the pause lifts
do not report a server change as live on the strength of the promote's
frontend half.
AND THE NEXT SHIP MADE THE HALF-SHIP REAL: `c54ac58` (A QUOTE LEAVES AS THE
ROOFER, another session, 21:05 UTC) changes server.js as well as app.html —
`_mailIdentityOf`, `sender_local`, `GET /email/domain` answering `tenant`.
Its promote (run 39676725083) will verify the FRONTEND and go red on the
backend, and this time the diff is not empty: Vercel serves the new Settings
→ Email "Sent from" box against an API that does not answer `tenant` yet.
Checked, and benign: `_MAILDOM.tenant` falls to null and the box renders
nothing, so the page degrades to what it was. The quote-sending fix itself
(the narrowed identity read) is NOT live until `/health` reads `c54ac58` or
later — a quote sent before then can still go out nameless. Check `/health`
before telling him that one is fixed (it still read fcaab9a on 4947a46's
promote at 12:58 pm NZ 22 Oct). Nothing uncommitted. `tests/sheetlayout.mjs` is at 246; the Big-L is
64 sheets in every orientation, the 10 m wing 62 laid exactly as the owner
marked it, the dutch 64 / dutch L 81 / dutch T 87 with each gablet ordered
whole across its gutter and its hip offcuts feeding the slopes' corners (his
correction, 2026-10-22 evening), and he has the pictures. TOLD HIM WITH THAT
SHIP: a gablet's offcut lands on the slope corner across the END (the north
slope's west corner from the west gablet's south half), because the same
hip would need the sheet flipped. TWO THINGS PUT TO HIM WITH THAT SHIP,
unanswered: the Big-L's 3.52 junction extra is now a 7.73 pushed in at the
apex by his own push rule (same 64, four metres more steel) — say if he
would rather keep the short extra there; and the T went from 78 to 75 under
the same rules after he had called it 95% right.
The sidebar's "Updated h:mm d/m" line says which build a screen is on — ask
for it before believing "it's still broken", because the service worker
serves the old build until the tab is reloaded.

**Where the work happens now.** Most sessions run in a CLOUD LINUX CONTAINER
(claude.ai/code), not on the owner's Windows laptop. In the container:
- There is NO `gh` CLI — GitHub goes through the `mcp__github__*` tools.
- There is NO production database access, and no `C:/Users/OEM/pgtools`.
  Diagnose from feedback reports, the promote log and the owner. The
  read-only query tool (`q.cjs`), the Singapore cutover script and
  `C:\Users\OEM\roofmap-migrate.env` exist ONLY on that laptop; do not
  recreate the secrets file anywhere, and the cutover waits until he is
  back at it.
- Outbound HTTPS is proxied and some hosts are refused, so a live
  `curl https://…/health` may simply fail — that is the proxy, not the site.
- Playwright and Chromium are installed; `npm install` at the repo root and
  in `floodroofing/backend` is what CI does.
On ANY machine, run `git config core.hooksPath .githooks` once or
`tests/buildstamp.mjs` fails the ship. NZ time:
`node -e "console.log(new Date().toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'}))"`.

**Open — needs the owner (Aron). None of these can be checked from a cloud
session, and none has been confirmed done since the date beside it.**
- 2026-10-20, RESOLVED THE SAME DAY and kept for the lesson: Railway appeared
  to have STOPPED taking `production`. `2fed101`'s promote went red on the
  backend step twice — `/health` still reported `896e17b` after 10 and then 20
  minutes — while the frontend verified both times. It did not matter for that
  commit (`git diff 896e17b..2fed101 -- floodroofing/backend/` is EMPTY, so the
  API was running byte-identical server code and the check compares SHAs, not
  behaviour), and the NEXT ship cleared it by itself: `6e02634`'s promote read
  `133d453` on two checks and then "Live after 60s". So it was a slow or queued
  Railway deploy, not a service switched to manual.
  THE LESSON: on a frontend-only ship, diff the backend between the promoted
  SHA and the one `/health` reports BEFORE saying anything is half-shipped — an
  empty diff means the same server code under a different name — and give
  Railway another ship before touching its settings. A cloud session cannot
  check Railway directly: the container's proxy refuses outbound to that host
  (403 on CONNECT), so the promote log is the only read on it.
- 2026-10-02: his own quotes leave as "Flood Roofing <…@roofmap.co.nz>" with
  replies to office@. To send as office@floodroofing.co.nz the Resend entries
  for floodroofing.co.nz must stop reading FAILED — the records go in
  Cloudflare, then Check now in Settings → Email.
- 2026-10-02: job 3288's acceptance (3:20 pm NZ 1 Oct, wiped by a stale
  screen before the guard existed) can only be put back from his acceptance
  email. Its first Sent copy is gone too.
- 2026-09-19: Measure is SOLD but the Stripe prices may still be missing —
  `STRIPE_PRICE_MEASURE` / `_ANNUAL` on Railway. Until they are set a
  customer picking Measure gets a plain error naming the variable;
  `/subscription.offered` says whether it is set.
- 2026-09-19 and still worth doing: rotate the Fergus API token and the
  Railway `ADMIN_TOKEN` — both were readable in shared screenshots.
- Housekeeping, his: SMS/uptime alarm on `/health`; run the restore drill
  once (`tools/restore-check.mjs`); paste the real price book so it can
  become the shipped default; four aerial screenshots for the demo
  slideshow (Mapbox is unreachable from the build environment, so those
  slides are placeholders).
- ANSWERED 2026-10-27: a Custom Price Book item tagged Material, added to a
  job, carries the JOB's buffer and material mark-up, not its own (see A
  PRICE-BOOK MATERIAL IS A MATERIAL). Nearmap stays OFF until privacy.html
  v1.2 names it + 30 days' notice.
- ASKED 2026-10-21, no answer yet — two questions already put to him, so do
  not ask again, just pick them up if he answers (the third, the step-down
  gable's apron, he answered in feedback report 18 on 2026-10-23):
  1. SOAKER TRAYS, Scott's ask relayed by the owner — NOT STARTED, and it
     cannot be until he says how they are priced: per penetration, per metre,
     or a fixed each; and whether a soaker REPLACES the back-tray a
     penetration already brings or sits beside it. Both answers change the
     take-off row, not just a price.
  2. THE SHED'S MODERN COVER still carries a navy strip above the render —
     the deliberate trade in THE PICTURE'S OWN SHAPE IS THE FLOOR. The
     alternative is a 56%-full cover sheet. Offered; he has not said.

**Two platform sweeps, in one shape** (nowhere else in this file): the trial
drip (`_trialDripSweep`, days 1/3/7/12, `subscriptions.trial_drip`, hourly,
`TRIAL_DRIP_ENABLED=false` stops it), the gone-quiet alert to support@
(`_quietTrialSweep`, 3 silent days, once per trial, `quiet_alert_at`, daily)
and the trial-ended email all keep a DB watermark in `platform_state`, MARK
FIRST then send, and have an admin `POST /admin/*/run` to force a pass.
`tests/trialdrip.mjs` pins the timing; the analytics page carries "Why
trials cancelled" from `cancel_feedback`. All three also bail on
`_platformMailboxSendable` — see the UNPROMPTED PLATFORM EMAIL bullet.

**The first-roof walkthrough** (2026-09-16): an account the server marks
`ui_flags.first_roof = 'offer'` lands on Map Roof with the practice job open
— John Smith, 23 Don Buck Road, Massey (`FIRST_ROOF` in app.html, opened
like the sample with `S.demoKind = 'test'`) — and the tour engine runs
`_firstRoofSteps()` as kind `firstroof`: steps complete on `until()`, Next
does `onNext` or skips, `wait: true` parks the card until its popup exists.
The `ONB` arbiter allows one layer at a time; the branding wizard is summoned
by `_brandingBeforeSend(then)` at the first real send, never at sign-in; the
setup guide and 29-step tour are opt-in. `tests/onboarding.mjs` drives it
with imagery blocked. The practice address flies to hard-coded coordinates
(`FIRST_ROOF.lat/lon`, approximate). Measurement: `app_time` carries
`screen`, `screen_left` is sent on hide/close, and `walkthrough` /
`onboarding_path` / `roof_source` / `help_requested` / `output_created` are
allow-listed in `_usageProps` (server.js). Privacy policy v1.1 discloses it.

**One diagnostic worth keeping:** if a 5xx email names `/quote-activity`, it
is an office that never had a good read in that server's lifetime — look at
the query, not the cache (`tests/quotefeedcache.mjs`).

**Audited 2026-10-20, and how to do it again.** This file is read into every
session, so a wrong line here costs more than a missing one. Three mechanical
checks, each a few seconds, and all three were run:
1. EVERY backticked identifier against the tree. 854 named, 0 genuinely dead
   — the only misses were things the text says are gone, API words
   (`workflow_run`, `head_sha`) and `fr3_xeroMonthly`, which is built at
   runtime as `'fr3_' + 'xeroMonthly'` and so cannot be grepped. Do not
   "fix" that one.
2. EVERY `tests/*.mjs` named here against the directory AND against
   `run.mjs`'s two lists. 110 named, all present, all wired. 165 more suites
   exist that this file never mentions — that is the long tail, not a fault.
3. REPEATED 12-WORD PHRASES, to find a rule written out twice. Exactly one
   hit, and it is a deliberate callback. The Conventions section is long
   because the product is, not because it repeats itself — there is no big
   safe cut in it, so do not go looking for one.
What the audit DID find was all in the stale parts: a tab renamed in the code
and not here (four places), a bullet describing a dropdown another bullet said
had been deleted, two bullets for one "Updated …" line, a FIXED item sitting
under a heading that says OPEN AND URGENT, a dead constant quoted as live, a
suite count 47% low, and a 223-line handover describing a Windows laptop this
work no longer runs on. Stale sections rot; the lessons do not. Audit the
dated sections first.

**Product thinking, agreed but not built:** the trial's first twenty minutes
should walk a new roofer to their OWN first quote — address, trace, quote, in
that order — before the schedule or the inbox is mentioned, and should get
their real supplier rates in before that first quote. Lead with measuring and
quoting everywhere a stranger meets the product; the rest is why people stay,
not why they try it.

## Working style

TIMES ARE ALWAYS AUCKLAND TIME. The owner is in Whangarei; whenever a time
is said to him (a promote check, a scheduled reminder, "landed at …",
what time a check will fire), convert it to Pacific/Auckland (NZST is
UTC+12, NZDT is UTC+13 — the switch is the last Sunday of September and
the first Sunday of April) and say it as NZ time, e.g. "10:48 am NZ".
Never quote a UTC time bare; the machine's clock is UTC.

The owner (Aron, office@floodroofing.co.nz) sends batches of fixes/features,
often as phone screenshots. Keep replies tight; ship whole batches through
one gate; report what shipped and what to try, in plain language.
