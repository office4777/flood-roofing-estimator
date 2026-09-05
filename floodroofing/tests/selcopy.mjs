// "can you make it so i can change the names and prices of the default
//  optional selections in the settings tab. also allow to delete a option row
//  (i.e. only have 2 options for steel grade) and also add in custom rows"
//
// Steel grades, profiles and gutters were already a company's own list —
// renamed, repriced, removed and added to in Settings → Products (that is the
// selectables suite). The other four groups on the Selections page were not:
// steel thickness, gutter brackets, downpipes and disposal were hard-coded
// arrays in the renderer.
//
// Their ids ARE the pricing — gauge55, external brackets, downpipes — so
// letting a roofer invent rows there would mean inventing money to go with
// them, on the engine that produced a $1,153 grade error this week. What a
// company legitimately wants is to call them what it calls them, describe
// them its own way, and take one off the quote. That is what this allows,
// and deliberately no more.
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

// ── the shipped wording, untouched ──
let v = await pg.evaluate(() => _selFixed('thickness', [
  { id:'40', label:'0.40 gauge', isDefault:true, delta:0, desc:'Standard residential thickness.' },
  { id:'55', label:'0.55 gauge', delta:120, desc:'Heavier-gauge steel.' }]));
check('a company that has changed nothing gets the shipped wording',
  v.length === 2 && v[0].label === '0.40 gauge' && v[1].label === '0.55 gauge', JSON.stringify(v.map(r => r.label)));
check('…with the prices untouched', v[1].delta === 120, String(v[1].delta));

// ── renaming and re-wording ──
v = await pg.evaluate(() => {
  _selCopyEdit('thickness', '55', 'name', '0.55mm heavy gauge');
  _selCopyEdit('thickness', '55', 'desc', 'What we put on anything within 5km of the coast.');
  return _selFixed('thickness', [
    { id:'40', label:'0.40 gauge', isDefault:true, delta:0, desc:'Standard residential thickness.' },
    { id:'55', label:'0.55 gauge', delta:120, desc:'Heavier-gauge steel.' }]);
});
check('a renamed choice shows the company\'s own name', v[1].label === '0.55mm heavy gauge', JSON.stringify(v[1]));
check('…and its own words', /within 5km of the coast/.test(v[1].desc), v[1].desc);
check('…while the price behind it does not move', v[1].delta === 120, String(v[1].delta));

// ── hiding one ──
v = await pg.evaluate(() => {
  _selCopyEdit('thickness', '55', 'hidden', true);
  return _selFixed('thickness', [
    { id:'40', label:'0.40 gauge', isDefault:true, delta:0, desc:'x' },
    { id:'55', label:'0.55 gauge', delta:120, desc:'y' }]);
});
check('a choice taken off the quote is gone from the customer\'s page',
  v.length === 1 && v[0].id === '40', JSON.stringify(v.map(r => r.id)));

// The standard is what every other price is a difference FROM. A card with
// no standard on it has nothing to measure against, so it cannot be hidden.
v = await pg.evaluate(() => {
  _selCopyEdit('thickness', '40', 'hidden', true);
  return _selFixed('thickness', [
    { id:'40', label:'0.40 gauge', isDefault:true, delta:0, desc:'x' },
    { id:'55', label:'0.55 gauge', delta:120, desc:'y' }]).map(r => r.id);
});
check('the standard row can never be hidden away', v.indexOf('40') >= 0, JSON.stringify(v));

// ── it reaches the customer's page ──
await pg.evaluate(() => {
  _selCopyEdit('disposal', 'keep', 'name', 'We stack the old iron on site for you');
  _selCopyEdit('downpipes', 'yes', 'hidden', true);
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  try { refreshQuoteProposal(); } catch(e){}
});
await pg.waitForTimeout(700);
v = await pg.evaluate(() => (document.getElementById('qpRoot') || {}).textContent || '');
check('the renamed wording is what the customer actually reads',
  /We stack the old iron on site for you/.test(v), v.slice(0, 60));
check('…and a hidden choice is not on their page at all',
  !/New downpipes/.test(v), 'found "New downpipes"');

// ── the settings panel itself ──
v = await pg.evaluate(() => {
  renderSelectablesUI();
  const box = document.getElementById('selectablesUI');
  return { txt: box.textContent,
           inputs: box.querySelectorAll('input[onchange*="_selCopyEdit"]').length,
           standard: (box.textContent.match(/standard/g) || []).length };
});
check('Settings lists all four fixed groups to be worded',
  /Steel thickness/.test(v.txt) && /Gutter brackets/.test(v.txt) &&
  /Downpipes/.test(v.txt) && /Existing roofing material/.test(v.txt), v.txt.slice(0, 120));
check('…with a name, a description and a hide for each choice',
  v.inputs >= 20, v.inputs + ' fields');
check('…and the standard row marked as such rather than given a hide box',
  v.standard >= 4, v.standard + ' marked');
check('the products a company DOES own — grades, profiles, gutters — are still there',
  /Steel grades/.test(v.txt) && /Roof profiles/.test(v.txt) && /Gutter profiles/.test(v.txt), v.txt.slice(0, 80));

// ── putting it all back ──
await pg.evaluate(() => _selResetAll());
v = await pg.evaluate(() => _selFixed('thickness', [
  { id:'40', label:'0.40 gauge', isDefault:true, delta:0, desc:'x' },
  { id:'55', label:'0.55 gauge', delta:120, desc:'y' }]));
check('resetting the products puts the wording back with them',
  v.length === 2 && v[1].label === '0.55 gauge', JSON.stringify(v.map(r => r.label)));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
