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

// ── the underlay list (2026-10-20, the owner: "remove the m2 options for
// paper, instead when i '+add underlay' is asks for the name, $ and m2, then
// in the 'underlay' section it just lists the underlays I've add and asked me
// which one is my default like the 'steel grades' has"). A roll size is a
// fact about the paper, not a choice beside it. ────────────────────
const picker = await pg.evaluate(() => {
  renderCatalogList('underlays');
  const box = document.getElementById('catalogUnderlays');
  const rows = Array.from(box.querySelectorAll('[data-row="cat-underlays"]'));
  return {
    rows: rows.length,
    names: rows.map(r => (r.querySelector('input[data-field="name"]')||{}).value),
    fields: rows.length ? ['name','price','m2','isdefault']
      .filter(f => !!rows[0].querySelector('[data-field="'+f+'"]')) : [],
    oldSelect: !!document.getElementById('pbDefaultUnderlay'),
    oldBoxes: ['pbUnderlay50','pbUnderlay75','pbUnderlay100'].filter(i => !!document.getElementById(i)),
  };
});
check('THE ASK: every paper is listed with its own price and roll size',
  picker.rows === 2 && picker.fields.join(',') === 'name,price,m2,isdefault',
  JSON.stringify(picker));
check('…and one of them is ticked as the default, the way a steel grade is',
  picker.fields.includes('isdefault'), JSON.stringify(picker.fields));
check('…so the three roll-size price boxes are gone',
  picker.oldBoxes.length === 0 && picker.oldSelect === false, JSON.stringify(picker));

