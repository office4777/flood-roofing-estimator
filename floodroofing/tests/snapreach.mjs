// "There's a weird snap point happening, it doesn't quite let me reach the
// corner of the background image ... and i have to move the corner afterwards."
//
// The cause was the unit. snap() locked a new point onto the nearest axis —
// along or square to the wall just drawn — whenever it was within 35° of it.
// An angle is the wrong unit for that test, because the same angle covers a
// different DISTANCE depending on how far you have dragged: 35° is a couple of
// millimetres beside the last corner and several metres at the far end of a
// wall. So the far corner of a building was nearly always inside some axis's
// cone and got silently projected onto it.
//
// It is now a perpendicular distance in screen pixels, capped by a much
// narrower angle so a short stub still squares up. These cases are geometry
// against the real snap(), so they say what a roofer's hand actually does.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// Drive snap() directly with a known in-progress outline. Grid snap is on (the
// default) and the grid is 5 px, so every expectation below is on that grid —
// the axis lock is the thing under test, not the grid.
async function snapAt(prevPts, x, y, tool){
  return pg.evaluate(([pts, px, py, t]) => {
    DRAW.tool = t || 'outline';
    DRAW.currentPts = pts.map(p => p.slice());
    var r = snap(px, py);
    return { x: r[0], y: r[1] };
  }, [prevPts, x, y, tool || 'outline']);
}
const scale = await pg.evaluate(() => { var tr = getImgTransform(); return tr ? tr.s : 1; });
check('the canvas has a usable transform', scale > 0, String(scale));

// A wall drawn left-to-right along the top. The next corner goes DOWN.
const A = [[100, 100], [500, 100]];

// ── the fault ──────────────────────────────────────────────────────
// 400 px down and 40 px across — 5.7° off straight-down. Inside the old 35°
// cone, so the x was thrown away and the corner jumped to 500. The user then
// had to drag it back, every time.
let r = await snapAt(A, 540, 500);
check('a corner 40px off a long axis is left where it was put',
  Math.abs(r.x - 540) <= 5, 'x=' + r.x + ' (wanted ~540, old code gave 500)');

// 20 px off over the same 400 px — 2.9°, still well inside the old cone.
r = await snapAt(A, 520, 500);
check('…and so is one only 20px off',
  Math.abs(r.x - 520) <= 5, 'x=' + r.x);

// ── the help that must survive ─────────────────────────────────────
// Genuinely running straight down: still squared, which is the whole point of
// having a lock at all.
r = await snapAt(A, 502, 500);
check('a corner within a couple of pixels of the axis still snaps square',
  Math.abs(r.x - 500) <= 1, 'x=' + r.x);
r = await snapAt(A, 500, 500);
check('…and one exactly on it stays exactly on it',
  Math.abs(r.x - 500) <= 1, 'x=' + r.x);

// A short run still squares up — without the angle cap an 8px tolerance would
// swallow every direction at this length, and without ANY lock a short wall
// would never come out square. (505 not 508: the 5px grid runs first, so an
// offset of 8 becomes 10 before the lock ever sees it.)
r = await snapAt(A, 505, 130);
check('a short run still squares up', Math.abs(r.x - 500) <= 1, 'x=' + r.x);
// …but not one that is plainly diagonal, however short.
r = await snapAt(A, 530, 130);
check('…unless it is plainly diagonal', Math.abs(r.x - 530) <= 5, 'x=' + r.x);

// ── the tolerance is a distance, so it does not grow with the run ──
// The same 40 px offset at four times the length was even deeper inside the
// old cone. It must behave identically now.
r = await snapAt([[100, 100], [1300, 100]], 1340, 1300);
check('the tolerance does not widen as the wall gets longer',
  Math.abs(r.x - 1340) <= 5, 'x=' + r.x);

// ── the first wall still finds the world axes ──────────────────────
r = await snapAt([[200, 200]], 600, 203);
check('the first wall of an outline still snaps horizontal',
  Math.abs(r.y - 200) <= 1, 'y=' + r.y);
r = await snapAt([[200, 200]], 600, 260);
check('…but not when it is clearly sloping', Math.abs(r.y - 260) <= 5, 'y=' + r.y);

// ── closing the outline ────────────────────────────────────────────
// The line back to the first corner is one of the axes. What the lock gives is
// the DIRECTION, not the endpoint — it holds the last wall straight back
// towards the first corner rather than dragging the point onto it.
r = await snapAt([[100, 100], [500, 100], [500, 500]], 103, 505);
check('a last wall aimed at the first corner is held straight',
  Math.abs(r.y - 500) <= 1, 'y=' + r.y + ' (wanted 500 — locked to the closing run)');
check('…without the point being dragged onto the corner',
  r.x > 100 && r.x <= 110, 'x=' + r.x);
