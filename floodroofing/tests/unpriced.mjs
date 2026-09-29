// NO PRICE, NO SEND. The owner, 2026-09-29: "the app let me send a quote out
// that had items with no price set. If there's any items with no price, don't
// let the quote send — pop up a window with the items without a price to set a
// price, either let user set a custom price, or select an item from their price
// book to set as that items price and rename that default item if they wish
// then ask if they would like to save this as the default item … have this
// button grey'd out and untickable with the priceless items with a red 'x'
// then give each a green tick as each item is [priced], then only allow user to
// click email quote once all of those previously un-priced items have a green
// tick."
//
// A material row priced at nothing drops out of the total in silence, so the
// quote goes out short and the roofer finds out when the invoice does not add
// up. The table has flagged it with a red row for a while; a flag on a screen
// nobody opens is not a gate.
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
pg.on('dialog', d => d.accept());
const settingsPuts = [];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(o) });
  if (/\/settings/.test(u) && m === 'PUT'){ const body = r.request().postDataJSON(); settingsPuts.push(body); return j(body); }
  if (/\/settings/.test(u)) return j({});
  return j([]);
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off');
});
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);

// A job with a roof, and a price book missing the barge and screw rates. The
// branding is filled in so _brandingBeforeSend does not take the send first.
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  window.__settingsLive = true;
  S.settings.branding = Object.assign(S.settings.branding || {}, { company_name: 'Flood Roofing', phone: '09 430 0000', email: 'office@floodroofing.co.nz' });
  S.settings.price_book = Object.assign(S.settings.price_book || {}, { ridge_lm: 18.4, barge_lm: 0, screws_each: 0, valley_lm: 22 });
  S.settings.price_book.custom_book = { editedAt: new Date(Date.now() - 60000).toISOString(), defaultMarkup: 0, items: [
    { id:'i1', code:'BF900', desc:'Barge flashing 0.55 Colorsteel', unit:'lm', supplier:'Roofing Industries', cost: 16.5, markup: 0, replaces:'' },
    { id:'i2', code:'SIL1', desc:'Silicone clear', unit:'ea', supplier:'Dimond', cost: 12.9, markup: 0, replaces:'' }] };
  gotoTab('roof'); clearAll(true);
  setTool('outline'); DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.02;
});
await pg.waitForTimeout(300);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }
await pg.evaluate(() => {
  autoGenerateRoof('gable'); autoCalcLineMeasurements();
  S.currentJobId = 'job1'; S.jobLocked = false;
  if (!S.quote) S.quote = defaultQuote();
  gotoTab('quote'); renderMaterialPriceTable();
});
await pg.waitForTimeout(500);

// ── what the gate finds ──
const found = await pg.evaluate(() => {
  const items = _unpricedItems();
  return { keys: items.map(i => i.key).sort(), labels: items.map(i => i.label),
           paths: items.map(i => i.path), qtys: items.map(i => i.qty > 0) };
});
check('the unpriced rows are found: the barge and the screws, not the ridge or valley',
  found.keys.includes('barge') && found.keys.includes('screws') &&
  !found.keys.includes('ridge') && !found.keys.includes('valley'), JSON.stringify(found.keys));
check('…each carries the quantity the job uses and the price-book field behind it',
  found.qtys.every(Boolean) && found.paths.includes('barge_lm') && found.paths.includes('screws_each'),
  JSON.stringify(found.paths));

// ── the send is stopped ──
const gate = await pg.evaluate(async () => {
  await openQuoteEmail();
  await new Promise(r => setTimeout(r, 200));
  const win = document.getElementById('unpModal');
  const overlay = document.getElementById('quoteEmailOverlay');
  const sent = win ? win.querySelector('#unpSendBtn') : null;
  return {
    opened: !!win,
    emailShut: !overlay || overlay.style.display !== 'block',
    crosses: win ? [...win.querySelectorAll('.unp-row .unp-mark')].map(m => m.textContent) : [],
    ticks: win ? win.querySelectorAll('.unp-row.unp-ok').length : -1,
    disabled: !!(sent && sent.disabled),
    label: sent ? sent.textContent : '',
    left: win ? (win.querySelector('.unp-left') || {}).textContent : ''
  };
});
check('Email quote does not open the email window — the unpriced list does', gate.opened && gate.emailShut, JSON.stringify(gate));
check('…every item carries a red ✕ and none a green tick', gate.crosses.length === 2 && gate.crosses.every(c => c === '✕') && gate.ticks === 0, JSON.stringify(gate.crosses));
check('…and the Email quote button is there, disabled', gate.disabled && /Email quote/.test(gate.label), JSON.stringify(gate));
check('…with a count of what is left to price', /2 still to price/.test(gate.left || ''), gate.left);

