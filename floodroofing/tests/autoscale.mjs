// The aerial knows its own scale — so the drawing should not start uncalibrated.
//
// A Mapbox aerial arrives at a known latitude and zoom, which fixes exactly how
// many metres one pixel of that picture covers. The app already tried to use
// that, with 156543.03392 * cos(lat) / 2^zoom. Two things were wrong with it:
// Mapbox serves static images on 512px tiles rather than 256, and @2x returns
// twice the pixels for the same ground — so the figure was four times too big
// for a picture pixel. It was then used as metres per DRAWING pixel, which is a
// different thing again, because the picture is scaled to fit the canvas.
//
// On one particular canvas size those errors nearly cancelled and it looked
// about right — roughly 3% out, which is 600mm on a 20m roof. Zoom the
// background and it went 90%+ wrong, because the old figure never changed.
//
// So: work it out from the picture, the canvas and the zoom together, redo it
// whenever the view changes, and never touch it again once the roofer has
// measured something by hand.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const LAT = -35.7251, ZOOM = 19;                       // Northland, a house-sized view
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

const v = await pg.evaluate(async ([lat, zoom]) => {
  const cnv = document.createElement('canvas'); cnv.width = 2560; cnv.height = 2560;  // 1280x1280@2x
  const img = new Image(); img.src = cnv.toDataURL();
  await new Promise(r => { img.onload = r; });
  const cv = document.getElementById('roofCanvas');
  const dpr = window.devicePixelRatio || 1;
  DRAW.bgImg = img; DRAW.zoom = 1;
  _autoScaleFromAerial(lat, zoom, true);
  const W = cv.width / dpr, H = cv.height / dpr;
  const at1 = DRAW.scaleMetresPerPx, auto1 = DRAW.scaleAuto;
  const label1 = (document.getElementById('scaleState') || {}).textContent || '';
  DRAW.zoom = 2; _autoScaleRecompute(); const at2 = DRAW.scaleMetresPerPx;
  DRAW.zoom = 0.5; _autoScaleRecompute(); const atHalf = DRAW.scaleMetresPerPx;
  DRAW.zoom = 1; _autoScaleRecompute();
  // the roofer measures a real wall
  DRAW.scaleMetresPerPx = 0.05; _scaleSetByHand(); _scaleStateShow();
  const labelHand = (document.getElementById('scaleState') || {}).textContent || '';
  DRAW.zoom = 3; _autoScaleRecompute();
  const afterHand = DRAW.scaleMetresPerPx, autoAfter = DRAW.scaleAuto;
  return { W, H, at1, at2, atHalf, auto1, afterHand, autoAfter, label1, labelHand,
           fitted: Math.min(W, H) };
}, [LAT, ZOOM]);

// One picture pixel, from the aerial's own geometry: 512px tiles, halved for @2x.
const perImgPx = 78271.51696 * Math.cos(LAT * Math.PI/180) / Math.pow(2, ZOOM) / 2;

check('an aerial calibrates the drawing without anyone touching Calibrate',
  v.at1 > 0 && v.auto1 === true, v.at1 + ' m/px, auto=' + v.auto1);
check('…and the ground it says the picture covers is the ground it really covers',
  Math.abs(v.at1 * v.fitted - perImgPx * 2560) < 0.5,
  (v.at1 * v.fitted).toFixed(2) + 'm vs ' + (perImgPx * 2560).toFixed(2) + 'm');
check('…so a wall measures the same whatever the canvas happens to be',
  Math.abs(v.at1 - perImgPx * 2560 / v.fitted) < 1e-6);

// The old code stored one number and never revisited it. Zooming the aerial
// changes how much ground a drawing pixel covers, so the scale has to follow.
check('zooming the aerial in halves the metres a drawing pixel covers',
  Math.abs(v.at2 - v.at1/2) < 1e-6, v.at2 + ' vs ' + (v.at1/2));
check('…and zooming out doubles it', Math.abs(v.atHalf - v.at1*2) < 1e-6, v.atHalf + ' vs ' + (v.at1*2));

check('a scale the roofer measured by hand is never overwritten',
  v.afterHand === 0.05 && v.autoAfter === false, v.afterHand + ', auto=' + v.autoAfter);
check('the screen says where the scale came from', /aerial/i.test(v.label1) && /m\/px/.test(v.label1), v.label1);
check('…and says so when the roofer has set it instead', /set by you/i.test(v.labelHand), v.labelHand);
check('the page threw no errors', errs.length === 0, errs.join(' | '));

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
