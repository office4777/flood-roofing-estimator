// The owner, 2026-09-25, on the Pricing drawer: "allow the price to be
// adjusted manually for a specific job in case there's no price set and I'm in
// a rush; the add custom line needs a quantity and unit price just like the
// other set prices; next to it an 'Add from price book' button that pops up
// the full price book to select or search an item; an edit mode that works
// like Microsoft File Explorer — folders on the left, items selected (several
// at once) and dragged into a folder, Add folder, a pencil and an x on each
// folder; and a Defaults tab with a 'change default item' button that searches
// the price book."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let promptAnswer = 'Flashings';
pg.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept());
const settingsPuts = [];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(o) });
  if (/\/settings/.test(u) && m === 'PUT'){ const body = r.request().postDataJSON(); settingsPuts.push(body); return j(body); }
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  window.__settingsLive = true;
  S.settings.price_book = Object.assign(S.settings.price_book || {}, { ridge_lm: 0, barge_lm: 0, screws_each: 0 });
  S.settings.price_book.custom_book = { editedAt: new Date(Date.now() - 60000).toISOString(), defaultMarkup: 0, items: [
    { id:'i1', code:'DFE3', desc:'Dektite EPDM No 3', unit:'ea', supplier:'Steel & Tube', cost: 31.4, markup: 0, replaces:'' },
    { id:'i2', code:'RC055', desc:'Ridge capping 0.55', unit:'lm', supplier:'Steel & Tube', cost: 14.2, markup: 10, replaces:'' },
    { id:'i3', code:'SIL1', desc:'Silicone clear', unit:'ea', supplier:'Dimond', cost: 12.9, markup: 0, replaces:'' },
    { id:'i4', code:'BUT50', desc:'Butyl tape 50mm', unit:'roll', supplier:'Dimond', cost: 22, markup: 0, replaces:'' }] };
  gotoTab('roof'); clearAll(true);
  setTool('outline'); DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.02;
});
await pg.waitForTimeout(300);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }
await pg.evaluate(() => { autoGenerateRoof('gable'); autoCalcLineMeasurements(); S.currentJobId = 'job1'; if (!S.quote) S.quote = defaultQuote(); gotoTab('quote'); _openPricingPanel && _openPricingPanel(); renderMaterialPriceTable(); });
await pg.waitForTimeout(600);

// ── a price typed for this job ──
const pr = await pg.evaluate(() => {
  const inp = document.querySelector('input[data-price-key="barge"]');
  if (!inp) return { none: true };
  const rowBefore = inp.closest('tr').classList.contains('pb-zero');
  inp.value = '12.50'; inp.dispatchEvent(new Event('change'));
  const inp2 = document.querySelector('input[data-price-key="barge"]'), tr = inp2.closest('tr');
  const qty = parseFloat(tr.querySelector('input[data-qty-key="barge"]').value);
  return { rowBefore, zeroAfter: tr.classList.contains('pb-zero'), total: tr.children[4].textContent, qty, mark: /THIS JOB/.test(tr.textContent), shown: inp2.value };
});
check('a row with no price takes a price typed for this job — no longer flagged, priced at qty × it', !pr.none && pr.rowBefore && !pr.zeroAfter && pr.shown === '12.50' && pr.total === '$' + (pr.qty * 12.5).toFixed(2) && pr.mark, JSON.stringify(pr));
const job = await pg.evaluate(() => { const s = snapshotCurrentJob(); return { saved: JSON.stringify(s.state.matOv), snap: s }; });
check('…saved with the job', /"barge"[^}]*"price":"12.50"/.test(job.saved), job.saved);
const across = await pg.evaluate((snap) => {
  clearAll(true);
  const cleared = JSON.stringify(MATERIAL_OVERRIDES);
  restoreFromJob({ id: 'job1', draw_state: snap });
  S.jobLocked = false; try { _jobLockRender(); } catch(e){}   // a re-opened job locks; the rest works on it
  return { cleared, back: MATERIAL_OVERRIDES.barge && MATERIAL_OVERRIDES.barge.price };
}, job.snap);
check('…a new job starts without it, and the job brings it back when opened', across.cleared === '{}' && across.back === '12.50', JSON.stringify(across));

