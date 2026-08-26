// "It's adding way too many materials to the roof material like gutters."
//
// A supplier price list is dozens of rates. Rows the importer could not place
// on a price-book field went to Custom items at quantity 1 — and every custom
// item was a line on the job. So importing a merchant's catalogue put every
// Aquaseal size, every back-tray and every fitting on the material list of
// every roof, at one each. Around forty phantom lines.
//
// A rate is not a quantity. An imported row now arrives at 0, and an item
// with no quantity is a rate the book holds, not a line on the job.
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
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2400);

// A roof to price, so the material list has something real on it.
await pg.evaluate(() => {
  gotoTab('roof');
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]]; DRAW.outlineDone = true;
  DRAW.lines = [['gutter',[0,0],[2000,0]],['gutter',[2000,1000],[0,1000]],['ridge',[500,500],[1500,500]]]
    .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:null, sheetLengthM:null}));
  DRAW.scaleMetresPerPx = 0.01; DRAW.calPitch = 20;
});
const matRows = () => pg.evaluate(() => {
  const rows = _buildMaterialPriceRows() || [];
  return { total: rows.length,
           extras: rows.filter(r => String(r.key).indexOf('extra:') === 0).map(r => r.label),
           charged: _materialsTotalFromRows(rows) };
});
const before = await matRows();
check('a roof prices from its own drawing', before.total > 0 && before.charged > 0,
  before.total + ' rows, $' + before.charged.toFixed(2));

// A merchant list: two rows the book knows, five it does not.
const CSV = [
  'Description,Unit,Price',
  'Ridge/Hip Flashing 0.55 Colorsteel,lm,21.97',
  'Valley Flashing 0.55,lm,19.70',
  'Aquaseal No 7 EPDM Pipe Flashing (200-300mm OPD),ea,70.07',
  'MC1-5 Classic 5m length,ea,89.18',
  'MC2 Classic bracket,ea,3.05',
  'Fiberglass Hip,ea,145.17',
  'Polythene Anticon Film 100m2,ea,263.84',
].join('\n');
await pg.evaluate(() => gotoTab('settings'));
await pg.waitForTimeout(300);
await pg.setInputFiles('#pbUploadFile', { name:'list.csv', mimeType:'text/csv', buffer: Buffer.from(CSV) });
await pg.waitForTimeout(700);
await pg.evaluate(() => _pbApplyCsv());
await pg.waitForTimeout(400);

let v = await pg.evaluate(() => ({
  extras: (S.settings.price_book.extras || []).map(x => ({ d:x.desc, q:x.qty, p:x.price })),
  ridge: S.settings.price_book.ridge_lm,
}));
check('the rows it recognised still set real rates', v.ridge === 21.97, 'ridge $' + v.ridge);
// Three, not five: "Aquaseal No 7" now has a price-book field of its own,
// and "Fiberglass Hip" matches the ridge/hip pattern — it is offered against
// ridge_lm but left unticked, because it is priced each and that field is
// per metre. A matched row is never quietly turned into a custom item.
check('the rest are kept as rates', v.extras.length === 3, v.extras.length + ' custom item(s)');
check('…every one of them at quantity 0', v.extras.every(x => (+x.q) === 0),
  v.extras.map(x => x.d.slice(0,18) + '=' + x.q).join(', '));
check('…with their prices intact, so the book still knows what they cost',
  v.extras.some(x => x.p === 89.18) && v.extras.some(x => x.p === 263.84),
  v.extras.map(x => '$' + x.p).join(', '));

const after = await matRows();
check('importing a price list adds NOTHING to the job',
  after.extras.length === 0, after.extras.length + ' extra row(s): ' + after.extras.join(', '));
check('…and does not change what the roof costs',
  Math.abs(after.charged - before.charged) < 0.01,
  '$' + before.charged.toFixed(2) + ' -> $' + after.charged.toFixed(2));

// Giving one a quantity is how it joins the job.
await pg.evaluate(() => { S.settings.price_book.extras[0].qty = 2; });
v = await matRows();
check('an item you give a quantity to DOES join the job',
  v.extras.length === 1, v.extras.join(', ') || '(none)');
check('…charged at its own rate, twice',
  Math.abs(v.charged - before.charged) > 1, '$' + v.charged.toFixed(2));

// The one-click fix for a book that already has the bad quantities in it.
await pg.evaluate(() => {
  S.settings.price_book.extras.forEach(x => { x.qty = 1; });
  renderPriceBookUI();
  clearPriceBookExtraQtys();
});
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  qtys: (S.settings.price_book.extras || []).map(x => +x.qty),
  prices: (S.settings.price_book.extras || []).map(x => +x.price),
}));
check('Clear all quantities zeroes them in one go', v.qtys.every(q => q === 0), v.qtys.join(','));
check('…and keeps every rate — it clears quantities, not the book',
  v.prices.every(p => p > 0), v.prices.join(','));
v = await matRows();
check('…so a book full of imported rates prices the roof and nothing else',
  v.extras.length === 0 && Math.abs(v.charged - before.charged) < 0.01,
  '$' + v.charged.toFixed(2));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
