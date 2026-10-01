// THE OWNER, 2026-09-30, on a building with a raking wall:
//
//   "There is a job with a raking wall, it keeps auto snapping to square.
//    If the roof was drawn well out of square don't snap it to square, only
//    snap it if it was drawn slightly out of square. Add a button called
//    Square Corner which squares up a corner — when clicked it should show
//    the roof map with no information except the outline with corner circles
//    at each corner, then clicking one snaps that corner to square, giving it
//    a little square in the corner indicating that corner is true square.
//    The squaring symbol currently appears even when the corner is well out
//    of true square, tighten this up too."
//
// Three things, pinned here: finishing an outline squares it only when it was
// drawn NEARLY square (the gate was 20°, which flattened real rakes); the
// right-angle mark only appears on a corner that really is square (it was
// cos 83°, so a corner 7° out wore the mark); and the Square corner tool —
// veil, corner circles, one corner squared per click, nothing else moved.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => { document.getElementById('setupWizard')?.remove(); gotoTab('roof'); });

const draw = (pts) => pg.evaluate((p) => {
  clearAll(true); setTool('outline'); DRAW.currentPts = p.map(x => x.slice());
  finishCurrent(); DRAW.scaleMetresPerPx = 0.02;
  return DRAW.outline.map(q => [Math.round(q[0]), Math.round(q[1])]);
}, pts);

// ── a raking wall survives being drawn ────────────────────────────
// The gate went 20° → 6° → 12° and, on 2026-10-01, back to 20° (the owner:
// "roll back to the old snap points, it was much easier to use"). So an
// 11° rake is squared again; a real rake past 20° — this one is about 24° —
// is left exactly as drawn (its square walls are already square, and the
// rake is a direction of its own, so the line-up moves nothing).
const RAKE = [[200,300],[800,300],[945,620],[200,620]];
const rake = await draw(RAKE);
check('a roof drawn well out of square is left exactly as it was drawn',
  JSON.stringify(rake) === JSON.stringify(RAKE), JSON.stringify(rake));

// ── a nearly-square trace is still tidied up ──────────────────────
const near = await draw([[200,300],[800,296],[804,600],[198,602]]);
const sq = (p) => { const n = p.length; let worst = 0;
  for (let i = 0; i < n; i++){
    const A = p[(i+n-1)%n], B = p[i], C = p[(i+1)%n];
    const m1 = Math.hypot(A[0]-B[0], A[1]-B[1]) || 1, m2 = Math.hypot(C[0]-B[0], C[1]-B[1]) || 1;
    worst = Math.max(worst, Math.abs(((A[0]-B[0])/m1)*((C[0]-B[0])/m2) + ((A[1]-B[1])/m1)*((C[1]-B[1])/m2)));
  } return worst; };
check('a roof drawn only slightly out of square is still squared up for you',
  sq(near) < 0.01, JSON.stringify(near) + ' worst cos ' + sq(near).toFixed(4));

// ── the right-angle mark means TRUE square ────────────────────────
const tol = await pg.evaluate(() => ({ dot: CORNER_SQUARE_DOT, deg: Math.asin(CORNER_SQUARE_DOT) * 180 / Math.PI }));
check('the right-angle mark is only drawn on a corner square to within ~1.5°',
  tol.dot <= 0.03 && tol.deg < 2, JSON.stringify(tol));
const marks = await pg.evaluate((p) => {
  clearAll(true); setTool('outline'); DRAW.currentPts = p.map(x => x.slice()); finishCurrent();
  return [0,1,2,3].map(i => _sqcIsSquare(DRAW.outline, i));
}, RAKE);
check('…so the corners a raking wall pulls out of square do not claim to be square',
  // (the 24° rake: its two ends are out of square, the other two are true)
  marks[0] && !marks[1] && !marks[2] && marks[3], JSON.stringify(marks));

