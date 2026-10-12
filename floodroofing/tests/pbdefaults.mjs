// TWO THINGS SCOTT ASKED FOR (2026-10-11, info@wellingtonroof.co.nz, a roofer
// trialling RoofMap): "In the pricing sheet, add a default product option for
// the Underlay, same as available for Roof sheets" and "For the price sheet,
// in addition to PDF export include an option for Excel or CSV export?".
//
// The underlay default earns its place the same way the sheet default does:
// the paper is the same on nearly every job a company does, so typing it each
// time is a question already answered. The rule that makes it safe is that it
// only ever fills an EMPTY box — a job that has chosen its paper keeps it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
let settingsPut = null;
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/settings/.test(u) && r.request().method() === 'PUT'){
    try { settingsPut = JSON.parse(r.request().postData() || '{}'); } catch(e){ settingsPut = null; }
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(Object.assign({ user_id:'u1' }, settingsPut || {})) });
  }
  if (/\/settings/.test(u)) return r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ user_id:'u1', branding:{ company_name:'Kauri Roofing Ltd' }, quote_defaults:{}, jms_keys:{} }) });
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  // Catch whatever the page hands to a download so the CSV can be read back.
  window.__dl = null;
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function(blob){ window.__dlBlob = blob; return real(blob); };
  document.addEventListener('click', function(e){
    const a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a){ e.preventDefault(); window.__dl = a.getAttribute('download'); }
  }, true);
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  S.settings = S.settings || {};
  S.settings.materials_catalog = Object.assign(S.settings.materials_catalog || {},
    { underlays: [{ name:'Thermakraft 215' }, { name:'Bitumen building paper' }], products:[], screws:[], suppliers:[], flashings:[], savedFlashings:[] });
  S.settings.price_book = Object.assign(S.settings.price_book || {}, { ridge_lm: 21.5, valley_lm: 26 });
  gotoTab('settings');
  try { switchSettingsSub('set-defaultpricing', null); } catch(e){}
  try { renderPriceBookUI(); } catch(e){}
  try { populateOrderDropdowns(); } catch(e){}
});
await pg.waitForTimeout(600);

// ── the underlay default ──────────────────────────────────────────
const picker = await pg.evaluate(() => {
  refreshDefaultUnderlayPicker('');
  const sel = document.getElementById('pbDefaultUnderlay');
  return { there: !!sel, opts: sel ? Array.from(sel.options).map(o => o.value) : [] };
});
check('Underlay has a "Default product for this job" picker, like Roofing sheets',
  picker.there, 'no #pbDefaultUnderlay');
check('…listing the underlays the company actually offers, and nothing else',
  picker.opts.length === 3 && picker.opts[0] === '' &&
  picker.opts.includes('Thermakraft 215') && picker.opts.includes('Bitumen building paper'),
  JSON.stringify(picker.opts));

const saved = await pg.evaluate(async () => {
  document.getElementById('pbDefaultUnderlay').value = 'Thermakraft 215';
  collectPriceBookFromUI();
  const stored = S.settings.price_book.defaultUnderlayProduct;
  await saveSettings(true);
  return stored;
});
await pg.waitForTimeout(900);
check('picking one stores it on the price book', saved === 'Thermakraft 215', String(saved));
check('…and saves it to the account, so the next job starts there',
  !!(settingsPut && settingsPut.price_book && settingsPut.price_book.defaultUnderlayProduct === 'Thermakraft 215'),
  JSON.stringify(settingsPut && settingsPut.price_book && settingsPut.price_book.defaultUnderlayProduct));

const applied = await pg.evaluate(() => {
  const el = document.getElementById('orderUnderlay');
  el.value = '';                                  // a fresh job
  populateOrderDropdowns();
  const onFresh = el.value;
  el.value = 'Something the office chose';        // a job that has already picked
  populateOrderDropdowns();
  return { onFresh, kept: el.value };
});
check('a fresh job starts on the default paper', applied.onFresh === 'Thermakraft 215', applied.onFresh);
check('…and a job that has already chosen is never overwritten',
  applied.kept === 'Something the office chose', applied.kept);

const unset = await pg.evaluate(() => {
  S.settings.price_book.defaultUnderlayProduct = '';
  const el = document.getElementById('orderUnderlay'); el.value = '';
  populateOrderDropdowns();
  return el.value;
});
check('…and with no default set nothing is put in the box', unset === '', JSON.stringify(unset));

