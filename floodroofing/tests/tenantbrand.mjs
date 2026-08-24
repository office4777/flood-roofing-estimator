// A second roofing company must never see, send or be billed under the first
// one's identity. This is the audit for that.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

let saved = null;
async function open(settings, opts){
  const ctx = await b.newContext(Object.assign({ viewport:{width:1400,height:950} }, opts||{}));
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request(), u = q.url(), m = q.method();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/settings/.test(u) && m === 'PUT'){ saved = q.postDataJSON(); return j(saved); }
    if (/\/settings/.test(u)) return j(settings);
    return j([]);
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2600);
  return { ctx, pg };
}

// ── the shipped defaults carry nobody's identity ──
const src = await readFile(DIR + '/index.html', 'utf8');
const defaults = src.slice(src.indexOf('function defaultSettings(){'), src.indexOf('function mergeSettings('));
// Suppliers belong to a business too. Three real Whangarei merchant reps —
// names and direct emails — used to ship to every account with one set as the
// pre-selected default, so a stranger's mis-click could send a real-looking
// order to somebody who had never heard of them.
for (const leak of ['Flood Roofing LTD', '0800 4 FLOOD', 'office@floodroofing.co.nz', '120 543 997', 'Aron Flood',
                    'steveg@roof.co.nz', 'whangarei@freemanroofing.co.nz', 'phyllis@armorsteel.co.nz'])
  check('the defaults no longer ship "' + leak + '"', defaults.indexOf(leak) < 0);
check('the defaults never say "Flood" at all', !/Flood/.test(defaults));
// The supplier list is monkey-patched onto defaultSettings further down the
// file, so it is checked against the whole source rather than the slice.
check('…and no supplier is shipped pre-loaded, let alone pre-selected',
  /var DEFAULT_SUPPLIERS = \[\]/.test(src),
  (src.match(/var DEFAULT_SUPPLIERS = \[[^\]]{0,40}/)||[''])[0]);

// The book DOES now ship real trade rates, deliberately — a quote built on
// invented round numbers is obviously invented, and the roofer stops trusting
// the total instead of the price book. What the numbers must never do is say
// WHOSE they are: no name, no company, no attribution anywhere near them. The
// leak list above is the guard for that; the rate values themselves are fine.
check('…and they stay labelled as somebody else\'s rates until the roofer loads their own',
  /list_prices: true/.test(defaults));
check('…with a disclaimer that names nobody',
  /PB_DISCLAIMER/.test(src) && !/PB_DISCLAIMER[\s\S]{0,2000}?Flood/.test(src));

// ── a brand-new business is asked to set itself up ──
let { ctx, pg } = await open({ user_id:'u1', branding:{}, quote_defaults:{}, jms_keys:{} });
let v = await pg.evaluate(() => {
  const w = document.getElementById('setupWizard');
  return { shown: !!w, txt: w ? (w.textContent||'').replace(/\s+/g,' ') : '',
           company: (document.getElementById('swCompany')||{}).value,
           email: (document.getElementById('swEmail')||{}).value };
});
check('a new business is asked to set itself up before it can send anything', v.shown, v.txt.slice(0,70));
check('…prefilled with what we already know about them',
  v.company === 'Acme Roofing Ltd' && v.email === 'sam@acmeroofing.co.nz', JSON.stringify(v));
check('…and told their prices are theirs to enter', /Price book/.test(v.txt) && /swap them for your rates/.test(v.txt), v.txt.slice(-160));
await pg.locator('#setupWizard > div').screenshot({ path: S+'/setup_wizard.png' });

// it insists on the things a quote cannot go out without
await pg.fill('#swCompany',''); await pg.click('#swSaveBtn'); await pg.waitForTimeout(200);
check('it will not proceed without a business name',
  /business name/.test(await pg.evaluate(() => document.getElementById('swMsg').textContent)) && saved === null);
await pg.fill('#swCompany','Acme Roofing Ltd'); await pg.fill('#swPhone',''); await pg.fill('#swEmail','');
await pg.click('#swSaveBtn'); await pg.waitForTimeout(200);
check('…nor without a way for a customer to reach them',
  /phone number or an email/.test(await pg.evaluate(() => document.getElementById('swMsg').textContent)) && saved === null);

