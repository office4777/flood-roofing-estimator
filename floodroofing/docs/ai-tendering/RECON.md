# AI Tendering — Phase 0 recon

Written 2026-10-23 NZ against main `82c1614` (live `d3cef74`). Everything here
was read off the tree, not assumed. Where the brief and the app disagree, the
disagreement is called out in §11 and the chosen path in `DECISIONS.md`.

## 1. Stack and entry points

| Piece | Where | Notes |
|---|---|---|
| Frontend | `floodroofing/frontend/app.html` (82k lines, one file: CSS + markup + JS) served by Vercel at roofmap.co.nz/app | Plain global scripts, no bundler, no framework. `sheet-plan.js` (sheet engine), `help-bot.js` (support bubble), `sw.js` (service worker, network-first) are the only files split out. The public pages (`landing`, `pricing`, …) are separate static HTML. |
| Backend | `floodroofing/backend/server.js` (14.4k lines, one Express file) on Railway | `analytics.js`, `daily.js`, `metrics.js` beside it are the admin reports. One Node process, `node server.js`, Nixpacks. No worker service, no queue. |
| Database | Supabase Postgres, reached two ways: `supabase-js` with the **service key** (PostgREST) for almost everything, and a direct `pg` pool (`_pgPool()`, `DATABASE_URL`) for the slim customer read and jsonb_set stamps | The boot migration is an idempotent DDL list in server.js (`create table if not exists …`, 41 `add column if not exists`). New tables go there. |
| Auth | Supabase Auth for the password, but sessions are the server's own JWTs (`JWT_SECRET`, 30 days, `cid` = company, healed against `_memberCompaniesOf`) | The frontend never talks to Supabase. Every call is `api(method, path, body)` → `PROXY` (Railway) with `Authorization: Bearer fr_token`. |
| RLS | Policies exist (`auth.uid() = user_id`) but the server uses the service key, so **RLS is not what enforces tenancy**. `_scopeCompany(q, req)` filters every read/write on `company_id` (or `user_id` where company is null). Every company-scoped table carries `company_id` AND `user_id` (CLAUDE.md rule). | |
| Pipeline | main → Tests CI (API job + 4 browser shards) → promote workflow → `production` branch → Railway + Vercel. Never push `production`. | Tests trigger only on `frontend/**`, `backend/**`, `tests/**`, `package.json`. A docs-only commit runs nothing. |

## 2. Job types

There is no enum, no column and no table. A job's type is
`draw_state.state.quote.quoteKind`, `'roofing'` (default) or `'poleshed'`.

- **Picker:** the New/Edit Job modal's `#jtTypeToggle` (`_setJobType(k)`,
  app.html ~8690 / ~22622), which writes the one-shot `window._pendingJobType`
  read by `defaultQuote()` (~28436), plus the Quote tab's More menu
  (`_qkMenuRender`, ~40128, `_setQuoteKind`). Both are gated by
  `_poleShedsAvailable()` (~37199): `branding.poleshed_enabled` on the
  company's `user_settings` row, else company name starts with the stock
  owner. "Unknown" (settings not read yet) = offer it.
- **Normalisation:** `restoreFromJob` resets `S.quote.quoteKind` to
  `'roofing'` unless it is `'poleshed'` (the 2026-10-12 job-type leak fix).
  A third kind MUST be added there or every saved tender reopens as roofing.
  `_clearPendingJobType()` runs on every fresh job.
- **Routing by type:** nothing routes. The same five tabs exist for every job
  (`gotoTab(t)` sets `body[data-tab]`; panels `#tab-select` Home,
  `#tab-roof` Map Roof, `#tab-materials` Job Pack, `#tab-quote` Quote with
  the Pricing drawer `#tab-scope` sliding over it, `#tab-settings`). The type
  only changes what renders INSIDE: `_qdSectionsRaw()` / `_qbPages()` branch
  to `_psModernSections()` on `poleshed`; `_psIsShed()` (~17035) is tested in
  the material table, labour card, `_custBarTotalValue`, `_custBarRows`,
  `_quotePdfFilename`, the quote email wording, and the Pricing drawer's plan
  switch. ~31 `quoteKind` sites in all. This is the extension pattern a third
  type follows: one predicate, branches at the renderers, nothing in the
  engines.

