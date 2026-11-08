// AN ACCEPTED JOB STAYS ACCEPTED WHILE THE OFFICE WORKS A DRAFT (2026-11-06,
// job 3341, the owner: "the app automatically created a new quote draft, which
// then made it look like it wasn't accepted"). A draft made off an accepted
// quote sets the link back to 'sent'; the board's feed reads the job's frozen
// Accepted version and keeps it under Accepted until the office undoes the
// acceptance or sends the customer a new quote.
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
const sentAt = '2026-11-04T20:00:00.000Z', accAt = '2026-11-05T20:09:22.012Z';
const acc = { name: 'Doug Rodgers', total: 8964.62, at: accAt };
const vAcc = { id: 'vA', at: accAt, label: 'Accepted quote', total: 8964.62, quote: { ref: '3341', accepted: acc } };
const job = (id, ref, quote) => ({ id, user_id: 'ua', company_id: 'cA', client_name: 'Client ' + ref, created_at: now, updated_at: now,
  draw_state: { state: { quote: Object.assign({ ref, client: 'Client ' + ref }, quote) } } });
const db = {
  companies: [{ id: 'cA', name: 'A Roofing', plan: 'team' }],
  company_users: [{ company_id: 'cA', user_id: 'ua', role: 'owner' }],
  profiles: [], subscriptions: [],
  jobs: [
    // accepted, as the customer left it
    job('j1', '3301', { accepted: acc, share: { token: 't1', sentAt, status: 'accepted', events: [] }, versions: { accepted: vAcc } }),
    // a draft made off the acceptance (the 3341 shape: no stamp, status sent)
    job('j2', '3341', { share: { token: 't2', sentAt, status: 'sent', events: [] }, versions: { accepted: vAcc } }),
    // the same with today's stamp, and the customer has since opened the link
    job('j3', '3342', { share: { token: 't3', sentAt, status: 'opened', draftAfterAccept: true, events: [] }, versions: { accepted: vAcc } }),
    // acceptance undone (today's stamp)
    job('j4', '3343', { share: { token: 't4', sentAt, status: 'opened', unacceptedAt: '2026-11-06T01:00:00.000Z', events: [] }, versions: { accepted: vAcc } }),
    // acceptance undone before the stamp existed
    job('j5', '3344', { share: { token: 't5', sentAt, status: 'opened', events: [] }, versions: { accepted: vAcc } }),
    // a new quote sent to the customer after the acceptance
    job('j6', '3345', { share: { token: 't6', sentAt: '2026-11-06T02:00:00.000Z', status: 'sent', draftAfterAccept: true, events: [] }, versions: { accepted: vAcc } }),
    // never accepted
    job('j7', '3346', { share: { token: 't7', sentAt, status: 'sent', events: [] } }),
  ],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34697';
process.env.PORT = PORT;
delete process.env.DATABASE_URL; delete process.env.GAS_MAIL_URL;
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
await new Promise(r => setTimeout(r, 400));
const tok = jwt.sign({ id: 'ua', email: 'ua@x.nz', cid: 'cA' }, 'test-secret');
const r = await fetch('http://127.0.0.1:' + PORT + '/quote-activity?fresh=1', { headers: { Authorization: 'Bearer ' + tok } });
const feed = await r.json();
const by = {}; (Array.isArray(feed) ? feed : []).forEach(f => { by[f.ref] = f; });
const st = ref => (by[ref] || {}).status;

check('the feed answers', r.status === 200 && Array.isArray(feed) && feed.length === 7, r.status + ' ' + JSON.stringify(feed).slice(0, 160));
check('an accepted job reads Accepted', st('3301') === 'accepted' && by['3301'].accepted && by['3301'].accepted.total === 8964.62, JSON.stringify(by['3301']));
check('a draft made off the acceptance (job 3341\'s shape) still reads Accepted, with who and how much',
  st('3341') === 'accepted' && by['3341'].accepted && by['3341'].accepted.name === 'Doug Rodgers' && by['3341'].accepted.total === 8964.62 && by['3341'].draftAfterAccept === true,
  JSON.stringify(by['3341']));
check('…and still does once the customer opens the link to the draft', st('3342') === 'accepted', JSON.stringify(by['3342']));
check('an acceptance the office undid is not Accepted (today\'s undo)', st('3343') === 'opened', JSON.stringify(by['3343']));
check('…nor one undone before the stamp existed', st('3344') === 'opened', JSON.stringify(by['3344']));
check('a new quote sent to the customer after the acceptance reads Sent', st('3345') === 'sent', JSON.stringify(by['3345']));
check('a quote never accepted reads Sent', st('3346') === 'sent' && !by['3346'].accepted, JSON.stringify(by['3346']));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
