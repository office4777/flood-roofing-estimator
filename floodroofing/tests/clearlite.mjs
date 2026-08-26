// "One of the roofs is actually a clearlite roof. In the job pack, let the user
//  add clearlite sheets and choose whether it's fibreglass or polycarbonate.
//  Also let them select the roof type on the canvas (Steel Corrugate, Steel
//  5-Rib, Clearlite 5-Rib, Clearlite Corrugate). Also let them add a clearlite
//  like it does with a penetration — prompt full length or short, and if short
//  ask for the length."
//
// Three things, one material. The part that is easy to get wrong is the
// arithmetic: a full-length clear takes a steel sheet's PLACE in the run, it
// does not sit on top of one. Order a full roof of steel plus the clears and
// the extra sheets turn up on the truck. A short clear is different — it is an
// infill, and the steel above and below it is still needed.
//
// The other trap is per-roof state. A lean-to in Clearlite over a steel main
// roof is the ordinary case here, so sheet type belongs to the roof, not the
// job, and switching roofs has to bring the picker with it.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
// The real six-roof job from the feedback PDF — the one that prompted the
// clearlite request in the first place. A hand-made rectangle gives the tiler
// nothing to count, so the sheet arithmetic below needs a real take-off.
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_jp_preview','0'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2700);

// A calibrated gable with gutters, so the sheet plan has real runs to hang
// clears off.
await pg.evaluate(() => {
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 20;
  DRAW.outline = [[100,100],[900,100],[900,500],[100,500]]; DRAW.outlineDone = true;
  DRAW.lines = [
    { type:'ridge',  pts:[[100,300],[900,300]], measM:24 },
    { type:'gutter', pts:[[100,100],[900,100]], measM:24 },
    { type:'gutter', pts:[[100,500],[900,500]], measM:24 },
  ];
  DRAW.roofs = null; try { redrawAll(); } catch(e){}
  gotoTab('roof');
});
await pg.waitForTimeout(600);

// ── the canvas sheet-type picker ──────────────────────────────────
const picker = await pg.evaluate(() => {
  const sel = document.getElementById('roofSheetType');
  return { present: !!sel, visible: !!(sel && sel.offsetParent),
           opts: sel ? [...sel.options].map(o => o.textContent.trim()) : [],
           value: sel ? sel.value : '' };
});
check('the canvas carries a sheet-type picker', picker.present && picker.visible,
  JSON.stringify(picker).slice(0, 160));
check('…offering exactly the four the roofer asked for',
  ['Steel Corrugate','Steel 5-Rib','Clearlite 5-Rib','Clearlite Corrugate']
    .every(l => picker.opts.includes(l)) && picker.opts.length === 4,
  picker.opts.join(' | '));
check('…starting on steel corrugate', picker.value === 'steel-corrugate', picker.value);

// The profile half has to write through: the flashing library and the
// back-tray schedule both look up drawings by profile, and neither cares
// whether the sheet is steel or clear.
await pg.evaluate(() => setRoofSheetType('clearlite-5rib'));
await pg.waitForTimeout(400);
let v = await pg.evaluate(() => ({
  sheetType: DRAW.sheetType,
  profile: (document.getElementById('matProfile')||{}).value,
  isClear: _roofIsClearlite(),
}));
check('picking Clearlite 5-Rib records the material', v.isClear && v.sheetType === 'clearlite-5rib',
  JSON.stringify(v));
check('…and points the flashing / back-tray lookup at 5-Rib', v.profile === '5-Rib', v.profile);

await pg.evaluate(() => setRoofSheetType('steel-corrugate'));
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ isClear: _roofIsClearlite(),
                               profile: (document.getElementById('matProfile')||{}).value }));
check('…and switching back to steel says so, and re-points the profile',
  !v.isClear && v.profile === 'Corrugate', JSON.stringify(v));

// ── sheet type belongs to the ROOF, not the job ───────────────────
// A clear lean-to over a steel main roof is the ordinary case.
await pg.evaluate(() => {
  DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  _addAndSwitchToNewRoof();
  DRAW.outline = [[100,100],[900,100],[900,500],[100,500]]; DRAW.outlineDone = true;
  setRoofSheetType('steel-corrugate');
  _addAndSwitchToNewRoof();
  DRAW.outline = [[100,600],[600,600],[600,900],[100,900]]; DRAW.outlineDone = true;
  setRoofSheetType('clearlite-corrugate');
});
await pg.waitForTimeout(400);
const perRoof = await pg.evaluate(() => {
  switchToRoof(0);
  const a = { type: DRAW.sheetType, ui: (document.getElementById('roofSheetType')||{}).value };
  switchToRoof(1);
  const c = { type: DRAW.sheetType, ui: (document.getElementById('roofSheetType')||{}).value };
  return { a, c };
});
check('each roof keeps its own sheet type',
  perRoof.a.type === 'steel-corrugate' && perRoof.c.type === 'clearlite-corrugate',
  JSON.stringify(perRoof));
