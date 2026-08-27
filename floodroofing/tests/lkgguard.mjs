// A roof map is an hour on a ladder and cannot be retyped from memory. This
// suite is about the one mistake that cannot be undone from the roof: writing
// a blank drawing over a good one.
//
// _lkgGuard already stops that when it has a last-known-good to fall back on —
// that is the "empty drawing blocked at save" line in the error monitor, which
// is the net catching something, not the bug. The holes are either side of it:
// when there is NO last known good it writes the blank and says nothing at
// all, and the roof-switching helpers that load one roof into DRAW to measure
// it can leave DRAW somewhere else entirely if anything goes wrong midway.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const reports = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  if (/client-error/.test(r.request().url())){
    try { reports.push(JSON.parse(r.request().postData() || '{}')); } catch(e){ reports.push({}); }
  }
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

const load = () => pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { outline:(r.outline||[]).map(p => p.slice()), lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = 0;
  S.currentJobId = 'job-guard';
  try { _lkgForget(); } catch(e){}
  try { redrawAll(); } catch(e){}
}, GEOM);
await load();
await pg.waitForTimeout(600);

// ── the net that already works ────────────────────────────────────
let v = await pg.evaluate(() => {
  _lkgRebase();                                  // a good drawing is on the job
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];   // …and it goes blank
  const snap = snapshotCurrentJob();
  return { roofs: (snap.draw.roofs || []).length, outline: (snap.draw.outline || []).length };
});
check('a job that has a drawing never saves an empty one',
  v.roofs === 6 && v.outline >= 3, JSON.stringify(v));

// ── the hole: no last known good, and it goes quietly ─────────────
// This is the path that loses a roof map with no warning and no report — the
// guard has nothing to fall back on, so it writes the blank and returns.
await load();
await pg.waitForTimeout(400);
const seenBefore = reports.length;
v = await pg.evaluate(() => {
  // The job opened WITH a roof map…
  _lkgRebase();
  // …but the remembered copy is filed under another key. This is not
  // contrived: _resumeDraft calls restoreFromJob with no id and sets
  // S.currentJobId on the next line, so the geometry lands under the previous
  // job's name and the lookup here misses.
  try { localStorage.removeItem('fr_lkg_' + S.currentJobId); delete LKG.byJob[S.currentJobId]; } catch(e){}
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];
  let threw = null, saved = null;
  try { saved = snapshotCurrentJob(); } catch(e){ threw = e.message; }
  return { threw, savedRoofs: saved ? (saved.draw.roofs || []).length : null,
           status: (document.getElementById('saveJobMsg') || {}).textContent || '' };
});
check('a blank is refused even when the remembered copy cannot be found',
  !!v.threw && v.savedRoofs === null,
  v.threw ? 'refused: ' + v.threw : 'SAVED ' + v.savedRoofs + ' roofs');
check('…and the office is told, in words that say what to do next',
  /roof map went blank/i.test(v.status) && /history/i.test(v.status),
  v.status.slice(0, 120) || '(nothing said)');
await pg.waitForTimeout(400);
check('…and it is reported, rather than going quietly',
  reports.length > seenBefore &&
  /empty drawing/i.test(reports[reports.length-1].message || ''),
  reports.length > seenBefore ? reports[reports.length-1].message.slice(0,90) : 'nothing new reported');

// ── the explicit clear must still work ────────────────────────────
await load();
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  _lkgRebase();
  clearAll(true);                                // Clear — asked for
  const snap = snapshotCurrentJob();
  return { roofs: (snap.draw.roofs || []).length, outline: (snap.draw.outline || []).length };
});
check('clearing on purpose still saves an empty drawing',
  v.roofs === 0 && v.outline === 0, JSON.stringify(v));

// ── the report has to be diagnosable ──────────────────────────────
const guardReport = reports.find(r => /empty drawing/i.test(r.message || '')) || {};
check('the report names the save path it came from',
  !!(guardReport.stack && guardReport.stack.length > 20),
  guardReport.stack ? guardReport.stack.split('\n')[0] : '(no stack)');
check('…and carries the state that would explain it',
  /roofs=/.test(guardReport.message || '') || /roofs/.test(JSON.stringify(guardReport.detail || {})),
  (guardReport.message || '').slice(0, 140));

// ── the roof-switching helpers put DRAW back ──────────────────────
await load();
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  DRAW.activeRoofIdx = 0;
  const before = DRAW.activeRoofIdx;
  const beforeOutline = JSON.stringify(DRAW.outline);
  // Throw on the THIRD roof, not the first — a throw on roof 0 leaves DRAW
  // where it already was and proves nothing.
  let n = 0;
  try { _matEachSelectedRoof(function(){ if (++n === 3) throw new Error('takeoff blew up'); }); } catch(e){}
  return { before, after: DRAW.activeRoofIdx,
           same: JSON.stringify(DRAW.outline) === beforeOutline };
});
check('a take-off that throws part-way leaves DRAW on the roof it started on',
  v.after === v.before && v.same, 'roof ' + v.before + ' → ' + v.after + ', outline same: ' + v.same);

v = await pg.evaluate(() => {
  DRAW.activeRoofIdx = -1;                       // what deleting the last roof leaves
  let seen = 0;
  try { _matEachSelectedRoof(function(){ seen++; }); } catch(e){}
  // The leak is the index: DRAW ends up claiming to be a roof the user never
  // chose, and the next _syncCurrentToRoof writes into it.
  return { seen, idx: DRAW.activeRoofIdx };
});
check('…and with no active roof, DRAW does not end up claiming somebody else’s',
  v.idx === -1, 'visited ' + v.seen + ' roofs, activeRoofIdx ended at ' + v.idx);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
