// THE MAINTENANCE SWITCH (2026-09-30), built for moving the database from
// Mumbai to Singapore. While the data is copied, nothing may be written to
// the old database — a save, a send, a customer's accept or an hourly email's
// stamp that lands after the final copy is lost the moment the server points
// at the new one, and a reminder stamped on the old database is SENT AGAIN
// from the new one.
//
// Pinned: writes are refused with 503 MAINTENANCE and reads carry on; a
// customer's quote open (which stamps the quote) is refused too; /health says
// the door is shut; a closed door raises no alarm email; the owner can be let
// through to test; a window with an end time closes itself; the switch is
// ADMIN_TOKEN-only; and every background job that writes checks the switch.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const now = new Date().toISOString();
const db = {
  __missing: [],
  companies: [{ id: 'cA', name: 'Flood Roofing', plan: 'team' }],
  company_users: [{ company_id: 'cA', user_id: 'ua', role: 'owner' }, { company_id: 'cA', user_id: 'ue', role: 'member' }],
  profiles: [], subscriptions: [], invoices: [], platform_state: [], comms_tasks: [], schedule_rows: [], schedule_blocks: [],
  usage_events: [], company_domains: [], company_mail_domains: [], user_settings: [], job_revisions: [],
  jobs: [
    { id: 'j1', user_id: 'ua', company_id: 'cA', client_name: 'Chris Walls', created_at: now, updated_at: now,
      draw_state: { state: { quote: { ref: '3270', client: 'Chris Walls', share: { token: 'tok3270', sentAt: now, status: 'sent', events: [] } } } } },
  ],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'admin-token-for-the-test-0123456789';
process.env.BILLING_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34693';
process.env.PORT = PORT;
delete process.env.DATABASE_URL; delete process.env.GAS_MAIL_URL; delete process.env.MAINTENANCE_UNTIL;
const alerts = [];
globalThis.__TEST_RECORD_ERROR = (kind, err, ctx) => alerts.push({ kind, msg: String(err && err.message || err), status: ctx && ctx.status });
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
await new Promise(r => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN = { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN };
const tok = (uid, email) => jwt.sign({ id: uid, email, cid: 'cA' }, 'test-secret');
const ARON = tok('ua', 'aron@floodroofing.co.nz'), ETHAN = tok('ue', 'ethan@floodroofing.co.nz');
const req = (method, path, t, body) => fetch(BASE + path, { method,
  headers: Object.assign({ 'content-type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
  body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, retry: r.headers.get('retry-after'), body: await r.json().catch(() => null) }));
const save = (t, v) => req('PUT', '/jobs/j1', t, { draw_state: { state: { quote: db.jobs[0].draw_state.state.quote }, draw: { v } } });
const admin = (body) => fetch(BASE + '/admin/maintenance', { method: 'POST', headers: ADMIN, body: JSON.stringify(body) }).then(r => r.json());

// ── off, as it always is ──────────────────────────────────────────
let r = await save(ETHAN, 1);
check('with the switch off a save goes through as always', r.status < 300, String(r.status));
let h = await req('GET', '/health');
check('…and /health says the door is open', h.status === 200 && h.body.maintenance && h.body.maintenance.on === false, JSON.stringify(h.body && h.body.maintenance));

// ── the switch is the owner's alone ──────────────────────────────
const noTok = await fetch(BASE + '/admin/maintenance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
check('nobody without ADMIN_TOKEN can throw it', noTok.status === 404, String(noTok.status));
h = await req('GET', '/health');
check('…and trying leaves it off', h.body.maintenance.on === false);

// ── on ────────────────────────────────────────────────────────────
const until = new Date(Date.now() + 30 * 60e3).toISOString();
let st = await admin({ on: true, until, allow: [] });
check('the owner switches it on, with an end time', st.on === true && !!st.until, JSON.stringify(st));
h = await req('GET', '/health');
check('/health answers during maintenance and says the door is shut', h.status === 200 && h.body.maintenance.on === true && !!h.body.maintenance.until, JSON.stringify(h.body.maintenance));

alerts.length = 0;
const before = JSON.stringify(db.jobs[0].draw_state);
r = await save(ETHAN, 2);
check('a save is refused with 503 MAINTENANCE', r.status === 503 && r.body && r.body.code === 'MAINTENANCE', r.status + ' ' + JSON.stringify(r.body));
check('…and nothing reaches the database', JSON.stringify(db.jobs[0].draw_state) === before);
check('…with a message a person can read, saying nothing is lost', /faster server/.test(r.body.error) && /Nothing is lost/.test(r.body.error), r.body.error);
check('…and a Retry-After, so anything automatic backs off', r.retry === '300', String(r.retry));

r = await req('GET', '/jobs', ETHAN);
check('reading carries on — people can still look at their jobs', r.status === 200, String(r.status));

r = await req('GET', '/q/tok3270');
check('a customer opening a quote link is asked to wait (the open stamps the quote, so it is a write)',
  r.status === 503 && r.body && r.body.code === 'MAINTENANCE', r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
r = await req('POST', '/q/tok3270/event', null, { type: 'accepted', name: 'Chris Walls' });
check('…and a customer’s accept waits too, rather than landing in the database being left behind', r.status === 503, String(r.status));

check('a closed door raises no alarm email', alerts.filter(a => /MAINTENANCE|faster server/.test(a.msg) || a.status === 503).length === 0, JSON.stringify(alerts));

// ── the owner is let through to test the new database ─────────────
st = await admin({ on: true, until, allow: ['aron@floodroofing.co.nz'] });
r = await save(ARON, 3);
check('someone on the allow list can save — the owner testing before anyone else is let in', r.status < 300, String(r.status));
r = await save(ETHAN, 4);
check('…while everyone else still waits', r.status === 503, String(r.status));

// ── it closes itself ──────────────────────────────────────────────
st = await admin({ on: true, until: new Date(Date.now() - 1000).toISOString(), allow: [] });
r = await save(ETHAN, 5);
check('a window whose end time has passed is open again by itself', r.status < 300 && st.on === false, r.status + ' ' + JSON.stringify(st));

// ── off ───────────────────────────────────────────────────────────
await admin({ on: true, until, allow: [] });
st = await admin({ on: false });
r = await save(ETHAN, 6);
check('switched off, saves go through at once', st.on === false && r.status < 300, r.status + ' ' + JSON.stringify(st));

// ── every background job that writes checks the switch ────────────
// A reminder stamped on the old database mid-move would be sent AGAIN from
// the new one; each of these must stand down while the door is shut.
const src = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const jobs = ['_inboxSweep', '_pruneUsage', '_reminderTick', '_trialEndedTick', '_trialDripTick', '_quietTrialTick', '_fergusAutoVersionNow', 'recordUsage'];
const unguarded = jobs.filter(fn => !new RegExp('async function ' + fn + '\\([^)]*\\)\\{\\s*\\n\\s*if \\(_maintOn\\(\\)\\) return;').test(src));
check('every background job that writes stands down during maintenance', unguarded.length === 0, unguarded.join(', ') || 'all ' + jobs.length + ' guarded');

// ── the boot setting expires by itself ────────────────────────────
check('MAINTENANCE_UNTIL is read at boot and only counts while it is in the future',
  /process\.env\.MAINTENANCE_UNTIL/.test(src) && /until > Date\.now\(\)/.test(src));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