## 3. Data model

`jobs` (Supabase): `id, user_id, company_id, client_name, site_address,
status, draw_state jsonb, settings jsonb, notes, order_sent jsonb,
version_of, version_name, created_at, updated_at`. **Everything about a job
is inside `draw_state`** — `{form, state, draw, scope}` (see
`snapshotCurrentJob` ~19366): `state` carries `quote` (the whole quote incl.
`versions`, `share`, line items, pricing state), `photos`, `files`
(base64, `JOB_FILE_MAX` 8 MB each), `img64` (the aerial), `labour`,
`materials`, `jobPack`; `draw` carries the roofs (§4). A job row is routinely
multi-megabyte, which is why the jobs list reads jsonb paths (`job_no`,
`linked_job`, `quote_sent`) rather than the column, and why `PUT /jobs/:id`
is serialised (`_jobWriteQueued`). The job NUMBER is
`draw_state.state.quote.ref`, allocated by `POST /settings/next-job-no`
(atomic bump of `quote_defaults.next_job_no`, default `06121`), and the
server refuses a duplicate (`DUPLICATE_JOB_NO`).

Related tables (all server-created): `user_settings` (one row per company:
`branding`, `quote_defaults`, `jms_keys`, `price_book`, `labour_pricing`,
`ui_flags`, …), `companies`, `company_users`, `company_invites`,
`job_revisions` (8 snapshots per job), `job_messages` (customer Q&A thread),
`comms_tasks`, `invoices`, `schedule_rows/blocks`, `mail_*` (inbox),
`usage_events`, `price_book_revisions`, `platform_state`, `day_plans`.

Versions of a job are rows in `jobs` tied by `version_of`.

## 4. Canvas

`DRAW` (app.html ~51054) is the active roof; `DRAW.roofs[]` holds every roof
with `DRAW.activeRoofIdx`, swapped in/out by `_loadRoofToCurrent` /
`_syncCurrentToRoof`. Per-roof fields = `ROOF_FIELDS` (~80807):
`outline` (image-px polygon), `lines`, `sections`, `penetrations`,
`infoItems`, `notes`, `outlineDone`, `roofType` (`hip | gable | mono |
dutch | stepgable | gable-hv`…), `calPitch` (degrees), `rotation`,
`gableRidgeOffset`, `dutchGabletFrac`, `roofBaseHoriz` (ridge/sheet
direction), `monoBaseDeg`, `sheetType`, `clearlites`, `pitchLabel`,
`ridgeBreaks`, `hipEnds`, `lowPitch` (below a change-of-pitch line).

- **Coordinates** are IMAGE pixels of the background picture
  (`DRAW.bgImg`); `DRAW.scaleMetresPerPx` is metres per image pixel and is
  the ONLY scale (never divided by zoom). `DRAW.bgAdjust` relocates the
  picture under a fixed drawing. Scale is set through ONE seam,
  `_scaleFromDrawn(px, slopeFactor, typedM, refA, refB)`, reached by
  Scale-a-line (`#btn-calibrate`), Custom scale (two clicks anywhere, tool
  `customscale`), a measuring tape's ruler, or clicking any measurement.
- **A line** is `{type, subtype?, a:[x,y], b:[x,y], measM, planM,
  autoGenerated?, …flags}`. Types (`LINE_COLORS`, `LINE_MEAS_TYPE_OPTS`
  ~62285): `ridge, valley, gutter, hip, barge|side|starter|finish|head,
  apron|side|head, changepitch, drip, custom, outline, unknown`. Flags in
  `LINE_FLAG_KEYS`. Slope factor per type via `_lineSlopeType`.
