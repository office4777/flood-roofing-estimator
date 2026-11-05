// "The pricing push to fergus is very very close to being right, however it
//  didn't seperate the optional extra garage roof into seperate labour/material
//  sections like it does correctly for the main roof."
//
// The main roof is itemised properly — Roof Labour, Roof Material, Gutter
// Labour, Gutter Material, Scaffolding, Downpipes. An optional extra roof never
// went through that path: it arrived as one priced delta from
// _qpSelectionChanges and fell to the catch-all, which files anything it does
// not recognise as a single lump of MATERIAL. So the garage crossed to Fergus
// with its labour buried inside a material line.
//
// The split existed the whole time — S.quote.extraRoofs carries materials,
// labour and scaffold per roof. It was being flattened to a total in two
// places on the way here.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
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

// The reported shape: a main roof plus a Garage the customer has opted into.
// Driven through the PRICED path, because a sent quote is what gets pushed.
const built = await pg.evaluate(() => {
  S.quote = S.quote || {};
  S.quote.gstRate = 15;
  S.quote.extraRoofs = [
    { name:'Garage', area:32.9, materials:2410.55, labour:1180.00, scaffold:420.00, price:4010.55 }
  ];
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { extraRoofsSel: { 0: true } });
  var chg = _qpSelectionChanges();
  var er = chg.filter(function(c){ return /Garage/.test(c.label); })[0] || null;
  return { changes: chg.map(function(c){ return { label:c.label, delta:c.delta, hasSplit: !!c.split }; }),
           entry: er };
});
check('the Garage shows up as a selection change',
  !!built.entry, JSON.stringify(built.changes));
check('…and now carries how its price is made up',
  !!(built.entry && built.entry.split), JSON.stringify(built.entry));
check('…which adds back to the price the customer accepted',
  built.entry && Math.abs((built.entry.split.materials + built.entry.split.labour +
                           built.entry.split.scaffold) - built.entry.delta) < 0.02,
  JSON.stringify(built.entry && built.entry.split) + ' vs ' + (built.entry && built.entry.delta));
check('…and names the roof, so a section can be labelled with it',
  built.entry && built.entry.roofName === 'Garage', built.entry && built.entry.roofName);

// The same, once the quote has been priced and sent — the path Fergus uses.
const priced = await pg.evaluate(() => {
  var P = _qpPriced ? _qpPriced() : null;
  if (!P) {
    // Build the priced block the way sending does.
    S.quote.priced = null;
  }
  return { hasSplitInBlock: !!(P && P.extraRoofSplit) };
});
check('the priced path is reachable and does not throw',
  typeof priced.hasSplitInBlock === 'boolean', JSON.stringify(priced));

// ── the sections themselves ────────────────────────────────────────
const secs = await pg.evaluate(() => {
  var out = _buildFergusItemisedSections();
  return {
    names: out.sections.map(function(s){ return s.name; }),
    lines: out.sections.map(function(s){
      // Fergus line items are itemName / itemPrice / isLabour — not the
      // description/price an ordinary row would use.
      return { name: s.name, items: s.lineItems.map(function(li){
        return { d: li.itemName || '', labour: !!li.isLabour,
                 total: (+li.itemPrice || 0) * (+li.itemQuantity || 1) }; }) };
    }),
    labourCount: out.labourCount, matCount: out.matCount
  };
});
const find = (re) => {
  const hit = [];
  secs.lines.forEach(function(s){ s.items.forEach(function(i){
    if (re.test(i.d)) hit.push({ section:s.name, d:i.d, labour:i.labour, total:i.total }); }); });
  return hit;
};
const garage = find(/Garage/i);
check('the Garage reaches Fergus at all', garage.length > 0, JSON.stringify(secs.names));
check('its labour is in a labour section, not buried in material',
  garage.some(g => g.labour && /Labour/i.test(g.section)),
  JSON.stringify(garage));
check('its material is in a material section',
  garage.some(g => !g.labour && /Material/i.test(g.section)),
  JSON.stringify(garage));
// With no gutters quoted there is no Scaffolding section — scaffold folds into
// Materials, which is how this builder has always handled the no-gutter job.
check('its scaffold is carried as its own line',
  garage.some(g => /scaffold/i.test(g.d)),
  JSON.stringify(garage.map(g => g.section + ': ' + g.d)));
check('every Garage line says which roof it is',
  garage.every(g => /^Garage —/.test(g.d)), JSON.stringify(garage.map(g => g.d)));

// The price the customer accepted must not move.
check('the parts still add to what was quoted',
  Math.abs(garage.reduce(function(t, g){ return t + g.total; }, 0) - 4010.55) < 0.02,
  garage.reduce(function(t, g){ return t + g.total; }, 0).toFixed(2) + ' vs 4010.55');

// And it must NOT be the old single lump.
check('no "Selection — Optional extra roof" lump is left',
  find(/Selection — Optional extra roof/).length === 0,
  JSON.stringify(find(/Selection — Optional extra roof/)));

// A grade upgrade is NOT a roof and must still go across as one material line.
const grade = await pg.evaluate(() => {
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { steelGrade: 'colorcote' });
  var out = _buildFergusItemisedSections();
  var hit = [];
  out.sections.forEach(function(s){ s.lineItems.forEach(function(li){
    var d = li.itemName || '';
    if (/Selection —/.test(d)) hit.push({ section:s.name, d:d, labour:!!li.isLabour }); }); });
  return hit;
});
check('an upgrade is still one material line, not split like a roof',
  grade.every(g => !g.labour), JSON.stringify(grade));

