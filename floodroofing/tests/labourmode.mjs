// CHARGING LABOUR BY AREA, AND THE GUTTER BY THE METRE (the owner, 2026-10-08):
// "build the labour $/m2 typing, make the labour pricing switchable between
//  the current hourly or m2, for the gutter make the labour switchable from
//  hourly to LM (lineal meters) let the user set their default m2/lm rates in
//  settings, alway if they adjust it in the pricing tab ask if they would like
//  to save as the new default, make the switch between hourly and m2/lm two
//  big buttons at the top of each labour pricing section in the pricing tab,
//  once done, runs tests to emsure it all works properly and any changes carry
//  through and adjusts the quote and price prices/totals correctly".
//
// The rule the whole thing hangs on: THE MODE CHANGES THE PRICE, NEVER THE
// COST. Hours come off the drawing and are what the job really takes, so GP,
// GP/hr and the profitability panel stay honest whichever way it is charged.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1100 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let settingsPut = null;
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
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = { list_prices:false, sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
    ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24, screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
    underlay:{'50':150,'75':210,'100':270}, gutter:{ box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40, ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 }, extras:[] };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true}; S.quote.roofExcluded = {};
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2200);
await pg.evaluate(() => {
  S.quote.labourHrsManual = { 0: true };
  S.quote.labour = Object.assign(S.quote.labour || {}, { leadHrs: 20, appHrs: 20, leadPrice: 180, appPrice: 90, leadCost: 45, appCost: 25, extras: [] });
  S.quote.scaffold = Object.assign(S.quote.scaffold || {}, { price: 2500, cost: 2000, type: 'edge' });
  calcLabour(); resyncQuoteLines(); renderMaterialPriceTable(); renderProfitability(); renderGutterDownpipePricing();
});
await pg.waitForTimeout(500);

const read = () => pg.evaluate(() => {
  const lm = _selGutterLm();
  return { mode: _labourMode(), gMode: _gutterLabourMode(),
    labour: S.labour, cost: S.labourCost, hrs: S.labourHours,
    area: _labourCalcAutoQty(0).roof, sub: _quoteMoney().sub,
    m2Rate: _labourM2Rate(), lmRate: _gutterLmRate(),
    gutterLm: lm, gutterLab: _gutterLabourCharge(lm), gdCard: window._gdCardTotal,
    rates: { lead: S.quote.labour.leadPrice, app: S.quote.labour.appPrice },
    jobM2: S.quote.labourM2 || 0, jobLm: S.quote.gutterLabourLm || 0,
    setM2: (S.settings.labour_pricing || {}).labour_m2 || 0,
    setLm: (S.settings.labour_pricing || {}).gutter_lm || 0 };
});

// ── the two big buttons ───────────────────────────────────────────
const btns = await pg.evaluate(() => {
  const txt = (id) => { const e = document.getElementById(id); return e ? e.innerText.replace(/\s+/g,' ') : ''; };
  const n = (id, sel) => { const e = document.getElementById(id); return e ? e.querySelectorAll(sel).length : -1; };
  return { lab: txt('labourTableWrap'), gut: txt('gutterDownpipeWrap'),
           labBtns: n('labourTableWrap', 'button[onclick*="_setLabourMode"]'),
           gutBtns: n('gutterDownpipeWrap', 'button[onclick*="_setGutterLabourMode"]') };
});
check('the roof labour section opens with two big buttons — by the hour, or by the m²',
  btns.labBtns === 2 && /By the hour/.test(btns.lab) && /By the m²/.test(btns.lab), btns.lab);
check('the gutter labour section opens with its own two — by the hour, or per lineal metre',
  btns.gutBtns === 2 && /By the hour/.test(btns.gut) && /Per lineal metre/.test(btns.gut), btns.gut);

const hourly = await read();
check('a job starts charged by the hour, exactly as before', hourly.mode === 'hourly' && hourly.gMode === 'hourly');
check('…with labour at hours × the charge-out rates',
  Math.abs(hourly.labour - (20*180 + 20*90)) < 0.02, '$' + hourly.labour);

// ── no rate anywhere: the switch must not price the roof at nothing ──
await pg.evaluate(() => _setLabourMode('m2'));
await pg.waitForTimeout(350);
let v = await read();
check('switching to m² with NO rate set anywhere leaves the hourly figure standing — never $0',
  v.mode === 'm2' && Math.abs(v.labour - hourly.labour) < 0.02, '$' + v.labour);

