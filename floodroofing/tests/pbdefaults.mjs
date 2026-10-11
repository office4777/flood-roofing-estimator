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

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
