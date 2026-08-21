// Invoicing: the deposit that raises itself when a customer accepts, the
// progress claims in between, and the final on completion. The money fields
// are stored at creation — an invoice is a document, and a document that
// recomputes after it went out is an accounting incident.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';
import http from 'node:http';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO  = 'cccccccc-1111-1111-1111-111111111111';
const CO2 = 'dddddddd-2222-2222-2222-222222222222';
const U   = 'uuuuuuuu-0000-0000-0000-000000000001';
const U2  = 'uuuuuuuu-0000-0000-0000-000000000002';
const JOB = 'aaaaaaaa-0000-0000-0000-00000000000a';
const JOB2= 'bbbbbbbb-0000-0000-0000-00000000000b';

const db = {
  __missing: [],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }, { id: CO2, name: 'Rival', plan: 'business' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }, { company_id: CO2, user_id: U2, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, name: 'Aron', email: 'aron@floodroofing.co.nz' }],
  subscriptions: [],
  invoices: [],
  usage_events: [],
  user_settings: [{
    user_id: U, company_id: CO, updated_at: '2026-08-20T00:00:00Z',
    branding: { company_name: 'Flood Roofing', gst_number: '123-456-789' },
    quote_defaults: { invoicing: { deposit_percent: 50, auto_send_deposit: true, progress_enabled: true,
                                   due_days: 7, bank_account: '02-1234-5678900-00', footer: 'Thanks for your business.' } },
  }],
  jobs: [
    { id: JOB, company_id: CO, user_id: U, client_name: 'Mrs Hale', site_address: '11 Morcom Lane, Kerikeri',
      status: 'draft', updated_at: '2026-08-19T00:00:00Z',
      draw_state: { state: { quote: { ref: '06121', client: 'Mrs Hale', addr: '11 Morcom Lane, Kerikeri',
        email: 'hale@example.com', gstRate: 15, share: { token: 'tok-accept', status: 'sent', events: [] } } } } },
    { id: JOB2, company_id: CO2, user_id: U2, client_name: 'Rival Job', site_address: '9 Other St',
      status: 'draft', updated_at: '2026-08-19T00:00:00Z',
      draw_state: { state: { quote: { ref: '900', share: { token: 'tok-rival', events: [] } } } } },
  ],
};

// A stand-in for the Apps Script mail relay, so "sent" is observable.
const mails = [];
const mailSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { try { mails.push(JSON.parse(body)); } catch(e){ mails.push({ raw: body }); }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => mailSrv.listen(0, '127.0.0.1', r));
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + mailSrv.address().port;
process.env.GAS_MAIL_TOKEN = 'test-mail-token';

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34590';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const tok = (id, cid) => jwtLib.sign({ id, email: 'x@y.nz', cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const B = 'http://127.0.0.1:' + PORT;
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, body: j };
};
const T = tok(U, CO), T2 = tok(U2, CO2);

// ── raising invoices by hand ──────────────────────────────────────
let r = await call('POST', '/jobs/' + JOB + '/invoices', { type: 'progress', percent: 25, total_incl: 5750, description: 'Progress claim 1' }, T);
check('the office can raise a progress invoice', r.status === 200 && r.body.number === 'INV-1001', JSON.stringify(r.body).slice(0,120));
check('…GST is split out of the inclusive figure', r.body.amount === 5000 && r.body.gst === 750 && r.body.total === 5750,
  r.body.amount + ' + ' + r.body.gst + ' = ' + r.body.total);
check('…and it starts as a draft with a due date', r.body.status === 'draft' && !!r.body.due_at, r.body.status);
const INV1 = r.body.id;

r = await call('POST', '/jobs/' + JOB + '/invoices', { type: 'final', total_incl: 5750 }, T);
check('numbers increment per company', r.body.number === 'INV-1002', r.body.number);
const INV2 = r.body.id;

r = await call('POST', '/jobs/' + JOB + '/invoices', { type: 'silly', total_incl: 100 }, T);
check('an unknown type is refused', r.status === 400, r.status + '');
r = await call('POST', '/jobs/' + JOB + '/invoices', { type: 'final', total_incl: -5 }, T);
check('a negative figure is refused', r.status === 400, r.status + '');
r = await call('POST', '/jobs/' + JOB2 + '/invoices', { type: 'final', total_incl: 100 }, T);
check('you cannot invoice another company\'s job', r.status === 404, r.status + '');

