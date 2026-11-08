// THE SCAFFOLD: ON THE QUOTE OR NOT, OURS OR OUTSOURCED (2026-11-04, the
// owner: "have a button to click to exclude scaffold from this quote ... in the
// gutter job type, always default the scaffold to not included and collapse the
// scaffolding section ... 'Do it ourselves' or 'outsource' ... default the
// scaffolding labour time to 4 hrs on a house 0-50m2 ... 15hrs on 330m2 + ...
// when pushing the pricing to fergus, if the scaffolding is set to 'Do it
// ourselves' then those labour hours are put as labour hours in it's own ...
// section", and "if there's no scaffolding required then it doesn't say it in
// the 'what we will do'"; on a gutters job "Remove existing spouting" without
// the downpipes when they are kept, and the new gutter just below the brackets).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? JSON.stringify({ branding:{ company_name:'Flood Roofing' },
    labour_pricing:{ lead_price:180, lead_cost:45, app_price:70, app_cost:25, scaffold_price:2500, scaffold_cost:2000 } }) : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); localStorage.removeItem('fr_pricingFold'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// ── the area tiers ──
let v = await pg.evaluate(() => [0, 50, 51, 100, 101, 160, 161, 230, 231, 330, 331, 900].map(_scaffoldDiyHrsForArea));
check('the do-it-ourselves hours follow the roof area: 4 / 6 / 8 / 10 / 12 / 15',
  JSON.stringify(v) === JSON.stringify([4,4,6,6,8,8,10,10,12,12,15,15]), JSON.stringify(v));

// ── a roofing job: outsourced by default, unchanged ──
v = await pg.evaluate(async () => {
  await loadSettings();
  _resetQuoteForFreshJob({ client:'Ann Test', addr:'1 Test Road' });
  _setJobType('roofing');
  window._labourAreaForRoof = function(){ return 182; };
  _openPricingPanel(true); await new Promise(r => setTimeout(r, 300));
  calcLabour();
  const sc = S.quote.scaffold;
  const w = document.getElementById('scaffoldWrap');
  return { excl: !!sc.excluded, mode: sc.mode || 'out', price: _scaffoldEff(sc).price,
    incl: !!w.querySelector('#scIncl'), modeBtns: !!w.querySelector('#scMode'),
    boxes: w.querySelectorAll('input[onchange*="updateScaffold("]').length,
    line: (S.quote.lineItems || []).filter(l => l._base === 'scaffold').map(l => +l.unit) };
});
check('a roofing job starts with the scaffold on the quote, outsourced, at the Settings price',
  !v.excl && v.mode === 'out' && v.price === 2500 && v.boxes === 2, JSON.stringify(v));
check('…and the card carries Scaffolding included / No scaffolding and Do it ourselves / Outsource', v.incl && v.modeBtns, JSON.stringify(v));

// ── do it ourselves ──
v = await pg.evaluate(async () => {
  _scaffoldSetMode('diy'); await new Promise(r => setTimeout(r, 100));
  const sc = S.quote.scaffold, e = _scaffoldEff(sc), w = document.getElementById('scaffoldWrap');
  return { d: sc.diy, price: e.price, cost: e.cost, table: !!w.querySelector('#scDiyTable'),
    boxes: w.querySelectorAll('input[onchange*="updateScaffold("]').length, text: w.innerText,
    head: (document.getElementById('pxTot_scaffoldCard') || {}).textContent || '' };
});
check('Do it ourselves: 182 m² gives the lead and the apprentice 10 hrs each', v.d.leadHrs === 10 && v.d.appHrs === 10, JSON.stringify(v.d));
check('…at the roof labour table\'s rates: 10 × $180 + 10 × $70 = $2,500 charged, 10 × $45 + 10 × $25 = $700 cost',
  v.price === 2500 && v.cost === 700, JSON.stringify([v.price, v.cost]));
check('…shown as a Lead Roofer / Apprentice hours table, the cost / price boxes gone', v.table && v.boxes === 0 && /Lead Roofer/.test(v.text) && /Apprentice/.test(v.text), v.text.slice(0, 200));
check('…and the heading says it is our crew', /our crew/.test(v.head), v.head);

v = await pg.evaluate(async () => {
  window._labourAreaForRoof = function(){ return 40; }; calcLabour();
  const a = S.quote.scaffold.diy.leadHrs;
  _scaffoldDiyUpd('leadHrs', '6'); window._labourAreaForRoof = function(){ return 400; }; calcLabour();
  const b = [S.quote.scaffold.diy.leadHrs, S.quote.scaffold.diy.appHrs];
  _scaffoldDiyUpd('appPrice', '80');
  const c = _scaffoldEff(S.quote.scaffold).price;
  _scaffoldDiyReset();
  const d = [S.quote.scaffold.diy.leadHrs, S.quote.scaffold.diy.appPrice];
  const line = (S.quote.lineItems || []).filter(l => l._base === 'scaffold').map(l => +l.unit);
  return { a, b, c, d, line, eff: _scaffoldEff(S.quote.scaffold).price };
});
check('a smaller roof gives fewer hours (40 m² → 4)', v.a === 4, JSON.stringify(v));
check('hours typed stay typed when the roof changes (both rows, the apprentice keeping its 4)', v.b[0] === 6 && v.b[1] === 4, JSON.stringify(v.b));
check('a rate typed here is this scaffold\'s: 6 × $180 + 4 × $80 = $1,400', v.c === 1400, String(v.c));
check('↻ puts the hours back on the roof area and the rates back on the labour table', v.d[0] === 15 && v.d[1] === 70, JSON.stringify(v.d));
check('the quote\'s Scaffolding line is the crew\'s price', v.line.length === 1 && v.line[0] === v.eff && v.eff === 15 * 180 + 15 * 70, JSON.stringify(v));

// ── Fergus: the crew's hours are LABOUR in a Scaffolding section ──
v = await pg.evaluate(() => {
  const plan = _buildFergusItemisedSections({ base: true });
  return plan.sections.map(s => ({ name: s.name, items: s.lineItems.map(li => [li.itemName, li.itemQuantity, li.itemPrice, li.isLabour]) }));
});
const scSec = v.find(s => s.name === 'Scaffolding');
check('pushed to Fergus, do-it-ourselves scaffolding is its own Scaffolding section of labour lines',
  scSec && scSec.items.length === 2 && scSec.items.every(i => i[3] === true) &&
  /Lead Roofer/.test(scSec.items[0][0]) && scSec.items[0][1] === 15 && scSec.items[0][2] === 180 &&
  /Apprentice/.test(scSec.items[1][0]) && scSec.items[1][2] === 70, JSON.stringify(v));
check('…and none of it is folded into the materials', !v.some(s => s.name === 'Materials' && s.items.some(i => /scaffold/i.test(i[0]))), JSON.stringify(v));

v = await pg.evaluate(() => {
  _scaffoldSetMode('out');
  const plan = _buildFergusItemisedSections({ base: true });
  return { sec: plan.sections.map(s => s.name), mat: (plan.sections.find(s => s.name === 'Materials') || { lineItems: [] }).lineItems.filter(li => /scaffold/i.test(li.itemName)).map(li => [li.itemPrice, li.isLabour]) };
});
check('outsourced, it goes to Fergus as it always did — one material line in Materials', v.sec.indexOf('Scaffolding') < 0 && v.mat.length === 1 && v.mat[0][0] === 2500 && v.mat[0][1] === false, JSON.stringify(v));

// ── What we will do, roofing ──
v = await pg.evaluate(() => {
  const on = _qbInclusionLines();
  _scaffoldSetExcluded(true);
  const off = _qbInclusionLines();
  const plan = _buildFergusItemisedSections({ base: true });
  const r = { on, off, eff: _scaffoldEff(S.quote.scaffold).price, line: (S.quote.lineItems || []).filter(l => l._base === 'scaffold').length,
    head: (document.getElementById('pxTot_scaffoldCard') || {}).textContent || '', note: !!document.getElementById('scOffNote'),
    modeBtns: !!document.querySelector('#scaffoldWrap #scMode'),
    fg: plan.sections.some(s => s.lineItems.some(li => /scaffold/i.test(li.itemName))),
    uplift: _selScaffoldBasePrice() };
  return r;
});
check('roofing, scaffold on: What we will do opens with Edge-Protection / Scaffolding', /scaffold/i.test(v.on[0]), JSON.stringify(v.on));
check('No scaffolding: nothing charged and no Scaffolding line on the quote', v.eff === 0 && v.line === 0, JSON.stringify(v));
check('…What we will do leaves the scaffold out', !v.off.some(l => /scaffold|edge.?protection/i.test(l)) && v.off.length === v.on.length - 1, JSON.stringify(v.off));
check('…the heading reads Excluded, the card says why, and the do-it-ourselves choice is put away', /Excluded/.test(v.head) && v.note && !v.modeBtns, JSON.stringify(v));
check('…Fergus gets no scaffolding and a gutter has no platform upgrade to charge', !v.fg && v.uplift === 0, JSON.stringify(v));
v = await pg.evaluate(() => { _scaffoldSetExcluded(false); return { l: _qbInclusionLines()[0], p: _scaffoldEff(S.quote.scaffold).price }; });
check('…and Scaffolding included puts it all back', /scaffold/i.test(v.l) && v.p === 2500, JSON.stringify(v));

// ── the quote summary carries the scaffold priced here, plus GST; Hide / Show ──
v = await pg.evaluate(async () => {
  DRAW.scaleMetresPerPx = 0.05; DRAW.outline = [[100,100],[500,100],[500,350],[100,350]]; DRAW.lines = []; DRAW.calPitch = 15;
  autoGenerateRoof('gable'); try { renderMaterialPriceTable(); } catch(e){}
  _scaffoldSetExcluded(false); _scaffoldSetMode('diy'); calcLabour();
  const money = t => parseFloat(String(t).replace(/[^0-9.]/g, ''));
  const g = 1 + (+S.quote.gstRate || 0) / 100;
  const rows = () => _custBarRows().map(r => [r.kind, money(r.value), r.label]);
  const eff1 = _scaffoldEff(S.quote.scaffold).price, r1 = rows();
  _scaffoldSetMode('out'); calcLabour();
  const eff2 = _scaffoldEff(S.quote.scaffold).price, r2 = rows();
  const note = (document.getElementById('scOnQuote') || {}).textContent || '';
  S.quote.style = 'modern'; gotoTab('quote'); await new Promise(r => setTimeout(r, 300)); refreshQuoteProposal(); await new Promise(r => setTimeout(r, 200));
  const hideBtn = Array.from(document.querySelectorAll('#qpRoot .qb-sc-tog button')).map(b => b.textContent);
  _qpScaffoldHide(true); await new Promise(r => setTimeout(r, 150));
  const r3 = rows(), showBtn = Array.from(document.querySelectorAll('#qpRoot .qb-sc-tog button')).map(b => b.textContent);
  window.__CUSTOMER_MODE = true; refreshQuoteProposal(); const custBtns = document.querySelectorAll('#qpRoot .qb-sc-tog').length; window.__CUSTOMER_MODE = false;
  _qpScaffoldHide(false); const r4 = rows();
  return { g, eff1, r1, eff2, r2, note, hideBtn, r3, showBtn, custBtns, r4 };
});
const sc = r => (r.find(x => x[0] === 'scaffold') || [])[1];
const tot = r => (r.find(x => x[0] === 'total') || [])[1];
const base = r => (r.find(x => x[0] === 'base') || [])[1];
check('do it ourselves: the summary\'s Scaffolding row is the crew\'s price plus GST', Math.abs(sc(v.r1) - v.eff1 * v.g) < 0.02, JSON.stringify([v.eff1, v.r1]));
check('outsourced: the summary\'s Scaffolding row is the scaffolder\'s price plus GST', Math.abs(sc(v.r2) - v.eff2 * v.g) < 0.02, JSON.stringify([v.eff2, v.r2]));
check('…and the Pricing card says what the summary will show, incl. GST', /On the quote summary/.test(v.note) && /incl\. GST/.test(v.note), v.note);
check('the office sees "Hide scaffolding price" beside the scaffold row', v.hideBtn.some(t => /Hide scaffolding price/.test(t)), JSON.stringify(v.hideBtn));
check('hidden: no scaffold row, the re-roof line carries it, the total unchanged', !v.r3.some(x => x[0] === 'scaffold') &&
  Math.abs(base(v.r3) - (base(v.r2) + sc(v.r2))) < 0.02 && Math.abs(tot(v.r3) - tot(v.r2)) < 0.01 && /Re-roof/.test(v.r3[0][2]), JSON.stringify([v.r2, v.r3]));
check('…with "Show scaffolding price" to bring it back, and the customer sees neither button', v.showBtn.some(t => /Show scaffolding price/.test(t)) && v.custBtns === 0, JSON.stringify([v.showBtn, v.custBtns]));
check('Show puts the scaffold row back as it was', JSON.stringify(v.r4) === JSON.stringify(v.r2), JSON.stringify(v.r4));

// ── a gutters job: off by default, folded ──
v = await pg.evaluate(async () => {
  _resetQuoteForFreshJob({ client:'Irene Mears', addr:'263 Puketotara Road' });
  _setJobType('gutters');
  _pricingState(); calcLabour(); _pxFoldsApply();
  const card = document.getElementById('scaffoldCard');
  return { excl: !!S.quote.scaffold.excluded, folded: card.classList.contains('px-collapsed'),
    modeBtns: !!document.querySelector('#scaffoldWrap #scMode'), lines: _qbInclusionLines(),
    sub: _quoteMoney().sub };
});
check('a gutters job starts with No scaffolding', v.excl, JSON.stringify(v));
check('…and its scaffolding section folded', v.folded, JSON.stringify(v));
check('…with no Do it ourselves / Outsource choice on a gutters job', !v.modeBtns, JSON.stringify(v));
const gl = v.lines;
check('What we will do on a gutters job says nothing about scaffolding', !gl.some(l => /scaffold|edge.?protection/i.test(l)), JSON.stringify(gl));
check('…keeping the downpipes: "Remove existing spouting and take it away"', gl.indexOf('Remove existing spouting and take it away') >= 0 && !gl.some(l => /downpipe/i.test(l)), JSON.stringify(gl));
const iBr = gl.findIndex(l => /bracket/i.test(l)), iGu = gl.findIndex(l => /^Supply & install new/i.test(l)), iSe = gl.findIndex(l => /^Seal/i.test(l));
check('…the new gutter just below the brackets, then the joints sealed', iBr >= 0 && iGu === iBr + 1 && iSe === iGu + 1, JSON.stringify(gl));

v = await pg.evaluate(() => {
  S.quote.proposalOptions.downpipes = 'yes';
  const a = _qbInclusionLines();
  S.quote.proposalOptions.downpipes = 'no';
  _scaffoldSetExcluded(false); calcLabour();
  const b = _qbInclusionLines();
  return { a, b };
});
check('new downpipes: the old ones are taken away and the new ones go in after the gutter',
  v.a.indexOf('Remove existing spouting and downpipes and take them away') >= 0 &&
  v.a.findIndex(l => /new downpipes/i.test(l)) === v.a.findIndex(l => /^Supply & install new .*gutter/i.test(l)) + 1, JSON.stringify(v.a));
check('a gutters job with the scaffold put on says Edge-Protection / Scaffolding again', /scaffold/i.test(v.b[0]), JSON.stringify(v.b));

// the fold is the office's once touched
v = await pg.evaluate(() => {
  _pxToggle('scaffoldCard'); _pxFoldsApply();
  const open = !document.getElementById('scaffoldCard').classList.contains('px-collapsed');
  _setJobType('roofing'); calcLabour(); _pxFoldsApply();
  return { open, roofOpen: !document.getElementById('scaffoldCard').classList.contains('px-collapsed'), excl: !!S.quote.scaffold.excluded };
});
check('opened by hand, the gutters job\'s scaffold section stays open', v.open, JSON.stringify(v));
check('a scaffold the office put on is not taken off by switching job type', !v.excl, JSON.stringify(v));

v = await pg.evaluate(() => {
  _resetQuoteForFreshJob({ client:'X', addr:'Y' });
  _setJobType('roofing'); _pricingState();
  const a = !!S.quote.scaffold.excluded;
  _setJobType('gutters'); const b = !!S.quote.scaffold.excluded;
  _setJobType('roofing'); const c = !!S.quote.scaffold.excluded;
  return { a, b, c };
});
check('switching a job to gutters takes the scaffold off, and back to roofing puts it on', !v.a && v.b && !v.c, JSON.stringify(v));

// a quote from before has none of the new fields and prices as it did
v = await pg.evaluate(() => {
  const sc = { price: 1800, cost: 1500, type: 'edge' };
  return _scaffoldEff(sc);
});
check('a scaffold saved before reads exactly as it did', v.price === 1800 && v.cost === 1500 && !v.excluded && !v.diy, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
