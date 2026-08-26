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
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
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

// ── and the figure on the table is the figure on the quote ────────
// "the pricing tab doesnt match the quote numbers/total". S.materials is what
// the table hands to the quote, and it used to apply the mark-up but not the
// buffer — so the green "Total materials → Quote" line at the bottom of the
// table and the quote's own Materials line disagreed by exactly the buffer,
// the moment anybody set one. The table's own number is the contract.
v = await pg.evaluate(() => {
  S.quote.roofMatQtyBuffer = 7; S.quote.roofMaterialMarkup = 5;
  renderMaterialPriceTable();
  const box = document.getElementById('materialPriceTableWrap');
  const t = box ? box.textContent : '';
  // The last $ figure in the table is the green "Total materials → Quote".
  const money = (t.match(/\$[\d,]+\.\d\d/g) || []).map(x => +x.slice(1).replace(/,/g, ''));
  const shown = money.length ? money[money.length - 1] : 0;
  // Same rows, no buffer — the difference proves the buffer is what moved.
  S.quote.roofMatQtyBuffer = 0;
  renderMaterialPriceTable();
  const noBuf = +S.materials;
  S.quote.roofMatQtyBuffer = 7;
  renderMaterialPriceTable();
  return { shown, handedToQuote: +S.materials, noBuf };
});
check('the materials table shows a total worth checking', v.shown > 100, '$' + v.shown);
check('what the table shows is what it hands the quote',
  Math.abs(v.shown - v.handedToQuote) < 0.02,
  '$' + v.shown + ' shown vs $' + v.handedToQuote + ' handed over');
check('…and turning the buffer off actually moves that number, so it is being applied',
  v.handedToQuote > v.noBuf + 0.01,
  '$' + v.handedToQuote + ' at 7% vs $' + v.noBuf + ' at 0%');

