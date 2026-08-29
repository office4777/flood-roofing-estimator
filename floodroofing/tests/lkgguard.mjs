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

// ── the incident of build 3b079b2: a dirty-check is not a save ────
// A freshly loaded app: the in-memory draft is empty, but yesterday's draft
// geometry is still on disk under fr_lkg_draft. The user clicks a saved job,
// and openJob → _saveBeforeSwitch → _isJobDirty snapshots purely to COMPARE.
// The guard used to fire there anyway — substituting the old drawing made the
// untouched session look dirty, paged the office with "blocked at save", and
// toasted the user that their roof map had gone blank, all on a path that
// persists nothing and could lose nothing.
await load();
await pg.waitForTimeout(400);
const seenBeforeDirty = reports.length;
v = await pg.evaluate(() => {
  // yesterday's draft, as _lkgRemember left it on disk
  const old = JSON.stringify({ outline: DRAW.outline.map(p => p.slice()),
    lines: DRAW.lines, roofs: DRAW.roofs, activeRoofIdx: 0 });
  // …and a genuinely fresh session in front of it
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  S.currentJobId = null; S.linkedJobId = null;
  LKG.byJob = {}; LKG.hadDrawing = null;
  DRAFTS._lastSnapJson = null;
  localStorage.setItem('fr_lkg_draft', old);
  const msgEl = document.getElementById('saveJobMsg'); if (msgEl) msgEl.textContent = '';
  const dirty = _isJobDirty();
  return { dirty, roFlagCleared: !_lkgGuard._readOnly,
           status: (document.getElementById('saveJobMsg') || {}).textContent || '' };
});
check('an untouched fresh session is not dirty for having yesterday\'s draft on disk',
  v.dirty === false, 'dirty=' + v.dirty);
check('…nothing is said to the user over a comparison', !v.status, v.status.slice(0, 100) || 'quiet');
check('…and the read-only flag does not stick', v.roFlagCleared, '');
await pg.waitForTimeout(500);
check('…and nobody is paged over a comparison', reports.length === seenBeforeDirty,
  reports.length > seenBeforeDirty ? (reports[reports.length - 1].message || '').slice(0, 90) : 'no report');
// The same state going through an actual save is still caught red-handed.
v = await pg.evaluate(() => {
  const snap = snapshotCurrentJob();
  return { roofs: (snap.draw.roofs || []).length };
});
check('the same empty state at a real save still gets the full guard',
  v.roofs === 6, 'save-path snapshot carries ' + v.roofs + ' roofs');
await pg.evaluate(() => { try { localStorage.removeItem('fr_lkg_draft'); } catch(e){} });

// ── the incident of build afa8abd: the draft writer has nothing to keep ──
// The same fresh session, but this time it is the debounced LOCAL DRAFT
// writer that ticks — parked on the Settings tab, memory empty, yesterday's
// draft geometry still on disk. The writer used to snapshot straight through
// the guard, which paged the office and resurrected the old geometry into a
// junk draft — on a write _snapHasSubstance was about to skip anyway.
await load();
await pg.waitForTimeout(400);
const seenBeforeWriter = reports.length;
v = await pg.evaluate(async () => {
  const old = JSON.stringify({ outline: DRAW.outline.map(p => p.slice()),
    lines: DRAW.lines, roofs: DRAW.roofs, activeRoofIdx: 0 });
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  S.currentJobId = null; S.linkedJobId = null;
  LKG.byJob = {}; LKG.hadDrawing = null;
  _lkgReported = {};                       // a fresh session has no dedupe history
  localStorage.setItem('fr_lkg_draft', old);
  const before = (await _listLocalDrafts()).map(d => d.key + '@' + d.at).sort().join('|');
  const msgEl = document.getElementById('saveJobMsg'); if (msgEl) msgEl.textContent = '';
  const wrote = await _writeLocalDraftNow();
  const after = (await _listLocalDrafts()).map(d => d.key + '@' + d.at).sort().join('|');
  return { wrote, untouched: before === after, roFlagCleared: !_lkgGuard._readOnly,
           status: (document.getElementById('saveJobMsg') || {}).textContent || '' };
});
check('the draft writer with nothing worth keeping leaves quietly', v.wrote === false, 'wrote=' + v.wrote);
check('…files no junk draft', v.untouched, 'draft store changed');
check('…says nothing to the user', !v.status, v.status.slice(0, 100) || 'quiet');
check('…and the read-only flag does not stick there either', v.roFlagCleared, '');
await pg.waitForTimeout(500);
check('…and nobody is paged over a write that never happened', reports.length === seenBeforeWriter,
  reports.length > seenBeforeWriter ? (reports[reports.length - 1].message || '').slice(0, 90) : 'no report');
// But give the same session something worth keeping — a client name typed in
// — and the write is real again: the guard files the remembered drawing with
// it rather than a blank, because THAT write could have lost a roof map.
v = await pg.evaluate(async () => {
  const el = document.getElementById('jobClient'); if (el) el.value = 'A Customer';
  const wrote = await _writeLocalDraftNow();
  const mine = (await _listLocalDrafts()).find(d => (d.client || '') === 'A Customer');
  if (el) el.value = '';
  try { localStorage.removeItem('fr_lkg_draft'); } catch(e){}
  return { wrote, roofs: mine ? (((mine.snap || {}).draw || {}).roofs || []).length : null };
});
check('…while a session with real work still gets the full guard on its draft',
  v.wrote === true && v.roofs === 6, 'wrote=' + v.wrote + ', draft carries roofs=' + v.roofs);

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
