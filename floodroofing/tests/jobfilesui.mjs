// FILES & PHOTOS, the window (2026-10-27, the owner: "add a 'Files & Photos'
// button below the history and communications button, allow the user to add
// in photo's or files from their computer, they should be able to click into
// this new button to see all the photo's and files and actually open the files
// from within roofmap ... everytime the user exports a pdf or anything, that
// file should automatically also save in the files and photos on that job ...
// put in a brief note explaining this window only contains files that have
// been exported or sent from roofmap ... this button should also load any
// files and photos from fergus if fergus is connected").
//
// The real app against stubbed routes: the window lists the job's files in
// their sections; an upload signs, PUTs the bytes to storage and lands; an
// export (the pricing CSV) keeps a copy by itself; a file opens inside
// RoofMap (a PDF in a frame, a picture, a CSV as text); the Fergus job's
// files are listed and open; nothing is kept for a job never saved.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());

// The server: a list, sign → storage → landed, a link per file, delete.
const files = [
  { id:'f-q', name:'Quote 3334 - Roofing - Aidan.pdf', mime:'application/pdf', size:120400, kind:'export', source:'sent-quote', author:'office@floodroofing.co.nz', at:'2026-10-27T01:00:00Z' },
  { id:'f-c', name:'RoofMap pricing 3334.csv', mime:'text/csv', size:900, kind:'export', source:'pricing-csv', author:'office@floodroofing.co.nz', at:'2026-10-26T01:00:00Z' },
  { id:'f-p', name:'site photo.png', mime:'image/png', size:68, kind:'upload', source:'', author:'office@floodroofing.co.nz', at:'2026-10-25T01:00:00Z' },
];
const signs = [], puts = [], landed = [], deleted = [];
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('https://storage.test/**', async r => {
  const req = r.request(), u = req.url();
  if (req.method() === 'PUT'){ puts.push({ url: u, type: req.headers()['content-type'], body: req.postDataBuffer() }); return r.fulfill({ status:200, contentType:'application/json', body:'{}' }); }
  if (/f-q/.test(u)) return r.fulfill({ status:200, contentType:'application/pdf', body:'%PDF-1.4\n%%EOF' });
  if (/f-c/.test(u)) return r.fulfill({ status:200, contentType:'text/csv', body:'Section,Item\nJob,Quote 3334\n' });
  if (/f-p|ferg/.test(u)) return r.fulfill({ status:200, contentType:'image/png', body: png1x1 });
  return r.fulfill({ status:404, body:'' });
});
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const req = r.request(), u = req.url(), m = req.method();
  const j = (o, st) => r.fulfill({ status: st || 200, contentType:'application/json', body: JSON.stringify(o) });
  let mm;
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  if (/\/fergus-files\/list/.test(u)) return j({ ok:true, files:[
    { name:'Council plans.pdf', url:'https://fergus.test/plans.pdf', contentType:'application/pdf' },
    { name:'Fergus roof.jpg', url:'https://fergus.test/roof.jpg', contentType:'image/jpeg' } ] });
  if (/\/fergus-files\/download/.test(u)) return r.fulfill({ status:200, contentType: /plans/.test(decodeURIComponent(u)) ? 'application/pdf' : 'image/png', body: /plans/.test(decodeURIComponent(u)) ? '%PDF-1.4\n%%EOF' : png1x1 });
  if ((mm = /\/jobs\/([^/]+)\/files\/sign$/.exec(u)) && m === 'POST'){
    const body = req.postDataJSON(); const id = 'n' + (signs.length + 1);
    signs.push(Object.assign({ job: mm[1] }, body));
    files.unshift({ id, name: body.name, mime: body.mime, size: body.size, kind: body.kind, source: body.source || '', author:'office@floodroofing.co.nz', at: new Date().toISOString(), pending: true });
    return j({ ok:true, fileId: id, signedUrl: 'https://storage.test/up/' + id + '?token=t', path: 'c1/j1/' + id });
  }
  if ((mm = /\/jobs\/[^/]+\/files\/([^/]+)\/landed$/.exec(u))){ landed.push(mm[1]); const f = files.find(x => x.id === mm[1]); if (f) delete f.pending; return j({ ok:true }); }
  if ((mm = /\/jobs\/[^/]+\/files\/([^/]+)\/url$/.exec(u))){ const f = files.find(x => x.id === mm[1]); return f ? j({ ok:true, url:'https://storage.test/get/' + f.id, name: f.name, mime: f.mime, size: f.size }) : j({ error:'nf' }, 404); }
  if ((mm = /\/jobs\/[^/]+\/files\/([^/]+)$/.exec(u)) && m === 'DELETE'){ deleted.push(mm[1]); const i = files.findIndex(x => x.id === mm[1]); if (i >= 0) files.splice(i, 1); return j({ ok:true }); }
  if (/\/jobs\/[^/]+\/files$/.test(u)) return j({ ok:true, files: files.filter(f => !f.pending), maxBytes: 52428800 });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });

