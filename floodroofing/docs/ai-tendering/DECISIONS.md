# AI Tendering — decisions

Dated NZ time. Each one is a call the brief left open or a place the brief
and the app disagreed (RECON.md §11). Later phases append here.

- **2026-10-23 — Branch and isolation.** All work on `claude/project-thread-35za2m`
  (this project's branch); never touches `sheet-plan.js`, `tests/sheetlayout.mjs`
  or `docs/SHEET_LAYOUT.md` (the sheet-layout session's). Ships rebase onto
  `origin/main` and fast-forward.
- **2026-10-23 — Job type is `quoteKind: 'tender'`** in `draw_state`, plus a
  1:1 `tender_jobs` row. No type column on `jobs` (every path writes the jsonb).
- **2026-10-23 — Feature flag** = `user_settings.branding.ai_tendering_enabled`
  (the pole shed's `poleshed_enabled` shape); unknown = hidden (the opposite of
  the pole shed, because nobody has a tender job that would be stranded).
  Server middleware `requireTendering` reads the same row.
- **2026-10-23 — Storage** = Supabase Storage private bucket `tender-docs`,
  path `{company_id}/{job_id}/…`, written and signed by the SERVER with the
  service key; uploads go browser → Storage via `createSignedUploadUrl` so a
  100 MB set never passes through Railway. Tenancy is `_scopeCompany` on
  `tender_files`, as everywhere else; RLS added for defence in depth only.
- **2026-10-23 — Worker** = `tender_tasks` polled by the API process (pg pool
  claim, heartbeat, idempotent stages). A separate Railway worker service is a
  live-config change: ask Aron before doing it.
- **2026-10-23 — Progress** = polling `GET /tender/:id/progress`; no Supabase
  realtime (the frontend has no Supabase client).
- **2026-10-23 — PDF** = `pdfjs-dist` (text + bbox) and `@napi-rs/canvas`
  (page renders) in Node. Claude PDF input kept as the fallback for a page the
  renderer cannot handle.
- **2026-10-23 — Anthropic** = `@anthropic-ai/sdk` on the backend only; tool
  use with strict JSON schemas; prompt caching on system + house style + rules;
  per-pass model from env (`TENDER_MODEL_CLASSIFY/EXTRACT/REASON`), defaults
  `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5`; a
  `__TEST_TENDER_AI` seam so no suite hits the network.
- **2026-10-23 — Deposit** reads `invoicing.deposit_percent`; the Flood Roofing
  tender house style carries 60 and the tender quote's deposit line uses the
  house-style figure when set, else the company's invoicing default.
- **2026-10-23 — Evals** run on `workflow_dispatch` with the API key secret and
  write scores per prompt version to `docs/ai-tendering/evals/`; deterministic
  rules run in the ordinary Tests gate.
- **2026-10-23 — Fixtures** live under `floodroofing/tests/fixtures/ai-tendering/`
  only if Aron confirms the repo is private; otherwise `TENDER_FIXTURES_DIR`.
- **2026-10-23 — Snapshot gate** = `tests/typesnap.mjs` + `typesnap.json`:
  Roof (demo job, five-roof report 41, hip-and-valley tee) and Pole Shed
  outputs — sheets to order, sections, cut list, material rows, labour, quote
  totals, customer rows, quote section keys and the rendered quote text —
  held to the cent. Regenerate only with `REGEN=1` and a reason.

## Phase 1 — intake, extraction, sheet index (built 2026-10-23)

- **Flag unknown = hidden.** `_tenderingAvailable()` reads
  `branding.ai_tendering_enabled` (live, else the device's cached settings)
  and answers FALSE when nothing says — the opposite of the pole-shed gate,
  because a tender job on an account without the feature has no tab to open.
  `_quoteKindNorm` drops a 'tender' kind to 'roofing' where it is off.
- **Switching it on** is `POST /admin/tendering/enable {company_id, on}` with
  the admin token (writes `branding.ai_tendering_enabled`), or
  `TENDERING_ALL=true` on a dev server. No UI switch yet — a company is let
  in by hand while the feature is proving itself.
- **A page the office has classed is never re-asked** (`cls_source 'user'`):
  the classify stage skips it on every re-run, and the index follows the
  office's sheet id / title / revision over the parser's and the model's.
- **Every AI call is logged** to `tender_ai_runs` (pass, model, prompt
  version, tokens, cost USD, ms, ok/error) so the per-set cost is a query.
- **Limits**: 100 MB a file (`TENDER_BUCKET` bucket, private), 40 files a
  tender, PDF only; a duplicate name on the same tender is refused.
- **Uploads never pass through Railway**: sign → browser PUTs to the signed
  Storage URL → `/landed` queues the read. The last file of a batch carries
  `run:true`; the earlier ones only land.
- **Title block** is read by position first (bottom-right / right-edge
  candidates scored, A1 and A3 sheets alike), then the classifier is shown
  the page's text, a 150 DPI render and a 300 DPI title-block tile; the
  model's read wins, a blank field keeps the parser's, and `meta.agree`
  records whether the two agreed.
- **Notification** on an indexed set is a `platform:true` email to the
  uploader (held where the platform mailbox cannot send); `TENDER_NOTIFY=false`
  turns it off.
- **Superseded revisions** are kept as pages (viewable, their text indexed)
  but the sheet table shows one row per sheet id with a "supersedes rev B"
  note; a mixed-revision or behind-register set gets a warning line.
- **Not done in Phase 1** (Phase 2's): the roofing-spec extraction, blocks
  and citations. The Whangaroa fixture sets are still awaited; the suites run
  on synthetic A1 sheets written by `tests/_tenderpdf.mjs`.
- **2026-10-23 — Who sees it, live**: Aron asked for it "on for me only" —
  office@, aron@ and ethan@floodroofing.co.nz. So the gate is first a list of
  LOGINS (`TENDERING_USERS` on Railway, defaulting to those three), then a
  business switched on whole (`branding.ai_tendering_enabled`, the admin
  route). The app asks `GET /tender/enabled` after sign-in and keeps the
  answer per login (`fr_tender_on`); the server refuses every tender route
  to anybody else, so it is not merely hidden.
- **2026-10-23 — Privacy policy before anyone outside Flood Roofing.**
  privacy.html says AI reads only roof images and supplier price lists, and
  lists every usage milestone it records (`tests/legal.mjs` counts both). AI
  Tendering sends plan-set pages to Anthropic, so before it is switched on
  for ANY other business the policy needs a new version naming it (and the
  30 days' notice the policy promises for a change). Until then it is on for
  the owner's own three logins only, which is his own data, and records no
  usage milestone (`tender_created` was dropped from USAGE_EVENTS).
