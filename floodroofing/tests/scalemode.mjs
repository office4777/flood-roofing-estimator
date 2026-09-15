// "No longer to Scale", and the two edit modes behind it.
//
// A roof map is to scale while every number on it is one the geometry itself
// produces. Type a wall length in Scaled mode and the wall MOVES, so the plan
// stays true. Some numbers cannot be realised that way — a hip face's sheet
// run, a cut-list row — and typing one of those stores an override: from then
// on the picture and the numbers disagree and the roofer has to be told.
//
// The owner's two rules are pinned here: a sheet measure nudged by 0.1 m or
// less (overhang) is NOT drift, and in Visual mode a number the user types
// changes that one item and nothing else on the map.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// A plain 10m x 6m gable, calibrated at 0.05 m per pixel.
const GEOM = {
  scaleMetresPerPx: 0.05, calPitch: 20, outlineDone: true,
  outline: [[100,100],[300,100],[300,220],[100,220]],
  lines: [
    { type:'gutter', pts:[[100,220],[300,220]] },
    { type:'gutter', pts:[[100,100],[300,100]] },
    { type:'barge',  pts:[[100,100],[100,220]] },
    { type:'barge',  pts:[[300,100],[300,220]] },
    { type:'ridge',  pts:[[100,160],[300,160]] }
  ]
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'a@b.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2200);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display='none'; document.getElementById('selectJobModal').style.display='none'; } catch(e){}
});
const load = () => pg.evaluate(g => {
  Object.assign(DRAW, JSON.parse(JSON.stringify(g)));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  DRAW.editMode = 'scaled'; DRAW.offScale = null;
  DRAW.sheetOverrides = {}; DRAW.sheetGroupOverrides = {};
  try { autoCalcLineMeasurements(); } catch(e){}
  try { redrawAll(); } catch(e){}
}, GEOM);
await load();

// ── it starts to scale, and says nothing ─────────────────────────
check('a freshly calibrated map is in Scaled edits mode',
  await pg.evaluate(() => DRAW.editMode === 'scaled' && !_visualEdits()));
check('…and the "No longer to Scale" button is not shown',
  await pg.evaluate(() => { _scaleStatusRender(); return document.getElementById('btnNotToScale').style.display === 'none'; }));
