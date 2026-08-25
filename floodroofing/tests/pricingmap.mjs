// "It's confusing that page 2 shows the roofs all included by default but the
//  pricing map shows all extra roofs excluded. I don't want the pricing map to
//  show a tick or a cross — I only want the roof I'm pricing highlighted and
//  the rest grey."
//
// Two maps of the same house, disagreeing about the same roofs. They were
// drawn by one function answering one question — "what is the customer
// buying" — and the Pricing tab is asking a different one: "which building am
// I pricing right now". A red cross there meant "not yet in the customer's
// selection", which has nothing to do with the labour and scaffold on screen.
//
// Under a highlight the included / excluded language is dropped entirely.
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
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2000);

const map = () => pg.evaluate(() => {
  const h = document.getElementById('pricingRoofMap');
  return h ? h.innerHTML : '';
});
const svgOnly = s => s.slice(s.indexOf('<svg'));

// Nothing is selected into the customer's quote, which is precisely when the
// old map covered the page in red crosses.
await pg.evaluate(() => {
  S.quote = S.quote || {};
  S.quote.proposalOptions = S.quote.proposalOptions || {};
  S.quote.proposalOptions.extraRoofsSel = {};
  _setPricingRoof(0);
});
await pg.waitForTimeout(900);
let m = await map();
check('the pricing map renders for a multi-roof job', m.indexOf('<svg') >= 0,
  m ? (m.length + ' chars') : 'empty');
check('…with no green ticks on it', !/#16a34a/.test(m));
// The cross is a <g> of two crossing lines; a lone #dc2626 stroke is the
// roof's own ridge line, which belongs on the highlighted roof.
check('…and no red crosses', !/<g stroke="#dc2626"/.test(svgOnly(m)),
  (svgOnly(m).match(/<g stroke="#dc2626"/g)||[]).length + ' cross groups');
check('…though the highlighted roof keeps its own red ridge line',
  /stroke="#dc2626"/.test(svgOnly(m)));
check('…and it never says a roof is not included',
  !/Not included|tap to add/.test(m), (m.match(/Not included|tap to add/g)||[]).join(','));
check('…the excluded-roof red fill is gone too', !/#fee2e2/.test(m));

// One roof bright, the rest grey.
const shade = await pg.evaluate(() => {
  const svg = document.querySelector('#pricingRoofMap svg');
  const polys = [...svg.querySelectorAll('polygon')];
  const fills = polys.map(p => p.getAttribute('fill'));
  return { total: fills.length,
           bright: fills.filter(f => f === '#fde68a').length,
           grey: fills.filter(f => f === '#e9edf3').length,
           ring: fills.filter(f => f === 'none').length };
});
check('exactly one roof is picked out in full colour', shade.bright === 1, JSON.stringify(shade));
check('…every other roof is grey', shade.grey === shade.total - shade.bright - shade.ring,
  JSON.stringify(shade));
check('…and the bright one wears the amber ring', shade.ring === 1, JSON.stringify(shade));

// The highlight follows the roof switcher, which is the whole point.
const follows = await pg.evaluate(async () => {
  const out = [];
  for (const i of [0, 2, 4]){
    _setPricingRoof(i);
    await new Promise(r => setTimeout(r, 250));
    const svg = document.querySelector('#pricingRoofMap svg');
    // The bright polygon's own label is the roof being priced.
    const polys = [...svg.querySelectorAll('polygon')];
    const bi = polys.findIndex(p => p.getAttribute('fill') === '#fde68a');
    const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
    out.push({ i, banner: (document.getElementById('pricingRoofMap').innerText||'').split('\n')[0],
               brightAt: bi, name: _pricingRoofName(i), texts });
  }
  return out;
});
follows.forEach(f => {
  check('  switching to ' + f.name + ' highlights it and says so',
    f.brightAt >= 0 && new RegExp(f.name.replace(/\s+/g,'\\s*'), 'i').test(f.banner),
    f.banner + ' | bright poly #' + f.brightAt);
});

// Every roof still carries its own area — that IS useful when pricing.
const areas = await pg.evaluate(() => {
  const svg = document.querySelector('#pricingRoofMap svg');
  return [...svg.querySelectorAll('text')].map(t => t.textContent)
    .filter(t => /m²/.test(t)).length;
});
check('every roof still shows its area', areas >= 5, areas + ' area labels');

// ── the customer's own map is untouched ────────────────────────────
// It answers a different question and must keep answering it: ticks for what
// the quote covers, crosses for what it doesn't.
const customer = await pg.evaluate(() => {
  const svg = _qpRoofMapSvg({ showBg: false, maxH: 200 });
  return { tick: /#16a34a/.test(svg), cross: /#dc2626/.test(svg),
           words: /Not included|tap to add/.test(svg), len: svg.length };
});
check('the customer’s roof plan still ticks what the quote covers', customer.tick,
  JSON.stringify(customer));
check('…and still crosses what it does not', customer.cross, JSON.stringify(customer));
check('…and still says so in words', customer.words, JSON.stringify(customer));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