- **Planes** are not stored as polygons. A roof = outline + typed lines +
  pitch; faces are derived (the sheet engine's planar arrangement,
  `_sheetPuzzleBuild`; the counting pass's sections). `sections` is the
  older manual face list. Sheet direction = perpendicular to the gutter,
  decided by `roofBaseHoriz` on gable/mono and by the gutter edges on hip.
- **Builders:** `autoGenerateRoof(type)` → `_roofLinesForType` draws the
  structure for an outline; the office's hand-drawn lines survive a rebuild.
- **Backgrounds:** aerial (LINZ/Mapbox stitch, scale auto from lat/zoom),
  upload, Fergus photo, or a PDF page rendered in the browser
  (`_roofPdfOpen`, pdf.js off cdnjs, `PDFJS_BASE`). A consent plan is
  already a supported underlay.
- **Existing AI trace:** `analyseRoof()` (~24700) sends `S.img64` to
  `claude-haiku-4-5-20251001` through `claudeCall()` → `POST /claude/v1/messages`
  (the server proxies to api.anthropic.com with `ANTHROPIC_API_KEY`; trial
  cap 120 calls/day via `usage_events`). Returns `{outline:[[x%,y%]…], pitch}`,
  applied by `drawAILines`. Two more client AI uses: `_cpbAiRows` (price-book
  PDF reader) and `handlePriceFile`. Server-side AI: `_inboxAI(opts)` (~7817,
  raw `fetch` to the Messages API, `__TEST_AI` seam) for the inbox — models
  `claude-sonnet-5` and `claude-haiku-4-5-20251001`. **No Anthropic SDK is
  installed anywhere; no tool use, no prompt caching, no structured outputs
  are in use today.**

## 5. Sheet layout and cut list engine

`sheet-plan.js`, global script, browser-only (it reads `DRAW`, draws to a
canvas, writes `window.*`). Owned by the separate sheet-layout session —
**this work never edits it.**

- Entry: `renderRoofSheetPlan()` → per roof `_renderRoofSheetPlanInner()`.
  Inputs: `DRAW` (outline, lines, `calPitch`, `lowPitch`, `roofType`,
  `sheetType`, `scaleMetresPerPx`, `sheetPlanDeletedIds`). Outputs:
  `window._lastSheetCounts.groups` = `[{count, orderedMm, …}]` (sheets to
  order), `window._lastSheetSections` (faces: `perSide`, `orderedMm`,
  `isPrimary`, `valleyExtra`), `window.__lastAllStrips`, and the puzzle
  picture (`_sheetPuzzleBuild/_sheetPuzzleFill`, its own tally).
- Cut list: `_jpBuildSheetRowsAuto` → `_jpSheetRowsAll()` (frozen per roof
  once the office edits, `DRAW.matSheetFrozen` / `matSheetByRoof`).
  Flashings: `_flashWaste(lens, total, typeKey)` with `price_book.ordering`
  allowances (`_ordWaste`, `_ordCons`).
- **Headless = Playwright.** There is no Node-callable engine; every harness
  (`docs/ci_sheet_tests.js`, `tools/sheet-shots.mjs`, `tools/sheet-counts.mjs`,
  `tests/sheetlayout.mjs`) loads `file://…/app.html` with the Railway host
  routed to `[]`, sets `DRAW.*`, calls `autoGenerateRoof` /
  `renderRoofSheetPlan`, and reads `window._lastSheetCounts`. Fixtures are
  `tests/fixtures-*.json` = `_roofGeometryPayload` shape
  (`{scaleMetresPerPx, calPitch, outline, lines, roofs, activeRoofIdx}`).

## 6. Catalogue, prices, labour, pricing engine

All in the company's `user_settings` row:

- `price_book`: `sheets[{product, unit, price}]`, `by_grade[id]`,
  `ridge_lm`, `valley_lm`, `barge_lm`, `apron_lm`, `changepitch_lm`,
  `ridge_wide_lm`, `gutter{box125_lm, bracket_ea, dropper_ea,
  classic_*, <id>_lm}`, `screws_each`, `rivets_each`, `downpipe_ea`,
  `underlay{50,75,100}`, back-tray `$/lm`, `defaultUnderlayProduct`,
  `custom_book{items, folders}` (the supplier list, `replaces` links),
  `ordering{waste, consumables}`, `__materials_catalog{underlays[{name,
  price, m2}]}`.
- `selectables` (Quote's Product Options): `grades[]` (pct or own prices),
  `profiles[{id, name, coverMm, locksGauge, rate, rateUnit, img}]`,
  `gutters[{id, name, bracketSpacingMm, bracketStartPerRun, bracketIntEa,
  bracketExtEa, extBracketLm, img}]`, `extras[]` (office options).
- `labour_pricing`: hourly rates, `labour_m2`, `gutter_lm`, per-item hours.
- **Engine (browser only):** `_buildMaterialPriceRows()` (~17111) builds the
  take-off rows from the drawn roofs (`_matBasicCollectRoofs`) — row =
  `{key, label, autoQty, autoUnit, variants[{price,…}], decimalQty}`;
  `MATERIAL_OVERRIDES` / `MATERIAL_DELETED` (saved on the job as
  `matOv/matDel`) sit over it; `_materialsTotalFromRows` + buffer + mark-up;
  `calcLabour()` (hours off the roof or typed, hourly or m²);
  `_gutterMaterialLines` / `_gutterMaterialCharge`; scaffold;
  `_syncQuoteBaseLineItems()` writes the three base lines (`_base:
  labour|materials|scaffold`) into `S.quote.lineItems`; `quoteSubtotal()`,
  `_quoteMoney()` (sub, GST, total), `_profitFigures(view)`;
  customer-facing `_qpBuildPriced()` freezes `share.priced` (deltas per
  choice) and `_custBarTotalValue()` is the one seam every customer total
  comes through. The POLE SHED proves the adapter shape: `_shedTakeoffBuild()`
  turns the shed estimator's items into the SAME row shape, taken once and
  stored on the quote (`shedTakeoff`), and everything downstream works for
  nothing. **A tender's quantified lines should do exactly this.**
- Golden master: `tests/pricegold.mjs` holds 1024 selection combinations to
  the cent (`pricegold.json`).

## 7. Quotes

- `S.quote` holds it all; styles `classic` (A4 pages, `_buildQuotePages`)
  and `modern` (computer one-page `_qdRender` from `_qdSectionsRaw()`,
  phone book `_qbRender` from `_qbPages()`; both lists of
  `{key, label, html}`; order/parked = `modernOrder/modernParked`).
  `refreshQuoteProposal()` re-renders. Office edits: `_qdescOpen` (inclusion
  / exclusion / note bullets: `custDesc`, `custExcl`, `custNotes`),
  `sectionDesc[key]`, `summaryPicks`, contenteditable blocks.
- PDF: `_buildQuotePdf` → `_buildModernQuotePdf` (html2canvas + jsPDF off
  jsDelivr, loaded on demand; `_pdfAddSlicedCanvas`, `_pdfBreakRows`).
  Unreachable from CI, so `tests/quotepdf.mjs` pins the slicer with a
  stand-in. The office's Print/PDF saves the same file as the customer's.
- Send: `openQuoteEmail` → `_pricesBeforeSend` → `_ensureCustomerLink` (fresh
  products, `share.token`) → `POST /email/send-order kind:quote` →
  `_qvMarkSent` (`versions.sent`, `sentEarlier`) → Fergus push.
- Customer: `GET /q/:token` (slim read), `POST /q/:token/event`
  (opened/queried/accepted/declined). Accept = inline name + terms tick →
  `_acceptQuoteFinalize`; server `_firstAccept` → `_acceptCustomerEmail`,
  `_acceptOfficeNotify` (90 s grace + hourly sweep), `_autoDepositInvoice`,
  `_fergusOnAccept`. `_keepCustomerState` stops a stale office save wiping
  it. The frozen copy is `versions.accepted`.
- **Deposit:** `settings.invoicing.deposit_percent`, default **50**, per
  company (`#invDepositPct`); the brief's 60% is Flood Roofing's figure on
  quote 3310 and must come from settings/house style, not code.
- Job numbering: §3. Versions: `POST /jobs/:id/versions`.

## 8. Fergus

Company key in `jms_keys.fergus` (`_fergusKeyFor`). App:
`pushQuotePricingToFergus` (lines + plan; creates/voids versions) and
`useFergusJobInModal` (open a Fergus job as a RoofMap job, `linkedJobId`).
Server: `POST /fergus-quote/publish` (`_fergusPublishQuote` candidates,
`_fergusMarkQuoteSent`), `POST /fergus-job/description`
(`_fergusUpdateJobDescription`, `_fergusJobSummaryText` with
`_quoteChoiceLines`), `/fergus-files/*` (list/download/upload attachments),
`_fergusOnAccept` (description + PDF on acceptance). "Jobs to price" tile
reads Fergus's To Price list. A tender's quote feeds the same push: lines
per block are just quote line items.

## 9. Infrastructure

- **File storage: none.** No Supabase Storage, no S3. Photos and files are
  base64 inside `draw_state` (8 MB per file, `jsonLarge` 25 MB body). A
  100 MB plan set cannot go through any existing path.
- **Background work: none.** `setInterval` sweeps inside the one process
  (inbox every 3 min, reminders/owed/trial hourly). No queue, no worker.
- **Realtime: none.** The frontend polls (`/support/messages` 90 s, the Home
  board, `_hbToPriceLoad`). Notifications = `comms_tasks` rows and email
  (`_dispatchMail`, Resend; platform mail from support@).
- **Tests:** `tests/*.mjs`, 294 files, two lists in `run.mjs` (API: real
  Express in-process over `fakepgrst.mjs`; UI: Playwright over
  `file://app.html` with routes stubbed), 4 shards in CI; the sheet gate
  `docs/ci_sheet_tests.js` on its own workflow. A new suite is dead until it
  is in a `run.mjs` list. `tools/check-app-syntax.mjs` after any scripted
  edit to app.html. `node floodroofing/tests/run.mjs api` before any server
  ship.
- **Secrets:** `ANTHROPIC_API_KEY` is already on Railway (the proxy and the
  inbox use it); nothing AI runs without it (`_inboxAIOn`).
- **Container limits:** no `gh`, no production DB, outbound proxy refuses
  some hosts (CDNs for jsPDF/html2canvas, roofmap.co.nz).

## 10. Where the existing seams are (what P1+ touches)

| Need | Existing seam | Change shape |
|---|---|---|
| Third job type | `_setJobType`, `_qkMenuRender`, `defaultQuote().quoteKind`, `restoreFromJob` normalisation, `_quotePdfFilename`, quote email template | add `'tender'` beside `'poleshed'` behind `_tenderingAvailable()` (= `branding.ai_tendering_enabled`) |
| Quote sections per block | `_qdSectionsRaw` / `_qbPages` branch | `if (quoteKind==='tender') return _tdModernSections()` — the pole shed's exact pattern |
| Lines & price | `_shedTakeoffBuild` pattern → `_buildMaterialPriceRows` rows; `_syncQuoteBaseLineItems`; `_custBarTotalValue` / `_custBarRows` branch | `_tenderTakeoffBuild()` per block, stored on the quote like `shedTakeoff` |
| Canvas | `restoreFromJob` draw block / `DRAW.roofs[]`, `autoGenerateRoof`, `_scaleFromDrawn`, `_roofPdfOpen` | adapter writes roofs + lines + pitch + scale; engine untouched |
| Scope bullets | `custDesc` / `custExcl` / `custNotes` (+ `_qdescOpen`) | per-block lists, `tender_scope_items` is the source, quote reads a projection |
| Send / accept / Fergus | unchanged | the quote is a normal quote |
| Server AI | `_inboxAI` shape, `/claude/*` proxy | new `tender/ai.js` module with the SDK, tool use, caching, `tender_ai_runs` |
| Files | none | Supabase Storage private bucket, signed upload URLs from the server |
| Worker | none | `tender_tasks` + in-process poller (see DECISIONS) |

## 11. Where the brief and the app disagree

1. **"Private Supabase Storage bucket with RLS scoped to company_id."** The
   app has never used Storage and RLS is not the tenancy boundary (service
   key). Use a private bucket, yes — but access control is the server's
   (`_scopeCompany` on `tender_files`, signed URLs minted per request).
   RLS policies can be added for defence in depth; they protect nothing the
   server does not already.
2. **"Existing queue."** There is none. First version: a `tender_tasks`
   table polled by the API process itself (claim with `update … where
   status='queued' returning *` on the pg pool, heartbeat, stage-level
   idempotency). Splitting the worker into its own Railway service is a
   live-config change and waits for Aron.
3. **"Supabase realtime."** The frontend has no Supabase client. Poll
   `GET /tender/:jobId/progress` every 2–3 s while the screen is open
   (`visibilityState` aware, as the support bubble does).
4. **"PyMuPDF."** The backend is Node. `pdfjs-dist` (legacy build) gives the
   text layer with coordinates in Node; rendering needs a canvas:
   `@napi-rs/canvas` (prebuilt binaries, no native toolchain on Nixpacks).
   Alternative kept in reserve: Claude's own PDF input for pages where the
   render path fails.
5. **"Anthropic SDK, structured outputs, caching."** Not present. Add
   `@anthropic-ai/sdk` to the backend; keep `__TEST_AI`-style seam so suites
   never hit the network. Model IDs per pass configurable by env
   (`TENDER_MODEL_CLASSIFY` …), defaulting to the brief's three.
6. **"type = ai_tendering column on jobs."** There is no type column.
   `tender_jobs.job_id` 1:1 with `jobs`, and `quoteKind:'tender'` in the
   draw_state so every existing reader (list, search, board, PDF name)
   works. Adding a column to `jobs` is possible but every path writes
   `draw_state`, so the jsonb is the truth.
7. **"Deposit 60%."** The app's deposit is `invoicing.deposit_percent`
   (default 50). The tender quote's deposit line reads that setting; the
   Flood Roofing house-style seed sets it to 60 only in the tender house
   style, not globally, unless Aron wants his invoicing default moved too.
8. **"100 MB+ uploads."** Nothing can take that today (25 MB body). Signed
   upload URLs straight to Storage (`createSignedUploadUrl`) so the file
   never passes through Railway; the server is told when it has landed.
9. **"Evals in CI."** They need the API key and real money per run. Keep
   `eval:tendering` as a `workflow_dispatch` job with the secret, recording
   scores to `docs/ai-tendering/evals/*.json`; the deterministic parts
   (quantity rules, checks, catalogue mapping, fixture parsing) run in the
   ordinary Tests gate with no network.
10. **"Reuse the sheet engine headlessly on the server."** It only runs in a
    browser. The Roof Map tab of the review workspace runs it exactly as any
    job does; materials are computed there and posted back to
    `tender_material_lines`. No Playwright on Railway.
11. **Fixtures in the repo.** School drawings are confidential; the brief
    puts them under `fixtures/ai-tendering/`. They go under
    `floodroofing/tests/fixtures/ai-tendering/` ONLY if the repo is private
    (to confirm with Aron); otherwise the eval reads them from a path in
    `TENDER_FIXTURES_DIR` outside git.
12. **"Job type picker shows Roof · Pole Shed · AI Tendering."** The picker
    is gated per company today; AI Tendering is gated the same way
    (`ai_tendering_enabled`), so other companies' pickers do not change.

## 12. Build plan (P1–P6), concrete

Isolation: new backend code in `floodroofing/backend/tender/*.js`
(`routes.js`, `worker.js`, `pdf.js`, `ai.js`, `extract.js`, `checks.js`,
`quantities.js`, `mapping.js`, `house.js`), required from server.js in one
block; prompts in `floodroofing/backend/prompts/ai-tendering/*.md`; new
frontend code in `floodroofing/frontend/tender.js` (a second global script
like sheet-plan.js) plus one `#tab-tender` panel and the small `quoteKind`
branches in app.html; tables all `tender_*` with `company_id` + `user_id`;
feature flag `branding.ai_tendering_enabled` (server `requireTendering`
middleware reads the same row); suites `tests/tender*.mjs` in `run.mjs`.
Shared-engine changes = the `quoteKind` branches only, each gated by the
P0 snapshot suite.

| Phase | Files / tables | Done when |
|---|---|---|
| **P1** Job type, intake, storage, worker, page extraction, sheet index, classification | `tender_jobs, tender_files, tender_pages, tender_tasks, tender_ai_runs`; `tender/routes.js` (`POST /tender`, `POST /tender/:id/files/sign`, `POST /tender/:id/files/:fid/landed`, `GET /tender/:id`, `GET /tender/:id/progress`, `GET /tender/:id/pages/:n/{text,image}` signed); `tender/pdf.js` (pdfjs-dist text+bbox, @napi-rs/canvas renders at 150/300 DPI into the bucket); `tender/worker.js` (poll, stages `ingest → index → classify`); `tender/ai.js` (SDK, tool use, caching, run log); app: picker + intake + processing screens in `tender.js`; `tests/tenderapi.mjs`, `tests/tenderpdf.mjs` (a small synthetic PDF fixture), `tests/tenderui.mjs` | Whangaroa sets upload; sheet index right; classes ≥ 90 % |
| **P2** Extraction B–G, facts with citations, plan viewer | `tender_blocks, tender_facts` (+ `conflict` status); passes in `tender/extract.js`; review workspace left pane (page images, index, citation highlight by bbox) | every §13 field extracted with working citations |
| **P3** Scope, exclusions, RFIs, house style, learning | `tender_scope_items, tender_rfis, tender_house_style, tender_feedback`; `tender/house.js` (Flood Roofing seed from quote 3310); Scope + Checks & RFIs tabs; eval harness `tools/eval-tendering.mjs` | scope recall ≥ 85 %; both likely misses flagged |
| **P4** Roof Map auto-population, calibration, engine adapter, materials, pricing band | `tender_geometry, tender_material_lines, tender_product_mappings, tender_checks`; `tender/quantities.js` + `tender/checks.js` (pure, unit-tested); app adapter `_tenderApplyGeometry(block)` → `DRAW.roofs[]`, `_tenderTakeoffBuild()` → material rows; calibration band in house style | areas within 2 %; engine yields sheets/flashings/gutter; unmapped flagged |
| **P5** Quote in the existing format | `_tdModernSections()` (one section + price per block, preamble, closing, subtotal/GST/total/deposit) + classic pages; `_custBarRows` branch; send/accept/Fergus untouched | matches Quote 3310's layout |
| **P6** Hardening | retries/timeouts, 150-page sets, cost cap on `tender_jobs`, admin quality view (`/admin/tendering`), docs, evals on dispatch | Okaihau handled; full eval passes |
| **P7** hooks only | `tender_jobs.source` (`upload` now, `email` later) and the intake API shaped to take a server-side file | — |
