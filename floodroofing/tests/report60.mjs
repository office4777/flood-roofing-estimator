// Feedback report 60 (2026-10-01): "this roof has a dog leg, the app needs to
// be able to draw gable roof like this one as these roofs are very common".
// A gable building that bends part-way along. Pinned, from the report's own
// outline (fixtures-report60.json):
//   • finishing the outline does not square it (it is far outside 20°) but
//     lines its walls up: each wing's gutters exactly parallel, its gable
//     end exactly square to them;
//   • the gable builder draws a ridge down each wing meeting at the bend, a
//     VALLEY from the inside corner and a HIP from the outside corner, the
//     gable barges on both ends and the gutters along the sides;
//   • the sheets are counted per wing, square to each wing's own ridge (the
//     ridge-claim grid ran the first wing's sheets on through the second):
//     7 + 7 @ 2.11 m and 5 + 5 @ 2.02 m, plus one valley spare = 25;
//   • dragging a corner keeps every wall's direction (the square stretch
//     flattened the bent wing — it "only came out right with Shift");
//   • a square building still squares at 20° on Enter, and a plain gable is
//     untouched;
//   • picking Building outline says that Shift turns the snapping off.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const G = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report60.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const par = (x, y) => { let d = Math.abs(x - y) % 180; return Math.min(d, 180 - d); };

// ── the outline: lined up, not squared ───────────────────────────
let v = await pg.evaluate((g) => {
  gotoTab('roof'); try { _fergusPanelClose(); } catch(e){}
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch; DRAW.roofType = 'gable';
  // shifted into view; a few pixels of hand wobble added to two corners
  DRAW.outline = g.outline.map(p => [p[0] - 1000, p[1] - 380]);
  DRAW.outline[1][0] += 2; DRAW.outline[4][1] += 3;
  DRAW.outlineDone = true; DRAW.lines = [];
  DRAW.roofs = [Object.assign(_newEmptyRoof('Main Roof'), { outline: DRAW.outline })]; DRAW.activeRoofIdx = 0;
  const did = _autoSquareOutline();
  return { did, ol: DRAW.outline.map(p => p.slice()) };
}, G);
const o = v.ol;
check('finishing the dog-leg does something to it', v.did, JSON.stringify(v.ol));
check('…but does not square it: the second wing still runs at its own angle', par(ang(o[2], o[3]), 0) > 20, ang(o[2], o[3]).toFixed(1) + '°');
check('…its first wing’s two gutters come out exactly parallel', par(ang(o[5], o[0]), ang(o[1], o[2])) < 0.05, [ang(o[5], o[0]), ang(o[1], o[2])].map(x => x.toFixed(2)).join(' / '));
check('…the second wing’s too', par(ang(o[2], o[3]), ang(o[4], o[5])) < 0.05, [ang(o[2], o[3]), ang(o[4], o[5])].map(x => x.toFixed(2)).join(' / '));
check('…and both gable ends exactly square to their wing', Math.abs(par(ang(o[0], o[1]), ang(o[1], o[2])) - 90) < 0.05 && Math.abs(par(ang(o[3], o[4]), ang(o[2], o[3])) - 90) < 0.05);
check('…with no corner moved further than a hand-trace wobble', G.outline.every((p, i) => Math.hypot(p[0] - 1000 - o[i][0], p[1] - 380 - o[i][1]) < 8));

// ── the roof lines ───────────────────────────────────────────────
// The roof itself from the report's exact outline (the wobble above was only
// for the line-up): finished the way the app finishes it.
v = await pg.evaluate((g) => {
  DRAW.outline = g.outline.map(p => [p[0] - 1000, p[1] - 380]);
  DRAW.roofs[0].outline = DRAW.outline; _autoSquareOutline();
  autoGenerateRoof('gable', 0); try { autoCalcLineMeasurements(); } catch(e){}
  const L = DRAW.lines.map(l => ({ t: l.type, p: l.pts.map(q => q.slice()), dl: !!l.dogleg, sub: l.subtype || '', m: l.measM }));
  return { L, ol: DRAW.outline.map(p => p.slice()) };
}, G);
const by = t => v.L.filter(l => l.t === t);
const ridges = by('ridge'), valleys = by('valley'), hips = by('hip'), barges = by('barge'), gutters = by('gutter');
check('two ridge pieces, one down each wing, both marked dog-leg', ridges.length === 2 && ridges.every(r => r.dl), JSON.stringify(ridges.map(r => r.p)));
check('…meeting end to end at the bend', Math.hypot(ridges[0].p[1][0] - ridges[1].p[0][0], ridges[0].p[1][1] - ridges[1].p[0][1]) < 0.5 ||
  ridges.some(a => ridges.some(c => a !== c && a.p.some(p => c.p.some(q => Math.hypot(p[0]-q[0], p[1]-q[1]) < 0.5)))));
