// DISPLAY ON QUOTE (2026-11-10, the owner: "put in another column for each of
// these items called display on quote ... a tick box so the user can select
// which of the items he wants the customer to be able to select from ...
// to 90% of my customers I'd like to only offer them the basic view, but to
// the odd customer I'd like to select different profiles to add in").
// Steel grades, roof profiles and gutter profiles on Settings → Products each
// carry the tick; unticked = kept on the list, off every new quote, and the
// quote's own "Edit this quote's selections" window ticks it in for ONE quote.
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
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body: /\/settings/.test(r.request().url()) ? '{"user_id":"u1","branding":{"company_name":"Flood Roofing"},"jms_keys":{}}' : '[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); sessionStorage.setItem('fr_setup_later','1'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// ── the column ──────────────────────────────────────────────────────
let v = await pg.evaluate(() => {
  gotoTab('settings'); switchSettingsSub('set-products'); renderSelectablesUI();
  const heads = [...document.querySelectorAll('#selectablesUI table thead')].map(t => t.textContent.replace(/\s+/g,' ').trim());
  const ticks = [...document.querySelectorAll('#selectablesUI input.sel-onquote')];
  return { heads, n: ticks.length, allOn: ticks.every(t => t.checked), baseLocked: !!ticks.find(t => t.disabled) };
});
check('Steel grades, Roof profiles and Gutter profiles each carry a "Display on quote" column',
  v.heads.filter(h => /Display on quote/.test(h)).length === 3, v.heads.join(' | '));
check('…one tick per row, every shipped product ticked', v.n === 4 + 2 + 3 && v.allOn, String(v.n));
check('…and the base grade is always offered (its tick is locked)', v.baseLocked);

// ── untick ColorCote and Marley Classic in Settings ──────────────────
v = await pg.evaluate(() => {
  const gi = _selWorking().grades.findIndex(g => g.id === 'colourcote');
  const gu = _selWorking().gutters.findIndex(g => g.id === 'marley_classic');
  _selEdit('grades', gi, 'offQuote', true);
  _selEdit('gutters', gu, 'offQuote', true);
  S.quote = defaultQuote();
  return { stored: !!_selWorking().grades[gi].offQuote && !!_selWorking().gutters[gu].offQuote,
           still: _selGradesAll().some(g => g.id === 'colourcote'),
           grades: _selGrades().map(g => g.id), gutters: _selGutters().map(g => g.id),
           tick: document.querySelector('#selectablesUI input.sel-onquote:not(:checked)') != null };
});
check('unticking stores the flag on the product and keeps it on the list', v.stored && v.still && v.tick);
check('…and a new quote offers neither', !v.grades.includes('colourcote') && !v.gutters.includes('marley_classic'), JSON.stringify([v.grades, v.gutters]));
check('…while everything still ticked is offered as before', v.grades.join() === 'maxam,colorzen,zincalume' && v.gutters.join() === 'box125,marley_typhoon');

// the customer's page follows (the snapshot carries the flag, the quote carries no selShow)
v = await pg.evaluate(() => {
  gotoTab('quote'); S.quote.style = 'modern'; refreshQuoteProposal();
  const grades = [...document.querySelectorAll('#qpRoot [data-qb-opt="steelGrade"]')].map(e => e.dataset.qbVal);
  const gutters = [...document.querySelectorAll('#qpRoot [data-qb-opt="gutterType"]')].map(e => e.dataset.qbVal);
  return { grades, gutters };
});
check('the quote on screen leaves them out', !v.grades.includes('colourcote') && !v.gutters.includes('marley_classic'), JSON.stringify(v));

// ── this one customer gets ColorCote: the quote's selections window ──
v = await pg.evaluate(() => {
  _qselOpen();
  const row = [...document.querySelectorAll('#qselModal .qsel-row')].find(r => r.querySelector('[data-qsel-id="colourcote"]'));
  const cb = row && row.querySelector('input');
  return { listed: !!row, off: cb && !cb.checked, note: row ? row.querySelector('.qsel-why')?.textContent : '' };
});
check('the quote\'s selections window still lists it, unticked, saying so', v.listed && v.off && /not shown by default/.test(v.note), JSON.stringify(v));
v = await pg.evaluate(() => {
  const cb = document.querySelector('#qselModal [data-qsel-id="colourcote"]'); cb.checked = true; cb.dispatchEvent(new Event('change'));
  _qselSave();
  return { show: JSON.stringify(S.quote.selShow), grades: _selGrades().map(g => g.id),
           onPage: [...document.querySelectorAll('#qpRoot [data-qb-opt="steelGrade"]')].map(e => e.dataset.qbVal).includes('colourcote'),
           settingsStill: !!_selWorking().grades.find(g => g.id === 'colourcote').offQuote };
});
check('ticking it there adds it to THIS quote only', v.show === '{"grades":{"colourcote":true}}' && v.grades.includes('colourcote') && v.onPage, JSON.stringify(v));
check('…and Settings is untouched', v.settingsStill);
v = await pg.evaluate(() => { const keep = S.quote; S.quote = defaultQuote(); const g = _selGrades().map(x => x.id); S.quote = keep; return g; });
check('a fresh quote starts without it again', Array.isArray(v) && !v.includes('colourcote'), JSON.stringify(v));

// ── a quote that already picked it keeps it ──────────────────────────
v = await pg.evaluate(() => {
  const keep = S.quote; S.quote = defaultQuote(); S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions || {}, { gutterType: 'marley_classic' });
  const g = _selGutters().map(x => x.id); S.quote = keep; return g;
});
check('a quote with the unticked gutter already picked keeps offering it (nothing sent before moves)', v.includes('marley_classic'), JSON.stringify(v));

// ── the window's "keep one" guard counts off-by-default rows as off ──
v = await pg.evaluate(() => {
  const keep = S.quote; S.quote = defaultQuote();
  _selWorking().grades.forEach(g => { if (!g.base) g.offQuote = true; });
  _qselOpen();
  const on = [...document.querySelectorAll('#qselModal [data-qsel-kind="grades"]')].filter(c => c.checked).map(c => c.dataset.qselId);
  const cb = document.querySelector('#qselModal [data-qsel-id="maxam"]'); cb.checked = false; cb.dispatchEvent(new Event('change'));
  const msg = (document.querySelector('#qselModal .qsel-msg') || {}).textContent || '';
  _qselClose(); _selWorking().grades.forEach(g => { delete g.offQuote; }); S.quote = keep;
  return { on, msg };
});
check('with every other grade off by default, the base grade cannot be unticked', v.on.join() === 'maxam' && /Keep at least one/.test(v.msg), JSON.stringify(v));

check('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