const gone = await pg.evaluate(() => {
  refreshDefaultUnderlayPicker('A paper no longer on the list');
  const sel = document.getElementById('pbDefaultUnderlay');
  return { val: sel.value, txt: Array.from(sel.options).map(o => o.text).join(' | ') };
});
check('a default whose product has been removed is still shown, marked, not silently dropped',
  gone.val === 'A paper no longer on the list' && /not in list/.test(gone.txt), gone.txt);

// ── the price sheet as a spreadsheet ──────────────────────────────
const csv = await pg.evaluate(async () => {
  S.settings.price_book.defaultUnderlayProduct = 'Thermakraft 215';
  window.__dl = null; window.__dlBlob = null;
  _pbExportCsv();
  await new Promise(r => setTimeout(r, 300));
  const text = window.__dlBlob ? await window.__dlBlob.text() : '';
  return { name: window.__dl, text, type: window.__dlBlob && window.__dlBlob.type };
});
const lines = (csv.text || '').split('\n');
check('Default item pricing offers the sheet as a CSV, beside Copy my price book',
  !!csv.name && /\.csv$/i.test(csv.name) && /csv/.test(csv.type || ''), JSON.stringify({ name: csv.name, type: csv.type }));
check('…with a header row a spreadsheet understands',
  lines[0] === 'Steel grade,Item,Unit,Price (ex GST)', lines[0]);
check('…one row per item RoofMap prices off the roof',
  lines.length > 20, lines.length + ' rows');
check('…carrying the prices actually in use, not blanks',
  /Ridge \/ hip flashing,lm,21\.5/.test(csv.text) && /Valley flashing,lm,26/.test(csv.text),
  lines.filter(l => /Ridge|Valley/.test(l)).slice(0, 3).join(' // '));
check('…and every field with a comma in it is quoted, so the columns do not shift',
  !lines.some(l => l && l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length !== 4),
  (lines.find(l => l && l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length !== 4) || '').slice(0, 90));

// ── THE PICKER FOLLOWS ITS LIST (2026-10-12) ──────────────────────
// "the Underlay Pick a default does not offer a selection, is there an
// update to roll out, or have I missed a step here?" — neither. The list it
// reads ships empty, and the picker was only ever filled by a full render
// of the price book, so adding a product and even saving left it empty.
const empty = await pg.evaluate(() => {
  S.settings.materials_catalog.underlays = [];
  renderCatalogList('underlays');
  refreshDefaultUnderlayPicker('');
  const sel = document.getElementById('pbDefaultUnderlay');
  return { text: (sel.options[0] || {}).text || '', n: sel.options.length, disabled: sel.disabled };
});
check('with no underlay products yet the picker SAYS so instead of looking broken',
  /add an underlay/i.test(empty.text) && empty.n === 1 && empty.disabled === true,
  JSON.stringify(empty));

const typed = await pg.evaluate(() => {
  addCatalogItem('underlays');                    // the "+ Add underlay" button
  const row = document.querySelector('#catalogUnderlays [data-row="cat-underlays"] input[data-field="name"]');
  row.value = 'Thermakraft 215';
  row.dispatchEvent(new Event('input', { bubbles: true }));   // typing it in
  const sel = document.getElementById('pbDefaultUnderlay');
  return { opts: Array.from(sel.options).map(o => o.value), disabled: sel.disabled };
});
check('…typing a product into the list offers it in the picker at once, with no reload',
  typed.opts.indexOf('Thermakraft 215') >= 0 && typed.disabled === false, JSON.stringify(typed));

const removed = await pg.evaluate(() => {
  const x = document.querySelector('#catalogUnderlays [data-row="cat-underlays"] button');
  x.click();
  const sel = document.getElementById('pbDefaultUnderlay');
  return { opts: Array.from(sel.options).map(o => o.value), n: sel.options.length };
});
check('…and taking it off the list takes it out of the picker', removed.n === 1, JSON.stringify(removed));

