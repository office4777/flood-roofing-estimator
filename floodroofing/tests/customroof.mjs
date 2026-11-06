// A ROOF DRAWN BY HAND LAYS LIKE THE SAME ROOF BUILT (2026-11-06, the owner:
// "test a custom roof shape ... just do a plain full hip ... rectangle outline,
// and then enter 4 hips at a 45, and then a center ridge line ... Make sure it
// all works the same as it would if it was an auto shape"; then the rectangle
// with an east-west gable, a north-south gable running into its middle and two
// valleys off that junction — "if I do it manually, that the sheet layout
// diagram and the sheet pre-cut diagram all works ... if a hip or valleys or
// anything doesn't meet up to another line, well then I'm sure that this would
// throw out the sheet cut diagram"). And the drawing tools that make such a
// roof: a hip or valley at its TRUE angle, pulled onto 45° only when it is
// nearly there, the label saying what it really is; a line's end catching the
// line it was drawn to, at the angle it was drawn.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => {
  const e = document.getElementById(i); if (e) e.remove(); }); window.__PZ_NO_CACHE = true;
  // rule 7c ships OFF until the owner's go; the suite runs it on
  window.__PZ_WELD = true; });

// ── 1. the plain hip, by hand ─────────────────────────────────────
const hip = await pg.evaluate(() => {
  const R = [[300,250],[900,250],[900,650],[300,650]];        // 18 x 12 m at 0.03
  const lay = () => { const pz = _sheetPuzzleBuild({ roofIdxs:[-1] });
    return { tally: JSON.stringify(pz.tally), faces: pz.faces.length, cut: _pzCuttable(pz),
             pieces: pz.faces.reduce((a, f) => a + (f.pieces || f.strips || []).length, 0) }; };
  const fresh = () => { gotoTab('roof'); clearAll(true); DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.lines = [];
    DRAW.roofType = null; DRAW.outline = []; DRAW.outlineDone = false; DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
    setTool('outline'); DRAW.currentPts = R.map(p => p.slice()); finishCurrent();
    document.querySelectorAll('#_rsModal').forEach(e => e.remove()); };
  const draw = (t, a, z) => { setTool(t); DRAW.currentPts = [a, z]; finishCurrent(); };
  const out = {};
  fresh(); autoGenerateRoof('hip'); out.auto = lay();
  fresh(); draw('hip', [300,250], [500,450]); draw('hip', [900,250], [700,450]);
  draw('hip', [900,650], [700,450]); draw('hip', [300,650], [500,450]); draw('ridge', [500,450], [700,450]);
  out.hand = lay();
  // at 45° (the drawing snaps them there) but stopping short of, or running
  // past, the ridge, and the ridge a few pixels short of both junctions
  fresh(); draw('hip', [301,251], [496,446]); draw('hip', [900,250], [697,453]);
  draw('hip', [900,650], [697,447]); draw('hip', [300,650], [502,448]); draw('ridge', [497,450], [703,450]);
  out.sloppy = lay();
  setTool('select');
  return out;
});
check('a plain hip drawn by hand lays exactly as the built one (same sheets, faces, pieces)',
  hip.hand.tally === hip.auto.tally && hip.hand.faces === hip.auto.faces && hip.hand.pieces === hip.auto.pieces,
  JSON.stringify([hip.auto, hip.hand]));
check('…48 sheets at 6.63 m, every one cuttable on the pre-cut', hip.auto.tally === '[{"Lmm":6630,"count":48}]' && hip.hand.cut === true, hip.auto.tally);
check('…and drawn a few pixels out, still the same order', hip.sloppy.tally === hip.auto.tally, hip.sloppy.tally);

// ── 2. the cross gable, by hand ───────────────────────────────────
const cross = (J, weldOff, mode) => pg.evaluate(([J, weldOff, mode]) => {
  window.__PZ_WELD = weldOff ? false : true;
  gotoTab('roof'); clearAll(true); DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.lines = []; DRAW.roofType = null;
  DRAW.outline = []; DRAW.outlineDone = false; DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  setTool('outline'); DRAW.currentPts = [[300,250],[900,250],[900,650],[300,650]]; finishCurrent();
  document.querySelectorAll('#_rsModal').forEach(e => e.remove());
  const draw = (t, a, z) => { setTool(t); DRAW.currentPts = [a, z]; finishCurrent(); };
  if (mode === 'split'){
    DRAW.lines = DRAW.lines.filter(l => l.type !== 'gutter');
    draw('gutter', [300,250], [900,250]);
    draw('barge', [900,250], [900,450]); draw('barge', [900,450], [900,650]);
    draw('gutter', [900,650], [800,650]); draw('barge', [800,650], [600,650]); draw('barge', [600,650], [400,650]); draw('gutter', [400,650], [300,650]);
    draw('barge', [300,650], [300,450]); draw('barge', [300,450], [300,250]);
  } else {
    draw('barge', [900,250], [900,650]); draw('barge', [300,650], [300,250]); draw('barge', [400,650], [800,650]);
  }
  draw('ridge', [300+J,450], [900-J,450]);            // short of both barges
  draw('ridge', [601,450+J], [600,650-J]);            // starts below the main ridge, short of the wall
  draw('valley', [600-J,450+J], [400+J,650-J]);       // floats inside, touching nothing
  draw('valley', [603,452], [800,650]);
  setTool('select');
  const pz = _sheetPuzzleBuild({ roofIdxs:[-1] });
  let pre = null; try { pre = _sheetPrecutPlan(pz); } catch(e){ pre = null; }
  const r = { tally: JSON.stringify(pz.tally), faces: pz.faces.length, cut: _pzCuttable(pz), pre: Array.isArray(pre) ? pre.length : -1 };
  window.__PZ_WELD = true;
  return r;
}, [J, weldOff, mode]);
const exact = await cross(0, false, 'split');
check('the cross gable drawn by hand: 5 faces, 48 sheets at 6.63 m, cuttable',
  exact.faces === 5 && exact.tally === '[{"Lmm":6630,"count":48}]' && exact.cut === true && exact.pre === 48, JSON.stringify(exact));