// A disabled button is untickable: clicking it must not send.
const clickDead = await pg.evaluate(() => {
  document.getElementById('unpSendBtn').click();
  return { stillOpen: !!document.getElementById('unpModal'),
           email: (document.getElementById('quoteEmailOverlay') || {}).style?.display };
});
check('a click on the greyed-out button does nothing', clickDead.stillOpen && clickDead.email !== 'block', JSON.stringify(clickDead));

// ── a price typed by hand ──
const typed = await pg.evaluate(() => {
  const row = document.querySelector('#unpModal .unp-row[data-unp="screws"], #unpModal .unp-row');
  const rows = [...document.querySelectorAll('#unpModal .unp-row')];
  const scr = rows.filter(r => /screw|Unitite/i.test(r.textContent))[0];
  const inp = scr.querySelector('.unp-in input');
  inp.value = '1.85'; inp.dispatchEvent(new Event('change'));
  const after = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /screw|Unitite/i.test(r.textContent))[0];
  const sent = document.getElementById('unpSendBtn');
  return { ok: after.classList.contains('unp-ok'), mark: after.querySelector('.unp-mark').textContent,
           job: (MATERIAL_OVERRIDES.screws || {}).price, stillDisabled: sent.disabled,
           left: (document.querySelector('#unpModal .unp-left') || {}).textContent,
           def: !!after.querySelector('.unp-def') };
});
check('a typed price turns that item green and writes it onto the job', typed.ok && typed.mark === '✓' && typed.job === '1.85', JSON.stringify(typed));
check('…the button stays disabled while another item is unpriced', typed.stillDisabled && /1 still to price/.test(typed.left || ''), typed.left);
check('…and the item offers to save that price as the default', typed.def);

// ── a price taken from the price book, renamed, saved as the default ──
const book = await pg.evaluate(async () => {
  const bar = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /Barge/i.test(r.textContent))[0];
  bar.querySelector('.unp-book').click();
  await new Promise(r => setTimeout(r, 60));
  const all = document.querySelectorAll('#unpModal .unp-item').length;
  const s = document.querySelector('#unpModal .unp-search');
  s.value = 'barge'; s.dispatchEvent(new Event('input'));
  const shown = [...document.querySelectorAll('#unpModal .unp-item')].map(x => x.textContent);
  document.querySelector('#unpModal .unp-item').click();
  await new Promise(r => setTimeout(r, 60));
  const bar2 = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /Barge|BF900/i.test(r.textContent))[0];
  return { all, shown, ok: bar2.classList.contains('unp-ok'),
           job: (MATERIAL_OVERRIDES.barge || {}).price,
           rename: !!bar2.querySelector('.unp-rename input'),
           chosen: (bar2.querySelector('.unp-chosen-hd') || {}).textContent,
           sendOn: !document.getElementById('unpSendBtn').disabled,
           left: (document.querySelector('#unpModal .unp-left') || {}).textContent };
});
check('"From price book" lists the book and searches it', book.all === 2 && book.shown.length === 1 && /BF900|Barge flashing/.test(book.shown[0]), JSON.stringify(book.shown));
check('…a click prices the item at the book’s sell price and turns it green', book.ok && book.job === '16.5' && /16\.50/.test(book.chosen || ''), JSON.stringify(book));
check('…and offers to rename that item', book.rename);
check('every item priced: the button is live and says so', book.sendOn && /All priced/.test(book.left || ''), JSON.stringify(book));

const renamed = await pg.evaluate(() => {
  const bar = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /BF900|Barge/i.test(r.textContent))[0];
  const inp = bar.querySelector('.unp-rename input');
  inp.value = 'Barge flashing — Colorsteel Ironsand'; inp.dispatchEvent(new Event('change'));
  return { desc: _cpbItem('i1').desc };
});
check('the rename reaches the price-book item', renamed.desc === 'Barge flashing — Colorsteel Ironsand', renamed.desc);

