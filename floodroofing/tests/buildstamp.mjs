// THE APP'S "UPDATED …" TIME IS NEVER LEFT BEHIND (2026-10-02). The line under
// the company logo ("Updated 1:36 pm 2/10", NZ time) reads window.APP_BUILT_AT,
// which .githooks/pre-commit stamps whenever app.html is committed. A machine
// without the hook (git config core.hooksPath .githooks) would ship a build
// claiming an older time — this fails that ship instead. Checkable only with
// history and a committed app.html; skipped otherwise.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const check = (name, ok, info) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !info ? '' : '\n         ' + info)); };
const s = fs.readFileSync(join(ROOT, 'floodroofing', 'frontend', 'app.html'), 'utf8');
const m = s.match(/window\.APP_BUILT_AT = '([^']*)';/);
check('app.html carries window.APP_BUILT_AT, a real time', m && !isNaN(Date.parse(m[1])), m && m[1]);
check('…rendered under the company logo (#appUpdated) and on the canvas label', /id="appUpdated"/.test(s) && /id="appBuildLbl"/.test(s) && /function _appUpdatedRender/.test(s));
const git = (c) => execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
let shallow = true, dirty = true, last = '';
try { shallow = git('git rev-parse --is-shallow-repository') !== 'false'; } catch (e) {}
try { dirty = git('git status --porcelain -- floodroofing/frontend/app.html') !== ''; } catch (e) {}
try { last = git('git log -1 --format=%cI -- floodroofing/frontend/app.html'); } catch (e) {}
if (shallow || dirty || !last || !m){
  check('the stamp is the last commit of app.html (skipped: ' + (shallow ? 'shallow clone' : dirty ? 'app.html not committed yet' : 'no history') + ')', true);
} else {
  const lag = (Date.parse(last) - Date.parse(m[1])) / 60000;
  check('the stamp is the last commit of app.html (within 30 minutes of it)', lag > -5 && lag < 30,
    'APP_BUILT_AT ' + m[1] + ' vs commit ' + last + ' — enable the hook: git config core.hooksPath .githooks, then node floodroofing/tools/stamp-build.mjs and commit');
}
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
