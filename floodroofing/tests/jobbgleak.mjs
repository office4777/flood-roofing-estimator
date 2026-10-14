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

// ── AND THE QUOTE, THE WORST OF THEM (2026-10-12) ─────────────────
// The owner had Phyllis's job open, chose a different job, and got
// "Job 3287 already exists" against Beth Williamson's. Same leak, same
// line: Object.assign only overwrites keys the incoming job HAS, so a job
// saved with no quote block kept the LAST job's quote -- client, totals
// and its `ref`. The server derives a job's number from
// draw_state.state.quote.ref, so every autosave then tried to create a
// second record under the previous job's number and was refused with
// DUPLICATE_JOB_NO, over and over. The refusal was right; the carry-over
// was the bug.
const carry = await pg.evaluate(() => {
  const r = {};
  // A quoted job: Phyllis, 3287.
  restoreFromJob({ id:'j1', updated_at:'x', draw_state:{ state:{
    quote:{ ref:'3287', client:'Phyllis Rintoul', addr:'350 Horeke Road', psSubtotal:2500 } } } });
  r.first = { ref:S.quote.ref, client:S.quote.client };
  // Switch to a job that has NEVER been quoted -- no quote block at all.
  restoreFromJob({ id:'j2', updated_at:'y', draw_state:{ state:{ client:'Beth Williamson' } } });
  r.unquoted = { ref:S.quote.ref, client:S.quote.client, addr:S.quote.addr, sub:S.quote.psSubtotal };
  // …and a job that carries its own quote still gets its own back.
  restoreFromJob({ id:'j3', updated_at:'z', draw_state:{ state:{
    quote:{ ref:'3296', client:'Beth Williamson' } } } });
  r.own = { ref:S.quote.ref, client:S.quote.client };
  return r;
});
check('the previous job\'s quote REF does not follow you into an unquoted job',
  carry.unquoted.ref !== '3287' && !!carry.unquoted.ref, JSON.stringify(carry.unquoted));
check('…nor its client, address or totals',
  !carry.unquoted.client && !carry.unquoted.addr && !carry.unquoted.sub,
  JSON.stringify(carry.unquoted));
check('…and a job that has its own quote still opens on it',
  carry.own.ref === '3296' && carry.own.client === 'Beth Williamson', JSON.stringify(carry.own));
check('…the job it came from was itself unharmed',
  carry.first.ref === '3287' && carry.first.client === 'Phyllis Rintoul', JSON.stringify(carry.first));

// ── FEEDBACK 13: data bleed between the last open job and this one ──
// Everything a job CONTAINS now goes through _releaseJobContent, because the
// list had been copied into three places and only one of them was kept up.
const rel = await pg.evaluate(() => {
  const r = {};
  // Job A: a fully worked job -- pages laid out, flashings struck off, a
  // price typed over the book, a picture, files, an order sent.
  restoreFromJob({ id:'a1', updated_at:'x', draw_state:{ state:{
    quote:{ ref:'3292', client:'Job A' }, img64:'iVBORw0KGgo', files:[{name:'plan.pdf'}],
    jobPack:{ pages:['header','cutlists'] }, jpFlashTypeOff:{ barge:true },
    clearliteMaterial:'polycarb', orderSent:'2026-10-01', fergusSent:'2026-10-01',
    matOv:{ sheets:{ price: 99 } }, matDel:{ underlay:true } } } });
  r.a = { pack: !!S.jobPack, flash: Object.keys(S.jpFlashTypeOff || {}).length,
          cl: S.clearliteMaterial, ov: Object.keys(MATERIAL_OVERRIDES || {}).length,
          img: !!S.img64, files: (S.files || []).length };
  S.jobLocked = true; S.versions = [{ id:'v1' }];
  // Now take the ONE path that never ran that list: a Fergus job RoofMap has
  // never saved. No saved mapping, no local draft -- the fresh branch.
  S.fergJobsCache = [{ id:'f9', jobNo:'3306', customer:'Job B', address:'2 Elm St' }];
  return r;
});
await pg.evaluate(async () => { try { await useFergusJobInModal('f9'); } catch(e){} });
await pg.waitForTimeout(500);
const after = await pg.evaluate(() => ({
  pack: !!S.jobPack, flash: Object.keys(S.jpFlashTypeOff || {}).length,
  cl: S.clearliteMaterial, ov: Object.keys(MATERIAL_OVERRIDES || {}).length,
  del: Object.keys(MATERIAL_DELETED || {}).length,
  img: !!S.img64, files: (S.files || []).length, order: S.orderSent, ferg: S.fergusSent,
  ref: (S.quote || {}).ref, client: (S.quote || {}).client,
  locked: !!S.jobLocked, loaded: !!S._jobLoaded, vers: (S.versions || []).length,
  linked: S.linkedJobId,
}));
check('job A really was carrying all of it',
  rel.a.pack && rel.a.flash === 1 && rel.a.cl === 'polycarb' && rel.a.ov === 1 && rel.a.img && rel.a.files === 1,
  JSON.stringify(rel.a));