// Saving as the default goes through the Custom Price Book, so Settings can
// show it and _cpbApply writes it wherever the price book is read.
const saved = await pg.evaluate(() => {
  const bar = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /Barge/i.test(r.textContent))[0];
  const tick = bar.querySelector('.unp-def input');
  tick.checked = true; tick.dispatchEvent(new Event('change'));
  const it = _cpbItem('i1');
  const pb = JSON.parse(JSON.stringify(S.settings.price_book));
  _cpbApply(pb);
  return { replaces: it.replaces, applied: pb.barge_lm, linked: !!_cpbLinkedBy('barge_lm') };
});
check('"Save as my default price" links the price-book item to that field', saved.replaces === 'barge_lm' && saved.linked, JSON.stringify(saved));
check('…so the price book itself carries the price from then on', saved.applied === 16.5, String(saved.applied));

// A typed price with no book item behind it makes one, so it is visible in
// Settings rather than living only on this job.
const madeItem = await pg.evaluate(() => {
  const scr = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /screw|Unitite/i.test(r.textContent))[0];
  const tick = scr.querySelector('.unp-def input');
  tick.checked = true; tick.dispatchEvent(new Event('change'));
  const it = _cpbLinkedBy('screws_each');
  const pb = JSON.parse(JSON.stringify(S.settings.price_book));
  _cpbApply(pb);
  return { made: !!it, cost: it && it.cost, desc: it && it.desc, applied: pb.screws_each,
           count: _cpbBook().items.length };
});
check('a typed price with no book item behind it makes one at that price', madeItem.made && madeItem.cost === 1.85 && madeItem.applied === 1.85 && madeItem.count === 3, JSON.stringify(madeItem));

// Untick: the link goes, the price book is left as it was.
const unticked = await pg.evaluate(() => {
  const scr = [...document.querySelectorAll('#unpModal .unp-row')].filter(r => /screw|Unitite/i.test(r.textContent))[0];
  const tick = scr.querySelector('.unp-def input');
  tick.checked = false; tick.dispatchEvent(new Event('change'));
  const pb = JSON.parse(JSON.stringify(S.settings.price_book));
  _cpbApply(pb);
  return { linked: !!_cpbLinkedBy('screws_each'), applied: pb.screws_each,
           job: (MATERIAL_OVERRIDES.screws || {}).price };
});
// Unlinking stops the book driving that field from then on; the number it
// already wrote stays, exactly as unlinking in Settings leaves it.
check('unticking it unlinks the default and leaves the job’s own price alone', !unticked.linked && unticked.job === '1.85', JSON.stringify(unticked));

// ── and now the send goes ──
const through = await pg.evaluate(async () => {
  document.getElementById('unpSendBtn').click();
  await new Promise(r => setTimeout(r, 400));
  return { closed: !document.getElementById('unpModal'),
           email: (document.getElementById('quoteEmailOverlay') || {}).style.display,
           left: _unpricedItems().length };
});
check('Email quote now opens the email window, and nothing is unpriced any more', through.closed && through.email === 'block' && through.left === 0, JSON.stringify(through));

// A second send walks straight through.
const again = await pg.evaluate(async () => {
  document.getElementById('quoteEmailOverlay').style.display = 'none';
  document.getElementById('quoteEmailModal').style.display = 'none';
  await openQuoteEmail();
  await new Promise(r => setTimeout(r, 200));
  return { win: !!document.getElementById('unpModal'),
           email: (document.getElementById('quoteEmailOverlay') || {}).style.display };
});
check('with everything priced the gate stays out of the way', !again.win && again.email === 'block', JSON.stringify(again));

// ── Not now leaves the quote alone ──
const notNow = await pg.evaluate(async () => {
  document.getElementById('quoteEmailOverlay').style.display = 'none';
  document.getElementById('quoteEmailModal').style.display = 'none';
  // The barge now has a saved default, so take the price off something else.
  S.settings.price_book.ridge_lm = 0;
  renderMaterialPriceTable();
  await openQuoteEmail();
  await new Promise(r => setTimeout(r, 200));
  const opened = !!document.getElementById('unpModal');
  document.querySelector('#unpModal .unp-cancel').click();
  return { opened, closed: !document.getElementById('unpModal'),
           email: (document.getElementById('quoteEmailOverlay') || {}).style.display };
});
check('taking a price away opens the gate again, and "Not now" closes it without sending',
  notNow.opened && notNow.closed && notNow.email !== 'block', JSON.stringify(notNow));