check('…with both mode buttons on the page, under the Calibrate row',
  await pg.evaluate(() => {
    const row = document.getElementById('scaleIntegrityRow'), cal = document.getElementById('btn-calibrate');
    return !!(row && cal && document.getElementById('btnModeScaled') && document.getElementById('btnModeVisual') &&
      // the row comes after the toolbar that holds Calibrate
      (cal.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));

// ── the owner's tolerance: overhang is not drift ─────────────────
check('nudging a sheet length by 0.1 m does NOT take the map off scale',
  await pg.evaluate(() => markOffScale('sheet','Sheet length', 6.00, 6.10) === false && !_isOffScale()));
check('…nor by 0.08 m, the usual overhang tweak',
  await pg.evaluate(() => markOffScale('sheet','Sheet length', 6.00, 5.92) === false && !_isOffScale()));
check('…and the map is still in Scaled edits mode after those',
  await pg.evaluate(() => DRAW.editMode === 'scaled'));
check('but 0.35 m on a sheet DOES — that is a different sheet, not an overhang',
  await pg.evaluate(() => markOffScale('sheet','Sheet length', 6.00, 6.35) === true && _isOffScale()));
check('…the warning button appears the moment it does',
  await pg.evaluate(() => document.getElementById('btnNotToScale').style.display !== 'none'));
check('…and the map drops into Visual edits, so nothing chases the wrong number',
  await pg.evaluate(() => DRAW.editMode === 'visual'));
// A plain measurement gets a rounding-sized tolerance only — a ridge is not
// an overhang, and 0.35 m of ridge is 0.35 m of ridge cap unordered.
await load();
check('a non-sheet measurement is held to a rounding tolerance, not 0.1 m',
  await pg.evaluate(() => markOffScale('meas','Ridge', 10.00, 10.09) === true));

// ── reset puts every measurement back ────────────────────────────
await load();
const reset = await pg.evaluate(() => {
  const before = DRAW.lines.map(l => l.measM);
  // Type a ridge length the drawing cannot produce, the way the line popup does.
  DRAW.lines[4].measM = 14.5; DRAW.lines[4].label = '14.50m';
  DRAW.sheetOverrides['x'] = 99; DRAW.sheetGroupOverrides[6000] = 9900;
  _checkLineDrift(DRAW.lines[4]);
  const flagged = _isOffScale();
  resetToExactScale();
  return { before, flagged, after: DRAW.lines.map(l => l.measM), off: _isOffScale(),
           mode: DRAW.editMode, sheets: Object.keys(DRAW.sheetOverrides).length + Object.keys(DRAW.sheetGroupOverrides).length };
});
check('typing a length the drawing cannot produce flags the map', reset.flagged);
check('"Reset to exact scale" puts every measurement back to the calibrated value',
  JSON.stringify(reset.before) === JSON.stringify(reset.after), JSON.stringify(reset.after));
check('…throws the sheet overrides away with them', reset.sheets === 0, String(reset.sheets));
check('…clears the warning and returns to Scaled edits', !reset.off && reset.mode === 'scaled');

// ── visual mode changes ONE thing ────────────────────────────────
await load();
const visual = await pg.evaluate(() => {
  setEditMode('visual', true);
  const scaleBefore = DRAW.scaleMetresPerPx;
  const others = DRAW.lines.filter((_, i) => i !== 0).map(l => l.measM);
  // A gutter edit in Scaled mode RE-CALIBRATES the whole map and forces the
  // ridge and the other gutter to match. In Visual mode it must do neither.
  DRAW.lines[0].measM = 13.7;
  _syncMeasureGroup(DRAW.lines[0], 13.7);
  return { scaleSame: DRAW.scaleMetresPerPx === scaleBefore,
           othersSame: JSON.stringify(others) === JSON.stringify(DRAW.lines.filter((_, i) => i !== 0).map(l => l.measM)) };
});
check('in Visual edits a gutter length no longer re-scales the whole map', visual.scaleSame);
check('…and leaves every other measurement on the map alone', visual.othersSame);

// The same edit in Scaled mode is meant to carry — this is the pin that the
// mode switch turns behaviour off rather than deleting it.
await load();
const scaled = await pg.evaluate(() => {
  setEditMode('scaled', true);
  const before = DRAW.scaleMetresPerPx;
  DRAW.lines[0].measM = 13.7;
  _syncMeasureGroup(DRAW.lines[0], 13.7);
  return { rescaled: DRAW.scaleMetresPerPx !== before, ridge: DRAW.lines[4].measM };
});
check('in Scaled edits the same gutter edit still re-scales the plan', scaled.rescaled);
check('…and pulls the ridge onto the same span', scaled.ridge === 13.7, String(scaled.ridge));

// ── a wall length in visual mode moves no corner ─────────────────
await load();
const wall = await pg.evaluate(() => {
  setEditMode('visual', true);
  const corners = JSON.stringify(DRAW.outline);
  _setOutlineEdgeLength(3, 9.5);          // the left barge wall
  return { moved: JSON.stringify(DRAW.outline) !== corners, shown: DRAW.lines[2].measM, off: _isOffScale() };
});
check('a wall length typed in Visual edits moves no corner of the outline', !wall.moved);
check('…but the number still shows on the line drawn along that wall', wall.shown === 9.5, String(wall.shown));
check('…and the map is marked off scale, because the picture no longer matches', wall.off);

// ── the explanation, and the way back ────────────────────────────
const popup = await pg.evaluate(() => {
  openNotToScale();
  const card = document.getElementById('_ntsWrap');
  const txt = card ? card.textContent : '';
  return { open: !!card, reset: !!(card && card.querySelector('#_ntsReset')),
           says: /no longer to scale/i.test(txt), why: /0\.1\s*m or less/i.test(txt),
           lists: /Wall/.test(txt) };
});
check('the warning button opens an explanation', popup.open && popup.says);
check('…which says what changed', popup.lists);
check('…explains the overhang tolerance rather than leaving it a mystery', popup.why);
check('…and offers "Reset to exact scale" right there', popup.reset);
await pg.evaluate(() => { const w = document.getElementById('_ntsWrap'); if (w) w.remove(); });

// ── hovering a mode explains it, after half a second ─────────────
const tip = await pg.evaluate(async () => {
  const btn = document.getElementById('btnModeVisual');
  btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 200, clientY: 200 }));
  const el = document.getElementById('appTooltip');
  await new Promise(r => setTimeout(r, 300));
  const early = el.style.display;
  await new Promise(r => setTimeout(r, 400));
  const late = el.style.display, txt = el.textContent;
  hideTip();
  return { early, late, txt };
});
check('hovering a mode button says nothing for the first third of a second', tip.early !== 'block');
check('…and explains itself by half a second', tip.late === 'block', tip.late);
check('…in words about what the mode does to the rest of the map', /Nothing else on the map moves/i.test(tip.txt), tip.txt.slice(0, 60));

// ── it survives a save and an undo ───────────────────────────────
const kept = await pg.evaluate(() => {
  DRAW.editMode = 'visual';
  DRAW.offScale = { since: 1, reasons: [{ kind:'sheet', what:'Sheet length', from:6, to:7, at:1 }] };
  saveSnapshot();
  DRAW.editMode = 'scaled'; DRAW.offScale = null;
  undoLast();
  return { mode: DRAW.editMode, off: _isOffScale() };
});
check('undo brings the off-scale warning back with the edits it belongs to',
  kept.mode === 'visual' && kept.off, kept.mode);

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
