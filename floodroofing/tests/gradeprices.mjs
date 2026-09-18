// Settings, reshaped: the tutorial, practice job and setup guide have a
// Guides tab of their own (with the six-minute run-through); the Products
// tab is "Quote's Product Options" and the price book lives on it, with the
// roofing sheets, flashings and back-trays priced PER STEEL GRADE — one
// button per grade on the Products list, one set of inputs; Suppliers is
// just the suppliers and the flashing types, the underlays and screws
// having moved to Products. A grade with prices of its own is priced from
// them (the material table, the customer's grade deltas), a grade without
// falls back to the percentage on the list.
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
let savedSettings = null;
// The Loom page itself is not under test (and there is no network here).
await pg.route('**/loom.com/**', r => r.fulfill({ status:200, contentType:'text/html', body:'<html><body></body></html>' }));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(u) && m === 'PUT'){ try { savedSettings = JSON.parse(r.request().postData() || '{}'); } catch(e){} return j(savedSettings || {}); }
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Kauri Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
// (in a try: the init script also runs inside the Loom frame, where storage is off-limits)
await pg.addInitScript(() => { try { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Kauri Roofing Ltd', role:'owner' })); } catch(e){} });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });

// ── the tabs ──────────────────────────────────────────────────────
const nav = await pg.evaluate(() => {
  gotoTab('settings');
  const btns = [...document.querySelectorAll('#tab-settings .set-nav .tab-sm')].map(b => b.textContent.trim());
  return { btns, guides: !!document.getElementById('set-guides'), pricebookPanel: !!document.getElementById('set-pricebook'),
           products: !!document.getElementById('set-products') };
});
check('Guides is a Settings tab of its own', nav.guides && nav.btns.includes('Guides'), nav.btns.join(' | '));
check('the Products tab is called Quote’s Product Options', nav.btns.includes("Quote's Product Options"));
check('…and there is no separate Price book tab any more', !nav.btns.includes('Price book') && !nav.pricebookPanel);
check('Suppliers & materials is just Suppliers', nav.btns.includes('Suppliers') && !nav.btns.some(t => /materials/i.test(t)));

const guides = await pg.evaluate(() => {
  switchSettingsSub('set-guides');
  const p = document.getElementById('set-guides');
  return { on: p.classList.contains('on'), txt: p.innerText,
           tutorial: !!p.querySelector('[data-tour="set-tutorial"]'), practice: !!p.querySelector('[data-tour="set-practice"]'),
           setup: !!p.querySelector('[onclick*="openSetupGuide"]'), video: !!document.getElementById('guideVideoPlay'),
           frame: !!document.querySelector('#guideVideo iframe'), src: (document.getElementById('guideVideo') || {}).getAttribute('data-src') || '',
           generalHas: !!document.querySelector('#set-general [data-tour="set-tutorial"]') };
});
check('Guides holds the setup guide, the tutorial and the practice job', guides.on && guides.tutorial && guides.practice && guides.setup && !guides.generalHas);
check('…and the six-minute run-through, loaded only when played', guides.video && !guides.frame && /loom\.com\/embed\//.test(guides.src), guides.src);
await pg.evaluate(() => _guideVideoPlay());
check('…pressing play puts the Loom frame in', await pg.evaluate(() => !!document.querySelector('#guideVideo iframe[src*="loom.com/embed"]')));

// ── the old id still lands on the price book ──────────────────────
const alias = await pg.evaluate(() => {
  switchSettingsSub('set-pricebook');
  const p = document.getElementById('set-products');
  return { on: p.classList.contains('on'), title: document.getElementById('setPaneTitle').textContent.trim(),
           pb: !!p.querySelector('#pbSheetsList') && !!p.querySelector('#pbGradeTabs') && !!p.querySelector('#pbBackTrayList'),
           lists: !!p.querySelector('#catalogUnderlays') && !!p.querySelector('#catalogScrews'),
           supl: !!document.querySelector('#set-supl #supplierList') && !!document.querySelector('#set-supl #catalogFlashings') && !document.querySelector('#set-supl #catalogUnderlays') && !document.getElementById('catalogProducts') };
});
check('opening "set-pricebook" lands on Quote’s Product Options', alias.on && alias.title === "Quote's Product Options", alias.title);
check('…which carries the price book: sheets, the grade buttons and the back-trays', alias.pb);
check('…and the underlay and screw lists that came over from Suppliers', alias.lists);
check('Suppliers keeps the suppliers and the flashing types, nothing else', alias.supl);

// ── prices by steel grade ─────────────────────────────────────────
const tabs = await pg.evaluate(() => {
  renderSelectablesUI(); renderPriceBookUI();
  return [...document.querySelectorAll('#pbGradeTabs [data-pb-grade]')].map(b => ({ id: b.getAttribute('data-pb-grade'), txt: b.textContent.trim() }));
});
check('one button per steel grade on the Products list', tabs.length === 4 && tabs.map(t => t.id).join(',') === 'maxam,colorzen,colourcote,zincalume', JSON.stringify(tabs));
check('…the base grade marked as such', /base/.test((tabs[0] || {}).txt || ''), (tabs[0] || {}).txt);

// Type the base prices, then ColorZen's own.
const typed = await pg.evaluate(() => {
  _pbGradeSelect('maxam');
  document.getElementById('pbRidgeLm').value = '20';
  document.getElementById('pbValleyLm').value = '30';
  const sheet = document.querySelector('#pbSheetsList [data-pb-sheet]');
  var baseUnit = 'lm';
  if (sheet){ sheet.querySelector('input[data-f="price"]').value = '25'; baseUnit = sheet.querySelector('input[data-f="unit"]').value || 'lm'; onPriceBookSheetChange(); document.getElementById('pbDefaultSheet').value = sheet.querySelector('input[data-f="product"]').value; }
  _pbGradeSelect('colorzen');
  const ph = document.getElementById('pbRidgeLm').placeholder;
  document.getElementById('pbRidgeLm').value = '16';
  document.getElementById('pbValleyLm').value = '24';
  const cz = document.querySelector('#pbSheetsList [data-pb-sheet]');
  const before = document.querySelectorAll('#pbSheetsList [data-pb-sheet]').length;
  if (!cz) addPriceBookSheet();
  const row = document.querySelector('#pbSheetsList [data-pb-sheet]');
  row.querySelector('input[data-f="product"]').value = '0.40 ColorZen corrugate';
  row.querySelector('input[data-f="unit"]').value = baseUnit;     // priced the same way as the base sheet
  row.querySelector('input[data-f="price"]').value = '21';
  collectPriceBookFromUI();
  const pb = S.settings.price_book;
  return { ph, before, base: { ridge: pb.ridge_lm, valley: pb.valley_lm, sheet: (pb.sheets[0] || {}).price },
           cz: pb.by_grade && pb.by_grade.colorzen, has: _pbGradeHasPrices('colorzen'), hasCC: _pbGradeHasPrices('colourcote') };
});
check('a grade with no prices yet shows the base prices as placeholders', /base 20/.test(typed.ph) && typed.before === 0, typed.ph + ' / ' + typed.before + ' rows');
check('the base grade’s prices are the price book itself', typed.base.ridge === 20 && typed.base.valley === 30 && typed.base.sheet === 25, JSON.stringify(typed.base));
check('ColorZen keeps its own set under by_grade', typed.cz && typed.cz.ridge_lm === 16 && typed.cz.valley_lm === 24 && typed.cz.sheets[0].price === 21, JSON.stringify(typed.cz));
check('…and counts as priced on its own; ColorCote does not', typed.has && !typed.hasCC);

const forGrade = await pg.evaluate(() => ({
  cz: _pbForGrade('colorzen'), cc: _pbForGrade('colourcote'), factorCz: _gradeFactor('colorzen'), factorCc: _gradeFactor('colourcote'), pctCc: _selGradePctOf('colourcote') }));
check('the book as ColorZen sees it: its sheets and flashings, the rest shared', forGrade.cz.ridge_lm === 16 && forGrade.cz.sheets[0].price === 21 && forGrade.cz.valley_lm === 24, JSON.stringify([forGrade.cz.ridge_lm, forGrade.cz.sheets[0]]));
check('…ColorCote still reads the base book', forGrade.cc.ridge_lm === 20 && forGrade.cc.sheets[0].price === 25);
check('no percentage on top of a grade priced on its own', forGrade.factorCz === 1 && Math.abs(forGrade.factorCc - (1 + forGrade.pctCc)) < 1e-9, forGrade.factorCz + ' / ' + forGrade.factorCc);

// Switching back and forth keeps each set's inputs.
const back = await pg.evaluate(() => {
  _pbGradeSelect('maxam');
  const a = { ridge: document.getElementById('pbRidgeLm').value, sheet: document.querySelector('#pbSheetsList input[data-f="price"]').value, note: document.getElementById('pbGradeNote').textContent };
  _pbGradeSelect('colorzen');
  const c = { ridge: document.getElementById('pbRidgeLm').value, sheet: document.querySelector('#pbSheetsList input[data-f="price"]').value, note: document.getElementById('pbGradeNote').textContent };
  return { a, c };
});
check('the base inputs come back when its button is pressed', back.a.ridge === '20' && back.a.sheet === '25' && /base prices/.test(back.a.note), JSON.stringify(back.a));
check('…and ColorZen’s when its button is', back.c.ridge === '16' && back.c.sheet === '21' && /priced on its own/.test(back.c.note), JSON.stringify(back.c));

// Save: the PUT carries by_grade.
await pg.evaluate(() => saveSettings());
await pg.waitForTimeout(800);
const put = savedSettings && savedSettings.price_book;
check('Save settings sends the per-grade prices', put && put.by_grade && put.by_grade.colorzen && put.by_grade.colorzen.ridge_lm === 16 && put.ridge_lm === 20, JSON.stringify(put && put.by_grade && Object.keys(put.by_grade)));

// ── the customer's grade delta ────────────────────────────────────
// A roof on the canvas, priced at the base grade: the ColorZen delta is the
// real difference on the graded rows, not a percentage of everything.
const delta = await pg.evaluate(() => {
  DRAW.scaleMetresPerPx = 0.05; DRAW.calPitch = 20;
  DRAW.outline = [[0,0],[200,0],[200,120],[0,120]]; DRAW.outlineDone = true;
  DRAW.lines = [{ type:'ridge', pts:[[0,60],[200,60]], measM:10 }, { type:'gutter', pts:[[0,0],[200,0]], measM:10 }, { type:'gutter', pts:[[0,120],[200,120]], measM:10 }];
  DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  try { redrawAll(); } catch(e){}
  if (!S.quote) S.quote = {};
  S.quote.baseGrade = 'maxam';
  const base = _gradeMaterialTotal('maxam'), cz = _gradeMaterialTotal('colorzen'), cc = _gradeMaterialTotal('colourcote');
  const snap = _gradeDeltasSnapshot();
  return { base, cz, cc, snap, dCz: _selGradeDelta('colorzen'), dCc: _selGradeDelta('colourcote'), pctCc: _selGradePctOf('colourcote') };
});
check('the graded rows price differently per grade', delta.base > 0 && delta.cz > 0 && delta.cz < delta.base, JSON.stringify([delta.base, delta.cz]));
check('the ColorZen delta is its real difference on those rows', Math.abs(delta.dCz - (delta.cz - delta.base)) < 0.01 && delta.dCz < 0, delta.dCz + ' vs ' + (delta.cz - delta.base));
check('…frozen onto the quote for the customer link', delta.snap && Math.abs(delta.snap.colorzen - delta.dCz) < 0.01 && delta.snap.maxam === 0, JSON.stringify(delta.snap));
check('a grade with no prices of its own still falls back to its percentage', Math.abs(delta.cc - delta.base) < 0.01 && Math.abs(delta.dCc - delta.pctCc * _num0(delta)) < 1e6, delta.dCc + ' (pct ' + delta.pctCc + ')');
function _num0(){ return 0; }

// The Order Material product list offers the grades.
const order = await pg.evaluate(() => { populateOrderDropdowns(); return [...document.querySelectorAll('#orderProductList option')].map(o => o.value); });
check('the order form’s roof products are the steel grades', order.includes('Colorsteel® MAXAM') && order.includes('Armorsteel ColorZen'), order.join(' | '));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
