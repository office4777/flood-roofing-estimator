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
