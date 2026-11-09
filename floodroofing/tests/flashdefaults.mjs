// THE FLASHING LIBRARY'S DEFAULTS (2026-11-09, the owner on the Settings →
// Flashing library cards: "the blue '[flashing name]' should be a bigger title
// and say 'Default [flashing name]' with a drop down menu to save it as a
// different default flashing, then the other flashings that aren't a default
// flashing have a 'add as default' which has the same drop down menu ... if
// it's going to replace an existing default it should pop-up with a small
// warning window to 'overwrite' or 'cancel'. Then the 'edit' button on the
// flashings should open that flashings window ... also save all the
// back-trays as built in so all users have them").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const puts = [];
await ctx.route(/^https?:\/\//, r => {
  const u = r.request().url();
  if (/railway\.app/.test(u)){
    if (/flashings\/builtins/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ at: 't1', items: [
      { name: '800mm 5-Rib back-tray', profile: '5-Rib', flashingType: 'custom', polylines: [{ vertices: [[100,100],[300,100],[300,200]], measurements: {} }] } ] }) });
    if (r.request().method() === 'PUT'){ try { puts.push(r.request().postDataJSON()); } catch(e){} return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: /\/settings/.test(u) ? '{"branding":{"company_name":"Flood Roofing"}}' : '[]' });
  }
  return r.abort();
});
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(3500);
await pg.evaluate(() => { document.querySelectorAll('#setupWizard').forEach(e => e.remove()); gotoTab('settings');
  const bt = document.querySelector('button[onclick*="set-flashings"]'); bt && bt.click(); });
await pg.waitForTimeout(800);

const cards = () => pg.evaluate(() => [...document.querySelectorAll('#flashLibraryGrid .flib-sec-grid > div')].map(c => ({
  name: ((c.querySelector('input[type=text]') || {}).value) || (c.querySelector('div[style*="font-weight:600"]') || {}).textContent,
  def: [...c.querySelectorAll('.flib-def-sel')].map(s => s.options[s.selectedIndex].text),
  add: !!c.querySelector('.flib-add-sel'),
  editBtn: [...c.querySelectorAll('button')].some(x => x.textContent.trim() === 'Edit'),
  editCopy: [...c.querySelectorAll('button')].some(x => /Edit copy/.test(x.textContent)) })));
let cs = await cards();
const byName = (n) => cs.find(c => c.name === n) || {};
check('the flashing the Job Pack uses for a type wears "Default <type>" as its title', byName('Head Barge').def.includes('Default Head barge') &&
  byName('Starter Barge Corro').def.includes('Default Starter barge'), JSON.stringify([byName('Head Barge'), byName('Starter Barge Corro')]));
check('…and the title is a big drop-down, not a small chip', await pg.evaluate(() => { const s = document.querySelector('.flib-def-sel'); const cs = getComputedStyle(s);
  return s.tagName === 'SELECT' && parseFloat(cs.fontSize) >= 14 && s.offsetHeight >= 30; }));
check('a flashing that is no default offers "+ Add as default" instead', byName('Back Tray Chimney').add && !byName('Back Tray Chimney').def.length);
check('every card has an Edit button, and "Edit copy" is gone', cs.every(c => c.editBtn) && !cs.some(c => c.editCopy));
check('the back-trays the platform serves are in the library as built-ins', !!byName('800mm 5-Rib back-tray').name &&
  await pg.evaluate(() => _getBuiltinFlashings().some(e => e.name === '800mm 5-Rib back-tray' && e.isBuiltin)));
check('…and a pipe penetration finds its back-tray by name', await pg.evaluate(() => { const n = _backTrayNameFor(250, '5-Rib');
  return n === '800mm 5-Rib back-tray' && _getAllFlashings().some(e => e.name === n); }));

// Add as default on a slot that already has one: the warning, Cancel first.
const pick = (name, val) => pg.evaluate(([name, val]) => {
  const c = [...document.querySelectorAll('#flashLibraryGrid .flib-sec-grid > div')].find(c => (((c.querySelector('input[type=text]') || {}).value) || (c.querySelector('div[style*="font-weight:600"]') || {}).textContent) === name);
  const sel = c.querySelector('.flib-add-sel') || c.querySelector('.flib-def-sel');
  sel.value = val; sel.dispatchEvent(new Event('change'));
  const w = document.getElementById('flibConfirm'); return w ? w.innerText : null;
}, [name, val]);
let warn = await pick('Back Tray Chimney', 'apron|side');
check('making it the default of a type that has one asks first: Overwrite or Cancel', !!warn && /Standard Apron Corro/.test(warn) && /Overwrite/.test(warn) && /Cancel/.test(warn), warn);
await pg.click('#flibConfirmNo'); await pg.waitForTimeout(300);
check('Cancel changes nothing', await pg.evaluate(() => (_jpResolveDefaultDrawing('apron|side', 'Corrugate', { noPick: true }) || {}).entry.name === 'Standard Apron Corro' &&
  !Object.keys(_flashDefaultsMap()).length));
