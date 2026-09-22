# Working on RoofMap from VS Code

Everything in `.vscode/` and `.claude/settings.json` is already set up in this
repository. Clone it and the editor comes configured. This page is the
step-by-step, then the handover an agent working here needs.

RoofMap is live software. Real roofing companies quote real jobs on it every
day. Nothing below is ceremony.

---

## Part 1 — Set the laptop up once

### 1. Install the four things

| What | Where | Note |
|---|---|---|
| Git | git-scm.com | During setup choose **"Checkout as-is, commit as-is"** |
| Node.js 22 LTS | nodejs.org | `node -v` must print v22 or newer |
| VS Code | code.visualstudio.com | |
| Claude Code extension | VS Code → Extensions → search "Claude Code" | Sign in with the same account as the web app |

The Git line-ending choice matters. The promote workflow proves a ship went
live by comparing roofmap.co.nz/app with `app.html` **byte for byte**. The
default Windows setting rewrites every line of that file and a ship that is
genuinely live then reports as failed. `.gitattributes` in this repo pins it
too, so both belts are on.

### 2. Clone and open

```bash
git clone https://github.com/office4777/flood-roofing-estimator.git
cd flood-roofing-estimator
code .
```

VS Code will offer the recommended extensions. Accept them.

### 3. Install dependencies

Menu bar → **Terminal** → **Run Task...** → **First-time setup**. Takes a few
minutes, once. It installs three things, and all three are needed:

1. the root packages (`npm ci`) — Playwright itself;
2. the BACKEND's packages (`npm --prefix floodroofing/backend ci`) — the
   backend keeps its own `package.json` and the root install does not reach
   it;
3. the Playwright browser the UI suites drive.

Skip the second and 61 suites die in 0.1 s on "Cannot find module
'jsonwebtoken'", which reads like 61 broken tests and is really one missing
install. From a terminal the whole lot is `npm run setup`.

Use the Terminal menu rather than `Ctrl+Shift+P`. Typing "run task" into the
command palette also matches "Tasks: Show Running Tasks", which answers "no
running task" and looks like a failure.

On Windows the terminal opens as Command Prompt, not PowerShell, because a
stock Windows box blocks script execution and npm ships there as a `.ps1`
shim: the first `npm ci` otherwise dies with "npm.ps1 cannot be loaded
because running scripts is disabled on this system". If you land in a
PowerShell prompt anyway, click the `v` beside the `+` in the terminal panel
and choose Command Prompt.

### 4. Prove it works before changing anything

Run the task **Gate — sheet layout only**. It takes about 40 seconds and must
end green. If that passes, the machine is set up correctly.

---

## Part 2 — What the editor now does for you

### Tasks — menu bar → Terminal → Run Task...

| Task | When |
|---|---|
| **Gate — full suite** (`Ctrl+Shift+B`) | Before every ship. ~19 min, must exit 0 |
| **Gate — sheet layout only** | First, after any sheet-engine change. ~40 s |
| **Gate — one suite by name** | While fixing one thing, e.g. `quoteeditor` |
| **Check app.html syntax** | After any scripted edit. Expect `blocks 6 bad 0` |
| **Sitemap dates** | After any public-page change, before the gate |
| **Sheet shots from a fixture** | When roof counts are in question — send the PNGs to Aron before the gate |
| **Serve the frontend locally** | Opens the app at localhost:5050/app against the live API |

A syntax failure is clickable. It appears in the Problems panel and jumps to
the line in `app.html`.

### Debugging — the one thing the terminal cannot do

Open a test suite, click the gutter to set a breakpoint, press `F5`:

- **Debug the test suite I'm looking at** — step through the failure.
- **Debug a suite with the browser visible** — watch Playwright drive the real
  app instead of guessing why a UI test fails. This is worth a lot on this
  codebase.
- **Debug the backend against the fake database** — no Supabase, no secrets.

### Source control

The left-hand Source Control panel stages, diffs and commits without typing
git. `main` and `production` are marked protected, so a push to either asks
first. `production` is deployed from and is never pushed to by hand.

### Settings that are deliberate

Formatting is off everywhere. `app.html` is one file of about 69,000 lines; a
formatter turns a three-line fix into an unreviewable diff. The minimap is off
and large-file optimisation is on so the editor stays responsive in it. Search
skips `node_modules`, screenshots and the lockfile.

---

## Part 3 — Handover for whoever picks this up

An agent working in this repository should read `CLAUDE.md` at the root first.
It is long, current, and it is the real handover: layout, the pipeline, the
conventions, what is open. This section is only what the editor adds.

### The shape of a day

1. Work on a `claude/...` branch, never on `main`.
2. Build the whole batch of fixes. Do not ship them one at a time.
3. Run **Check app.html syntax** after any scripted edit to that file.
4. Run the full gate on a **clean committed tree**. If files change during the
   run, the result is void — commit and run it again.
5. Ship with `git push origin HEAD:main`, fast-forward only.
6. A ship is not done until the promote workflow is green. It checks the
   frontend byte-for-byte and the backend's `/health` build against the
   promoted commit. Roughly 10 minutes after the push.

There is no preview step. The owner's rule, 22 September 2026: "I don't have
time to check previews."

### What the laptop can do that the cloud session cannot

The web session runs in a sandbox with no outbound access to roofmap.co.nz,
Railway or Fergus. On your own machine the agent can:

- Open the live app and click through a change after a ship.
- Read the real `/health` and the real API responses.
- Reach the Fergus API, which is the only way to learn the true publish path
  (`FERGUS_QUOTE_PUBLISH_PATH`) that has been guessed at for weeks.
- Drive Chrome with your own logins for Vercel and Railway.

That last group is the actual reason to use a laptop. The editing is no better
locally; the reach is.

### Things that have bitten before

- A failed backend deploy used to be silent. The frontend went live calling an
  API that did not have the change yet. The promote check now catches it.
- If promote goes red, check Vercel → Settings → Build and Deployment →
  **Ignored Build Step** first. It must be `Custom` with the command `exit 1`.
  On `Automatic`, Vercel skips any commit it has already seen as a branch
  preview, which is every promote.
- Never add a shortcut that returns before the straight-skeleton solver in the
  roof engine. One was added to fix H shapes and it broke every L, T and U in
  production.
- `DRAW.scaleMetresPerPx` is metres per **image** pixel. Canvas size and zoom
  have nothing to do with it.
- Never try a `/send` shape against Fergus. That is Fergus emailing the
  customer its own copy. The owner sends from RoofMap.

### Secrets

Never print `ADMIN_TOKEN` or a database connection string. `.env` files are
denied to the agent in `.claude/settings.json`. Two credentials are still
waiting to be rotated because they appeared in screenshots: the Fergus API
token and the Railway `ADMIN_TOKEN`.

---

## Part 4 — Phone and laptop together

They are the same thing. Claude Code on the web runs in a cloud container, so a
session started on the phone keeps running with the phone in your pocket, and a
session started in VS Code runs on the laptop while it is awake.

Use the phone for sending a batch of fixes and getting a ship out. Use the
laptop when something has to be looked at on the live site, or when a bug needs
a breakpoint rather than a guess.
