// Where a customer's quote link points — resolved AUTOMATICALLY, with
// nothing to type. There used to be a free-text "quote link domain" box in
// Settings; an owner typed a subdomain that had no DNS behind it, and a real
// customer's link resolved to nothing ("This site can't be reached",
// FR-74625). The box is retired: links use the business's verified custom
// domain when it has one, else its RoofMap subdomain, else roofmap.co.nz —
// and a stale stored value from the old box must be IGNORED and cleared.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => { errs.push(e.message); console.log('PAGEERROR', e.message); });
pg.on('dialog', d => d.accept());
let savedSettings = null;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  if (/\/settings/.test(r.request().url()) && r.request().method() === 'PUT'){
    savedSettings = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({status:200,contentType:'application/json',body: r.request().postData() || '{}'});
  }
  r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// ── the link the customer actually gets ──
let v = await pg.evaluate(() => {
  S.quote = S.quote || {}; S.quote.share = { token: 'tok123' }; S.quote.ref = '06121';
  S.currentJobId = 'job-a';
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Mrs Hale';
  return _customerLinkString();
});
check('with nothing configured, links go to roofmap.co.nz — never the host the office is on',
  v.startsWith('https://roofmap.co.nz/?q=tok123'), v);
check('…and carry the job number and id', /&j=06121/.test(v) && /&i=job-a/.test(v), v);

// The incident, pinned: a stored value from the retired free-text box —
// a domain with no DNS behind it — must never reach a customer link again.
v = await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.quote_defaults = Object.assign({}, S.settings.quote_defaults,
    { quote_domain: 'https://quote.floodroofing.co.nz' });
  return _customerLinkString();
});
check('a stale typed domain from the retired box is IGNORED — the link still works',
  v.startsWith('https://roofmap.co.nz/?q=tok123'), v);

// The business's RoofMap subdomain, when it picked one.
v = await pg.evaluate(() => {
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing', slug:'floodroofing' }));
  return _customerLinkString();
});
check('a business with a RoofMap address sends links on it',
  v.startsWith('https://floodroofing.roofmap.co.nz/?q=tok123'), v);

// A VERIFIED connected domain — the one path to a custom domain now — wins.
v = await pg.evaluate(() => {
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing', slug:'floodroofing', domain:'quote.floodroofing.co.nz' }));
  return _customerLinkString();
});
check('a domain the business VERIFIED on the Team screen wins',
  v.startsWith('https://quote.floodroofing.co.nz/?q=tok123'), v);
await pg.evaluate(() => localStorage.setItem('fr_company', '{}'));

// ── the Settings panel: informational, not another box to mistype ──
await pg.evaluate(() => {
  gotoTab('settings'); refreshSettingsUI();
  switchSettingsSub('set-quote', document.querySelector('[onclick*="set-quote"]'));
});
await pg.waitForTimeout(800);
v = await pg.evaluate(() => ({
  input: !!document.getElementById('qdQuoteDomain'),
  info: (document.getElementById('qdQuoteLinkInfo')||{}).textContent || '',
  blurb: (function(){ var el = document.getElementById('qdQuoteLinkInfo'); return el ? el.parentElement.textContent : ''; })(),
}));
check('the free-text domain box is gone', !v.input, '');
check('…replaced by a line showing where links actually go',
  /https:\/\/roofmap\.co\.nz\/\?q=/.test(v.info), v.info);
check('…that says it is automatic and points at the Team screen for a custom domain',
  /Set automatically/.test(v.blurb) && /Team/.test(v.blurb), v.blurb.slice(0, 160));
await pg.locator('#set-quote').screenshot({ path: S+'/quotedomain.png' });

// ── saving Settings heals a stale stored value ──
await pg.evaluate(() => saveSettings(true));
await pg.waitForTimeout(700);
v = await pg.evaluate(() => (S.settings.quote_defaults||{}).quote_domain);
check('saving Settings clears the stale stored domain for good',
  v === '' && savedSettings && savedSettings.quote_defaults && savedSettings.quote_defaults.quote_domain === '',
  'kept=' + JSON.stringify(v) + ' sent=' + JSON.stringify((savedSettings && savedSettings.quote_defaults || {}).quote_domain));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