// Clearly not aiming back at it: left alone, as anywhere else.
r = await snapAt([[100, 100], [500, 100], [500, 500]], 105, 560);
check('…and a last wall pointing somewhere else is left alone',
  Math.abs(r.y - 560) <= 5, 'y=' + r.y);

// ── Shift is still the full escape hatch ───────────────────────────
const off = await pg.evaluate(() => {
  var el = document.getElementById('snapGrid'); var was = el.checked;
  el.checked = false;
  DRAW.tool = 'outline'; DRAW.currentPts = [[100,100],[500,100]];
  var r = snap(502.7, 500.3);
  el.checked = was;
  return { x: r[0], y: r[1] };
});
check('with snap off, the point is left exactly alone',
  Math.abs(off.x - 502.7) < 0.001 && Math.abs(off.y - 500.3) < 0.001, JSON.stringify(off));

// ── the other tools kept their behaviour ───────────────────────────
r = await snapAt([[100, 100], [500, 100]], 540, 500, 'gutter');
check('a gutter run is governed by the same distance rule',
  Math.abs(r.x - 540) <= 5, 'x=' + r.x);
r = await snapAt([[100, 100], [500, 100]], 502, 500, 'ridge');
check('…and a ridge still squares when it really is square',
  Math.abs(r.x - 500) <= 1, 'x=' + r.x);

// A tool with no axis lock at all must come back grid-snapped and no more.
r = await snapAt([[100, 100]], 337, 212, 'select');
check('a tool with no lock gets the grid and nothing else',
  r.x === 335 && r.y === 210, JSON.stringify(r));

// ── report #27: the same user, from the other side ─────────────────
// "The first 90° vertical snap point is too vague, it needs to snap harder
//  staying perfectly vertical … but then it trys to snap the 2nd vertical
//  line to match the pixel height as the first vertical line which is wrong,
//  i never want it to do that."
//
// These run at a working zoom (bg image + zoom 2), because the tolerances are
// SCREEN pixels and the report came from a 200% canvas.
await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
  c.getContext('2d').fillStyle = '#777'; c.getContext('2d').fillRect(0,0,1600,1200);
  const im = new Image(); im.src = c.toDataURL('image/jpeg', 0.7);
  await new Promise(r => { im.onload = r; });
  DRAW.bgImg = im; DRAW.zoom = 2; IMG_OFFSET = {x:0,y:0}; redrawAll();
});
const s2 = await pg.evaluate(() => getImgTransform().s);
check('the working-zoom transform is live', s2 > 1, String(s2));

// A first wall drawn 5 image px off plumb over 250 — a ~10 screen-px hand
// wobble at this zoom. It must come out perfectly vertical.
r = await snapAt([[400, 100]], 405, 350);
check('a long first wall a hand-wobble off plumb is held perfectly vertical',
  Math.abs(r.x - 400) <= 1, 'x=' + r.x + ' (5 image px ≈ 10 screen px off)');
// …while a deliberate diagonal is still nobody's business but the user's.
r = await snapAt([[400, 100]], 460, 350);
check('…and a deliberate diagonal is still left alone',
  Math.abs(r.x - 460) <= 5, 'x=' + r.x);

// The second vertical must NEVER be pulled to the first one's length.
// Outline so far: down 400, across 200. Now going back up — aim for a wall
// 340 long (60 short of matching, within the old 14% pull) and clearly clear
// of the closing corner.
const sq = await pg.evaluate(() => {
  DRAW.tool = 'outline';
  DRAW.currentPts = [[400,100],[400,500],[600,500]];
  return {
    match: _outlineSquareSnap(602, 130),   // 370 up, within the old 14% pull — old code answered y=100
    cone:  _outlineSquareSnap(690, 380),   // 27° off perpendicular — old 50° cone grabbed it
    close: _outlineSquareSnap(603, 103),   // 4 image px ≈ 9 screen px from the true corner
    far:   _outlineSquareSnap(618, 118),   // ~25 screen px out — offered nothing
  };
});
check('the second vertical is never pulled to match the first wall’s length',
  sq.match === null, JSON.stringify(sq.match) + ' (old code answered y=100)');
check('…and no 50° cone forces a diagonal click square',
  sq.cone === null, JSON.stringify(sq.cone));
check('the true closing corner still snaps when the click is nearly there',
  !!sq.close && sq.close[0] === 600 && sq.close[1] === 100, JSON.stringify(sq.close));
check('…from a tight screen-pixel radius, not 60 image pixels',
  sq.far === null, JSON.stringify(sq.far));

// Back to the plain canvas so nothing below inherits the zoom.
await pg.evaluate(() => { DRAW.bgImg = null; DRAW.zoom = 1; redrawAll(); });

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
