// A CUSTOMER ACCEPTS THE PRICES THE QUOTE STILL CARRIES (2026-10-25, job 3334:
// "Aidan agreed to $34,231.35, fix the accepted total"). The acceptance
// recorded $35,252.82 — the figure the customer's browser reported, priced
// from a `share.priced` block the quote no longer carried (its extra roofs at
// $1,497.33 / $908.51 / $1,173.01 where the quote read $1,400.21 / $819.64 /
// $1,084.14). Pinned here:
//   • the one-off correction of 3334's recorded total: applied once, only to
//     the job it names, the old figure kept, the Fergus description re-written;
//   • a page opened on prices the quote has since moved off cannot accept
//     them (409 QUOTE_CHANGED) — the fingerprint is computed by the APP's own
//     function, lifted from app.html, over the quote as the customer's page
//     receives it, so the two halves are held to the same string;
//   • a page from before the fingerprint is not checked;
//   • an office save after an acceptance never re-prices the customer's copy,
//     while Undo acceptance still can.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The app's fingerprint, lifted verbatim.
const APP = readFileSync(_j(_ROOT, 'frontend', 'app.html'), 'utf8');
const lift = (name) => {
  const i = APP.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not in app.html: ' + name);
  let k = APP.indexOf('{', i), depth = 0;
  for (; k < APP.length; k++){ if (APP[k] === '{') depth++; else if (APP[k] === '}' && --depth === 0) break; }
  return APP.slice(i, k + 1);
};
const appFp = new Function(lift('_fnv') + '\n' + lift('_canonJson') + '\n' + lift('_qpPricedFp') + '\nreturn _qpPricedFp;')();

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const CO = 'c1', U = 'u1';
const PRICED = () => ({ v: 1, gstRate: 15, base: 25950.63, grade: { maxam: 0, colorzen: 0 }, gradeLabel: { maxam: 'MAXAM', colorzen: 'ColorZen' },
  gaugeUpgrade: 900, profileLocks: { corrugate: '', '5rib': '55' }, profileLabel: {}, profile: {}, gutter: {}, gutterLabel: {}, gutterUplift: {},
  gutterOverride: null, bracketExt: {}, scaffoldUplift: 500, downpipes: 0,
  extraRoof: [1217.57, 712.73, 942.73, 942.73], extraRoofLabel: ['Roof 3', 'Roof 4', 'Roof 5', 'Roof 6'], extras: {} });
const job3334 = () => ({ ref: '3334', client: 'Double Two Dairies', gstRate: 15,
  proposalOptions: { steelGrade: 'colorzen', extraRoofsSel: { 0: true, 1: true, 2: true, 3: true } },
  accepted: { name: 'Double Two Dairies', at: ago(1), total: 35252.82, options: [] },
  versions: { sent: null, drafts: [], accepted: { id: 'acc1', at: ago(1), label: 'Accepted quote', total: 35252.82,
    quote: { ref: '3334', accepted: { name: 'Double Two Dairies', total: 35252.82 } } } },
  share: { token: 'tok-3334', status: 'accepted', acceptedAt: ago(1), sentAt: ago(3), sentTotal: 34231.35,
           fergusAcceptDescAt: ago(1), fergus: { jobId: 'FJ-77' }, priced: PRICED(), events: [] } });
const openQuote = (token) => ({ ref: '5001', client: 'Open Customer', gstRate: 15, proposalOptions: {},
  lineItems: [{ desc: 'Re-roof', qty: 1, unit: 1000 }],
  share: { token, status: 'sent', sentAt: ago(1), sentTotal: 1150, priced: { v: 1, gstRate: 15, base: 1000, grade: {}, gradeLabel: {},
    gaugeUpgrade: 0, profileLocks: {}, profileLabel: {}, profile: {}, gutter: {}, gutterLabel: {}, gutterUplift: {}, gutterOverride: null,
    bracketExt: {}, scaffoldUplift: 0, downpipes: 0, extraRoof: [], extraRoofLabel: [], extras: {} }, events: [] } });
const J = (id, client, quote, co, site) => ({ id, user_id: U, company_id: co || CO, client_name: client, site_address: site || '368 Dunn Road, Ruawai',
  status: 'quoted', created_at: ago(5), updated_at: ago(1), version_of: null, version_name: null, order_sent: null, settings: {},
  draw_state: { draw: { lines: [] }, state: { quote } } });

