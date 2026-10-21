// THE CUSTOMER'S PDF — the crossed-out roof and the page breaks.
//
// (1) FEEDBACK REPORT 66, 2026-10-19: "quotes red cross is confusing, it
//     crosses out part of the main roof which looks wrong, it should be a
//     smaller cross in the middle of roof 2 keeping within the lines." The
//     cross was drawn corner to corner of the excluded roof's BOUNDING BOX,
//     so on a garage sitting against a house its arms ran straight over the
//     house. It is the tick's counterpart now: the same size, the same place
//     above the roof's own label, and never wider than the roof it is on.
//
// (2) THE PDF ITSELF, from the same message ("also fix the pdf print still
//     not looking great"), against quote 3305, which showed three faults:
//     the page number stamped at 292mm on top of a slice image that ran the
//     full 297; a gutter option row sliced in half at a page break; and a
//     blank fifth page carrying one stray border line.
//
// The slicer is pinned here directly rather than through a rendered quote:
// jsPDF and html2canvas come from a CDN the test environment cannot reach,
// and the thing worth pinning is the arithmetic — where the cuts land, what
// the image is allowed to cover, and when a trailing sheet is dropped.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = process.env.FR_FRONTEND_DIR || _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/cdn.jsdelivr.net/**', r => r.abort());
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

// ── (1) THE CROSS ────────────────────────────────────────────────────
// A house with a garage hard against its right-hand wall — the shape that
// made report 66. The garage is "separate" and nothing is selected, so the
// customer's map draws it crossed out.
const cross = await pg.evaluate(() => {
  S.quote = S.quote || {};
  S.quote.proposalOptions = { extraRoofsSel: {} };
  S.quote.extraRoofs = [{ name:'Roof 2', price: 6400 }];
  S.quote.roofMapGeom = { bbox:{ minX:0, minY:0, maxX:300, maxY:200 }, rot:0, roofs:[
    { idx:0, name:'Main Roof', area:128.5, mode:'main', extraPos:null, gutterLm:48,
      pts:[[20,60],[160,60],[160,150],[20,150]], lines:[], gutters:[] },
    { idx:1, name:'Roof 2', area:42, mode:'separate', extraPos:0, gutterLm:16,
      pts:[[160,70],[230,70],[230,140],[160,140]], lines:[], gutters:[] } ] };
  const svg = _qpRoofMapSvg({ sel:{}, showBg:false, maxH:300, readOnly:true });
  // Every point of every cross path, in viewBox units.
  const pts = [];
  const g = svg.slice(svg.indexOf('data-roof-cross'));
  (g.match(/[ML]-?[\d.]+,-?[\d.]+/g) || []).forEach(m => {
    const [x, y] = m.slice(1).split(',').map(Number); pts.push([x, y]);
  });
  return { n: (svg.match(/data-roof-cross/g) || []).length, pts,
           hasTick: /#16a34a/.test(svg), svgLen: svg.length };
});
const xs = cross.pts.map(p => p[0]), ys = cross.pts.map(p => p[1]);
const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
check('one cross, on the one roof that is not included', cross.n === 1, JSON.stringify(cross.n));
check('the cross stays inside Roof 2 — never over the main roof',
  cross.pts.length >= 4 && box.minX >= 160 && box.maxX <= 230 && box.minY >= 70 && box.maxY <= 140,
  JSON.stringify(box));
check('…and is small: under a third of the roof it is on',
  cross.pts.length >= 4 && (box.maxX - box.minX) <= 70 * 0.4 && (box.maxY - box.minY) <= 70 * 0.4,
  JSON.stringify({ w: +(box.maxX - box.minX).toFixed(1), h: +(box.maxY - box.minY).toFixed(1) }));
check('the included roof still gets its green tick', cross.hasTick);

// A long thin roof: the cross must shrink with it rather than spill out.
const thin = await pg.evaluate(() => {
  S.quote.roofMapGeom.roofs[1].pts = [[160,95],[280,95],[280,118],[160,118]];
  const svg = _qpRoofMapSvg({ sel:{}, showBg:false, maxH:300, readOnly:true });
  const g = svg.slice(svg.indexOf('data-roof-cross'));
  const pts = (g.match(/[ML]-?[\d.]+,-?[\d.]+/g) || []).map(m => m.slice(1).split(',').map(Number));
  return pts;
});
const ty = thin.map(p => p[1]);
check('on a long thin roof the cross shrinks to fit its narrow way',
  thin.length > 0 && (Math.max(...ty) - Math.min(...ty)) <= 23,
  JSON.stringify({ h: +(Math.max(...ty) - Math.min(...ty)).toFixed(1) }));

// ── (2) THE SLICER ───────────────────────────────────────────────────
// A tall capture made of plain bands, cut up by the real function with a
// recording stand-in for jsPDF. 2200 px wide = 210 mm, so 1 mm is 10.476 px.
const slice = await pg.evaluate(() => {
  function mkCanvas(h, inkBands){
    const c = document.createElement('canvas');
    c.width = 2200; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, h);
    x.fillStyle = '#334';
    inkBands.forEach(([a, bb]) => x.fillRect(0, a, c.width, bb - a));
    return c;
  }
  function stub(){
    const hs = [], out = { pages: 1, hs };
    return { addPage(){ out.pages++; }, addImage(d, f, x, y, w, h){ hs.push(h); out.y = y; },
             _out: out };
  }
  const run = (canvas, opts) => {
    const p = stub();
    _pdfAddSlicedCanvas(p, canvas, 210, 297, opts);
    return { pages: p._out.pages, mm: p._out.hs.map(v => +v.toFixed(2)), y: p._out.y };
  };
  const out = {};
  // Solid ink, four full 297 mm sheets' worth: reserving a 9 mm foot must
  // cost a fifth sheet rather than crop the bottom of each one.
  const solid = mkCanvas(12300, [[0, 12300]]);
  out.noFoot = run(solid, {});
  out.foot = run(solid, { footMm: 9 });

  // Boundaries: ink bands with clean gaps, and a break list naming them.
  // The deepest section break inside the window must win.
  const H = 9000;
  const bands = [[0, 2600], [2650, 5400], [5450, 8990]];
  const doc = mkCanvas(H, bands);
  out.plain = run(doc, { footMm: 9 });
  out.withSec = run(doc, { footMm: 9, breaks: { sec: [2620, 5420], row: [] } });

  // A DRAWING IS NEVER SLICED (2026-10-21): a `keep` span the cut would land
  // inside pulls the cut back to the span's top. Solid ink, so the ink
  // search finds nothing and the hard step is what the span has to beat.
  const solid7 = mkCanvas(7000, [[0, 7000]]);
  out.keepOff = run(solid7, { footMm: 9 });
  out.keepOn  = run(solid7, { footMm: 9, breaks: { sec: [], row: [], keep: [[2900, 3400]] } });
  // A span taller than a sheet cannot be kept whole, so it is left alone
  // rather than pulling the cut back to a place that makes no progress.
  out.keepHuge = run(solid7, { footMm: 9, breaks: { sec: [], row: [], keep: [[200, 6800]] } });

  // A trailing sheet carrying one stray rule and nothing else is dropped.
  const tail = mkCanvas(6400, [[0, 6000], [6180, 6184]]);
  out.tail = run(tail, { footMm: 9 });
  out.tailKept = run(mkCanvas(6400, [[0, 6000], [6180, 6390]]), { footMm: 9 });
  return out;
});
const MM = 2200 / 210;          // px per mm
check('with no footer asked for, a sheet is filled to the full 297 mm',
  slice.noFoot.mm.slice(0, -1).every(v => Math.abs(v - 297) < 0.5),
  JSON.stringify(slice.noFoot.mm.slice(0, 3)));
