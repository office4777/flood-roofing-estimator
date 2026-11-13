// SUPPLIER INVOICES + XERO, the server half (2026-11-13, the owner: "give the
// user two options ... forward ... or ... give all their material suppliers
// their new invoicing email ... read the invoice and auto allocate to whichever
// specific job ... an assign to column ... sent to Xero"; "only make these new
// changes go live on aaron@floodroofing.co.nz's account").
// Against the real server with fakepgrst, a stand-in Resend / Xero (the fetch
// seam), a stand-in A.I. and an in-memory store.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();

const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing Ltd', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'aron@floodroofing.co.nz' }, { id: 'u3', company_id: 'c1', email: 'paula@floodroofing.co.nz' },
    { id: 'u2', company_id: 'c2', email: 'office@rival.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c1', user_id: 'u3', role: 'member' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [],
  jobs: [
    { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Doug Rodgers', site_address: '704A State Highway 10, Oromahoe', version_of: null, created_at: ago(20), updated_at: ago(1),
      draw_state: { state: { quote: { ref: '3341', gst: 15, share: { sentTotal: 11500, sentAt: ago(10) }, accepted: { total: 11500, at: ago(8) } } } } },
    { id: 'j1v', user_id: 'u1', company_id: 'c1', client_name: 'Doug Rodgers', site_address: '704A State Highway 10, Oromahoe', version_of: 'j1', created_at: ago(2), updated_at: ago(0),
      draw_state: { state: { quote: { ref: '3341' } } } },
    { id: 'j2', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', version_of: null, created_at: ago(20), updated_at: ago(2),
      draw_state: { state: { quote: { ref: '3351', gst: 15 } } } },
    { id: 'jr', user_id: 'u2', company_id: 'c2', client_name: 'Someone', site_address: '9 Other Road', version_of: null, created_at: ago(3), updated_at: ago(0),
      draw_state: { state: { quote: { ref: '3341' } } } },
  ],
  supinv_inboxes: [], supplier_invoices: [], xero_connections: [],
});
// The stand-ins.
const files = new Map();
globalThis.__TEST_SUPINV_STORAGE = {
  async upload(p, buf){ files.set(p, buf); return p; }, async download(p){ if (!files.has(p)) throw new Error('missing'); return files.get(p); },
  async signedUrl(p){ return 'https://store.test/' + encodeURIComponent(p); }, async remove(ps){ ps.forEach(p => files.delete(p)); }, async ensureBucket(){ return true; }, maxBytes: 50 << 20,
};
const AI = {};
const AI_CALLS = [];
globalThis.__TEST_SUPINV_AI = async (q) => {
  AI_CALLS.push(q);
  if (q.via === 'photo') return AI['PHOTO'];
  const k = Object.keys(AI).find(n => q.text.indexOf(n) >= 0);
  if (!k) throw new Error('unreadable');
  return AI[k];
};
AI['INV-RI-1'] = { kind: 'invoice', supplier: 'Roofing Industries', invoice_number: 'RI-88123', invoice_date: '2026-11-10', due_date: '2026-12-20', subtotal: 2400, gst: 360, total: 2760,
  currency: 'NZD', references: ['Your ref: 3341 Rodgers'], site_address: '', description: '0.40 Colorsteel corrugate and flashings', lines: [{ desc: 'Corrugate 6.2m', qty: 40, amount: 2000 }] };
AI['INV-ST-2'] = { kind: 'invoice', supplier: 'Steel & Tube', invoice_number: 'ST-5', invoice_date: '2026-11-11', due_date: '', subtotal: 500, gst: 75, total: 575,
  currency: 'NZD', references: [], site_address: '12 Kauri Lane Kerikeri', description: 'Gutter brackets', lines: [] };
AI['INV-NONE-3'] = { kind: 'invoice', supplier: 'Carters', invoice_number: 'C-9', invoice_date: '2026-11-12', due_date: '', subtotal: 100, gst: 15, total: 115,
  currency: 'NZD', references: ['Cash sale'], site_address: '', description: 'Screws', lines: [] };
