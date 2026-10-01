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
  (~19 min, ~186 suites four at a time, plus the sheet-layout gate on a full
  run; `JOBS=1` for one at a time), or one by name:
  `node floodroofing/tests/run.mjs inboxui`. A NEW suite must be added to
  the list in `run.mjs` or it never runs. Pipe the runner through `tail` and
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
2. Before fast-forwarding main: run the FULL local suite in the background
   (`node floodroofing/tests/run.mjs`) on a clean committed tree and require
   exit 0. If files changed mid-run, the result is void — re-run clean.
3. Ship with `git push origin HEAD:main` (fast-forward only). Batch several
   commits into one ship when possible.
4. After a green gate the pipeline lands about 10 minutes after the push
   to main (Tests CI ~9 min, promote ~1 min). Schedule the promote check
   for 12 minutes, not 22 — that wait was costing every ship ten minutes.
5. **A ship is not done until the promote workflow is green.** It verifies
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

## Conventions

- The public pages (`landing`, `pricing`, `fergus`, `early-access`, `signup`)
  must agree with the `PLANS` table in server.js about what each tier gets.
  `tests/sitecopy.mjs` pins it; change the table and the pages together.
- Sitemap dates come from git: after committing any public-page change, run
  `node floodroofing/tools/sitemap-dates.mjs` and commit the sitemap before
  the gate. `tests/seo.mjs` fails on a stale date (skipped on shallow clones).
- Every company-scoped table needs `company_id` AND `user_id` from day one —
  `_scopeCompany()` filters on both.
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
  this deployment is office@floodroofing.co.nz — so RoofMap's onboarding
  mail was reaching strangers out of the owner's roofing inbox. All three
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
- EXCLUSIONS on the modern proposal: `S.quote.custExcl` (edited beside
  the inclusions in `_qdescOpen`, kind `'x'`; `_qbExclusionLines`). When
  any exist the two lists get "What's included" / "What's excluded"
  headings and the exclusions a red cross (`.qb-excl-row`); a quote with
  none reads as before. `tests/quotedesk.mjs`.
