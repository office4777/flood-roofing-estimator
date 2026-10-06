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

// A 256×256 RGBA PNG of one colour, made here so the suite needs no image
// files. It was 1×1 for a year, which read the same to the eye and was no
// good for MEASURING: blowing a single pixel up to a whole tile leaves the
// rasteriser nothing to resample, and the seams then land on a 64-pixel grid
// instead of where the stitcher put them — which is what made the sample at
// +900 a standing one-in-twelve mismatch and would have hidden the
// half-scale fault of reports 7 and 8. A real tile's worth of pixels lands
// where it is put, to within a pixel.
const TILE = 256;
function png(r, g, b, a){
  const crcT = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(TILE, 0); ihdr.writeUInt32BE(TILE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const line = Buffer.concat([Buffer.from([0]), Buffer.alloc(TILE * 4).fill(Buffer.from([r, g, b, a]))]);
  const raw = Buffer.concat(new Array(TILE).fill(line));
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
  first: [...document.getElementById('imagerySource').options].filter(o => !o.hidden)[0].textContent, now: _linzKeyNow() }));
check('with the platform’s LINZ key the finder opens on LINZ, listed first', def.key === 'platform-key' && def.sel === 'linz' && /LINZ/.test(def.first) && def.now === 'platform-key', JSON.stringify(def));

// "Use this view" over Hamilton (12A Empire Street), the map box 800×400, the
// same set-up the Mapbox capture test uses.
const LAT = -37.7851, LNG = 175.2624;
// ── the picture's geometry, worked out here so the samples can avoid the
// tile seams ──────────────────────────────────────────────────────────
// The Mapbox picture's own zoom for this box: 19.37 + log2(1.6) − log2(2) =
// 19.05 (Mapbox's 512px-tile scale). Mapbox serves 512px tiles, so its z is
// 256-tile zoom z+1 — and the picture is asked for @2x, which puts twice as
// many pixels over the same ground, so it is z+2 = 21.05: whole-zoom tiles at
// 21, drawn at 2^0.05.
// It was 20 until 6 October 2026 (feedback reports 7 and 8): the picture then
// covered twice the ground per pixel that the scale recorded beside it
// claimed, and every length a roofer measured off a LINZ aerial read HALF its
// true size. This suite agreed with the fault, because it reasoned in CSS
// pixels too; it measures the picture now (the period check below).
const ZT = 21, ZPIC = 21.05;
const n = 256 * Math.pow(2, ZT);
const k = Math.pow(2, ZPIC - ZT);          // picture pixels per tile pixel
const wx0 = (LNG + 180) / 360 * n;
const wy0 = (1 - Math.log(Math.tan(LAT * Math.PI / 180) + 1 / Math.cos(LAT * Math.PI / 180)) / Math.PI) / 2 * n;
// A picture offset (dx, dy) from the centre, in world tile pixels, for a
// bearing — the same rotation the stitcher applies.
const world = (dx, dy, bearing) => {
  const th = (bearing || 0) * Math.PI / 180;
  return [wx0 + (dx * Math.cos(th) - dy * Math.sin(th)) / k, wy0 + (dx * Math.sin(th) + dy * Math.cos(th)) / k];
};
const colourAt = (wx, wy) => ((Math.floor(wx / 256) + Math.floor(wy / 256)) % 2) ? 'blue' : 'red';
// How far a world pixel sits from the nearest tile edge, in PICTURE pixels.
const edgeGap = (w) => { const f = ((w % 256) + 256) % 256; return Math.min(f, 256 - f) * k; };
// Which row to read. The tiles' 0.6px overlap and the JPEG's chroma blur make
// the colour a coin toss within ~20 picture pixels of a seam, and the centre
// row of this very picture happens to sit 6 pixels off one — which is what
// made the sample at +900 a long-standing one-in-twelve mismatch. Pick a row
// that is well clear instead.
let DY = 0;
for (let d = 0; d <= 200; d++){ if (edgeGap(wy0 + d / k) >= 24){ DY = d; break; } }

