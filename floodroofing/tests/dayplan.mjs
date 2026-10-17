// MY DAY — the owner's daily plan, shared between his phone and his computer.
//
// The thing this suite exists to hold is the one that would actually hurt:
// a tick made on the phone being wiped by the computer saving a second later.
// The server is only a post box, so what is pinned here is the bargain that
// makes the post box safe — a revision that moved means REFUSED, handed back
// the current copy, never a silent overwrite.
//
// Also pinned: the key is the credential, so a guessed or malformed one gets
// nothing; a database that will not answer is a 503 and never an empty plan
// (an empty plan, on the phone, reads as "my whole list has gone"); and an
// unauthenticated endpoint does not become free storage for anything the
// caller feels like sending.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const db = { __missing: [], __fail500: '', day_plans: [] };
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34733';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

const J = (p, opt) => fetch(BASE + p, opt);
const PUT = (k, baseRev, doc) => J('/day/' + k, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ baseRev, doc }),
});
const day = (tasks) => ({ v: 1, days: { '2026-10-18': { big: tasks, fill: [] } } });
const task = (id, text, extra) => Object.assign({ id, text, done: false, doneAt: 0, pos: 1, updatedAt: 1000, deleted: false }, extra || {});

// ── Making one ────────────────────────────────────────────────────────
let r = await J('/day/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
let b = await r.json();
const KEY = b.key;
check('a new plan hands back a key', r.status === 200 && /^[a-f0-9]{32}$/.test(KEY || ''), String(KEY));
check('…and it starts empty at revision 0', b.rev === 0 && db.day_plans.length === 1);

// ── Reading and writing ───────────────────────────────────────────────
r = await J('/day/' + KEY); b = await r.json();
check('reading it back gives an empty plan, not a 404', r.status === 200 && b.rev === 0 && b.doc && b.doc.days && !Object.keys(b.doc.days).length);

r = await PUT(KEY, 0, day([task('t1', 'Price the Kerikeri job')]));
b = await r.json();
check('a save at the current revision is taken', r.status === 200 && b.rev === 1, 'status ' + r.status);
check('…and the plan comes back with it', b.doc.days['2026-10-18'].big[0].text === 'Price the Kerikeri job');

// ── THE ONE THAT MATTERS: two devices, no lost work ───────────────────
// The phone saves (rev 1 → 2). The computer, still holding rev 1, saves too.
r = await PUT(KEY, 1, day([task('t1', 'Price the Kerikeri job', { done: true, doneAt: 2000, updatedAt: 2000 })]));
check('the phone ticks it off', r.status === 200 && (await r.clone().json()).rev === 2);

r = await PUT(KEY, 1, day([task('t1', 'Price the Kerikeri job'), task('t2', 'Ring Sharon', { pos: 2 })]));
b = await r.json();
check('a stale device is REFUSED, not allowed to overwrite', r.status === 409, 'status ' + r.status);
check('…and is handed the current copy to merge from', b.rev === 2 && b.doc.days['2026-10-18'].big[0].done === true);
check('…so the tick made on the other device still stands', db.day_plans[0].doc.days['2026-10-18'].big[0].done === true);

// Having merged, it comes straight back and both pieces of work survive.
r = await PUT(KEY, 2, day([task('t1', 'Price the Kerikeri job', { done: true, doneAt: 2000, updatedAt: 2000 }), task('t2', 'Ring Sharon', { pos: 2 })]));
b = await r.json();
const after = b.doc.days['2026-10-18'].big;
check('the merged save lands, with both the tick and the new task',
  r.status === 200 && b.rev === 3 && after.length === 2 && after[0].done === true && after[1].text === 'Ring Sharon');

// ── The key is the credential ─────────────────────────────────────────
r = await J('/day/' + 'f'.repeat(32));
check('an unknown key gets nothing', r.status === 404, String(r.status));
r = await J('/day/not-a-key');
check('a malformed key is refused before it reaches the database', r.status === 400, String(r.status));
r = await PUT('abc', 0, day([task('t9', 'squat')]));
check('…and cannot be written to either', r.status === 400, String(r.status));
check('…so nothing was created by trying', db.day_plans.length === 1);

// ── Not a free pastebin ───────────────────────────────────────────────
r = await PUT(KEY, 3, {
  v: 1,
  days: {
    '2026-10-19': { big: [task('k1', 'x'.repeat(4000))], fill: [] },
    'not-a-date': { big: [task('k2', 'junk')], fill: [] },
  },
  secretPayload: 'a'.repeat(5000),
});
b = await r.json();
check('text is capped', r.status === 200 && b.doc.days['2026-10-19'].big[0].text.length === 500, String((b.doc.days['2026-10-19']||{}).big));
check('a key that is not a date is dropped', !('not-a-date' in b.doc.days));
check('anything that is not the shape the app writes is dropped', !('secretPayload' in b.doc));

// Too many days, and a task with no id.
const many = { v: 1, days: {} };
for (let i = 0; i < 120; i++){
  const d = new Date(2026, 0, 1 + i);
  many.days[d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')] =
    { big: [task('m' + i, 'day ' + i)], fill: [{ text: 'no id' }] };
}
r = await PUT(KEY, 4, many); b = await r.json();
check('the history it will carry is bounded', r.status === 200 && Object.keys(b.doc.days).length === 70, String(Object.keys(b.doc.days).length));
check('…keeping the most recent days', !!b.doc.days['2026-04-30'] && !b.doc.days['2026-01-01']);
check('a task with no id is dropped rather than stored', b.doc.days['2026-04-30'].fill.length === 0);

// ── A database that will not answer is never an empty plan ────────────
db.__fail500 = 'day_plans';
r = await J('/day/' + KEY);
check('a failed read is a 503, NOT "no such plan"', r.status === 503, String(r.status));
r = await PUT(KEY, 5, day([task('t1', 'whatever')]));
check('…and a save on top of a failed read is refused too', r.status === 503, String(r.status));
db.__fail500 = '';
r = await J('/day/' + KEY);
check('…and it comes right again once the database does', r.status === 200);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
