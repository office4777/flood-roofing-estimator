// LABOUR AUTO-CALCULATIONS COVER THE WHOLE RE-ROOF AND LIVE IN SETTINGS
// (2026-11-10, the owner: "make it more expansive to cover all the aspects of
// roofing, re-roofing ... strip existing roofing, strip existing tiles, install
// new purlins, underlay ... strip existing tile roofing should take about 1.5
// times longer than existing steel roofing ... put it all into a settings where
// a roofer can adjust their own calculations ... tidy up the quantities, make
// them in line ... put a edit auto calculations button, which jumps the user to
// the settings labor pricing tab").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1440, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const puts = [];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u) && m === 'PUT'){ puts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status:200, contentType:'application/json', body:r.request().postData() }); }
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{},
    labour_pricing:{ lead_price:180, lead_cost:45, app_price:70, app_cost:25, scaffold_price:2500, scaffold_cost:2000, per_item_hours:{ 'Strip existing roofing': 6 } } });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[100,100],[700,100],[700,400],[100,400]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { const rs = document.getElementById('_rsModal'); if (rs){ try { rs._rsClose ? rs._rsClose() : rs.remove(); } catch(e){ rs.remove(); } } });
await pg.evaluate(() => { gotoTab('quote'); _openPricingPanel(true); });
await pg.waitForTimeout(1500);

// ── the drivers, and the default hours are the old hours ──
let v = await pg.evaluate(() => {
  const c = _labourCalcHours(0);
  const q = _labourCalcQty(0);
  const old = q.roof / 14 + q.sheets / 6 + q.cuts / 18 + q.flash / 8 + q.pen / 6;
  return { keys: c.rows.map(r => r.key), labels: c.rows.map(r => r.label), raw: c.raw, old, roof: q.roof, strip: q.strip, underlay: q.underlay,
    lead: S.quote.labour.leadHrs, hours2: c.hours2 };
});
check('the drivers are strip, underlay, install & clean-up, sheets, cuts, flashings, penetrations (purlins only when ticked)',
  v.keys.join(',') === 'strip,underlay,roof,sheets,cuts,flash,pen' && /steel/i.test(v.labels[0]), JSON.stringify(v.keys));
check('strip and underlay run over the roof’s own m²', v.roof > 0 && v.strip === v.roof && v.underlay === v.roof, JSON.stringify([v.roof, v.strip, v.underlay]));
check('with RoofMap’s defaults the hours are what the old single Roofing rate gave (1/28 + 1/56 + 1/56 = 1/14)', Math.abs(v.raw - v.old) < 1e-6 && v.lead === v.hours2, JSON.stringify([v.raw, v.old, v.lead]));

// ── tiles take 1.5× longer to strip; a new build strips nothing; purlins add a row ──
v = await pg.evaluate(() => {
  const steel = _labourCalcHours(0).rows.find(r => r.key === 'strip').hours;
  _setLabourCalcExisting('tile');
  const tileRow = _labourCalcHours(0).rows.find(r => r.key === 'strip');
  _setLabourCalcExisting('none');
  const none = _labourCalcHours(0).rows.find(r => r.key === 'strip');
  _setLabourCalcExisting('steel');
  _setLabourCalcPurlins(true);
  const withP = _labourCalcHours(0);
  const pRow = withP.rows.find(r => r.key === 'purlins');
  _setLabourCalcPurlins(false);
  const without = _labourCalcHours(0).rows.some(r => r.key === 'purlins');
  return { steel, tile: tileRow.hours, tileLabel: tileRow.label, none: none.hours, pRow: pRow && { qty: pRow.qty, rate: pRow.rate, hours: pRow.hours }, without };
});
check('tiles: the strip row takes 1.5× the steel hours and says so', Math.abs(v.tile - v.steel * 1.5) < 1e-6 && /tiles/i.test(v.tileLabel), JSON.stringify([v.steel, v.tile, v.tileLabel]));
check('a new build strips nothing', v.none === 0);
check('New purlins adds a purlins row over the roof m² at 30 m²/hr, and only while ticked', v.pRow && v.pRow.rate === 30 && v.pRow.qty > 0 && Math.abs(v.pRow.hours - v.pRow.qty / 30) < 1e-6 && !v.without, JSON.stringify(v));