async function capture(bearing){
  return pg.evaluate(async ({ LAT, LNG, bearing, DY }) => {
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
      const at = (X, Y) => { const q = x.getImageData(X, Y, 1, 1).data;
        return q[0] - q[2] > 60 ? 'red' : (q[2] - q[0] > 60 ? 'blue' : 'seam'); };
      const Y = Math.round(c.height / 2 + DY);
      px = { centre: at(c.width / 2, Y), right: [120, 150, 210, 300, 360, 450, 510, 600, 690, 750, 840, 900].map(o => at(c.width / 2 + o, Y)) };
      // The tiles alternate colour every 256 tile pixels, so the distance
      // between colour changes along one row IS 256 tile pixels' worth of
      // picture — which says what a picture pixel covers on the ground
      // without trusting a line of the stitcher's own arithmetic.
      const row = x.getImageData(0, Y, c.width, 1).data;
      // A seam is not a clean red-to-blue step: the stub tiles are 1×1 PNGs
      // blown up to 256.6px, the 0.6px overlap leaves a hairline, the dark
      // backfill shows through it and the JPEG smears the lot. So classify
      // only pixels that are DEFINITELY one colour and put each edge at the
      // middle of the muddle between two confirmed runs — otherwise every
      // seam reads as a cluster of false edges and the period comes out wrong.
      const cls = [];
      for (let p = 0; p < c.width; p++){
        const r = row[p * 4], bl = row[p * 4 + 2];
        cls.push(r - bl > 60 ? 'r' : (bl - r > 60 ? 'b' : '?'));
      }
      const edges = [];
      let last = -1, lastC = '';
      for (let p = 0; p < cls.length; p++){
        if (cls[p] === '?') continue;
        if (lastC && cls[p] !== lastC) edges.push((last + p) / 2);
        last = p; lastC = cls[p];
      }
      px.period = edges.length > 3 ? (edges[edges.length - 1] - edges[0]) / (edges.length - 1) : 0;
      px.edges = edges.map(e => Math.round(e * 10) / 10);
    }
    return { w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0, scale: DRAW.scaleMetresPerPx, mapboxAsked, credit, px };
  }, { LAT, LNG, bearing, DY });
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
const tx = Math.floor(wx0 / 256), ty = Math.floor(wy0 / 256);
check('"Use this view" asks LINZ for real tiles around the roof at a whole zoom — not the old tile at x=0, y=0',
  zs.length === 1 && zs[0] === String(ZT) && xy.length > 20 && xy.every(([x, y]) => Math.abs(x - tx) <= 16 && Math.abs(y - ty) <= 10) && !tileUrls.some(u => /\/0\/0\.webp/.test(u)) && tileUrls.every(u => /api=platform-key/.test(u)),
  JSON.stringify({ zs, n: xy.length, tx, ty, sample: xy.slice(0, 3) }));
const want = 78271.51696 * Math.cos(LAT * Math.PI / 180) / Math.pow(2, 19.05) / 2;
check('…stitched into the Mapbox capture’s exact picture (2560×1280), so the scale is the same metres per IMAGE pixel',
  got.w === 2560 && got.h === 1280 && Math.abs(got.scale - want) < 1e-9 && !got.mapboxAsked, JSON.stringify({ w: got.w, h: got.h, scale: got.scale, want }));
// REPORTS 7 AND 8 (6 October 2026). The scale beside the picture is only
// worth anything if the picture really is that fine. The tile parity says
// what it is, in the picture's own pixels, and it has to be the scale the
// app recorded — not twice it.
const tilePxM = 156543.03392 * Math.cos(LAT * Math.PI / 180) / Math.pow(2, ZT);
const realScale = got.px && got.px.period ? tilePxM * 256 / got.px.period : 0;
check('…and the picture is as fine as the scale says it is: one picture pixel really is that many metres of ground',
  realScale > 0 && Math.abs(realScale / got.scale - 1) < 0.005,
  JSON.stringify({ measured: +realScale.toFixed(6), recorded: +got.scale.toFixed(6),
    factor: +(realScale / (got.scale || 1)).toFixed(4), period: got.px && got.px.period }));
// …and every tile has to sit square against its neighbours. A canvas matrix
// is kept in 32-bit floats and world pixels at tile zoom 21 are around
// 5×10^8, where a float's steps are 64 whole pixels: handing the transform
// those numbers rounded every tile onto a 64-pixel grid and left it up to
// 32 pixels — about 2 m of ground — out of line with the tile beside it.
// The seams were 256 and 320 apart instead of all 265. Evenly spaced seams
// are the proof that nothing is being rounded.
const gaps = (got.px.edges || []).slice(1).map((e, i) => e - got.px.edges[i]);
const drift = gaps.length ? Math.max.apply(null, gaps.map(g => Math.abs(g - got.px.period))) : 999;
check('…and each tile lands square against the next: the seams are evenly spaced, nothing rounded onto a grid',
  gaps.length >= 6 && drift <= 2, JSON.stringify({ period: +got.px.period.toFixed(2), drift: +drift.toFixed(2), gaps }));
