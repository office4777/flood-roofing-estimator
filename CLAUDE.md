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

## Pipeline — how changes reach users

main → GitHub Tests CI → promote workflow → `production` branch → Railway
(backend) + Vercel (frontend). Never push `production` directly.

Discipline (non-negotiable):
1. Develop and commit on the session's designated `claude/...` branch only.
2. Before fast-forwarding main: run the FULL local suite in the background
   (`node floodroofing/tests/run.mjs`) on a clean committed tree and require
   exit 0. If files changed mid-run, the result is void — re-run clean.
3. Ship with `git push origin HEAD:main` (fast-forward only). Batch several
   commits into one ship when possible.
4. After a green gate the pipeline lands in ~6 minutes; don't poll unless
   something looks wrong.
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
  Requested mail still degrades to the relay. `tests/platformrelay.mjs`,
  with a fake Resend that refuses everything (`RESEND_API_BASE`).
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
  Style switch; the preview's classes are DERIVED from mode + style + the
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
  anchor with a dashed pointer to it (`.qe-rail-btn`, `.qe-rail-line`),
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
  and `_buildRoofPreviewsHtml`; `_setRoofMode`). Never for the customer,
  never on paper. `tests/quoteeditor.mjs`.
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
  version selector (`.qv-seg`, the version on screen filled in: Draft / Sent /
  Accepted) with the draft actions and saved list behind `<details
  class="qv-menu">`, and ONE sentence (`.qv-status`) about the customer's link.
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

**The drawing scale.** `DRAW.scaleMetresPerPx` is metres per IMAGE pixel. The
canvas size and `DRAW.zoom` have nothing to do with it. Dividing by how large
the photo happens to be drawn makes every measurement move when the roofer
zooms — the same roof read 1.86m at 490% and 2.95m at 310%, on live quotes.
The aerial's own Mapbox zoom does change it, and must.

**Publishing a quote in Fergus.** The quote pushed at send arrives as a
Draft and `_fergusPublishQuote(key, quoteId, jobId)` then tries the
publish shapes in `FERGUS_PUBLISH_CANDIDATES` ("METHOD /path"; pin the
right one in `FERGUS_QUOTE_PUBLISH_PATH` once known). Two rules, both
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

## Open at last handover — 2026-09-19

Delete or rewrite this section as it is dealt with; a stale list here is
worse than none.

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