// ── JOB 3349 (2026-11-06): "the labour hours in fergus is way low compared to
// the accepted quote on the total priced labour across the selected roofs" ──
// Three real roofs, the two optional ones taken, each with its own crew and
// rates. Fergus must read every roof's HOURS, and the material lines must be
// the main roof's alone (they were every roof's, then each optional roof was
// added again and an "Adjustment to quoted total -$9,185.97" cancelled it).
const r49 = await pg.evaluate(async () => {
  clearAll(true); DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  var drawRoof = function(pts){ setTool('outline'); DRAW.currentPts = pts; finishCurrent();
    var m = document.getElementById('_rsModal'); if (m) m.remove(); autoGenerateRoof('gable', 0); DRAW.calPitch = 25; };
  drawRoof([[200,200],[600,200],[600,500],[200,500]]);
  _addAndSwitchToNewRoof(); drawRoof([[650,220],[850,220],[850,420],[650,420]]);
  _addAndSwitchToNewRoof(); drawRoof([[900,200],[1250,200],[1250,560],[900,560]]);
  autoCalcLineMeasurements(); redrawAll(); gotoTab('quote');
  S.quote.gstRate = 15; S.quote.accepted = null;
  S.quote.labour = Object.assign(S.quote.labour || {}, { leadHrs: 20, appHrs: 20, leadPrice: 220, appPrice: 130, leadCost: 45, appCost: 25, extras: [] });
  _setLabourHrsManual(0, true);
  _updateRoofLabour(1, 'leadHrs', 4); _updateRoofLabour(1, 'appHrs', 4); _setRoofLabourRate(1, 'leadPrice', 100);
  _updateRoofLabour(2, 'leadHrs', 15); _updateRoofLabour(2, 'appHrs', 15); _setRoofLabourRate(2, 'leadPrice', 100); _setRoofLabourRate(2, 'appPrice', 80);
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { extraRoofsSel: { 0: true, 1: true } });
  calcLabour(); refreshQuoteProposal(); recalcQuoteTotals();
  await new Promise(r => setTimeout(r, 400));
  var out = _buildFergusItemisedSections();
  var lines = []; out.sections.forEach(function(s){ s.lineItems.forEach(function(li){ lines.push({ sec: s.name, d: li.itemName, q: li.itemQuantity, p: li.itemPrice, c: li.itemCost, lab: !!li.isLabour }); }); });
  var hrs = lines.filter(function(l){ return l.lab; }).reduce(function(a, l){ return a + (+l.q || 0); }, 0);
  var sheets0 = (function(){ var lv = _roofScopeEnter(), pv = null; try { _syncCurrentToRoof(); pv = _matSelOverride(_pricingRoofGroup(0)); return _buildMaterialPriceRows().filter(function(r){ return /Roofing sheets/i.test(r.label); }).map(function(r){ return r.autoQty; })[0]; } finally { _matSelOverride(pv); lv(); } })();
  var P = _qpBuildPriced();
  return { lines: lines, hrs: hrs, sheets0: sheets0, labs: (P.extraRoofSplit || []).map(function(x){ return x.lab || null; }),
           sub: _quoteMoney().sub, sum: lines.reduce(function(a, l){ return a + (+l.q || 0) * (+l.p || 0); }, 0),
           roofs: (S.quote.extraRoofs || []).map(function(r){ return r.name + ':' + r.labour; }) };
});
const L49 = (re) => r49.lines.filter(l => re.test(l.d));
const gl = L49(/^Roof 2 — Lead Roofer$/)[0] || {}, ga = L49(/^Roof 2 — Apprentice$/)[0] || {};
const sl = L49(/^Roof 3 — Lead Roofer$/)[0] || {}, sa = L49(/^Roof 3 — Apprentice$/)[0] || {};
check('job 3349: each optional roof\u2019s crew reaches Fergus as hours at its own rates and cost',
  gl.lab && gl.q === 4 && gl.p === 100 && gl.c === 45 && ga.q === 4 && ga.p === ((r49.lines.find(l => l.d === 'Apprentice') || {}).p) && ga.c === 25 &&
  sl.q === 15 && sl.p === 100 && sa.q === 15 && sa.p === 80,
  JSON.stringify(r49.lines.filter(l => l.lab)));
check('…so Fergus\u2019s labour hours are every roof the customer took (40 + 8 + 30)', Math.abs(r49.hrs - 78) < 0.01, String(r49.hrs) + ' ' + JSON.stringify(r49.roofs));
check('…and no hourless "— roof labour" lump is left', L49(/— roof labour$/).length === 0, JSON.stringify(L49(/roof labour/)));
const sheetLine = r49.lines.find(l => /^Roofing sheets/.test(l.d)) || {};
check('the material lines are the MAIN roof\u2019s alone, not every roof\u2019s',
  sheetLine.q > 0 && Math.abs(sheetLine.q - Math.ceil(r49.sheets0)) <= 1, JSON.stringify({ line: sheetLine, main: r49.sheets0 }));
const adj = L49(/Adjustment to quoted total/)[0];
check('…so there is no large "Adjustment to quoted total" cancelling a double count',
  !adj || Math.abs(adj.p) < 1, JSON.stringify(adj || null));
check('…and the Fergus quote still totals the quote to the cent', Math.abs(r49.sum - r49.sub) < 0.02, r49.sum.toFixed(2) + ' vs ' + (+r49.sub).toFixed(2));
check('the crew is stamped with the customer\u2019s copy, for the server\u2019s own push',
  r49.labs.length === 2 && r49.labs.every(x => Array.isArray(x) && x.some(y => y.name === 'Lead Roofer')), JSON.stringify(r49.labs));

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