- THE GUTTER IS GUTTER MATERIAL, NOT ROOFING MATERIAL (2026-09-22): the
  roofing material table no longer carries a Gutter row. A steel or
  Classic gutter is itemised on the Guttering & Downpipes card like the
  Typhoon kit: the spouting $/lm, a bracket every 800 mm
  (`GUTTER_STEEL_BRACKET_SPACING_M`) and a dropper every 8 m, never fewer
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
  between), Default item pricing (`set-defaultpricing`) is the PRICES of
  everything RoofMap measures off the roof, Custom Price Book is the
  supplier's own list that can take over any of those prices. Each opens
  with one line naming the other two — keep those three lines in step when
  anything moves between the tabs. Default item pricing runs in one order:
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
- DEFAULT ITEM PRICING is its own Settings → Pricing sub-tab
  (`set-defaultpricing`, 2026-09-30): the price book block moved out of the
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
  takes its pick with it. Saving the automatic list deletes both fields. Both
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
  the straight gable and the dog-leg. The sheet count does not change (the
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
- The phone's roof plan FOLLOWS the computer's and vice versa
  (`_QP_MAP_PARTNER`: desk↔book, desksum↔booksum) until each has been
  moved itself; only a frame's own `roofMapViews[key]` is ever written.
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
- Sheet counting rule (the owner's, pinned in `tests/report52.mjs`): each
  roof counts its OWN gutter ÷ sheet cover, rounded up from a tenth of a
  sheet (10 m / 0.762 = 13.12 → 14; 13.05 → 13). Overlapping roofs never
  change each other's count. Every count site goes through `_sheetsAcross`.
- The sheet LAYOUT diagram (the tiled cut-plan picture) is HIDDEN from
  users since 2026-09-14 — the owner judged it not right yet. One flag,
  `SHEET_LAYOUT_HIDDEN` in app.html, takes it out of the Maps panel kinds,
  the page types, placed pictures and the legacy print sections; a saved
  page of that type shows a note. The engine still runs underneath, so the
  counts, the cut list, the Sheet calc check and the sheet-layout gate are
  unchanged. Flip the flag to false to bring it back everywhere, and put
  `sheetplan` back into `tests/jpmaps.mjs` and `tests/jpallroofs.mjs` when
  you do. Do not offer the layout diagram to users again without the owner
  looking at screenshots of it first (`tools/sheet-shots.mjs`).
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
  the customer does not, so the block must never promise them one.
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
- Prices by steel grade: the base grade's sheets, flashings and back-trays
  ARE the price book's top-level fields; any other grade's own set lives
  under `price_book.by_grade[id]` and is used only when it has a price in
  it (`_pbGradeHasPrices`) — then `_pbForGrade(_pbGradeInUse())` feeds the
  material rows, `_gradeFactor` is 1 for it, and the customer's grade delta
  is the real difference on the graded rows (`_gradeDeltasSnapshot`, frozen
  onto the quote as `gradeDeltas`). A grade with no prices of its own still
  runs on the percentage from the Products list. `tests/gradeprices.mjs`.

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

Also open from the same evening: switching jobs can leave the PREVIOUS job's
quote in place. The office moved from 3270 to 3228 and every autosave then
tried to CREATE a record whose client was Deb Allen but whose `quote.ref` was
still 3270 — the server derives a job's number from `draw_state.state.quote
.ref` (server.js 2932), so it refused with DUPLICATE_JOB_NO over and over.
The refusal is correct and nothing was corrupted; the carry-over is the bug.

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

## Open at last handover — 2026-09-25 (8:40 am NZ)

Delete or rewrite this section as it is dealt with; a stale list here is
worse than none.

**Where things stand.** Everything is shipped and verified live: main =
`093fc6d`, promoted 8:31 am NZ 2026-09-25 (site byte-identical, `/health`
build matches). Nothing is uncommitted. The working branch was
`claude/pricing-totals-photos`; each batch went branch → PR (the Tests
workflow runs on `pull_request` — that is the Linux gate) → green →
`git push origin <sha>:main` → watch the promote. The Conventions bullets
dated 2026-09-24/25 describe every feature below in detail; read those
before touching them.

**Shipped 2026-09-24/25, watch the first days through it:**
- Quote drafts & templates: Viewing button beside "Change quote
  template"; switching never asks — a worked-on draft is saved first
  (`_qvKeepWorking`, `_qContentFp`); the template editor edits a COPY and
  never the open quote; `_qChangeTemplate` makes a fresh draft.
- Background saving: switching jobs no longer waits (`_jobSaveDetach` +
  `_jobSaveSendDetached`); the working pill ends "✓ Saved h:mm". If an
  office reports a job "lost its last changes" after switching, look here
  first (the device copy is kept on failure; 3 retries).
- Send: the link upload is skipped when the server already holds the quote
  (`__qWritten`), a first send sends the share alone (`PUT
  /jobs/:id/quote-share`); the Sent view waits for the last save.
- Push to Fergus has Cancel on the pill (voids a just-created version).
  Fergus mark-as-sent is `POST /jobs/quotes/{id}/markAsSent {isSent:true}`.
- `/quote-activity` reads through the pg pool (`_quoteShareRowsPg`).
- Custom Price Book (Settings → Pricing): upload CSV/PDF, links to RoofMap
  defaults, server guard + `price_book_revisions`; the price book window
  (`_pbPickOpen`) with folders and a Defaults tab; any material row takes a
  price typed per job; the materials table's edits are now SAVED with the
  job (`state.matOv/matDel`) — they used to leak between jobs.
- Map Roof: Break up ridge (straight gables), report 58 sheet-engine fixes
  (step split in `_sgmSplit`, `_sgmUncoveredGutters`, head-barge edge),
  measuring tape (`DRAW.tapes`), canvas never pinned to a pixel width,
  Fergus photos cached per job, roof image boxes always open, history moved
  into the History popup, outline tool never selects a line.

**Open with the owner (Aron), 2026-09-25:**
- A missing green "1 × 2.78 m" sheet measure on a job pack roof map —
  his screenshots never arrived (twice). Ask for the feedback report from
  that job (it now carries roofType, ridgeBreaks and line flags) and
  reproduce from its geometry. Head barges now carry a measure, which may
  already be the fix.
- Break up ridge was built from his description and one photo: he is to
  check the flashings (head apron + barge + side apron at each end) on the
  real zig-zag roof.
- UNANSWERED: a Custom Price Book line's mark-up is applied to the supplier
  cost and the job's material mark-up still goes ON TOP. Ask whether he
  meant the line's mark-up to REPLACE the job's for that item.
- His price book CSVs are in `C:\Users\OEM\Downloads`:
  `floodroofingpricebook.csv` and `floodroofinggutterpricebook.csv` (24
  Aug, description/unit/price — upload as they are); `Bills_Flood Roofing
  LTD_2026-Aug-24.06.16.42.csv` holds real purchase prices.
- Still his (older, below): LINZ Developer key on Railway as
  `LINZ_BASEMAPS_KEY` (`/health.features.linz` is false until then);
  Nearmap stays off until privacy.html v1.2 + 30 days' notice.

**How the last session worked (keep doing it):** the laptop gate cannot
exit 0 on Windows (dupjobui, signup, restoredrill fail on the timezone), so
run the affected suites locally, then PR → Linux gate. `gh` is at
`/c/Program Files/GitHub CLI/gh.exe` (run from `C:\Users\OEM\roofmap`).
Scripted edits to app.html: write the Python to a FILE (heredocs mangle
`\u`/`\n`/quotes), assert every replacement's count, then
`node floodroofing/tools/check-app-syntax.mjs`. Explore agents are good for
mapping a subsystem before a change. The owner's messages sometimes say
"see attached" with nothing attached — say so rather than guess.

**Shipped 2026-09-22 (promotes 178–182, all verified live), watch the
first day through it:** the database stall of 10:18–10:38 am NZ (autosave
and the send's publish queued multi-MB row rewrites until the statement
timeout cancelled them) is answered by ONE WRITE TO THE JOB AT A TIME and
autosave held during a send (Conventions); the send records the sent
quote BEFORE Fergus and says so when either step fails; a duplicate job
number that is the same job attaches or opens by itself; exclusions on
the proposal; the gutter is gutter material only, with brackets every
800 mm and droppers every 8 m on steel gutters; the grade / profile /
thickness sections carry edit and delete buttons with "Insert … page"
placeholders; the grade and gauge percentages are worked on the raw
material cost. If a send is still slow, the green status line under the
Send button now says where the time went (link vs email) — ask for a
screenshot of that. If a 5xx names `/jobs/:id` with "statement timeout"
again, look for a SECOND writer on the row (another device on the same
job), not the queue.

**Waiting on the owner (Aron), added 2026-09-22:**
- Settings → Price book: set the real Gutter bracket ($/each) and Dropper
  ($/each) — they start at $4.20 and $16.50 as placeholders and every box
  gutter quote carries them.
- Quote's Product Options: retype the increase on the grade added on
  2026-09-22 (it was stored as 100 = +10,000% before the fix).
- Job 3245: press Push to Fergus, then Save job; if Viewing has no "Sent
  quote", pick Save this draft.

**Shipped 2026-09-19 (four promotes, all verified live), watch the first
customer links through it:** the customer quote on a computer is the
one-page layout with the summary rail (`tests/quotedesk.mjs`); the
six-line description with the office's Edit description; the roofer's own
pick is the customer's Recommended choice (stamped at send as
`recommended`); the phone book gained Undecided colour, Ask a question?
up top, the scroll pill and a proposal page that fits. Also: trial emails
HELD until roofmap.co.nz is verified in Resend (still waiting on the
owner); drafts never carry an acceptance and Undo acceptance saves; the
Quote tab bar is one selector + one sentence; the phone's acceptance PDF
captured the book's page before today. If a customer reports a locked or
odd quote, ask which device and whether they reloaded — the service worker
serves the old build until they do.

**Recently shipped 2026-09-18, watch for fallout:** the job pack's roof
pick now follows the quote by default (a job whose extra roofs are still
optional packs the main roof only until the customer adds them — the pills
say so and "Follow the quote instead" is the way back); Settings has a
Guides tab (with the Loom run-through), "Quote's Product Options" carries
the price book with per-grade prices, and "Suppliers" is just suppliers and
flashing types. The practice roof stand-in is the owner's own aerial
(`brand/practice-aerial.jpg`, 1 px = 63.92 mm); the server's practice job
picture still wins when it exists.

**Waiting on the owner (Aron):**
- Measure is SOLD since 2026-09-19 ($79, founding $55.30): the pricing
  page shows four cards (four across, page-scoped grid rule), the JSON-LD
  carries its Offer, the intro reads "$79, $149, $299 or $549", and the
  app's billing screen and plan-gate list it like the others. What is still
  the owner's: create the Stripe prices and set `STRIPE_PRICE_MEASURE` (and
  `_ANNUAL`) on Railway — until then a customer who picks Measure gets the
  server's plain error naming that variable, and `/subscription.offered`
  says whether it is set.
- Rotate the Fergus API token and the Railway `ADMIN_TOKEN` — both were
  readable in screenshots shared during a session.
- Four aerial screenshots for the demo slideshow (Mapbox is unreachable from
  the build environment, so those slides are placeholders): aerial found,
  mid-trace, outline finished, roof lines generated.
- Ring Sharon about the steel grade on quote 3206 before that roof is
  ordered — the acceptance email and the PDF disagreed about which grade was
  standard.
- SMS/uptime alarm on `/health`; run the restore drill once
  (`tools/restore-check.mjs`); add the crews then paste the schedule import;
  paste the real price book so it can become the shipped default.
- Send the customer email about the report 50–52 fixes (drafted 2026-09-14)
  with the "please reload the app" line kept in.

**Trial emails, shipped 2026-09-17 — watch the first fortnight:** the drip
(`_trialDripSweep`: days 1/3/7/12, `subscriptions.trial_drip`, hourly,
`TRIAL_DRIP_ENABLED=false` to stop it), the gone-quiet alert to support@
(`_quietTrialSweep`: 3 silent days, once per trial, `quiet_alert_at`,
daily) and the trial-ended email all share one shape: DB watermark in
`platform_state`, mark first then send, admin `POST /admin/*/run` to force
a pass. `tests/trialdrip.mjs` pins the timing. The analytics page carries
"Why trials cancelled" from `cancel_feedback`. A preview of every email is
generated by the scratch script described in the 2026-09-17 session (drive
the admin endpoints against `fakepgrst` and capture the relay).

**Onboarding, shipped 2026-09-16 — watch the first real accounts through it:**
a new account (server says `ui_flags.first_roof = 'offer'`: no jobs, never
answered) lands on Map Roof with the practice job open — John Smith,
23 Don Buck Road, Massey (`FIRST_ROOF` in app.html, opened like the sample
with `S.demoKind = 'test'`) — and the tour engine runs `_firstRoofSteps()`
as kind `firstroof`: steps complete on `until()`, Next does `onNext` or
skips, `wait: true` parks the card until its popup exists. The `ONB`
arbiter allows one layer at a time; the branding wizard is summoned by
`_brandingBeforeSend(then)` at the first real send, never at sign-in; the
setup guide and 29-step tour are opt-in. `tests/onboarding.mjs` drives the
whole walkthrough with imagery blocked (the labelled fallback picture).
The practice address flies to hard-coded coordinates (`FIRST_ROOF.lat/lon`,
approximate — check the aerial actually shows 23 Don Buck Road and adjust).
Measurement: `app_time` carries `screen`, `screen_left` is sent on hide/
close, `walkthrough`/`onboarding_path`/`roof_source`/`help_requested`/
`output_created` are allow-listed in `_usageProps` (server.js); the daily
report shows where the minutes went, where each person left and how far
the practice job got. Privacy policy v1.1 discloses it — the policy's own
30-day-notice clause means the owner owes subscribers an email about it.

**Being reworked:** the sheet layout diagram is hidden (see Conventions).
Bringing it back means a layout that matches the owner's counting rule
sheet-for-sheet: longest sheets first, that area squared off, then each wing
worked out separately — the calc check already draws that; the tiler does not.

**Recently shipped, watch for fallout:** the ridge-claim takeoff for
hip-and-valley roofs with two or more ridges (`_ridgeClaimSections`, pinned
by `tests/sheetclaim.mjs` on the owner's hand counts: T = 71, staircase =
69, double L = 73); the cut-list freeze; `/quote-activity` serving its last
good feed after a statement timeout (`tests/quotefeedcache.mjs`). If a
5xx email names `/quote-activity` again it is an office that never had a
good read in that server's lifetime — look at the query, not the cache.

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