// ── nothing is kept for a job never saved ──
await pg.evaluate(async () => { S.currentJobId = null; await _jfKeep(new Blob(['x'], { type:'text/plain' }), 'x.txt', 'export'); });
check('a job never saved keeps nothing (there is nowhere to keep it)', signs.length === 0, signs.length + ' signs');

// ── the button and the window ──
let v = await pg.evaluate(async () => {
  S.currentJobId = 'j1'; S.quote = S.quote || defaultQuote(); S.quote.ref = '3334'; S.linkedJobId = 'F77';
  _jobLockRender();
  await new Promise(r => setTimeout(r, 400));
  const btn = document.getElementById('navJobFilesBtn');
  const shown = getComputedStyle(btn).display !== 'none', count = document.getElementById('navJobFilesCount').textContent;
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  const m = document.getElementById('jobFilesModal');
  const secs = [...m.querySelectorAll('.jf-sec h4')].map(h => h.textContent);
  return { shown, count, open: !!m, secs, note: (m.querySelector('.jf-sec .jf-note') || {}).textContent || '',
           exp: [...m.querySelectorAll('.jf-sec')][0].querySelectorAll('.jf-row').length,
           up: [...m.querySelectorAll('.jf-sec')][1].querySelectorAll('.jf-row').length,
           ferg: [...m.querySelectorAll('[data-jf-ferg]')].map(x => x.querySelector('.jf-name').textContent),
           meta: m.querySelector('[data-jf-file="f-q"] .jf-meta').textContent };
});
check('the left menu’s Files & Photos button is shown with the job and counts its files', v.shown && v.count === '3', JSON.stringify(v));
check('…it opens a window: Exported & sent from RoofMap, Your uploads, From Fergus', v.open &&
  v.secs[0] === 'Exported & sent from RoofMap' && v.secs[1] === 'Your uploads' && v.secs.indexOf('From Fergus') > 1, JSON.stringify(v.secs));
check('…the exported section says it only holds what RoofMap exported or sent, kept automatically',
  /only holds files RoofMap has exported or sent on this job/.test(v.note) && /automatically/.test(v.note), v.note);
check('…each file in its own section, saying what it was and who', v.exp === 2 && v.up === 1 && /Sent quote/.test(v.meta) && /office@floodroofing/.test(v.meta), JSON.stringify(v));
check('…and the Fergus job’s files are listed', JSON.stringify(v.ferg) === '["Council plans.pdf","Fergus roof.jpg"]', JSON.stringify(v.ferg));

