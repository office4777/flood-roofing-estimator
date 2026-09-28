// Every function an inline handler names must EXIST.
//
// app.html wires most of its buttons with onclick="doThing()" straight in the
// markup. Nothing checks those names: the browser only finds out when the
// person clicks, and then it is a ReferenceError in a support email rather
// than a red build. That is exactly how "Can't find variable:
// closeJobAddrSuggest" reached a subscriber on 2026-09-28 — pressing Enter in
// the job address box threw, and its twin in the aerial finder
// (closeAerialSuggest) had been dead the same way, swallowing Enter-to-search.
//
// So: read every on…="…" in app.html, take the bare function calls out of it,
// and require each one to be defined somewhere the app actually loads —
// app.html itself, sheet-plan.js or help-bot.js. No browser needed.
//
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');

const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const read = f => readFileSync(_j(DIR, f), 'utf8');
const app = read('app.html');
// The scripts app.html loads by <script src="…">, which share its globals.
const localScripts = [...app.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(m => m[1]).filter(s => !/^https?:/.test(s));
check('the local scripts app.html loads are the ones checked here',
  localScripts.length === 2 && localScripts.includes('sheet-plan.js') && localScripts.includes('help-bot.js'),
  localScripts.join(', '));
const js = app + localScripts.map(read).join('\n');

// What counts as defined: a function declaration, a function or arrow put in a
// var/let/const, an assignment onto window, or a bare `name = function`.
const defined = new Set();
for (const re of [
  /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  /window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g,
  /^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/gm,
]) for (const m of js.matchAll(re)) defined.add(m[1]);

// Language and browser built-ins an inline handler is allowed to call.
const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','new','delete','void','var','let','const','function','in','of','do','else','try','throw','instanceof','await','yield',
  'Number','String','Boolean','Array','Object','Math','JSON','Date','RegExp','Error','Promise','Set','Map','Image','Blob','FormData','URL','Intl',
  'parseInt','parseFloat','isNaN','isFinite','alert','confirm','prompt','setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame',
  'encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','fetch','open','print','focus','blur','close','btoa','atob','structuredClone']);

const calls = new Map();   // name → the handler it came from
for (const m of app.matchAll(/\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
  const body = m[1] ?? m[2] ?? '';
  // Bare calls only: a dot in front means it is a method on something else,
  // and that object is not ours to check.
  for (const c of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!BUILTIN.has(c[1]) && !calls.has(c[1])) calls.set(c[1], body.slice(0, 70));
  }
}
check('the handlers were found at all', calls.size > 300, calls.size + ' functions named');

const missing = [...calls].filter(([name]) => !defined.has(name));
check('every function an inline handler calls is defined',
  missing.length === 0,
  missing.map(([n, h]) => n + '  in  ' + h).join(' | '));

// The two that were missing, named so a revert says which and why.
check('closeAerialSuggest exists (Enter searches in the aerial finder)', defined.has('closeAerialSuggest'));
check('closeJobAddrSuggest exists (Enter in the job address box)', defined.has('closeJobAddrSuggest'));

const bad = results.filter(r => !r).length;
console.log(bad ? ('FAILED ' + bad + '/' + results.length) : ('All ' + results.length + ' passed'));
process.exit(bad ? 1 : 0);
