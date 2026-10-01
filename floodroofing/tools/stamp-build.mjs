// Sets window.APP_BUILT_AT in app.html to now — the "Updated 1:36 pm 2/10"
// line under the company logo. Run by .githooks/pre-commit whenever app.html
// is in the commit (git config core.hooksPath .githooks, once per machine);
// tests/buildstamp.mjs fails a ship whose stamp was left behind.
//   node floodroofing/tools/stamp-build.mjs          stamp it
//   node floodroofing/tools/stamp-build.mjs --staged stamp only if app.html is staged, and re-stage it
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'floodroofing', 'frontend', 'app.html');
const REL = relative(ROOT, FILE).split(sep).join('/');
if (process.argv.includes('--staged')){
  const staged = execSync('git diff --cached --name-only', { cwd: ROOT }).toString().split(/\r?\n/);
  if (!staged.includes(REL)) process.exit(0);
}
const s = fs.readFileSync(FILE, 'utf8');
const re = /window\.APP_BUILT_AT = '[^']*';/;
if (!re.test(s)){ console.error('stamp-build: window.APP_BUILT_AT not found in app.html'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(FILE, s.replace(re, "window.APP_BUILT_AT = '" + now + "';"));
if (process.argv.includes('--staged')) execSync('git add -- "' + REL + '"', { cwd: ROOT });
console.log('stamp-build: APP_BUILT_AT = ' + now);