for (const J of [4, 8, 12]){
  const r = await cross(J, false, 'split');
  check('…its lines drawn ' + (J * 30) + ' mm short of meeting still lay as 48 at 6.63 m', r.tally === exact.tally && r.faces === 5 && r.cut === true, JSON.stringify(r));
}
const over = await cross(8, false, 'over');
check('…with the barges drawn over the gutters, the same', over.tally === exact.tally && over.cut === true, JSON.stringify(over));
const off = await cross(8, true, 'split');
check('…and with the joining switched off (__PZ_WELD = false) the gap breaks it (proves the weld does the work)',
  off.tally !== exact.tally, JSON.stringify(off));

// ── 3. drawing a hip by hand at its true angle ────────────────────
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.lines = []; DRAW.roofType = null;
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  DRAW.outline = [[200,200],[800,200],[800,520],[200,520]]; DRAW.outlineDone = true;
  document.querySelectorAll('#_rsModal').forEach(e => e.remove());
  document.getElementById('roofCanvas').scrollIntoView({ block:'center' }); redrawAll();
});
await pg.waitForTimeout(250);
const scr = (p) => pg.evaluate((p) => { const t = getImgTransform(), c = imgToCanvas(p, t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1] }; }, p);
// A hip from the top-left corner at `deg` to the wall, `len` image px long.
const drawHip = async (deg, len, shift, tool) => {
  await pg.evaluate((tool) => { setTool(tool || 'hip'); DRAW.currentPts = []; DRAW.lines = []; window.__hvLabel = ''; }, tool);
  const a = await scr([200,200]);
  const rad = deg * Math.PI / 180, end = await scr([200 + Math.cos(rad)*len, 200 + Math.sin(rad)*len]);
  await pg.mouse.click(a.x, a.y);
  if (shift) await pg.keyboard.down('Shift');
  await pg.mouse.move(end.x, end.y, { steps: 4 });
  await pg.waitForTimeout(60);
  const label = await pg.evaluate(() => { redrawAll(); return window.__hvLabel; });
  await pg.mouse.click(end.x, end.y);
  if (shift) await pg.keyboard.up('Shift');
  await pg.evaluate(() => { if (DRAW.currentPts.length) finishCurrent(); });
  return pg.evaluate((label) => {
    const l = DRAW.lines.filter(x => x.type === 'hip' || x.type === 'valley').pop();
    if (!l) return { label, deg: null };
    const d = Math.atan2(l.pts[1][1]-l.pts[0][1], l.pts[1][0]-l.pts[0][0]) * 180 / Math.PI;
    return { label, deg: Math.round(d * 10) / 10 };
  }, label);
};
await drawHip(30, 120);   // the first press on a fresh canvas wakes the tool
const h40 = await drawHip(38, 150);
check('a hip drawn at 38° stays at 38° — it is no longer forced onto 45°', h40.deg != null && Math.abs(h40.deg - 38) < 0.8, JSON.stringify(h40));
check('…and its label says so ("Hip 38.0°"), not "✓ 45°"', /^Hip 3[78]\.\d°$/.test(h40.label), h40.label);
const h44 = await drawHip(43.5, 150);
check('a hip drawn within 3° of 45° snaps onto it', h44.deg != null && Math.abs(h44.deg - 45) < 0.05, JSON.stringify(h44));
check('…and only then reads "Hip ✓ 45°"', h44.label === 'Hip ✓ 45°', h44.label);
const hS = await drawHip(43.5, 150, true);
check('Shift draws it free: 43.5° stays 43.5°', hS.deg != null && Math.abs(hS.deg - 43.5) < 0.6 && /^Hip 4[34]\.\d°$/.test(hS.label), JSON.stringify(hS));
const v40 = await drawHip(50, 150, false, 'valley');
check('a valley reads its true angle too ("Valley 50.0°" to the wall it starts on)', /^Valley (49|50|51)\.\d°$/.test(v40.label), JSON.stringify(v40));

