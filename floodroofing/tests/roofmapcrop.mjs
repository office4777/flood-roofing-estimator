// "I would like to be able to crop/zoom/move the roofmap picture on the quote
//  inside of it's allocated picture box, the same as i can do on a uploaded
//  picture on page 1 of the quote."
//
// The quote map reproduces the canvas view exactly — that was the last fix, and
// it means the published picture is whatever Map Roof was showing. This is the
// other half: reframing it for the customer without going back and reframing
// the canvas.
//
// Two things have to be true at once, and they pull in opposite directions:
//
//   * the crop must actually crop — the box used to be height:auto, and a box
//     the size of its contents cannot hide anything; and
//   * the crop must NOT be a change of viewBox. What the map is a picture OF
//     stays the canvas view. That was reported three times; the viewBox
//     assertions below are the guard against re-breaking it.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-run1024.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

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

// A real job with an aerial behind it, framed the way the office would frame
// it, and published — so the map under test is the one a customer would get.
await pg.evaluate(async (g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  gotoTab('roof');
  const c = document.createElement('canvas'); c.width = 2400; c.height = 2000;
  const x = c.getContext('2d'); x.fillStyle = '#556b2f'; x.fillRect(0, 0, 2400, 2000);
  const im = new Image(); im.src = c.toDataURL('image/jpeg', 0.6);
  await new Promise(r => { im.onload = r; });
  DRAW.bgImg = im;
  DRAW.zoom = 0.55; IMG_OFFSET.x = 0; IMG_OFFSET.y = 0;
  redrawAll();
  _qpStashRoofGeom(true);
  // Somewhere to render the block for real, so drag and wheel are driven the
  // way a mouse drives them rather than by calling the handlers.
  const host = document.createElement('div');
  host.id = '__mapHost';
  host.style.cssText = 'position:fixed;left:0;top:0;width:760px;z-index:99999;background:#fff';
  document.body.appendChild(host);
  window.__renderMap = function(){
    host.innerHTML = _buildRoofPreviewsHtml({ small: true, basic: true });
  };
  window.__renderMap();
}, GEOM);

const frameInfo = () => pg.evaluate(() => {
  const fr = document.querySelector('#__mapHost .qp-map-frame');
  const inner = fr && fr.querySelector('.qp-map-inner');
  const svg = fr && fr.querySelector('svg');
  const cs = fr && getComputedStyle(fr);
  return {
    has: !!fr,
    overflow: cs && cs.overflowX,
    boxH: fr && Math.round(fr.getBoundingClientRect().height),
    innerTransform: inner && inner.style.transform,
    svgStyle: svg && svg.getAttribute('style'),
    svgH: svg && Math.round(svg.getBoundingClientRect().height),
    viewBox: svg && svg.getAttribute('viewBox'),
    controls: fr ? fr.querySelectorAll('.qp-map-controls button').length : 0,
    state: _qpRoofMapView(),
  };
});

// ── it starts where the canvas left it ─────────────────────────────
let s = await frameInfo();
check('the map is rendered inside a crop box', s.has);
check('it starts uncropped — the canvas view, untouched',
  s.state.offX === 0 && s.state.offY === 0 && s.state.zoom === 1, JSON.stringify(s.state));

// ── a box the size of its contents cannot crop ─────────────────────
check('the box clips what overflows it', s.overflow === 'hidden', String(s.overflow));
check('the box has a height of its own, not its contents’',
  Math.abs(s.boxH - 360) <= 1, s.boxH + 'px (lg = 360)');
check('the map fills the box rather than shrink-wrapping',
  /height:100%/.test(s.svgStyle || '') && !/max-height/.test(s.svgStyle || ''), s.svgStyle);
check('…and it really is that tall on screen', Math.abs(s.svgH - 360) <= 1, s.svgH + 'px');

const VB0 = s.viewBox;
check('the published frame is a real viewBox', !!VB0 && VB0.split(/\s+/).length === 4, VB0);

