// THE JOB COMPLEXITY MULTIPLIER AND THE OWN-CREW SCAFFOLD HOURS (2026-11-10,
// the owner: "the scaffolding done by your crew should be editable, so the
// user can put in their own hours for their different square meters. And also
// put a multiplier for a two-story house ... 1.5 by default ... in the roof
// labor ... just above the worker hours ... job complexity multiplier ... will
// up the calculated hours for that job ... in the price by square meters, put
// it inside that yellow banner as well. That will increase the default rate").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1440, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u) && m === 'PUT') return r.fulfill({ status:200, contentType:'application/json', body:r.request().postData() });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{},
    labour_pricing:{ lead_price:180, lead_cost:45, app_price:70, app_cost:25, scaffold_price:2500, scaffold_cost:2000, labour_m2: 40 } });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings'); sessionStorage.setItem('fr_setup_later','1');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[100,100],[700,100],[700,400],[100,400]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(500);
await pg.evaluate(() => { gotoTab('quote'); _openPricingPanel(true); calcLabour(); });
await pg.waitForTimeout(400);

// ── the row, where he asked for it ──────────────────────────────────
let v = await pg.evaluate(() => {
  const row = document.getElementById('jobMultRow');
  const tbl = row && row.nextElementSibling;
  return { there: !!row, text: row ? row.textContent : '', aboveCrew: !!(tbl && tbl.tagName === 'TABLE' && /Lead Roofer/.test(tbl.textContent)),
           btns: row ? [...row.querySelectorAll('button')].map(b => b.textContent) : [], mult: _jobMult(),
           base: _labourCalcHours(0).hours2, raw: _labourCalcHours(0).raw, lead: S.quote.labour.leadHrs };
});
check('the Roof Labour card carries "Job complexity multiplier (i.e. two-storey / poor access etc.)" straight above the crew rows',
  v.there && /Job complexity multiplier/.test(v.text) && /two-storey \/ poor access etc\./.test(v.text) && v.aboveCrew, v.text.slice(0, 90));
check('…with Standard ×1 and Two-storey ×1.5 buttons and a typed box, standard by default', v.btns.join('|') === 'Standard ×1|Two-storey ×1.5' && v.mult === 1, v.btns.join('|'));
const base = v.base, raw = v.raw;
check('the auto-calculated hours are applied as they are at ×1', base > 0 && v.lead === base, JSON.stringify([base, v.lead]));

// ── two-storey lifts the auto hours and the m² default, never typed figures ──
v = await pg.evaluate(() => {
  _setJobMult(1.5);
  return { mult: _jobMult(), stored: S.quote.jobMult, hrs: _labourCalcHours(0).hours2, lead: S.quote.labour.leadHrs, app: S.quote.labour.appHrs,
           input: (document.getElementById('jobMultInput') || {}).value, m2: _labourM2Rate() };
});
check('Two-storey stores ×1.5 on the quote and the calculated hours go up with it',
  v.mult === 1.5 && v.stored === 1.5 && v.hrs === Math.ceil(raw * 1.5) && v.hrs > base && v.lead === v.hrs && v.app === v.hrs && v.input === '1.5', JSON.stringify(v));
check('…and the standard $/m² rate from Settings is lifted too (40 → 60)', v.m2 === 60, String(v.m2));
v = await pg.evaluate(() => {
  _setLabourMode('m2'); calcLabour();
  const banner = [...document.querySelectorAll('#roofPriceTile div')].find(d => /Standard rate × 1\.5 \(job complexity\)/.test(d.textContent));
  const r1 = _labourM2Rate();
  S.quote.labourM2 = 55; const r2 = _labourM2Rate();
  delete S.quote.labourM2; _setLabourMode('hourly');
  return { banner: !!banner, r1, r2 };
});
check('the by-the-m² banner says the rate carries the multiplier', v.banner && v.r1 === 60, JSON.stringify(v));
check('…but a rate typed on this job is charged exactly as typed', v.r2 === 55, String(v.r2));
v = await pg.evaluate(() => {
  _setLabourHrsManual(0, true); S.quote.labour.leadHrs = 12; S.quote.labour.appHrs = 12;
  _setJobMult(2); const typed = [S.quote.labour.leadHrs, S.quote.labour.appHrs];
  _setLabourHrsManual(0, false); _setJobMult(1); calcLabour();
  return { typed, back: S.quote.labour.leadHrs, gone: !('jobMult' in S.quote) };
});
check('hours typed by hand are left alone by the multiplier', v.typed.join() === '12,12');
check('Standard ×1 drops the key and the hours come back to the calculated figure', v.gone && v.back === base, JSON.stringify(v));

