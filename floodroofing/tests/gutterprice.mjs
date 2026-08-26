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
await opg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
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
await ppg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
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
await ppg.evaluate(() => { try { calcLabour(); } catch(e){} renderPerRoofBreakdown(); });
await ppg.waitForTimeout(600);
let pr = await ppg.evaluate(() => {
  const box = document.getElementById('perRoofBreakdownCard');
  return { shown: getComputedStyle(box).display !== 'none',
           text: (box.textContent||'').replace(/\s+/g,' '),
           // Count the ROOF CARDS carrying a Guttering row, not every mention
           // (the card's own intro paragraph names it too).
           gutters: Array.from(box.querySelectorAll('[onclick^="_setPricingRoof"]'))
                      .filter(c => /Guttering/.test(c.textContent||'')).length,
           runs: DRAW.roofs.map((r,i) => _gutterRunForRoofIdx(i)),
           prices: DRAW.roofs.map((r,i) => _gutterPriceForRoof(i)) };
});
check('every roof on the breakdown carries a gutter line',
  pr.shown && pr.gutters === DRAW_ROOFS_EXPECTED, 'roofs with a Guttering row: ' + pr.gutters);
check('…each priced off that roof\'s own gutter run',
  pr.runs.every(r => r.lm > 0) && pr.prices.every(p => p > 0) && pr.prices[0] !== pr.prices[1],
  JSON.stringify({runs:pr.runs, prices:pr.prices.map(x=>+x.toFixed(2))}));
check('…without either roof having guttering on the customer\'s quote yet',
  /optional/.test(pr.text) && !/on the quote/.test(pr.text));
await ppg.locator('#perRoofBreakdownCard').screenshot({ path: S+'/gutter_perroof.png' });

await ppg.evaluate(() => { _toggleGutterExcluded(true); renderPerRoofBreakdown(); });
await ppg.waitForTimeout(500);
pr = await ppg.evaluate(() => ({
  text: (document.getElementById('perRoofBreakdownCard').textContent||'').replace(/\s+/g,' '),
  prices: DRAW.roofs.map((r,i) => _gutterPriceForRoof(i)) }));
check('excluding gutter zeroes it on every roof too',
  pr.prices.every(p => p === 0) && (pr.text.match(/excluded/g)||[]).length >= 2, JSON.stringify(pr.prices));
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
