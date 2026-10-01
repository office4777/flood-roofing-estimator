// A CUSTOMER'S ACCEPTANCE IS NEVER OVERWRITTEN BY AN OFFICE SAVE (2026-10-02).
//
// Job 3288: the customer accepted at 3:20 pm; at 3:28 pm an office screen still
// holding the quote as it was before published it again (PUT /jobs/:id/quote,
// which had no check at all), and the acceptance, the customer's picks, their
// events and the frozen Accepted copy were gone — the office read "Not accepted
// yet". Pinned here, through both write routes:
//   • a stale copy (it has not seen the acceptance) gets it put back — the
//     acceptance, the accepted picks, the frozen copy, the share's status — and
//     the response says so;
//   • the office's deliberate moves still work: Undo acceptance and a new draft
//     after an acceptance both carry the frozen copy, so they are not "stale";
//   • the customer's events are always kept, and an "opened" status is not
//     knocked back to "sent" by a copy that has not seen it;
//   • a different link (a new token) is left alone.
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

const CO = 'company-flood', U = 'user-aron';
const ACC = { name: 'Miria Lovey Henry', at: '2026-10-01T02:20:09.000Z', total: 7044.45, options: [] };
const FROZEN = { id: 'accabc', at: ACC.at, label: 'Accepted quote', total: 7044.45, quote: { ref: '3288', proposalOptions: { extras: { paint: 'yes' } } } };
const storedQuote = () => ({
  ref: '3288', client: 'Miria Lovey Henry',
  proposalOptions: { profile: 'corrugate', extras: { paint: 'yes' } },
  accepted: ACC,
  versions: { sent: { id: 'sent1', quote: {} }, accepted: FROZEN, drafts: [], media: { m1: 'data:image/png;base64,AA' } },
  share: { token: 'tok-3288', status: 'accepted', acceptedAt: ACC.at, sentAt: '2026-10-01T01:57:26.000Z',
           events: [{ type: 'opened', at: '2026-10-01T02:10:00.000Z' }, { type: 'accepted', at: ACC.at }] },
});
const { port, db } = await startFakePostgrest({
  profiles: [{ id: U, company_id: CO }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'active', plan: 'business' }],
  user_settings: [], invoices: [],
  jobs: [{ id: 'job-3288', user_id: U, company_id: CO, client_name: 'Miria Lovey Henry', site_address: '72 Fairlie Crescent',
           status: 'quoted', created_at: '2026-09-30T01:00:00.000Z', updated_at: '2026-10-01T02:20:09.000Z',
           version_of: null, version_name: null, order_sent: null, settings: {},
           draw_state: { draw: { lines: [] }, state: { quote: storedQuote() } } }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34831';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: 'aron@floodroofing.co.nz', cid: CO }, 'test-secret');
const put = (path, body) => fetch(BASE + path, { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify(body) });
const held = () => db.jobs.find(j => j.id === 'job-3288').draw_state.state.quote;
const reset = () => { db.jobs.find(j => j.id === 'job-3288').draw_state.state.quote = storedQuote(); };

// The screen that never saw the acceptance: the quote as it was at the send.
const stale = () => ({
  ref: '3288', client: 'Miria Lovey Henry',
  proposalOptions: { profile: 'corrugate', extras: {} },
  versions: { sent: { id: 'sent1', quote: {} }, accepted: null, drafts: [] },
  share: { token: 'tok-3288', status: 'sent', sentAt: '2026-10-01T01:57:26.000Z', events: [] },
});

// ── the light publish (the route that wiped job 3288) ─────────────
let r = await put('/jobs/job-3288/quote', { quote: stale() });
let j = await r.json();
let q = held();
check('a stale publish is still taken (it is not refused)', r.status === 200 && j.ok, JSON.stringify(j));
check('…but the customer’s acceptance is put back: accepted, the share’s status, the frozen Accepted copy',
  q.accepted && q.accepted.total === 7044.45 && q.share.status === 'accepted' && q.share.acceptedAt === ACC.at &&
  q.versions.accepted && q.versions.accepted.id === 'accabc', JSON.stringify({ acc: q.accepted, st: q.share.status, v: q.versions.accepted && q.versions.accepted.id }));
check('…with the picks they accepted, not the stale screen’s', q.proposalOptions.extras.paint === 'yes', JSON.stringify(q.proposalOptions));
check('…the pictures the frozen copy points at, and their events', q.versions.media && q.versions.media.m1 && q.share.events.length === 2, JSON.stringify(q.share.events));
check('…and the office is told it happened (keptAcceptance)', j.keptAcceptance === true, JSON.stringify(j));

// ── the full job save, the same ───────────────────────────────────
reset();
r = await put('/jobs/job-3288', { draw_state: { draw: { lines: [] }, state: { quote: stale() } } });
j = await r.json();
q = held();
check('a stale full job save keeps the acceptance too, and says so',
  r.status === 200 && q.share.status === 'accepted' && q.accepted && q.versions.accepted && q.versions.accepted.id === 'accabc' && j.keptAcceptance === true,
  JSON.stringify({ status: r.status, j, st: q.share.status }));

// ── the office's deliberate moves still work ──────────────────────
reset();
const undo = storedQuote(); delete undo.accepted; undo.share.status = 'opened';            // Undo acceptance: the frozen copy stays on record
r = await put('/jobs/job-3288/quote', { quote: undo }); j = await r.json(); q = held();
check('Undo acceptance (the office has seen it — it carries the frozen copy) is allowed', !q.accepted && q.share.status === 'opened' && !j.keptAcceptance, JSON.stringify({ acc: q.accepted, st: q.share.status }));
reset();
const draft = storedQuote(); delete draft.accepted; draft.share.status = 'sent'; draft.proposalOptions = { profile: '5rib', extras: {} };   // a new draft after the acceptance
r = await put('/jobs/job-3288/quote', { quote: draft }); j = await r.json(); q = held();
check('a new draft after an acceptance (it keeps the frozen copy) is allowed, with its own picks',
  !q.accepted && q.share.status === 'sent' && q.proposalOptions.profile === '5rib' && q.versions.accepted.id === 'accabc' && !j.keptAcceptance, JSON.stringify({ st: q.share.status, po: q.proposalOptions }));

// ── events and an opened status ───────────────────────────────────
reset();
const sq = held(); sq.accepted = null; sq.versions.accepted = null; sq.share.status = 'opened'; sq.share.events = [{ type: 'opened', at: '2026-10-01T02:10:00.000Z' }];
const st2 = stale(); st2.share.events = [{ type: 'sent', at: '2026-10-01T01:57:30.000Z' }];
r = await put('/jobs/job-3288/quote', { quote: st2 }); q = held();
check('a copy that has not seen the customer open the quote does not knock "opened" back to "sent"', q.share.status === 'opened', q.share.status);
check('…and the customer’s events are kept beside the office’s', q.share.events.length === 2 && q.share.events.some(e => e.type === 'opened'), JSON.stringify(q.share.events));

// ── a different link is left alone ────────────────────────────────
reset();
const other = stale(); other.share.token = 'tok-new';
r = await put('/jobs/job-3288/quote', { quote: other }); q = held();
check('a quote with a different link (a new token) is written as it is', q.share.token === 'tok-new' && !q.accepted, JSON.stringify({ tok: q.share.token }));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