// ── the own-crew scaffold hours follow it ──────────────────────────
v = await pg.evaluate(() => {
  _scaffoldSetExcluded(false); _scaffoldSetMode('diy'); calcLabour();
  const a = _scaffoldAreaFor(0), h1 = S.quote.scaffold.diy.leadHrs;
  _setJobMult(1.5); const h2 = S.quote.scaffold.diy.leadHrs;
  const note = (document.querySelector('#scaffoldWrap .px-note:not(:first-child)') || {}).textContent || document.getElementById('scaffoldWrap').textContent;
  _setJobMult(1);
  return { a, h1, h2, note: /× 1\.5 job complexity/.test(note) };
});
check('Do it ourselves hours are the band\'s hours × the multiplier, and the card says so', v.h2 === Math.round(v.h1 * 1.5 * 10) / 10 && v.note, JSON.stringify(v));

// ── Settings: the hours table is editable and the two-storey figure is theirs ──
v = await pg.evaluate(() => {
  gotoTab('settings'); switchSettingsSub('set-scaffold');
  const inputs = [...document.querySelectorAll('#lpScaffTiers input[data-lp-tier]')];
  const ph = inputs.map(i => i.placeholder);
  inputs[1].value = '7'; inputs[1].dispatchEvent(new Event('change'));
  inputs[5].value = '20'; inputs[5].dispatchEvent(new Event('change'));
  const sm = document.getElementById('lpStoreyMult'); sm.value = '1.8'; collectLabourPricingFromUI(); calcLabour();
  return { n: inputs.length, ph, tiers: JSON.stringify(S.settings.labour_pricing.scaff_tiers), storey: S.settings.labour_pricing.storey_mult,
           h80: _scaffTierHrs(1), h400: _scaffoldDiyHrsForArea(400), h30: _scaffoldDiyHrsForArea(30), two: _storeyMult(),
           btn: [...document.querySelectorAll('#jobMultRow button')].map(b => b.textContent).join('|') };
});
check('Settings → Scaffolding shows six editable bands with RoofMap\'s hours as the placeholders', v.n === 6 && v.ph.join() === '4,6,8,10,12,15', v.ph.join());
check('typing a band\'s hours is stored and used; a blank band keeps RoofMap\'s figure',
  v.tiers === '[null,7,null,null,null,20]' && v.h80 === 7 && v.h400 === 20 && v.h30 === 4, JSON.stringify(v));
check('the two-storey multiplier is the office\'s to set (1.8), and the quote\'s button follows it', v.storey === 1.8 && v.two === 1.8 && /Two-storey ×1\.8/.test(v.btn), v.btn);
v = await pg.evaluate(() => { const i = document.querySelector('#lpScaffTiers input[data-lp-tier="1"]'); i.value = ''; i.dispatchEvent(new Event('change')); document.getElementById('lpStoreyMult').value = ''; collectLabourPricingFromUI(); return { tiers: JSON.stringify(S.settings.labour_pricing.scaff_tiers), storey: S.settings.labour_pricing.storey_mult, two: _storeyMult() }; });
check('clearing a box puts RoofMap\'s figure back (1.5 for two-storey)', v.tiers === '[null,null,null,null,null,20]' && v.storey === undefined && v.two === 1.5, JSON.stringify(v));

check('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