// ── 4. a line's end catches the line it was drawn to ──────────────
await pg.evaluate(() => { DRAW.lines = [{ type:'ridge', pts:[[200,360],[800,360]] }]; setTool('select'); redrawAll(); });
// a valley from the bottom wall at 45°, let go 12 image px short of the ridge
const vAt = await (async () => {
  await pg.evaluate(() => { setTool('valley'); DRAW.currentPts = []; });
  const a = await scr([400,520]);
  const e = await scr([400 + 148, 520 - 148]);
  await pg.mouse.click(a.x, a.y); await pg.mouse.move(e.x, e.y, { steps: 4 }); await pg.mouse.click(e.x, e.y);
  await pg.evaluate(() => { if (DRAW.currentPts.length) finishCurrent(); });
  return pg.evaluate(() => { const l = DRAW.lines.filter(x => x.type === 'valley').pop(); return l ? l.pts.map(p => p.map(n => Math.round(n * 10) / 10)) : null; });
})();
check('a valley let go just short of a ridge ends ON the ridge', vAt && Math.abs(vAt[1][1] - 360) < 0.6, JSON.stringify(vAt));
check('…at the angle it was drawn (still 45°)', vAt && Math.abs(Math.abs(vAt[1][0] - vAt[0][0]) - Math.abs(vAt[1][1] - vAt[0][1])) < 0.8, JSON.stringify(vAt));
// a ridge started just off the main ridge drops onto it, and keeps going plumb
const rAt = await (async () => {
  await pg.evaluate(() => { setTool('ridge'); DRAW.currentPts = []; });
  const a = await scr([600, 368]);
  const e = await scr([600, 515]);
  await pg.mouse.click(a.x, a.y); await pg.mouse.move(e.x, e.y, { steps: 4 }); await pg.mouse.click(e.x, e.y);
  await pg.evaluate(() => { if (DRAW.currentPts.length) finishCurrent(); });
  return pg.evaluate(() => { const l = DRAW.lines.filter(x => x.type === 'ridge').pop(); return l ? l.pts.map(p => p.map(n => Math.round(n * 10) / 10)) : null; });
})();
check('a ridge started 8 px off another ridge starts ON it', rAt && Math.abs(rAt[0][1] - 360) < 0.6, JSON.stringify(rAt));
check('…and its far end, 5 px short of the wall, ends on the wall', rAt && Math.abs(rAt[1][1] - 520) < 0.6, JSON.stringify(rAt));
// Shift: nothing caught
const fAt = await (async () => {
  await pg.evaluate(() => { setTool('valley'); DRAW.currentPts = []; });
  const a = await scr([700,520]); const e = await scr([700 - 140, 520 - 140]);
  await pg.keyboard.down('Shift');
  await pg.mouse.click(a.x, a.y); await pg.mouse.move(e.x, e.y, { steps: 4 }); await pg.mouse.click(e.x, e.y);
  await pg.keyboard.up('Shift');
  await pg.evaluate(() => { if (DRAW.currentPts.length) finishCurrent(); });
  return pg.evaluate(() => { const l = DRAW.lines.filter(x => x.type === 'valley').pop(); return l ? l.pts.map(p => p.map(n => Math.round(n))) : null; });
})();
check('with Shift held the end stays where it was let go', fAt && Math.abs(fAt[1][1] - 380) <= 1, JSON.stringify(fAt));

// ── 5. dragging a hip's end shows its true angle ──────────────────
await pg.evaluate(() => {
  DRAW.lines = [{ type:'hip', pts:[[200,200],[360,360]] }, { type:'ridge', pts:[[360,360],[640,360]] }];
  setTool('addmeas'); DRAW.selectedLine = 0; redrawAll();
});
const ep = await scr([360,360]);
await pg.evaluate(() => { DRAW.selectedLine = 0; });
// press on the end of the selected hip, then drag it 30 px along the ridge
const dragRes = await (async () => {
  await pg.mouse.move(ep.x, ep.y); await pg.mouse.down();
  const s = await pg.evaluate(() => getImgTransform().s);
  await pg.mouse.move(ep.x + 30 * s, ep.y, { steps: 5 });
  const during = await pg.evaluate(() => { redrawAll(); return { drag: !!DRAG_EP, label: window.__hvLabel }; });
  await pg.mouse.up();
  const pts = await pg.evaluate(() => DRAW.lines[0].pts.map(p => p.map(n => Math.round(n))));
  return { during, pts };
})();
check('dragging a hip\'s end off 45° reads its true angle, not 45°',
  dragRes.during.drag && (/^Hip \d+\.\d°$/.test(dragRes.during.label) && !/45/.test(dragRes.during.label)), JSON.stringify(dragRes));

const shipped = await pg.evaluate(() => PZ_WELD_ON);
check('rule 7c is ON since the owner\'s go (PZ_WELD_ON true)', shipped === true, String(shipped));
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
