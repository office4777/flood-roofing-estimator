// The owner, 2026-09-24: "there's a roof where the roof extends over long on
// one side and shorter on the other side, like a zig zag in the roof with
// longer and shorter sheets, so when I click a ridge line have a button in the
// 'edit ridge' pop-up window called 'Break up ridge' that allows me to add two
// break points … I can then drag that broken middle section of the ridge up or
// down as far as I want to extend one side of the roof and shorten the other
// side only in that broken section. If I do that, it creates a head apron the
// length of that broken ridge section, as well as barges and side aprons on
// each side of that broken ridge extending back down/up to the unbroken ridge."
//
// Pinned on a 12 × 6 m gable (0.02 m a pixel, 15° pitch): the button is on the
// ridge's popup; the break draws two ridge pieces, a head apron the length of
// the section where it was moved to, and a barge AND a side apron at each end
// up the slope (measured up the slope); the sheets in the section are longer
// on one side and shorter on the other, each side still counted as one face;
// the section drags on the canvas and types in metres; Remove break puts the
// ridge back; undo, save and re-open keep it; rotating the roof starts the
// ridge whole again.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(); const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings'); localStorage.setItem('fr_site_mode','off');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); clearAll(true); });
await pg.evaluate(() => { setTool('outline'); DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.02; });
await pg.waitForTimeout(300);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }
const counts = () => pg.evaluate(() => {
  try { renderRoofSheetPlan(); } catch(e){ return { err: e.message }; }
  const g = (window._lastSheetCounts || {}).groups || {};
  const out = {}; let total = 0;
  Object.keys(g).forEach(k => { out[g[k].orderedMm] = (out[g[k].orderedMm] || 0) + g[k].count; total += g[k].count; });
  return { byLen: out, total };
});
await pg.evaluate(() => { DRAW.roofBaseHoriz = true; });
await pg.evaluate(() => { const p = document.getElementById('pitchDeg'); if (p){ p.value = 15; } DRAW.calPitch = 15; autoGenerateRoof('gable'); autoCalcLineMeasurements(); });
const before = await counts();
const plain = await pg.evaluate(() => ({ ridges: DRAW.lines.filter(l => l.type === 'ridge').length }));
check('the plain gable: one ridge, sheets the same length both sides', plain.ridges === 1 && Object.keys(before.byLen).length === 1 && before.total >= 30, JSON.stringify({ plain, before }));

// ── the popup offers it ──
const pop = await pg.evaluate(() => {
  const i = DRAW.lines.findIndex(l => l.type === 'ridge');
  selectLine(i);
  const btn = document.getElementById('rbAddBtn');
  return { title: document.getElementById('propTitle').textContent, btn: !!btn && getComputedStyle(document.getElementById('ridgeBreakBox')).display !== 'none', label: btn ? btn.textContent : '' };
});
check('the ridge’s popup has a "Break up ridge" button', pop.btn && /Break up ridge/.test(pop.label) && /Ridge/.test(pop.title), JSON.stringify(pop));

// ── break it ──
const br = await pg.evaluate(() => {
  document.getElementById('rbAddBtn').click();
  const L = (f) => DRAW.lines.filter(f).map(l => ({ pts: l.pts.map(p => p.map(v => Math.round(v))), m: l.measM, sub: l.subtype }));
  return {
    breaks: JSON.parse(JSON.stringify(DRAW.ridgeBreaks)),
    ridges: L(l => l.type === 'ridge'), head: L(l => l.type === 'apron' && l.subtype === 'head'),
    connB: L(l => l.type === 'barge' && l.breakRole === 'conn'), connA: L(l => l.type === 'apron' && l.subtype === 'side' && l.breakRole === 'conn'),
    title: document.getElementById('propTitle').textContent, moved: (document.getElementById('rbMove') || {}).value, len: (document.getElementById('rbLen') || {}).value,
  };
});
check('Break up ridge: the ridge is two pieces either side of the broken section', br.ridges.length === 2 && JSON.stringify(br.ridges.map(r => r.pts)) === '[[[200,450],[400,450]],[[600,450],[800,450]]]', JSON.stringify(br.ridges));
check('…the section, moved, is a HEAD APRON the length of the section', br.head.length === 1 && JSON.stringify(br.head[0].pts) === '[[400,488],[600,488]]' && br.head[0].m === 4, JSON.stringify(br.head));
check('…with a barge AND a side apron at each end, back to the ridge', br.connB.length === 2 && br.connA.length === 2 && JSON.stringify(br.connB.map(c => c.pts)) === JSON.stringify(br.connA.map(c => c.pts)) && br.connB[0].pts[0][1] === 450 && br.connB[0].pts[1][1] === 488, JSON.stringify({ b: br.connB, a: br.connA }));
check('…both measured UP THE SLOPE, not in plan', br.connB[0].m === br.connA[0].m && br.connA[0].m === 0.78, JSON.stringify({ b: br.connB[0].m, a: br.connA[0].m }));
check('…and the popup is now the section’s: moved 0.75 m, 4 m long', /Head/.test(br.title) && br.moved === '0.75' && br.len === '4.00', JSON.stringify(br));

// ── the sheets ──
const after = await counts();
const lens = Object.keys(after.byLen).map(Number).sort((a, b) => a - b);
check('the broken section’s sheets are longer on one side and shorter on the other — three lengths now', lens.length === 3, JSON.stringify(after));
const base = Number(Object.keys(before.byLen)[0]);
check('…the middle length is the plain gable’s, the others either side of it', lens[1] === base && lens[0] < base && lens[2] > base && (lens[2] - base) > 600 && (base - lens[0]) > 600, JSON.stringify({ base, lens }));
check('…and each side is still counted as ONE face (32 either way)', after.total === before.total, JSON.stringify({ before: before.total, after: after.total }));