// ── listing ───────────────────────────────────────────────────────
r = await call('GET', '/jobs/' + JOB + '/invoices', undefined, T);
check('a job lists its own invoices in order', r.status === 200 && r.body.length === 2 && r.body[0].number === 'INV-1001', r.body.length + '');
r = await call('GET', '/invoices', undefined, T2);
check('the rival company sees none of them', r.status === 200 && r.body.length === 0, r.body.length + '');

// ── send ──────────────────────────────────────────────────────────
r = await call('POST', '/invoices/' + INV1 + '/send', {}, T);
check('sending emails the customer on the quote', r.status === 200 && r.body.status === 'sent' && mails.length === 1,
  'status ' + (r.body||{}).status + ', mails ' + mails.length);
check('…the email carries the number, total and bank account',
  mails.length === 1 && /INV-1001/.test(mails[0].subject) && /5,750\.00/.test(mails[0].text) && /02-1234-5678900-00/.test(mails[0].text),
  (mails[0]||{}).subject);
check('…to the address from the quote', mails.length === 1 && mails[0].to === 'hale@example.com', (mails[0]||{}).to);

r = await call('POST', '/invoices/' + INV1 + '/send', { to: 'other@example.com' }, T);
check('re-sending to a different address is allowed while unpaid', r.status === 200 && mails.length === 2 && mails[1].to === 'other@example.com', mails.length + '');

// ── status transitions ────────────────────────────────────────────
r = await call('PUT', '/invoices/' + INV1, { status: 'paid' }, T);
check('a sent invoice can be marked paid', r.status === 200 && r.body.status === 'paid' && !!r.body.paid_at, (r.body||{}).status);
r = await call('PUT', '/invoices/' + INV1, { status: 'void' }, T);
check('…and a paid one can never be voided', r.status === 400, r.status + '');
r = await call('POST', '/invoices/' + INV1 + '/send', {}, T);
check('…or re-sent', r.status === 400, r.status + '');
r = await call('PUT', '/invoices/' + INV2, { total_incl: 11500, description: 'Final 50%' }, T);
check('a draft can be re-figured before it goes out', r.status === 200 && r.body.amount === 10000 && r.body.description === 'Final 50%',
  (r.body||{}).amount + '');
r = await call('PUT', '/invoices/' + INV2, { status: 'void' }, T);
check('a draft can be voided', r.status === 200 && r.body.status === 'void', (r.body||{}).status);
r = await call('PUT', '/invoices/' + INV1, { status: 'paid' }, T2);
check('another company cannot touch the invoice at all', r.status === 404, r.status + '');

// ── the deposit that raises itself ────────────────────────────────
const mailsBefore = mails.length;
r = await call('POST', '/q/tok-accept/event?job=' + JOB, { type: 'accepted', name: 'Mrs Hale', total: 23000 });
check('a customer accept succeeds as before', r.status === 200 && r.body.status === 'accepted', JSON.stringify(r.body));
await new Promise(r2 => setTimeout(r2, 900));   // the hook runs after the response
const deposits = db.invoices.filter(i => i.type === 'deposit');
check('…and the 50% deposit invoice raised itself', deposits.length === 1 && deposits[0].total === 11500,
  deposits.length + ' × ' + (deposits[0]||{}).total);
check('…stamped with the roofer\'s company, not the customer', deposits.length === 1 && deposits[0].company_id === CO, (deposits[0]||{}).company_id);
check('…and auto-sent to the customer because the setting is on',
  mails.length === mailsBefore + 1 && mails[mails.length-1].to === 'hale@example.com' && deposits[0].status === 'sent',
  'mails ' + (mails.length - mailsBefore) + ', status ' + (deposits[0]||{}).status);
check('…describing what it is', /50% deposit on acceptance/.test((deposits[0]||{}).description || ''), (deposits[0]||{}).description);

r = await call('POST', '/q/tok-accept/event?job=' + JOB, { type: 'accepted', name: 'Mrs Hale', total: 23000 });
await new Promise(r2 => setTimeout(r2, 700));
check('a second accept never raises a second deposit', db.invoices.filter(i => i.type === 'deposit').length === 1,
  db.invoices.filter(i => i.type === 'deposit').length + '');

// ── no auth, no invoices ──────────────────────────────────────────
r = await call('GET', '/invoices');
check('the invoice list requires a signed-in user', r.status === 401 || r.status === 403, r.status + '');

mailSrv.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
