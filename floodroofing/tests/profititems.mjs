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
  _setPricingRoof(0); _setProfitView(0);    // the main roof's own pill
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

// ── THE TOTAL IS A SHEET OF ITS OWN, AND EVERY SHEET CARRIES ITS OWN ROOF
// AREA AND GUTTER (2026-10-22, feedback report 68, info@wellingtonroof.co.nz:
// "With Multiple Roofs the Quote Total and Main Roof return same the same
// results for Main Roof. Quote Total should be for sum all Roof area 200.6 m²
// as shown in Job Pack All Roofs view. Each CSV export view (Total / Main /
// R2/R3) shows the same Total Guttering length for total job"). The CSV
// followed the roof tab alone, so with the Quote Total pill lit it exported
// the main roof; the total's area was the main roof's; and the gutter rows
// were the whole quote's on every sheet.
const sheets = await pg.evaluate(async () => {
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 900));
  const read = () => {
    const rows = _scopePricingRows();
    const row = (sec, item) => rows.filter(r => r[0] === sec && r[1] === item)[0] || [];
    return { covers: row('Job', 'This sheet covers')[2] || '', area: parseFloat(row('Job', 'Roof area')[3] || 0),
             gutterLm: parseFloat(row('Guttering', 'Gutter')[3] || 0), gutterNote: row('Guttering', 'Gutter')[2] || '',
             gutterTotal: parseFloat(row('Guttering', 'Guttering total')[6] || 0),
             total: parseFloat(row('Totals', 'TOTAL')[6] || 0) };
  };
  _setPricingRoof(0); _setProfitView('total'); const tot = read();
  _setProfitView(0); const main = read();
  _setPricingRoof(1); _setProfitView(1); const r2 = read();
  const areas = [_labourCalcAutoQty(0).roof, _labourCalcAutoQty(1).roof];
  const glm = [_roofMeasForIdx(0).gutterLm, _roofMeasForIdx(1).gutterLm];
  const out = { tot, main, r2, areas, glm, selLm: _selGutterLm(), figTotal: _profitFigures('total').revenue, figArea: _profitFigures('total').area, cardTotal: window._gdCardTotal };
  _setProposalOption_gutter('none'); _setProfitView('total'); _setPricingRoof(0); await new Promise(r => setTimeout(r, 400));
  return out;
});
check('with the Quote Total pill lit on the main tab the CSV is the whole quote: its TOTAL is the total\u2019s figure and its roof area is every roof\u2019s, not the main roof\u2019s',
  /whole quote/.test(sheets.tot.covers) && near2(sheets.tot.total, sheets.figTotal, 0.02) && near2(sheets.tot.area, sheets.areas[0] + sheets.areas[1], 0.15) && sheets.areas[1] > 0 && near2(sheets.figArea, sheets.areas[0] + sheets.areas[1], 0.15),
  JSON.stringify({ tot: sheets.tot, areas: sheets.areas, figArea: sheets.figArea }));
check('\u2026its gutter is the whole quote\u2019s metres and the card\u2019s own bottom line',
  near2(sheets.tot.gutterLm, sheets.selLm, 0.01) && near2(sheets.tot.gutterTotal, sheets.cardTotal, 0.02) && sheets.selLm > 0, JSON.stringify(sheets.tot));
check('the main roof\u2019s sheet carries the main roof\u2019s own gutter metres and says where the whole figure is',
  near2(sheets.main.gutterLm, sheets.glm[0], 0.01) && !near2(sheets.main.gutterLm, sheets.selLm, 0.01) && /Quote Total sheet/.test(sheets.main.gutterNote) && near2(sheets.main.area, sheets.areas[0], 0.15),
  JSON.stringify({ main: sheets.main, glm: sheets.glm }));
