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

// ── OFFICE: three real drawn roofs, two of them optional extras ───
const ctx = await b.newContext({ viewport:{width:1600,height:1050} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', async d => { await d.accept('Carport'); });
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[200,150],[560,150],[560,430],[200,430]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.02; autoGenerateRoof('gable');
  DRAW.roofs[0].name = 'Main Roof';
  _addAndSwitchToNewRoof(); setTool('outline');
  DRAW.currentPts = [[80,150],[170,150],[170,320],[80,320]]; finishCurrent(); autoGenerateRoof('gable');
  DRAW.roofs[1].name = 'Veranda';
  _addAndSwitchToNewRoof(); setTool('outline');
  DRAW.currentPts = [[660,320],[820,320],[820,470],[660,470]]; finishCurrent(); autoGenerateRoof('gable');
  DRAW.roofs[2].name = 'Garage';
  _setRoofMode(1,'separate'); _setRoofMode(2,'separate');
  gotoTab('quote');
});
await pg.waitForTimeout(1600);
await pg.evaluate(() => { try { calcLabour(); } catch(e){} try { refreshQuoteProposal(); } catch(e){} });
await pg.waitForTimeout(1200);

// ── PRICING TAB switch bar ────────────────────────────────────────
await pg.evaluate(() => { try { _openPricingPanel && _openPricingPanel(); } catch(e){} _renderPricingRoofSwitchBar(); });
await pg.waitForTimeout(500);
let v = await pg.evaluate(() => {
  const bar = document.getElementById('pricingRoofSwitchBar');
  return Array.from(bar.querySelectorAll('.pr-roof-cell')).map(c => ({
    roof: (c.querySelector('.pr-roof-nm')||{}).textContent,
    rename: (c.querySelector('button.no-print')||{}).textContent || null,
    // the rename must sit BELOW the switch button, not inside it
    inside: !!c.querySelector('.pr-roof-btn button'),
    below: !!(c.querySelector('.pr-roof-btn') && c.querySelector('button.no-print') &&
              c.querySelector('.pr-roof-btn').compareDocumentPosition(c.querySelector('button.no-print')) & Node.DOCUMENT_POSITION_FOLLOWING),
  }));
});
check('every roof button on the Pricing tab has a Rename', v.length === 3 && v.every(x => x.rename === '✎ Rename'), JSON.stringify(v));
check('…sitting under the button, not nested inside it', v.every(x => x.below && !x.inside), JSON.stringify(v.map(x=>({b:x.below,i:x.inside}))));
check('…one per roof, in roof order', v.map(x=>x.roof).join(',') === 'Main Roof,Veranda,Garage', v.map(x=>x.roof).join(','));
await pg.locator('#pricingRoofSwitchBar').screenshot({ path: S+'/rename_pricing.png' });

// it actually renames the right roof
await pg.evaluate(() => document.querySelectorAll('#pricingRoofSwitchBar button.no-print')[2].click());
await pg.waitForTimeout(700);
check('tapping the third one renames the third roof',
  await pg.evaluate(() => DRAW.roofs[2].name === 'Carport' && DRAW.roofs[0].name === 'Main Roof'),
  await pg.evaluate(() => DRAW.roofs.map(r=>r.name).join(',')));
await pg.evaluate(() => { DRAW.roofs[2].name = 'Garage'; refreshQuoteProposal(); _renderPricingRoofSwitchBar(); });
await pg.waitForTimeout(900);

// ── QUOTE PAGE 2 include buttons ──────────────────────────────────
v = await pg.evaluate(() => {
  const box = document.querySelector('#qpRoot .qp-incl-btns');
  if (!box) return null;
  return Array.from(box.children).map(cell => ({
    label: (cell.querySelector('button:not(.no-print)')||{}).textContent,
    rename: (cell.querySelector('button.no-print')||{}).textContent || null,
    below: !!(cell.querySelector('button:not(.no-print)') && cell.querySelector('button.no-print') &&
      cell.querySelector('button:not(.no-print)').compareDocumentPosition(cell.querySelector('button.no-print')) & Node.DOCUMENT_POSITION_FOLLOWING),
  }));
});
check('every roof button on page 2 has a Rename under it',
  v && v.length === 3 && v.every(x => x.rename === '✎ Rename' && x.below), JSON.stringify(v));
check('…the include buttons still read as before',
  v.map(x=>x.label).join(' | ') === 'Main roof only | + Include Veranda | + Include Garage', v.map(x=>x.label).join(' | '));

