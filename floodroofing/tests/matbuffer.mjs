// Materials carry two separate percentages, because they are two different
// decisions: a quantity safety buffer (price in a bit extra for offcuts) and a
// mark-up (margin on the cost). They were one control labelled "Safety buffer /
// markup" that only ever did the mark-up.
//
// The buffer moves the PRICE only — the cut list and the supplier order stay at
// the exact calculated quantity. That is deliberate, and it is the thing this
// suite has to keep true, along with the table and the quote never disagreeing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

// ── the two controls exist and are independent ────────────────────
let v = await pg.evaluate(() => ({
  bufFn: typeof _roofMatQtyBufferPct === 'function' && typeof _setRoofMatQtyBuffer === 'function',
  mkFn:  typeof _roofMatMarkupPct === 'function' && typeof _setRoofMatMarkup === 'function',
}));
check('there is a quantity-buffer control as well as a mark-up one', v.bufFn && v.mkFn);

// ── the default must not move an existing quote's price ───────────
v = await pg.evaluate(() => {
  S.quote = S.quote || {};
  delete S.quote.roofMatQtyBuffer; delete S.quote.roofMaterialMarkup;
  return { buf: _roofMatQtyBufferPct(), mk: _roofMatMarkupPct() };
});
check('the buffer defaults to 0, so nothing reprices the day this ships',
  v.buf === 0, 'buffer ' + v.buf + '%');
check('…while the mark-up keeps the 5% it always had', v.mk === 5, 'mark-up ' + v.mk + '%');

// ── the arithmetic: buffer is a cost, mark-up sits on top of it ───
v = await pg.evaluate(() => {
  const rows = [{ key:'k1', autoQty: 10, autoUnit: 'ea', variants: [{ value:'v', unit:'ea', price: 100 }], defaultVariant: 'v' }];
  const out = {};
  S.quote.roofMatQtyBuffer = 0;  S.quote.roofMaterialMarkup = 0;   out.plain  = _materialsTotalFromRows(rows);
  S.quote.roofMatQtyBuffer = 10; S.quote.roofMaterialMarkup = 0;   out.bufOnly = _materialsTotalFromRows(rows);
  S.quote.roofMatQtyBuffer = 0;  S.quote.roofMaterialMarkup = 20;  out.mkOnly  = _materialsTotalFromRows(rows);
  S.quote.roofMatQtyBuffer = 10; S.quote.roofMaterialMarkup = 20;  out.both    = _materialsTotalFromRows(rows);
  return out;
});
check('with both at zero the material total is the raw cost', v.plain === 1000, '$' + v.plain);
check('a 10% buffer alone adds 10%', Math.abs(v.bufOnly - 1100) < 0.01, '$' + v.bufOnly);
check('a 20% mark-up alone adds 20%', Math.abs(v.mkOnly - 1200) < 0.01, '$' + v.mkOnly);
check('together the mark-up sits on the buffered cost, not the raw one',
  Math.abs(v.both - 1320) < 0.01, '$' + v.both + ' (1000 → 1100 → 1320, not 1300)');

// ── the buffer must NOT reach the order or the cut list ───────────
v = await pg.evaluate(() => {
  const before = _matOrderQty(10, 'ea');
  S.quote.roofMatQtyBuffer = 25;
  return { before, after: _matOrderQty(10, 'ea') };
});
check('the quantity that goes to the supplier is untouched by the buffer',
  v.before === v.after && v.after === 10, v.before + ' → ' + v.after);

// ── both rows render on the pricing table, buffer above mark-up ───
// The table draws nothing without a price book AND a measured roof — both are
// its own guards, not bugs. The demo job that ships for new accounts is a real
// worked roof, so use that rather than hand-rolling geometry.
const { readFile } = await import('node:fs/promises');
const demo = JSON.parse(await readFile(_j(DIR, 'demo-job.json'), 'utf8'));
await pg.evaluate((job) => {
  S.settings = S.settings || {};
  S.settings.price_book = { ridge_lm: 26.84, sheets: [{ product: '0.40g Colorsteel Maxam', unit: 'm2', price: 29.5 }] };
  try { restoreFromJob(job); } catch (e) {}
  S.quote = S.quote || {};
  S.quote.roofMatQtyBuffer = 7; S.quote.roofMaterialMarkup = 5;
  try { renderMaterialPriceTable(); } catch(e){}
}, demo);
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  // textContent, not innerText: the pricing tab is not the visible one here and
  // innerText returns nothing for hidden elements — which reads as "the row is
  // missing" when it is right there in the table.
  const box = document.getElementById('materialPriceTableWrap');
  const t = box ? box.textContent : '';
  return { rendered: t.length, buf: t.indexOf('Add quantity safety buffer'),
           mk: t.indexOf('Add mark-up'), gone: t.indexOf('Safety buffer / markup') };
});
check('the materials table actually drew something to inspect', v.rendered > 200, v.rendered + ' chars');
check('the pricing table offers "Add quantity safety buffer"', v.buf >= 0);
check('…and "Add mark-up" below it', v.mk >= 0 && v.mk > v.buf, 'buffer@' + v.buf + ' markup@' + v.mk);
check('…and the old combined "Safety buffer / markup" row is gone', v.gone < 0);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
