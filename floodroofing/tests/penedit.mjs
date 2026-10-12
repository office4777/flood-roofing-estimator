// A PENETRATION COULD NOT BE EDITED (2026-10-12, two client error reports
// from info@wellingtonroof.co.nz on build 470e22d, four seconds apart):
//
//   TypeError: Cannot set properties of null (setting 'value')
//     at showPenEditor  ->  selectPen  ->  onCanvasClick
//   TypeError: Cannot read properties of null (reading 'value')
//     at updatePenetration  ->  HTMLSelectElement.onchange
//
// One cause. The penetration editor's markup is a type dropdown plus two
// size boxes (editPenType / editPenW / editPenD), but both functions still
// read and wrote #editPenLabel — a single free-text box that has not been
// in the page for as long as this repo's history goes back. So:
//   * clicking any penetration with the select tool threw before the panel
//     was filled, leaving whatever the last selection had put in the boxes;
//   * changing the type dropdown threw out of its own onchange, so the type
//     and the size were never written to the penetration at all.
// A penetration was therefore place-once: the entry popup was the only way
// to set its size, and nothing about it could be corrected afterwards.
//
// The editor now shows what the penetration actually is — ONE diameter for
// a round pipe (the number _penDiamMm reads to pick the back-tray), width
// AND length for a boxed opening — carries the Full/Short back-tray choice
// the entry popup asks for, and has a Delete button beside the Delete key.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

// A roof with one round pipe and one boxed opening on it, selected the way
// a click on the canvas selects them.
const setup = () => pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[769,444],[1694,444],[1694,847],[769,847]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.0276; DRAW.calPitch = 25; DRAW.roofType = 'hip';
  autoGenerateRoof('hip', 0);
  var pf = document.getElementById('orderProfile'); if (pf) pf.value = 'Corrugate';
  DRAW.penetrations.length = 0;
  DRAW.penetrations.push({ type:'penetration', penType:'pipe', cx:1200, cy:640,
                           sizeLabel:'240', backTrayMode:'full' });
  DRAW.penetrations.push({ type:'penetration', kind:'box', cx:1000, cy:700,
                           x0:960, y0:670, x1:1040, y1:730,
                           widthMm:'350', lengthMm:'850', sizeLabel:'350×850 mm' });
  DRAW.tool = 'select';
  return DRAW.penetrations.length;
});
await setup();

const V = (pg, id) => pg.evaluate(i => (document.getElementById(i)||{}).value, id);

// ── 1. the crash itself ──────────────────────────────────────────
const sel = await pg.evaluate(() => {
  try { selectPen(0); } catch(e){ return { threw: e.message }; }
  const shown = i => { const e = document.getElementById(i); return !!(e && e.style.display !== 'none'); };
  const V = i => (document.getElementById(i)||{}).value;
  return { threw: null, open: shown('penetrationEditor'),
    type: V('editPenType'), wLbl: (document.getElementById('editPenWLbl')||{}).textContent,
    w: V('editPenW'), wu: V('editPenWUnit'),
    lengthRow: shown('editPenDRow'), btRow: shown('editPenBtRow'),
    title: (document.getElementById('propTitle')||{}).textContent };
});
check('clicking a penetration with the select tool no longer throws', !sel.threw, sel.threw || 'clean');
check('…the editor opens and is FILLED from the penetration, not left on the last one\'s values',
  sel.open && sel.type === 'pipe' && sel.w === '240' && sel.wu === 'mm', JSON.stringify(sel));
check('…a round pipe is asked for one Diameter, not a width and a length',
  sel.wLbl === 'Diameter' && sel.lengthRow === false, JSON.stringify({ label: sel.wLbl, lengthRow: sel.lengthRow }));
check('…and its Full/Short back-tray choice is offered, so a placed pipe can still be changed',
  sel.btRow === true);

// ── 2. the type dropdown's own onchange ──────────────────────────
const typed = await pg.evaluate(() => {
  document.getElementById('editPenType').value = 'skydome';
  try { updatePenetration(); } catch(e){ return { threw: e.message }; }
  return { threw: null, penType: DRAW.penetrations[0].penType, label: DRAW.penetrations[0].sizeLabel };
});
check('changing the penetration type no longer throws out of its own onchange', !typed.threw, typed.threw || 'clean');
check('…and the new type is written to the penetration', typed.penType === 'skydome', JSON.stringify(typed));
check('…without disturbing its size', typed.label === '240', String(typed.label));

// ── 3. the diameter is the back-tray's own input ─────────────────
const dia = await pg.evaluate(() => {
  const before = _penBackTrayName(DRAW.penetrations[0]);
  document.getElementById('editPenW').value = '90';
  updatePenetration();
  const small = { label: DRAW.penetrations[0].sizeLabel, tray: _penBackTrayName(DRAW.penetrations[0]) };
  document.getElementById('editPenW').value = '0.3';
  document.getElementById('editPenWUnit').value = 'm';
  updatePenetration();
  return { before, small, big: { label: DRAW.penetrations[0].sizeLabel, tray: _penBackTrayName(DRAW.penetrations[0]) } };
});
check('a retyped diameter is stored as plain mm — the shape _penDiamMm reads',
  dia.small.label === '90', JSON.stringify(dia.small));
check('…so correcting the size picks a different back-tray, which it could never do before',
  dia.before && dia.small.tray && dia.small.tray !== dia.before, JSON.stringify({ was: dia.before, now: dia.small.tray }));
check('…and metres are taken as metres', dia.big.label === '300', JSON.stringify(dia.big));