const ol = v.ol, bend = (() => { for (const a of ridges[0].p) for (const c of ridges[1].p) if (Math.hypot(a[0]-c[0], a[1]-c[1]) < 0.5) return a; return null; })();
check('one VALLEY from the inside corner of the bend, one HIP from the outside corner, both to the ridge’s bend',
  valleys.length === 1 && hips.length === 1 && !!bend &&
  Math.hypot(valleys[0].p[0][0] - ol[2][0], valleys[0].p[0][1] - ol[2][1]) < 0.5 && Math.hypot(hips[0].p[0][0] - ol[5][0], hips[0].p[0][1] - ol[5][1]) < 0.5 &&
  Math.hypot(valleys[0].p[1][0] - bend[0], valleys[0].p[1][1] - bend[1]) < 0.5, JSON.stringify({ valleys, hips, bend }));
const ra = ridges.map(r => ang(r.p[0], r.p[1]));
check('each ridge runs along its own wing',
  ra.some(a => par(a, ang(ol[1], ol[2])) < 0.5) && ra.some(a => par(a, ang(ol[2], ol[3])) < 0.5), ra.map(x => x.toFixed(1)).join(' / '));
check('gable barges on both ends (two pieces each, starter and finish), gutters along the four sides',
  barges.length === 4 && barges.filter(x => x.sub === 'starter').length === 2 && barges.filter(x => x.sub === 'finish').length === 2 && gutters.length === 4,
  JSON.stringify(v.L.map(l => l.t + ':' + l.sub)));

// ── the sheets ───────────────────────────────────────────────────
v = await pg.evaluate(async () => {
  gotoTab('materials'); await new Promise(r => setTimeout(r, 3500));
  const g = (window._lastSheetCounts && window._lastSheetCounts.groups) || [];
  const s = (window._lastSheetSections || []).map(x => ({ perNeg: x.perNeg, perPos: x.perPos, total: x.total, mm: x.orderedMm, spare: x.valleyExtra || 0 }));
  gotoTab('roof');
  return { g: g.map(x => ({ n: x.count != null ? x.count : x.n, mm: x.orderedMm || x.mm })), s };
});
const tot = v.s.reduce((a, x) => a + x.total, 0);
const wingA = v.s.find(x => x.mm > 2080), wingB = v.s.find(x => x.mm < 2080);
check('the sheets are counted wing by wing: 7 + 7 sheets @ 2.11 m on the first wing, with the valley spare',
  !!wingA && wingA.perNeg + wingA.perPos === 14 && wingA.spare === 1 && wingA.total === 15, JSON.stringify(v.s));
check('…5 + 5 @ 2.02 m on the bent wing, square to its own ridge', !!wingB && wingB.perNeg === 5 && wingB.perPos === 5 && wingB.total === 10, JSON.stringify(v.s));
check('…25 sheets in all', tot === 25, tot + ' ' + JSON.stringify(v.g));

// ── a corner dragged keeps every wall's direction ────────────────
v = await pg.evaluate(() => {
  const init = DRAW.outline.map(p => p.slice());
  const out = _stretchParallelOutline(3, init[3][0] + 14, init[3][1] + 9, init);
  const sq = _stretchRectilinearOutline(3, init[3][0] + 14, init[3][1] + 9, init);
  return { init, out, sq, rect: _outlineIsRectilinear(init, AUTO_SQUARE_TOL_DEG) };
});
const di = (P, i, j) => ang(P[i], P[j]);
check('dragging the bent wing’s corner: the building is not "square", so the walls keep their own directions',
  !v.rect && [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]].every(([i, j]) => par(di(v.out, i, j), di(v.init, i, j)) < 0.05) &&
  Math.hypot(v.out[3][0] - v.init[3][0] - 14, v.out[3][1] - v.init[3][1] - 9) < 0.01, JSON.stringify(v.out));
check('…where the square stretch would have flattened the bent wing',
  !v.sq || par(di(v.sq, 2, 3), di(v.init, 2, 3)) > 1, JSON.stringify(v.sq));

