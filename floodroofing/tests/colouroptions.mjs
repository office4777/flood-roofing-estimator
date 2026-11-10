// COLOUR OPTIONS (the owner, 2026-11-09): "add a button next to the roof colour
// called 'Edit Colours' this should pop-up a big window showing all the colour
// options for that steel selection, then in the settings tab, add a sub-tab
// called 'Colour Options' which should show all the colour options for each
// steel grade (save all the existing as system built in colours) and seperate
// the different steel grades and gutter types to all have their own colours,
// make each section have all colours ticked in by default, then click to
// un-tick some of the colour so they aren't displayed in the quotes colour
// sections, also in the quote, if a colour is selected, show a section under
// the gutter section of the colour options for that gutter type."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const puts = [];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u) && m === 'PUT'){ puts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status:200, contentType:'application/json', body:r.request().postData() }); }
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);

// ── defaults: every built-in colour ticked ───────────────────────
const d0 = await pg.evaluate(() => ({
  maxamAll: _paletteForGradeIdAll('maxam').length, maxam: _paletteForGradeId('maxam').length,
  zen: _paletteForGradeId('colorzen').length, zenAll: _paletteForGradeIdAll('colorzen').length,
  typhoon: _gjPalette('marley_typhoon').list.length, typhoonAll: _gjPaletteAll('marley_typhoon').list.length,
  classic: _gjPalette('marley_classic').list.map(c => c.name),
  box: _gjPalette('box125').list.length,
  offMap: JSON.stringify(_colourOffMap()),
}));
check('with nothing unticked every grade and gutter offers its whole built-in chart',
  d0.maxam === 12 && d0.maxam === d0.maxamAll && d0.zen === d0.zenAll && d0.typhoon === 8 && d0.typhoon === d0.typhoonAll && d0.box === 12 && d0.offMap === '{}',
  JSON.stringify(d0));
check('Marley Classic is white only, untouched', d0.classic.length === 1 && d0.classic[0] === 'White');

// ── Settings → Colour Options ────────────────────────────────────
const set = await pg.evaluate(async () => {
  gotoTab('settings'); switchSettingsSub('set-colours');
  await new Promise(r => setTimeout(r, 300));
  const btn = document.querySelector('#tab-settings .set-nav button[onclick*="set-colours"]');
  const panel = document.getElementById('set-colours');
  const secs = [...document.querySelectorAll('#coSettingsRoot .co-sec')].map(s => ({
    scope: s.getAttribute('data-co-scope'), n: s.querySelectorAll('.co-sw').length, on: s.querySelectorAll('.co-sw.on').length }));
  return { btnText: btn && btn.textContent.trim(), on: panel && panel.classList.contains('on'), secs,
    heads: [...document.querySelectorAll('#coSettingsRoot .co-h')].map(h => h.textContent) };
});
check('the Settings nav has a "Colours" sub-tab that opens its panel', set.btnText === 'Colours' && set.on, JSON.stringify([set.btnText, set.on]));
check('…with a tile per painted steel grade and per gutter type, under their own headings',
  set.heads.join('|') === 'Steel grades|Gutter types' && set.secs.some(s => s.scope === 'grade:maxam') && set.secs.some(s => s.scope === 'grade:colorzen') &&
  !set.secs.some(s => s.scope === 'grade:zincalume') && set.secs.some(s => s.scope === 'gutter:box125') && set.secs.some(s => s.scope === 'gutter:marley_typhoon') && set.secs.some(s => s.scope === 'gutter:marley_classic'),
  JSON.stringify(set.secs));
check('…every colour ticked to start with', set.secs.every(s => s.n > 0 && s.n === s.on), JSON.stringify(set.secs));

// Untick Ebony on Maxam by clicking its card, and Copper on Typhoon.
const un = await pg.evaluate(async () => {
  const sec = document.querySelector('#coSettingsRoot .co-sec[data-co-scope="grade:maxam"]');
  const card = sec.querySelector('.co-sw[data-co-colour="Ebony®"]'); card.click();
  await new Promise(r => setTimeout(r, 100));
  const sec2 = document.querySelector('#coSettingsRoot .co-sec[data-co-scope="gutter:marley_typhoon"]');
  sec2.querySelector('.co-sw[data-co-colour="Copper"]').click();
  await new Promise(r => setTimeout(r, 1200));
  _colourOptionsRender(); await new Promise(r => setTimeout(r, 100));
  const s1 = document.querySelector('#coSettingsRoot .co-sec[data-co-scope="grade:maxam"]');
  return {
    ebonyOff: s1.querySelector('.co-sw[data-co-colour="Ebony®"]').classList.contains('off'),
    count: (s1.querySelector('[data-co-count]') || {}).textContent,
    maxam: _paletteForGradeId('maxam').map(c => c.name), zen: _paletteForGradeId('colorzen').length,
    typhoon: _gjPalette('marley_typhoon').list.map(c => c.name),
    map: JSON.stringify(_colourOffMap()),
    stored: JSON.stringify(((S.settings.materials_catalog || {}).colourOff) || null),
  };
});
check('unticking Ebony on Maxam takes it off that grade’s offered colours', un.ebonyOff && un.maxam.length === 11 && !un.maxam.includes('Ebony®') && /11 of 12/.test(un.count), JSON.stringify([un.maxam, un.count]));
check('…and ONLY that grade: Armorsteel keeps its 8', un.zen === 8);
check('…the gutter type has its own ticks: Typhoon loses Copper, nothing else', un.typhoon.length === 7 && !un.typhoon.includes('Copper'), JSON.stringify(un.typhoon));
check('the ticks live in materials_catalog.colourOff as the colours turned OFF', un.stored === '{"grade:maxam":{"Ebony®":true},"gutter:marley_typhoon":{"Copper":true}}', un.stored);
const saved = puts.length && JSON.stringify(((puts[puts.length - 1].price_book || {}).__materials_catalog || {}).colourOff || null);
check('…and ride the settings save (price_book.__materials_catalog)', saved === un.stored, String(saved));