// ── custom line: quantity × unit price ──
const cl = await pg.evaluate(async () => {
  gotoTab('quote'); _openPricingPanel && _openPricingPanel(); renderMaterialPriceTable();
  _qAddCustom('material');
  renderMaterialPriceTable();
  const q = document.querySelector('[data-cl-qty="material:0"]'), u = document.querySelector('[data-cl-unit="material:0"]');
  q.value = '3'; q.dispatchEvent(new Event('input'));
  u.value = '12.5'; u.dispatchEvent(new Event('input'));
  const line = S.quote.customLines.material[0];
  const qi = (S.quote.lineItems || []).find(l => l._custom && l._area === 'material');
  return { amount: line.amount, shown: document.querySelector('[data-cl-total="material:0"]').textContent, quoteQty: qi && qi.qty, quoteUnit: qi && qi.unit, pbBtn: !!document.querySelector('#tab-scope .cl-from-pb, .cl-from-pb') };
});
check('a custom line has a quantity and a unit price: 3 × $12.50 = $37.50, on the quote as 3 × 12.50', cl.amount === 37.5 && cl.shown === '$37.50' && cl.quoteQty === 3 && cl.quoteUnit === 12.5, JSON.stringify(cl));
check('…with "Add from price book" beside "+ Add custom line"', cl.pbBtn);

// ── the price book window: search, click to add ──
const pk = await pg.evaluate(async () => {
  document.querySelector('.cl-from-pb[onclick*="material"]').click();
  await new Promise(r => setTimeout(r, 200));
  const m = document.getElementById('pbkModal');
  const all = m ? m.querySelectorAll('.pbk-item').length : 0;
  const s = document.getElementById('pbkSearch'); s.value = 'dektite'; s.dispatchEvent(new Event('input'));
  const found = [...document.querySelectorAll('#pbkModal .pbk-item')].map(x => x.querySelector('.pbk-code').textContent);
  document.querySelector('#pbkModal .pbk-item').click();
  await new Promise(r => setTimeout(r, 200));
  const lines = S.quote.customLines.material;
  const last = lines[lines.length - 1];
  return { opened: !!m, all, found, closed: !document.getElementById('pbkModal'), last };
});
check('"Add from price book" opens the whole price book, and it searches', pk.opened && pk.all === 4 && JSON.stringify(pk.found) === '["DFE3"]', JSON.stringify(pk));
check('…a click adds the item to the job as a line at its price, and closes', pk.closed && pk.last && /DFE3 Dektite/.test(pk.last.desc) && pk.last.unit === 31.4 && pk.last.qty === 1 && pk.last.uom === 'ea' && pk.last.amount === 31.4, JSON.stringify(pk.last));