// ── THE PRICING SHEET AS A CSV (2026-10-12) ───────────────────────
// "the intention was for a Quote Pricing sheet to be available as Download
// CSV beside" Save pricing as PDF — then, once it shipped: "can it be
// available with the same level of detail as the Save Pricing as PDF?
// Current Download pricing as CSV option is set for summary only." So it
// carries every section of the page, not the profitability list alone.
const pcsv = await pg.evaluate(async () => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[814,465],[1633,465],[1633,827],[814,827]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.031; DRAW.calPitch = 25; DRAW.roofType = 'hip';
  autoGenerateRoof('hip', 0); autoCalcLineMeasurements(); syncToRoofData();
  S.quote = S.quote || {}; S.quote.ref = '06125';
  try { calcLabour(); } catch(e){}
  try { renderMaterialPriceTable(); renderGutterDownpipePricing(); renderProfitability(); } catch(e){}
  window.__dl = null; window.__dlBlob = null;
  const btn = Array.from(document.querySelectorAll('#tab-scope .mat-actions button'))
    .find(b => /download pricing as csv/i.test(b.textContent || ''));
  if (!btn) return { btn: false };
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  return { btn: true, name: window.__dl, text: window.__dlBlob ? await window.__dlBlob.text() : '' };
});
const plines = (pcsv.text || '').split('\n');
const sect = n => plines.filter(l => l.indexOf(n + ',') === 0);
check('the Pricing page offers a CSV beside Save pricing as PDF',
  pcsv.btn && /\.csv$/i.test(pcsv.name || ''), JSON.stringify({ btn: pcsv.btn, name: pcsv.name }));
check('…named for the quote it came from, so two jobs do not overwrite each other',
  /06125/.test(pcsv.name || ''), String(pcsv.name));
check('…with a header that says the figures are ex GST, not bare numbers',
  plines[0] === 'Section,Item,Detail,Qty,Unit,Rate (ex GST),Charge-out (ex GST),Cost (ex GST),Hours',
  plines[0]);
// The sections the PDF prints, each with its real content.
check('…carrying the SCAFFOLDING section with its price and its cost',
  sect('Scaffolding').some(l => /edge protection|working platform/.test(l) && /2500\.00,2000\.00/.test(l)),
  sect('Scaffolding').join(' // '));
check('…the ROOF LABOUR section with hours, rates and how it is charged',
  sect('Roof labour').some(l => /^Roof labour,Charged,by the (hour|square metre)/.test(l)) &&
  sect('Roof labour').some(l => /^Roof labour,Lead hand,.*,hrs,/.test(l)) &&
  sect('Roof labour').some(l => /^Roof labour,Labour total,/.test(l)),
  sect('Roof labour').join(' // '));
check('…the ROOF MATERIALS section itemised — one row per line, with qty, unit and $/unit',
  sect('Roof materials').filter(l => /,(m2|lm|each|roll),/.test(l)).length >= 4,
  sect('Roof materials').slice(0, 3).join(' // '));
check('…and the buffer, the mark-up and the materials total under them',
  sect('Roof materials').some(l => /^Roof materials,Quantity buffer,/.test(l)) &&
  sect('Roof materials').some(l => /^Roof materials,Mark-up,/.test(l)) &&
  sect('Roof materials').some(l => /^Roof materials,Materials total,/.test(l)),
  sect('Roof materials').slice(-3).join(' // '));
check('…the GUTTERING section itemised the way its card itemises it',
  sect('Guttering').some(l => /gutter/i.test(l) && /,lm,/.test(l)) &&
  sect('Guttering').some(l => /^Guttering,Labour,/.test(l)) &&
  sect('Guttering').some(l => /^Guttering,Guttering total,/.test(l)),
  sect('Guttering').slice(0, 3).join(' // '));
check('…the JOB PROFITABILITY list, in the order the panel reads it',
  /^Job profitability,1\. Scaffolding/.test(sect('Job profitability')[0] || '') &&
  /^Job profitability,2\. Roofing/.test(sect('Job profitability')[1] || ''),
  sect('Job profitability').slice(0, 2).join(' // '));
check('…a TOTAL, gross profit, GP% and GP per hour',
  ['TOTAL', 'Gross profit', 'Gross profit %', 'Gross profit per hour']
    .every(k => sect('Totals').some(l => l.indexOf('Totals,' + k + ',') === 0)),
  sect('Totals').join(' // '));
check('…and the per-square-metre figures the panel shows underneath',
  sect('Per square metre').some(l => /Revenue per m/.test(l)) &&
  sect('Per square metre').some(l => /Cost per m/.test(l)),
  sect('Per square metre').join(' // '));
check('every row the same width, so the columns do not shift in a spreadsheet',
  plines.filter(Boolean).every(l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length === 9),
  (plines.find(l => l && l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length !== 9) || '').slice(0, 100));
check('…and a description with a comma in it is quoted rather than splitting a row',
  !pcsv.text || plines.filter(l => /"/.test(l)).every(l => (l.match(/"/g) || []).length % 2 === 0),
  (plines.find(l => /"/.test(l)) || '').slice(0, 100));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
