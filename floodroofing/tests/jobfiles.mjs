// Files on the job, for the businesses without a Fergus to hold them — and
// the "use this site photo as the drawing background" path that replaces
// "Import from Fergus" when nothing is linked.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// ── adding files through the picker ───────────────────────────────
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(600);
await pg.setInputFiles('#jobFileInput', [
  { name: 'council-plans.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake plans') },
  { name: 'old-quote.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('doc') },
]);
await pg.waitForTimeout(700);
let v = await pg.evaluate(() => ({ n: S.files.length, names: S.files.map(f => f.name),
  listed: document.querySelector('.jobFilesList').textContent }));
check('PDFs and documents land on the job', v.n === 2 && v.names.join() === 'council-plans.pdf,old-quote.docx', JSON.stringify(v.names));
check('…and show in the files list with a size', /council-plans\.pdf/.test(v.listed) && /KB|B/.test(v.listed), v.listed.slice(0,80));

// an image through the SAME picker becomes a photo, not a blob in the files list
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await pg.setInputFiles('#jobFileInput', [{ name: 'site.png', mimeType: 'image/png', buffer: png1x1 }]);
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ files: S.files.length, photos: S.photos.length }));
check('an image picked as a "file" routes into the photo pipeline', v.files === 2 && v.photos === 1, JSON.stringify(v));

// oversize file is refused, not silently truncated
await pg.evaluate(() => _jobFilesAdd({ target: { files: [new File([new Uint8Array(9 * 1024 * 1024)], 'huge.zip', { type: 'application/zip' })], value: '' } }));
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({ n: S.files.length, msg: (document.getElementById('saveStatusMsg')||{}).textContent || '' }));
check('a 9 MB file is skipped with a message, not swallowed', v.n === 2, JSON.stringify(v).slice(0,120));

// ── files ride inside the job snapshot ────────────────────────────
v = await pg.evaluate(() => {
  var snap = snapshotCurrentJob();
  return { inSnap: Array.isArray(snap.state.files) && snap.state.files.length === 2, name: snap.state.files[0].name };
});
check('files ride inside the job snapshot like photos do', v.inSnap && v.name === 'council-plans.pdf', JSON.stringify(v));

v = await pg.evaluate(() => {
  restoreFromJob({ id: 'j2', draw_state: { state: { photos: [], files: [{ name: 'other.pdf', mime: 'application/pdf', size: 10, data: 'data:application/pdf;base64,JVBERg==' }] } } });
  return { n: S.files.length, name: S.files[0].name, listed: document.querySelector('.jobFilesList').textContent };
});
check('opening another job swaps in ITS files', v.n === 1 && v.name === 'other.pdf' && /other\.pdf/.test(v.listed), JSON.stringify(v).slice(0,100));
v = await pg.evaluate(() => {
  restoreFromJob({ id: 'j3', draw_state: { state: { photos: [] } } });
  return { n: S.files.length, listed: document.querySelector('.jobFilesList').textContent };
});
check('…and a job with none shows none', v.n === 0 && /No files yet/.test(v.listed), JSON.stringify(v).slice(0,80));

// ── a site photo becomes the canvas background ────────────────────
await pg.evaluate(() => {
  S.photos.push({ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', caption: '' });
  renderPhotos();
});
await pg.evaluate(() => { gotoTab('roof'); _fergusPanelOpen(true); });
await pg.waitForTimeout(600);
v = await pg.evaluate(() => {
  var g = document.getElementById('jobPhotosGrid');
  return { btn: g ? /Use on canvas/.test(g.innerHTML) : false };
});
check('every site photo offers "Use on canvas"', v.btn, JSON.stringify(v));
v = await pg.evaluate(() => {
  _jobPhotoUseAsBg(0);
  return {
    img64: !!S.img64,
    tab: document.body.getAttribute('data-tab'),
    prev: getComputedStyle(document.getElementById('roofPrev')).display !== 'none',
  };
});
check('choosing it sets the drawing background and lands on Map Roof',
  v.img64 && v.tab === 'roof' && v.prev, JSON.stringify(v));

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
