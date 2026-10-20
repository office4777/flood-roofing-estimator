// The Pricing tab's Job profitability lists what the job is made of and
// its figures cover the lot (the owner: "job revenue in the profitability
// section should include the scaffolding because it's part of the job, also
// have this section list what's in it, so the default will be 1. Scaffolding
// 2. Roofing, then whatever's selected in the quote … so the job
// profitability, hours etc all match the quote's selections").
//
// Pinned: the two default rows; a gutter picked on the quote adds a Gutters
// row carrying the customer's price, the labour hours at the labour table's
// cost rates plus the material, and the platform uplift row; the tiles add
// the rows up; GP/hr is over every hour on the job; taking the gutter off
// takes the rows away; an extra roof's own view carries no selection rows.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(1500);
await pg.evaluate(() => gotoTab('pricing')); await pg.waitForTimeout(900);

const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1);
const rows = () => pg.evaluate(() => [...document.querySelectorAll('#profitItems .profit-item')].map(e => ({ key: e.dataset.profitItem, text: e.textContent.replace(/\s+/g, ' ').trim() })));
const fig = () => pg.evaluate(() => { const g = _profitFigures(_profitView()); return { revenue: g.revenue, cost: g.cost, hrs: g.hrs, hrsAll: g.hrsAll, items: g.items.map(i => ({ key: i.key, label: i.label, revenue: i.revenue, cost: i.cost, hrs: i.hrs })),
  scPrice: g.scPrice, scCost: g.scCost, labourPrice: g.labourPrice, labourCost: g.labourCost, mat: g.mat,
  tileRevenue: (document.querySelector('#profitWrap').textContent.match(/Job revenue(\$[\d,.]+)/) || [])[1], tileWant: fmtMoney(g.revenue) }; });

const base = await rows(); const f0 = await fig();
check('the list opens with 1. Scaffolding and 2. Roofing', base.length === 2 && /^1\. Scaffolding/.test(base[0].text) && /^2\. Roofing/.test(base[1].text), JSON.stringify(base));
check('…and the job revenue is the scaffold plus the roofing (labour + materials), which the tile shows',
  near(f0.revenue, f0.scPrice + f0.labourPrice + f0.mat, 0.01) && f0.scPrice > 0 && f0.tileRevenue === f0.tileWant, JSON.stringify({ revenue: f0.revenue, sc: f0.scPrice, tile: f0.tileRevenue }));

// A gutter picked on the quote
const g = await pg.evaluate(async () => {
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 900));
  const lm = _selGutterLm(); const gl = _gutterLabourState(lm);
  const matBase = _gutterMaterialLines('box125', lm, _selGutterLineCount(), _selGutterCorners()).reduce((a, r) => a + (r.lineTotal || 0), 0) * (1 + _gutterMatQtyBufferPct() / 100);
  const sc = _scaffoldEff(_roofScaffold(0));
  return { lm, hrs: gl.leadHrs + gl.appHrs, labCost: gl.leadHrs * gl.leadCost + gl.appHrs * gl.appCost, matBase, price: _selGutterDelta('box125'), upPrice: 0.25 * _selScaffoldBasePrice(), upCost: 0.25 * sc.cost,
           changes: _qpSelectionChanges().map(c => c.label) };
});
const r1 = await rows(); const f1 = await fig();
const gut = f1.items.find(i => i.key === 'gutter'), up = f1.items.find(i => i.key === 'scaffoldUp');
check('picking a gutter on the quote adds "3. Gutters — …" and "4. Platform scaffolding upgrade" to the list, live',
  r1.length === 4 && /^3\. Gutters — 125mm/.test(r1[2].text) && /^4\. Platform scaffolding upgrade/.test(r1[3].text), JSON.stringify(r1.map(x => x.text)));
check('the gutter row is the customer’s price against its labour at cost rates plus its material with the buffer, and its hours',
  gut && near(gut.revenue, g.price, 0.01) && near(gut.cost, g.labCost + g.matBase, 0.01) && gut.hrs === g.hrs && g.hrs > 0 && g.price > 0, JSON.stringify({ gut, g }));