check('…and the picker follows the roof you switch to, rather than showing the last one',
  perRoof.a.ui === 'steel-corrugate' && perRoof.c.ui === 'clearlite-corrugate',
  JSON.stringify(perRoof));

// ── placing a clearlite, the way a penetration is placed ──────────
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.penetrations = g.penetrations || [];
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines: (r.lines||[]).map(l => Object.assign({}, l)), clearlites: [], sheetType: 'steel-corrugate' }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  DRAW.clearlites = []; DRAW.matClearExtras = [];
  DRAW.sheetType = 'steel-corrugate';
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(2600);
const seeded = await pg.evaluate(() => {
  const sc = window._lastSheetCounts;
  return { groups: (sc && sc.groups || []).length,
           sheets: _jpBuildSheetRows(sc).reduce((s,r) => s + r.qty, 0) };
});
check('the sheet plan has real steel runs to test against',
  seeded.groups > 0 && seeded.sheets > 1, JSON.stringify(seeded));

const tool = await pg.evaluate(() => {
  setTool('clearlite');
  return { tool: DRAW.tool, menuBtn: !!document.getElementById('btn-clearlite') };
});
check('there is a Clearlite tool in the roof-details menu', tool.menuBtn);
check('…and selecting it arms the canvas', tool.tool === 'clearlite', tool.tool);

// One click on the roof, then one question — same shape as a penetration.
const popped = await pg.evaluate(() => {
  showClearPopup(500, 200);
  const pop = document.getElementById('clearPopup');
  return { open: !!pop && pop.style.display === 'block',
           // Full is the default, and a full clear has nothing to type.
           shortWrap: (document.getElementById('clearShortWrap')||{}).style.display,
           mode: _clearPopupMode };
});
check('clicking the roof asks the one question', popped.open, JSON.stringify(popped));
check('…defaulting to full length, with nothing to type',
  popped.mode === 'full' && popped.shortWrap === 'none', JSON.stringify(popped));

const shortAsks = await pg.evaluate(() => {
  _clearPopupSetMode('short');
  return { wrap: (document.getElementById('clearShortWrap')||{}).style.display,
           note: (document.getElementById('clearFullNote')||{}).style.display };
});
check('…and choosing Short asks how long it is',
  shortAsks.wrap === 'block' && shortAsks.note === 'none', JSON.stringify(shortAsks));

// A short clear with no length answered is a full one that lost its answer —
// it must not land on the order as a 0 m sheet.
const refused = await pg.evaluate(() => {
  document.getElementById('clearLenInput').value = '';
  confirmClearPopup();
  return { open: document.getElementById('clearPopup').style.display === 'block',
           placed: (DRAW.clearlites||[]).length };
});
check('a short clear with no length is refused rather than ordered at 0 m',
  refused.open && refused.placed === 0, JSON.stringify(refused));

const placedShort = await pg.evaluate(() => {
  document.getElementById('clearLenInput').value = '2.4';
  confirmClearPopup();
  return (DRAW.clearlites||[]).map(c => ({ mode: c.mode, lenM: c.lenM }));
});
check('answering the length places the short clear',
  placedShort.length === 1 && placedShort[0].mode === 'short' && placedShort[0].lenM === 2.4,
  JSON.stringify(placedShort));

// A full-length clear takes its length from the run it lands in, so there is
// nothing to type and it can never disagree with the sheet it displaces.
const fullLen = await pg.evaluate(() => {
  showClearPopup(400, 400);
  _clearPopupSetMode('full');
  confirmClearPopup();
  const arr = DRAW.clearlites || [];
  const c = arr[arr.length - 1];
  return { mode: c.mode, typed: c.lenM, derived: _clearLenM(c), runLen: _clearFullLenM() };
});
check('a full-length clear takes the run length rather than asking for one',
  fullLen.mode === 'full' && fullLen.typed === 0 &&
  fullLen.derived > 0 && Math.abs(fullLen.derived - fullLen.runLen) < 1e-9,
  JSON.stringify(fullLen));