// ── a square building and a plain gable are as before ─────────────
v = await pg.evaluate(() => {
  const ol = [[100,100],[420,104],[421,300],[99,296]];        // up to ~1° out by hand
  DRAW.outline = ol.map(p => p.slice()); DRAW.lines = [];
  const did = _autoSquareOutline();
  const sq = DRAW.outline.map(p => p.slice());
  const lines = buildGableRoofLines(sq, false);
  return { did, sq, ridges: lines.filter(l => l.type === 'ridge').length, dog: lines.some(l => l.dogleg), tol: AUTO_SQUARE_TOL_DEG };
});
check('the squaring on Enter is back at 20° (the owner: "roll back to the old snap points")', v.tol === 20);
check('…a nearly square building comes out square', v.did && Math.abs(v.sq[0][1] - v.sq[1][1]) < 0.01 && Math.abs(v.sq[1][0] - v.sq[2][0]) < 0.01, JSON.stringify(v.sq));
check('…and a plain gable is one straight ridge, never a dog-leg', v.ridges === 1 && !v.dog, JSON.stringify(v));

// ── the Shift tip ────────────────────────────────────────────────
v = await pg.evaluate(async () => {
  localStorage.removeItem('fr_shift_tip_off');
  setTool('outline'); await new Promise(r => setTimeout(r, 100));
  const t = document.getElementById('shiftTip');
  const out = { shown: !!t, text: t ? t.textContent : '' };
  t.querySelector('button').click();
  setTool('select'); setTool('outline'); await new Promise(r => setTimeout(r, 100));
  out.after = !!document.getElementById('shiftTip');
  setTool('select');
  return out;
});
check('picking Building outline says hold Shift to turn the snapping off', v.shown && /hold Shift/.test(v.text) && /snap/i.test(v.text), v.text);
check('…and "Don’t show again" keeps it away', !v.after);
// ── the Enter tip ────────────────────────────────────────────────
// The Shift tip fires when the TOOL is picked. This one answers the question
// that only arises once corners are going in — how do I stop? So it is tied
// to the drawing, not to a timer: it must appear on the first corner and be
// gone the moment the outline is finished.
v = await pg.evaluate(async () => {
  localStorage.removeItem('fr_enter_tip_off');
  const read = () => { const t = document.getElementById('enterTip'); return t ? t.textContent : null; };
  const out = {};
  setTool('outline'); DRAW.currentPts = []; DRAW.outlineDone = false; redrawAll();
  out.beforeAnyCorner = read();                       // tool picked, nothing drawn yet
  DRAW.currentPts = [[100, 100]]; redrawAll();
  out.onFirstCorner = read();
  const t = document.getElementById('enterTip');
  const box = t.getBoundingClientRect(), host = document.getElementById('canvasWrap').getBoundingClientRect();
  out.right = Math.round(host.right - box.right);     // pinned to the right-hand edge
  out.top = Math.round(box.top - host.top);
  out.width = Math.round(box.width);
  const sh = document.getElementById('shiftTip');
  out.clearsShiftTip = !sh || box.top >= sh.getBoundingClientRect().bottom;
  DRAW.outlineDone = true; redrawAll();               // finished
  out.afterFinish = read();
  DRAW.outlineDone = false; redrawAll();
  document.getElementById('enterTip').querySelector('button').click();
  DRAW.currentPts = [[1, 1]]; redrawAll();
  out.afterDontShow = read();
  DRAW.currentPts = []; DRAW.outlineDone = false; setTool('select'); redrawAll();
  return out;
});
check('nothing is said until a corner actually goes in', v.beforeAnyCorner === null, String(v.beforeAnyCorner));
check('the first corner says to press Enter to finish the outline',
  /press\s+Enter/i.test(v.onFirstCorner || '') && /finish the building outline/i.test(v.onFirstCorner || ''),
  String(v.onFirstCorner));
check('…in the top right of the canvas, small, and clear of the Shift tip',
  v.right >= 0 && v.right <= 20 && v.top >= 0 && v.width <= 230 && v.clearsShiftTip,
  JSON.stringify({ right: v.right, top: v.top, width: v.width, clears: v.clearsShiftTip }));
check('…and it goes the moment the outline is finished', v.afterFinish === null, String(v.afterFinish));
check('…"Don\u2019t show again" keeps it away', v.afterDontShow === null, String(v.afterDontShow));

check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 300));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
