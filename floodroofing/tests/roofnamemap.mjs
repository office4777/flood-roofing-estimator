// "Remove the 'Roof 1' / 'Roof 2' roof names off the canvas and job pack — it
//  makes other measures too hard to read. Only have it on the quote, like it
//  does currently."
//
// On a six-roof house the name got stamped in the middle of each shape, which
// is precisely where the run lengths and edge measurements sit. A roof you
// have to identify from the switcher is a small cost; a tape reading you
// cannot make out is a real one.
//
// So the name is off both working surfaces and stays on the customer's quote,
// where there are no dimensions to compete with. That split is the whole
// point of this suite — removing it everywhere would be just as wrong.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.roofs[0].name = 'Main Roof';
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  gotoTab('roof'); try { redrawAll(); } catch(e){}
}, GEOM);
await pg.waitForTimeout(1500);

// ── the canvas ─────────────────────────────────────────────────────
// The canvas is pixels, so the assertion is on what the drawing code asks
// for: no fillText carrying a roof's name, in View-All or on one roof.
const canvasDraws = await pg.evaluate(() => {
  const names = DRAW.roofs.map((r, i) => r.name || ('Roof ' + (i+1)));
  const drawn = [];
  const proto = CanvasRenderingContext2D.prototype;
  const realFill = proto.fillText, realStroke = proto.strokeText;
  proto.fillText   = function(t){ drawn.push(String(t)); return realFill.apply(this, arguments); };
  proto.strokeText = function(t){ drawn.push(String(t)); return realStroke.apply(this, arguments); };
  const out = {};
  try {
    DRAW.showAllRoofs = true; redrawAll();
    out.all = drawn.filter(t => names.indexOf(t) >= 0);
    out.allCount = drawn.length;
    drawn.length = 0;
    DRAW.showAllRoofs = false; redrawAll();
    out.single = drawn.filter(t => names.indexOf(t) >= 0);
  } finally {
    proto.fillText = realFill; proto.strokeText = realStroke;
    DRAW.showAllRoofs = true; redrawAll();
  }
  out.names = names;
  return out;
});
check('viewing all roofs, the canvas draws no roof name',
  canvasDraws.all.length === 0, canvasDraws.all.join(', ') || 'none');
check('…on a single roof either', canvasDraws.single.length === 0,
  canvasDraws.single.join(', ') || 'none');
check('…while the canvas is still drawing its measurements',
  canvasDraws.allCount > 20, canvasDraws.allCount + ' text draws');

// ── the job pack's basic map ───────────────────────────────────────
const basic = await pg.evaluate(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:-9999px;width:600px';
  document.body.appendChild(d);
  _renderMatRoofMapBasic(d);
  const svg = d.querySelector('svg');
  const texts = svg ? [...svg.querySelectorAll('text')].map(t => t.textContent) : [];
  const groups = svg ? svg.querySelectorAll('g[data-basic-label]').length : 0;
  d.remove();
  const names = DRAW.roofs.map((r, i) => r.name || ('Roof ' + (i+1)));
  return { texts, groups,
           leaked: texts.filter(t => names.indexOf(t) >= 0),
           areas: texts.filter(t => /m²/.test(t)) };
});
check('the job pack map carries no roof name', basic.leaked.length === 0,
  basic.leaked.join(', ') || 'none');
check('…but every roof still shows its area', basic.areas.length === 6,
  basic.areas.join(', '));
check('…and each label is still its own draggable group',
  basic.groups === 6, basic.groups + ' groups');
check('…with nothing left in the label but the area',
  basic.texts.length === basic.areas.length, JSON.stringify(basic.texts));

// The label editor's "Label size" slider drove the name that is now gone.
const sliders = await pg.evaluate(() => {
  const html = (typeof _jpBasicEditorSetScale === 'function') ? String(_jpBasicEditorSetScale) : '';
  return { fn: !!html };
});
check('the basic-map label editor still exists', sliders.fn);

// ── the customer's quote keeps the names ───────────────────────────
await pg.evaluate(() => { gotoTab('quote'); try { calcLabour(); } catch(e){}
  try { refreshQuoteProposal(); } catch(e){} });
await pg.waitForTimeout(1900);
const quote = await pg.evaluate(() => {
  const svg = _qpRoofMapSvg({ showBg:false, maxH:260 });
  const names = DRAW.roofs.map((r, i) => r.name || ('Roof ' + (i+1)));
  // The renderer drops the space in the generated "Roof N" names but keeps it
  // in a name the office typed, so accept either form.
  const has = n => svg.indexOf('>' + n + '<') >= 0 ||
                   svg.indexOf('>' + n.replace(/\s+/g, '') + '<') >= 0;
  return { found: names.filter(has), main: has('Main Roof'), len: svg.length };
});
check('the customer’s quote map still names every roof',
  quote.found.length === 6, quote.found.join(', '));
check('…including a renamed one', quote.main, 'Main Roof present');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