check('the uplift row is a quarter of the scaffold, price and cost alike', up && near(up.revenue, g.upPrice, 0.01) && near(up.cost, g.upCost, 0.01) && g.upPrice > 0, JSON.stringify(up));
check('the tiles add the rows up, and GP/hr runs over every hour on the job (roof + gutter)',
  near(f1.revenue, f1.items.reduce((a, i) => a + i.revenue, 0), 0.01) && near(f1.cost, f1.items.reduce((a, i) => a + i.cost, 0), 0.01) && f1.hrsAll === f1.hrs + g.hrs,
  JSON.stringify({ revenue: f1.revenue, hrs: f1.hrs, hrsAll: f1.hrsAll }));
const shown = await pg.evaluate(() => document.querySelector('#profitWrap').textContent.match(/([\d.]+) labour hrs/)[1]);
check('…and the GP/hr tile says so', parseFloat(shown) === f1.hrsAll, shown);

// A grade change rides along at cost
const gr = await pg.evaluate(async () => { _setProposalOption_grade('colourcote'); await new Promise(r => setTimeout(r, 900));
  return { labels: [...document.querySelectorAll('#profitItems .profit-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), delta: _selGradeDelta('colourcote') }; });
check('a steel grade picked on the quote is a row of its own', gr.labels.length === 5 && gr.labels.some(t => /^3\. Colou?rCote.* steel/i.test(t)), JSON.stringify(gr.labels));

// Off again
const off = await pg.evaluate(async () => { _setProposalOption_grade('maxam'); _setProposalOption_gutter('none'); await new Promise(r => setTimeout(r, 900));
  return [...document.querySelectorAll('#profitItems .profit-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()); });
check('taking the selections off takes their rows away', off.length === 2, JSON.stringify(off));

// The GP/hr nudge still lands on a whole dollar with the gutter's hours in
const nud = await pg.evaluate(async () => {
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 900));
  _profitNudge('gphr', 1); await new Promise(r => setTimeout(r, 600));
  const g = _profitFigures('total'); const gphr = (g.revenue - g.cost) / g.hrsAll;
  const shown = document.getElementById('profitGpHr').textContent;
  _setProposalOption_gutter('none'); await new Promise(r => setTimeout(r, 400));
  return { gphr, shown };
});
check('a $1 nudge on GP/hr lands on a whole dollar over all the hours', near(nud.gphr, Math.round(nud.gphr), 0.01) && nud.shown === '$' + Math.round(nud.gphr).toLocaleString('en-NZ'), JSON.stringify(nud));

// 2026-09-23: the Total IS the quote, the headings say excl. GST, and the
// gutter heading is the gutter card's own bottom line.
const agree = await pg.evaluate(async () => {
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 900)); renderProfitability();
  const g = _profitFigures('total'), q = _quoteMoney();
  const out = { rev: g.revenue, sub: q.sub, roofHead: document.getElementById('pxTot_roofPriceTile').textContent,
    gutHead: document.getElementById('pxTot_gutterDownpipeCard').textContent, card: fmtMoney(window._gdCardTotal),
    note: !!document.querySelector('.px-gst-note') };
  _setProposalOption_gutter('none'); await new Promise(r => setTimeout(r, 400));
  return out;
});
check('the profitability total is the quote’s subtotal, to the cent', near(agree.rev, agree.sub, 0.01), JSON.stringify(agree));
check('…each heading figure says excl. GST, and the panel says every price is', /excl\. GST/.test(agree.roofHead) && agree.note, agree.roofHead);
check('…and the gutter heading is the gutter card’s own bottom line', agree.gutHead.indexOf(agree.card) === 0, agree.gutHead + ' vs ' + agree.card);

// ── AN OPTIONAL ROOF IS THE TOTAL'S, NOT THE MAIN ROOF'S (2026-10-20,
// info@wellingtonroof.co.nz: "when the Roof 2 Option is included, the Quote
// Total and Main Roof totals are the same, but the Roof 2 total shows
// correctly"). The quote's selections ride on the main roof's view because a
// grade or a gutter IS the main roof's price — but a roof the customer added
// has a pill of its own, so counting it on the main roof made the first two
// pills read the same number.
const views = await pg.evaluate(async () => {
  gotoTab('roof');
  const mk = (pts) => { setTool('outline'); DRAW.currentPts = pts; finishCurrent(); };
  clearAll(true);
  mk([[200,200],[800,200],[800,600],[200,600]]); DRAW.scaleMetresPerPx = 0.03;
  let m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable');
  _addAndSwitchToNewRoof();
  mk([[900,200],[1300,200],[1300,500],[900,500]]);
  await new Promise(r => setTimeout(r, 250));
  m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable');
  _setRoofMode(1, 'separate');
  gotoTab('scope');
  refreshQuoteProposal();
  // the customer takes it
  S.quote.proposalOptions = S.quote.proposalOptions || {};
  S.quote.proposalOptions.extraRoofsSel = { 0: true };
  refreshQuoteProposal();
  const t = _profitFigures('total'), main = _profitFigures(0), r2 = _profitFigures(1);
  const roofRow = (t.items || []).filter(i => i.key === 'roof')[0] || null;
  return { tabs: _pricingRoofTabIdxs().length,
           tRev: t.revenue, mRev: main.revenue, r2Rev: r2.revenue,
           roofRow: roofRow && { label: roofRow.label, revenue: roofRow.revenue },
           mainHasRoofRow: (main.items || []).some(i => i.key === 'roof'),
           r2HasRoofRow:  (r2.items  || []).some(i => i.key === 'roof') };
});
const near2 = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
check('with an optional roof taken, Quote total and Main Roof are no longer the same figure',
  views.tabs > 1 && views.roofRow && views.roofRow.revenue > 0 &&
  !near2(views.tRev, views.mRev, 0.01), JSON.stringify(views));
check('\u2026the total is the main roof plus that roof\u2019s own row, to the cent',
  near2(views.tRev, views.mRev + views.roofRow.revenue, 0.01),
  JSON.stringify({ total: views.tRev, main: views.mRev, roof: views.roofRow.revenue }));
check('\u2026and neither the main roof\u2019s view nor the extra roof\u2019s carries the roof row',
  !views.mainHasRoofRow && !views.r2HasRoofRow, JSON.stringify(views));

// ── THE CSV COVERS ONE ROOF AND SAYS WHICH ── (his second bullet: "CSV
// exports appear to be a mix of Total, Main and Roof 2 data").
const csv = await pg.evaluate(() => {
  const read = () => {
    const rows = _scopePricingRows();
    const sec = (n) => rows.filter(r => r[0] === n);
    const covers = (rows.filter(r => r[1] === 'This sheet covers')[0] || [])[2] || '';
    const tot = sec('Totals').filter(r => r[1] === 'TOTAL')[0] || [];
    return { covers, total: parseFloat(tot[6] || 0),
             quoteTotal: parseFloat(((sec('Quote total')[0]) || [])[6] || 0) };
  };
  _setPricingRoof(1);                       // the drawer on Roof 2
  const two = read();
  _setPricingRoof(0);
  const one = read();
  return { two, one, figs: { r2: _profitFigures(1).revenue, main: _profitFigures(0).revenue,
                             total: _profitFigures('total').revenue } };
});
check('the CSV names the roof it covers, and its TOTAL is that roof\u2019s own figure',
  /Roof 2|Roof\s*2/i.test(csv.two.covers) && near2(csv.two.total, csv.figs.r2, 0.02),
  JSON.stringify(csv.two));
check('\u2026the whole quote still goes in underneath it',
  near2(csv.two.quoteTotal, csv.figs.total, 0.02), JSON.stringify(csv.two));
check('\u2026and on the main roof it is the main roof, not the whole job',
  near2(csv.one.total, csv.figs.main, 0.02) && !near2(csv.one.total, csv.figs.total, 0.02),
  JSON.stringify({ csv: csv.one, figs: csv.figs }));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