// ── the practice job is never blocked ──
const demo = await pg.evaluate(() => {
  S.isSampleJob = true;
  const held = _pricesBeforeSend(function(){});
  S.isSampleJob = false;
  return { held, real: _pricesBeforeSend(function(){}) };
});
check('the practice job is never held up by it; a real job still is', demo.held === false && demo.real === true, JSON.stringify(demo));
await pg.evaluate(() => { _unpClose(); });

// A row the office deleted is not asked about.
const del = await pg.evaluate(() => {
  const k = _matOvKey('ridge', 0);
  const before = _unpricedItems().map(i => i.key);
  MATERIAL_DELETED[k] = true;
  const after = _unpricedItems().map(i => i.key);
  delete MATERIAL_DELETED[k];
  return { before, after };
});
check('a row the office deleted from the job is not asked about',
  del.before.includes('ridge') && !del.after.includes('ridge'), JSON.stringify(del));

// ── A ROOF THE CUSTOMER NEVER SEES IS NOT PRICED. Every roof the quote prices
// is checked, not just the tab on screen — but an excluded roof is not quoted,
// so holding the send on its prices would be a dead end.
await pg.evaluate(() => {
  gotoTab('roof');
  _addAndSwitchToNewRoof();
  setTool('outline');
  DRAW.currentPts = [[900,300],[1200,300],[1200,500],[900,500]];
  finishCurrent();
  DRAW.calPitch = 0.0001;
  autoGenerateRoof('gable');
  DRAW.roofs[1].name = 'Garage';
  autoCalcLineMeasurements();
  S.settings.price_book.ridge_lm = 0;
  gotoTab('quote');
});
await pg.waitForTimeout(400);
const multi = await pg.evaluate(() => {
  _setRoofMode(1, 'separate');
  const sep = _unpricedItems().map(i => i.key + '@' + (i.roof || '-'));
  _setRoofMode(1, 'excluded');
  const exc = _unpricedItems().map(i => i.key + '@' + (i.roof || '-'));
  _setRoofMode(1, 'separate');
  return { sep, exc };
});
check('a second roof the customer can add is checked too, and each row says which roof',
  multi.sep.some(k => /@Garage$/.test(k)) && multi.sep.some(k => /@Main|@Roof 1/.test(k)), JSON.stringify(multi.sep));
check('…a roof the office excluded from the quote is not checked',
  !multi.exc.some(k => /@Garage$/.test(k)) && multi.exc.length < multi.sep.length, JSON.stringify(multi.exc));

// The gate must stop the send with a second roof's price missing too.
const multiGate = await pg.evaluate(async () => {
  // The Settings form was never rendered in this run, so an autosave along the
  // way blanked the branding; put it back or the branding wizard takes the
  // send before the prices do.
  S.settings.branding.company_name = 'Flood Roofing';
  await openQuoteEmail();
  await new Promise(r => setTimeout(r, 200));
  const win = document.getElementById('unpModal');
  const out = { opened: !!win,
                roofs: win ? [...win.querySelectorAll('.unp-roof')].map(e => e.textContent) : [],
                disabled: !!(win && win.querySelector('#unpSendBtn').disabled) };
  // price every one of them and the button comes alive
  if (win) [...win.querySelectorAll('.unp-row')].forEach(r => {
    const i = r.querySelector('.unp-in input'); i.value = '21.40'; i.dispatchEvent(new Event('change'));
  });
  const w2 = document.getElementById('unpModal');
  out.live = !!(w2 && !w2.querySelector('#unpSendBtn').disabled);
  out.ticks = w2 ? w2.querySelectorAll('.unp-row.unp-ok').length : -1;
  out.rows = w2 ? w2.querySelectorAll('.unp-row').length : -1;
  _unpClose();
  return out;
});
check('a missing price on the second roof stops the send and names that roof',
  multiGate.opened && multiGate.disabled && multiGate.roofs.some(r => /Garage/.test(r)), JSON.stringify(multiGate));
check('…pricing every row turns them all green and frees the button',
  multiGate.live && multiGate.ticks === multiGate.rows && multiGate.rows > 1, JSON.stringify(multiGate));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(r => !r).length;
console.log(bad ? ('FAILED ' + bad + '/' + results.length) : ('All ' + results.length + ' passed'));
process.exit(bad ? 1 : 0);
