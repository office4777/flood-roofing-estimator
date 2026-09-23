// The owner, 2026-09-24: "is it possible to use nearmap, but for any other
// areas that nearmap doesn't cover use LINZ" — "yes do this", as a paid
// extra each company switches on with its own Nearmap key.
//
// Pinned: the key lives in Settings → General (jms_keys.nearmap, saved and
// shown); Nearmap is offered — and the default — only to a company with a
// key; "Use this view" asks Nearmap's coverage first and, where Nearmap has
// flown, stitches that survey's tiles into the Mapbox picture's exact
// geometry (same scale) with a dated credit; where it has not flown, or its
// tiles fail, the LINZ aerial is used; and with neither, Mapbox.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import zlib from 'node:zlib';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

function png(r, g, b, a){
  const crcT = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b, a]))), chunk('IEND', Buffer.alloc(0))]);
}
const GREEN = png(30, 180, 60, 255), RED = png(200, 30, 30, 255);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
let nm = { covered: true, tiles: 'ok' }, linzTiles = 'ok';
const asked = { cov: [], nm: [], linz: [] };
await pg.route('**/api.nearmap.com/**', r => {
  const u = r.request().url();
  if (/\/coverage\/v2\/point\//.test(u)){ asked.cov.push(u);
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ surveys: nm.covered ? [{ id: 'sv-2026-03', captureDate: '2026-03-12' }] : [] }) }); }
  asked.nm.push(u);
  if (nm.tiles === '404') return r.fulfill({ status: 404, body: 'no' });
  return r.fulfill({ status: 200, contentType: 'image/png', body: GREEN, headers: { 'Access-Control-Allow-Origin': '*' } });
});
await pg.route('**/basemaps.linz.govt.nz/**', r => {
  asked.linz.push(r.request().url());
  if (linzTiles === '404') return r.fulfill({ status: 404, body: 'no' });
  return r.fulfill({ status: 200, contentType: 'image/png', body: RED, headers: { 'Access-Control-Allow-Origin': '*' } });
});
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  if (/\/imagery-config/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ linzKey: 'platform-key' }) });
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => { window.__NEARMAP_ON = true; localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// ── without a key Nearmap is not offered ──
const noKey = await pg.evaluate(async () => {
  S.settings = S.settings || {}; S.settings.jms_keys = Object.assign({}, S.settings.jms_keys || {}, { nearmap: '' });
  gotoTab('roof'); _openAerialModal(); await new Promise(r => setTimeout(r, 500)); _imageryDefaultApply();
  const o = document.getElementById('imgSrcNearmap');
  const out = { hidden: o.hidden && o.disabled, sel: document.getElementById('imagerySource').value };
  _closeAerialModal(); return out;
});
check('without a company key Nearmap is not offered, and the finder stays on LINZ', noKey.hidden && noKey.sel === 'linz', JSON.stringify(noKey));

// ── the key in Settings → General, saved with the company's keys ──
const set = await pg.evaluate(() => {
  gotoTab('settings'); try { switchSettingsSub('set-general', document.querySelector('button[onclick*="set-general"]')); } catch(e){}
  const el = document.getElementById('intNearmap'); el.value = '  nm-key  ';
  collectSettingsFromUI();
  const saved = S.settings.jms_keys.nearmap;
  el.value = ''; refreshSettingsUI();
  return { saved, shown: document.getElementById('intNearmap').value, onGeneral: !!document.querySelector('#set-general #intNearmap') };
});
check('Settings → General takes the company’s Nearmap key and saves it with its other keys (trimmed), and shows it again', set.onGeneral && set.saved === 'nm-key' && set.shown === 'nm-key', JSON.stringify(set));

const withKey = await pg.evaluate(async () => {
  gotoTab('roof'); _openAerialModal(); await new Promise(r => setTimeout(r, 300)); _imageryDefaultApply();
  const o = document.getElementById('imgSrcNearmap');
  const out = { shown: !o.hidden && !o.disabled, sel: document.getElementById('imagerySource').value };
  _closeAerialModal(); return out;
});
check('with a key Nearmap is offered and is the default', withKey.shown && withKey.sel === 'nearmap', JSON.stringify(withKey));

// ── Use this view ──
const LAT = -37.7851, LNG = 175.2624;
async function capture(){
  asked.cov.length = 0; asked.nm.length = 0; asked.linz.length = 0;
  return pg.evaluate(async ({ LAT, LNG }) => {
    gotoTab('roof'); _openAerialModal();
    const mapEl = document.getElementById('aerialLeafletMap2'); mapEl.style.width = '800px'; mapEl.style.height = '400px';
    window._aerialMap = { getCenter: () => ({ lat: LAT, lng: LNG }), getZoom: () => 19.37, getBearing: () => 0 };
    document.getElementById('imagerySource').value = 'nearmap';
    let mapboxAsked = null; const realFetch = window.fetch;
    window.fetch = (u, o) => { if (/api\.mapbox\.com\/styles/.test(String(u))) { mapboxAsked = String(u); return Promise.reject(new Error('stub')); } return realFetch(u, o); };
    DRAW.bgImg = null; window._lastAerialSource = null;
    captureFromMapbox(LAT, LNG, 19);
    for (let i = 0; i < 100 && !DRAW.bgImg && !mapboxAsked; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    window.fetch = realFetch; window._aerialMap = null; try { _closeAerialModal(); } catch(e){}
    const img = DRAW.bgImg; let centre = null, credit = false;
    if (img){
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const q = x.getImageData(c.width / 2, c.height / 2, 1, 1).data; centre = q[1] > q[0] ? 'green' : 'red';
      const d = x.getImageData(c.width - 300, c.height - 30, 300, 30).data;
      for (let p = 0; p < d.length; p += 4) if (d[p] > 200 && d[p + 1] > 200 && d[p + 2] > 200){ credit = true; break; }
    }
    return { w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0, scale: DRAW.scaleMetresPerPx, centre, credit, mapboxAsked, src: window._lastAerialSource };
  }, { LAT, LNG });
}
const want = 78271.51696 * Math.cos(LAT * Math.PI / 180) / Math.pow(2, 19.05) / 2;
const a = await capture();
const capNm = asked.nm.filter(u => /\/Vert\/2\d\//.test(u));
check('Nearmap is asked first whether it has flown this address — at the roof’s own point', asked.cov.length === 1 && asked.cov[0].indexOf('/point/175.262400,-37.785100') >= 0 && /apikey=nm-key/.test(asked.cov[0]), asked.cov[0]);
check('…and where it has, that survey’s tiles are stitched in (pinned to the survey, whole zoom 20)',
  capNm.length > 20 && capNm.every(u => /\/tiles\/v3\/surveys\/sv-2026-03\/Vert\/20\//.test(u) && /apikey=nm-key/.test(u)) && a.centre === 'green' && asked.linz.filter(u => /\/20\//.test(u)).length === 0,
  JSON.stringify({ n: capNm.length, first: capNm[0], centre: a.centre }));
check('…into the Mapbox capture’s exact picture, so the scale is the same metres per IMAGE pixel', a.w === 2560 && a.h === 1280 && Math.abs(a.scale - want) < 1e-9 && !a.mapboxAsked, JSON.stringify({ w: a.w, h: a.h, scale: a.scale, want }));
check('…with a dated Nearmap credit in the corner, and the capture date kept', a.credit && a.src && a.src.source === 'nearmap' && a.src.captureDate === '2026-03-12', JSON.stringify(a.src));

nm = { covered: false, tiles: 'ok' };
const b1 = await capture();
check('where Nearmap has not flown, the LINZ aerial is used — and no Nearmap tile is asked for',
  asked.nm.filter(u => /\/Vert\/(1[7-9]|2\d)\//.test(u)).length === 0 && asked.linz.some(u => /\/20\//.test(u)) && b1.centre === 'red' && b1.w === 2560 && !b1.mapboxAsked, JSON.stringify({ nm: asked.nm.filter(u => /\/Vert\/(1[7-9]|2\d)\//.test(u)).length, centre: b1.centre }));

nm = { covered: true, tiles: '404' };
const b2 = await capture();
check('…and so it is when Nearmap’s tiles fail', b2.centre === 'red' && !b2.mapboxAsked, JSON.stringify({ centre: b2.centre }));

nm = { covered: false, tiles: 'ok' }; linzTiles = '404';
const b3 = await capture();
check('with neither, the Mapbox picture, as before', !!b3.mapboxAsked && /satellite-streets-v12\/static/.test(b3.mapboxAsked), String(b3.mapboxAsked).slice(0, 90));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
