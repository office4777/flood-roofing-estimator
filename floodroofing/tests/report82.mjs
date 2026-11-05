// FEEDBACK REPORTS 82 AND 83 (2026-11-02, the owner on job 3314): the little
// steps at the ENDS of a wall — a step flush with the next wall, so it has one
// inside corner, not two:
//   82: "these little steps there should be a button to click mono-extension
//   as you can see it creates a hip and valley junction if pulled too far"
//   83: "another example moved in a little auto converts it which is wrong"
// Reports 78/79 gave a bump (a short wall standing out from a straight one,
// an inside corner at each end) the Hip & valley | Mono extension switch and
// fixed its kind when a corner is grabbed. A CORNER STEP was never found as a
// bump, so it had neither: deep it got its own hip end, shallow it was squared
// into the wall, decided by how far it was dragged. It is a bump now, its
// missing inside corner the point on its far side level with the wall.
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
  const e = document.getElementById(i); if (e) e.remove(); }); });

// His roof, report 82: a step at the top-left (corners 6, 7, 0 — flush with the
// west wall) and a long thin strip down the east side (corners 4, 3, 2 — flush
// with the south wall). Report 83 is the same roof with the top-left step
// dragged 0.97 m shallower (449 → 466).
const OL = (top) => [[478,top],[478,1087],[1191,1087],[1191,605],[1160,605],[1160,489],[557,489],[557,top]];
const build = (top) => pg.evaluate((ol) => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.057230458633099515; DRAW.calPitch = 15;
  DRAW.outline = ol; DRAW.outlineDone = true;
  autoGenerateRoof('hip'); setTool('select');
  DRAW.zoom = 0.6; redrawAll();
}, OL(top));
const state = (b) => pg.evaluate((b) => {
  const o = DRAW.outline, near = (p, c) => Math.hypot(p[0]-c[0], p[1]-c[1]) < 4;
  const B = o[b.b], C = o[b.c], A = o[b.a];
  const bump = _outlineBumps(o).find(x => x.key === String(b.b));
  const D = bump ? (bump.d >= 0 ? o[bump.d] : bump.dPt) : null;
  const hv = DRAW.lines.filter(l => (l.type === 'hip' || l.type === 'valley') && l.pts.some(p => [A, B, C].some(c => near(p, c)))).length;
  const side = (a, c) => DRAW.lines.filter(l => l.pts.length === 2 && ((near(l.pts[0], a) && near(l.pts[1], c)) || (near(l.pts[0], c) && near(l.pts[1], a)))).map(l => l.type).sort().join();
  const hipAtD = D ? DRAW.lines.some(l => l.type === 'hip' && l.pts.some(p => near(p, D))) : false;
  const row = document.getElementById('cornerBumpRow');
  return { found: !!bump, corner: !!(bump && bump.corner), D, hv, sideA: side(A, B), outer: side(B, C), sideC: D ? side(C, D) : '', hipAtD,
           modes: JSON.stringify(DRAW.bumpModes || null),
           row: row && row.style.display !== 'none' ? row.innerText.replace(/\s+/g, ' ').trim() : '',
           on: row ? [...row.querySelectorAll('.crn-bump.on')].map(x => x.dataset.bump).join() : '' };
}, b);
const TL = { a: 6, b: 7, c: 0 }, EAST = { a: 4, b: 3, c: 2 };

await build(449);
let v = await pg.evaluate(() => _outlineBumps(DRAW.outline).map(x => ({ k: x.key, a: x.a, c: x.c, corner: !!x.corner, d: x.dPt })));
check('his outline: both little steps are found — the top-left one (6, 7, 0) and the east strip (4, 3, 2), each a corner step',
  v.length === 2 && v.some(x => x.k === '7' && x.a === 6 && x.c === 0 && x.corner && x.d[0] === 478 && x.d[1] === 489) &&
  v.some(x => x.k === '3' && x.a === 4 && x.c === 2 && x.corner && x.d[0] === 1160 && x.d[1] === 1087), JSON.stringify(v));

v = await state(TL);
check('report 82 as he drew it: the top-left step is its own hip & valley', v.hv >= 2, JSON.stringify(v));