// ── the panel: in line, the job's choices, the Edit button ──
v = await pg.evaluate(async () => {
  _toggleShowLabourCalc(true); await new Promise(r => setTimeout(r, 300));
  const w = document.getElementById('labourTableWrap');
  const qtys = [...w.querySelectorAll('.lc-table .lc-qty')];
  const lefts = qtys.map(i => Math.round(i.getBoundingClientRect().left));
  const rateInputs = w.querySelectorAll('input[onchange*="_setLabourCalcRate"]').length;
  const btn = w.querySelector('.lc-edit');
  const out = { n: qtys.length, sameLeft: lefts.every(x => x === lefts[0]), rateInputs, btn: btn && btn.textContent.trim(),
    existing: !!w.querySelector('[data-lc-existing]'), purlins: !!w.querySelector('[data-lc-purlins]') };
  btn.click(); await new Promise(r => setTimeout(r, 400));
  out.tab = document.body.getAttribute('data-tab');
  out.sub = (document.querySelector('#tab-settings .settings-sub.on') || {}).id;
  out.calcSec = !!document.querySelector('#set-labour.on #lpCalcSec');
  out.oldList = !!document.getElementById('lpItemsList');
  out.rows = [...document.querySelectorAll('#lpCalcList [data-lp-calc]')].map(i => i.getAttribute('data-lp-calc'));
  out.placeholders = [...document.querySelectorAll('#lpCalcList [data-lp-calc]')].map(i => i.placeholder);
  return out;
});
check('the quantity boxes sit in one column, the rates are read-only on the job, the job picks Existing roof and New purlins',
  v.n >= 7 && v.sameLeft && v.rateInputs === 0 && v.existing && v.purlins, JSON.stringify(v));
check('"Edit auto-calculations" jumps to Settings → Labour pricing → Labour auto-calculations', /Edit auto-calculations/.test(v.btn) && v.tab === 'settings' && v.sub === 'set-labour' && v.calcSec, JSON.stringify([v.btn, v.tab, v.sub, v.calcSec]));
check('the old Default hours per scope item list is off the page; the eight drivers are on it with RoofMap’s defaults as placeholders',
  !v.oldList && v.rows.join(',') === 'strip,underlay,purlins,roof,sheets,cuts,flash,pen' && v.placeholders.join(',') === '28,56,30,56,6,18,8,6', JSON.stringify([v.rows, v.placeholders]));

// ── a rate typed in Settings drives the job; the retired list's figures survive the save ──
v = await pg.evaluate(async () => {
  const inp = document.querySelector('#lpCalcList [data-lp-calc="strip"]'); inp.value = '14'; inp.dispatchEvent(new Event('change'));
  const tf = document.getElementById('lpStripTileFactor'); tf.value = '2'; tf.dispatchEvent(new Event('change'));
  await saveSettings(true); await new Promise(r => setTimeout(r, 300));
  const lp = S.settings.labour_pricing;
  gotoTab('quote'); await new Promise(r => setTimeout(r, 300)); calcLabour();
  const strip = _labourCalcHours(0).rows.find(r => r.key === 'strip');
  _setLabourCalcExisting('tile');
  const tile = _labourCalcHours(0).rows.find(r => r.key === 'strip');
  _setLabourCalcExisting('steel');
  return { calc: lp.calc_rates, tf: lp.strip_tile_factor, rate: strip.rate, tileRate: tile.rate };
});
{ const sent = puts.length ? puts[puts.length - 1].labour_pricing : null; v.sentCalc = sent && sent.calc_rates; v.sentPer = sent && sent.per_item_hours; }
check('a strip rate of 14 and a tile factor of 2 save and drive the job (14 m²/hr steel, 7 tiles)',
  v.calc && v.calc.strip === 14 && v.tf === 2 && v.rate === 14 && v.tileRate === 7, JSON.stringify(v));
check('…they ride the settings save, and the retired scope-hours figures are kept untouched',
  v.sentCalc && v.sentCalc.strip === 14 && v.sentPer && v.sentPer['Strip existing roofing'] === 6, JSON.stringify([v.sentCalc, v.sentPer]));

// ── Settings use the width ──
v = await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-labour'); const c = document.querySelector('#tab-settings .card .set-shell'); return { w: Math.round(c.getBoundingClientRect().width), max: getComputedStyle(document.querySelector('#tab-settings .card')).maxWidth }; });
check('the Settings card is no longer capped at 1080px', v.max === 'none' && v.w > 1000, JSON.stringify(v));
check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