// ── 4. the back-tray switch, and that it is actually saved ───────
const bt = await pg.evaluate(() => {
  let scheduled = 0;
  const real = window._scheduleAutosave;
  window._scheduleAutosave = function(){ scheduled++; return real.apply(this, arguments); };
  _penEditorSetBt('short');
  const mode = DRAW.penetrations[0].backTrayMode;
  const shortLit = (document.getElementById('editPenBtShort')||{}).style.background;
  _penEditorSetBt('full');
  window._scheduleAutosave = real;
  return { mode, shortLit, back: DRAW.penetrations[0].backTrayMode, scheduled };
});
check('the Full/Short back-tray switch works from the editor', bt.mode === 'short' && bt.back === 'full', JSON.stringify(bt));
check('…the picked side is lit', /0a1628|rgb\(10, 22, 40\)/.test(bt.shortLit || ''), String(bt.shortLit));
check('…and the switch is SAVED — it called autosaveJob, which does not exist, so it never was',
  bt.scheduled >= 2, String(bt.scheduled));

// ── 5. a boxed opening keeps both of its sizes ───────────────────
const box = await pg.evaluate(() => {
  selectPen(1);
  const shown = i => { const e = document.getElementById(i); return !!(e && e.style.display !== 'none'); };
  const V = i => (document.getElementById(i)||{}).value;
  const open = { wLbl: (document.getElementById('editPenWLbl')||{}).textContent,
                 w: V('editPenW'), d: V('editPenD'), lengthRow: shown('editPenDRow'), btRow: shown('editPenBtRow') };
  document.getElementById('editPenD').value = '1.2';
  document.getElementById('editPenDUnit').value = 'm';
  updatePenetration();
  const p = DRAW.penetrations[1];
  return { open, after: { w: p.widthMm, l: p.lengthMm, label: p.sizeLabel } };
});
check('a boxed opening is asked for a Width AND a Length, both filled from the opening',
  box.open.wLbl === 'Width' && box.open.lengthRow === true && box.open.w === '350' && box.open.d === '850',
  JSON.stringify(box.open));
check('…and is offered no back-tray, because a boxed opening has none', box.open.btRow === false);
check('…a retyped length is stored in mm and relabelled the way every reader parses it',
  box.after.l === '1200' && box.after.label === '350×1200 mm', JSON.stringify(box.after));

// ── 6. delete, from the button as well as the key ────────────────
const del = await pg.evaluate(() => {
  const n = DRAW.penetrations.length;
  const btn = Array.from(document.querySelectorAll('#penetrationEditor button'))
    .find(b => /delete penetration/i.test(b.textContent || ''));
  if (!btn) return { btn: false };
  btn.click();
  return { btn: true, before: n, after: DRAW.penetrations.length,
           panel: (document.getElementById('propPanel')||{}).style.display };
});
check('the editor has a Delete button, not just the Delete key',
  del.btn && del.after === del.before - 1 && del.panel === 'none', JSON.stringify(del));

// ── 7. the whole round trip through a real canvas click ──────────
const roundTrip = await pg.evaluate(() => {
  DRAW.penetrations.length = 0;
  DRAW.penetrations.push({ type:'penetration', penType:'pipe', cx:1200, cy:640, sizeLabel:'150', backTrayMode:'full' });
  DRAW.tool = 'select';
  selectPen(0);
  document.getElementById('editPenW').value = '200';
  updatePenetration();
  // Leave it and come back — the editor must read the roof, not its own boxes.
  selectLine(0);
  selectPen(0);
  return { box: (document.getElementById('editPenW')||{}).value, stored: DRAW.penetrations[0].sizeLabel };
});
check('leaving the penetration and coming back shows what is stored on it',
  roundTrip.box === '200' && roundTrip.stored === '200', JSON.stringify(roundTrip));

// ── 8. the selection has to still be there a moment later ───────
// _loadRoofToCurrent clears the selection, which is right for a real roof
// switch. But the multi-roof measuring passes (_matEachSelectedRoof,
// _materialsCostForRoofIdx) walk every roof and come back through the same
// function, and they run off the back of an ordinary redraw — so a second
// after clicking a penetration the selection was gone, the editor was still
// open, and every edit in it quietly did nothing. _roofScopeEnter puts the
// selection, and any half-tapped outline, back.
const survives = await pg.evaluate(async () => {
  DRAW.penetrations.length = 0;
  DRAW.penetrations.push({ type:'penetration', penType:'pipe', cx:1200, cy:640, sizeLabel:'150', backTrayMode:'full' });
  DRAW.tool = 'select';
  selectPen(0);
  const justAfter = DRAW.selectedPen;
  // A second roof, so the passes really do walk away from this one.
  _syncCurrentToRoof();
  DRAW.roofs.push(JSON.parse(JSON.stringify(DRAW.roofs[0])));
  const pts = [[100,100],[200,100]];
  DRAW.currentPts = pts.map(p => p.slice());
  _matEachSelectedRoof(function(){});
  const afterWalk = { pen: DRAW.selectedPen, roof: DRAW.activeRoofIdx, pts: DRAW.currentPts.length };
  await new Promise(r => setTimeout(r, 400));
  return { justAfter, afterWalk, settled: DRAW.selectedPen };
});
check('a materials pass over every roof leaves the selected penetration selected',
  survives.justAfter === 0 && survives.afterWalk.pen === 0 && survives.afterWalk.roof === 0,
  JSON.stringify(survives));
check('…and does not throw away an outline half tapped out', survives.afterWalk.pts === 2, JSON.stringify(survives.afterWalk));
check('…so the editor on screen is still editing something a moment later', survives.settled === 0, String(survives.settled));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