// ── a file opens inside RoofMap ──
v = await pg.evaluate(async () => {
  const out = {};
  await _jfOpenStored('f-q'); await new Promise(r => setTimeout(r, 200));
  out.pdf = (document.querySelector('#jobFileViewer iframe') || {}).src || '';
  _jfViewerClose();
  await _jfOpenStored('f-c'); await new Promise(r => setTimeout(r, 400));
  out.csv = (document.querySelector('#jobFileViewer pre') || {}).textContent || '';
  _jfViewerClose();
  await _jfOpenStored('f-p'); await new Promise(r => setTimeout(r, 200));
  out.img = (document.querySelector('#jobFileViewer img') || {}).src || '';
  _jfViewerClose();
  await _jfOpenFergus(0); await new Promise(r => setTimeout(r, 300));
  out.fpdf = (document.querySelector('#jobFileViewer iframe') || {}).src || '';
  out.fname = (document.querySelector('#jobFileViewer .jfv-hd b') || {}).textContent || '';
  _jfViewerClose();
  return out;
});
check('a PDF opens in RoofMap’s own viewer, from its own bytes (a blob always frames)', /^blob:/.test(v.pdf), v.pdf);
check('…a CSV opens as text', /Section,Item/.test(v.csv), v.csv);
check('…a photo opens as a picture', /^blob:/.test(v.img), v.img);
check('…and a Fergus file opens the same way', /^blob:/.test(v.fpdf) && v.fname === 'Council plans.pdf', JSON.stringify(v));

// ── an upload from the computer ──
await pg.setInputFiles('#jfUploadInput', [
  { name:'council consent.pdf', mimeType:'application/pdf', buffer: Buffer.from('%PDF-1.4 consent') },
  { name:'gutter.png', mimeType:'image/png', buffer: png1x1 } ]);
await pg.waitForTimeout(1200);
v = await pg.evaluate(() => ({ up: [...[...document.querySelectorAll('#jobFilesModal .jf-sec')][1].querySelectorAll('.jf-name')].map(x => x.textContent),
  msg: (document.querySelector('#jobFilesModal .jf-msg') || {}).textContent || '' }));
check('uploading signs each file as an upload, PUTs its bytes straight to storage and lands it',
  signs.length === 2 && signs.every(s => s.kind === 'upload' && s.job === 'j1') && puts.length === 2 &&
  puts[0].body.toString() === '%PDF-1.4 consent' && puts[0].type === 'application/pdf' && landed.length === 2,
  JSON.stringify({ signs, puts: puts.map(p => p.url), landed }));
check('…and they are listed under Your uploads, with a message saying so', v.up.indexOf('council consent.pdf') >= 0 && v.up.indexOf('gutter.png') >= 0 && /2 files uploaded/.test(v.msg), JSON.stringify(v));

// ── an export keeps a copy by itself ──
const n0 = signs.length;
await pg.evaluate(async () => { gotoTab('pricing'); await new Promise(r => setTimeout(r, 300)); saveScopePricingAsCsv(); await new Promise(r => setTimeout(r, 900)); });
const kept = signs.slice(n0);
check('exporting the pricing CSV keeps a copy on the job, as an export, without asking',
  kept.length === 1 && kept[0].kind === 'export' && kept[0].source === 'pricing-csv' && /RoofMap pricing 3334\.csv/.test(kept[0].name) && landed.length === n0 + 1, JSON.stringify(kept));
const n1 = signs.length;
await pg.evaluate(async () => { _matDownloadBlob(new Blob(['%PDF'], { type:'application/pdf' }), 'Materials_Order_3334.pdf', 'order-pdf'); await new Promise(r => setTimeout(r, 700)); });
check('…and so does every file the Job Pack hands over', signs.length === n1 + 1 && signs[n1].source === 'order-pdf' && signs[n1].kind === 'export', JSON.stringify(signs.slice(n1)));

// ── delete ──
v = await pg.evaluate(async () => { _jobFilesOpen(); await new Promise(r => setTimeout(r, 600)); await _jfDelete('f-c'); await new Promise(r => setTimeout(r, 300));
  return { gone: !document.querySelector('#jobFilesModal [data-jf-file="f-c"]') }; });
check('a file can be deleted from the window', deleted.indexOf('f-c') >= 0 && v.gone, JSON.stringify({ deleted, v }));

// ── the customer never keeps anything ──
const n2 = signs.length;
await pg.evaluate(async () => { window.__CUSTOMER_MODE = true; await _jfKeep(new Blob(['x']), 'x.pdf', 'quote-pdf'); window.__CUSTOMER_MODE = false; });
check('a customer’s own download is never kept on the office’s job', signs.length === n2);

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