check('\u2026and Roof 2\u2019s sheet carries Roof 2\u2019s, with a guttering total that is its own share, less than the whole',
  near2(sheets.r2.gutterLm, sheets.glm[1], 0.01) && sheets.glm[1] > 0 && sheets.r2.gutterTotal > 0 && sheets.r2.gutterTotal < sheets.cardTotal && near2(sheets.r2.area, sheets.areas[1], 0.15),
  JSON.stringify({ r2: sheets.r2, glm: sheets.glm, card: sheets.cardTotal }));

// ── A RENAMED BASE LINE IS STILL THE BASE LINE (2026-10-22, feedback
// report 69, the same roofer: "Total 33,069.63 is double counting
// Scaffolding; 1st as single line item and 2nd again in item#3 Other lines
// in Quote"). The sync found its own Scaffolding line by its words, so
// rewording it for the customer added a second one and the first turned up
// under "Other lines on the quote".
const ren = await pg.evaluate(async () => {
  gotoTab('quote'); await new Promise(r => setTimeout(r, 300));
  const before = { n: S.quote.lineItems.length, sub: quoteSubtotal(), other: (_profitFigures('total').items.filter(i => i.key === 'lines')[0] || {}).revenue || 0 };
  const i = S.quote.lineItems.findIndex(l => l._base === 'scaffold' || l.desc === 'Scaffolding');
  updateQuoteLine(i, 'desc', 'Scaffold hire \u2014 edge protection');
  calcLabour(); await new Promise(r => setTimeout(r, 700));
  const after = { n: S.quote.lineItems.length, sub: quoteSubtotal(), other: (_profitFigures('total').items.filter(i => i.key === 'lines')[0] || {}).revenue || 0,
                  descs: S.quote.lineItems.map(l => l.desc), base: S.quote.lineItems.filter(l => l._base === 'scaffold').length, scaff: _scaffoldEff(S.quote.scaffold).price };
  // and a job saved by the old build, carrying the pair, heals on its next sync
  const sp = _scaffoldEff(S.quote.scaffold).price;
  S.quote.lineItems = [{ desc:'Scaffolding', qty:1, unit:sp }, { desc:'Scaffold hire - edge protection', qty:1, unit:sp },
                       { desc:'Materials', qty:1, unit:1 }, { desc:'Labour', qty:1, unit:1 }, { desc:'Scaffolding extra week', qty:1, unit:400 }];
  _syncQuoteBaseLineItems();
  const healed = S.quote.lineItems.map(l => (l._base || '-') + ':' + l.desc);
  return { before, after, healed, i };
});
check('rewording the Scaffolding line keeps it the one scaffold line: the same count, the same subtotal, nothing under Other lines',
  ren.i >= 0 && ren.after.n === ren.before.n && near2(ren.after.sub, ren.before.sub, 0.01) && ren.after.other === 0 && ren.after.base === 1 && ren.after.descs.indexOf('Scaffolding') < 0 && ren.after.scaff > 0,
  JSON.stringify(ren));
check('\u2026and a quote already carrying the pair heals: the reworded line is kept as the base line, the sync\u2019s own duplicate dropped, a custom "Scaffolding extra week" at its own price left alone',
  ren.healed.join('|') === 'scaffold:Scaffold hire - edge protection|materials:Materials|labour:Labour|-:Scaffolding extra week', JSON.stringify(ren.healed));

