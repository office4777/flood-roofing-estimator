// The owner, 2026-09-24, beside a Google Earth screenshot of the same roof:
// "look at the difference between google earth and mapbox, how can we get the
// google earth quality?" Google's tile terms forbid tracing buildings off its
// imagery, so the answer is LINZ Basemaps — NZ's own aerial photography, which
// is what Google Earth shows for most of NZ, free under CC BY 4.0.
//
// Pinned: with the platform's key from /imagery-config the finder opens on
// LINZ; "Use this view" stitches real LINZ tiles (the old code asked for one
// tile at x=0, y=0 — the wrong side of the planet) into a picture with the
// Mapbox capture's exact geometry, so the scale (metres per IMAGE pixel) is
// the same formula; the CC BY credit is stamped into the picture; and no
// LINZ cover or failing tiles fall back to Mapbox.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import zlib from 'node:zlib';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// A 1×1 RGBA PNG, made here so the suite needs no image files.
function png(r, g, b, a){
  const crcT = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, r, g, b, a]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RED = png(200, 30, 30, 255), BLUE = png(30, 30, 200, 255), CLEAR = png(0, 0, 0, 0);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
let tileMode = 'ok';
const tileUrls = [];
await pg.route('**/basemaps.linz.govt.nz/**', r => {
  const u = r.request().url(); tileUrls.push(u);
  if (tileMode === '404') return r.fulfill({ status: 404, body: 'no' });
  const m = /WebMercatorQuad\/(\d+)\/(\d+)\/(\d+)\.webp/.exec(u);
  const body = tileMode === 'clear' ? CLEAR : ((m && (+m[2] + +m[3]) % 2) ? BLUE : RED);
  return r.fulfill({ status: 200, contentType: 'image/png', body, headers: { 'Access-Control-Allow-Origin': '*' } });
});
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/imagery-config/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ linzKey: 'platform-key' }) });
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// Nothing is asked of the server until the finder opens.
const early = await pg.evaluate(() => window._linzPlatformKey === undefined && !window._imageryCfgP);
check('the imagery key is not fetched on page load', early);
await pg.evaluate(() => { gotoTab('roof'); _openAerialModal(); });
await pg.waitForTimeout(600);
const def = await pg.evaluate(() => ({ key: window._linzPlatformKey, sel: document.getElementById('imagerySource').value,
  first: document.getElementById('imagerySource').options[0].textContent, now: _linzKeyNow() }));
check('with the platform’s LINZ key the finder opens on LINZ, listed first', def.key === 'platform-key' && def.sel === 'linz' && /LINZ/.test(def.first) && def.now === 'platform-key', JSON.stringify(def));

