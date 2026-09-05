// "add a 'add new profile' selection in all areas for the sheet profile, this
//  will effect the sheet calculation (number of sheets) and prompt the user to
//  enter a custom effective cover width e.g. 500mm, the sheet name and then it
//  auto saves and becomes one of the options"
//
// A profile was a name and a description — the sheet count came off one
// global "sheet effective width" box that never moved when the profile did.
// So a 500mm-cover tray was counted as though it laid 762mm: two thirds of
// the sheets, on a job priced per sheet.
//
// A profile now carries the width it actually covers once lapped, choosing
// one applies it, and a new profile can be added from Settings or straight
// off the quote's own profile card.
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

// ── the shipped profiles lay at the width the app has always assumed ──
let v = await pg.evaluate(() => ({
  cover: _selProfiles().map(p => ({ id:p.id, mm:p.coverMm })),
  box: (document.getElementById('sheetWidth') || {}).value,
}));
check('the profiles RoofMap ships carry their cover width',
  v.cover.every(p => p.mm === 762), JSON.stringify(v.cover));
check('…which is the width the sheet layout already defaulted to, so nothing moves',
  v.box === '762', v.box);

// ── choosing a profile applies its width ──
v = await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.selectables = _defaultSelectables();
  S.settings.selectables.profiles.push({ id:'tray500', name:'Standing seam tray', locksGauge:'', coverMm:500, desc:'' });
  S.quote = S.quote || {}; S.quote.proposalOptions = {};
  _setProposalOption_profile('tray500');
  return (document.getElementById('sheetWidth') || {}).value;
});
check('picking a 500mm-cover profile sets the sheet width to 500', v === '500', String(v));
v = await pg.evaluate(() => { _setProposalOption_profile('corrugate');
  return (document.getElementById('sheetWidth') || {}).value; });
check('…and going back to corrugate puts it back to 762', v === '762', String(v));

// The whole point: fewer metres per sheet means more sheets.
v = await pg.evaluate(() => {
  const el = document.getElementById('sheetWidth');
  const at = (mm) => { el.value = String(mm); return Math.ceil(10 / (mm / 1000)); };
  return { wide: at(762), narrow: at(500) };
});
check('a narrower cover really does need more sheets over the same roof',
  v.narrow > v.wide, JSON.stringify(v));

// A profile with no cover width recorded leaves the setting alone — every
// job that existed before profiles carried one.
v = await pg.evaluate(() => {
  document.getElementById('sheetWidth').value = '820';
  S.settings.selectables.profiles.push({ id:'legacy', name:'Old profile', locksGauge:'', desc:'' });
  _setProposalOption_profile('legacy');
  return (document.getElementById('sheetWidth') || {}).value;
});
check('a profile with no cover width recorded does not touch the setting', v === '820', String(v));

// ── adding one from the quote's profile card ──
v = await pg.evaluate(() => {
  const answers = ['Trimrib', '500'];
  const real = window.prompt;
  window.prompt = () => answers.shift();
  const id = _selAddProfilePrompt();
  window.prompt = real;
  return { id: id, list: _selProfiles().map(p => ({ n:p.name, mm:p.coverMm })),
           picked: S.quote.proposalOptions.profile,
           box: document.getElementById('sheetWidth').value };
});
check('a profile added from the quote is saved to the company list',
  v.list.some(p => p.n === 'Trimrib' && p.mm === 500), JSON.stringify(v.list));
check('…selected on the quote there and then', v.picked === v.id, JSON.stringify(v));
check('…and its cover width applied to the sheet count', v.box === '500', v.box);

// A cover width that cannot be right is refused rather than saved.
v = await pg.evaluate(() => {
  const answers = ['Nonsense', '5'];
  const real = window.prompt; const alerts = [];
  const ra = window.alert; window.alert = m => alerts.push(String(m));
  window.prompt = () => answers.shift();
  const id = _selAddProfilePrompt();
  window.prompt = real; window.alert = ra;
  return { id: id, alerts: alerts, has: _selProfiles().some(p => p.name === 'Nonsense') };
});
check('a cover width that cannot be right is refused', v.id == null && !v.has, JSON.stringify(v));
check('…and says why', /between 100mm and 2000mm/.test(v.alerts.join(' ')), JSON.stringify(v.alerts));
v = await pg.evaluate(() => {
  const real = window.prompt; const ra = window.alert; let said = '';
  window.alert = m => { said = String(m); };
  window.prompt = () => '';                       // no name given
  const id = _selAddProfilePrompt();
  window.prompt = real; window.alert = ra;
  return { id: id, said: said };
});
check('a profile with no name is refused too', v.id == null && /needs a name/.test(v.said), JSON.stringify(v));

// ── the customer never adds products ──
v = await pg.evaluate(() => {
  window.__CUSTOMER_MODE = true;
  const before = _selProfiles().length;
  const r = _selAddProfilePrompt();
  document.getElementById('sheetWidth').value = '762';
  _setProposalOption_profile('tray500');
  const box = document.getElementById('sheetWidth').value;
  window.__CUSTOMER_MODE = false;
  return { r: r, same: before === _selProfiles().length, box: box };
});
check('a customer cannot add a profile to the roofer\'s product list',
  v.r == null && v.same, JSON.stringify(v));
check('…and their browser never recomputes the take-off', v.box === '762', v.box);

// ── Settings → Products ──
v = await pg.evaluate(() => {
  renderSelectablesUI();
  const box = document.getElementById('selectablesUI');
  return { txt: box.textContent,
           covers: box.querySelectorAll('input[onchange*="coverMm"]').length };
});
check('Settings shows a cover width against every profile',
  v.covers >= 3, v.covers + ' fields');
check('…and says what cover width means, in the roofer\'s terms',
  /width ONE sheet covers once it is lapped/.test(v.txt), v.txt.slice(0, 60));

// It is a number, not text — a typo must not become a string on the product.
v = await pg.evaluate(() => {
  _selEdit('profiles', 0, 'coverMm', '640');
  const p = _selKindList('profiles')[0];
  return { v: p.coverMm, t: typeof p.coverMm };
});
check('a cover width typed in Settings is stored as a number', v.v === 640 && v.t === 'number', JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
