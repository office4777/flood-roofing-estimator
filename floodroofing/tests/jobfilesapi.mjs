// FILES & PHOTOS ON A JOB (2026-10-27, the owner: "add a 'Files & Photos'
// button ... allow the user to add in photo's or files from their computer
// ... actually open the files from within roofmap ... everytime the user
// exports a pdf or anything, that file should automatically also save in the
// files and photos on that job").
//
// The server half against the real server: a file is signed for one path,
// PUT straight to storage (the in-memory stand-in, a real HTTP PUT), marked
// landed, listed, opened through a short-lived link and deleted — every
// version of a job sharing its root's files, and another company never
// seeing, opening or deleting them.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' }, { id: 'u2', company_id: 'c2', email: 'office@rival.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [],
  jobs: [
    { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Aidan', site_address: '1 Kauri Lane', version_of: null,
      created_at: ago(3), updated_at: ago(0), draw_state: { state: { quote: { ref: '3334' } }, form: {} } },
    { id: 'j1v2', user_id: 'u1', company_id: 'c1', client_name: 'Aidan', site_address: '1 Kauri Lane', version_of: 'j1',
      created_at: ago(1), updated_at: ago(0), draw_state: { state: { quote: { ref: '3334' } }, form: {} } },
    { id: 'jr', user_id: 'u2', company_id: 'c2', client_name: 'Someone', site_address: 'Elsewhere', version_of: null,
      created_at: ago(3), updated_at: ago(0), draw_state: { state: { quote: { ref: '9001' } }, form: {} } },
  ],
  job_files: [],
});

const storageMod = require('./tender/storage');
const mem = await storageMod.memory();
globalThis.__TEST_JOBFILES_STORAGE = mem;

process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34989';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK1 = jwt.sign({ id: 'u1', email: 'office@floodroofing.co.nz', cid: 'c1' }, 'test-secret');
const TOK2 = jwt.sign({ id: 'u2', email: 'office@rival.nz', cid: 'c2' }, 'test-secret');
const call = (tok) => async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
    body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const me = call(TOK1), them = call(TOK2);

// ── 1. A file goes up: signed, PUT, landed ─────────────────────────────
const bytes = Buffer.from('%PDF-1.4 a sent quote');
const sg = await me('POST', '/jobs/j1/files/sign', { name: 'Quote 3334 - Roofing - Aidan.pdf', size: bytes.length, mime: 'application/pdf', kind: 'export', source: 'sent-quote' });
check('a file is signed for one path under the company and the job', sg.status === 200 && sg.body.fileId && /^c1\/j1\//.test(sg.body.path || ''), JSON.stringify(sg.body));
const listPending = await me('GET', '/jobs/j1/files');
check('…and is not listed until it has landed', listPending.status === 200 && listPending.body.files.length === 0, JSON.stringify(listPending.body));
const put = await fetch(sg.body.signedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: bytes });
const landed = await me('POST', '/jobs/j1/files/' + sg.body.fileId + '/landed', {});
check('the browser PUTs the bytes straight to storage and says it has landed', put.ok && landed.status === 200 && mem.files.has(sg.body.path), String(put.status));
const list1 = await me('GET', '/jobs/j1/files');
const f1 = (list1.body.files || [])[0] || {};
check('…then it is listed with its name, type, size, what made it and who',
  list1.body.files.length === 1 && f1.name === 'Quote 3334 - Roofing - Aidan.pdf' && f1.mime === 'application/pdf' && f1.size === bytes.length &&
  f1.kind === 'export' && f1.source === 'sent-quote' && f1.author === 'office@floodroofing.co.nz' && !('storage_path' in f1), JSON.stringify(f1));

// ── 2. Every version of the job shares its files ───────────────────────
const sg2 = await me('POST', '/jobs/j1v2/files/sign', { name: 'roof photo.jpg', size: 4, mime: 'image/jpeg', kind: 'upload' });
await fetch(sg2.body.signedUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('jpeg') });
await me('POST', '/jobs/j1v2/files/' + sg2.body.fileId + '/landed', {});
const fromRoot = await me('GET', '/jobs/j1/files'), fromV2 = await me('GET', '/jobs/j1v2/files');
check('a version’s upload is the job’s: the root and the version list the same files, newest first',
  fromRoot.body.files.length === 2 && fromV2.body.files.length === 2 && fromRoot.body.files[0].name === 'roof photo.jpg' &&
  /^c1\/j1\//.test(sg2.body.path || ''), JSON.stringify(fromRoot.body.files.map(f => f.name)));

// ── 3. Opened through a short-lived link ───────────────────────────────
const u = await me('GET', '/jobs/j1/files/' + sg.body.fileId + '/url');
const got = u.body.url ? Buffer.from(await (await fetch(u.body.url)).arrayBuffer()).toString() : '';
check('a file opens through a link that reads its bytes back', u.status === 200 && got === bytes.toString() && u.body.mime === 'application/pdf', JSON.stringify(u.body));

// ── 4. Another company never sees, opens, adds to or deletes them ──────
const tL = await them('GET', '/jobs/j1/files'), tU = await them('GET', '/jobs/j1/files/' + sg.body.fileId + '/url');
const tS = await them('POST', '/jobs/j1/files/sign', { name: 'x.pdf', size: 3 }), tD = await them('DELETE', '/jobs/j1/files/' + sg.body.fileId);
check('another company gets "not found" on every route for this job', tL.status === 404 && tU.status === 404 && tS.status === 404 && tD.status === 404,
  [tL.status, tU.status, tS.status, tD.status].join(','));
const own = await them('GET', '/jobs/jr/files');
check('…and its own job lists none of ours', own.status === 200 && own.body.files.length === 0, JSON.stringify(own.body));

// ── 5. Refusals ─────────────────────────────────────────────────────────
const empty = await me('POST', '/jobs/j1/files/sign', { name: 'nothing.txt', size: 0 });
const huge = await me('POST', '/jobs/j1/files/sign', { name: 'huge.zip', size: mem.maxBytes + 1 });
check('an empty file and one over the limit are refused, saying why', empty.status === 400 && empty.body.code === 'EMPTY' && huge.status === 400 && huge.body.code === 'TOO_BIG' && /limit/.test(huge.body.error), JSON.stringify([empty.body, huge.body]));

// ── 6. Deleted: the row and the bytes ───────────────────────────────────
const del = await me('DELETE', '/jobs/j1/files/' + sg2.body.fileId);
const after = await me('GET', '/jobs/j1/files');
check('a file deleted goes from the list and from storage', del.status === 200 && after.body.files.length === 1 && !mem.files.has(sg2.body.path) &&
  !(db.job_files || []).some(r => r.id === sg2.body.fileId), JSON.stringify(after.body.files.map(f => f.name)));

// ── 7. A failed read is an error, never an empty list ───────────────────
db.__fail500 = 'job_files';
const failed = await me('GET', '/jobs/j1/files');
db.__fail500 = null;
check('a failed read answers 503, not "no files"', failed.status === 503 && failed.body.code === 'UPSTREAM_UNAVAILABLE', JSON.stringify(failed));

mem.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
