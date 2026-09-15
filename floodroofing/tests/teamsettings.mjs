// A business has ONE set of settings, and a second person signing in does not
// take it over.
//
// Every user carries their own user_settings row, and the company_id back-fill
// stamped them all with the same company — so "the company's settings row =
// the most recently updated one" meant the business's settings were whoever
// saved last. The day a second roofer (a member, not the owner) used his
// account, the owner's app said "Fergus isn't connected yet" on an account
// that had been connected minutes earlier, the price book reverted, and the
// job-number counter moved to a row that had never issued a number.
//
// The canonical row is now the OWNER's, deterministically. Fields the owner's
// row does not have still fall back to the newest sibling that does, because
// the rows have been flip-flopping and real data is sitting on both.
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

const CO = 'company-flood';
const OWNER  = { user: 'user-aron',  company: CO };
const MEMBER = { user: 'user-ethan', company: CO };

const { port, db } = await startFakePostgrest({
  profiles: [{ id: OWNER.user, company_id: CO }, { id: MEMBER.user, company_id: CO }],
  company_users: [{ company_id: CO, user_id: OWNER.user, role: 'owner' },
                  { company_id: CO, user_id: MEMBER.user, role: 'member' }],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }],
  user_settings: [
    // The owner's row: the business's real settings.
    { user_id: OWNER.user, company_id: CO, updated_at: '2026-09-10T08:00:00Z',
      branding: { company_name: 'Flood Roofing' },
      jms_keys: { fergus: 'fergPAT_the_real_key' },
      price_book: { steel: 44.5 }, quote_defaults: { next_job_no: '03206' },
      selectables: {}, ui_flags: {}, billing_email: 'office@floodroofing.co.nz' },
    // Ethan's row, written LAST — he signed in and the app saved his settings.
    // No Fergus key, no price book: it is the shell every account starts with.
    { user_id: MEMBER.user, company_id: CO, updated_at: '2026-09-15T21:00:00Z',
      branding: {}, jms_keys: {}, price_book: {}, quote_defaults: {},
      selectables: {}, ui_flags: { tour_done: true }, billing_email: '' },
  ],
  jobs: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.FERGUS_HOST = '127.0.0.1';
delete process.env.FERGUS_API_KEY;
delete process.env.FERGUS_COMPANY_ID;
const PORT = process.env.TEST_PORT || '34799';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user + '@floodroofing.co.nz', cid: w.company }, 'test-secret');
const as = (w, path, opts) => fetch(BASE + path, {
  ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(w), ...((opts || {}).headers || {}) },
});

// ── the report: the owner's Fergus goes missing ──────────────────
let s = await (await as(OWNER, '/settings')).json();
check('the owner still sees the company Fergus key after a teammate saves',
  (s.jms_keys || {}).fergus === 'fergPAT_the_real_key', JSON.stringify(s.jms_keys));
check('…and the company branding, not a teammate\'s empty one',
  (s.branding || {}).company_name === 'Flood Roofing', JSON.stringify(s.branding));
check('…and the price book',
  (s.price_book || {}).steel === 44.5, JSON.stringify(s.price_book));

// The member reads the SAME settings — that is the point of a business account.
let m = await (await as(MEMBER, '/settings')).json();
check('the teammate reads the business\'s settings, not his own empty row',
  (m.jms_keys || {}).fergus === 'fergPAT_the_real_key' && (m.price_book || {}).steel === 44.5,
  JSON.stringify({ k: m.jms_keys, p: m.price_book }));

// And Fergus itself answers for both of them. The upstream host points at a
// port nothing listens on, so 502 means "we got past the key check with a
// key" and 400 not_connected means "no key was found" — which is the bug.
for (const [who, label] of [[OWNER, 'the owner'], [MEMBER, 'the teammate']]){
  const r = await as(who, '/fergus/jobs?pageSize=1');
  const b = await r.json().catch(() => ({}));
  check('Fergus is connected for ' + label, r.status !== 400 || b.error !== 'not_connected',
    'status ' + r.status + ' ' + JSON.stringify(b).slice(0, 60));
}

// ── a field only the teammate's row has is not lost ──────────────
// The rows have been flip-flopping for weeks, so real settings are sitting on
// both. A value the canonical row does not have falls back to the newest
// sibling that does.
db.user_settings[1].quote_defaults = { deposit_percent: 20 };
db.user_settings[0].quote_defaults = {};
s = await (await as(OWNER, '/settings')).json();
check('a setting written onto the teammate\'s row while it was "the" row survives',
  (s.quote_defaults || {}).deposit_percent === 20, JSON.stringify(s.quote_defaults));

// ── an EMPTY key on the canonical row does not win ───────────────
// {fergus:''} is not a value. Merging wholesale would have let that empty
// string beat a real key on the other row — the same disconnect, one layer up.
db.user_settings[0].jms_keys = { fergus: '' };
db.user_settings[1].jms_keys = { fergus: 'fergPAT_written_on_ethans_row' };
s = await (await as(OWNER, '/settings')).json();
check('an empty key on the owner\'s row loses to a real one on the other',
  (s.jms_keys || {}).fergus === 'fergPAT_written_on_ethans_row', JSON.stringify(s.jms_keys));

// ── the save lands on the canonical row, so the company heals ────
db.user_settings[0].jms_keys = { fergus: 'fergPAT_the_real_key' };
db.user_settings[1].jms_keys = {};
await as(OWNER, '/settings', { method: 'PUT', body: JSON.stringify({
  branding: { company_name: 'Flood Roofing Ltd' }, quote_defaults: {}, price_book: { steel: 46 }, jms_keys: null }) });
check('a save writes onto the owner\'s row, not whichever was newest',
  db.user_settings[0].branding.company_name === 'Flood Roofing Ltd' &&
  !(db.user_settings[1].branding || {}).company_name,
  JSON.stringify([db.user_settings[0].branding, db.user_settings[1].branding]));
check('…and a save that carries no jms_keys still does not drop the Fergus key',
  (db.user_settings[0].jms_keys || {}).fergus === 'fergPAT_the_real_key',
  JSON.stringify(db.user_settings[0].jms_keys));

// ── the job-number counter stays on one row ──────────────────────
// Two people handing out 03206 on the same morning is what this prevents:
// the counter is read from and written to the same row every time, whoever
// asks for the number.
db.user_settings[0].quote_defaults = { next_job_no: '03206' };
db.user_settings[1].quote_defaults = { next_job_no: '06121' };
const n1 = await (await as(OWNER, '/settings/next-job-no', { method: 'POST', body: '{}' })).json();
const n2 = await (await as(MEMBER, '/settings/next-job-no', { method: 'POST', body: '{}' })).json();
check('the owner is issued the business\'s next job number', n1.jobNo === '03206', JSON.stringify(n1));
check('…and the teammate gets the NEXT one, off the same counter, not 06121',
  n2.jobNo === '03207', JSON.stringify(n2));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
