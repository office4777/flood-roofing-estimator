// The owner, 2026-09-24: "fix the canvas background, allow the background
// to go completely transparent, and in the quote tab where the two roofmap
// pictures fit, have a toggle to exclude the background from the roofmap
// (because before it wouldn't let me delete the background of my ugly
// hand-drawn picture which was not a good look if I sent the quote to the
// customer)".
//
// Pinned: the Background slider at 0 takes the picture away and leaves the
// drawing (it used to return out of the whole redraw, so the lines went
// too); the modern quote's roof plans carry an office-only Background
// picture switch that takes the picture off every map, is saved, and never
// reaches the customer.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report41.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
const load = () => pg.evaluate((g) => {
  gotoTab('roof');
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map((r, i) => Object.assign({}, r, { name: i === 0 ? 'Main Roof' : 'Roof ' + (i + 1), lines: (r.lines || []).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); _renderRoofMenuBar(); _scaleStateShow(); } catch(e){}
  // The photos pop-out narrows the page and the row then wraps, as it should;
  // the one-row check is about a normal screen.
  try { _fergusPanelClose(); } catch(e){}
  if (!S.quote) S.quote = defaultQuote();
}, GEOM);
await load();
await pg.evaluate(() => new Promise(res => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 400, 300);
  const im = new Image(); im.onload = () => { DRAW.bgImg = im; res(); }; im.src = c.toDataURL('image/png');
}));
const px = await pg.evaluate(() => {
  const count = () => {
    const cv = document.getElementById('roofCanvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let red = 0, dark = 0;   // dark = anything drawn: not plain white
    for (let i = 0; i < d.length; i += 16){ const r = d[i], g = d[i+1], b = d[i+2]; if (r - g > 40 && r - b > 40) red++; if (!(r > 235 && g > 235 && b > 235)) dark++; }
    return { red, dark };
  };
  const op = document.getElementById('bgOpacity'), show = document.getElementById('showBg');
  op.value = '0.35'; show.checked = true; redrawAll(); const half = count();
  op.value = '0'; op.dispatchEvent(new Event('input')); const zero = count();
  show.checked = false; redrawAll(); const off = count();
  show.checked = true; op.value = '0.35'; redrawAll();
  return { half, zero, off, label: op.parentElement.textContent.trim() };
});
check('the Background slider shows the picture part way', px.half.red > 500, JSON.stringify(px.half));
check('at 0 the picture is gone completely…', px.zero.red === 0, JSON.stringify(px.zero));
check('…and the drawing is all still there (it used to vanish with it)', px.zero.dark > 50 && Math.abs(px.zero.dark - px.off.dark) <= Math.max(3, px.off.dark * 0.05), JSON.stringify({ zero: px.zero.dark, noBg: px.off.dark }));
check('the slider says what it is', /^Background/.test(px.label), px.label);

// ── the quote's roof plans: a Background picture switch ──
const q = await pg.evaluate(async () => {
  let saves = 0; const real = window._scheduleAutosave; window._scheduleAutosave = function(){ saves++; };
  S.quote.style = 'modern';
  gotoTab('quote'); await new Promise(r => setTimeout(r, 600));
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 900));
  const maps = () => [...document.querySelectorAll('#qpRoot .qp-roofmap')];
  const imgs = () => document.querySelectorAll('#qpRoot .qp-roofmap svg image').length;
  const out = { maps: maps().length, switches: document.querySelectorAll('#qpRoot .qp-roofmap .qp-bg-sw').length, imgsOn: imgs(),
                label0: (document.querySelector('#qpRoot .qp-bg-sw') || {}).textContent };
  document.querySelector('#qpRoot .qp-bg-sw').click(); await new Promise(r => setTimeout(r, 500));
  out.flag = S.quote.roofMapShowBg; out.imgsOff = imgs(); out.saves = saves;
  out.label1 = (document.querySelector('#qpRoot .qp-bg-sw') || {}).textContent;
  out.offCls = !(document.querySelector('#qpRoot .qp-bg-sw') || { classList: { contains: () => true } }).classList.contains('on');
  // the customer never sees the switch, and gets the plan without the picture
  window.__CUSTOMER_MODE = true; refreshQuoteProposal(); await new Promise(r => setTimeout(r, 400));
  out.custSwitch = document.querySelectorAll('#qpRoot .qp-bg-sw').length; out.custImgs = imgs();
  window.__CUSTOMER_MODE = false; refreshQuoteProposal(); await new Promise(r => setTimeout(r, 400));
  document.querySelector('#qpRoot .qp-bg-sw').click(); await new Promise(r => setTimeout(r, 500));
  out.back = imgs() > 0 && S.quote.roofMapShowBg === true;
  window._scheduleAutosave = real;
  return out;
});
check('the modern quote’s roof plans each carry a Background picture switch, showing the picture to start with', q.maps >= 2 && q.switches === q.maps && q.imgsOn >= 1 && /shown/.test(q.label0), JSON.stringify(q));
check('…one click takes the picture off every plan, says so, and is saved with the quote', q.flag === false && q.imgsOff === 0 && /hidden/.test(q.label1) && q.offCls && q.saves >= 1, JSON.stringify(q));
check('…the customer gets no switch and no picture', q.custSwitch === 0 && q.custImgs === 0, JSON.stringify(q));
check('…and a second click puts it back', q.back);
check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
