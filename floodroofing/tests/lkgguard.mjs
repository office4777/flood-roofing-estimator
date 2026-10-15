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

// Quote-only "substance" is not human work: the quote model assembles its
// default line items the moment the Quote tab renders, which used to clear
// the substance bar on every fresh open — and page the office (build
// ab9a990, tab=schedule). Same fresh session, quote lines present, still
// nothing typed: the writer must leave quietly.
v = await pg.evaluate(async () => {
  S.quote = { lineItems: [{ description: 'Roofing', amount: 1000 }] };
  const before = (await _listLocalDrafts()).map(d => d.key + '@' + d.at).sort().join('|');
  const wrote = await _writeLocalDraftNow();
  const after = (await _listLocalDrafts()).map(d => d.key + '@' + d.at).sort().join('|');
  return { wrote, untouched: before === after };
});
check('auto-built quote lines alone do not make a fresh session write', v.wrote === false, 'wrote=' + v.wrote);
check('…file no draft', v.untouched, 'draft store changed');
await pg.waitForTimeout(400);
check('…and page nobody', reports.length === seenBeforeWriter,
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

// ── resuming an EMPTY draft while another job's drawing is in memory ──
// _resumeDraft hands restoreFromJob no id, so the guard's key is still the
// job that was open. The dirty-tracker baseline at the end of restoreFromJob
// is a read, not a save: it must not page anybody, and must not swap the old
// job's roof into the new draft.
await load();
await pg.waitForTimeout(300);
v = await pg.evaluate(() => {
  S.currentJobId = null;                         // an unsaved job: its drawing is filed under 'draft'
  _lkgRebase();
  _lkgReported = {};                             // a fresh session has no dedupe history
  const n0 = _lkgReports;
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  const emptySnap = (function(){ _lkgGuard._readOnly = true; try { return snapshotCurrentJob(); } finally { _lkgGuard._readOnly = false; } })();
  const msgEl = document.getElementById('saveJobMsg'); if (msgEl) msgEl.textContent = '';
  // As _resumeDraft does — no id yet; a draft that never drew carries no `draw`.
  restoreFromJob({ draw_state: { form: emptySnap.form, state: emptySnap.state } });
  return { reported: _lkgReports - n0, roFlagCleared: !_lkgGuard._readOnly,
           status: (document.getElementById('saveJobMsg') || {}).textContent || '' };
});
// Counted in the page: the wire reporter caps and dedupes per session, so a
// report it swallowed would still be a report.
check('resuming an empty draft over an open job is not reported as a blocked save', v.reported === 0, v.reported + ' report(s)');
check('…says nothing about a blank roof map', !/blank/.test(v.status), v.status.slice(0, 100) || 'quiet');
check('…and the read-only flag does not stick', v.roFlagCleared, '');

// ── UNDO IS AN EXPLICIT EMPTYING (2026-10-15) ─────────────────
// A client error report from info@wellingtonroof.co.nz on build d8a0000:
// "empty drawing blocked at save — job=draft roofs=0 outline=0 lines=0
// hadDrawing=no lkgSource=memory", through startNewJob → _saveBeforeSwitch
// → _writeLocalDraftNow. The guard's own rule is that only an explicit clear
// may empty a drawing, "and those say so by calling _lkgForget()" — Clear,
// Delete roof and New job all do; UNDO did not, and it is just as explicit.
// So undoing past the first corner paged the office, told him his roof map
// had gone blank, and PUT THE UNDONE ROOF BACK into the draft.
const undo = await pg.evaluate(async () => {
  const r = {}; let seen = 0;
  const realReport = window._lkgReport;
  window._lkgReport = function(){ seen++; };
  const drawOne = () => { DRAW.outline = [[200,200],[800,200],[800,520],[200,520]];
    DRAW.outlineDone = true; regenerateAutoRoofLines('hip');
    try { _syncCurrentToRoof(); } catch(e){} };

  // (1) his exact path: draw on an unsaved draft, undo it all, then save
  gotoTab('roof'); clearAll(true); setTool('select');
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  saveSnapshot(); drawOne(); snapshotCurrentJob();
  r.armed = !!LKG.byJob['draft'];
  seen = 0;
  for (let i = 0; i < 6; i++) { try { undoLast(); } catch(e){} }
  r.afterUndo = { outline:(DRAW.outline||[]).length, lkg: !!LKG.byJob['draft'] };
  const snap = snapshotCurrentJob();
  r.saved = { outline: ((snap.draw||{}).outline||[]).length, reports: seen };

  // (2) the guard still catches a drawing that vanished with NOBODY asking
  clearAll(true); DRAW.scaleMetresPerPx = 0.03; drawOne(); snapshotCurrentJob();
  seen = 0;
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];
  const s2 = snapshotCurrentJob();
  r.vanished = { outline: ((s2.draw||{}).outline||[]).length, reports: seen };

  // (3) undoing ONE line of many must leave the guard armed
  clearAll(true); DRAW.scaleMetresPerPx = 0.03; saveSnapshot(); drawOne(); snapshotCurrentJob();
  saveSnapshot(); DRAW.lines.pop(); undoLast();
  r.partial = { lines:(DRAW.lines||[]).length, lkg: !!LKG.byJob[_lkgKey()] };

  // (4) redo re-arms it by itself at the next save
  for (let i = 0; i < 8; i++) { try { undoLast(); } catch(e){} }
  const mid = !!LKG.byJob[_lkgKey()];
  for (let i = 0; i < 8; i++) { try { redoLast(); } catch(e){} }
  snapshotCurrentJob();
  r.redo = { mid: mid, outline:(DRAW.outline||[]).length, lkg: !!LKG.byJob[_lkgKey()] };

  window._lkgReport = realReport;
  return r;
});
check('a roof drawn on an unsaved draft arms the guard', undo.armed === true);
check('undoing back past the first corner lets the guard go',
  undo.afterUndo.outline === 0 && undo.afterUndo.lkg === false, JSON.stringify(undo.afterUndo));
check('\u2026so the save that follows writes the blank the roofer asked for',
  undo.saved.outline === 0, JSON.stringify(undo.saved));
check('\u2026and nobody is paged about it', undo.saved.reports === 0, String(undo.saved.reports));
check('but a drawing that vanishes with NOBODY asking is still put back',
  undo.vanished.outline === 4, JSON.stringify(undo.vanished));
check('\u2026and that one still reports', undo.vanished.reports === 1, String(undo.vanished.reports));
check('undoing one line of many leaves the guard armed',
  undo.partial.lines > 0 && undo.partial.lkg === true, JSON.stringify(undo.partial));
check('redo brings the drawing back and the guard re-arms itself',
  undo.redo.mid === false && undo.redo.outline === 4 && undo.redo.lkg === true,
  JSON.stringify(undo.redo));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