// ── the canvas labels the section's own sheet lengths, both sides ──
const lbl = await pg.evaluate(() => {
  redrawAll();
  return (window._lastSheetDims || []).map(d => d.label).sort();
});
check('the canvas labels the broken section’s sheets with their own lengths — longer one side, shorter the other', Array.isArray(lbl) && lbl.some(x => /3\.88/.test(x)) && lbl.some(x => /2\.33/.test(x)), JSON.stringify(lbl));

// ── materials count the new flashings ──
const mat = await pg.evaluate(() => { const t = _matDrawTotals(); return { apron: Math.round((t.totals.apron || 0) * 100) / 100, barge: Math.round((t.totals.barge || 0) * 100) / 100 }; });
check('the materials carry the head apron and both side aprons, and the two short barges', mat.apron >= 4 + 2 * 0.78 - 0.02 && mat.barge >= 2 * 0.78, JSON.stringify(mat));

// ── move it by typing, and by dragging ──
const typed = await pg.evaluate(() => {
  const i = DRAW.lines.findIndex(l => l.breakRole === 'mid'); selectLine(i);
  const inp = document.getElementById('rbMove'); inp.value = '-1.2'; inp.dispatchEvent(new Event('change'));
  const h = DRAW.lines.find(l => l.breakRole === 'mid');
  return { y: Math.round(h.pts[0][1]), off: DRAW.ridgeBreaks[0].off };
});
check('typing Moved (m) moves the section to the other side', typed.y === 390, JSON.stringify(typed));
const drag = await pg.evaluate(() => {
  try { fitDrawingToCanvas(); } catch(e){}
  document.getElementById('roofCanvas').scrollIntoView({ block: 'start' });
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), t = getImgTransform(), dpr = window.devicePixelRatio || 1;
  const toClient = (p) => [r.left + (p[0] * t.s + t.ix) * (r.width / (cv.width / dpr)), r.top + (p[1] * t.s + t.iy) * (r.height / (cv.height / dpr))];
  setTool('select');
  return { a: toClient([500, 390]), b: toClient([500, 510]) };
});
await pg.mouse.move(drag.a[0], drag.a[1]); await pg.mouse.down();
await pg.mouse.move(drag.a[0], drag.a[1] + 20, { steps: 3 }); await pg.mouse.move(drag.b[0], drag.b[1], { steps: 6 }); await pg.mouse.up();
await pg.waitForTimeout(300);
const dragged = await pg.evaluate(() => { const h = DRAW.lines.find(l => l.breakRole === 'mid'); return { y: Math.round(h.pts[0][1]), ridges: DRAW.lines.filter(l => l.type === 'ridge').length, ridgeY: Math.round(DRAW.lines.find(l => l.type === 'ridge').pts[0][1]) }; });
check('dragging the section on the canvas moves it across the roof — the ridge either side stays put', Math.abs(dragged.y - 510) <= 2 && dragged.ridges === 2 && dragged.ridgeY === 450, JSON.stringify(dragged));

// ── undo, save, re-open ──
const kept = await pg.evaluate(() => {
  const snap = snapshotCurrentJob();
  const saved = JSON.parse(JSON.stringify(snap));
  undoLast();
  const afterUndo = DRAW.lines.find(l => l.breakRole === 'mid');
  const undoneY = afterUndo ? Math.round(afterUndo.pts[0][1]) : null;
  restoreFromJob({ id: 'j-rb', draw_state: saved });
  const m = DRAW.lines.find(l => l.breakRole === 'mid');
  return { undoneY, reopened: !!m && Math.abs(Math.round(m.pts[0][1]) - 510) <= 2, breaks: (DRAW.ridgeBreaks || []).length, inSave: !!(saved.draw && saved.draw.ridgeBreaks && saved.draw.ridgeBreaks.length) };
});
check('undo steps the drag back', kept.undoneY !== null && Math.abs(kept.undoneY - 390) <= 2, JSON.stringify(kept));
check('the break is saved with the job and comes back on re-open', kept.inSave && kept.reopened && kept.breaks === 1, JSON.stringify(kept));

// ── a corner drag keeps it; Remove break; rotate starts whole ──
const more = await pg.evaluate(() => {
  DRAW.outline[1] = [860, 300]; DRAW.outline[2] = [860, 600];
  regenerateAutoRoofLines('gable');
  const keptOnCorner = !!DRAW.lines.find(l => l.breakRole === 'mid');
  const i = DRAW.lines.findIndex(l => l.breakRole === 'mid'); selectLine(i);
  _ridgeBreakRemove(0);
  const removed = { breaks: DRAW.ridgeBreaks.length, ridges: DRAW.lines.filter(l => l.type === 'ridge').length, chains: DRAW.lines.filter(l => l.ridgeChain || l.ridgeBreak != null).length };
  const ri = DRAW.lines.findIndex(l => l.type === 'ridge'); selectLine(ri); _ridgeBreakAdd();
  rotateActiveRoof();
  return { keptOnCorner, removed, afterRotate: (DRAW.ridgeBreaks || []).length, rotChains: DRAW.lines.filter(l => l.ridgeBreak != null).length };
});
check('a corner drag keeps the break', more.keptOnCorner);
check('Remove break puts the ridge back whole', more.removed.breaks === 0 && more.removed.ridges === 1 && more.removed.chains === 0, JSON.stringify(more.removed));
check('rotating the roof starts the ridge whole again', more.afterRotate === 0 && more.rotChains === 0, JSON.stringify(more));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
