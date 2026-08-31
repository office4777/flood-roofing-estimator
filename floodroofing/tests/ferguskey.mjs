// One business's Fergus is not everyone's Fergus.
//
// The Fergus proxy authenticated every company's requests with the single
// FERGUS_API_KEY env var — a leftover from the single-tenant days. The day
// a second business got a Business-tier account, its "Fergus jobs" list
// filled with the FIRST business's live jobs: client names, addresses, the
// lot. This suite pins the fix: each company's requests use ITS stored key
// (Settings → Integrations, jms_keys.fergus), the env key serves only the
// company named by FERGUS_COMPANY_ID, and a company with no key gets a
// clear 400 — never someone else's data.
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

const A = { user: 'user-a', company: 'company-a' };   // the platform owner's original install
const B = { user: 'user-b', company: 'company-b' };   // a new subscriber
const C = { user: 'user-c', company: 'company-c' };   // another new subscriber

const { port } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: B.user, company_id: B.company },
             { id: C.user, company_id: C.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: B.company, user_id: B.user, role: 'owner' },
                  { company_id: C.company, user_id: C.user, role: 'owner' }],
  companies: [{ id: A.company, name: 'Flood Roofing', plan: 'business' },
              { id: B.company, name: 'John Doe Roofing', plan: 'business' },
              { id: C.company, name: 'Third Roofing', plan: 'business' }],
  user_settings: [], jobs: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// The pre-multi-tenant setup: a global key on the env. It must serve NOBODY
// until FERGUS_COMPANY_ID names its owner. Upstream host points at a local
// port nothing listens on, so a request that passes the key check fails
// fast with 502 — reaching upstream at all is what these checks measure.
process.env.FERGUS_API_KEY = 'fergPAT_env_flood_roofing';
process.env.FERGUS_HOST = '127.0.0.1';
delete process.env.FERGUS_COMPANY_ID;
const PORT = process.env.TEST_PORT || '34741';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user + '@x.co.nz', cid: w.company }, 'test-secret');
const as = (w, path, opts) => fetch(BASE + path, {
  ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(w), ...((opts || {}).headers || {}) },
});
const j = r => r.json();

// ── the leak the fix exists for ───────────────────────────────────
let r = await as(B, '/fergus/jobs?pageSize=5');
let body = await j(r);
check('a company with no key of its own never rides the env key',
  r.status === 400 && body.error === 'not_connected', 'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 80));
check('…and the error tells them where to connect',
  /Settings/.test(body.message || ''), body.message);

r = await as(B, '/jms/debug'); body = await j(r);
check('/jms/debug reports THIS company has no key', body.fergus && body.fergus.key_set === false,
  JSON.stringify(body.fergus || {}).slice(0, 80));

// ── a company's own key connects it — and only it ─────────────────
r = await as(B, '/settings', { method: 'PUT', body: JSON.stringify({
  branding: { company_name: 'John Doe Roofing' },
  jms_keys: { fergus: 'fergPAT_bbbb' },
}) });
check('storing a Fergus key via PUT /settings works', r.status === 200, 'status ' + r.status);

r = await as(B, '/fergus/jobs?pageSize=5');
check('with a stored key the proxy reaches for upstream (502 here — nothing listens)',
  r.status === 502, 'status ' + r.status);

r = await as(B, '/jms/debug'); body = await j(r);
check('/jms/debug now sees the key, format checked', body.fergus && body.fergus.key_set === true &&
  body.fergus.key_format_ok === true, JSON.stringify(body.fergus || {}).slice(0, 80));

r = await as(A, '/fergus/jobs?pageSize=5'); body = await j(r);
check("B's key does not bleed to company A", r.status === 400 && body.error === 'not_connected',
  'status ' + r.status);

// ── the env key serves exactly the company that owns it ───────────
process.env.FERGUS_COMPANY_ID = A.company;
r = await as(A, '/fergus/jobs?pageSize=5');
check('FERGUS_COMPANY_ID grants the env key to its named company', r.status === 502, 'status ' + r.status);
r = await as(C, '/fergus/jobs?pageSize=5'); body = await j(r);
check('…and to nobody else', r.status === 400 && body.error === 'not_connected', 'status ' + r.status);

// ── the files surface is gated the same way ───────────────────────
r = await as(C, '/fergus-files/list?jobId=123'); body = await j(r);
check('fergus-files routes refuse a keyless company too',
  r.status === 400 && body.error === 'not_connected', 'status ' + r.status);

// ── stored keys survive writers that don't know about them ────────
r = await as(B, '/settings', { method: 'PUT', body: JSON.stringify({
  branding: { company_name: 'John Doe Roofing', phone: '021 000 000' },
}) });
check('a settings save without jms_keys succeeds', r.status === 200, 'status ' + r.status);
r = await as(B, '/settings'); body = await j(r);
check('…and does not wipe the stored Fergus key',
  body.jms_keys && body.jms_keys.fergus === 'fergPAT_bbbb', JSON.stringify(body.jms_keys || {}).slice(0, 60));
r = await as(B, '/fergus/jobs?pageSize=5');
check('…so the connection still stands', r.status === 502, 'status ' + r.status);

// ── the download proxy never carries the key off Fergus ───────────
// endsWith on the raw host let attacker-registerable lookalikes through
// (notfergus.com ends with fergus.com). Only the exact allowed host or a
// dot-separated subdomain of it may ever see the key.
r = await as(B, '/fergus-files/download?url=' + encodeURIComponent('https://attacker.com/steal'));
check('an unrelated host never sees the key', r.status === 403, 'status ' + r.status);
r = await as(B, '/fergus-files/download?url=' + encodeURIComponent('https://127.0.0.1.attacker.com/steal'));
check('…nor does a host that merely CONTAINS the allowed one', r.status === 403, 'status ' + r.status);
r = await as(B, '/fergus-files/download?url=' + encodeURIComponent('https://127.0.0.1:1/x'));
check('…while the exact allowed host still passes the guard (502 — nothing listens)',
  r.status === 502, 'status ' + r.status);

// ── clearing the field is how you disconnect — that must still work ──
r = await as(B, '/settings', { method: 'PUT', body: JSON.stringify({
  branding: { company_name: 'John Doe Roofing' },
  jms_keys: { fergus: '' },
}) });
check('an explicit empty key is honoured', r.status === 200, 'status ' + r.status);
r = await as(B, '/fergus/jobs?pageSize=5'); body = await j(r);
check('…and disconnects the company', r.status === 400 && body.error === 'not_connected', 'status ' + r.status);

// ── ui_flags: popup dismissals stick to the account, merge-only ───
r = await as(B, '/settings/ui-flags', { method: 'PUT', body: JSON.stringify({ tour_done: true }) });
body = await j(r);
check('a popup dismissal saves to the account', r.status === 200 && body.ui_flags.tour_done === true,
  JSON.stringify(body));
r = await as(B, '/settings/ui-flags', { method: 'PUT', body: JSON.stringify({ setup_done: true }) });
body = await j(r);
check('…and a later partial write MERGES — the first flag survives',
  body.ui_flags.tour_done === true && body.ui_flags.setup_done === true, JSON.stringify(body.ui_flags));
body = await j(await as(B, '/settings'));
check('…so any device reads both on login', body.ui_flags &&
  body.ui_flags.tour_done === true && body.ui_flags.setup_done === true, JSON.stringify(body.ui_flags));

const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
