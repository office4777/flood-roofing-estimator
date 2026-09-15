// Report 53: "opened this job 2971 and the previous job's uploaded picture
// was there."
//
// Two faults, one victim. restoreFromJob does Object.assign(S, snap.state) —
// which only overwrites the keys the INCOMING job has. A job saved with no
// picture has no img64 key, so the previous job's picture stayed in S: shown
// on the preview card, and worse, written into THIS job on the next save.
// Every other leak of that shape (order stamp, files, struck-off flashings)
// was already reset before the assign; the picture was not.
//
// The second half was the screen: with no `else`, the preview card kept the
// last job's photo and the upload zone stayed hidden, so a roofer opening a
// fresh job was looking at another roof.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:1000 } });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2400);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });

// Job A carries a picture. Job B — like 2971 — was saved without one, so its
// snapshot has no img64 key at all. That absence is the whole bug.
const JOB_A = {
  id: 'job-a', client_name: 'A', draw_state: { state: { img64: 'iVBORw0KGgoAAAANSUhEUg', photos: [] }, draw: {} },
};
const JOB_B = {
  id: 'job-b', client_name: 'B', draw_state: { state: { photos: [] }, draw: {} },
};

await pg.evaluate((j) => restoreFromJob(j), JOB_A);
await pg.waitForTimeout(400);
let v = await pg.evaluate(() => ({
  img64: !!(window.S && S.img64),
  prev: (document.getElementById('roofPrev') || {}).style?.display,
  uz: (document.getElementById('roofUZ') || {}).style?.display,
}));
check('a job WITH a picture shows it', v.img64 === true && v.prev === 'block', JSON.stringify(v));

await pg.evaluate((j) => restoreFromJob(j), JOB_B);
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  img64: (window.S && S.img64) || null,
  prev: (document.getElementById('roofPrev') || {}).style?.display,
  uz: (document.getElementById('roofUZ') || {}).style?.display,
  src: (document.getElementById('roofPrevImg') || {}).getAttribute('src'),
}));
check('THE REPORT: a job with no picture does not inherit the last one',
  !v.img64, 'S.img64 after opening job B: ' + String(v.img64).slice(0, 24));
check('…the preview card is put away', v.prev === 'none', String(v.prev));
check('…the upload zone comes back', v.uz === 'block', String(v.uz));
check('…and the old picture is off the screen entirely', !v.src, String(v.src));

// The part that would have been invisible until a supplier order was wrong:
// what the NEXT save of job B would write.
const saved = await pg.evaluate(() => (window.S && S.img64) || null);
check('…so saving job B cannot write job A\'s picture into it', !saved, String(saved));

// And the other way round: opening a job WITH a picture still restores it
// after one without.
await pg.evaluate((j) => restoreFromJob(j), JOB_A);
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  img64: !!(window.S && S.img64),
  prev: (document.getElementById('roofPrev') || {}).style?.display,
}));
check('a picture still comes back when the job has one', v.img64 === true && v.prev === 'block', JSON.stringify(v));

check('no page errors through any of that', errs.length === 0, errs.join(' | ').slice(0, 160));
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