// saving writes THEIR details, and their own inbox for the app's own emails
await pg.fill('#swPhone','09 123 4567'); await pg.fill('#swEmail','office@acmeroofing.co.nz');
await pg.fill('#swTagline','Bay of Islands roofing'); await pg.fill('#swGst','999 888 777');
await pg.fill('#swJobNo','00001');
await pg.click('#swSaveBtn'); await pg.waitForTimeout(900);
check('saving stores THEIR business, not the one that built the app',
  saved && saved.branding.company_name === 'Acme Roofing Ltd' && saved.branding.gst_number === '999 888 777',
  JSON.stringify(saved && saved.branding && { n:saved.branding.company_name, g:saved.branding.gst_number }));
check('…and points the app\'s own emails at THEIR inbox',
  saved.quote_defaults.email.accept_to === 'office@acmeroofing.co.nz' &&
  saved.quote_defaults.email.order_cc === 'office@acmeroofing.co.nz',
  JSON.stringify(saved.quote_defaults.email));
check('…then gets out of the way', !(await pg.evaluate(() => !!document.getElementById('setupWizard'))));
await ctx.close();

// ── an established business is left alone ──
saved = null;
({ ctx, pg } = await open({ user_id:'u1', branding:{ company_name:'Flood Roofing LTD', phone:'0800 4 FLOOD' }, quote_defaults:{}, jms_keys:{} }));
check('a business that is already set up is not nagged',
  !(await pg.evaluate(() => !!document.getElementById('setupWizard'))));
// Branding moved out of the masthead deliberately: the top of the sidebar
// used to be replaced by the tenant's logo, so once a roofer branded their
// account the product's own name vanished from the app. Theirs sits below,
// labelled; RoofMap keeps the top.
check('…and keeps its own branding on screen',
  /Flood Roofing/.test(await pg.evaluate(() => (document.getElementById('hdrCompany')||{}).textContent || '')),
  await pg.evaluate(() => (document.getElementById('hdrCompany')||{}).textContent || ''));
check('…without taking the RoofMap masthead with it',
  await pg.evaluate(() => {
    const l = document.querySelector('.hdr-logo');
    return !!l && /RoofMap/.test(l.textContent || '') && !/Flood/.test(l.textContent || '');
  }),
  await pg.evaluate(() => (document.querySelector('.hdr-logo')||{}).textContent || ''));
await ctx.close();

// ── the customer-facing failure page names the right company ──
const cctx = await b.newContext({ viewport:{width:900,height:800} });
const cpg = await cctx.newPage();
cpg.on('pageerror', e => console.log('PAGEERROR', e.message));
await cpg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
  r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Quote not found'})}));
await cpg.addInitScript(() => { localStorage.setItem('fr_settings', JSON.stringify({
  branding:{ company_name:'Acme Roofing Ltd', phone:'09 123 4567', email:'office@acmeroofing.co.nz' } })); });
await cpg.goto('file://'+DIR+'/index.html?q=deadtoken');
await cpg.waitForTimeout(4000);
const ct = await cpg.evaluate(() => (document.body.textContent||'').replace(/\s+/g,' '));
// A dead link is precisely the case where we DON'T know whose quote it was —
// the fetch that would have told us is the one that failed. So the bar is: name
// nobody rather than name the wrong roofing company, and still give the reader
// something to do.
check('a dead link never shows another company\'s name or number',
  !/Flood Roofing/.test(ct) && !/0800 4 FLOOD/.test(ct) && !/floodroofing\.co\.nz/.test(ct), ct.slice(0,150));
check('…and still tells the reader how to get a fresh one',
  /reply to the email/i.test(ct), ct.slice(-120));
// When the branding IS known, it is used.
const branded = await cpg.evaluate(() => {
  const b = { company_name:'Acme Roofing Ltd', phone:'09 123 4567', email:'office@acmeroofing.co.nz' };
  window.S = window.S || {}; S.settings = { branding: b };
  const t = (b.phone || b.email)
    ? 'Still stuck? get in touch' + (b.phone ? ' ' + b.phone : '') + (b.email ? ' ' + b.email : '')
    : '';
  return { co: b.company_name, contact: t };
});
check('…while a quote that DID load names its own company on failure',
  /Acme Roofing/.test(branded.co) && /09 123 4567/.test(branded.contact), JSON.stringify(branded));
await cpg.screenshot({ path: S+'/tenant_deadlink.png' });
await cctx.close();

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