// ── the quote: the roof colour section hides the unticked colour ──
const q = await pg.evaluate(async () => {
  gotoTab('quote'); await new Promise(r => setTimeout(r, 400));
  S.quote.proposalOptions = S.quote.proposalOptions || {};
  S.quote.proposalOptions.steelGrade = 'maxam';
  S.quote.proposalOptions.gutterType = 'none';
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 600));
  const col = document.getElementById('qd-colour');
  const out = {
    sw: col ? [...col.querySelectorAll('.qb-sw')].map(x => x.getAttribute('data-qb-colour')) : null,
    editBtn: !!(col && col.querySelector('.co-edit-btn')),
    keysNone: _qdSections().map(s => s.key),
  };
  S.quote.proposalOptions.gutterType = 'marley_typhoon';
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 600));
  const gc = document.getElementById('qd-gcolour'), kit = document.getElementById('qd-gutterkit');
  out.keysGut = _qdSections().map(s => s.key);
  out.gcSw = gc ? [...gc.querySelectorAll('.qb-sw')].map(x => x.getAttribute('data-qb-gcolour')) : null;
  out.gcEdit = !!(gc && gc.querySelector('.co-edit-btn'));
  out.gcBelowKit = !!(gc && kit && (kit.compareDocumentPosition(gc) & Node.DOCUMENT_POSITION_FOLLOWING));
  out.bookKeys = _qbPages().map(p => p.key);
  S.quote.proposalOptions.gutterColour = 'Black';
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 300));
  out.picks = _qbPicksAuto().filter(r => /colour/i.test(r[0]));
  return out;
});
check('the roof colour section offers 11 swatches, Ebony gone', q.sw && q.sw.length === 11 && !q.sw.includes('Ebony®'), JSON.stringify(q.sw));
check('…and carries an "Edit colours" button for the office', q.editBtn);
check('no gutter picked: no gutter colour section on a roofing quote', !q.keysNone.includes('gcolour'), JSON.stringify(q.keysNone));
check('a gutter picked: the gutter colour section sits under the gutter and its kit, computer and phone',
  q.keysGut.includes('gcolour') && q.gcBelowKit && q.keysGut.indexOf('gcolour') === q.keysGut.indexOf('gutterkit') + 1 &&
  q.bookKeys.indexOf('gcolour') === q.bookKeys.indexOf('gutterkit') + 1, JSON.stringify([q.keysGut, q.bookKeys]));
check('…offering that gutter type’s own colours with Copper unticked', q.gcSw && q.gcSw.length === 7 && !q.gcSw.includes('Copper') && q.gcEdit, JSON.stringify(q.gcSw));
check('the gutter colour picked is in the roofing quote’s picks', q.picks.some(r => r[0] === 'Gutter colour' && r[1] === 'Black'), JSON.stringify(q.picks));

// ── Edit colours window ───────────────────────────────────────────
const mod = await pg.evaluate(async () => {
  document.querySelector('#qd-colour .co-edit-btn').click();
  await new Promise(r => setTimeout(r, 200));
  const m = document.getElementById('coModal');
  const out = { open: !!m, title: m && m.querySelector('.qsel-hd b').textContent, n: m ? m.querySelectorAll('.co-sw').length : 0, w: m ? m.querySelector('.co-modal').getBoundingClientRect().width : 0 };
  m.querySelector('.co-sw[data-co-colour="Ebony®"]').click();
  await new Promise(r => setTimeout(r, 400));
  _colourEditPaint();
  out.ebonyOn = document.querySelector('#coModal .co-sw[data-co-colour="Ebony®"]').classList.contains('on');
  _colourEditClose();
  await new Promise(r => setTimeout(r, 400));
  out.quoteSw = [...document.querySelectorAll('#qd-colour .qb-sw')].length;
  return out;
});
check('"Edit colours" opens a big window naming the grade with all 12 of its colours', mod.open && /MAXAM/.test(mod.title) && mod.n === 12 && mod.w > 800, JSON.stringify(mod));
check('ticking Ebony back on there puts it back on the quote', mod.ebonyOn && mod.quoteSw === 12, JSON.stringify(mod));

// ── the customer reads the quote's own copy ───────────────────────
const cust = await pg.evaluate(async () => {
  _colourSet('grade', 'maxam', 'Karaka®', false);
  _qStampCustomerCopy();
  const stamped = JSON.stringify(S.quote.colourOff);
  window.__CUSTOMER_MODE = true;
  S.settings.materials_catalog.colourOff = {};
  const names = _paletteForGradeId('maxam').map(c => c.name);
  window.__CUSTOMER_MODE = false;
  return { stamped, names };
});
check('the customer’s copy carries the ticks and reads them with no Settings', JSON.parse(cust.stamped)['grade:maxam']['Karaka®'] === true && JSON.parse(cust.stamped)['gutter:marley_typhoon']['Copper'] === true && cust.names.length === 11 && !cust.names.includes('Karaka®'), JSON.stringify(cust));
check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
