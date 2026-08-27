// "Clearlite sheet should fit nicely inside the roof map, not just randomly
//  thrown over the map."
//
// It was drawn centred on the raw click, so a full-length clear centred
// mid-plane stuck out past the ridge — exactly the screenshot in the report —
// and its direction was re-derived on every redraw from whichever gutter
// happened to be nearest the CENTRE, which is not necessarily the gutter the
// sheet drains to.
//
// A clear now lies the way the steel sheet it replaces lies: square off its
// own gutter, clamped inside the plane between gutter and ridge. This suite
// runs on the exact roof from the report — gable, ridge through the middle,
// three gutters (one of them the short 7 m side), 15°.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report26.json'), 'utf8'));
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
await pg.waitForTimeout(2600);
await pg.evaluate((g) => {
  gotoTab('roof');
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.clearlites = [];
  redrawAll();
}, GEOM);

// The roof's fixed facts, in image px: ridge y=2005; top gutter y=1658
// (upper plane runs 347px); bottom gutters y=2294 (289px) and y=2351 (346px).
const MPP = GEOM.scaleMetresPerPx;
const fit = (x, y, lenM) => pg.evaluate(([x, y, l]) => _clearliteFit(x, y, l), [x, y, lenM]);

// ── a full-length sheet lies where the steel sheet lies ────────────
// 5.89 m on the upper plane (347px ≈ 5.69 m) — longer than the plane, so it
// sits ON the gutter line and runs up, like the real sheet would.
let r = await fit(1800, 1800, 5.89);
check('the sheet runs up the fall, square to its gutter',
  r && Math.abs(r.ux) < 0.01 && Math.abs(Math.abs(r.uy) - 1) < 0.01, JSON.stringify(r));
const lenPx = 5.89 / MPP;
check('…with its bottom end ON the gutter line, not centred on the click',
  r && Math.abs((r.cy - lenPx / 2) - 1658) < 1.5,
  'bottom edge y=' + (r.cy - lenPx / 2).toFixed(1) + ' (gutter is 1658; the click was 1800)');
check('…and it keeps the click\'s position across the roof', r && Math.abs(r.cx - 1800) < 1.5,
  'x=' + r.cx);

// ── a short clear stays where it was put, but inside the plane ─────
// 2 m mid-plane on the bottom face: fits at the click, so nothing moves.
r = await fit(2000, 2100, 2);
check('a short clear that fits at the click stays at the click',
  r && Math.abs(r.cx - 2000) < 1.5 && Math.abs(r.cy - 2100) < 1.5, JSON.stringify(r));
// Clicked ON the ridge: pushed down until its top edge sits at the ridge.
r = await fit(2000, 2010, 2);
const topEdge = r ? r.cy - Math.abs(r.uy) * (2 / MPP) / 2 : 0;
check('…clicked at the ridge, it is pushed back until it stops AT the ridge',
  r && Math.abs(topEdge - 2005) < 1.5, 'top edge y=' + topEdge.toFixed(1) + ' (ridge is 2005)');
// Clicked at the gutter: pulled up until its bottom edge sits on the gutter.
r = await fit(2000, 2290, 2);
const botEdge = r ? r.cy + Math.abs(r.uy) * (2 / MPP) / 2 : 0;
check('…clicked at the gutter, its bottom edge lands on the gutter',
  r && Math.abs(botEdge - 2294) < 1.5, 'bottom edge y=' + botEdge.toFixed(1) + ' (gutter is 2294)');

// ── the right gutter claims it ─────────────────────────────────────
// Mid-plane over the 2288–2715 step: the short side gutter (y=2351) is its
// drain, and distance is measured to the SEGMENT — the long bottom gutter
// ends at x=2288 and cannot claim a sheet at x=2500.
r = await fit(2500, 2200, 2);
check('a sheet on the stepped face squares to that face\'s own gutter',
  r && Math.abs(r.ux) < 0.01, JSON.stringify(r));
r = await fit(2500, 2330, 2);
const botEdge2 = r ? r.cy + Math.abs(r.uy) * (2 / MPP) / 2 : 0;
check('…and its gutter is the stepped one at y=2351, not the one that ends at x=2288',
  r && Math.abs(botEdge2 - 2351) < 1.5, 'bottom edge y=' + botEdge2.toFixed(1));

// ── through the real placement flow ────────────────────────────────
const placed = await pg.evaluate(() => {
  setTool('clearlite');
  showClearPopup(1800, 1800);
  _clearPopupSetMode('short');
  document.getElementById('clearLenInput').value = '2.5';
  confirmClearPopup();
  const c = DRAW.clearlites[DRAW.clearlites.length - 1];
  redrawAll();
  return c;
});
check('a placed clear stores its fitted centre and its direction',
  placed && isFinite(placed.ux) && isFinite(placed.uy) && placed.mode === 'short' && placed.lenM === 2.5,
  JSON.stringify(placed));
check('…fitted inside the upper plane (between gutter 1658 and ridge 2005)',
  placed && placed.cy - (2.5 / MPP) / 2 >= 1656 && placed.cy + (2.5 / MPP) / 2 <= 2007,
  'centre y=' + (placed && placed.cy));

// A clear saved before the fit existed has no ux/uy — it must still render.
const legacy = await pg.evaluate(() => {
  DRAW.clearlites.push({ cx: 2000, cy: 2150, mode: 'short', lenM: 2 });
  try { redrawAll(); return true; } catch(e){ return false; }
});
check('a clear from before the fit still renders', legacy);

// No gutters at all: the click stands, nothing throws.
const bare = await pg.evaluate(() => {
  const savedLines = DRAW.lines; DRAW.lines = [];
  const f = _clearliteFit(1800, 1800, 2);
  DRAW.lines = savedLines;
  return f;
});
check('with no gutters drawn yet there is nothing to fit to — the click stands',
  bare === null, JSON.stringify(bare));

check('no page errors', errs.length === 0, errs.join(' | '));
const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
