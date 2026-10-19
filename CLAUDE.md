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

## Conventions

- The public pages (`landing`, `pricing`, `fergus`, `early-access`, `signup`)
  must agree with the `PLANS` table in server.js about what each tier gets.
  `tests/sitecopy.mjs` pins it; change the table and the pages together.
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
- THE "UPDATED …" LINE (2026-10-02): `window.APP_BUILT_AT` (UTC ISO) in
  app.html, rendered by `_appUpdatedRender` as "Updated 7:48 am 2/10" (NZ
  time, light grey, full date on hover) in the sidebar's `.hdr-right` band
  under the company block, and on the canvas label (`#appBuildLbl`). Stamped
  at every commit touching app.html by `.githooks/pre-commit` →
  `tools/stamp-build.mjs --staged`; each machine runs
  `git config core.hooksPath .githooks` once. `tests/buildstamp.mjs` fails a
  stamp more than 30 min behind app.html's last commit (skipped on shallow
  clones and an uncommitted app.html).
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
- THE "UPDATED …" LINE (2026-10-02): see the bullet below; also the bug
  report records `build <APP_BUILT_AT>` (`tests/fbcontext.mjs`).
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
  37-shape sheet gate is unchanged. STILL OPEN AND HIS CALL: the APRON on the
  narrower block still runs the whole shared stretch (4.85 m). The same
  argument says it should also start at the lower ridge, since below that the
  two roofs are one plane — but he confirmed only the barge, and an apron is
  what keeps water out, so it was not touched on reasoning alone. Ask him.
  `tests/report12.mjs`, `tests/stepgable.mjs`.
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
  `_psModernSections()` — cover, psplans, psdetails, psoptions, psincluded,
  psreview. ONE SOURCE OF TRUTH: `_buildPoleShedPages(…, wantParts)` returns
  its content blocks instead of the assembled A4, `_psParts()` fetches them,
  and the modern sections wrap those same blocks — so the two styles cannot
  drift about what the shed is. Classic still renders the six A4 pages
  unchanged and a roofing quote is untouched; `tests/poleshed.mjs` pins the
  section KEYS rather than page text, because the shed's own wording
  legitimately contains phrases like "Steel grade" and "Old roof".
  THE PHONE HALF OF THAT IS DONE (2026-10-13): the A4's two-column grids
  collapse, spec rows stack label-above-value and the chapter band is cut down,
  all scoped to `.ps-body` — see the customer-total bullet. STILL TO DO on the
  COMPUTER: the sections carry the A4's typography inside the modern cards.
  They read correctly and the Style switch works, but they do not yet use the
  modern card/rail idiom the roofing quote does — the owner should see them
  before that is finished.
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
  STILL TO ASK SCOTT: "snap grid kept at maximum zoom" was in the same list and
  is not clear enough to act on — the snap grid is already screen-constant at
  every zoom (`g = gridSize / tr.s`), so whether he wants it to stay coarse or
  to get FINER as he zooms in changes the fix completely. Not guessed at.
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
  every recalc reaches). `tests/roofcustom.mjs`.
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
  + `#pbDefaultUnderlay` on Default item pricing, filled from
  `materials_catalog.underlays` by `refreshDefaultUnderlayPicker`; a product
  since removed from that list is still shown marked "(not in list)" rather
  than silently dropped. `populateOrderDropdowns` puts it in `#orderUnderlay`
  ONLY when that box is empty — a job that has chosen its paper is never
  overwritten, which is the rule the whole thing rests on.
  THE PICKER FOLLOWS ITS LIST (2026-10-12, same roofer: "the Underlay Pick a
  default does not offer a selection, is there an update to roll out, or have
  I missed a step here?"). Neither — `materials_catalog.underlays` ships
  EMPTY, so there was nothing to pick, and the box said nothing about why;
  worse, the picker was only ever filled by a full render of the price book,
  so typing a product in and even SAVING left it empty until the page was
  reopened. `onCatalogUnderlayChange` now reads the rows straight off the
  page on every add, keystroke and delete — the way `onPriceBookSheetChange`
  has fed the sheet picker since it was built — and an empty list renders a
  disabled "add an underlay product above first" rather than a bare, broken-
  looking dropdown.
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
  correctly, and `_cpBandSpecs` can add the bands. But on a HIP the band does
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
  reveal's three seconds (`RTP_HIDE_MS`) are for reading the row; a press on a
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
  the queue to a pair of Default item pricing boxes (`ext_bracket_box125_lm` /
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
- SETTINGS → MATERIAL ORDERING (2026-10-19, the owner: "add in a settings tab
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
  STILL TO DO, and it needs him: pulling his GMAIL reply back in. The pieces
  are there (`mail_threads.job_id`, `mail_messages.in_reply_to`, the
  `_inboxSweep`), but the Inbox is `requirePlan('inbox', …, 'Business')` and
  needs office@floodroofing.co.nz connected in Settings. Match an inbound
  message to a job by `in_reply_to` against `job_messages.msg_id` and write it
  in with `who: 'customer'`, `via: 'gmail'`.
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

FIXED 2026-10-12 — the other half of that evening: switching jobs left the
PREVIOUS job's quote in place. `restoreFromJob` does `Object.assign(S,
snap.state)`, which only overwrites the keys the INCOMING job HAS, so a job
saved with no `quote` block kept the last job's whole quote — client, totals
and its `ref`. The server derives a job's number from
`draw_state.state.quote.ref` (and the jobs list reads `job_no` straight off
it), so every autosave then tried to CREATE a second record under the
previous job's number and was refused with DUPLICATE_JOB_NO, over and over.
The refusal was right; the carry-over was the bug. `S.quote` is now reset to
`defaultQuote()` immediately BEFORE that assign — exactly like the picture,
the files, the struck-off flashings and every other leak already fixed on
those lines — so a job carrying a quote gets its own back on the next line
and one carrying none starts clean rather than wearing another client's.
(The owner, 2026-10-12: Phyllis's job open, chose another job, "Job 3287
already exists" against Beth Williamson's.) `tests/jobbgleak.mjs`.

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

## Open at last handover — 2026-10-02 (late morning NZ)

Delete or rewrite this section as it is dealt with; a stale list here is
worse than none.

**Where things stand.** Main carries everything below and is promoted and
verified live (`/health.build` = main's SHA). Nothing uncommitted. Working
branch `claude/pricing-totals-photos` (kept equal to main). The sidebar's
"Updated h:mm d/m" line shows which build a screen is on — ask the owner
for it before believing "it's still broken" (an un-reloaded tab runs the
old build).

**Starting on ANOTHER computer (the owner is away from this laptop until
about mid/late October 2026 and continues elsewhere):**
- `git fetch && git checkout claude/pricing-totals-photos` (equal to main
  at handover) — or branch a new `claude/...` off main.
- `git config core.hooksPath .githooks` once (the build-stamp hook), then
  `npm install` at the repo root AND in `floodroofing/backend` (as CI
  does), then `npx playwright install chromium` for the browser suites; `floodroofing/docs/VSCODE.md` is the editor setup.
- `gh auth login` (GitHub CLI) to watch Tests/promote runs.
- NOT on the other machine: `C:/Users/OEM/pgtools` (the read-only prod
  query tool and the Singapore cutover script) and
  `C:\Users\OEM\roofmap-migrate.env` (the secrets) live only on this
  laptop, and the auto-memory notes are per machine (their content is in
  this file). Without them there is no direct production database access —
  diagnose from feedback reports, `/health`, and the owner. Do not recreate
  the secrets file anywhere; the cutover waits until he is back here.

**How to work (2026-10-01 onward — keep doing it):**
- Run the AFFECTED suites locally (`node floodroofing/tests/run.mjs <name>`
  — ONE name per call; it ignores the rest), commit, `git push origin
  HEAD:main` (and the same SHA to the branch). Main's Tests run (browser
  suites sharded 4 ways) is the gate; watch it, then the promote, then
  `/health.build`. A red run ships nothing — read the failing suite with
  `gh run view <id> --log-failed | grep FAIL`, fix forward. Two CI-only
  timing flakes were fixed today (onboarding's two start events, report61's
  select-then-convert); if another suite fails ONLY on CI, look for a test
  that splits one action across two `evaluate` calls.
- `gh` is `/c/Program Files/GitHub CLI/gh.exe`. NZ time: `node -e
  "console.log(new Date().toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'}))"`
  (`TZ=… date` lies in Git Bash). The laptop cannot run the full gate to
  exit 0 (signup, dupjobui, restoredrill fail on Windows' timezone).
- THE COMMIT HOOK: `.githooks/pre-commit` stamps `window.APP_BUILT_AT` in
  app.html whenever app.html is committed. This laptop already has
  `git config core.hooksPath .githooks`; ANY OTHER MACHINE must run that
  once, or `tests/buildstamp.mjs` fails the ship.
- Scripted edits to app.html: Python in a FILE in the scratchpad (bash
  heredocs mangle `\u`, `\n` and quotes), assert every replacement's
  count, `node floodroofing/tools/check-app-syntax.mjs` → `blocks 6 bad 0`.
- Read-only production queries: `node C:/Users/OEM/pgtools/q.cjs old "<sql>"`
  (prod DB is still the Mumbai one). Never print secrets; secrets live only
  in `C:\Users\OEM\roofmap-migrate.env`. The Singapore DB move waits on
  the owner's "ready" and runs ONLY through `node
  C:/Users/OEM/pgtools/cutover.cjs <step>`; don't change JWT_SECRET,
  MAIL_CRED_KEY or ADMIN_TOKEN on Railway during it.
- The owner's messages sometimes say "see attached" with nothing attached,
  or "2 more things" with one — say so rather than guess.

**Shipped 2026-10-01/02 (all live), watch the first days through it** —
each has its Conventions bullet: the getting-started coach every sign-in
until "Don't show this again"; the help bubble's real-person support desk
(`/admin/support/page`); Photos closed by default; Job Pack panels push the
pages; the outline snap back at 20° + parallel line-up + Shift tip; the
dog-leg gable (report 60); gable↔hip end conversion (reports 61, 64);
Measure plan on the pricing page; the editable quote summary; office
options' pick/recommended; Save as template; Fergus last-sent per job; a
deleted page drops its price; the acceptance guard (`_keepCustomerState`,
job 3288) and the fresh-products-before-send check; re-send a sent quote,
close the email window freely, delete saved drafts; `tests/sendexact.mjs`
(the customer sees exactly what was sent); EVERY SEND KEPT (Sent quote 1,
2 …); the "Updated …" line; CUSTOM OPTIONS on the quote (+ Insert custom
option, edit / save / delete, saved options); options and the gutter write
What's included / excluded; a duplicate keeps its options at once on a
device whose products are behind; SETTINGS → EMAIL rebuilt with the
master copy and the customer's acceptance confirmation.

**Open — needs the owner (Aron):**
- Job 3288's acceptance (accepted 3:20 pm NZ 1 Oct, wiped by a stale screen
  before the guard existed) can only be put back from his acceptance email
  (name, time, total). Its first Sent copy is gone too (the job's history
  holds only the 7:48 am 2 Oct send).
- His own quotes now leave as "Flood Roofing <…@roofmap.co.nz>" with
  replies to office@. To send as office@floodroofing.co.nz: the Resend
  entries for floodroofing.co.nz read FAILED and Settings → Email shows
  office@floodroofing.co.nz "Waiting for DNS" — the records go in
  Cloudflare (floodroofing.co.nz's DNS), then Check now.
- The two OPEN AND URGENT items above (an accepted quote's figures move;
  the previous job's quote carried into the next) are still open.
- Older, still his: the missing "1 × 2.78 m" sheet measure (ask for that
  job's feedback report); check Break up ridge's flashings on the real
  zig-zag roof; UNANSWERED — should a Custom Price Book line's mark-up
  REPLACE the job's material mark-up for that item; his price book CSVs in
  `C:\Users\OEM\Downloads` (floodroofingpricebook.csv,
  floodroofinggutterpricebook.csv, the Bills CSV); Nearmap stays off until
  privacy.html v1.2 + 30 days' notice; the "Waiting on the owner" lists
  below.

### Older handover notes (history — check before relying on them)

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