// ── the controls are reachable ─────────────────────────────────────
check('there are zoom-out, zoom-in and reset buttons', s.controls === 3, String(s.controls));

// ── moving it ──────────────────────────────────────────────────────
// Driven as a mouse drives it: press in the middle of the picture (away from
// the buttons in the corner), drag, release.
const box = await pg.evaluate(() => {
  const r = document.querySelector('#__mapHost .qp-map-frame').getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
await pg.mouse.move(box.x, box.y);
await pg.mouse.down();
await pg.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
await pg.mouse.up();
s = await frameInfo();
check('dragging moves the picture by exactly the distance dragged',
  s.state.offX === 60 && s.state.offY === 40, JSON.stringify(s.state));
check('…and that reaches the element on screen, not just the state',
  (s.innerTransform || '').indexOf('translate(60px, 40px)') >= 0, s.innerTransform);
check('a second drag carries on from where the first stopped, it does not restart',
  true);
await pg.mouse.move(box.x, box.y);
await pg.mouse.down();
await pg.mouse.move(box.x - 20, box.y - 15, { steps: 4 });
await pg.mouse.up();
s = await frameInfo();
check('…(40, 25) after dragging back 20 and 15',
  s.state.offX === 40 && s.state.offY === 25, JSON.stringify(s.state));

// ── zooming ────────────────────────────────────────────────────────
await pg.mouse.move(box.x, box.y);
await pg.mouse.wheel(0, -120);          // wheel forward = zoom in
s = await frameInfo();
check('scrolling forward over the map zooms in', s.state.zoom > 1, String(s.state.zoom));
await pg.mouse.wheel(0, 120); await pg.mouse.wheel(0, 120);
s = await frameInfo();
check('…and scrolling back zooms out again', s.state.zoom < 1, String(s.state.zoom));

const clamp = await pg.evaluate(() => {
  const out = {};
  for (let i = 0; i < 80; i++) _qpRoofMapZoom(0.1);
  out.max = _qpRoofMapView().zoom;
  for (let i = 0; i < 200; i++) _qpRoofMapZoom(-0.1);
  out.min = _qpRoofMapView().zoom;
  return out;
});
check('zooming in stops at 4×', clamp.max === 4, String(clamp.max));
check('zooming out stops at 0.3× — never inverted, never zero', clamp.min === 0.3, String(clamp.min));

// ── reset goes back to the canvas view ─────────────────────────────
await pg.evaluate(() => { _qpRoofMapViewSet({ offX: 130, offY: -70, zoom: 2.4 }); window.__renderMap(); });
s = await frameInfo();
check('a crop survives a re-render of the proposal',
  s.state.zoom === 2.4 && (s.innerTransform || '').indexOf('scale(2.4)') >= 0, s.innerTransform);
await pg.click('#__mapHost .qp-map-controls button:nth-child(3)');
s = await frameInfo();
check('Reset puts it back to the canvas view',
  s.state.offX === 0 && s.state.offY === 0 && s.state.zoom === 1, JSON.stringify(s.state));
check('…and clears the transform on screen too',
  (s.innerTransform || '').indexOf('translate(0px, 0px) scale(1)') >= 0, s.innerTransform);

// ── the guard: cropping is NOT a change of what is published ───────
// This is the whole point of doing it as a transform. A crop that moved the
// viewBox would be report #23 all over again: the picture would stop being the
// canvas view the moment anyone touched it.
// The baseline is taken INSIDE the same pass — the browser can reflow the
// canvas mid-test, and a re-render legitimately re-stashes from it. What must
// hold is that between two renders with different crops, and with the canvas
// left alone, the frame is identical.
const vbs = await pg.evaluate(() => {
  const grab = () => document.querySelector('#__mapHost .qp-map-frame svg').getAttribute('viewBox');
  _qpRoofMapViewSet({ offX: 0, offY: 0, zoom: 1 });
  window.__renderMap();
  const vb0 = grab();
  const seen = [];
  [[120,-60,2.2],[-300,200,0.4],[45,45,3.7]].forEach(v => {
    _qpRoofMapViewSet({ offX:v[0], offY:v[1], zoom:v[2] });
    window.__renderMap();
    seen.push(grab());
  });
  // And the stash itself — the published rectangle in S.quote — must never
  // have moved either: the crop is presentation, not a re-publish.
  const view = S.quote.roofMapGeom.view;
  _qpRoofMapReset(); window.__renderMap();
  return { vb0, seen, view, same: seen.every(v => v === vb0) };
});
check('cropping never touches the published frame', vbs.same,
  vbs.vb0 + '  vs  ' + vbs.seen.join('  |  '));
check('…and never re-publishes the stashed view',
  vbs.vb0.split(/\s+/).map(Number).every((n, i) =>
    Math.abs(n - [vbs.view.x, vbs.view.y, vbs.view.w, vbs.view.h][i]) < 0.01),
  JSON.stringify(vbs.view) + ' vs vb ' + vbs.vb0);

// ── the size buttons still size the box ────────────────────────────
const sizes = await pg.evaluate(() => {
  const out = {};
  ['sm','md','lg'].forEach(sz => {
    S.quote.roofMapSize = sz;
    window.__renderMap();
    out[sz] = Math.round(document.querySelector('#__mapHost .qp-map-frame').getBoundingClientRect().height);
  });
  S.quote.roofMapSize = 'lg'; window.__renderMap();
  return out;
});
check('S / M / L set the height of the box', sizes.sm === 150 && sizes.md === 240 && sizes.lg === 360,
  JSON.stringify(sizes));

// ── the customer gets the picture, not the tools ───────────────────
const cust = await pg.evaluate(() => {
  _qpRoofMapViewSet({ offX: 45, offY: -30, zoom: 1.6 });
  window.__CUSTOMER_MODE = true;
  window.__renderMap();
  const fr = document.querySelector('#__mapHost .qp-map-frame');
  const out = {
    transform: fr.querySelector('.qp-map-inner').style.transform,
    controls: fr.querySelectorAll('.qp-map-controls').length,
    onmousedown: fr.getAttribute('onmousedown'),
    onwheel: fr.getAttribute('onwheel'),
    cursor: getComputedStyle(fr).cursor,
  };
  // The handlers themselves must also refuse, in case a render path ever
  // slips an office control through.
  _qpRoofMapZoom(1); _qpRoofMapReset();
  out.stateAfterTries = _qpRoofMapView();
  window.__CUSTOMER_MODE = false;
  _qpRoofMapReset(); window.__renderMap();
  return out;
});
check('the customer sees the crop the office made',
  cust.transform.indexOf('scale(1.6)') >= 0 && cust.transform.indexOf('translate(45px, -30px)') >= 0,
  cust.transform);
check('…with no zoom or reset buttons', cust.controls === 0, String(cust.controls));
check('…no drag, no wheel', !cust.onmousedown && !cust.onwheel,
  cust.onmousedown + ' / ' + cust.onwheel);
check('…and no grab cursor inviting one', cust.cursor === 'default', cust.cursor);
check('the handlers refuse on the customer link even if called directly',
  cust.stateAfterTries.zoom === 1.6 && cust.stateAfterTries.offX === 45, JSON.stringify(cust.stateAfterTries));

// ── the Pricing tab's little map is not this map ───────────────────
// It frames itself under the roof switcher; the office's crop is for the
// customer's page.
const mini = await pg.evaluate(() => {
  const s = _qpRoofMapSvg({ showBg: false, maxH: 150 });
  return { style: (s.match(/style="([^"]*)"/) || [])[1] || '', frame: /qp-map-frame/.test(s) };
});
check('the pricing mini map still sizes itself',
  /height:auto/.test(mini.style) && /max-height:150px/.test(mini.style) && !mini.frame, mini.style);

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
