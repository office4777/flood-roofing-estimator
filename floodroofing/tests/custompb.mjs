// The owner, 2026-09-24: "add a button/tab under pricing in the settings,
// call it 'Custom Price Book' where the user can upload their full price
// book, then have all the line items editable and have a link to RoofMap's
// auto/default line items (like RoofMap's 80mm Dektite — the user might want
// to code it to a specific branded Dektite and which supplier; it should know
// which supplier because the uploaded CSV or PDF will say), make it all
// editable, the price book items, the price, the item's price mark-up and
// which RoofMap default it replaces. Make sure any edit or save is properly
// saved."
//
// Pinned: the tab sits under Pricing; a CSV upload is read (supplier from the
// file), previewed, and added with the lines that match RoofMap items linked;
// a linked line prices its default at cost + its mark-up, and that default is
// read-only on Quote's Product Options; the job's material rows carry the
// supplier's product name; every edit is saved with the book stamped; an echo
// never undoes an edit typed while the save was on its way; a new price list
// from the same supplier re-prices the items it already has, keeping their
// mark-ups and links; one item per RoofMap default; a reload keeps it all; a
// book only this device holds is sent up on load; a PDF's text lines and the
// AI reader both produce rows; earlier versions restore.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
let stored = { branding:{ company_name:'Flood Roofing', email:'office@floodroofing.co.nz', phone:'09' }, quote_defaults:{}, jms_keys:{},
               price_book:{ ridge_lm: 15.62, screws_each: 0.3, aquaseal:{ no3: 28 } }, labour_pricing:{} };
const puts = [];
let putDelay = 0, aiReply = null, restored = null;
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o, st) => r.fulfill({ status: st || 200, contentType:'application/json', body: JSON.stringify(o) });
  if (/\/settings\/custom-book\/revisions/.test(u)) return j([{ id: 7, at: '2026-09-23T22:10:00.000Z', items: 2, user_id: 'u1' }]);
  if (/\/settings\/custom-book\/restore/.test(u)){ restored = r.request().postDataJSON(); return j({ ok: true, custom_book: { editedAt: new Date().toISOString(), items: [
      { id:'r1', code:'OLD1', desc:'Restored line', unit:'ea', supplier:'Dimond', cost: 5, markup: 0, replaces:'' },
      { id:'r2', code:'OLD2', desc:'Restored two', unit:'ea', supplier:'Dimond', cost: 6, markup: 0, replaces:'' }] } }); }
  if (/\/settings(\?|$)/.test(u) && m === 'GET') return j(stored);
  if (/\/settings(\?|$)/.test(u) && m === 'PUT'){
    const body = r.request().postDataJSON(); puts.push(body);
    if (putDelay) await new Promise(res => setTimeout(res, putDelay));
    stored = JSON.parse(JSON.stringify(body));
    return j(body);
  }
  if (/\/claude\/v1\/messages/.test(u)) return j({ content: [{ type:'text', text: aiReply || '{}' }] });
  return j([]);
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'aron@test.nz' }));
  if (!sessionStorage.getItem('keepSettings')) localStorage.setItem('fr_settings','null');
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

// ── the tab ──
const nav = await pg.evaluate(() => {
  gotoTab('settings');
  const btns = [...document.querySelectorAll('#tab-settings .set-nav > *')].map(x => x.textContent.trim());
  const at = btns.indexOf('Custom Price Book');
  const grp = btns.slice(0, at).reverse().find(t => /^(Business|Pricing|Quoting|App)$/i.test(t));
  switchSettingsSub('set-custompb');
  return { at, grp, live: !!window.__settingsLive, on: document.getElementById('set-custompb').classList.contains('on'),
           title: document.getElementById('setPaneTitle').textContent, empty: !!document.querySelector('#cpbRoot .cpb-empty') };
});
check('Settings has a Custom Price Book tab under Pricing', nav.at > 0 && /pricing/i.test(nav.grp) && nav.on && nav.title === 'Custom Price Book', JSON.stringify(nav));
check('…which opens empty, saying how to start', nav.empty);

