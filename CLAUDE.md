# RoofMap (flood-roofing-estimator)

RoofMap is a production SaaS for NZ roofing companies (roofmap.co.nz), run by
Flood Roofing Ltd in Whangarei. Real customers use it daily — treat every ship
accordingly.

## Layout

- `floodroofing/frontend/app.html` — the entire app: one very large HTML file
  (CSS + markup + JS). Edit it with careful, count-asserted replacements; when
  scripting edits with Python, always read/write with
  `encoding='utf-8', errors='surrogateescape'` (the file contains emoji).
- `floodroofing/backend/server.js` — the entire Express backend, including the
  idempotent boot migration DDL list (search `create table if not exists`).
  New columns are added there as `alter table ... add column if not exists`.
- `floodroofing/tests/*.mjs` — self-contained suites. `run.mjs` runs them all
  (~12 min, ~120 suites), or one by name: `node floodroofing/tests/run.mjs inboxui`.
- `floodroofing/tests/fakepgrst.mjs` — in-process fake PostgREST. No DDL
  defaults (set every column explicitly on insert), no `in` filter (returns
  all rows), DELETE returns deleted rows.

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
5. **A ship is not done until the promote workflow is green.** Its last step
   fetches roofmap.co.nz/app and compares it byte-for-byte with app.html at
   the promoted commit; it fails if the site is still serving older code.
   This is the only proof the change reached a user — `production` containing
   the commit is NOT proof, and neither is a 201 from the Vercel deploy hook.
   Both were true on three ships that never went live.
   If that step goes red, say so plainly and tell the owner to open the
   Vercel project → Deployments → newest → **Promote to Production**. Never
   report a change as live on the strength of the branch or the hook alone.

## Conventions

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

## Working style

The owner (Aron, office@floodroofing.co.nz) sends batches of fixes/features,
often as phone screenshots. Keep replies tight; ship whole batches through
one gate; report what shipped and what to try, in plain language.
