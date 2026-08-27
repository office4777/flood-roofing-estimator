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
await pg.goto('file://'+DIR+'/app.html');
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

// ── zoomed hard in, the quote is still exactly the canvas ──────────
// This used to widen the frame so a roof could never fall outside the map the
// customer taps. It meant that zooming in — which is what you do to work on one
// roof — quietly zoomed the customer's map back out, and that is the whole of
// the reported fault. The office frames the picture now; if a roof is off the
// edge of your screen it is off the quote too, and you can see that before you
// publish because it is your own screen.
const cornered = await view(4.5, -900, -700);
check('zoomed hard into one corner, the quote is still the canvas frame',
  Math.abs(cornered.vb[2] - cornered.canvas.w) < 2 && Math.abs(cornered.vb[3] - cornered.canvas.h) < 2,
  'frame ' + cornered.vb.slice(2).map(function(v){ return v.toFixed(0); }).join('×') +
  ' vs canvas ' + cornered.canvas.w.toFixed(0) + '×' + cornered.canvas.h.toFixed(0));
check('…and is no longer widened past it to catch a stray roof',
  cornered.vb[3] <= cornered.canvas.h + 2, 'frame height ' + cornered.vb[3].toFixed(0));

// ── no aerial, no view to match ────────────────────────────────────
check('with the background off the map frames the roofs, as it always did',
  wide.vbOff !== wide.vb.join(' '), wide.vbOff);
// A quote that already stashed an aerial KEEPS it when the live photo is
// momentarily gone — that is report #25 (a reloaded draft's first render used
// to wipe the saved aerial) and it is covered in depth by draftbg.mjs. So
// "no aerial" here means what it means in every real flow (new job, job
// switch, restore): the canvas has no photo AND the quote has nothing
// stashed. Only then does the map frame itself.
const noBg = await pg.evaluate(() => {
  DRAW.bgImg = null; S.quote.roofMapGeom = null; redrawAll(); _qpStashRoofGeom(true);
  const gm = S.quote.roofMapGeom;
  return { view:gm.view, bg:!!gm.bg,
           vb:(_qpRoofMapSvg({ showBg:true, maxH:300 }).match(/viewBox="([^"]+)"/)||[])[1] };
});
check('a job with no aerial stashes no view and frames itself',
  !noBg.bg && !noBg.view && !!noBg.vb, JSON.stringify(noBg));

// ── AND THE WAY THE PHOTO IS TURNED ────────────────────────────────
// The crop was only half of it. The canvas also ROTATES the aerial — that is
// what the rotate row in the ⚙ View menu is for, squaring the photo up to the
// walls — while leaving the roof lines square, so the photo turns underneath
// them. The published map drew it unrotated, so the two came apart the moment
// the slider was touched: right on "use this view", wrong after squaring up.
const rotated = await pg.evaluate(() => {
  // Put the aerial back and turn it, the way the office does before drawing.
  const c = document.createElement('canvas'); c.width = 2400; c.height = 2000;
  const x = c.getContext('2d'); x.fillStyle = '#556b2f'; x.fillRect(0, 0, 2400, 2000);
  const im = new Image(); im.src = c.toDataURL('image/jpeg', 0.6);
  return new Promise(res => { im.onload = () => {
    DRAW.bgImg = im;
    _setFineRotate(-7.3);
    _qpStashRoofGeom(true);
    const gm = S.quote.roofMapGeom;
    const svg = _qpRoofMapSvg({ showBg:true, maxH:300 });
    const img = (svg.match(/<image[^>]*>/) || [''])[0];
    res({ stashedRot: gm.rot,
          imgTag: img,
          rotAttr: (img.match(/rotate\(([^)]+)\)/) || [])[1] || null,
          // The roofs must NOT be rotated — on the canvas they stay square and
          // the photo moves under them.
          firstRoofPt: (gm.roofs[0].pts || [])[0] });
  }; });
});
check('the canvas rotation is captured with the view',
  Math.abs(rotated.stashedRot - (-7.3)) < 0.01, 'stashed ' + rotated.stashedRot);
check('the published aerial carries that same rotation',
  !!rotated.rotAttr && Math.abs(parseFloat(rotated.rotAttr) - (-7.3)) < 0.01,
  rotated.rotAttr || 'no rotate on the <image>');
check('…turned about the photo\'s own centre, as the canvas turns it',
  /(-?[\d.]+)\s+1200\s+1000/.test(rotated.rotAttr || ''), rotated.rotAttr);
check('the roofs themselves are not rotated',
  Array.isArray(rotated.firstRoofPt), JSON.stringify(rotated.firstRoofPt));

