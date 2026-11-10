// AUSTRALIA: THE STATE, AND THE STATE GOVERNMENT'S OWN AERIAL PHOTOS
// (2026-11-07, the owner: "add the free NSW government imagery for the
// Australian site, make to user enter their state so they are using the right
// states government imagery in the app").
//
// Pinned, on the real app.html and signup.html with the server stubbed:
//   - both sign-up forms ask an Australian business for its state, refuse to
//     go on without one, and send it; a New Zealand sign-up is not asked;
//   - Settings → Branding shows the State box to an Australian business only,
//     says what the map finder will use, and saves a new state;
//   - a NSW business's map finder opens on the NSW Government aerial (and
//     not on LINZ, which is New Zealand only); "Use this view" stitches NSW
//     Spatial Services tiles ({z}/{y}/{x}) with the credit in the corner;
//   - a level the NSW cache does not hold steps back a level; no NSW photo at
//     all falls back to Mapbox; another state, and New Zealand, are unchanged.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import zlib from 'node:zlib';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

function png(r, g, b){
  const T = 256;
  const crcT = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(T, 0); ihdr.writeUInt32BE(T, 4); ihdr[8] = 8; ihdr[9] = 6;
  const line = Buffer.concat([Buffer.from([0]), Buffer.alloc(T * 4).fill(Buffer.from([r, g, b, 255]))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(new Array(T).fill(line)))), chunk('IEND', Buffer.alloc(0))]);
}
const GREEN = png(40, 160, 60);
// What the NSW cache answers for a tile it does not hold: a 200 with an HTML
// page (measured 2026-11-07), not a 404.
const MISSING = '<html><body>Tile not found</body></html>';

const b = await chromium.launch();
const API = '**/flood-roofing-estimator-production.up.railway.app/**';