// the Include-Garage rename must target the GARAGE, not roof 1
await pg.evaluate(() => {
  const cells = document.querySelectorAll('#qpRoot .qp-incl-btns > div');
  cells[cells.length-1].querySelector('button.no-print').click();
});
await pg.waitForTimeout(700);
check('the rename under "Include Garage" renames the Garage, not another roof',
  await pg.evaluate(() => DRAW.roofs[2].name === 'Carport' && DRAW.roofs[1].name === 'Veranda'),
  await pg.evaluate(() => DRAW.roofs.map(r=>r.name).join(',')));
await pg.evaluate(() => { DRAW.roofs[2].name = 'Garage'; refreshQuoteProposal(); });
await pg.waitForTimeout(900);
await pg.locator('#qpRoot .qp-roofmap').first().screenshot({ path: S+'/rename_page2.png' });

// the old duplicate pencils are gone from the mode rows, but a roof with no
// button of its own keeps one
v = await pg.evaluate(() => {
  const t = (document.getElementById('qpRoot').textContent||'').replace(/\s+/g,' ');
  return { renames: (document.querySelectorAll('#qpRoot button[onclick^="_renameRoof"]')).length,
           heading: /How each roof is quoted/.test(t), old: /Name each roof/.test(t) };
});
check('no duplicate rename buttons left on the mode rows', v.renames === 0 && v.heading && !v.old, JSON.stringify(v));

await pg.evaluate(() => { _setRoofMode(2,'folded'); refreshQuoteProposal(); });
await pg.waitForTimeout(1000);
v = await pg.evaluate(() => ({
  modeRow: document.querySelectorAll('#qpRoot button[onclick^="_renameRoof"]').length,
  // Scope to the FIRST block — the proposal renders the same include buttons
  // again on the Accept page, and counting both double-counts every cell.
  cells: document.querySelector('#qpRoot .qp-incl-btns').children.length }));
check('a roof folded into the main price keeps a pencil on its row, so it can still be renamed',
  v.modeRow === 1 && v.cells === 2, JSON.stringify(v));
await pg.evaluate(() => { _setRoofMode(2,'separate'); refreshQuoteProposal(); });
await pg.waitForTimeout(900);
await ctx.close();

// ── CUSTOMER: never sees any of it ────────────────────────────────
const geom = { bbox:{minX:-40,minY:0,maxX:150,maxY:100}, roofs:[
  { name:'Main Roof', area:109.3, mode:'main',  idx:0, lines:[], gutters:[], pts:[[0,0],[100,0],[100,80],[0,80]] },
  { name:'Veranda',   area:7.9,   mode:'extra', idx:1, extraPos:0, lines:[], gutters:[], pts:[[-40,0],[-5,0],[-5,40],[-40,40]] },
  { name:'Garage',    area:11.3,  mode:'extra', idx:2, extraPos:1, lines:[], gutters:[], pts:[[110,60],[150,60],[150,100],[110,100]] } ]};
const cctx = await b.newContext({ viewport:{width:1200,height:900} });
const cpg = await cctx.newPage();
cpg.on('pageerror', e => console.log('PAGEERROR', e.message));
await cpg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
  /\/q\//.test(r.request().url())
    ? r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ quote:{
        ref:'FR-1', client:'Mrs Hale', gstRate:15, roofMapGeom:geom,
        extraRoofs:[{name:'Veranda',price:2400},{name:'Garage',price:3900}],
        proposalOptions:{extraRoofsSel:{}}, options:[], lineItems:[], total:0 }, branding:{} })})
    : r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await cpg.goto('file://'+DIR+'/index.html?q=tok&j=FR-1');
await cpg.waitForTimeout(3200);
const cv = await cpg.evaluate(() => ({
  renames: document.querySelectorAll('button[onclick*="_renameRoof"]').length,
  txt: /Rename/.test(document.getElementById('qpRoot').textContent||''),
  buttons: document.querySelectorAll('#qpRoot .qp-incl-btns > div').length,
  labels: Array.from(document.querySelectorAll('#qpRoot .qp-incl-btns button')).map(x=>x.textContent),
}));
check('the customer is never offered a Rename', cv.renames === 0 && !cv.txt, JSON.stringify(cv));
check('…and their Include buttons are untouched',
  cv.buttons === 3 && cv.labels.join(' | ') === 'Main roof only | + Include Veranda | + Include Garage', JSON.stringify(cv.labels));
await cpg.screenshot({ path: S+'/rename_customer.png' });
await cctx.close();

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