// ── the pad offers the switch on a step's corner ──
await pg.evaluate(() => _cornerRepoOpen(7));
v = await state(TL);
check('its corner\'s pad shows "This bump\'s roof": Hip & valley | Mono extension, Hip & valley ticked and remembered',
  /^Bump/i.test(v.row) && /Mono extension/.test(v.row) && v.on === 'hv' && JSON.parse(v.modes)['7'] === 'hv', v.row + ' ' + v.on + ' ' + v.modes);

// ── Mono extension: the main roof carried out over it ──
await pg.evaluate(() => _bumpSetMode('mono'));
v = await state(TL);
check('"Mono extension": no hip or valley at the step, its two sides barges, its end gutter', v.hv === 0 && v.sideA === 'barge' && v.sideC === 'barge' && v.outer === 'gutter', JSON.stringify(v));
check('…and the main hip starts at the main corner, where the step\'s side meets the wall line', v.hipAtD, JSON.stringify(v));
let t = await pg.evaluate(() => { const r = _sheetPuzzleBuild({}); return { n: (r.tally || []).reduce((a, x) => a + x.count, 0), mono: (r.roofs || []).some(R => R.monoBumps && R.monoBumps.length), cov: _pzTallyCovers(r.tally, -1) }; });
check('…the sheet layout lays it as the plain roof with longer sheets (a mono extension) and covers the roof', t.n > 0 && t.mono && t.cov, JSON.stringify(t));

// ── REPORT 83: moved in a little it keeps the kind it has ──
v = await pg.evaluate(() => { DRAW.outline[7][1] = 466; DRAW.outline[0][1] = 466; regenerateAutoRoofLines('hip'); redrawAll(); return null; });
v = await state(TL);
check('REPORT 83: dragged 1 m shallower, the mono extension stays a mono extension', v.hv === 0 && v.sideA === 'barge' && v.sideC === 'barge', JSON.stringify(v));
await pg.evaluate(() => _bumpSetMode('hv'));
v = await state(TL);
check('…and set to Hip & valley it is its own hip end however shallow — never squared into the wall', v.hv >= 2 && /gutter/.test(v.sideA), JSON.stringify(v));

// A real drag, from scratch: grabbing the corner fixes what is on screen.
await build(449);
await pg.evaluate(() => { document.getElementById('roofCanvas').scrollIntoView({ block:'center' }); });
await pg.waitForTimeout(250);
const loc = await pg.evaluate(() => {
  const t = getImgTransform(), c = imgToCanvas(DRAW.outline[7], t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1], s: t.s };
});
await pg.mouse.move(loc.x, loc.y);
await pg.mouse.down();
await pg.mouse.move(loc.x, loc.y + 17 * loc.s, { steps: 8 });
await pg.mouse.up();
await pg.waitForTimeout(250);
v = await state(TL);
check('a real drag of the step\'s corner shallower keeps it hip & valley (it was), and the pad says so', v.hv >= 2 && v.on === 'hv', JSON.stringify(v));

// ── the long east strip too ──
await build(449);
await pg.evaluate(() => { _cornerRepoOpen(3); _bumpSetMode('mono'); });
v = await state(EAST);
check('the east strip as a mono extension: no hip or valley at it, barges on its ends', v.hv === 0 && v.sideA === 'barge' && v.sideC === 'barge', JSON.stringify(v));

// ── nothing moves for a roof nobody has set ──
v = await pg.evaluate((ol) => {
  clearAll(true); DRAW.outline = ol.map(p => p.slice()); DRAW.bumpModes = null;
  return JSON.stringify(_hipLinesWithBumps(DRAW.outline)) === JSON.stringify(buildHipValleyLines(ol.map(p => p.slice())));
}, OL(466));
check('with no choice made the hip roof is built exactly as before', v);
v = await pg.evaluate(() => {
  // An L's wing is not a step: deeper than 0.3 of the narrower span.
  return _outlineBumps([[100,100],[600,100],[600,300],[400,300],[400,700],[100,700]]).length;
});
check('an L\'s wing is not taken for a step', v === 0, String(v));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