// ── 1. the app's own sign-up ───────────────────────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  let regBody = null;
  await pg.route(API, r => {
    const u = r.request().url();
    if (/\/auth\/register/.test(u)){ regBody = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'stub' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => window.showSetupView());
  const fill = async () => pg.evaluate(() => {
    document.getElementById('su-name').value = 'Shane'; document.getElementById('su-company').value = 'Shane Roofing';
    document.getElementById('su-email').value = 'shane@example.com.au'; document.getElementById('su-phone').value = '0412 000 111';
    document.getElementById('su-pass').value = 'password123'; document.getElementById('su-pass2').value = 'password123';
    const i = document.querySelector('input[name=su-interest]'); if (i) i.checked = true;
  });
  await fill();
  const nzHidden = await pg.evaluate(() => { document.querySelector('input[name=su-country][value=NZ]').click(); return getComputedStyle(document.getElementById('su-state-wrap')).display === 'none'; });
  check('the app’s sign-up does not ask a New Zealand business for a state', nzHidden);
  await pg.evaluate(() => document.querySelector('input[name=su-country][value=AU]').click());
  const auShown = await pg.evaluate(() => getComputedStyle(document.getElementById('su-state-wrap')).display !== 'none' && document.getElementById('su-state').options.length === 9);
  check('…and asks an Australian one, with the eight states and territories', auShown);
  regBody = null;
  await pg.evaluate(() => window.doRegister());
  await pg.waitForTimeout(300);
  const refused = await pg.evaluate(() => document.getElementById('login-err').textContent);
  check('…and will not go on without one', !regBody && /state/i.test(refused), refused);
  await pg.evaluate(() => { document.getElementById('su-state').value = 'NSW'; return window.doRegister(); });
  await pg.waitForTimeout(500);
  check('…then sends it with the sign-up', regBody && regBody.country === 'AU' && regBody.state === 'NSW', JSON.stringify(regBody && { c: regBody.country, s: regBody.state }));
  check('no page errors on the app’s sign-up', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── 2. signup.html ─────────────────────────────────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  let regBody = null;
  await pg.route(API, r => {
    if (/\/auth\/register/.test(r.request().url())){ regBody = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'stub' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await pg.goto('file://' + DIR + '/signup.html');
  await pg.waitForTimeout(500);
  const nz = await pg.evaluate(() => document.getElementById('suStateWrap').hidden);
  check('signup.html does not ask a New Zealand business for a state', nz);
  await pg.selectOption('#suCountry', 'AU');
  const au = await pg.evaluate(() => !document.getElementById('suStateWrap').hidden && document.getElementById('suState').options.length === 9);
  check('…shows the State box once Australia is picked', au);
  await pg.fill('#suCompany', 'Shane Roofing'); await pg.fill('#suName', 'Shane');
  await pg.fill('#suEmail', 'shane@example.com.au'); await pg.fill('#suPass', 'password123'); await pg.fill('#suPhone', '0412 000 111');
  await pg.evaluate(() => { const i = document.querySelector('input[name=interest]'); if (i) i.checked = true; });
  await pg.evaluate(() => document.getElementById('suForm').requestSubmit());
  await pg.waitForTimeout(300);
  check('…refuses to go on without one', !regBody, JSON.stringify(regBody));
  await pg.selectOption('#suState', 'NSW');
  await pg.evaluate(() => document.getElementById('suForm').requestSubmit());
  await pg.waitForTimeout(500);
  check('…and sends it with the sign-up', regBody && regBody.country === 'AU' && regBody.state === 'NSW', JSON.stringify(regBody && { c: regBody.country, s: regBody.state }));
  check('no page errors on signup.html', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── 3 & 4. Settings and the map finder, signed in ───────────────────────
async function signedIn(company){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  const state = { puts: [], nswTiles: [], mode: 'ok' };
  await pg.route('**/maps.six.nsw.gov.au/**', r => {
    const u = r.request().url(); state.nswTiles.push(u);
    const m = /MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(u);
    const z = m ? +m[1] : 0;
    const have = state.mode === 'ok' ? true : state.mode === 'no21' ? z !== 21 : state.mode === 'no19' ? z < 19 : false;
    if (!have) return r.fulfill({ status: 200, contentType: 'text/html;charset=utf-8', body: MISSING, headers: { 'Access-Control-Allow-Origin': '*' } });
    return r.fulfill({ status: 200, contentType: 'image/png', body: GREEN, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await pg.route('**/tiles.arcgis.com/**', r => {
    const u = r.request().url(); state.nswTiles.push(u);
    return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: GREEN, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await pg.route('**/spatial-img.information.qld.gov.au/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: GREEN, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await pg.route(API, r => {
    const u = r.request().url();
    if (/\/imagery-config/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ linzKey: 'platform-key' }) });
    if (/\/company\/country/.test(u)){ const body = JSON.parse(r.request().postData() || '{}'); state.puts.push(body);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: body.country, state: body.state || '' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((c) => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
    localStorage.setItem('fr_company', JSON.stringify(c)); }, company);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2500);
  return { ctx, pg, errs, state };
}
async function finder(pg){
  await pg.evaluate(() => { gotoTab('roof'); _openAerialModal(); });
  await pg.waitForTimeout(700);
  return pg.evaluate(() => {
    const sel = document.getElementById('imagerySource');
    const so = document.getElementById('imgSrcState'), lo = document.getElementById('imgSrcLinz');
    return { sel: sel.value, stateShown: !so.hidden, stateText: so.textContent, linzShown: !lo.hidden };
  });
}
// "Use this view" over a Sydney roof, the map box 800×400.
async function capture(pg, src){
  return pg.evaluate(async (src) => {
    const LAT = -33.7967, LNG = 151.1460;
    gotoTab('roof'); _openAerialModal();
    const mapEl = document.getElementById('aerialLeafletMap2');
    mapEl.style.width = '800px'; mapEl.style.height = '400px';
    window._aerialMap = { getCenter: () => ({ lat: LAT, lng: LNG }), getZoom: () => 19.37, getBearing: () => 0 };
    document.getElementById('imagerySource').value = src;
    let mapboxAsked = null;
    const realFetch = window.fetch;
    window.fetch = (u, o) => { if (/api\.mapbox\.com\/styles/.test(String(u))) { mapboxAsked = String(u); return Promise.reject(new Error('stub')); } return realFetch(u, o); };
    DRAW.bgImg = null; DRAW.bgFrom = null;
    captureFromMapbox(LAT, LNG, 19);
    for (let i = 0; i < 120 && !DRAW.bgImg && !mapboxAsked; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    window.fetch = realFetch; window._aerialMap = null; try { _closeAerialModal(); } catch(e){}
    const img = DRAW.bgImg;
    let credit = false, green = false;
    if (img){
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(c.width - 260, c.height - 30, 260, 30).data;
      for (let p = 0; p < d.length; p += 4) if (d[p] > 200 && d[p + 1] > 200 && d[p + 2] > 200){ credit = true; break; }
      const q = x.getImageData(c.width / 2, c.height / 2, 1, 1).data; green = q[1] - q[0] > 60 && q[1] - q[2] > 40;
    }
    return { from: DRAW.bgFrom || null, w: img ? img.naturalWidth : 0, mapboxAsked: !!mapboxAsked, credit, green };
  }, src);
}

{
  const { ctx, pg, errs, state } = await signedIn({ id: 'co-nsw', name: 'Shane Roofing', role: 'owner', country: 'AU', state: 'NSW' });
  // Settings → Branding
  const s = await pg.evaluate(() => { _countrySyncUI(); return {
    shown: getComputedStyle(document.getElementById('brStateWrap')).display !== 'none',
    val: document.getElementById('brState').value, note: document.getElementById('brStateNote').textContent }; });
  check('Settings shows an Australian business its State box, set to its state', s.shown && s.val === 'NSW', JSON.stringify(s));
  check('…and says the map finder uses the NSW Government’s photos', /NSW Government aerial/.test(s.note), s.note);

  const f = await finder(pg);
  check('a NSW business’s map finder opens on the NSW Government aerial', f.sel === 'state' && f.stateShown && /NSW Government aerial/.test(f.stateText), JSON.stringify(f));
  check('…and does not offer LINZ, which is New Zealand only', !f.linzShown, JSON.stringify(f));

  // Where the finder starts (2026-11-10): the state's capital, not Auckland / Whangarei.
  const home = await pg.evaluate(() => { _aerialHomeApply(); return {
    thumb: document.getElementById('aerialThumb').getAttribute('src'),
    ph: document.getElementById('aerialAddressInput').getAttribute('placeholder'),
    hint: document.getElementById('aerialHint').textContent, h: _aerialHome() }; });
  check('a NSW business’s finder starts over Sydney, not Auckland', /static\/151\.2093,-33\.8688,/.test(home.thumb) && home.h.lat === -33.8688, JSON.stringify({ t: home.thumb.slice(60, 110), h: home.h }));
  check('…and its address box and hint say nothing of New Zealand', /Sydney/.test(home.ph) && !/NZ|Whangarei/.test(home.ph) && !/NZ address/.test(home.hint), home.ph + ' | ' + home.hint);

  // The live map asks only for levels the NSW cache holds here (Port Macquarie stops at 20).
  const depth = async (mode, lat, lng) => { state.mode = mode; return pg.evaluate(async ([lat, lng]) => {
    const added = [];
    window._aerialMap = { getCenter: () => ({ lat, lng }), isStyleLoaded: () => true, getLayer: () => null, getSource: (id) => added.find(a => a.id === id) || null,
      removeLayer(){}, removeSource(){}, addSource(id, o){ added.push({ id, maxzoom: o.maxzoom, tiles: o.tiles }); }, addLayer(){} };
    document.getElementById('imagerySource').value = 'state';
    window._stateDepthNow = 0; _stateDepthCheck();
    for (let i = 0; i < 40 && !added.length; i++) await new Promise(r => setTimeout(r, 50));
    window._aerialMap = null;
    return added.length ? added[0].maxzoom : null; }, [lat, lng]); };
  const d21 = await depth('ok', -33.8150, 151.0030);
  const d20 = await depth('no21', -31.4285, 152.9105);
  check('the live NSW layer goes to level 21 where the cache has it (Sydney)', d21 === 21, String(d21));
  check('…and stops at 20 where it does not (Port Macquarie), so the map enlarges the NSW photo instead of showing Mapbox underneath', d20 === 20, String(d20));

  // 2026-11-11: which state a point is in, coarse on purpose.
  const regions = await pg.evaluate(() => [[-33.87,151.21],[-27.47,153.03],[-35.28,149.13],[-37.81,144.96],[-36.12,146.89],[-28.18,153.54],[-28.168,153.535].slice(0,2),[-42.88,147.33],[-31.95,115.86],[-34.93,138.6],[-12.46,130.85],[-32.24,148.6]].map(p => _auRegionAt(p[0], p[1])));
  check('the map knows which state it is over (Sydney, Brisbane, Canberra, Melbourne, Wodonga, Tweed Heads, Coolangatta …)',
    JSON.stringify(regions) === JSON.stringify(['NSW','QLD','ACT','VIC','VIC','NSW','QLD','TAS','WA','SA','NT','NSW']), JSON.stringify(regions));
  check('the ACT\u2019s and Queensland\u2019s photos are offered, Victoria has none', await pg.evaluate(() => !!_auStateSrc('ACT') && !!_auStateSrc('QLD') && !_auStateSrc('VIC')));
  check('…and Queensland\u2019s credit carries the State\u2019s no-warranty statement', await pg.evaluate(() => /no warranty/.test(_auStateSrc('QLD').credit) && /CC BY-SA/.test(_auStateSrc('QLD').credit)));

  // "You're now in …": a fake map, the finder on the NSW photos.
  const ask = async (lat, lng) => pg.evaluate(async ([lat, lng]) => {
    window._aerialMap = { getCenter: () => ({ lat, lng }), getZoom: () => 18, isStyleLoaded: () => true, getLayer: () => null, getSource: () => null,
      removeLayer(){}, removeSource(){}, addSource(){}, addLayer(){}, moveLayer(){} };
    _aerialRegionCheck();
    const c = document.getElementById('aerialRegionAsk');
    return { shown: c.style.display !== 'none', msg: c.textContent.replace(/\s+/g, ' ').trim(), go: c.dataset.go };
  }, [lat, lng]);
  await pg.evaluate(() => { _openAerialModal(); window._stateSrcKey = 'NSW'; document.getElementById('imagerySource').value = 'state'; });
  const inSyd = await ask(-33.87, 151.21);
  check('over Sydney on the NSW photos nothing is asked', !inSyd.shown, JSON.stringify(inSyd));
  const inAct = await ask(-35.28, 149.13);
  check('moving into Canberra asks "You\u2019re now in the ACT. Switch to the ACT Government aerial?"', inAct.shown && /now in the ACT/.test(inAct.msg) && /ACT Government aerial/.test(inAct.msg) && inAct.go === 'state:ACT', JSON.stringify(inAct));
  await pg.click('#aerialRegionYes');
  const afterYes = await pg.evaluate(() => ({ key: window._stateSrcKey, sel: document.getElementById('imagerySource').value, opt: document.getElementById('imgSrcState').textContent, card: document.getElementById('aerialRegionAsk').style.display }));
  check('…Yes switches to the ACT Government\u2019s photos and the list names them', afterYes.key === 'ACT' && afterYes.sel === 'state' && /ACT Government aerial/.test(afterYes.opt) && afterYes.card === 'none', JSON.stringify(afterYes));
  const inMel = await ask(-37.81, 144.96);
  check('moving into Melbourne says it is outside the ACT\u2019s photos and offers the standard satellite', inMel.shown && /now in Victoria/.test(inMel.msg) && /outside the ACT Government aerial/.test(inMel.msg) && inMel.go === 'mapbox', JSON.stringify(inMel));
  await pg.click('#aerialRegionNo');
  const again = await ask(-37.80, 144.95);
  check('…No is remembered: Melbourne is not asked again this sitting', !again.shown, JSON.stringify(again));
  const inBris = await ask(-27.47, 153.03);
  check('Brisbane offers the Queensland Government aerial', inBris.shown && /now in Queensland/.test(inBris.msg) && /Queensland Government aerial/.test(inBris.msg) && inBris.go === 'state:QLD', JSON.stringify(inBris));
  await pg.evaluate(() => { document.getElementById('aerialRegionAsk').style.display = 'none'; window._stateSrcKey = 'NSW'; });

  // The ACT's tiles come as application/octet-stream and still count.
  const actDepth = await pg.evaluate(async () => {
    const added = [];
    window._aerialMap = { getCenter: () => ({ lat: -35.28, lng: 149.13 }), isStyleLoaded: () => true, getLayer: () => null, getSource: () => null,
      removeLayer(){}, removeSource(){}, addSource(id, o){ added.push({ id, maxzoom: o.maxzoom, tiles: o.tiles }); }, addLayer(){}, moveLayer(){} };
    window._stateSrcKey = 'ACT'; document.getElementById('imagerySource').value = 'state';
    window._stateDepthNow = 0; _stateDepthCheck();
    for (let i = 0; i < 40 && !added.length; i++) await new Promise(r => setTimeout(r, 50));
    window._stateSrcKey = 'NSW';
    return added[0] || null;
  });
  check('the ACT layer is laid at its deepest level (22) from its Web Mercator copy', actDepth && actDepth.maxzoom === 22 && /ACT_Aerial_Imagery_Current_3857/.test(actDepth.tiles[0]), JSON.stringify(actDepth));

  // Where the high-detail photos stop: shaded cells and a line under the map.
  const cover = async (mode) => { state.mode = mode; return pg.evaluate(async () => {
    let fc = null;
    window._aerialMap = { getCenter: () => ({ lat: -27.47, lng: 153.03 }), getZoom: () => 18,
      getBounds: () => ({ getWest: () => 153.02, getEast: () => 153.04, getSouth: () => -27.48, getNorth: () => -27.46 }),
      getSource: (id) => id === 'rm-cover' && fc ? { setData(d){ fc = d; } } : null, addSource(id, o){ if (id === 'rm-cover') fc = o.data; },
      addLayer(){}, getLayer: () => true, moveLayer(){} };
    window._stateSrcKey = 'NSW'; document.getElementById('imagerySource').value = 'state';
    _stateCoverCheck();
    for (let i = 0; i < 60 && !window._coverCells; i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 100));
    const n = document.getElementById('aerialCoverNote');
    const out = { cells: window._coverCells, shaded: fc ? fc.features.length : -1, note: n.style.display !== 'none' ? n.textContent : '' };
    window._coverCells = null; return out; }); };
  const cBad = await cover('no19');
  check('outside the NSW photos the whole view is shaded, edged, and the strip says "You\u2019re outside the NSW Government aerial\u2019s high-detail photos"',
    cBad.shaded === 24 && /outside the NSW Government aerial/.test(cBad.note), JSON.stringify(cBad));
  await pg.evaluate(() => { for (const k in _COVER_TILE) delete _COVER_TILE[k]; });
  const cOk = await cover('ok');
  check('…and where the photos are there, nothing is shaded and nothing is said', cOk.shaded === 0 && !cOk.note, JSON.stringify(cOk));
  await pg.evaluate(() => { window._aerialMap = null; });

  // The Nearmap upgrade button: off until the owner's go.
  const nm = await pg.evaluate(() => {
    _nearmapUpsellSync(); const off = getComputedStyle(document.getElementById('nearmapUpsellBtn')).display;
    window.__NEARMAP_UPSELL = true; _nearmapUpsellSync(); const on = getComputedStyle(document.getElementById('nearmapUpsellBtn')).display;
    document.getElementById('nearmapUpsellBtn').click();
    const card = document.getElementById('nearmapUpsellCard'), link = document.getElementById('nearmapUpsellLink');
    const r = { off, on, card: card.style.display, href: link.href, target: link.target, words: card.textContent };
    window.__NEARMAP_UPSELL = false; _nearmapUpsellSync(); window._stateSrcKey = null; return r; });
  check('the Nearmap upgrade button is hidden until it is switched on', nm.off === 'none', JSON.stringify(nm.off));
  check('…switched on it shows, opens a card saying it is a separate subscription, and links to Nearmap in a new tab',
    nm.on !== 'none' && nm.card === 'block' && /nearmap\.com/.test(nm.href) && nm.target === '_blank' && /separate subscription/.test(nm.words), JSON.stringify({ on: nm.on, card: nm.card, href: nm.href }));
  await pg.evaluate(() => { try { _closeAerialModal(); } catch(e){} });

  state.nswTiles.length = 0; state.mode = 'ok';
  const got = await capture(pg, 'state');
  const capT = state.nswTiles.filter(u => +((/tile\/(\d+)\//.exec(u) || [])[1]) >= 17);
  const zs = [...new Set(capT.map(u => (/tile\/(\d+)\//.exec(u) || [])[1]))];
  // y then x in the URL: at -33.8° the tile row is ~1.24M at z21, the column ~1.93M.
  const yx = capT.map(u => (/tile\/\d+\/(\d+)\/(\d+)/.exec(u) || []).slice(1).map(Number));
  check('"Use this view" stitches NSW Spatial Services tiles at the deepest level (21), row before column',
    zs.length === 1 && zs[0] === '21' && yx.length > 20 && yx.every(([y, x]) => y > 1.2e6 && y < 1.3e6 && x > 1.9e6 && x < 2.0e6),
    JSON.stringify({ zs, n: yx.length, sample: yx.slice(0, 2) }));
  check('…into the picture, recorded as the NSW source, with the credit stamped in the corner, and no Mapbox',
    got.from === 'nsw' && got.w === 2560 && got.green && got.credit && !got.mapboxAsked, JSON.stringify(got));

  state.nswTiles.length = 0; state.mode = 'no21';
  const got2 = await capture(pg, 'state');
  const lv = [...new Set(state.nswTiles.map(u => (/tile\/(\d+)\//.exec(u) || [])[1]).filter(z => +z >= 17))].sort();
  check('a level the NSW cache does not hold steps back to the next one', got2.from === 'nsw' && got2.green && lv.includes('21') && lv.includes('20'), JSON.stringify({ got2, lv }));

  state.nswTiles.length = 0; state.mode = 'none';
  const got3 = await capture(pg, 'state');
  check('…and no NSW photo here at all falls back to Mapbox', got3.mapboxAsked && got3.from !== 'nsw', JSON.stringify(got3));

  // Moving to another state: saved, and the finder goes back to Mapbox.
  state.puts.length = 0;
  await pg.evaluate(() => _stateSet('VIC'));
  await pg.waitForTimeout(200);
  const v = await pg.evaluate(() => ({ brief: _companyBrief().state, note: document.getElementById('brStateNote').textContent }));
  check('the owner picking another state saves it', state.puts.length === 1 && state.puts[0].country === 'AU' && state.puts[0].state === 'VIC' && v.brief === 'VIC', JSON.stringify({ puts: state.puts, v }));
  check('…and the note says Victoria has no free government photos, so Mapbox', /Mapbox/.test(v.note) && /Victoria/.test(v.note), v.note);
  const f2 = await finder(pg);
  check('…and the map finder no longer offers the NSW photos', f2.sel === 'mapbox' && !f2.stateShown, JSON.stringify(f2));
  check('no page errors for a NSW business', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, pg, errs } = await signedIn({ id: 'co-nz', name: 'Kiwi Roofing', role: 'owner', country: 'NZ' });
  const s = await pg.evaluate(() => { _countrySyncUI(); return getComputedStyle(document.getElementById('brStateWrap')).display === 'none'; });
  check('a New Zealand business has no State box', s);
  const f = await finder(pg);
  check('…and its map finder is unchanged: LINZ, no state photos', f.sel === 'linz' && !f.stateShown && f.linzShown, JSON.stringify(f));
  const nzHome = await pg.evaluate(() => { _aerialHomeApply(); return { t: document.getElementById('aerialThumb').getAttribute('src'), ph: document.getElementById('aerialAddressInput').getAttribute('placeholder') }; });
  check('…and still starts over Auckland with the Whangarei example', /static\/174\.7633,-36\.8485,/.test(nzHome.t) && /Whangarei/.test(nzHome.ph), JSON.stringify(nzHome));
  check('no page errors for a New Zealand business', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, pg, errs } = await signedIn({ id: 'co-au', name: 'Old Aussie', role: 'owner', country: 'AU' });
  const n = await pg.evaluate(() => { _countrySyncUI(); return document.getElementById('brStateNote').textContent; });
  check('an Australian business that has not said its state is asked for it in Settings', /Pick your state/.test(n), n);
  const f = await finder(pg);
  check('…and stays on Mapbox until it does', f.sel === 'mapbox' && !f.stateShown, JSON.stringify(f));
  check('no page errors for an Australian business with no state', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
