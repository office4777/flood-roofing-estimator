// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const DRAW_ROOFS_EXPECTED = 2;
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// ── OFFICE ────────────────────────────────────────────────────────
const octx = await b.newContext({ viewport:{width:1500,height:1000} });
const opg = await octx.newPage();
opg.on('pageerror', e => console.log('PAGEERROR', e.message));
await opg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await opg.addInitScript(() => { window.__DEFAULT_QUOTE_STYLE = 'classic'; /* these pins are about the document */ localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await opg.goto('file://'+DIR+'/app.html');
await opg.waitForTimeout(2600);

// A perfectly ordinary job: no gutter taken up by anyone.
await opg.evaluate(() => {
  S.quote = Object.assign(defaultQuote(), {
    gstRate: 15, gutterLm: 42.5, gutterLines: 2, scaffoldBase: 3200,
    proposalOptions: {}, gutterChoice: 'none', options: [], lineItems: []
  });
  S.quote.gutterPrices = { marley: 0, box: 0 };
  gotoTab('quote');
});
await opg.waitForTimeout(400);
await opg.evaluate(() => renderGutterDownpipePricing());
await opg.waitForTimeout(300);

let v = await opg.evaluate(() => {
  const card = document.getElementById('gutterDownpipeCard');
  const wrap = document.getElementById('gutterDownpipeWrap');
  return {
    cardShown: !!card && getComputedStyle(card).display !== 'none',
    text: (wrap.textContent||'').replace(/\s+/g,' ').trim(),
    types: Array.from(wrap.querySelectorAll('select option')).map(o=>o.value),
    picked: (wrap.querySelector('select')||{}).value,
    total: (wrap.textContent.match(/\$[\d,]+\.\d\d/g)||[]).slice(-1)[0],
    hasExclude: /Exclude gutter pricing/.test(wrap.textContent||''),
  };
});
check('gutter is priced on a job where nobody has selected it', v.cardShown && /lm gutter run/.test(v.text), v.text.slice(0,90));
check('…against a real product, with the others offered',
  v.picked === 'marley_typhoon' && v.types.join(',') === 'box125,marley_typhoon,marley_classic', JSON.stringify(v));
check('…and it comes to a real number, not $0.00', !!v.total && v.total !== '$0.00', 'total ' + v.total);
check('…labelled as priced but not yet on the quote', /Priced, not yet on the quote/.test(v.text));
check('the office can exclude it from right here', v.hasExclude);
await opg.locator('#gutterDownpipeCard').screenshot({ path: S+'/gutter_priced.png' });

// switching the priced product moves the money
const cheap = await opg.evaluate(() => { _setGutterPricingType('marley_classic'); return _gutterPricingType(); });
await opg.waitForTimeout(300);
const v2 = await opg.evaluate(() => (document.getElementById('gutterDownpipeWrap').textContent.match(/\$[\d,]+\.\d\d/g)||[]).slice(-1)[0]);
check('pricing against a different gutter changes the price', cheap === 'marley_classic' && v2 !== v.total, v.total + ' → ' + v2);
check('…without silently putting gutter on the customer\'s quote',
  await opg.evaluate(() => (S.quote.proposalOptions.gutterType || 'none') === 'none'));

// the customer takes guttering up → the card follows their pick
await opg.evaluate(() => { _setProposalOption('gutterType','box125'); renderGutterDownpipePricing(); });
await opg.waitForTimeout(400);
const v3 = await opg.evaluate(() => {
  const w = document.getElementById('gutterDownpipeWrap');
  return { picked:(w.querySelector('select')||{}).value, on:/On the customer's quote/.test(w.textContent) };
});
check('once guttering is on the quote the card prices exactly that product',
  v3.picked === 'box125' && v3.on, JSON.stringify(v3));

// THE BOX GUTTER (the owner, 2026-09-30): "$21/lm for the gutter and
// brackets combined, no bends or any other accessories required except an
// 80mm dropper every 8 m" — two rows, never fewer than one dropper per run,
// and the gutter is NOT counted in the roofing material table as well.
const kit = await opg.evaluate(() => {
  const rows = _gutterMaterialLines('box125', 54, 3, 4);
  const shown = [...document.querySelectorAll('#gutterDownpipeWrap table')].map(t => t.textContent).join(' ');
  let roofRows = [];
  try { roofRows = _buildMaterialPriceRows().map(r => r.label); } catch(e){ roofRows = ['ERR ' + e.message]; }
  return { rows: rows.map(r => r.desc + ':' + r.qty + r.unit), perLm: rows[0] && rows[0].price, dropperEa: _gutterDropperEa(), shown: /brackets included/.test(shown) && /80mm droppers \(1 \/ 8m\)/.test(shown), roofRows };
});
check('a 54 m box gutter on three runs is the gutter with its brackets, and 7 droppers — nothing else',
  kit.rows.join('|') === '125mm Colorsteel box gutter, brackets included:54lm|80mm droppers (1 / 8m):7ea' && kit.dropperEa > 0, JSON.stringify(kit.rows));
check('…and the card shows them', kit.shown);
check('a short run still gets one dropper per run', await opg.evaluate(() => _gutterMaterialLines('box125', 6, 2, 0).filter(r => /droppers/i.test(r.desc))[0].qty) === 2);
check('the gutter is no longer counted in the ROOFING material table', !kit.roofRows.some(l => /^Gutter$/.test(l)), kit.roofRows.join(', '));

// ── MARLEY CLASSIC, itemised like Typhoon (2026-09-30) ──
const classic = await opg.evaluate(() => _gutterMaterialLines('marley_classic', 30, 2, 2).map(r => r.desc.replace(/\s*\(.*\)$/, '') + ':' + r.qty + ':' + r.price));
check('Marley Classic is priced item by item — spouting, brackets every 500 mm, outlets, joiners, angles, stop ends',
  classic.some(x => /^Marley Classic spouting \(supply\):30:20$/.test(x) || /^Marley Classic spouting:30:20$/.test(x)) &&
  classic.some(x => /^Marley Classic internal brackets:60:4\.7$/.test(x)) &&
  classic.some(x => /^Marley Classic 80mm dropper outlets:2:/.test(x)) &&
  classic.some(x => /^Marley Classic angles:2:33\.48$/.test(x) || /^Marley Classic angles \(int\/ext\):2:33\.48$/.test(x)) &&
  classic.some(x => /^Marley Classic stop ends:4:7\.15$/.test(x) || /^Marley Classic stop ends \(LH\/RH\):4:7\.15$/.test(x)), JSON.stringify(classic));

// ── a blank price-book box is "not priced", not "free" (2026-09-30) ──
const zero = await opg.evaluate(() => {
  const g = S.settings.price_book.gutter, was = g.box125_lm, wasQ = S.quote.gutterUnitPrices;
  g.box125_lm = 0; S.quote.gutterUnitPrices = { perlm_box125: 0 };
  const perLm = _gutterMaterialPerLm('box125');
  g.box125_lm = was; S.quote.gutterUnitPrices = wasQ;
  return perLm;
});
check('a box-gutter price saved blank (0) falls back to $21/lm instead of pricing the gutter at nothing', zero === 21, String(zero));

// ── custom gutter lines are the gutter's material (2026-09-30) ──
// "that custom added in price for 125mm box gutter didn't increase the pricing
// tab total but did increase the quote's total, which is very wrong."
const cust = await opg.evaluate(async () => {
  const tot = () => Math.round(_quoteMoney().tot * 100) / 100;
  _setProposalOption('gutterType', 'none'); renderGutterDownpipePricing();
  const noneBefore = tot(), cardBefore = window._gdCardTotal;
  const matBefore = _gutterMaterialCharge('box125', 54, 3, 4);
  S.quote.customLines = S.quote.customLines || {};
  S.quote.customLines.gutter = [{ desc: 'material', qty: 1, unit: 1800, amount: 1800 }];
  try { resyncQuoteLines(); } catch(e){}
  renderGutterDownpipePricing();
  const cardAfter = window._gdCardTotal, noneAfter = tot();
  const matAfter = _gutterMaterialCharge('box125', 54, 3, 4);
  const mul = (1 + _gutterMatQtyBufferPct() / 100) * (1 + _gutterMatMarkupPct() / 100);
  const inBase = (S.quote.lineItems || []).some(l => l && l._custom && l._area === 'gutter');
  _setProposalOption('gutterType', 'box125'); renderGutterDownpipePricing();
  const withGutter = tot();
  S.quote.customLines.gutter = []; try { resyncQuoteLines(); } catch(e){}
  renderGutterDownpipePricing();
  const withGutterNoCustom = tot();
  return { noneBefore, noneAfter, cardBefore, cardAfter, matGrew: Math.round((matAfter - matBefore) * 100) / 100, expect: Math.round(1800 * mul * 100) / 100, inBase, withGutter, withGutterNoCustom };
});
check('a custom gutter line counts on the Pricing card — its total goes up by it', cust.cardAfter - cust.cardBefore > 1799, JSON.stringify(cust));
check('…at the card\'s own buffer and mark-up, like every other gutter row', Math.abs(cust.matGrew - cust.expect) < 0.02, JSON.stringify(cust));
check('…and with "No new guttering" picked it does NOT raise the customer\'s total', cust.noneAfter === cust.noneBefore && !cust.inBase, JSON.stringify(cust));
check('…while picking a gutter carries it in that gutter\'s price', cust.withGutter - cust.withGutterNoCustom > 1799, JSON.stringify(cust));


// ── EXCLUDE ───────────────────────────────────────────────────────
await opg.evaluate(() => _toggleGutterExcluded(true));
await opg.waitForTimeout(600);
const ex = await opg.evaluate(() => {
  const w = document.getElementById('gutterDownpipeWrap');
  return {
    txt: (w.textContent||'').replace(/\s+/g,' ').trim(),
    stillTickable: !!w.querySelector('input[type=checkbox]'),
    gt: S.quote.proposalOptions.gutterType,
    dp: S.quote.proposalOptions.downpipes,
    choice: S.quote.gutterChoice,
    deltas: [_selGutterDelta('box125'), _selDownpipeDelta(), _selBracketExtDelta(), _gutterDelta()],
    priced: !!document.getElementById('gutterDownpipeWrap').querySelector('table'),
  };
});
check('excluding it says so on the Pricing tab', /excluded from this job/i.test(ex.txt), ex.txt.slice(0,80));
check('…stops pricing it', !ex.priced);
check('…drops any gutter the quote had taken up',
  ex.gt === 'none' && ex.dp === 'no' && ex.choice === 'none', JSON.stringify(ex));
check('…and zeroes every gutter charge', ex.deltas.every(d => d === 0), JSON.stringify(ex.deltas));
check('…while leaving the tick there to undo it', ex.stillTickable);
await opg.locator('#gutterDownpipeCard').screenshot({ path: S+'/gutter_excluded.png' });

// the Selections page: office sees the tick, no gutter cards
const selOffice = await opg.evaluate(() => {
  refreshQuoteProposal();
  const root = document.getElementById('qpRoot');
  const t = (root.textContent||'').replace(/\s+/g,' ');
  return {
    gutterPanel: /Exclude gutter pricing/.test(t),
    gutterCards: root.querySelectorAll('[onclick*="_setProposalOption_gutter"]').length,
    bracketCards: root.querySelectorAll('[onclick*="_setProposalOption_bracket"]').length,
    dpCards: root.querySelectorAll('[onclick*="_setProposalOption_downpipes"]').length,
    spouting: /The spouting/.test(t),
  };
});
check('the Selections page offers no gutter, bracket or downpipe choice',
  selOffice.gutterCards === 0 && selOffice.bracketCards === 0 && selOffice.dpCards === 0, JSON.stringify(selOffice));
check('…and the informational spouting page is gone too', !selOffice.spouting);
check('…but the office keeps the tick that puts it all back', selOffice.gutterPanel);

// put it back
await opg.evaluate(() => { _toggleGutterExcluded(false); refreshQuoteProposal(); });
await opg.waitForTimeout(700);
const back = await opg.evaluate(() => {
  const root = document.getElementById('qpRoot');
  return { cards: root.querySelectorAll('[onclick*="_setProposalOption_gutter"]').length,
           priced: !!document.getElementById('gutterDownpipeWrap').querySelector('table'),
           tick: /Exclude gutter pricing/.test(root.textContent||'') };
});
check('unticking puts the gutter choice back on the Selections page',
  back.cards >= 3 && back.priced && back.tick, JSON.stringify(back));
await octx.close();

// ── PER-ROOF BREAKDOWN — a gutter figure against every roof ────────
const pctx = await b.newContext({ viewport:{width:1500,height:1000} });
const ppg = await pctx.newPage();
ppg.on('pageerror', e => console.log('PAGEERROR', e.message));
ppg.on('dialog', d => d.accept());
await ppg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await ppg.addInitScript(() => { window.__DEFAULT_QUOTE_STYLE = 'classic'; /* these pins are about the document */ localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await ppg.goto('file://'+DIR+'/app.html');
await ppg.waitForTimeout(2400);
// Two real drawn roofs, each auto-generated (so each gets its own gutter run).
await ppg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[100,100],[500,100],[500,400],[100,400]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.02;
  autoGenerateRoof('gable');
  _addAndSwitchToNewRoof(); setTool('outline');
  DRAW.currentPts = [[700,150],[1000,150],[1000,350],[700,350]]; finishCurrent();
  autoGenerateRoof('gable');
  gotoTab('quote');
});
await ppg.waitForTimeout(1400);
await ppg.evaluate(() => { try { calcLabour(); } catch(e){} });
await ppg.waitForTimeout(600);
// The per-roof breakdown card is gone; what it pinned — guttering priced per
// roof off that roof's own run, optional until the customer takes it — is
// pinned on the helpers themselves.
let pr = await ppg.evaluate(() => ({
  runs: DRAW.roofs.map((r,i) => _gutterRunForRoofIdx(i)),
  prices: DRAW.roofs.map((r,i) => _gutterPriceForRoof(i)),
  onQuote: _gutterOnQuote() }));
check('every roof carries a gutter price', pr.prices.length === DRAW_ROOFS_EXPECTED && pr.prices.every(p => p > 0), 'roofs priced: ' + pr.prices.filter(p => p > 0).length);
check('…each priced off that roof\'s own gutter run',
  pr.runs.every(r => r.lm > 0) && pr.prices.every(p => p > 0) && pr.prices[0] !== pr.prices[1],
  JSON.stringify({runs:pr.runs, prices:pr.prices.map(x=>+x.toFixed(2))}));
check('…without either roof having guttering on the customer\'s quote yet', !pr.onQuote);

await ppg.evaluate(() => { _toggleGutterExcluded(true); });
await ppg.waitForTimeout(500);
pr = await ppg.evaluate(() => ({ prices: DRAW.roofs.map((r,i) => _gutterPriceForRoof(i)) }));
check('excluding gutter zeroes it on every roof too', pr.prices.every(p => p === 0), JSON.stringify(pr.prices));
await pctx.close();

// ── CUSTOMER ──────────────────────────────────────────────────────
async function customer(q){
  const ctx = await b.newContext({ viewport:{width:1200,height:900} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
    /\/q\//.test(r.request().url())
      ? r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quote:q,branding:{}})})
      : r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.goto('file://'+DIR+'/app.html?q=tok&j=FR-1');
  await pg.waitForTimeout(3200);
  return { ctx, pg };
}
const base = () => ({ ref:'FR-1', client:'Mrs Hale', gstRate:15, gutterLm:42.5, gutterLines:2,
  scaffoldBase:3200, proposalOptions:{}, gutterChoice:'none', gutterPrices:{marley:0,box:0},
  options:[], lineItems:[], total:0, proposalSections:{} });

let { ctx, pg } = await customer(base());
let cv = await pg.evaluate(() => {
  const root = document.getElementById('qpRoot'); const t = (root.textContent||'').replace(/\s+/g,' ');
  return { cards: root.querySelectorAll('[onclick*="_setProposalOption_gutter"]').length,
           tick: /Exclude gutter pricing/.test(t) };
});
check('a normal quote still offers the customer their gutter choice', cv.cards >= 3, JSON.stringify(cv));
check('…and never shows them the office-only exclusion tick', !cv.tick);
await ctx.close();

const exq = base(); exq.gutterExcluded = true;
({ ctx, pg } = await customer(exq));
cv = await pg.evaluate(() => {
  const root = document.getElementById('qpRoot'); const t = (root.textContent||'').replace(/\s+/g,' ');
  return { cards: root.querySelectorAll('[onclick*="_setProposalOption_gutter"]').length,
           br: root.querySelectorAll('[onclick*="_setProposalOption_bracket"]').length,
           tick: /Exclude gutter pricing/.test(t), guttering: /Guttering/.test(t), spouting: /The spouting/.test(t) };
});
check('an excluded job offers the customer no guttering at all',
  cv.cards === 0 && cv.br === 0 && !cv.guttering && !cv.spouting, JSON.stringify(cv));
check('…and still hides the office tick from them', !cv.tick);
await pg.screenshot({ path: S+'/gutter_customer_excluded.png' });
await ctx.close();

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
