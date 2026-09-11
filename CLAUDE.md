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
  (~17 min, ~161 suites, and the sheet-layout gate on a full run), or one by
  name: `node floodroofing/tests/run.mjs inboxui`. A NEW suite must be added
  to the list in `run.mjs` or it never runs. Pipe the runner through `tail`
  and you get tail's exit code, not the runner's — use `set -o pipefail`.
- `floodroofing/tests/fakepgrst.mjs` — in-process fake PostgREST. No DDL
  defaults (set every column explicitly on insert), no `in` filter (returns
  all rows), DELETE returns deleted rows.
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
- A settings PUT echoes the row back. MERGE that echo into `S.settings`,
  never replace with it: a backend that predates a field echoes the row
  without it and silently undoes what was just saved.
- The app and the API are different origins. A response header a `fetch()`
  needs to read (`Content-Disposition`, say) must be named in
  `Access-Control-Expose-Headers` or the browser withholds it.
- A function that both alerts AND swallows its error makes every caller's
  `catch` dead code. If any caller can recover, throw — see `openJob`'s
  `quiet` option.

## Three things that have been broken twice

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

**Believing one API call.** Twice now a working Fergus link has reported
itself dead because a single request failed: the connection test asks for the
jobs list sorted and paged, and not every partner account answers that query
string. It falls back through plainer requests now — but NOT on 401/403,
where a rejected key must fail on the first call rather than be hammered.
`tests/fergstale.mjs` pins both that and the stale job-mapping recovery.

## Diagnosing a subscriber's integration

Settings → "Something not working?" runs the probes support would run by
hand. It emails the report to support AND offers it as a PDF
(`POST /jms/diagnostic.pdf`, written by a small Courier-only PDF writer in
server.js — no library, deliberately). The report carries the API key's
LENGTH and never the key; keep it that way, `tests/jmsdiag.mjs` pins it. Ask
the owner for that PDF before guessing at a Fergus fault.

## Open at last handover — 2026-09-11

Delete or rewrite this section as it is dealt with; a stale list here is
worse than none.

Everything below the line "shipped this round" is live and promote-verified at
`a3046c7`; main, the branch and `production` all sit there and the tree is
clean.

**Shipped this round (context for anything built on top of it):**
- Daily activity report to support@roofmap.co.nz at 3am (`backend/daily.js`,
  `DAILY_REPORT_HOUR`). It refuses to send an empty report, and counts a user
  through company_users OR `profiles.company_id`, with a stray-user pass for
  anyone with events and no business.
- Quote versions. `_qv*` helpers sit just above `unacceptQuote()` in app.html:
  Sent Quote and Accepted Quote are frozen snapshots, Saved Drafts is a
  dropdown, Create New Draft prompts save-or-overwrite. While
  `S._qvViewing` is set, `saveCurrentJob` returns false — that is the guard
  that makes a viewed version unchangeable.
- The job lock. `_lockClickGuard` on mousedown+click, scoped by
  `_LOCK_CLICK_SCOPE` and allowed through by `_LOCK_OK_CALLS`. There is
  deliberately NO wheel guard — one was added and the popup then fired on
  every scroll past a photo. The three wheel handlers bail on
  `_jobLockActive()` instead.
- Per-frame aerial placement in the quote. `_qpRoofMapView(key)` and
  `data-map-key` on `.qp-map-frame`, so page 2 and the last page no longer
  share one placement; the accept page passes `mapKey:'accept'`.
- Job profitability: GP/hr, labour $/m² and material $/m² adjustable by $1
  (`_profitNudge`), each recomputing the others, rounded whole. Total and
  per-roof buttons (`_profitView`). The old per-roof breakdown card is gone
  and `renderPerRoofBreakdown` is a no-op stub.
- Fergus: emailing a quote pushes pricing and publishes; a customer's
  selections auto-create and publish a new version, never accept
  (`_fergusAutoVersionSoon`, debounced by `FERGUS_AUTO_VERSION_DELAY_MS`).
  Reconciliation targets `_quoteMoney().sub`, not the base — pushing against
  the base produced a bogus "Adjustment to quoted total" line on a live job.
- `_workingWrap`/`#workingPill` spinner over the ~20 slow operations, and a
  12-second `.ld-ring` in the email popup.
- Deleted jobs are recoverable: `GET /jobs/deleted` reads `job_revisions`
  rows with `reason='delete'` and the Home board has a Deleted tile with
  Restore. That route MUST stay registered above `app.get('/jobs/:id')` or
  the `:id` route swallows it.

**Waiting on the owner (Aron):**
- Rotate the Fergus API token and the Railway `ADMIN_TOKEN` — both were
  readable in screenshots shared during a session. Still not done.
- Confirm job 3231 came back cleanly via Home -> Deleted -> Restore.
- Set `EMAIL_FROM=RoofMap <noreply@roofmap.co.nz>` once roofmap.co.nz is
  verified in Resend; the daily report currently arrives from
  office@floodroofing.co.nz, which is why he asked.
- Tell us Fergus's real publish endpoint so `FERGUS_QUOTE_PUBLISH_PATH` can
  be pinned instead of `_fergusPublishQuote` trying four candidates.
- Re-push job 3045 to Fergus so the bad reconciled version is voided.
- Four aerial screenshots for the demo slideshow (Mapbox is unreachable from
  the build environment, so those slides are placeholders): aerial found,
  mid-trace, outline finished, roof lines generated.
- Ring Sharon about the steel grade on quote 3206 before that roof is
  ordered — the acceptance email and the PDF disagreed about which grade was
  standard.
- SMS/uptime alarm on `/health`; run the restore drill once
  (`tools/restore-check.mjs`); add the crews then paste the schedule import;
  paste the real price book so it can become the shipped default.

**Queued, not started:** mark system alert emails as auto-generated
(Auto-Submitted / Precedence headers) so they stop bouncing around as replies.

**Product thinking, agreed but not built:** the trial's first twenty minutes
should walk a new roofer to their OWN first quote — address, trace, quote, in
that order — before the schedule or the inbox is mentioned, and should get
their real supplier rates in before that first quote. Lead with measuring and
quoting everywhere a stranger meets the product; the rest is why people stay,
not why they try it. This is the blocker on paid advertising being worth
running — see below.

**Marketing, in flight (not in the repo):** he is standing up a Facebook page
and considering a paid campaign. Built for him this session, from job 3045's
real aerial (extracted from a screenshot he pasted into a .docx — the app is
unreachable from this environment, so a screenshot is the only way to get an
aerial in): a 1640x624 wide cover, a 1280x720 mobile-shaped cover, and a
1080x1350 4:5 feed post. He has a 40-second demo video and ad copy drafted.
The advice given, and worth repeating: the audience is ~2,000 NZ roofing
businesses that Facebook cannot target directly, so trade groups and RANZ
beat paid reach, and the trial onboarding above should land before money goes
in. These assets live in the session scratchpad, not in the repo.

## Working style

The owner (Aron, office@floodroofing.co.nz) sends batches of fixes/features,
often as phone screenshots. Keep replies tight; ship whole batches through
one gate; report what shipped and what to try, in plain language.

He also asks for non-code work — logos, social images, ad copy, marketing
advice. Do it, and give a straight recommendation rather than a list of
options. Where the answer is "this is not the thing that will move the
needle", say so in a sentence and then do what was asked anyway.