check('a 9 mm foot is reserved on EVERY sheet, so a page number cannot land on the quote',
  slice.foot.mm.every(v => v <= 288.01) && Math.abs(slice.foot.mm[0] - 288) < 0.5 && slice.foot.y === 0,
  JSON.stringify(slice.foot.mm.slice(0, 3)));
check('…and reserving it costs sheets rather than cropping the content',
  slice.foot.pages > slice.noFoot.pages, JSON.stringify({ noFoot: slice.noFoot.pages, foot: slice.foot.pages }));
check('a named section boundary is where the cut goes',
  Math.abs(slice.withSec.mm[0] * MM - 2620) < 2,
  JSON.stringify({ cutPx: +(slice.withSec.mm[0] * MM).toFixed(0), want: 2620 }));
check('…and the second sheet breaks at the next one, not at the hard step',
  Math.abs((slice.withSec.mm[0] + slice.withSec.mm[1]) * MM - 5420) < 2,
  JSON.stringify({ cutPx: +((slice.withSec.mm[0] + slice.withSec.mm[1]) * MM).toFixed(0), want: 5420 }));
check('A DRAWING IS NEVER SLICED: the cut is pulled back to the top of its span',
  Math.abs(slice.keepOff.mm[0] * MM - 3017) < 3 &&
  Math.abs(slice.keepOn.mm[0] * MM - 2900) < 3,
  JSON.stringify({ off: +(slice.keepOff.mm[0] * MM).toFixed(0),
                   on: +(slice.keepOn.mm[0] * MM).toFixed(0) }));
check('...a span taller than a sheet is left alone, or the cut makes no progress',
  Math.abs(slice.keepHuge.mm[0] * MM - 3017) < 3,
  JSON.stringify({ px: +(slice.keepHuge.mm[0] * MM).toFixed(0) }));
check('a final sheet with nothing on it but a stray rule is dropped',
  slice.tail.pages === 2, JSON.stringify(slice.tail));
check('…but a final sheet with real content on it is kept',
  slice.tailKept.pages === 3, JSON.stringify(slice.tailKept));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(r => !r).length;
console.log((bad ? 'FAIL' : 'PASS') + '  ' + (results.length - bad) + '/' + results.length);
process.exit(bad ? 1 : 0);