// A rotated publish frames the canvas, same as an unrotated one — the turn is
// applied to the photo, not to the crop.
const rotFrame = await pg.evaluate(() => {
  const gm = S.quote.roofMapGeom;
  const p = (_qpRoofMapSvg({ showBg:true, maxH:300 }).match(/viewBox="([^"]+)"/)||[])[1]
              .split(/\s+/).map(Number);
  return { frame:[p[2], p[3]], view:[gm.view.w, gm.view.h] };
});
check('a rotated publish frames the canvas view, not a widened one',
  Math.abs(rotFrame.frame[0] - rotFrame.view[0]) < 0.05 &&
  Math.abs(rotFrame.frame[1] - rotFrame.view[1]) < 0.05,
  JSON.stringify(rotFrame));

// Square again → no transform at all, rather than rotate(0).
const unrot = await pg.evaluate(() => {
  _setFineRotate(0); _qpStashRoofGeom(true);
  const img = (_qpRoofMapSvg({ showBg:true, maxH:300 }).match(/<image[^>]*>/) || [''])[0];
  return { rot: S.quote.roofMapGeom.rot, hasTransform: /transform=/.test(img) };
});
check('a square photo publishes with no rotation at all',
  unrot.rot === 0 && !unrot.hasTransform, JSON.stringify(unrot));

// ── THE CHECK THAT ACTUALLY CATCHES THIS ───────────────────────────
// Everything above compares the published view against a rectangle computed
// with the SAME expression the implementation uses, so it asserts the code
// equals itself. It passed for three builds while the quote map was visibly
// wrong.
//
// This measures something the implementation never computes: what FRACTION of
// each picture the roofs fill. If the two pictures are the same picture, the
// roofs occupy the same share of both — whatever the zoom, and whatever
// arithmetic either side does to get there.
async function fillFractions(zoom, ox, oy, rot){
  return pg.evaluate(([z, x, y, r]) => {
    DRAW.zoom = z; IMG_OFFSET.x = x; IMG_OFFSET.y = y;
    if (typeof _setFineRotate === 'function') _setFineRotate(r || 0);
    redrawAll();
    // Where the roofs sit ON THE CANVAS, through the app's own mapping.
    const t = getImgTransform(), cv = document.getElementById('roofCanvas');
    const dpr = window.devicePixelRatio || 1;
    let a0=1e9,b0=1e9,a1=-1e9,b1=-1e9;
    const eat = p => { const q = imgToCanvas(p, t);
      a0=Math.min(a0,q[0]); a1=Math.max(a1,q[0]); b0=Math.min(b0,q[1]); b1=Math.max(b1,q[1]); };
    (DRAW.roofs && DRAW.roofs.length ? DRAW.roofs : [{outline:DRAW.outline}])
      .forEach(rr => ((rr.outline)||[]).forEach(eat));
    const canvas = { w:(a1-a0)/(cv.width/dpr), h:(b1-b0)/(cv.height/dpr) };
    // And where they sit in the PUBLISHED picture.
    _qpStashRoofGeom(true);
    const gm = S.quote.roofMapGeom;
    const vb = (_qpRoofMapSvg({showBg:true, maxH:300}).match(/viewBox="([^"]+)"/)||[])[1]
                 .split(/\s+/).map(Number);
    let c0=1e9,d0=1e9,c1=-1e9,d1=-1e9;
    (gm.roofs||[]).forEach(rr => (rr.pts||[]).forEach(p => {
      c0=Math.min(c0,p[0]); c1=Math.max(c1,p[0]); d0=Math.min(d0,p[1]); d1=Math.max(d1,p[1]); }));
    const quote = { w:(c1-c0)/vb[2], h:(d1-d0)/vb[3] };
    return { canvas, quote, vb, view: gm.view };
  }, [zoom, ox, oy, rot]);
}
const shots = [
  { name: 'the whole property in shot', z: 1.0, x: 0, y: 0, r: 0 },
  { name: 'zoomed to 310%, as reported', z: 3.1, x: 0, y: 0, r: 0 },
  { name: 'zoomed in and panned off-centre', z: 2.4, x: -180, y: 120, r: 0 },
  { name: 'zoomed in and turned', z: 3.1, x: -60, y: 40, r: -12.5 },
];
for (const sh of shots){
  const f = await fillFractions(sh.z, sh.x, sh.y, sh.r);
  check(sh.name + ': the roofs fill the same share of both pictures',
    Math.abs(f.canvas.w - f.quote.w) < 0.02 && Math.abs(f.canvas.h - f.quote.h) < 0.02,
    'canvas ' + (f.canvas.w*100).toFixed(1) + '×' + (f.canvas.h*100).toFixed(1) + '%' +
    ' vs quote ' + (f.quote.w*100).toFixed(1) + '×' + (f.quote.h*100).toFixed(1) + '%');
}
// And the frame IS the view, with nothing added to it.
const exact = await fillFractions(3.1, 0, 0, 0);
check('the published frame is the captured view, not a widened one',
  Math.abs(exact.vb[2] - exact.view.w) < 0.05 && Math.abs(exact.vb[3] - exact.view.h) < 0.05,
  'frame ' + exact.vb[2].toFixed(1) + '×' + exact.vb[3].toFixed(1) +
  ' vs view ' + exact.view.w.toFixed(1) + '×' + exact.view.h.toFixed(1));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