// ── the arithmetic: a full clear DISPLACES a steel sheet ──────────
const maths = await pg.evaluate(() => {
  const sc = window._lastSheetCounts;
  const steelWith = _jpBuildSheetRows(sc).reduce((s,r) => s + r.qty, 0);
  const keep = DRAW.clearlites.slice();
  DRAW.clearlites = [];
  const steelWithout = _jpBuildSheetRows(sc).reduce((s,r) => s + r.qty, 0);
  // Short only — an infill, so the steel count must NOT move.
  DRAW.clearlites = keep.filter(c => c.mode === 'short');
  const steelShortOnly = _jpBuildSheetRows(sc).reduce((s,r) => s + r.qty, 0);
  DRAW.clearlites = keep;
  return { steelWith, steelWithout, steelShortOnly };
});
check('a full-length clear comes off the steel count — it stands in a sheet’s place',
  maths.steelWith === maths.steelWithout - 1,
  maths.steelWith + ' steel with the clear vs ' + maths.steelWithout + ' without');
check('…but a short clear does not, because the steel above and below it is still needed',
  maths.steelShortOnly === maths.steelWithout,
  maths.steelShortOnly + ' vs ' + maths.steelWithout);

// ── the job pack section ──────────────────────────────────────────
await pg.evaluate(() => { renderJobPack(); });
await pg.waitForTimeout(700);
const sec = await pg.evaluate(() => {
  const heads = [...document.querySelectorAll('#jpPages .mat-section-hd h3')].map(h => h.textContent.trim());
  const matSel = document.querySelector('#jpPages [onchange*="_clearMaterialSet"]');
  const rows = _clearOrderRows();
  return { heads, hasMatSel: !!matSel,
           matOpts: matSel ? [...matSel.options].map(o => o.textContent.trim()) : [],
           matVal: matSel ? matSel.value : '',
           count: rows.count, rows: rows.rows.map(r => r.qty + '@' + r.len.toFixed(2)),
           addRow: !!document.querySelector('#jpPages [onclick*="_clearExtraAdd"]') };
});
check('the job pack grows a Clearlite sheets section',
  sec.heads.includes('Clearlite sheets'), sec.heads.join(' | '));
check('…listing both clears that were placed', sec.count === 2, sec.rows.join(' | '));
check('…with the fibreglass / polycarbonate choice on it',
  sec.hasMatSel && sec.matOpts.includes('Fibreglass') && sec.matOpts.includes('Polycarbonate'),
  sec.matOpts.join(' | '));
check('…defaulting to fibreglass', sec.matVal === 'fibreglass', sec.matVal);
check('…and a way to add a row by hand', sec.addRow);

const matStick = await pg.evaluate(() => {
  _clearMaterialSet('polycarbonate');
  renderJobPack();
  const sel = document.querySelector('#jpPages [onchange*="_clearMaterialSet"]');
  return { stored: S.clearliteMaterial, shown: sel ? sel.value : '',
           label: _clearMaterialLabel() };
});
check('choosing polycarbonate sticks through a re-render',
  matStick.stored === 'polycarbonate' && matStick.shown === 'polycarbonate' &&
  matStick.label === 'Polycarbonate', JSON.stringify(matStick));

// ── a whole roof in clearlite ─────────────────────────────────────
const whole = await pg.evaluate(() => {
  DRAW.clearlites = [];
  (DRAW.roofs||[]).forEach(r => { r.clearlites = []; r.sheetType = 'clearlite-corrugate'; });
  setRoofSheetType('clearlite-corrugate');
  const rows = _clearOrderRows();
  const steel = _jpBuildSheetRows(window._lastSheetCounts).reduce((s,r) => s + r.qty, 0);
  return { count: rows.count, whole: rows.wholeRoofs, steel };
});
check('a roof whose sheet type IS clearlite orders its sheets as clear',
  whole.count > 0, whole.count + ' clear sheets');
check('…and the steel section has nothing left to say about it',
  whole.steel === 0, whole.steel + ' steel sheets');