// ── each roof carries its own buffer and its own mark-up ──────────
// "if i set it to 3% on the main roof, then 5% on a different roof, is change
// the main roof to 5% aswell". Both percentages were single numbers on the
// quote, so the per-roof pricing tabs were all editing the same one — set a
// roof's buffer and you silently repriced every other roof on the job.
const GEOM = JSON.parse(await readFile(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines: (r.lines || []).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true};
  S.quote.roofExcluded = {};
  delete S.quote.roofMatQtyBuffer; delete S.quote.roofMaterialMarkup;
  delete S.quote.roofMatQtyBufferByRoof; delete S.quote.roofMaterialMarkupByRoof;
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(1500);

v = await pg.evaluate(() => {
  _setPricingRoof(0); _setRoofMatQtyBuffer(3); _setRoofMatMarkup(11);
  _setPricingRoof(2); _setRoofMatQtyBuffer(5); _setRoofMatMarkup(17);
  return {
    main:  (_setPricingRoof(0), { buf: _roofMatQtyBufferPct(), mk: _roofMatMarkupPct() }),
    roof3: (_setPricingRoof(2), { buf: _roofMatQtyBufferPct(), mk: _roofMatMarkupPct() }),
    // Asked for by index, from anywhere — this is what the pricing maths uses.
    byIdx: { m: _roofMatQtyBufferPct(0), r: _roofMatQtyBufferPct(2),
             mMk: _roofMatMarkupPct(0),  rMk: _roofMatMarkupPct(2) },
  };
});
check('setting 5% on another roof leaves the main roof on its own 3%',
  v.main.buf === 3 && v.roof3.buf === 5, JSON.stringify(v));
check('…and the mark-up is per roof the same way',
  v.main.mk === 11 && v.roof3.mk === 17, JSON.stringify(v));
check('…and both read back by roof index, which is what the pricing maths uses',
  v.byIdx.m === 3 && v.byIdx.r === 5 && v.byIdx.mMk === 11 && v.byIdx.rMk === 17,
  JSON.stringify(v.byIdx));

// The money has to follow the percentages, not just the read-back.
v = await pg.evaluate(() => {
  const a = _materialsCostForRoofIdx(2);
  _setPricingRoof(0);                       // stand somewhere else entirely
  const b = _materialsCostForRoofIdx(2);
  _setRoofMatQtyBuffer(40);                 // move the MAIN roof's buffer hard
  const c = _materialsCostForRoofIdx(2);
  _setRoofMatQtyBuffer(3);
  return { a, b, c };
});
check('a roof is costed with its own buffer wherever you happen to be standing',
  Math.abs(v.a - v.b) < 0.02, '$' + v.a + ' vs $' + v.b);
check('…and moving the main roof’s buffer does not move another roof’s cost',
  Math.abs(v.b - v.c) < 0.02, '$' + v.b + ' before vs $' + v.c + ' after +40% on the main');

// ── a new quote starts at 5%, an old one keeps what it was saved with ──
v = await pg.evaluate(() => {
  const fresh = defaultQuote();
  const old = { roofMatQtyBuffer: 0 };            // saved before this shipped
  const older = {};                                // saved before the field existed
  const read = q => { const keep = S.quote; S.quote = q;
    const out = { buf: _roofMatQtyBufferPct(0), mk: _roofMatMarkupPct(0) };
    S.quote = keep; return out; };
  return { fresh: { buf: fresh.roofMatQtyBuffer, mk: fresh.roofMaterialMarkup },
           old: read(old), older: read(older) };
});
check('a new quote starts with a 5% buffer, as asked for',
  v.fresh.buf === 5, 'buffer ' + v.fresh.buf + '%');
check('…and a 5% mark-up alongside it', v.fresh.mk === 5, 'mark-up ' + v.fresh.mk + '%');
check('a quote saved with an explicit 0 keeps its 0 and does not reprice',
  v.old.buf === 0, 'buffer ' + v.old.buf + '%');
check('…and one saved before the field existed stays at 0 too',
  v.older.buf === 0, 'buffer ' + v.older.buf + '%');

// ── the gutter card carries the same split ────────────────────────
v = await pg.evaluate(() => ({
  bufFn: typeof _gutterMatQtyBufferPct === 'function' && typeof _setGutterMatQtyBuffer === 'function',
  mkFn:  typeof _gutterMatMarkupPct === 'function',
}));
check('the gutter card has a quantity-buffer control too', v.bufFn && v.mkFn);

v = await pg.evaluate(() => {
  delete S.quote.gutterMatQtyBuffer; delete S.quote.gutterMaterialMarkup;
  return { buf: _gutterMatQtyBufferPct(), mk: _gutterMatMarkupPct() };
});
check('…its buffer defaults to 0, so no saved quote reprices', v.buf === 0, 'buffer ' + v.buf + '%');
check('…while its mark-up keeps the 10% it always had', v.mk === 10, 'mark-up ' + v.mk + '%');

// _gutterMaterialCharge is what reaches the CUSTOMER through _selGutterDelta,
// so it has to compound in the same order as the card shows.
v = await pg.evaluate(() => {
  const lines = () => [{ desc: 'x', qty: 10, price: 100, lineTotal: 1000 }];
  const real = window._gutterMaterialLines;
  window._gutterMaterialLines = lines;          // fixed $1000 of gutter material
  const out = {};
  S.quote.gutterMatQtyBuffer = 0;  S.quote.gutterMaterialMarkup = 0;  out.plain   = _gutterMaterialCharge('marley_typhoon', 10, 1, 0);
  S.quote.gutterMatQtyBuffer = 10; S.quote.gutterMaterialMarkup = 0;  out.bufOnly = _gutterMaterialCharge('marley_typhoon', 10, 1, 0);
  S.quote.gutterMatQtyBuffer = 10; S.quote.gutterMaterialMarkup = 20; out.both    = _gutterMaterialCharge('marley_typhoon', 10, 1, 0);
  window._gutterMaterialLines = real;
  return out;
});
check('gutter material with both at zero is the raw cost', v.plain === 1000, '$' + v.plain);
check('…a 10% buffer alone adds 10%', Math.abs(v.bufOnly - 1100) < 0.01, '$' + v.bufOnly);
check('…and the mark-up compounds on the buffered cost, same as the roof',
  Math.abs(v.both - 1320) < 0.01, '$' + v.both + ' (not 1300)');

// the old combined label is gone from the whole app, both cards
v = await pg.evaluate(() => document.documentElement.innerHTML.indexOf('Safety buffer / markup'));
check('the old "Safety buffer / markup" wording is gone app-wide', v < 0);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