check('a Fergus job RoofMap never saved does not inherit the last job\'s Job Pack',
  after.pack === false, JSON.stringify({ pack: after.pack }));
check('\u2026nor its struck-off flashings or its clearlite',
  after.flash === 0 && after.cl === 'fibreglass', JSON.stringify({ flash: after.flash, cl: after.cl }));
check('\u2026nor a $/unit typed on the other roof',
  after.ov === 0 && after.del === 0, JSON.stringify({ ov: after.ov, del: after.del }));
check('\u2026nor its picture, its files or its sent stamps',
  after.img === false && after.files === 0 && !after.order && !after.ferg,
  JSON.stringify({ img: after.img, files: after.files, order: after.order, ferg: after.ferg }));
check('\u2026nor the quote: a fresh Fergus job is this customer\'s',
  after.ref !== '3292' && after.client !== 'Job A', JSON.stringify({ ref: after.ref, client: after.client }));
// The identity half: that branch never called _releaseCurrentJob, so a LOCKED
// job arrived locked on a job that cannot be unlocked from.
check('\u2026and it is NOT locked by the job you left',
  after.locked === false, String(after.locked));
check('\u2026with no stale base stamp or version list, and the new link in place',
  after.loaded === false && after.vers === 0 && after.linked === 'f9',
  JSON.stringify({ loaded: after.loaded, vers: after.vers, linked: after.linked }));

// ── the report's own fields must be true ──────────────────────
// "Roof image: none" and "Job selected: no" were printed on every report ever
// sent, because neither field existed on the object being read. A diagnostic
// that is wrong is worse than one that is missing: it gets believed.
const diag = await pg.evaluate(() => {
  DRAW.bgImg = { width: 10, height: 10 }; DRAW.bgFrom = 'linz';
  S.currentJobId = 'j77'; S.linkedJobId = 'f9'; S.linkedJobNo = '3306';
  S.quote = S.quote || {}; S.quote.ref = '3306';
  const t = _fbAutoContext();
  DRAW.bgImg = null;
  return { txt: t, none: _fbAutoContext() };
});
check('the report says there IS a roof image when there is one',
  /Roof image:\s*loaded \(linz\)/.test(diag.txt) && /Roof image:\s*none/.test(diag.none),
  (diag.txt.match(/Roof image:.*/) || [''])[0]);
check('\u2026and names the job that is actually open',
  /Job selected:.*saved job j77/.test(diag.txt) && /Fergus job 3306/.test(diag.txt) && /job no 3306/.test(diag.txt),
  (diag.txt.match(/Job selected:.*/) || [''])[0]);

check('no page errors through any of that', errs.length === 0, errs.join(' | ').slice(0, 160));
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
