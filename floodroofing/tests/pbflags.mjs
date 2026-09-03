// "put a red flag inside the pricing tab banner and say 'Default price book,
//  add your prices in setting' and also put the same red flag in the 'price
//  book' in settings also where ever theres a $0 material item, flag it and
//  highlight that item in red."
//
// The book ships with real New Zealand trade rates so a first-run quote is in
// striking distance of the truth — but they are somebody else's rates, and a
// quote built on them can go to a customer without anyone noticing. That
// notice used to be amber, which reads as "noted, carry on".
//
// The $0 line is the worse one. A material with no price against it prices at
// nothing and drops out of the total in silence: the roofer cannot catch it by
// reading the quote, because the number simply comes out low.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1',
    branding:{ company_name:'Kauri Roofing Ltd', email:'office@example.co.nz' },
    quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Kauri Roofing Ltd', role:'owner' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','_rsModal'].forEach(i => {
  const e = document.getElementById(i); if (e) e.remove(); }); });
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
  finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
});
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2200);

// ── the shipped-rates flag ────────────────────────────────────────
{
  const n = await pg.evaluate(() => {
    const el = document.querySelector('[data-pb-listnote="pricing"] .pb-listnote');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { text: el.textContent.replace(/\s+/g,' ').trim(),
             border: cs.borderLeftColor, colour: cs.color };
  });
  check('a company still on the shipped rates is told so where it prices a job',
    !!n, n ? 'shown' : 'no notice');
  check('THE ASK: with a red flag, in those words',
    !!n && /🚩/.test(n.text) && /default price book/i.test(n.text) && /settings/i.test(n.text),
    n ? n.text.slice(0, 90) : '');
  // Amber read as "noted, carry on".
  check('…and it is actually red, not amber',
    !!n && /220, 38, 38/.test(n.border), n ? n.border : '');
}
{
  const s = await pg.evaluate(() => {
    switchSettingsSub('set-pricebook');
    const el = document.querySelector('[data-pb-listnote="settings"] .pb-listnote');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '';
  });
  check('THE ASK: the same flag is on the price book in Settings',
    /🚩/.test(s) && /default price book/i.test(s), s.slice(0, 90));
}

// ── a material with no price ──────────────────────────────────────
{
  const v = await pg.evaluate(() => {
    // Empty the sheet rates, the way a half-filled price book looks.
    const pb = S.settings.price_book;
    if (Array.isArray(pb.sheets)) pb.sheets.forEach(x => { x.price = 0; });
    Object.keys(pb.underlay || {}).forEach(k => {
      if (typeof pb.underlay[k] === 'number') pb.underlay[k] = 0; });
    renderMaterialPriceTable();
    const zero = [...document.querySelectorAll('#materialPriceTableWrap tr.pb-zero')];
    return { rows: document.querySelectorAll('#materialPriceTableWrap tbody tr').length,
             zero: zero.length,
             tags: document.querySelectorAll('.pb-zero-tag').length,
             bg: zero[0] ? getComputedStyle(zero[0]).backgroundColor : '',
             text: zero[0] ? zero[0].textContent.replace(/\s+/g,' ').trim() : '' };
  });
  check('THE ASK: a material with no price against it is flagged',
    v.zero > 0 && v.tags === v.zero, v.zero + ' flagged of ' + v.rows + ' rows');
  check('…and highlighted in red', /254, 242, 242/.test(v.bg), v.bg);
  check('…saying what is wrong, not just colouring it in',
    /no price/i.test(v.text), v.text.slice(0, 70));
}
{
  // A rate of zero on something the job does not use is not a mistake — the
  // flag has to mean something or it gets ignored like every other badge.
  const clean = await pg.evaluate(() => {
    const pb = S.settings.price_book;
    if (Array.isArray(pb.sheets)) pb.sheets.forEach(x => { x.price = 26.84; });
    Object.keys(pb.underlay || {}).forEach(k => {
      if (typeof pb.underlay[k] === 'number') pb.underlay[k] = 88; });
    renderMaterialPriceTable();
    return document.querySelectorAll('#materialPriceTableWrap tr.pb-zero').length;
  });
  check('…and priced materials are not flagged', clean === 0, clean + ' still flagged');
}

// ── handing the book on ───────────────────────────────────────────
check('the price book can be copied out, so a finished one can be handed over',
  await pg.evaluate(() => typeof _pbCopyBook === 'function' && !!document.querySelector('[onclick="_pbCopyBook()"]')));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
