// A 25mb cap on every path meant any request — unauthenticated, or to a path
// that does not exist — buffered 25mb into memory before a line of the handler
// ran. A few concurrent posts is then memory exhaustion that costs the attacker
// nothing and needs no account. The cap is now small by default and large only
// on the routes that genuinely carry a job, a price book, or an attachment.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const U = { user: 'u1', company: 'c1' };
const { port } = await startFakePostgrest({
  profiles: [{ id: U.user, company_id: U.company }],
  company_users: [{ company_id: U.company, user_id: U.user, role: 'owner' }],
  user_settings: [], invoices: [], job_revisions: [], jobs: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34603';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwt.sign({ id: U.user, email: 'u@x.co.nz', cid: U.company }, 'test-secret');
// A body of roughly N megabytes of valid JSON.
const blob = mb => JSON.stringify({ pad: 'x'.repeat(Math.round(mb * 1024 * 1024)) });
const post = (path, body, auth, method) => fetch(BASE + path, {
  method: method || 'POST',
  headers: { 'content-type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + tok } : {}) },
  body,
});

// ── the attack: big bodies at cheap, unauthenticated paths ────────
for (const [label, path] of [
  ['the login form', '/auth/login'],
  ['the crash reporter', '/client-error'],
  ['a path that does not even exist', '/no/such/route'],
]) {
  const r = await post(path, blob(2));
  const body = await r.text();
  check('2 MB at ' + label + ' is refused', r.status === 413, 'status ' + r.status);
  check('…as JSON the app can read, not an HTML error page',
    /PAYLOAD_TOO_LARGE/.test(body), body.slice(0, 60));
}

// ── and the routes that legitimately carry megabytes still do ─────
// 5 MB of job: a real one is photos + the aerial inside draw_state.
let r = await post('/jobs', JSON.stringify({
  client_name: 'Big job', site_address: 'Somewhere',
  draw_state: { state: { pad: 'x'.repeat(5 * 1024 * 1024) } },
}), true);
check('a 5 MB job save still goes through', r.status < 400, 'status ' + r.status);

r = await post('/settings', JSON.stringify({
  branding: { pad: 'x'.repeat(3 * 1024 * 1024) }, price_book: {},
}), true, 'PUT');
check('a 3 MB settings save (logo + gallery) still goes through', r.status < 400, 'status ' + r.status);

// ── the small cap is not so small it breaks ordinary use ──────────
r = await post('/auth/login', JSON.stringify({ email: 'u@x.co.nz', password: 'nope' }));
check('an ordinary login is unaffected', r.status !== 413, 'status ' + r.status);
r = await post('/jobs/x/invoices', JSON.stringify({ type: 'deposit', total_incl: 1200 }), true);
check('an ordinary invoice post is unaffected', r.status !== 413, 'status ' + r.status);
// 200kb of legitimately chunky JSON still fits under the 256kb default
r = await post('/q/sometoken/event', JSON.stringify({ type: 'update', message: 'x'.repeat(200 * 1024) }));
check('a chunky-but-sane body still fits the default cap', r.status !== 413, 'status ' + r.status);

// ── the split is declared, not accidental ─────────────────────────
const { readFile } = await import('node:fs/promises');
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('the default cap is small', /const jsonSmall = express\.json\(\{ limit: '256kb' \}\)/.test(src));
check('…and the large one is granted per route, not globally',
  /_wantsBigBody\(req\) \? jsonLarge : jsonSmall/.test(src) &&
  !/^app\.use\(express\.json\(\{ limit: '25mb' \}\)\);$/m.test(src));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
