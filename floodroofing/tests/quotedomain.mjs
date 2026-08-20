// Resolved from this file, so the suite runs from any checkout.
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
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

// ── what counts as a usable domain ──
const norm = await pg.evaluate(() => ({
  bare:      _normQuoteDomain('quote.floodroofing.co.nz'),
  https:     _normQuoteDomain('https://quote.floodroofing.co.nz'),
  spaced:    _normQuoteDomain('  QUOTE.FloodRoofing.CO.NZ  '),
  trailing:  _normQuoteDomain('https://roofmap.co.nz/'),
  blank:     _normQuoteDomain(''),
  http:      _normQuoteDomain('http://quote.floodroofing.co.nz'),
  path:      _normQuoteDomain('https://roofmap.co.nz/quotes/here'),
  query:     _normQuoteDomain('https://roofmap.co.nz/?q=x'),
  creds:     _normQuoteDomain('https://user:pw@roofmap.co.nz'),
  nodot:     _normQuoteDomain('localhost'),
  junk:      _normQuoteDomain('not a domain at all'),
  js:        _normQuoteDomain('javascript:alert(1)'),
}));
check('a plain domain is accepted and made absolute', norm.bare === 'https://quote.floodroofing.co.nz', norm.bare);
check('…so is one already written as a URL', norm.https === 'https://quote.floodroofing.co.nz', norm.https);
check('…whitespace and capitals are tidied up', norm.spaced === 'https://quote.floodroofing.co.nz', norm.spaced);
check('…and a trailing slash is dropped', norm.trailing === 'https://roofmap.co.nz', norm.trailing);
check('blank means "use whatever I am working on"', norm.blank === '');
// A pasted full URL is reduced to its origin rather than rejected: the link is
// always built as <origin>/?q=…, so a path could never have worked, and the
// live preview under the field shows exactly what was kept.
check('a pasted path or query is reduced to the domain, not thrown away',
  norm.path === 'https://roofmap.co.nz' && norm.query === 'https://roofmap.co.nz',
  JSON.stringify({p:norm.path, q:norm.query}));
check('http, credentials, javascript: and junk are all refused',
  [norm.http, norm.creds, norm.nodot, norm.junk, norm.js].every(x => x === ''),
  JSON.stringify([norm.http, norm.creds, norm.nodot, norm.junk, norm.js]));

// ── the link the customer actually gets ──
const link = pg.evaluate(() => {
  S.quote = S.quote || {}; S.quote.share = { token: 'tok123' }; S.quote.ref = '06121';
  S.currentJobId = 'job-a';
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Mrs Hale';
  return _customerLinkString();
});
let v = await link;
// The fallback used to follow whatever origin the office was on, which meant
// an office still working on the *.vercel.app host handed customers vercel
// links. Now the canonical domain is the floor, not the origin.
check('with no domain set, links go to roofmap.co.nz — never the host the office is on',
  v.startsWith('https://roofmap.co.nz/?q=tok123'), v);

v = await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.quote_defaults = Object.assign({}, S.settings.quote_defaults, { quote_domain: 'https://quote.floodroofing.co.nz' });
  return _customerLinkString();
});
check('with the business\'s domain set, the customer gets THAT domain',
  v.startsWith('https://quote.floodroofing.co.nz/?q=tok123'), v);
check('…and the link still carries the job number and id',
  /&j=06121/.test(v) && /&i=job-a/.test(v), v);

v = await pg.evaluate(() => {
  S.settings.quote_defaults.quote_domain = 'https://roofmap.co.nz/oops?x=1';
  return _customerLinkString();
});
check('a stored value with a path still yields a clean, working link',
  v === 'https://roofmap.co.nz/?q=tok123&j=06121&i=job-a', v);

// ── the Settings field ──
await pg.evaluate(() => {
  S.settings.quote_defaults.quote_domain = 'https://quote.floodroofing.co.nz';
  gotoTab('settings'); refreshSettingsUI();
  // The Quote-defaults panel is one of several collapsed sub-panels.
  switchSettingsSub('set-quote', document.querySelector('[onclick*="set-quote"]'));
});
await pg.waitForTimeout(800);
v = await pg.evaluate(() => (document.getElementById('qdQuoteDomain')||{}).value);
check('the Settings field shows the saved domain', v === 'https://quote.floodroofing.co.nz', v);

await pg.fill('#qdQuoteDomain', 'quote.acmeroofing.co.nz');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('qdQuoteDomainMsg').textContent);
check('typing a good domain previews the link the customer will get',
  /Quote links will read https:\/\/quote\.acmeroofing\.co\.nz/.test(v), v);
await pg.fill('#qdQuoteDomain', 'http://nope/path');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('qdQuoteDomainMsg').textContent);
check('…and a bad one says so instead of failing silently', /Not a usable domain/.test(v), v);
await pg.locator('#set-quote').screenshot({ path: S+'/quotedomain.png' });

// it survives a save/reload of settings
await pg.fill('#qdQuoteDomain', 'quote.floodroofing.co.nz');
await pg.evaluate(() => saveSettings(true));
await pg.waitForTimeout(700);
v = await pg.evaluate(() => (S.settings.quote_defaults||{}).quote_domain);
check('saving Settings keeps it, normalised', v === 'https://quote.floodroofing.co.nz', String(v));

await ctx.close();
await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