// ── upload a CSV ──
const CSV = 'Code,Description,Unit,Price\nDFE3,Dektite EPDM Pipe Flashing No 3 grey,ea,31.40\nRC055,Ridge Capping 0.55 Colorsteel,lm,14.20\nSCR65,Roofing screws Tek 65mm,ea,0.35\nSIL1,Silicone sealant clear,ea,12.90\n';
await pg.setInputFiles('#cpbFile', { name: 'Steel & Tube price list 2026.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
await pg.waitForSelector('#cpbImpApply', { timeout: 5000 });
const prev = await pg.evaluate(() => ({ sup: document.getElementById('cpbImpSup').value, counts: document.getElementById('cpbImpCounts').textContent,
  head: document.querySelector('.cpb-imp-hd').textContent, auto: document.querySelector('.cpb-imp-auto').textContent, n: (_cpbBook() || { items: [] }).items.length }));
check('the upload is read and previewed, nothing added yet', /4 priced lines/.test(prev.head) && /4 new/.test(prev.counts) && prev.n === 0, JSON.stringify(prev));
check('…the supplier is read from the file', prev.sup === 'Steel & Tube', prev.sup);
check('…and it says how many lines match RoofMap items', /\(3 found\)/.test(prev.auto), prev.auto);
const putsBefore = puts.length;
await pg.click('#cpbImpApply');
await pg.waitForTimeout(1600);
const added = await pg.evaluate(() => {
  const cb = _cpbBook();
  return { n: cb.items.length, links: cb.items.map(i => (i.code + '→' + (i.replaces || '-'))).sort(), sup: cb.items.map(i => i.supplier),
           rows: document.querySelectorAll('#cpbTableWrap tr[data-cpb-row]').length, ok: (document.querySelector('.cpb-ok') || {}).textContent || '' };
});
check('Add puts every line in the book, editable', added.n === 4 && added.rows === 4 && added.sup.every(s => s === 'Steel & Tube'), JSON.stringify(added));
check('…with the lines that match linked to the RoofMap items they replace', added.links.join(',') === 'DFE3→aquaseal.no3,RC055→ridge_lm,SCR65→screws_each,SIL1→-', added.links.join(','));
check('…and it is saved', puts.length > putsBefore && ((puts[puts.length - 1].price_book || {}).custom_book || {}).items.length === 4, puts.length + ' saves');

// ── price + mark-up → the default it replaces ──
const px = await pg.evaluate(async () => {
  const id = _cpbBook().items.find(i => i.code === 'DFE3').id;
  const inp = document.querySelector('[data-cpb="' + id + '"][data-f="markup"]');
  inp.value = '20'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  const sell = document.querySelector('[data-cpb-sell="' + id + '"]').textContent;
  switchSettingsSub('set-products'); renderPriceBookUI();
  const aq = document.querySelector('#pbAquasealList [data-aq-id="no3"]'), ridge = document.getElementById('pbRidgeLm');
  const out = { sell, pb: S.settings.price_book.aquaseal.no3, ridge: S.settings.price_book.ridge_lm, screws: S.settings.price_book.screws_each,
                aqRO: aq && aq.readOnly, aqVal: aq && aq.value, aqTitle: aq && aq.title, ridgeRO: ridge && ridge.readOnly,
                valleyRO: document.getElementById('pbValleyLm').readOnly };
  // collecting the form must not put the old number back
  collectPriceBookFromUI(); out.afterCollect = S.settings.price_book.aquaseal.no3;
  switchSettingsSub('set-custompb');
  return out;
});
check('a line’s price used is its cost + its own mark-up', px.sell === '$37.68', px.sell);
check('…and that is the price of the RoofMap item it replaces', px.pb === 37.68 && px.ridge === 14.2 && px.screws === 0.35, JSON.stringify(px));
check('…shown read-only on Quote’s Product Options, saying where it comes from', px.aqRO && Number(px.aqVal) === 37.68 && /Custom Price Book/.test(px.aqTitle) && px.ridgeRO && !px.valleyRO, JSON.stringify(px));
check('…and the form cannot put the old price back', px.afterCollect === 37.68, String(px.afterCollect));
await pg.waitForTimeout(1500);
const saved1 = puts[puts.length - 1];
check('the edit is saved, the book stamped with when', saved1.price_book.aquaseal.no3 === 37.68 && saved1.price_book.custom_book.items.find(i => i.code === 'DFE3').markup === 20 && !!saved1.price_book.custom_book.editedAt, JSON.stringify(saved1.price_book.aquaseal));

// ── the job's material rows name the supplier's product ──
const brand = await pg.evaluate(() => {
  const rows = [{ key:'aquaseal:80', label:'80mm pipe flashing', variants:[{ value:'no3', label:'Aquaseal No 3', price:37.68 }], defaultVariant:'no3' },
                { key:'ridge', label:'Ridge / Hip cap', variants:[{ value:'Ridge / Hip cap', label:'Ridge / Hip cap' }], defaultVariant:'Ridge / Hip cap', singleVariant:true },
                { key:'valley', label:'Valley iron', variants:[{ value:'Valley iron', label:'Valley iron' }], defaultVariant:'Valley iron', singleVariant:true }];
  _cpbBrandRows(rows);
  return rows.map(r => r.label + ' | ' + r.variants[0].label);
});
check('the material rows carry the supplier’s product: code, name and supplier', /DFE3 Dektite EPDM Pipe Flashing No 3 grey — Steel & Tube/.test(brand[0]) && /RC055 Ridge Capping/.test(brand[1]) && brand[2] === 'Valley iron | Valley iron', brand.join(' ;; '));

// ── an edit typed while a save is on its way survives the echo ──
const race = await pg.evaluate(async () => {
  const id = _cpbBook().items.find(i => i.code === 'SIL1').id;
  window.__race = true;
  const p = saveSettings(true);
  await new Promise(r => setTimeout(r, 150));
  _cpbSet(id, 'cost', '13.50');
  await p;
  return _cpbBook().items.find(i => i.code === 'SIL1').cost;
}).catch(e => 'ERR ' + e.message);
// (the save above was answered at once; make the next one slow and race it for real)
putDelay = 900;
const race2 = await pg.evaluate(async () => {
  const id = _cpbBook().items.find(i => i.code === 'SIL1').id;
  const p = saveSettings(true);
  await new Promise(r => setTimeout(r, 200));
  _cpbSet(id, 'cost', '14.75');
  await p;
  return _cpbBook().items.find(i => i.code === 'SIL1').cost;
});
putDelay = 0;
check('an edit typed while a save is on its way is not undone by that save’s answer', race === 13.5 && race2 === 14.75, race + ' / ' + race2);
await pg.waitForTimeout(1500);
check('…and it reaches the server on the next save', puts[puts.length - 1].price_book.custom_book.items.find(i => i.code === 'SIL1').cost === 14.75);

// ── next year's price list: re-priced, marks and links kept ──
const CSV2 = 'Code,Description,Unit,Price\nDFE3,Dektite EPDM Pipe Flashing No 3 grey,ea,33.00\nRC055,Ridge Capping 0.55 Colorsteel,lm,14.20\nNEW9,Butyl tape 50mm,roll,22.00\n';
await pg.setInputFiles('#cpbFile', { name: 'Steel & Tube price list 2027.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV2) });
await pg.waitForSelector('#cpbImpApply', { timeout: 5000, state: 'attached' });
const counts2 = await pg.evaluate(() => document.getElementById('cpbImpCounts').textContent);
// (Quote's Product Options, opened above, put its one-time price-book notice over the page)
await pg.evaluate(() => document.getElementById('cpbImpApply').click());
await pg.waitForTimeout(600);
const upd = await pg.evaluate(() => { const d = _cpbBook().items.find(i => i.code === 'DFE3'); return { n: _cpbBook().items.length, cost: d.cost, mk: d.markup, link: d.replaces, pb: S.settings.price_book.aquaseal.no3 }; });
check('a new price list from the same supplier says what changes', /1 new · 1 price change .* 1 unchanged/.test(counts2), counts2);
check('…re-prices the item it already has, keeping its mark-up and its link', upd.n === 5 && upd.cost === 33 && upd.mk === 20 && upd.link === 'aquaseal.no3' && upd.pb === 39.6, JSON.stringify(upd));

// ── one item per RoofMap default ──
const one = await pg.evaluate(() => {
  const sil = _cpbBook().items.find(i => i.code === 'SIL1');
  _cpbLink(sil.id, 'ridge_lm');
  return { sil: sil.replaces, rc: _cpbBook().items.find(i => i.code === 'RC055').replaces };
});
check('linking a second item to a RoofMap default takes the first off it', one.sil === 'ridge_lm' && one.rc === '', JSON.stringify(one));
await pg.evaluate(() => { const rc = _cpbBook().items.find(i => i.code === 'RC055'); _cpbLink(rc.id, 'ridge_lm'); });
await pg.waitForTimeout(1500);

// ── a reload keeps everything ──
await pg.evaluate(() => sessionStorage.setItem('keepSettings', '1'));
await pg.reload(); await pg.waitForTimeout(2800);
const back = await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-custompb'); const cb = _cpbBook();
  return { n: cb.items.length, rows: document.querySelectorAll('#cpbTableWrap tr[data-cpb-row]').length, dfe: cb.items.find(i => i.code === 'DFE3'),
           pb: S.settings.price_book.aquaseal.no3, status: (document.getElementById('cpbStatus') || {}).textContent }; });
check('after a reload the book is all there — items, mark-ups, links and the prices they set', back.n === 5 && back.rows === 5 && back.dfe.markup === 20 && back.dfe.replaces === 'aquaseal.no3' && back.pb === 39.6, JSON.stringify(back));
check('…and the tab says how many items and links it holds', /5 items · 3 linked/.test(back.status), back.status);

// ── a book only this device holds is sent up on load ──
const nPuts = puts.length;
await pg.evaluate(() => {
  const loc = JSON.parse(localStorage.getItem('fr_settings'));
  loc.price_book.custom_book.items.push({ id:'off1', code:'OFF1', desc:'Typed while offline', unit:'ea', supplier:'Dimond', cost: 9, markup: 0, replaces:'' });
  loc.price_book.custom_book.editedAt = new Date(Date.now() + 60000).toISOString();
  localStorage.setItem('fr_settings', JSON.stringify(loc));
});
await pg.reload(); await pg.waitForTimeout(4800);
const recon = await pg.evaluate(() => ({ n: _cpbBook().items.length, flag: !!window.__cpbReconciled }));
check('a book edited on this device that never reached the server is kept on load', recon.n === 6 && recon.flag, JSON.stringify(recon));
check('…and sent to the server', puts.length > nPuts && puts[puts.length - 1].price_book.custom_book.items.some(i => i.code === 'OFF1'));
// …but never another account's
await pg.evaluate(() => {
  const loc = JSON.parse(localStorage.getItem('fr_settings'));
  loc.price_book.custom_book.acct = 'someone@else.nz';
  loc.price_book.custom_book.items.push({ id:'x', code:'X', desc:'Other account', unit:'ea', supplier:'', cost: 1, markup: 0, replaces:'' });
  loc.price_book.custom_book.editedAt = new Date(Date.now() + 120000).toISOString();
  localStorage.setItem('fr_settings', JSON.stringify(loc));
});
await pg.reload(); await pg.waitForTimeout(3200);
check('…but never another account’s book left on the device', await pg.evaluate(() => !_cpbBook().items.some(i => i.code === 'X')));

// ── PDFs: the line reader and the AI reader ──
const pdf = await pg.evaluate(() => _cpbRowsFromLines([
  'STEEL & TUBE ROOFING PRICE LIST 2026', 'Code  Description  Unit  Price',
  'DFE3  Dektite EPDM No 3 grey  ea  $31.40', 'RC055  Ridge Capping 0.55  lm  14.20', 'Page 2 of 9', 'Total  $1,245.00']));
check('a PDF’s text lines are read into code, description, unit and price', pdf.length === 2 && pdf[0].code === 'DFE3' && pdf[0].unit === 'ea' && pdf[0].price === 31.4 && pdf[1].desc === 'Ridge Capping 0.55', JSON.stringify(pdf));
aiReply = '{"supplier":"Dimond","items":[{"code":"D1","desc":"Dektite No 4","unit":"ea","price":41.5},{"code":"D2","desc":"Barge flashing","unit":"lm","price":12}';
const ai = await pg.evaluate(async () => { const r = await _cpbAiRows('some price list text'); return r; });
check('the AI reader turns a PDF’s text into rows — even a reply cut short', ai.supplier === 'Dimond' && ai.rows.length === 1 && ai.rows[0].price === 41.5, JSON.stringify(ai));

// ── earlier versions ──
const rv = await pg.evaluate(async () => {
  switchSettingsSub('set-custompb');
  await _cpbRevisions();
  const listed = document.querySelectorAll('#cpbRevs .cpb-rev').length;
  await _cpbRestore(7);
  return { listed, n: _cpbBook().items.length, first: _cpbBook().items[0].desc };
});
check('Earlier versions lists them and Restore puts one back', rv.listed === 1 && restored && restored.id === 7 && rv.n === 2 && rv.first === 'Restored line', JSON.stringify(rv));

// ── deleting the last item says so on purpose ──
const del = await pg.evaluate(() => { _cpbBook().items.slice().forEach(i => _cpbDel(i.id)); return { n: _cpbBook().items.length, cleared: !!_cpbBook().__cleared }; });
check('deleting the last item marks the empty book as deliberate', del.n === 0 && del.cleared, JSON.stringify(del));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
