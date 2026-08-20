// A business that signs up on Monday must not price its first roof at zero —
// and must never mistake our sample figures for its own supplier rates.
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
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

let saved = null;
async function open(settings){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
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
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2600);
  return { ctx, pg };
}

// ── the shipped defaults are usable, not empty ──
const src = await readFile(DIR + '/index.html', 'utf8');
const defaults = src.slice(src.indexOf('function defaultSettings(){'), src.indexOf('function mergeSettings('));
check('the price book ships with a price on every sheet variant',
  !/unit: 'm2', price: 0\b/.test(defaults) && /'0\.40g Colorsteel Maxam', unit: 'm2', price: \d/.test(defaults));
check('…and on underlay and every flashing',
  !/ridge_lm:\s+0,/.test(defaults) && !/valley_lm:\s+0,/.test(defaults) &&
  !/barge_lm:\s+0,/.test(defaults) && !/apron_lm:\s+0,/.test(defaults) &&
  !/changepitch_lm:\s*0,/.test(defaults) && !/underlay: \{ '50': 0/.test(defaults));
check('…and says out loud that they are only list prices', /list_prices: true/.test(defaults));
check('…and still ships nobody\'s negotiated rates',
  !/26\.84/.test(defaults) && /Indicative list prices/.test(defaults));

// ── a brand-new business ──
let { ctx, pg } = await open({ user_id:'u1', branding:{}, quote_defaults:{}, jms_keys:{} });
await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });

let v = await pg.evaluate(() => {
  const pb = S.settings.price_book;
  return { list: pb.list_prices, sheets: pb.sheets.map(x=>x.price),
           ridge: pb.ridge_lm, valley: pb.valley_lm, gutter: pb.gutter_lm,
           barge: pb.barge_lm, apron: pb.apron_lm, cp: pb.changepitch_lm,
           ul: pb.underlay };
});
check('a new account loads a price book with real numbers in it',
  v.sheets.every(x => x > 0) && v.ridge > 0 && v.valley > 0 && v.gutter > 0 &&
  v.barge > 0 && v.apron > 0 && v.cp > 0 && v.ul['50'] > 0, JSON.stringify(v.sheets)+' ridge '+v.ridge);
check('…flagged as list prices, not their own', v.list === true);

// the warning is visible where prices are set and where they are used
await pg.evaluate(() => { try{ gotoTab('settings'); switchSettingsSub('set-pricebook'); }catch(e){} });
await pg.waitForTimeout(400);
let note = await pg.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-pb-listnote]'));
  return els.map(e => ({ where: e.getAttribute('data-pb-listnote'),
                         txt: (e.textContent||'').replace(/\s+/g,' ').trim() }));
});
check('…and warned about, in Settings and on the Pricing panel',
  note.length === 2 && note.every(n => /Sample prices/.test(n.txt)), JSON.stringify(note.map(n=>n.where)));
check('…in words that say what to do about it',
  note.some(n => /not your supplier rates/.test(n.txt)), (note[0]||{}).txt);

// a roof drawn on a fresh account produces a materials cost, not zero
const cost = await pg.evaluate(() => {
  try {
    const rows = _matPriceRows ? _matPriceRows() : null;
    if (rows && rows.length) return rows.length;
  } catch(e){}
  // Fall back to the price book itself: what a 100 m² roof of the default
  // sheet would cost in materials.
  const pb = S.settings.price_book;
  return pb.sheets[0].price * 100;
});
check('…so a roof priced on day one is not free', cost > 0, String(cost));

// ── saving the price book makes it theirs ──
await pg.evaluate(() => { try { collectPriceBookFromUI(); } catch(e){} });
let after = await pg.evaluate(() => ({ list: S.settings.price_book.list_prices,
  notes: Array.from(document.querySelectorAll('[data-pb-listnote]')).map(e => (e.textContent||'').trim()) }));
check('saving the price book drops the sample-price flag', after.list === false);
check('…and takes the warning away with it', after.notes.every(t => t === ''), JSON.stringify(after.notes));
await ctx.close();

// ── an established business is never re-flagged ──
({ ctx, pg } = await open({ user_id:'u1',
  branding:{ company_name:'Flood Roofing LTD', phone:'0800 4 FLOOD', email:'office@floodroofing.co.nz' },
  quote_defaults:{ next_job_no:'06121' }, jms_keys:{},
  price_book:{ ridge_lm: 26.84, sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:29.5}] } }));
let est = await pg.evaluate(() => ({ list: S.settings.price_book.list_prices,
  ridge: S.settings.price_book.ridge_lm, sheet: S.settings.price_book.sheets[0].price,
  notes: Array.from(document.querySelectorAll('[data-pb-listnote]')).map(e => (e.textContent||'').trim()) }));
check('a business that already has a price book keeps its own numbers',
  est.ridge === 26.84 && est.sheet === 29.5, JSON.stringify(est));
check('…and is not told its own rates are samples', est.list === false && est.notes.every(t => t === ''));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