// "Use this view" over Hamilton (12A Empire Street), the map box 800×400, the
// same set-up the Mapbox capture test uses.
const LAT = -37.7851, LNG = 175.2624;
async function capture(bearing){
  return pg.evaluate(async ({ LAT, LNG, bearing }) => {
    gotoTab('roof');
    _openAerialModal();
    const mapEl = document.getElementById('aerialLeafletMap2');
    mapEl.style.width = '800px'; mapEl.style.height = '400px';
    window._aerialMap = { getCenter: () => ({ lat: LAT, lng: LNG }), getZoom: () => 19.37, getBearing: () => bearing || 0 };
    document.getElementById('imagerySource').value = 'linz';
    let mapboxAsked = null;
    const realFetch = window.fetch;
    window.fetch = (u, o) => { if (/api\.mapbox\.com\/styles/.test(String(u))) { mapboxAsked = String(u); return Promise.reject(new Error('stub')); } return realFetch(u, o); };
    DRAW.bgImg = null;
    captureFromMapbox(LAT, LNG, 19);
    for (let i = 0; i < 80 && !DRAW.bgImg && !mapboxAsked; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    window.fetch = realFetch; window._aerialMap = null; try { _closeAerialModal(); } catch(e){}
    const img = DRAW.bgImg;
    let credit = false, px = null;
    if (img){
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(c.width - 220, c.height - 30, 220, 30).data;
      for (let p = 0; p < d.length; p += 4) if (d[p] > 200 && d[p + 1] > 200 && d[p + 2] > 200){ credit = true; break; }
      const at = (X, Y) => { const q = x.getImageData(X, Y, 1, 1).data; return q[0] > q[2] ? 'red' : 'blue'; };
      px = { centre: at(c.width / 2, c.height / 2), right: [120, 150, 210, 300, 360, 450, 510, 600, 690, 750, 840, 900].map(o => at(c.width / 2 + o, c.height / 2)) };
    }
    return { w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0, scale: DRAW.scaleMetresPerPx, mapboxAsked, credit, px };
  }, { LAT, LNG, bearing });
}
// The live finder map (opened above) asks for its own LINZ tiles at the
// default view — that is the live overlay working; only the capture's count.
const liveTiles = tileUrls.length;
tileUrls.length = 0;
const got = await capture();
// The capture's tiles are the deep ones; the live map (zoom 14 here) may
// still be filling its own view in the background.
const capTiles = tileUrls.filter(u => +((/WebMercatorQuad\/(\d+)\//.exec(u) || [])[1]) >= 17);
const zs = [...new Set(capTiles.map(u => (/WebMercatorQuad\/(\d+)\//.exec(u) || [])[1]))];
const xy = capTiles.map(u => (/WebMercatorQuad\/\d+\/(\d+)\/(\d+)/.exec(u) || []).slice(1).map(Number));
// The Mapbox picture's own zoom for this box: 19.37 + log2(1.6) − log2(2) = 19.05 (512px scale);
// on 256px tiles that is 20.05, so whole-zoom tiles at 20.
const n = 256 * Math.pow(2, 20);
const tx = Math.floor((LNG + 180) / 360 * n / 256);
const ty = Math.floor((1 - Math.log(Math.tan(LAT * Math.PI / 180) + 1 / Math.cos(LAT * Math.PI / 180)) / Math.PI) / 2 * n / 256);
check('"Use this view" asks LINZ for real tiles around the roof at a whole zoom — not the old tile at x=0, y=0',
  zs.length === 1 && zs[0] === '20' && xy.length > 20 && xy.every(([x, y]) => Math.abs(x - tx) <= 8 && Math.abs(y - ty) <= 5) && !tileUrls.some(u => /\/0\/0\.webp/.test(u)) && tileUrls.every(u => /api=platform-key/.test(u)),
  JSON.stringify({ zs, n: xy.length, tx, ty, sample: xy.slice(0, 3) }));
const want = 78271.51696 * Math.cos(LAT * Math.PI / 180) / Math.pow(2, 19.05) / 2;
check('…stitched into the Mapbox capture’s exact picture (2560×1280), so the scale is the same metres per IMAGE pixel',
  got.w === 2560 && got.h === 1280 && Math.abs(got.scale - want) < 1e-9 && !got.mapboxAsked, JSON.stringify({ w: got.w, h: got.h, scale: got.scale, want }));
check('…with the LINZ CC BY credit stamped in the corner', got.credit);
// Where things land: the tiles alternate red/blue by (x + y) parity, so the
// colour under a picture pixel says which tile — and so which ground — is there.
const k = Math.pow(2, 20.05 - 20);
const wx0 = (LNG + 180) / 360 * n, wy0 = (1 - Math.log(Math.tan(LAT * Math.PI / 180) + 1 / Math.cos(LAT * Math.PI / 180)) / Math.PI) / 2 * n;
const colourAt = (wx, wy) => ((Math.floor(wx / 256) + Math.floor(wy / 256)) % 2) ? 'blue' : 'red';
const ALL = [120, 150, 210, 300, 360, 450, 510, 600, 690, 750, 840, 900];
// Only points well inside a tile: at an edge the tiles' 0.6px overlap (it
// stops hairline seams) and the JPEG blur make the colour a coin toss.
const clearOfEdge = (w) => { const f = ((w % 256) + 256) % 256; return Math.min(f, 256 - f) * k >= 4; };
const KEEP = ALL.map((o, i) => (clearOfEdge(wx0 + o / k) && clearOfEdge(wy0 + o / k)) ? i : -1).filter(i => i >= 0);
const OFFS = KEEP.map(i => ALL[i]);
const pickPx = (px) => px && { centre: px.centre, right: KEEP.map(i => px.right[i]).join(',') };
const want0 = { centre: colourAt(wx0, wy0), right: OFFS.map(o => colourAt(wx0 + o / k, wy0)).join(',') };
check('…the roof lands where the map showed it: the centre and a point to its right sit on the right ground', OFFS.length >= 6 && JSON.stringify(pickPx(got.px)) === JSON.stringify(want0), JSON.stringify({ got: pickPx(got.px), want: want0, n: OFFS.length }));
tileUrls.length = 0;
const turned = await capture(90);
// Bearing 90: east is up, so the picture's right is SOUTH of the centre.
const want90 = { centre: colourAt(wx0, wy0), right: OFFS.map(o => colourAt(wx0, wy0 + o / k)).join(',') };
check('…and a turned map (bearing 90°) turns the picture the same way (east up: the picture’s right is south)', want90.right !== want0.right && JSON.stringify(pickPx(turned.px)) === JSON.stringify(want90), JSON.stringify({ got: pickPx(turned.px), want: want90 }));

tileMode = 'clear'; tileUrls.length = 0;
const clear = await capture();
check('where LINZ has no cover (empty tiles) it falls back to the Mapbox picture', !!clear.mapboxAsked && /satellite-streets-v12\/static/.test(clear.mapboxAsked), String(clear.mapboxAsked).slice(0, 90));
tileMode = '404'; tileUrls.length = 0;
const fail = await capture();
check('…and so it does when LINZ’s tiles fail', !!fail.mapboxAsked, String(fail.mapboxAsked).slice(0, 90));

// A roofer's own pick is remembered over the default.
const pick = await pg.evaluate(() => { switchImagerySource('mapbox'); document.getElementById('imagerySource').value = 'linz'; _imageryDefaultApply(); return document.getElementById('imagerySource').value; });
check('a source picked by hand is kept over the LINZ default', pick === 'mapbox', pick);

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