// The case that matters on a real job: ONE clear lean-to beside steel roofs.
// The clear roof's own sheets come out of the steel order and no more — order
// both in full and the extra sheets turn up on the truck.
const mixed = await pg.evaluate(() => {
  (DRAW.roofs||[]).forEach(r => { r.clearlites = []; r.sheetType = 'steel-corrugate'; });
  DRAW.clearlites = []; DRAW.sheetType = 'steel-corrugate';
  DRAW.showAllRoofs = true;
  try { renderRoofSheetPlan(); } catch(e){}
  const allSteel = _jpBuildSheetRows(window._lastSheetCounts).reduce((s,r) => s + r.qty, 0);
  // Pick a roof the map actually drew runs for, so there is something to move.
  const idx = (DRAW.roofs||[]).findIndex((r, i) =>
    Object.keys(_roofSheetColsByLen(i)).length > 0 && i !== 0);
  if (idx < 0) return { skip: true };
  DRAW.roofs[idx].sheetType = 'clearlite-corrugate';
  const own = Object.values(_roofSheetColsByLen(idx)).reduce((a, x) => a + x, 0);
  const clear = _clearOrderRows();
  const steel = _jpBuildSheetRows(window._lastSheetCounts).reduce((s,r) => s + r.qty, 0);
  return { allSteel, idx, name: DRAW.roofs[idx].name, own, clear: clear.count, steel };
});
check('one clear roof among steel ones orders only its own sheets as clear',
  mixed.skip || (mixed.clear === mixed.own && mixed.own > 0),
  JSON.stringify(mixed));
check('…and exactly those come off the steel order, so nothing is ordered twice',
  mixed.skip || (mixed.steel === mixed.allSteel - mixed.own),
  mixed.skip ? 'skipped' : (mixed.steel + ' steel, was ' + mixed.allSteel + ', clear ' + mixed.own));
check('…and the section names which roof went clear',
  mixed.skip || (await pg.evaluate(() => _clearOrderRows().wholeRoofs)).includes(mixed.name),
  mixed.name);

// ── struck off like any other section ─────────────────────────────
const off = await pg.evaluate(() => {
  // Put a clear roof back after the mixed case above, or there is nothing
  // for the strike-off to strike.
  if (DRAW.roofs && DRAW.roofs.length) DRAW.roofs.forEach(r => { r.sheetType = 'clearlite-corrugate'; });
  DRAW.sheetType = 'clearlite-corrugate';
  _matFlashTypeSetOff('clearlite', true);
  renderJobPack();
  const rows = _clearOrderRows();
  const restore = document.querySelector('#jpPages .jp-keep-ctl[onclick*="clearlite"]');
  return { count: rows.count, off: !!rows.off, restore: !!restore };
});
check('striking Clearlite off empties it everywhere at once',
  off.count === 0 && off.off, JSON.stringify(off));
check('…leaving a restore that survives Preview', off.restore);
const back = await pg.evaluate(() => { _matFlashTypeSetOff('clearlite', false); return _clearOrderRows().count; });
check('…and restoring puts the clear sheets back', back > 0, back + ' sheets');

// ── it has to survive a save and reopen ───────────────────────────
const roundTrip = await pg.evaluate(() => {
  DRAW.clearlites = [{ cx: 400, cy: 250, mode: 'short', lenM: 3.2 }];
  DRAW.sheetType = 'clearlite-5rib';
  S.clearliteMaterial = 'polycarbonate';
  const snap = snapshotCurrentJob();
  if (!snap) return { skip: true };
  DRAW.clearlites = []; DRAW.sheetType = 'steel-corrugate'; S.clearliteMaterial = 'fibreglass';
  return { snapHas: !!(snap.draw && snap.draw.clearlites && snap.draw.clearlites.length),
           snapType: snap.draw && snap.draw.sheetType,
           snapMat: snap.state && snap.state.clearliteMaterial };
});
check('a save carries the clears, the sheet type and the clear material',
  roundTrip.skip || (roundTrip.snapHas && roundTrip.snapType === 'clearlite-5rib' &&
                     roundTrip.snapMat === 'polycarbonate'), JSON.stringify(roundTrip));

// ── undo puts a clear back where it was ───────────────────────────
const undone = await pg.evaluate(() => {
  DRAW.clearlites = [];
  showClearPopup(500, 200); _clearPopupSetMode('full'); confirmClearPopup();
  const after = DRAW.clearlites.length;
  undoLast();
  return { after, undone: DRAW.clearlites.length };
});
check('undo lifts a placed clear off the roof', undone.after === 1 && undone.undone === 0,
  JSON.stringify(undone));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
