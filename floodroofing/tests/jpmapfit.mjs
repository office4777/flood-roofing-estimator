// THE JOB PACK'S MAP IS FRAMED FOR THE PAGE (2026-11-13, the owner: "I was too
// zoomed in on the map roof tab that in the job pack the detailed roof map was
// falling off the page ... it should always fit the detailed map to the size of
// the page. Without cutting any of it off"). The capture redrew the live canvas
// at the office's zoom, so a roof running past the canvas edge was cut off.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);

// His T roof, wider than it is tall the way it sits.
const OUT = [[1072,541],[1072,628],[1177,628],[1177,778],[1269,778],[1269,628],[1300,628],[1300,467],[1188,467],[1188,541]];
await pg.evaluate((o) => {
  ['setupWizard', '_rsModal', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0885445205014095; DRAW.calPitch = 15;
  DRAW.outline = o.map(p => p.slice()); DRAW.outlineDone = true;
  autoGenerateRoof('hip'); setTool('select'); fitDrawingToCanvas();
}, OUT);
// Measure a captured picture: its size, and how much ink touches each edge.
const shot = (zoom, off) => pg.evaluate(async ([zoom, off]) => {
  if (zoom){ DRAW.zoom = zoom; IMG_OFFSET.x = off[0]; IMG_OFFSET.y = off[1]; redrawAll(); }
  const before = { z: DRAW.zoom, x: IMG_OFFSET.x, y: IMG_OFFSET.y };
  const src = _jpCaptureDetailed(-1, {});
  const im = new Image(); await new Promise(r => { im.onload = r; im.onerror = r; im.src = typeof src === 'string' ? src : src.toDataURL(); });
  const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  // Purple outline ink: how far does the drawn roof reach, in each direction?
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2){
    const i = (y * cv.width + x) * 4, r = d[i], g = d[i+1], bb = d[i+2];
    if (bb > 150 && r > 90 && r < 200 && g < 110){ if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const after = { z: DRAW.zoom, x: IMG_OFFSET.x, y: IMG_OFFSET.y };
  return { w: cv.width, h: cv.height, ink: [minX, minY, maxX, maxY], aspect: (maxX - minX) / Math.max(1, maxY - minY), before, after };
}, [zoom, off]);

const fit = await shot();
const roofAspect = (1300 - 1072) / (778 - 467);
check('fitted on Map Roof: the picture is the whole roof', Math.abs(fit.aspect - roofAspect) < 0.08, JSON.stringify({ fit, roofAspect }));
// Zoomed right in on one corner of it, the way the office left it.
const zoomed = await pg.evaluate(() => { const t = getImgTransform(); return { z: DRAW.zoom * 5 }; });
const z = await shot(zoomed.z, [-900, -700]);
check('zoomed in 5× on a corner: the pack\'s map is still the whole roof, nothing cut off', Math.abs(z.aspect - roofAspect) < 0.08 && z.ink[0] > 4 && z.ink[1] > 4 && z.ink[2] < z.w - 4 && z.ink[3] < z.h - 4, JSON.stringify({ z, roofAspect }));
check('…and the office\'s own zoom and pan are put back', z.before.z === z.after.z && z.before.x === z.after.x && z.before.y === z.after.y, JSON.stringify(z));
const out = await shot(0.05, [0, 0]);
check('zoomed right out: the roof is still captured whole and not tiny', Math.abs(out.aspect - roofAspect) < 0.08 && (out.ink[2] - out.ink[0]) > 300, JSON.stringify(out));

check('nothing threw', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