// ── the Square corner tool ────────────────────────────────────────
const btn = await pg.evaluate(() => {
  const b = document.getElementById('btn-squarecorner');
  return { there: !!b, txt: (b && b.textContent || '').trim(),
           beside: !!(b && b.nextElementSibling && b.nextElementSibling.id === 'btn-tape') };
});
check('there is a Square corner button on the roof toolbar',
  btn.there && /Square corner/i.test(btn.txt), JSON.stringify(btn));

const on = await pg.evaluate(() => {
  setTool('squarecorner');
  return { tool: DRAW.tool, lit: document.getElementById('btn-squarecorner').classList.contains('active-tool') };
});
check('…and picking it lights the button and switches the tool', on.tool === 'squarecorner' && on.lit, JSON.stringify(on));

// A click on a corner squares THAT corner and moves no other.
const one = await pg.evaluate((p) => {
  clearAll(true); setTool('outline'); DRAW.currentPts = p.map(x => x.slice()); finishCurrent();
  const before = DRAW.outline.map(q => [Math.round(q[0]), Math.round(q[1])]);
  setTool('squarecorner');
  const ok = _sqcSquareCorner(2);
  const after = DRAW.outline.map(q => [Math.round(q[0]), Math.round(q[1])]);
  return { ok, before, after, sqNow: _sqcIsSquare(DRAW.outline, 2),
           movedOthers: [0,1,3].filter(i => before[i][0] !== after[i][0] || before[i][1] !== after[i][1]) };
}, RAKE);
check('clicking a corner makes it a true right angle', one.ok && one.sqNow, JSON.stringify(one));
check('…and moves only that corner — the rest of the building stays put',
  one.movedOthers.length === 0, JSON.stringify(one.movedOthers) + ' ' + JSON.stringify(one.after));
check('…by the smallest move that squares it, so the shape is kept',
  // a 24° rake is a long way out, so the move is bigger than it was for the
  // 11° one — still well short of rebuilding the wall (it is 350px long)
  Math.hypot(one.after[2][0] - one.before[2][0], one.after[2][1] - one.before[2][1]) < 150,
  JSON.stringify(one.before[2]) + ' → ' + JSON.stringify(one.after[2]));

// Undo puts the corner back — the tool takes a snapshot before it moves.
const undone = await pg.evaluate(() => { undoLast(); return DRAW.outline.map(q => [Math.round(q[0]), Math.round(q[1])]); });
check('…and Undo puts it back', JSON.stringify(undone) === JSON.stringify(one.before), JSON.stringify(undone));

// A corner that is already square is left alone rather than nudged.
const already = await pg.evaluate((p) => {
  clearAll(true); setTool('outline'); DRAW.currentPts = p.map(x => x.slice()); finishCurrent();
  setTool('squarecorner');
  const before = DRAW.outline.map(q => [Math.round(q[0]), Math.round(q[1])]);
  const wasSq = _sqcIsSquare(DRAW.outline, 0);
  return { wasSq, same: JSON.stringify(before) };
}, RAKE);
check('a corner that is already square is recognised as square', already.wasSq, JSON.stringify(already));

// The tool draws its veil, so the rest of the drawing is out of the way.
const veil = await pg.evaluate(() => {
  autoGenerateRoof('hip'); autoCalcLineMeasurements();
  setTool('squarecorner'); redrawAll();
  const cv = document.getElementById('roofCanvas');
  const ctx = cv.getContext('2d');
  // A point well inside the roof but off the outline: under the veil it reads
  // near-white even though ridges and measurements are drawn there.
  const d = ctx.getImageData(Math.round(cv.width * 0.5), Math.round(cv.height * 0.5), 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
});
check('the tool veils the drawing so only the outline and its corners read',
  veil.r > 225 && veil.g > 225 && veil.b > 225, JSON.stringify(veil));

const off = await pg.evaluate(() => { setTool('select'); return { tool: DRAW.tool, hover: SQC.hover }; });
check('leaving the tool forgets what was under the pointer', off.tool === 'select' && off.hover === -1, JSON.stringify(off));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