// ── MATERIALS, THEN THE OTHER LINES (2026-10-27, Scott at
// info@wellingtonroof.co.nz: "Include Address in CSV export … M1 … Total
// Materials; C1 … Total Other Lines; 1. Scaffolding 2. Roofing labour +
// materials 3. Other lines on the quote typed on the quote at cost 4. Total").
const sheet3 = await pg.evaluate(async () => {
  gotoTab('pricing'); await new Promise(r => setTimeout(r, 300));
  _setPricingRoof(0); _setProfitView('total');
  S.quote.addr = '12 Kauri Lane, Whangarei';
  S.settings.price_book.custom_book = { editedAt: new Date().toISOString(), defaultMarkup: 0, items: [
    { id:'pm1', code:'DFE3', desc:'Dektite No 3', unit:'ea', supplier:'Steel & Tube', cost: 40, markup: 25, replaces:'' },
    { id:'po1', code:'SKIP', desc:'Skip bin hire', unit:'ea', supplier:'Waste Co', cost: 300, markup: 20, replaces:'', kind:'other' }] };
  _cpbMatAdd(_cpbItem('pm1'), 0);
  _qAddCustom('material', { desc:'SKIP Skip bin hire', qty:1, unit:360, uom:'ea', amount:360, cpbId:'po1' });
  _qAddCustom('labour', { desc:'Crane hire', qty:1, unit:500, uom:'', amount:500 });
  calcLabour(); renderMaterialPriceTable(); await new Promise(r => setTimeout(r, 500));
  const rows = _scopePricingRows();
  const sec = (s) => rows.filter(r => r[0] === s);
  const row = (s, i) => rows.filter(r => r[0] === s && r[1] === i)[0] || [];
  const mats = sec('Roof materials'), other = sec('Other lines on the quote');
  const matRows = mats.filter(r => !/^(Materials at cost|Quantity buffer|Mark-up|Materials total)$/.test(r[1]));
  const matSum = matRows.reduce((a, r) => a + (parseFloat(r[6]) || 0), 0);
  const it = (_profitFigures('total').items || []).find(i => i.key === 'lines') || {};
  const order = rows.map(r => r[0]).filter((s, i, a) => s && a.indexOf(s) === i);
  return { addr: row('Job', 'Site address')[2], dfe: row('Roof materials', 'DFE3 Dektite No 3'),
           atCost: parseFloat(row('Roof materials', 'Materials at cost')[6]), matSum,
           typedInMats: mats.some(r => /Skip|Crane/.test(r[1])), typedInLabour: sec('Roof labour').some(r => /Crane/.test(r[1])),
           other: other.map(r => r[1] + '|' + r[6] + '|' + r[7]), oTot: row('Other lines on the quote', 'Total other lines'),
           panel: { r: it.revenue, c: it.cost }, order,
           total: parseFloat(row('Totals', 'TOTAL')[6]), fig: _profitFigures('total').revenue };
});
check('the pricing CSV carries the site address', sheet3.addr === '12 Kauri Lane, Whangarei', JSON.stringify(sheet3.addr));
check('…a Material price-book item is a row of the materials, at its cost, inside "Materials at cost"',
  sheet3.dfe[3] === 1 && sheet3.dfe[5] === '40.00' && /price book, at cost/.test(sheet3.dfe[2]) && near2(sheet3.atCost, sheet3.matSum, 0.01) && !sheet3.typedInMats && !sheet3.typedInLabour,
  JSON.stringify({ dfe: sheet3.dfe, atCost: sheet3.atCost, matSum: sheet3.matSum }));
check('…every other line is listed apart, each at its charge and its cost, with its own total',
  sheet3.other.indexOf('SKIP Skip bin hire|360.00|300.00') >= 0 && sheet3.other.indexOf('Crane hire|500.00|500.00') >= 0 &&
  sheet3.oTot[6] === '860.00' && sheet3.oTot[7] === '800.00', JSON.stringify(sheet3.other));
check('…and that total is the profitability list’s "Other lines on the quote", charge and cost alike',
  near2(parseFloat(sheet3.oTot[6]), sheet3.panel.r, 0.01) && near2(parseFloat(sheet3.oTot[7]), sheet3.panel.c, 0.01), JSON.stringify({ oTot: sheet3.oTot, panel: sheet3.panel }));
check('…laid out materials, other lines, then the numbered summary and the TOTAL, which is the quote’s',
  sheet3.order.indexOf('Roof materials') < sheet3.order.indexOf('Other lines on the quote') && sheet3.order.indexOf('Other lines on the quote') < sheet3.order.indexOf('Job profitability') &&
  near2(sheet3.total, sheet3.fig, 0.02), JSON.stringify(sheet3.order));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
