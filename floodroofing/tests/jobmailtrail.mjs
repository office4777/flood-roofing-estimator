// THE JOB'S FOLDERS AND ITS EMAIL TRAIL, the server half (2026-11-13, the
// owner: "make subfolders in this window ... a third folder called
// communications ... the whole email trail ... quote sent, any questions ...
// any replies ... the top would be the first email sent"; "add a custom
// folder into that specific job, or delete a folder, or move items ...").
// Against the real server: a job's folder layout is kept per job ROOT, cleaned,
// and never another company's; a quote email is kept on its job with every
// word, its subject and who it went to; a send from before this stands in the
// trail from its date, once.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }

const sent = [];
const relay = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const sentEarlierAt = ago(9), sentAt = ago(5);
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' }, { id: 'u2', company_id: 'c2', email: 'office@rival.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [ { user_id: 'u1', company_id: 'c1', branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz' }, quote_defaults: {}, updated_at: ago(1) } ],
  jobs: [
    { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '1 Kauri Lane', version_of: null, created_at: ago(20), updated_at: ago(0),
      draw_state: { state: { quote: { ref: '3351', email: 'arran@example.com', share: { token: 't1', sentAt, sentTo: 'arran@example.com' },
        versions: { sentEarlier: [ { id: 'v1', at: sentEarlierAt, sentTo: 'arran@example.com' } ], sent: { id: 'v2', at: sentAt, sentTo: 'arran@example.com' } } } }, form: {} } },
    { id: 'j1v2', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '1 Kauri Lane', version_of: 'j1', created_at: ago(1), updated_at: ago(0),
      draw_state: { state: { quote: { ref: '3351' } }, form: {} } },
    { id: 'jr', user_id: 'u2', company_id: 'c2', client_name: 'Someone', site_address: 'Elsewhere', version_of: null, created_at: ago(3), updated_at: ago(0),
      draw_state: { state: { quote: { ref: '9001' } }, form: {} } },
  ],
  job_files: [], job_file_layouts: [], job_messages: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
const PORT = process.env.TEST_PORT || '34993';
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
const me = call(jwt.sign({ id: 'u1', email: 'office@floodroofing.co.nz', cid: 'c1' }, 'test-secret'));
const them = call(jwt.sign({ id: 'u2', email: 'office@rival.nz', cid: 'c2' }, 'test-secret'));

// ── the folder layout ──
let r = await me('GET', '/jobs/j1/files');
check('a job with no layout reads none (the default folders apply)', r.status === 200 && r.body.layout === null && !r.body.layoutErr, JSON.stringify(r.body));
r = await me('PUT', '/jobs/j1/files/layout', { layout: { folders: [ { id: 'jabc', name: '  Council consent  ' }, { id: '', name: 'nameless' }, { id: 'x"><script>', name: 'Evil' } ],
  hiddenFolders: ['photos', 'photos'], place: { 's:f1': 'jabc', 'f:fg2': '' }, order: { photos: ['s:f2', 's:f1'], '': ['s:f9'] }, hiddenItems: ['f:fg9'], extra: 'dropped' } });
const L = r.body.layout || {};
check('the layout is kept, cleaned: names trimmed, a nameless or bad folder id never stored, nothing else carried',
  r.status === 200 && JSON.stringify(L.folders.map(f => f.id + ':' + f.name)) === '["jabc:Council consent","xscript:Evil"]' && JSON.stringify(L.hiddenFolders) === '["photos"]' &&
  L.place['s:f1'] === 'jabc' && L.place['f:fg2'] === '' && JSON.stringify(L.order.photos) === '["s:f2","s:f1"]' && JSON.stringify(L.order._home) === '["s:f9"]' && L.extra === undefined, JSON.stringify(L));
r = await me('GET', '/jobs/j1v2/files');
check('…read back on the job, and every version shares its root’s folders', r.body.layout && r.body.layout.place['s:f1'] === 'jabc', JSON.stringify(r.body.layout));
await me('PUT', '/jobs/j1v2/files/layout', { layout: { folders: [], place: { 's:f1': '' } } });
check('…a second save updates the one row, never a second', db.job_file_layouts.length === 1 && db.job_file_layouts[0].job_id === 'j1' && db.job_file_layouts[0].layout.place['s:f1'] === '', JSON.stringify(db.job_file_layouts.map(x => x.job_id)));
r = await them('GET', '/jobs/j1/files'); const r2 = await them('PUT', '/jobs/j1/files/layout', { layout: { folders: [ { id: 'z', name: 'Mine now' } ] } });
check('another company can neither read nor write a job’s folders', r.status === 404 && r2.status === 404 && db.job_file_layouts[0].layout.folders.length === 0, r.status + ' ' + r2.status);
db.__fail500 = 'job_file_layouts';
r = await me('GET', '/jobs/j1/files');
check('a layout that cannot be read is said so — the files still list', r.status === 200 && r.body.layout === null && !!r.body.layoutErr && Array.isArray(r.body.files), JSON.stringify(r.body));
db.__fail500 = null;

// ── the quote email is kept on its job ──
r = await me('POST', '/email/send-order', { to: 'arran@example.com', subject: 'Your quote 3351 from Flood Roofing', text: 'Hi Arran,\nPlease find your quote here: https://roofmap.co.nz/?q=t1', kind: 'quote', jobId: 'j1' });
await new Promise(r => setTimeout(r, 300));
const kept = db.job_messages.filter(m => m.via === 'quote-email');
check('a quote email sent with its job is kept on that job — every word, its subject, who it went to',
  r.status === 200 && kept.length === 1 && kept[0].job_id === 'j1' && kept[0].who === 'office' && kept[0].subject === 'Your quote 3351 from Flood Roofing' &&
  /Please find your quote here/.test(kept[0].body) && kept[0].mail_to === 'arran@example.com' && /Flood Roofing/.test(kept[0].mail_from) && /@/.test(kept[0].msg_id), JSON.stringify(kept));
// (The Message-ID rides on the email through Resend; the Google relay these
// suites stand in for cannot set one — which is why it is stored as well.)
const n0 = db.job_messages.length;
await me('POST', '/email/send-order', { to: 'office@floodroofing.co.nz', subject: 'TEST QUOTE', text: 'x', kind: 'quote', test: true, jobId: 'j1' });
await me('POST', '/email/send-order', { to: 'merchant@example.com', subject: 'Order', text: 'x', kind: 'order', jobId: 'j1' });
await me('POST', '/email/send-order', { to: 'a@example.com', subject: 'Someone else’s job', text: 'x', kind: 'quote', jobId: 'jr' });
await new Promise(r => setTimeout(r, 300));
check('…a practice send, a material order and another company’s job are never written into a job’s trail', db.job_messages.length === n0, (db.job_messages.length - n0) + ' extra');

// ── the trail ──
r = await me('GET', '/jobs/j1/messages');
const list = r.body.messages || [];
const q = list.filter(m => m.via === 'quote-email');
check('the trail is oldest first', list.every((m, i) => !i || String(list[i - 1].at) <= String(m.at)), JSON.stringify(list.map(m => m.at)));
check('a send from before the trail was kept stands in from its date — the earlier send and the later one, each once',
  q.length === 3 && q.filter(m => m.backfill).length === 2 && q[0].at === sentEarlierAt && q[1].at === sentAt && /not kept/.test(q[0].body) && q[0].mail_to === 'arran@example.com', JSON.stringify(q.map(m => [m.at, !!m.backfill])));
// a recorded send near a send's date is not doubled
db.job_messages.push({ id: 'old', company_id: 'c1', user_id: 'u1', job_id: 'j1', who: 'office', via: 'quote-email', author: '', body: 'real words', msg_id: '<x@y>', in_reply_to: '', at: new Date(Date.parse(sentAt) + 60000).toISOString(), created_at: sentAt, mail_from: '', mail_to: 'arran@example.com', mail_cc: '', subject: 'Your quote 3351' });
r = await me('GET', '/jobs/j1/messages');
const q2 = (r.body.messages || []).filter(m => m.via === 'quote-email');
check('…and a send already kept is never stood in for a second time', q2.length === 3 && q2.filter(m => m.backfill).length === 1, JSON.stringify(q2.map(m => [m.at, !!m.backfill])));
r = await them('GET', '/jobs/j1/messages');
check('another company never reads the trail', r.status === 404, String(r.status));

relay.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