AI['INV-TXT-9'] = { kind: 'invoice', supplier: 'Dimond', invoice_number: 'D-9', invoice_date: '2026-11-12', due_date: '', subtotal: 1000, gst: 150, total: 1150,
  currency: 'NZD', references: [], site_address: '', description: 'Corrugate', lines: [] };
AI['PHOTO'] = { kind: 'invoice', supplier: 'Photo Supplies', invoice_number: 'P-1', invoice_date: '2026-11-12', due_date: '', subtotal: 50, gst: 7.5, total: 57.5,
  currency: 'NZD', references: [], site_address: '', description: 'Rivets', lines: [] };
// A real PDF with a text layer, written by hand (one page, Helvetica).
function makePdf(text){
  const stream = 'BT /F1 11 Tf 40 780 Td (' + text + ') Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
  return Buffer.from(out, 'latin1');
}
const calls = [];
const RESEND_ATTS = {};
globalThis.__TEST_SUPINV_FETCH = async (url, opts) => {
  opts = opts || {}; calls.push({ url, method: opts.method || 'GET', body: opts.body });
  const J = (o, s) => ({ ok: (s || 200) < 300, status: s || 200, json: async () => o, arrayBuffer: async () => new ArrayBuffer(0) });
  let m;
  if ((m = /api\.resend\.com\/emails\/receiving\/([^/]+)\/attachments/.exec(url))) return J({ data: RESEND_ATTS[decodeURIComponent(m[1])] || [] });
  if ((m = /^https:\/\/files\.test\/(.+)$/.exec(url))) { const b = Buffer.from('%PDF-1.4 ' + decodeURIComponent(m[1])); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
  if (/identity\.xero\.com\/connect\/token/.test(url)) return J({ access_token: 'at-' + Date.now(), refresh_token: 'rt-1', expires_in: 1800 });
  if (/api\.xero\.com\/connections/.test(url)) return J([{ tenantId: 't-1', tenantName: 'Flood Roofing Ltd', tenantType: 'ORGANISATION' }]);
  if (/\/Contacts\?/.test(url)) return J({ Contacts: [{ ContactID: 'ct-ri', Name: 'Roofing Industries' }] });
  if (/\/Invoices\/[^/]+\/Attachments\//.test(url)) return J({ Attachments: [{ AttachmentID: 'a1' }] });
  if (/\/Invoices$/.test(url) && opts.method === 'POST') return J({ Invoices: [{ InvoiceID: 'xi-1' }] });
  if (/\/Reports\/ProfitAndLoss/.test(url)) {
    const per = /periods=(\d+)/.exec(url); const n = per ? +per[1] + 1 : 1;
    const cells = (label, v) => ({ RowType: 'Row', Cells: [{ Value: label }].concat(Array.from({ length: n }, () => ({ Value: String(v) }))) });
    const sum = (v) => ({ RowType: 'SummaryRow', Cells: [{ Value: 'Total' }].concat(Array.from({ length: n }, () => ({ Value: String(v) }))) });
    return J({ Reports: [{ Rows: [ { RowType: 'Section', Title: 'Income', Rows: [cells('Sales', 100000), sum(100000)] },
      { RowType: 'Section', Title: 'Less Cost of Sales', Rows: [sum(60000)] },
      { RowType: 'Section', Title: '', Rows: [cells('Gross Profit', 40000)] },
      { RowType: 'Section', Title: 'Less Operating Expenses', Rows: [sum(25000)] },
      { RowType: 'Section', Title: '', Rows: [cells('Net Profit', 15000)] } ] }] });
  }
  return J({ message: 'no stub for ' + url }, 404);
};
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
process.env.SUPINV_DOMAIN = 'invoices.roofmap.co.nz';
process.env.RESEND_INBOUND_SECRET = 'whsec_' + Buffer.from('a-secret-for-the-suite').toString('base64');
delete process.env.SUPINV_USERS; delete process.env.SUPINV_ALL;
const PORT = process.env.TEST_PORT || '35113';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const call = (tok) => async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
};
const aron = call(jwt.sign({ id: 'u1', email: 'aron@floodroofing.co.nz', cid: 'c1' }, 'test-secret'));
const paula = call(jwt.sign({ id: 'u3', email: 'paula@floodroofing.co.nz', cid: 'c1' }, 'test-secret'));
const rival = call(jwt.sign({ id: 'u2', email: 'office@rival.nz', cid: 'c2' }, 'test-secret'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function settle(){ for (let i = 0; i < 40; i++) { if (!db.supplier_invoices.some(x => x.status === 'reading')) return; await wait(100); } }

// ── who sees it ──
let r = await aron('GET', '/supinv/enabled');
check('the owner’s login has it', r.body.enabled === true, JSON.stringify(r.body));
r = await paula('GET', '/supinv/enabled');
check('nobody else in the business does yet', r.body.enabled === false, JSON.stringify(r.body));
r = await paula('GET', '/supinv');
check('…and the routes refuse them, not just the menu', r.status === 403 && r.body.code === 'SUPINV_OFF', JSON.stringify(r.body));
r = await rival('GET', '/costing/jobs');
check('…another business is refused too', r.status === 403, String(r.status));

// ── the address ──
r = await aron('GET', '/supinv/address');
const addr = r.body.address || '';
check('the business gets its own invoice address, named for it', r.status === 200 && /^floodroofing-[0-9a-f]{4}@invoices\.roofmap\.co\.nz$/.test(addr) && r.body.receiving === true, addr);
r = await aron('GET', '/supinv/address');
check('…the same address every time', r.body.address === addr && db.supinv_inboxes.length === 1, r.body.address);

// ── an email arrives ──
function signed(body, secretOverride){
  const raw = JSON.stringify(body), id = 'msg_' + crypto.randomBytes(4).toString('hex'), ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from((secretOverride || process.env.RESEND_INBOUND_SECRET).replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + raw).digest('base64');
  return fetch(BASE + '/supinv/inbound', { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,' + sig }, body: raw });
}
RESEND_ATTS['em1'] = [ { id: 'a1', filename: 'RI-88123.pdf', content_type: 'application/pdf', download_url: 'https://files.test/INV-RI-1' },
  { id: 'a2', filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline', download_url: 'https://files.test/logo' } ];
const ev = { type: 'email.received', data: { email_id: 'em1', from: 'Accounts <accounts@roofingindustries.co.nz>', to: [addr], subject: 'Invoice RI-88123' } };
let res = await signed(ev, 'whsec_' + Buffer.from('wrong').toString('base64'));
check('a request not signed by Resend is refused', res.status === 401, String(res.status));
res = await signed(ev);
check('a signed email is taken', res.status === 200, String(res.status));
await settle();
let rows = db.supplier_invoices.filter(x => x.company_id === 'c1');
check('its PDF is kept (not the inline logo) and read', rows.length === 1 && rows[0].file_name === 'RI-88123.pdf' && rows[0].status === 'read' && files.size === 1,
  JSON.stringify(rows.map(x => [x.file_name, x.status, x.error])));
const ri = rows[0] || {};
check('…the figures read off it', ri.supplier === 'Roofing Industries' && ri.inv_number === 'RI-88123' && +ri.subtotal === 2400 && +ri.total === 2760 && ri.inv_date === '2026-11-10', JSON.stringify(ri));
check('…and it is put on job 3341 by the job number on it — the job’s root, not a version, never the other business’s 3341',
  ri.job_id === 'j1' && ri.alloc === 'auto' && /3341/.test(ri.alloc_why) && /Doug Rodgers/.test(ri.job_label), JSON.stringify([ri.job_id, ri.alloc_why, ri.job_label]));
res = await signed(ev);
await settle();
check('Resend sending the same email again makes no second copy', db.supplier_invoices.filter(x => x.company_id === 'c1').length === 1, String(db.supplier_invoices.length));
res = await signed({ type: 'email.received', data: { email_id: 'emX', to: ['nobody-1234@invoices.roofmap.co.nz'], subject: 'x' } });
check('mail to an address nobody has is ignored', res.status === 200 && db.supplier_invoices.length === 1, String(db.supplier_invoices.length));
RESEND_ATTS['em2'] = [];
await signed({ type: 'email.received', data: { email_id: 'em2', from: 'forwarding-noreply@google.com', to: [addr], subject: 'Gmail Forwarding Confirmation' } });
await settle();
const noFile = db.supplier_invoices.find(x => x.email_id === 'em2');
check('an email with no PDF still shows (the Gmail forwarding code arrives that way)', noFile && noFile.status === 'no-file', JSON.stringify(noFile && noFile.status));

// ── uploads, the site-address match, the unsure one ──
const up = (name, key) => aron('POST', '/supinv/upload', { name, mime: 'application/pdf', data: Buffer.from('%PDF-1.4 ' + key).toString('base64') });
r = await up('st5.pdf', 'INV-ST-2');
check('an upload is taken', r.status === 200 && r.body.id, JSON.stringify(r.body));
await up('carters.pdf', 'INV-NONE-3');
r = await aron('POST', '/supinv/upload', { name: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' });
check('…only a PDF or a photo', r.status === 400, String(r.status));
await settle();
const st = db.supplier_invoices.find(x => x.inv_number === 'ST-5') || {};
check('an invoice with no job number is put on the job whose site address is on it', st.job_id === 'j2' && /12 Kauri Lane/.test(st.alloc_why), JSON.stringify([st.job_id, st.alloc_why]));
const ca = db.supplier_invoices.find(x => x.inv_number === 'C-9') || {};
check('one the engine cannot place waits to be assigned', ca.status === 'read' && !ca.job_id, JSON.stringify([ca.status, ca.job_id]));

// ── what is sent to the A.I.: text when the PDF has words, a small picture for a photo ──
AI_CALLS.length = 0;
r = await aron('POST', '/supinv/upload', { name: 'dimond.pdf', mime: 'application/pdf',
  data: makePdf('TAX INVOICE INV-TXT-9 Dimond Roofing Ltd - Your order reference: Job 3351 - corrugate sheets and flashings delivered to site, thank you for your business').toString('base64') });
await settle();
const tx = AI_CALLS[0] || {};
const dm = db.supplier_invoices.find(x => x.inv_number === 'D-9') || {};
check('a PDF with words on it is sent as its TEXT alone — no picture, no PDF', tx.via === 'text' && /INV-TXT-9/.test(tx.text) && /Job 3351/.test(tx.text) && !(tx.images || []).length && dm.read_via === 'text', JSON.stringify({ via: tx.via, imgs: (tx.images || []).length, rv: dm.read_via }));
check('…and the job number printed on the page puts it on the job even when the A.I. did not list it', dm.job_id === 'j2' && /3351/.test(dm.alloc_why), JSON.stringify([dm.job_id, dm.alloc_why]));
{
  const { createCanvas } = require('@napi-rs/canvas');
  // A phone photo: 3200 x 2400 of noise, saved as a high-quality JPEG (a few MB).
  const W = 3200, H = 2400, cv = createCanvas(W, H), g = cv.getContext('2d'), im = g.createImageData(W, H);
  let seed = 7; for (let i = 0; i < im.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; im.data[i] = seed & 255; im.data[i + 1] = (seed >> 8) & 255; im.data[i + 2] = (seed >> 16) & 255; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  const big = cv.toBuffer('image/jpeg', 95);
  AI_CALLS.length = 0;
  await aron('POST', '/supinv/upload', { name: 'phone-photo.jpg', mime: 'image/jpeg', data: big.toString('base64') });
  await settle();
  const ph = AI_CALLS[0] || {};
  check('a big photo is shrunk to a small JPEG before it is read', ph.via === 'photo' && ph.images && ph.images[0] && ph.images[0].mime === 'image/jpeg' && ph.images[0].bytes < big.length / 3,
    JSON.stringify({ via: ph.via, img: ph.images, orig: big.length }));
}

// ── assigning by hand ──
r = await aron('PUT', '/supinv/' + ca.id + '/assign', { jobId: 'jr' });
check('it cannot be put on another business’s job', r.status === 404, String(r.status));
r = await aron('PUT', '/supinv/' + ca.id + '/assign', { jobId: 'j2' });
check('…it can be put on one of ours, and says who did it', r.status === 200 && r.body.invoice.job_id === 'j2' && r.body.invoice.alloc === 'manual' && /aron@/.test(r.body.invoice.alloc_why), JSON.stringify(r.body.invoice || r.body));
r = await aron('GET', '/supinv/' + ca.id + '/url');
check('the PDF opens from a short-lived link', r.status === 200 && /^https:\/\/store\.test\//.test(r.body.url), JSON.stringify(r.body));
r = await rival('GET', '/supinv/' + ca.id);
check('another business cannot read it', r.status === 403 || r.status === 404, String(r.status));

// ── job costing ──
r = await aron('GET', '/costing/jobs');
const J = (r.body.jobs || []);
const j1 = J.find(x => x.id === 'j1') || {}, j2 = J.find(x => x.id === 'j2') || {};
check('job costing lists each job once, its versions folded', J.filter(x => x.id === 'j1').length === 1 && !J.some(x => x.id === 'j1v' || x.id === 'jr'), JSON.stringify(J.map(x => x.id)));
check('…the accepted price excl. GST against its supplier invoices', j1.acceptedEx === 10000 && j1.cost === 2400 && (j1.invoices || []).length === 1, JSON.stringify(j1));
check('…every invoice on a job adds up', j2.cost === 1600, JSON.stringify(j2));

// ── Xero ──
r = await aron('POST', '/supinv/' + ri.id + '/xero');
check('sending to Xero before connecting says so', r.status === 400 && r.body.code === 'XERO_NOT_CONNECTED', JSON.stringify(r.body));
r = await aron('POST', '/xero/connect');
const st8 = new URL(r.body.url).searchParams.get('state');
check('connecting hands the browser Xero’s sign-in page', /^https:\/\/login\.xero\.com\/identity\/connect\/authorize\?/.test(r.body.url) && st8, r.body.url);
let cb = await fetch(BASE + '/xero/callback?code=abc&state=' + encodeURIComponent(st8), { redirect: 'manual' });
check('…Xero’s answer connects the business and lands back in the app', cb.status === 302 && /xero=connected/.test(cb.headers.get('location') || '') && db.xero_connections.length === 1 &&
  db.xero_connections[0].company_id === 'c1' && db.xero_connections[0].tenant_name === 'Flood Roofing Ltd' && !/rt-1/.test(db.xero_connections[0].refresh_token), JSON.stringify(db.xero_connections[0]));
cb = await fetch(BASE + '/xero/callback?code=abc&state=forged.state', { redirect: 'manual' });
check('…a forged answer is refused', /xero=expired/.test(cb.headers.get('location') || '') && db.xero_connections.length === 1, cb.headers.get('location'));
r = await aron('POST', '/supinv/' + ri.id + '/xero');
const post = calls.filter(c => /\/Invoices$/.test(c.url) && c.method === 'POST').pop();
const bill = post ? JSON.parse(post.body).Invoices[0] : {};
check('an invoice goes to Xero as a draft bill for the supplier, the job in its reference', r.status === 200 && r.body.xero.invoiceId === 'xi-1' &&
  bill.Type === 'ACCPAY' && bill.Status === 'DRAFT' && bill.Contact.ContactID === 'ct-ri' && bill.InvoiceNumber === 'RI-88123' && /3341/.test(bill.Reference) &&
  bill.LineItems[0].UnitAmount === 2400 && bill.LineItems[0].AccountCode === '300', JSON.stringify(bill));
check('…with its PDF attached', r.body.xero.attached === true && calls.some(c => /\/Invoices\/xi-1\/Attachments\/RI-88123\.pdf/.test(c.url)), JSON.stringify(r.body.xero));
r = await aron('POST', '/supinv/' + ri.id + '/xero');
check('…and never twice', r.body.already === true && calls.filter(c => /\/Invoices$/.test(c.url) && c.method === 'POST').length === 1, JSON.stringify(r.body));
r = await aron('GET', '/xero/pnl?months=14');
const M = r.body.months || [];
check('the P&L reads month by month from Xero', r.status === 200 && M.length === 14 && M[0].income === 100000 && M[0].cos === 60000 && M[0].gross === 40000 && M[0].expenses === 25000 && M[0].net === 15000 &&
  M[0].month < M[13].month, JSON.stringify(M.slice(0, 2)));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