// ── the Settings default ──────────────────────────────────────────
await pg.evaluate(() => {
  S.settings.labour_pricing = Object.assign(S.settings.labour_pricing || {}, { labour_m2: 40, gutter_lm: 22 });
  calcLabour(); resyncQuoteLines(); renderProfitability(); renderGutterDownpipePricing();
});
await pg.waitForTimeout(350);
const byArea = await read();
check('with a default rate in Settings the roof is charged at its area × that rate',
  byArea.m2Rate === 40 && Math.abs(byArea.labour - byArea.area * 40) < 0.02,
  byArea.area.toFixed(1) + ' m² × $40 = $' + byArea.labour.toFixed(2));
check('…and the quote total moves by exactly that difference, to the cent',
  Math.abs((byArea.sub - hourly.sub) - (byArea.labour - hourly.labour)) < 0.02,
  '$' + hourly.sub.toFixed(2) + ' → $' + byArea.sub.toFixed(2) + ' on labour $' + hourly.labour.toFixed(2) + ' → $' + byArea.labour.toFixed(2));
check('…while the COST is untouched, so the margin on screen stays a real number',
  Math.abs(byArea.cost - hourly.cost) < 0.005 && Math.abs(byArea.hrs - hourly.hrs) < 0.005,
  JSON.stringify({ cost: byArea.cost, hrs: byArea.hrs }));
check('…and the charge-out rates are left alone — the mode changed the price, not them',
  byArea.rates.lead === hourly.rates.lead && byArea.rates.app === hourly.rates.app, JSON.stringify(byArea.rates));

// ── this job's own rate beats the default ─────────────────────────
await pg.evaluate(() => _setLabourM2(55, false));
await pg.waitForTimeout(350);
v = await read();
check('a rate typed on this job beats the Settings default',
  v.m2Rate === 55 && Math.abs(v.labour - v.area * 55) < 0.02, '$' + v.labour.toFixed(2));
check('…and is kept on the quote, so it rides with the job',
  v.jobM2 === 55 && v.setM2 === 40, JSON.stringify({ job: v.jobM2, settings: v.setM2 }));

// ── "would you like to save that as the new default?" ─────────────
const ask = await pg.evaluate(async () => {
  const p = _setLabourM2(62);                       // the question only comes unasked-for
  await new Promise(r => setTimeout(r, 250));
  const seen = !!document.getElementById('matDefPriceModal');
  const txt = seen ? document.getElementById('matDefPriceModal').innerText.replace(/\s+/g,' ') : '';
  const btn = document.getElementById('matDefKeep'); if (btn) btn.click();
  await p;
  return { seen, txt };
});
check('changing the rate on the Pricing tab asks whether to make it the default',
  ask.seen && /default/i.test(ask.txt), ask.txt.slice(0, 110));
v = await read();
check('…"Just this job" leaves the Settings default where it was',
  v.jobM2 === 62 && v.setM2 === 40, JSON.stringify({ job: v.jobM2, settings: v.setM2 }));

settingsPut = null;
await pg.evaluate(async () => {
  const p = _setLabourM2(70);
  await new Promise(r => setTimeout(r, 250));
  const btn = document.getElementById('matDefSave'); if (btn) btn.click();
  await p;
});
await pg.waitForTimeout(900);
v = await read();
check('…and "Save as default" writes it into Settings → Labour pricing for the next job',
  v.setM2 === 70 && v.jobM2 === 70, JSON.stringify({ job: v.jobM2, settings: v.setM2 }));
check('…and saves it to the account, not just this screen',
  !!(settingsPut && settingsPut.labour_pricing && settingsPut.labour_pricing.labour_m2 === 70),
  JSON.stringify(settingsPut && settingsPut.labour_pricing && settingsPut.labour_pricing.labour_m2));

// ── typing the $/m² on the profitability panel ────────────────────
const typedM2 = await pg.evaluate(async () => {
  renderProfitability();
  const box = document.getElementById('profitLabM2');
  const before = parseFloat(box.value);
  box.value = '81'; box.dispatchEvent(new Event('change', { bubbles:true }));
  await new Promise(r => setTimeout(r, 300));
  const keep = document.getElementById('matDefKeep'); if (keep) keep.click();
  await new Promise(r => setTimeout(r, 300));
  renderProfitability();
  return { before, isInput: box.tagName === 'INPUT', after: parseFloat(document.getElementById('profitLabM2').value),
           labour: S.labour, area: _labourCalcAutoQty(0).roof };
});
check('the labour $/m² on the profitability panel is a box you type in',
  typedM2.isInput, typedM2.isInput ? 'input' : 'not an input');