const saved = await pg.evaluate(async () => {
  const rows = Array.from(document.querySelectorAll('#catalogUnderlays [data-row="cat-underlays"]'));
  const row = rows.filter(r => (r.querySelector('input[data-field="name"]')||{}).value === 'Thermakraft 215')[0];
  row.querySelector('input[data-field="isdefault"]').checked = true;
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

// A paper carries the figures a job is priced from, so they have to come
// back off the row — and a row still being typed must not wipe them.
const figures = await pg.evaluate(() => {
  S.settings.materials_catalog.underlays =
    [{ name:'Thermakraft 215', price:310, m2:75 }, { name:'Bitumen building paper' }];
  S.settings.price_book.underlay = { '50':256.75, '75':385.13, '100':513.50 };
  S.settings.price_book.defaultUnderlayProduct = 'Thermakraft 215';
  renderCatalogList('underlays');
  const typedBack = Array.from(document.querySelectorAll('#catalogUnderlays [data-row="cat-underlays"]'))
    .map(r => ['name','price','m2'].map(f => (r.querySelector('[data-field="'+f+'"]')||{}).value).join('|'));
  return { typedBack, products: _underlayProducts(), pick: _underlayPick() };
});
check('a paper shows the price and roll size the office typed for it',
  figures.typedBack[0] === 'Thermakraft 215|310|75', JSON.stringify(figures.typedBack));
check('…and one typed before this page asked for them still prices off the old roll map',
  figures.products[1].name === 'Bitumen building paper' && figures.products[1].price === 385.13,
  JSON.stringify(figures.products));
check('…with the ticked paper the one a job starts on',
  figures.pick.name === 'Thermakraft 215' && figures.pick.m2 === 75 && figures.pick.price === 310,
  JSON.stringify(figures.pick));

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
check('Default Items offers the sheet as a CSV, beside Copy my price book',
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
  return { text: (document.getElementById('catalogUnderlays').textContent || ''),
           products: _underlayProducts() };
});
check('with no papers on the list yet the section SAYS so instead of looking broken',
  /no papers yet/i.test(empty.text), empty.text.slice(0, 70));
// A FRESH ACCOUNT MUST STILL ORDER PAPER: the list ships empty, so with
// nothing on it the three roll sizes stand in exactly as they always did.
check('…and a job still prices underlay, off the roll sizes, until one is added',
  empty.products.length === 3 && empty.products.every(p => p.legacy) &&
  empty.products[0].m2 === 50 && empty.products[0].price === 256.75,
  JSON.stringify(empty.products));

const typed = await pg.evaluate(() => {
  addCatalogItem('underlays');                    // the "+ Add underlay" button
  const row = document.querySelector('#catalogUnderlays [data-row="cat-underlays"]');
  const nm = row.querySelector('input[data-field="name"]');
  nm.value = 'Thermakraft 215'; nm.dispatchEvent(new Event('input', { bubbles: true }));
  const pr = row.querySelector('input[data-field="price"]');
  pr.value = '310'; pr.dispatchEvent(new Event('input', { bubbles: true }));
  const m2 = row.querySelector('input[data-field="m2"]');
  m2.value = '75'; m2.dispatchEvent(new Event('input', { bubbles: true }));
  return { products: _underlayProducts(), stored: S.settings.materials_catalog.underlays };
});
check('…typing a paper in takes at once, price and roll size with it',
  typed.products.length === 1 && typed.products[0].name === 'Thermakraft 215' &&
  typed.products[0].price === 310 && typed.products[0].m2 === 75,
  JSON.stringify(typed.products));

const removed = await pg.evaluate(() => {
  document.querySelector('#catalogUnderlays [data-row="cat-underlays"] button').click();
  return { products: _underlayProducts(), stored: S.settings.materials_catalog.underlays };
});
check('…and taking it off the list takes it out of the pricing',
  removed.stored.length === 0, JSON.stringify(removed.stored));

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

// ── THE PAPER IS WHAT THE JOB IS PRICED ON ───────────────────────
// Each paper is a variant of its own on the take-off, at its own $/roll and
// counted on its own roll size — so swapping the paper moves BOTH the rate
// and the number of rolls. A row's quantity used to belong to the row, which
// would have left a 100 m² paper ordering a 50 m² paper's roll count.
const rows = await pg.evaluate(() => {
  S.settings.materials_catalog.underlays =
    [{ name:'DriStud RU24', price:256.75, m2:50 }, { name:'Wide roll', price:400, m2:100 }];
  S.settings.price_book.defaultUnderlayProduct = 'DriStud RU24';
  try { localStorage.removeItem('fr_underlay_product'); } catch(e){}
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
  finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  const r = _buildMaterialPriceRows().filter(x => x.key === 'underlay')[0];
  return { def: r.defaultVariant, autoQty: r.autoQty,
           variants: r.variants.map(v => ({ v: v.value, p: v.price, q: v.qty, u: v.unit })) };
});
check('the take-off offers one row per paper, each at its own price',
  rows.variants.length === 2 && rows.variants[0].p === 256.75 && rows.variants[1].p === 400,
  JSON.stringify(rows.variants));
check('…and counts the rolls on THAT paper\u2019s roll size',
  rows.variants[0].q === Math.ceil(rows.variants[1].q * 2) ||
  (rows.variants[0].q > rows.variants[1].q && rows.variants[1].q > 0),
  JSON.stringify(rows.variants));
check('…starting on the one the office ticked',
  rows.def === 'DriStud RU24' && rows.autoQty === rows.variants[0].q,
  JSON.stringify({ def: rows.def, qty: rows.autoQty }));
// The table is where the office sees it, and the quantity has to follow the
// product they pick rather than sit at the row's default.
const swap = await pg.evaluate(() => {
  const r = _buildMaterialPriceRows().filter(x => x.key === 'underlay')[0];
  const pick = n => _matRowQtyRaw(r, r.variants.filter(v => v.value === n)[0], {});
  return { a: pick('DriStud RU24'), b: pick('Wide roll'),
           typed: _matRowQtyRaw(r, r.variants[1], { qty: 9 }) };
});
check('picking the other paper changes the number of rolls, not just the rate',
  swap.a !== swap.b && swap.b > 0, JSON.stringify(swap));
check('…and a quantity the office typed still beats both', swap.typed === 9, String(swap.typed));

// ── A BACK-TRAY IS PRICED BY THE METRE (the same message: "make the price
// /lm and have the quote/pricing work out the cost as the length times by
// the cost"). It is, and the labels now say so rather than leaving it to a
// sentence above the grid.
const bt = await pg.evaluate(() => {
  S.settings.price_book.backtray_prices = { '270mm Corrugate back-tray': 120 };
  renderPriceBookUI();
  const lbls = Array.from(document.querySelectorAll('#pbBackTrayList label')).map(e => e.textContent);
  return { lbls: lbls.slice(0, 2),
           lm: _backTrayLmPrice('270mm Corrugate back-tray'),
           each2: _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 2 }),
           each05: _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 0.5 }),
           noLen: _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 0 }) };
});
check('a back-tray rate is $/lm, and every box says so',
  bt.lbls.every(l => /\(\$\/lm\)$/.test(l)), JSON.stringify(bt.lbls));
check('…and a tray costs its own length \u00d7 that rate',
  bt.lm === 120 && bt.each2 === 240 && bt.each05 === 60, JSON.stringify(bt));
check('…while a tray whose length the drawing cannot give yet prices at nothing',
  bt.noLen === 0, String(bt.noLen));

// ── the tab's three lists are three sections now ─────────────────
const secs = await pg.evaluate(() => {
  gotoTab('settings'); switchSettingsSub('set-defaultpricing');
  return { hds: Array.from(document.querySelectorAll('#set-defaultpricing .set-sec-hd strong'))
                   .map(e => e.textContent.replace(/[^A-Za-z \-&]/g, '').trim()),
           title: (document.querySelector('#set-defaultpricing .card-hd') || {}).textContent || '' };
});
check('THE ASK: roofing sheets, flashings and back-trays are three sections',
  ['Roofing sheets','Flashings','Back-trays'].every(h => secs.hds.includes(h)) &&
  !secs.hds.some(h => /Roofing sheets, flashings/.test(h)),
  secs.hds.join(' | '));
check('…under one steel-grade picker, so they are still one grade\u2019s prices',
  secs.hds.indexOf('Steel grade') >= 0 &&
  secs.hds.indexOf('Steel grade') < secs.hds.indexOf('Roofing sheets'), secs.hds.join(' | '));
check('…and the tab is called Default Items', /Default Items/.test(secs.title), secs.title);

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
