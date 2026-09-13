// A locked job was lost by "New job".
//
// Job 3218 was finished and locked, then New job was pressed. The canvas
// cleared but the sidebar went on saying "Job 3218 · Alfred Crawford" —
// because New job dropped S.currentJobId and left the FERGUS link pointing
// at the job just finished. The first save of the blank job then created a
// new record and remapped Fergus 3218 onto it, so re-opening 3218 from the
// Fergus list showed an empty roof. The drawing was still in Saved jobs;
// nothing said so.
//
// New job must let go of the whole identity — id, Fergus link, lock — and
// the Fergus job must keep pointing at the job it actually belongs to.
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
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const posted = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const req = r.request(), url = req.url();
  if (req.method() === 'POST' && /\/jobs(\?|$)/.test(url)) {
    posted.push(req.postData() || '');
    return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'job-new-1', updated_at:'2026-09-14T00:00:00.000Z' }) });
  }
  if (req.method() === 'PUT' && /\/jobs\//.test(url)) {
    return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'job-3218-row', updated_at:'2026-09-14T00:00:00.000Z' }) });
  }
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  // Fergus job 3218 is already mapped to the job it belongs to.
  localStorage.setItem('fr_ferg2job', JSON.stringify({ 'F3218': 'job-3218-row' })); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);

// ── the state the roofer was in: job open, Fergus-linked, LOCKED ──
await pg.evaluate(() => {
  window.confirm = () => true;
  S.currentJobId = 'job-3218-row';
  S.jobLocked = true;
  S.linkedJobId = 'F3218'; S.linkedJobNo = '3218';
  S.linkedJobName = 'Alfred Crawford — 12 Kamo Road';
  const c = document.getElementById('jobClient'); if (c) c.value = 'Alfred Crawford';
  const a = document.getElementById('jobAddr');   if (a) a.value = '12 Kamo Road';
  DRAW.outline = [[100,100],[400,100],[400,300],[100,300]]; DRAW.outlineDone = true;
  try { redrawAll(); } catch(e){}
  try { setCurrentJobLabel({ id: S.currentJobId, client_name:'Alfred Crawford', site_address:'12 Kamo Road' }); } catch(e){}
});
const wasLabel = await pg.evaluate(() =>
  (document.getElementById('navJobName')||{}).textContent || '');
check('the sidebar names the open job to start with', /3218|Alfred/.test(wasLabel), wasLabel.trim().slice(0,60));

// ── New job ───────────────────────────────────────────────────────
await pg.evaluate(() => startNewJob());
await pg.waitForTimeout(900);
const after = await pg.evaluate(() => ({
  id: S.currentJobId, linkId: S.linkedJobId, linkNo: S.linkedJobNo, linkName: S.linkedJobName,
  locked: !!S.jobLocked, lockActive: (typeof _jobLockActive === 'function') ? _jobLockActive() : null,
  nav: (document.getElementById('navJobName')||{}).textContent || '',
  bar: (document.getElementById('globalJobBarName')||{}).textContent || '',
  outline: (DRAW.outline||[]).length,
  map: JSON.parse(localStorage.getItem('fr_ferg2job') || '{}'),
}));
check('the new job is not the old one', after.id === null, String(after.id));
check('…and is not still linked to the old Fergus job',
  !after.linkId && !after.linkNo && !after.linkName,
  [after.linkId, after.linkNo, after.linkName].join(' | '));
check('…and does not inherit the old job\'s lock',
  after.locked === false && !after.lockActive, 'locked=' + after.locked);
check('the sidebar stops naming the finished job',
  !/3218|Alfred/.test(after.nav + ' ' + after.bar), (after.nav + ' / ' + after.bar).trim().slice(0, 70));
check('and the canvas really is blank', after.outline === 0, after.outline + ' corners');
check('Fergus 3218 still points at the job it belongs to',
  after.map.F3218 === 'job-3218-row', JSON.stringify(after.map));

// ── saving the new job must not steal the old job's Fergus number ──
await pg.evaluate(async () => {
  const c = document.getElementById('jobClient'); if (c) c.value = 'Someone Else';
  const a = document.getElementById('jobAddr');   if (a) a.value = '9 New Street';
  DRAW.outline = [[10,10],[60,10],[60,60],[10,60]]; DRAW.outlineDone = true;
  await saveCurrentJob();
});
await pg.waitForTimeout(700);
const end = await pg.evaluate(() => ({
  id: S.currentJobId,
  map: JSON.parse(localStorage.getItem('fr_ferg2job') || '{}'),
}));
check('the new job saves as its own record', end.id === 'job-new-1', String(end.id));
check('…and Fergus 3218 STILL points at the finished job, not the new one',
  end.map.F3218 === 'job-3218-row', JSON.stringify(end.map));
check('the finished job was never written over', 
  !posted.some(p => /Alfred Crawford/.test(p || '')), posted.length + ' POSTs');

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