check('…and charged by the m², typing it sets the rate the job is charged at',
  Math.abs(typedM2.after - 81) < 0.02 && Math.abs(typedM2.labour - typedM2.area * 81) < 0.05,
  JSON.stringify({ shown: typedM2.after, labour: typedM2.labour.toFixed(2) }));

// Charged by the HOUR the same box is a target: it moves every charge-out
// rate so the figure lands exactly where it was typed.
const typedHourly = await pg.evaluate(async () => {
  _setLabourMode('hourly');
  await new Promise(r => setTimeout(r, 250));
  renderProfitability();
  const before = { lead: S.quote.labour.leadPrice, app: S.quote.labour.appPrice, labour: S.labour };
  const box = document.getElementById('profitLabM2');
  box.value = '64'; box.dispatchEvent(new Event('change', { bubbles:true }));
  await new Promise(r => setTimeout(r, 400));
  renderProfitability();
  const area = _labourCalcAutoQty(0).roof;
  return { before, lead: S.quote.labour.leadPrice, app: S.quote.labour.appPrice,
           labM2: S.labour / area, custom: S.quote.labourRatesCustom === true };
});
check('charged by the hour, typing the $/m² lands the figure exactly where it was typed',
  Math.abs(typedHourly.labM2 - 64) < 0.02, typedHourly.labM2.toFixed(3));
check('…by moving every charge-out rate by the same amount, and marking the rates this job’s own',
  Math.abs((typedHourly.lead - typedHourly.before.lead) - (typedHourly.app - typedHourly.before.app)) < 0.02 && typedHourly.custom,
  JSON.stringify(typedHourly));

// ── the gutter, by the lineal metre ───────────────────────────────
const gutHourly = await read();
await pg.evaluate(() => { _setGutterLabourMode('lm'); renderGutterDownpipePricing(); renderProfitability(); });
await pg.waitForTimeout(400);
const gutLm = await read();
check('the gutter charged per lineal metre is its run × the rate',
  gutLm.gMode === 'lm' && gutLm.lmRate === 22 && Math.abs(gutLm.gutterLab - gutLm.gutterLm * 22) < 0.02,
  gutLm.gutterLm.toFixed(2) + ' lm × $22 = $' + gutLm.gutterLab.toFixed(2));
check('…which is a different figure from the hourly one, and the gutter card follows it',
  Math.abs(gutLm.gutterLab - gutHourly.gutterLab) > 0.02 &&
  Math.abs((gutLm.gdCard - gutHourly.gdCard) - (gutLm.gutterLab - gutHourly.gutterLab)) < 0.02,
  JSON.stringify({ hourly: gutHourly.gutterLab.toFixed(2), perLm: gutLm.gutterLab.toFixed(2),
                   card: gutHourly.gdCard.toFixed(2) + ' → ' + gutLm.gdCard.toFixed(2) }));
check('…and the roof’s own labour is not touched by the gutter’s switch',
  Math.abs(gutLm.labour - gutHourly.labour) < 0.02);

const gutTyped = await pg.evaluate(async () => {
  const p = _setGutterLabourLm(30);
  await new Promise(r => setTimeout(r, 250));
  const seen = !!document.getElementById('matDefPriceModal');
  const btn = document.getElementById('matDefSave'); if (btn) btn.click();
  await p;
  await new Promise(r => setTimeout(r, 600));
  renderGutterDownpipePricing();
  const lm = _selGutterLm();
  return { seen, rate: _gutterLmRate(), charge: _gutterLabourCharge(lm), lm,
           setLm: (S.settings.labour_pricing || {}).gutter_lm };
});
check('the gutter rate asks the same question, and saving it writes the $/lm default too',
  gutTyped.seen && gutTyped.rate === 30 && gutTyped.setLm === 30 &&
  Math.abs(gutTyped.charge - gutTyped.lm * 30) < 0.02, JSON.stringify(gutTyped));

// ── back to hourly, and nothing is left behind ────────────────────
await pg.evaluate(() => { _setGutterLabourMode('hourly'); _setLabourMode('hourly'); renderGutterDownpipePricing(); });
await pg.waitForTimeout(400);
const back = await read();
check('switching both back to hourly restores the hourly figures exactly',
  Math.abs(back.gutterLab - gutHourly.gutterLab) < 0.02 && Math.abs(back.labour - typedHourly.labM2 * back.area) < 0.5,
  JSON.stringify({ gutter: back.gutterLab.toFixed(2), labour: back.labour.toFixed(2) }));
check('…and the rates typed are still remembered for the next switch',
  back.jobM2 === 81 && back.jobLm === 30, JSON.stringify({ m2: back.jobM2, lm: back.jobLm }));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
