// "Roof map canvas background vs quote aerial background don't match — the
//  quote background should also follow and copy the canvas."
//
// Both maps draw the roofs in image-pixel coordinates, so they never disagreed
// about WHERE a roof sits on the photo. They disagreed about the crop: the
// canvas shows whatever the office panned and zoomed to, and the quote framed
// the roofs' own bounding box and nothing else. Two pictures of one house that
// looked nothing alike.
//
// The publish now captures the rectangle of the aerial the canvas is actually
// showing, and the quote reproduces it — widened only if it has to be, because
// the customer taps roofs ON THIS MAP to include them, and a roof outside the
// frame is a roof they cannot buy.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-run1024.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1.5 : tol);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2700);

await pg.evaluate(async (g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  gotoTab('roof');
  // A stand-in aerial. Only its dimensions matter — the map places it at its
  // natural size in the same coordinate space the roofs are drawn in.
  const c = document.createElement('canvas'); c.width = 2400; c.height = 2000;
  const x = c.getContext('2d'); x.fillStyle = '#556b2f'; x.fillRect(0, 0, 2400, 2000);
  const im = new Image(); im.src = c.toDataURL('image/jpeg', 0.6);
  await new Promise(r => { im.onload = r; });
  DRAW.bgImg = im;
}, GEOM);

// Frame the canvas the way the office would: whole property in shot.
const view = async (zoom, ox, oy) => pg.evaluate(([z, x, y]) => {
  DRAW.zoom = z; IMG_OFFSET.x = x; IMG_OFFSET.y = y;
  redrawAll();
  const t = getImgTransform(), cv = document.getElementById('roofCanvas');
  const dpr = window.devicePixelRatio || 1;
  const canvas = { x:(0 - t.ix)/t.s, y:(0 - t.iy)/t.s,
                   w:(cv.width/dpr)/t.s, h:(cv.height/dpr)/t.s };
  _qpStashRoofGeom(true);
  const gm = S.quote.roofMapGeom;
  const vb = (_qpRoofMapSvg({ showBg:true, maxH:300 }).match(/viewBox="([^"]+)"/)||[])[1] || '';
  const vbOff = (_qpRoofMapSvg({ showBg:false, maxH:300 }).match(/viewBox="([^"]+)"/)||[])[1] || '';
  // Do all four roofs fall inside the published frame?
  const p = vb.split(/\s+/).map(Number);
  let inside = true;
  (gm.roofs||[]).forEach(r => (r.pts||[]).forEach(pt => {
    if (pt[0] < p[0] || pt[0] > p[0]+p[2] || pt[1] < p[1] || pt[1] > p[1]+p[3]) inside = false;
  }));
  return { canvas, stashed:gm.view, vb:p, vbOff, hasBg:!!gm.bg, allRoofsInFrame:inside };
}, [zoom, ox, oy]);

// ── the ordinary case: the canvas shows the building ───────────────
const wide = await view(0.55, 0, 0);
check('the publish captures the aerial the canvas is showing', !!wide.stashed,
  JSON.stringify(wide.stashed));
check('…exactly as the canvas has it framed',
  wide.stashed && near(wide.stashed.x, wide.canvas.x) && near(wide.stashed.y, wide.canvas.y) &&
  near(wide.stashed.w, wide.canvas.w) && near(wide.stashed.h, wide.canvas.h),
  JSON.stringify(wide.stashed) + ' vs ' + JSON.stringify(
    Object.fromEntries(Object.entries(wide.canvas).map(([k,v]) => [k, +v.toFixed(1)]))));
check('…and the quote map reproduces that view, not its own crop',
  near(wide.vb[0], wide.canvas.x, 2) && near(wide.vb[1], wide.canvas.y, 2) &&
  near(wide.vb[2], wide.canvas.w, 2) && near(wide.vb[3], wide.canvas.h, 2),
  wide.vb.join(' '));
check('…with every roof in shot', wide.allRoofsInFrame);

// ── panning and zooming carries through ────────────────────────────
const zoomed = await view(1.1, -160, -90);
check('panning the canvas moves the quote’s background with it',
  !near(zoomed.stashed.x, wide.stashed.x, 5) || !near(zoomed.stashed.y, wide.stashed.y, 5),
  JSON.stringify(wide.stashed) + ' → ' + JSON.stringify(zoomed.stashed));
check('…and zooming in tightens the quote’s crop too',
  zoomed.stashed.w < wide.stashed.w - 5,
  wide.stashed.w + ' → ' + zoomed.stashed.w);
check('…the quote still following the canvas exactly',
  near(zoomed.vb[0], zoomed.canvas.x, 2) && near(zoomed.vb[2], zoomed.canvas.w, 2),
  zoomed.vb.join(' '));

// ── the guard: a roof must never be cropped out ────────────────────
// The customer chooses which roofs to include by tapping them on this map.
const cornered = await view(4.5, -900, -700);
check('zoomed hard into one corner, the quote still shows every roof',
  cornered.allRoofsInFrame, cornered.vb.join(' '));
check('…by widening the canvas view rather than abandoning it',
  cornered.vb[2] >= cornered.canvas.w - 2 && cornered.vb[3] >= cornered.canvas.h - 2,
  'frame ' + cornered.vb.slice(2).join('×') + ' vs canvas ' +
  cornered.canvas.w.toFixed(0) + '×' + cornered.canvas.h.toFixed(0));

// ── no aerial, no view to match ────────────────────────────────────
check('with the background off the map frames the roofs, as it always did',
  wide.vbOff !== wide.vb.join(' '), wide.vbOff);
const noBg = await pg.evaluate(() => {
  DRAW.bgImg = null; redrawAll(); _qpStashRoofGeom(true);
  const gm = S.quote.roofMapGeom;
  return { view:gm.view, bg:!!gm.bg,
           vb:(_qpRoofMapSvg({ showBg:true, maxH:300 }).match(/viewBox="([^"]+)"/)||[])[1] };
});
check('a job with no aerial stashes no view and frames itself',
  !noBg.bg && !noBg.view && !!noBg.vb, JSON.stringify(noBg));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