const { port, db } = await startFakePostgrest({
  profiles: [{ id: U, company_id: CO, email: 'office@flood.nz' }, { id: 'u2', company_id: 'c2', email: 'x@other.nz' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' }],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'team' }, { id: 'c2', name: 'Other Co', plan: 'team' }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'active', plan: 'team' }],
  user_settings: [{ user_id: U, company_id: CO, updated_at: ago(2), branding: { company_name: 'Flood Roofing' },
    jms_keys: { fergus: 'fergus-test-key' }, quote_defaults: { email: { accept_office_on: false, accept_cust_on: false } } }],
  platform_state: [], invoices: [], comms_tasks: [], job_messages: [],
  jobs: [
    J('j-3334', 'Double Two Dairies', job3334()),
    // the same number at another business, at the same wrong figure: not ours to touch
    J('j-other', 'Double Two Dairies', job3334(), 'c2', '12 Other Street, Dargaville'),
    // the same customer, a different quote
    J('j-3335', 'Double Two Dairies', Object.assign(job3334(), { ref: '3335' })),
    J('j-open', 'Open Customer', openQuote('tok-open'), CO, '1 Test Road'),
    J('j-old', 'Old Page Customer', openQuote('tok-old'), CO, '2 Test Road'),
  ],
});

const fergus = { desc: [], job: { id: 'FJ-77', description: 'Customer rang about a leak.' } };
globalThis.__TEST_HTTPS = (host, path, method, headers, body) => {
  if (!/fergus/.test(String(host))) return Promise.resolve({ status: 500, body: '{}' });
  if (method === 'GET' && /\/jobs\/FJ-77$/.test(path)) return Promise.resolve({ status: 200, body: JSON.stringify({ data: fergus.job }) });
  if (method === 'PATCH' && /\/jobs\/FJ-77$/.test(path)){
    fergus.desc.push(String((body || {}).description || '')); fergus.job.description = String((body || {}).description || '');
    return Promise.resolve({ status: 200, body: '{"ok":true}' });
  }
  return Promise.resolve({ status: 200, body: JSON.stringify({ data: [] }) });
};

process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'as-test-token';
process.env.FERGUS_AUTO_VERSION = 'false';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34987';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
const BASE = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++){ try { await fetch(BASE + '/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
const qOf = (id) => db.jobs.find(j => j.id === id).draw_state.state.quote;
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

// ── the correction of 3334 ──────────────────────────────────────
let r = await (await post('/admin/accepted-total-fixes/run?token=as-test-token')).json();
let q = qOf('j-3334');
check('3334’s recorded total is put right: $34,231.35', q.accepted.total === 34231.35, JSON.stringify(r));
check('…the old figure kept beside it, with why', q.accepted.totalCorrected && q.accepted.totalCorrected.from === 35252.82 &&
  q.accepted.totalCorrected.to === 34231.35 && /34,231\.35/.test(q.accepted.totalCorrected.why), JSON.stringify(q.accepted.totalCorrected));
check('…and the frozen Accepted quote reads it too', q.versions.accepted.total === 34231.35 && q.versions.accepted.quote.accepted.total === 34231.35,
  JSON.stringify(q.versions.accepted));
check('…the acceptance itself untouched (who, when, the share still accepted, the prices as stored)',
  q.accepted.name === 'Double Two Dairies' && q.share.status === 'accepted' && q.share.priced.extraRoof[0] === 1217.57 && q.share.sentTotal === 34231.35);
check('the Fergus job’s description is written again with the corrected total',
  fergus.desc.some(d => /34,231\.35/.test(d) && !/35,252\.82/.test(d)) && !!q.share.fergusAcceptDescAt, JSON.stringify(fergus.desc).slice(0, 300));
check('a job with the same customer name, number and figure at another address is left alone', qOf('j-other').accepted.total === 35252.82);
check('the same customer’s other quote is left alone', qOf('j-3335').accepted.total === 35252.82);
const before = JSON.stringify(qOf('j-3334').accepted), nDesc = fergus.desc.length;
r = await (await post('/admin/accepted-total-fixes/run?token=as-test-token')).json();
check('running it again changes nothing (it only acts while the wrong figure is there)',
  JSON.stringify(qOf('j-3334').accepted) === before && fergus.desc.length === nDesc && r[0].fixed === 0, JSON.stringify(r));
check('the admin route is not there without the token', (await post('/admin/accepted-total-fixes/run')).status === 404);

// ── a page opened on prices the quote has moved off ─────────────
const page = await (await fetch(BASE + '/q/tok-open')).json();
const fpOpened = appFp(page.quote.share.priced);
check('the app computes a fingerprint from the quote its page received', /^\d+:[0-9a-f]+$/.test(fpOpened), fpOpened);
// the office re-prices the quote while the page sits open (after the open's own write has landed)
await new Promise(r => setTimeout(r, 400));
qOf('j-open').share.priced.base = 1100;
r = await post('/q/tok-open/event', { type: 'accepted', name: 'Open Customer', total: 1150, pricedFp: fpOpened });
let jr = await r.json();
check('an acceptance on the old prices is refused: 409 QUOTE_CHANGED', r.status === 409 && jr.code === 'QUOTE_CHANGED', r.status + ' ' + JSON.stringify(jr));
check('…and nothing is recorded', !qOf('j-open').accepted && qOf('j-open').share.status !== 'accepted', JSON.stringify(qOf('j-open').accepted));
const page2 = await (await fetch(BASE + '/q/tok-open')).json();
r = await post('/q/tok-open/event', { type: 'accepted', name: 'Open Customer', total: 1265, pricedFp: appFp(page2.quote.share.priced) });
check('the page reloaded onto the current prices accepts (the app’s fingerprint and the server’s agree)',
  r.status === 200 && qOf('j-open').accepted && qOf('j-open').accepted.total === 1265, r.status + ' ' + JSON.stringify(qOf('j-open').accepted));
r = await post('/q/tok-old/event', { type: 'accepted', name: 'Old Page Customer', total: 1150 });
check('a page from before the fingerprint is not checked', r.status === 200 && qOf('j-old').accepted && qOf('j-old').accepted.total === 1150, String(r.status));

// ── the office saves after an acceptance ────────────────────────
const TOK = jwt.sign({ id: U, email: 'office@flood.nz', cid: CO }, 'test-secret');
const put = (path, body) => fetch(BASE + path, { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify(body) });
const seen = JSON.parse(JSON.stringify(qOf('j-3334')));
seen.share.priced.extraRoof = [1302.03, 790, 1020, 1020]; seen.share.priced.base = 26500; seen.share.sentTotal = 99999;
r = await put('/jobs/j-3334/quote', { quote: seen });
q = qOf('j-3334');
check('a save that has seen the acceptance cannot re-price the customer’s copy under it',
  r.status === 200 && q.share.priced.extraRoof[0] === 1217.57 && q.share.priced.base === 25950.63 && q.share.sentTotal === 34231.35,
  r.status + ' ' + JSON.stringify({ er: q.share.priced.extraRoof, base: q.share.priced.base, st: q.share.sentTotal }));
check('…and the acceptance stays as it was', q.accepted.total === 34231.35 && q.share.status === 'accepted');
const undo = JSON.parse(JSON.stringify(qOf('j-3334')));
delete undo.accepted; undo.share.status = 'opened'; undo.share.priced.base = 26500;
r = await put('/jobs/j-3334/quote', { quote: undo });
q = qOf('j-3334');
check('Undo acceptance still re-prices freely', r.status === 200 && !q.accepted && q.share.priced.base === 26500, r.status + ' ' + q.share.priced.base);

// ── the app half ────────────────────────────────────────────────
check('the app never re-stamps an accepted quote’s customer copy',
  /function _qStampCustomerCopy\(\)\{\s*if \(!S\.quote\) return;[\s\S]{0,600}if \(S\.quote\.accepted\) return;/.test(APP));
check('the customer’s accept sends the fingerprint and reloads on QUOTE_CHANGED',
  /pricedFp: _fp/.test(APP) && /r\.code === 'QUOTE_CHANGED'/.test(APP));
check('the server boots the correction', /_acceptedTotalFixesOnce\(\)\.catch/.test(readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8')));

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