check('…with the LINZ CC BY credit stamped in the corner', got.credit);
// Where things land: the tiles alternate red/blue by (x + y) parity, so the
// colour under a picture pixel says which tile — and so which ground — is there.
const ALL = [120, 150, 210, 300, 360, 450, 510, 600, 690, 750, 840, 900];
// Only points well inside a tile, in BOTH directions, at whichever bearing
// is being read — near a seam the colour is a coin toss.
const keepFor = (bearing) => ALL.map((o, i) => {
  const w = world(o, DY, bearing);
  return (edgeGap(w[0]) >= 24 && edgeGap(w[1]) >= 24) ? i : -1;
}).filter(i => i >= 0);
const wantFor = (bearing, keep) => {
  const c = world(0, DY, bearing);
  return { centre: colourAt(c[0], c[1]),
    right: keep.map(i => { const w = world(ALL[i], DY, bearing); return colourAt(w[0], w[1]); }).join(',') };
};
const pickPx = (px, keep) => px && { centre: px.centre, right: keep.map(i => px.right[i]).join(',') };
const K0 = keepFor(0), want0 = wantFor(0, K0);
check('…the roof lands where the map showed it: the centre and a point to its right sit on the right ground', K0.length >= 6 && JSON.stringify(pickPx(got.px, K0)) === JSON.stringify(want0), JSON.stringify({ got: pickPx(got.px, K0), want: want0, n: K0.length, DY }));
tileUrls.length = 0;
const turned = await capture(90);
// Bearing 90: east is up, so the picture's right is SOUTH of the centre.
const K90 = keepFor(90), want90 = wantFor(90, K90);
check('…and a turned map (bearing 90°) turns the picture the same way (east up: the picture’s right is south)', K90.length >= 6 && want90.right !== want0.right && JSON.stringify(pickPx(turned.px, K90)) === JSON.stringify(want90), JSON.stringify({ got: pickPx(turned.px, K90), want: want90 }));

tileMode = 'clear'; tileUrls.length = 0;
const clear = await capture();
// One level back before giving up on LINZ: since the stitcher started asking
// for the zoom it should always have asked for (21 here, not 20), it can
// reach a zoom LINZ has not got everywhere. k takes up the difference, so a
// shallower tile zoom is the same ground at the same scale, only softer —
// far better than dropping a rural roof to Mapbox.
const clearZs = [...new Set(tileUrls.map(u => (/WebMercatorQuad\/(\d+)\//.exec(u) || [])[1]))].filter(z => +z >= 17);
check('empty tiles at the deep zoom are tried again one level back before LINZ is given up on',
  clearZs.includes('21') && clearZs.includes('20'), JSON.stringify(clearZs));
check('where LINZ has no cover at all it falls back to the Mapbox picture', !!clear.mapboxAsked && /satellite-streets-v12\/static/.test(clear.mapboxAsked), String(clear.mapboxAsked).slice(0, 90));
tileMode = '404'; tileUrls.length = 0;
const fail = await capture();
check('…and so it does when LINZ’s tiles fail', !!fail.mapboxAsked, String(fail.mapboxAsked).slice(0, 90));

// A roofer's own pick is remembered over the default.
const pick = await pg.evaluate(() => { switchImagerySource('mapbox'); document.getElementById('imagerySource').value = 'linz'; _imageryDefaultApply(); return document.getElementById('imagerySource').value; });
check('a source picked by hand is kept over the LINZ default', pick === 'mapbox', pick);

// "the apps 'get free key' link doesn't take me to the correct page" — the
// old linz.govt.nz address was taken down; Basemaps itself hands out a key.
const keyLink = await pg.evaluate(() => (document.querySelector('#linzKeyWrap a') || {}).href || '');
check('the "Get free key" link goes to LINZ Basemaps, where the key is', /^https:\/\/basemaps\.linz\.govt\.nz\/?$/.test(keyLink), keyLink);

// Nearmap is built but SWITCHED OFF until the privacy policy names it (30
// days' notice for a new provider): even with a key saved, nothing offers it
// and nothing reaches Nearmap.
const nmOff = await pg.evaluate(async () => {
  S.settings = S.settings || {}; S.settings.jms_keys = Object.assign({}, S.settings.jms_keys || {}, { nearmap: 'someones-key' });
  let hit = false; const realFetch = window.fetch;
  window.fetch = (u, o) => { if (/nearmap\.com/.test(String(u))) hit = true; return realFetch(u, o); };
  gotoTab('roof'); _openAerialModal(); await new Promise(r => setTimeout(r, 300)); _imageryDefaultApply();
  const opt = document.getElementById('imgSrcNearmap');
  const out = { on: NEARMAP_ON, key: _nearmapKeyNow(), offered: !(opt.hidden && opt.disabled), sel: document.getElementById('imagerySource').value };
  _closeAerialModal(); try { refreshSettingsUI(); } catch(e){}
  out.row = getComputedStyle(document.getElementById('setNearmapRow')).display;
  window.fetch = realFetch; out.hit = hit;
  S.settings.jms_keys.nearmap = '';
  return out;
});
check('Nearmap stays switched off until the policy names it: not offered, no Settings row, nothing sent to Nearmap',
  nmOff.on === false && nmOff.key === '' && !nmOff.offered && nmOff.sel !== 'nearmap' && nmOff.row === 'none' && !nmOff.hit, JSON.stringify(nmOff));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
