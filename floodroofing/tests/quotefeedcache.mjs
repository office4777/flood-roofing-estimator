// /quote-activity on a cold morning: "canceling statement due to statement
// timeout" (5xx email, twice in a day, build 639394c). The feed now retries
// the read smaller and, failing that, serves the last good answer for the
// same office instead of a 500. A scope that never had a good read still
// fails honestly.
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
const now = new Date().toISOString();
const db = {
  companies: [{ id: 'cA', name: 'A Roofing', plan: 'team' }, { id: 'cB', name: 'B Roofing', plan: 'team' }],
  company_users: [{ company_id: 'cA', user_id: 'ua', role: 'owner' }, { company_id: 'cB', user_id: 'ub', role: 'owner' }],
  profiles: [], subscriptions: [],
  jobs: [
    { id: 'a1', user_id: 'ua', company_id: 'cA', client_name: 'Smith', created_at: now, updated_at: now,
      draw_state: { state: { quote: { ref: 'R1', client: 'Smith', share: { token: 't1', sentAt: now, status: 'sent', events: [] } } } } },
  ],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34681';
process.env.PORT = PORT;
delete process.env.DATABASE_URL; delete process.env.GAS_MAIL_URL;
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
await new Promise(r => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:' + PORT;
const tokFor = (uid, cid) => jwt.sign({ id: uid, email: uid + '@x.nz', cid }, 'test-secret');
const get = async (tok) => { const r = await fetch(BASE + '/quote-activity', { headers: { Authorization: 'Bearer ' + tok } });
  return { status: r.status, body: await r.json().catch(() => null) }; };

const warm = await get(tokFor('ua', 'cA'));
check('a good read lists the shared quote', warm.status === 200 && Array.isArray(warm.body) && warm.body.length === 1, JSON.stringify(warm));

db.__fail500 = 'jobs'; db.__failMsg = 'canceling statement due to statement timeout';
const cold = await get(tokFor('ua', 'cA'));
check('a statement timeout after a good read serves the last good feed, not a 500',
  cold.status === 200 && JSON.stringify(cold.body) === JSON.stringify(warm.body), cold.status + ' ' + JSON.stringify(cold.body).slice(0, 120));
const other = await get(tokFor('ub', 'cB'));
check('an office that never had a good read still gets the error, not another office\'s feed', other.status >= 500, String(other.status));
db.__fail500 = ''; db.__failMsg = '';
const back = await get(tokFor('ub', 'cB'));
check('and reads normally once the database answers again', back.status === 200 && back.body.length === 0, JSON.stringify(back));


// ── a drawing autosave no longer throws the feed away (2026-09-30) ──
// Every job save used to .clear() the cache, and a job saves every few
// seconds while anyone works on it: the feed — the database's single most
// expensive query that evening, 13 s a read — was recomputed on nearly every
// Home visit, and the last good answer was gone when the timeout path wanted
// it. Reads are observed by changing the database BEHIND the server's back:
// a cached answer does not see the change, a fresh read does.
const tokA = tokFor('ua', 'cA');
const put = (ds) => fetch(BASE + '/jobs/a1', { method: 'PUT',
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tokA },
  body: JSON.stringify({ draw_state: ds }) }).then(r => r.status);
const Q = (client, status) => ({ ref: 'R1', client, share: { token: 't1', sentAt: now, status, events: [] } });
const feedTxt = async () => JSON.stringify((await get(tokA)).body);

let st = await put({ state: { quote: Q('Smith', 'sent') }, draw: { v: 1 } });
await get(tokA);                                               // the server has now seen this quote
st = await put({ state: { quote: Q('Smith', 'sent') }, draw: { v: 2, moved: 'a corner' } });
db.jobs[0].draw_state.state.quote.share.status = 'SNEAK';      // changed behind the server's back
check('a save that only moves the drawing leaves the feed as it was — no fresh 13-second read',
  st < 300 && !/SNEAK/.test(await feedTxt()), 'save ' + st);

st = await put({ state: { quote: Q('Smith', 'opened') }, draw: { v: 3 } });
db.jobs[0].draw_state.state.quote.share.status = 'SNEAK-2';    // the same trick: a fresh read must see it
const fresh = await feedTxt();
check('…but a change to what the feed shows (the share moved) reads it again',
  st < 300 && /SNEAK-2/.test(fresh), fresh.slice(0, 160));

// Marked stale is not thrown away: a timeout straight after still has an answer.
await put({ state: { quote: Q('Smith', 'queried') }, draw: { v: 4 } });
db.__fail500 = 'jobs'; db.__failMsg = 'canceling statement due to statement timeout';
const afterStale = await get(tokA);
db.__fail500 = ''; db.__failMsg = '';
check('…and a feed marked stale by a save still serves its last good answer if the re-read times out',
  afterStale.status === 200 && Array.isArray(afterStale.body) && afterStale.body.length === 1,
  afterStale.status + ' ' + JSON.stringify(afterStale.body).slice(0, 100));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
