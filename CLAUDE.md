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
  (~15 min, ~132 suites, and the sheet-layout gate on a full run), or one by
  name: `node floodroofing/tests/run.mjs inboxui`. Pipe it through `tail` and
  you get tail's exit code, not the runner's — use `set -o pipefail`.
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

## Two things that have been broken twice

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

## Working style

The owner (Aron, office@floodroofing.co.nz) sends batches of fixes/features,
often as phone screenshots. Keep replies tight; ship whole batches through
one gate; report what shipped and what to try, in plain language.
