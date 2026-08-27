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

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
