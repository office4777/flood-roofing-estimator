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

const ctx = await b.newContext({ viewport:{width:1600,height:1000} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// A drawn, priced job with an optional extra roof to toggle.
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[200,150],[560,150],[560,430],[200,430]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.02; autoGenerateRoof('gable'); DRAW.roofs[0].name = 'Main Roof';
  _addAndSwitchToNewRoof(); setTool('outline');
  DRAW.currentPts = [[660,320],[820,320],[820,470],[660,470]]; finishCurrent(); autoGenerateRoof('gable');
  DRAW.roofs[1].name = 'Garage'; _setRoofMode(1,'separate');
  gotoTab('quote');
});
await pg.waitForTimeout(1800);
await pg.evaluate(() => { try { calcLabour(); } catch(e){} });
await pg.waitForTimeout(1400);

const read = () => pg.evaluate(() => {
  const bar = document.getElementById('officePriceBar');
  const vis = !!bar && getComputedStyle(bar).display !== 'none';
  const t = bar ? (bar.textContent||'').replace(/\s+/g,' ').trim() : '';
  return { vis, t,
    total: bar ? ((bar.querySelector('#custBarTotal')||{}).textContent || null) : null,
    fixedBottom: bar ? (getComputedStyle(bar).position + '@' + getComputedStyle(bar).bottom) : null,
    cls: document.documentElement.classList.contains('office-price-bar'),
    padded: getComputedStyle(document.getElementById('tab-quote')).paddingBottom,
    panelBottom: getComputedStyle(document.getElementById('quotePricingPanel')).bottom };
});
let v = await read();
check('the office gets a price bar on the Quote tab', v.vis, v.t.slice(0,70));
check('…pinned to the bottom of the screen', v.fixedBottom === 'fixed@0px', v.fixedBottom);
check('…showing a real total', !!v.total && /\$/.test(v.total), 'total ' + v.total);
check('…labelled as the customer\'s view', /What the customer sees/.test(v.t));
check('…and the page makes room for it, rather than being covered',
  v.cls && parseFloat(v.padded) > 40 && parseFloat(v.panelBottom) > 40,
  JSON.stringify({pad:v.padded, panel:v.panelBottom}));
await pg.screenshot({ path: S+'/officebar_on.png', clip:{x:0,y:760,width:1600,height:240} });

// it says the same number the customer's own bar would
const same = await pg.evaluate(() => {
  const bar = (document.querySelector('#officePriceBar #custBarTotal')||{}).textContent;
  return { bar: bar, engine: fmtMoney(_custBarTotalValue()) };
});
check('the bar shows exactly the customer-facing total, not a second figure',
  same.bar === same.engine, JSON.stringify(same));

// it tracks a pricing change
const before = same.bar;
await pg.evaluate(() => { _toggleProposalExtraRoof(0, true); });
await pg.waitForTimeout(1200);
v = await read();
check('adding the optional roof moves the bar', v.total && v.total !== before, before + ' → ' + v.total);
check('…and the added roof is itemised on the bar', /Garage/.test(v.t), v.t.slice(0,140));
await pg.screenshot({ path: S+'/officebar_extra.png', clip:{x:0,y:740,width:1600,height:260} });

// a labour edit moves it too
const beforeLab = v.total;
await pg.evaluate(() => { updateScaffold('price', 6000); });
await pg.waitForTimeout(1400);
v = await read();
check('a pricing edit in the slide-out moves the bar', v.total !== beforeLab, beforeLab + ' → ' + v.total);

// full breakdown on click
await pg.evaluate(() => _officeBarToggleBreakdown());
await pg.waitForTimeout(400);
let br = await pg.evaluate(() => {
  const el = document.getElementById('officePriceBreak');
  return { open: !!el && el.style.display !== 'none' && !!el.innerHTML,
           t: el ? (el.textContent||'').replace(/\s+/g,' ') : '' };
});
check('clicking it opens the full breakdown', br.open && /Your selection & price/.test(br.t) && /New total/.test(br.t), br.t.slice(0,90));
await pg.evaluate(() => _officeBarToggleBreakdown());
await pg.waitForTimeout(300);
check('…and clicking again closes it',
  await pg.evaluate(() => { const el = document.getElementById('officePriceBreak'); return el.style.display === 'none'; }));

// it can be got out of the way, and the choice sticks
await pg.evaluate(() => _officeBarToggle());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  t: (document.getElementById('officePriceBar').textContent||'').trim(),
  cls: document.documentElement.classList.contains('office-price-bar'),
  pad: getComputedStyle(document.getElementById('tab-quote')).paddingBottom }));
check('it collapses to a chip that hands the bar back', /Show price bar/.test(v.t) && !v.cls && parseFloat(v.pad) < 40, JSON.stringify(v));
await pg.evaluate(() => _officeBarToggle());
await pg.waitForTimeout(400);
check('…and re-opens', (await read()).vis);

// it belongs to the Quote tab only
await pg.evaluate(() => gotoTab('roof'));
await pg.waitForTimeout(900);
check('it stays off every other tab', !(await read()).vis);
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(1400);
check('…and comes back on the Quote tab', (await read()).vis);

// site mode owns the bottom of the screen
await pg.evaluate(() => { document.documentElement.classList.add('site-mode'); _officePriceBarSync(); });
await pg.waitForTimeout(300);
check('it stands aside for the on-site bottom nav', !(await read()).vis);
await pg.evaluate(() => { document.documentElement.classList.remove('site-mode'); _officePriceBarSync(); });
await ctx.close();

// ── the customer keeps their own bar and gains nothing extra ──
const cctx = await b.newContext({ viewport:{width:430,height:900}, isMobile:true, hasTouch:true });
const cpg = await cctx.newPage();
cpg.on('pageerror', e => console.log('PAGEERROR', e.message));
await cpg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
  /\/q\//.test(r.request().url())
    ? r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ quote:{
        ref:'FR-1', client:'Mrs Hale', gstRate:15, proposalOptions:{},
        options:[{id:'a',title:'Re-roof',selected:true,total:24000}], lineItems:[], total:24000 }, branding:{} })})
    : r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await cpg.goto('file://'+DIR+'/app.html?q=tok&j=FR-1');
await cpg.waitForTimeout(3200);
const cv = await cpg.evaluate(() => ({
  office: !!document.getElementById('officePriceBar'),
  cust: !!document.getElementById('custBar'),
  cls: document.documentElement.classList.contains('office-price-bar') }));
check('the customer never gets the office bar', !cv.office && !cv.cls && cv.cust, JSON.stringify(cv));
await cctx.close();

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