warn = await pick('Back Tray Chimney', 'apron|side');
await pg.click('#flibConfirmYes'); await pg.waitForTimeout(400);
cs = await cards();
check('Overwrite makes it the default, and the card now says so', byName('Back Tray Chimney').def.includes('Default Side apron') &&
  !byName('Standard Apron Corro').def.includes('Default Side apron'), JSON.stringify([byName('Back Tray Chimney'), byName('Standard Apron Corro')]));
check('the Job Pack resolves that type to it', await pg.evaluate(() => { const r = _jpResolveDefaultDrawing('apron|side', 'Corrugate', { noPick: true }); return r && r.entry.name === 'Back Tray Chimney'; }));
check('…and it is saved with the library for the whole business', puts.length > 0 &&
  ((puts[puts.length - 1].price_book || {}).__materials_catalog || {}).flashDefaults &&
  puts[puts.length - 1].price_book.__materials_catalog.flashDefaults['Corrugate|apron|side'] === 'Back Tray Chimney', puts.length + '');
check('a hand pick on this device\'s Materials picker still beats it', await pg.evaluate(() => {
  localStorage.setItem('fr_mat_flash_pick_apron|side', 'Standard Apron Corro');
  const r = _jpResolveDefaultDrawing('apron|side', 'Corrugate'); localStorage.removeItem('fr_mat_flash_pick_apron|side');
  return r && r.entry.name === 'Standard Apron Corro'; }));

// Moving a default to a different type through its own drop-down.
warn = await pick('Head Barge', 'barge|finish');
if (warn) { await pg.click('#flibConfirmYes'); await pg.waitForTimeout(300); }
cs = await cards();
check('the default title\'s drop-down moves it to another type', byName('Head Barge').def.includes('Default Finish barge') &&
  !byName('Head Barge').def.includes('Default Head barge'), JSON.stringify(byName('Head Barge')));
check('…and the type it left gets the next flashing in line', await pg.evaluate(() => { const r = _jpResolveDefaultDrawing('barge|head', 'Corrugate', { noPick: true }); return !!r && r.entry.name !== 'Head Barge'; }));

// Edit on a built-in opens its window; Save keeps the account's own version.
const ed = await pg.evaluate(() => { const i = _getBuiltinFlashings().findIndex(e => e.name === 'Head Apron'); _flibEditBuiltin(i);
  const m = document.getElementById('flashSketchModal'); const hd = m.firstElementChild.getBoundingClientRect();
  return { open: m.style.display === 'flex', name: document.getElementById('flashMetaName').value, polys: _flashSketchState.polylines.length,
    headTop: Math.round(hd.top), saved: _getSavedFlashings().length }; });
check('Edit on a built-in opens the flashing window with its drawing, nothing copied yet', ed.open && ed.name === 'Head Apron' && ed.polys > 0 && ed.saved === 0, JSON.stringify(ed));
check('…with the window\'s heading on screen on a phone, not cut off above it', ed.headTop >= 0, String(ed.headTop));
await pg.evaluate(() => saveFlashSketch()); await pg.waitForTimeout(300);
check('Save keeps the business\'s own version, which takes the built-in\'s place', await pg.evaluate(() =>
  _getSavedFlashings().some(e => e.name === 'Head Apron') && !_getBuiltinFlashings().some(e => e.name === 'Head Apron')));
const ed2 = await pg.evaluate(() => { closeFlashSketch(); const i = _getSavedFlashings().findIndex(e => e.name === 'Head Apron');
  const c = [...document.querySelectorAll('#flashLibraryGrid button')].find(x => x.textContent.trim() === 'Edit' && x.getAttribute('onclick') === 'openFlashEditModal(' + i + ')');
  c && c.click(); return { found: !!c, open: document.getElementById('flashSketchModal').style.display === 'flex', title: document.getElementById('flashSketchTitle').textContent }; });
check('Edit on a saved flashing opens its window too', ed2.found && ed2.open && /Head Apron/.test(ed2.title), JSON.stringify(ed2));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