// ── edit mode: folders, like File Explorer ──
const nPuts = settingsPuts.length;
const fx = await pg.evaluate(async () => {
  _pbPickOpen('material');
  document.querySelector('#pbkModal .pbk-edit').click();
  const addBtn = !!document.querySelector('#pbkModal .pbk-addf');
  document.querySelector('#pbkModal .pbk-addf').click();                      // prompt → "Flashings"
  await new Promise(r => setTimeout(r, 100));
  const folder = _cpbBook().folders[0];
  const items = [...document.querySelectorAll('#pbkModal .pbk-item')];
  items[0].click();                                                            // select DFE3
  items[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));   // …and RC055
  const selected = Object.keys(_PBK.sel).sort();
  // drag them onto the folder
  const src = document.querySelector('#pbkModal .pbk-item[data-item="i1"]');
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const target = document.querySelector('#pbkModal .pbk-folder[data-folder="' + folder.id + '"]');
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 100));
  const inFolder = _cpbBook().items.filter(it => it.folder === folder.id).map(it => it.code).sort();
  const pencils = document.querySelectorAll('#pbkModal .pbk-folder[data-folder="' + folder.id + '"] .pbk-fbtn').length;
  _pbkFolder(folder.id);
  const shown = [...document.querySelectorAll('#pbkModal .pbk-item')].map(x => x.querySelector('.pbk-code').textContent).sort();
  return { addBtn, folder: folder.name, selected, inFolder, pencils, shown };
});
check('edit mode has Add folder; a new folder takes its name', fx.addBtn && fx.folder === 'Flashings', JSON.stringify(fx));
check('…items are selected (Ctrl-click for more) and dragged onto a folder together', JSON.stringify(fx.selected) === '["i1","i2"]' && JSON.stringify(fx.inFolder) === '["DFE3","RC055"]', JSON.stringify(fx));
check('…each folder has a pencil and an x, and opening it shows what is in it', fx.pencils === 2 && JSON.stringify(fx.shown) === '["DFE3","RC055"]', JSON.stringify(fx));
await pg.waitForTimeout(1500);
check('…and the folders are saved with the price book', settingsPuts.length > nPuts && settingsPuts.slice(nPuts).some(p => (p.price_book.custom_book.folders || []).some(f => f.name === 'Flashings') && p.price_book.custom_book.items.filter(it => it.folder).length === 2), (settingsPuts.length - nPuts) + ' saves');
promptAnswer = 'Pipe flashings';
const fx2 = await pg.evaluate(async () => {
  const f = _cpbBook().folders[0];
  document.querySelector('#pbkModal .pbk-folder[data-folder="' + f.id + '"] .pbk-fbtn').click();   // rename
  const renamed = _cpbBook().folders[0].name;
  document.querySelector('#pbkModal .pbk-folder[data-folder="' + f.id + '"] .pbk-fdel').click();   // delete
  return { renamed, folders: _cpbBook().folders.length, unfiled: _cpbBook().items.filter(it => !it.folder).length, items: _cpbBook().items.length };
});
check('…the pencil renames a folder; the x deletes it, its items back to Unfiled — none lost', fx2.renamed === 'Pipe flashings' && fx2.folders === 0 && fx2.unfiled === 4 && fx2.items === 4, JSON.stringify(fx2));

// ── the Defaults tab ──
const df = await pg.evaluate(async () => {
  _pbkTab('defaults');
  const rows = document.querySelectorAll('#pbkModal .pbk-def').length;
  const row = [...document.querySelectorAll('#pbkModal .pbk-def')].find(r => /Ridge \/ hip flashing/.test(r.textContent));
  row.querySelector('.qa-btn').click();                                  // Change default item
  await new Promise(r => setTimeout(r, 80));
  const s = document.getElementById('pbkDefSearch'); s.value = 'ridge'; s.dispatchEvent(new Event('input'));
  const opts = [...document.querySelectorAll('#pbkModal .pbk-defpick-list button')].map(b => b.textContent);
  document.querySelector('#pbkModal .pbk-defpick-list button').click();
  await new Promise(r => setTimeout(r, 80));
  const row2 = [...document.querySelectorAll('#pbkModal .pbk-def')].find(r => /Ridge \/ hip flashing/.test(r.textContent));
  return { rows, opts, linked: (_cpbLinkedBy('ridge_lm') || {}).id, price: S.settings.price_book.ridge_lm, rowText: row2.textContent };
});
check('the Defaults tab lists RoofMap’s default items with their prices', df.rows > 20, String(df.rows));
check('…"Change default item" searches the price book, and the pick prices that default from now on', df.opts.length === 1 && /RC055/.test(df.opts[0]) && df.linked === 'i2' && df.price === 15.62 && /RC055 Ridge capping/.test(df.rowText), JSON.stringify(df));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
