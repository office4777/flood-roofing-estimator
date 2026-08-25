// "Way too much and unnecessary material being added to the material price."
//
// The feedback showed a material table with seven real take-off rows on a
// six-roof job — sheets, underlay, ridging, gutter, barge, screws, rivets —
// followed by about thirty-five rows of one-of-everything: every Aquaseal
// pipe flashing from Mini to No 10, every Corrugate and 5-Rib back-tray size,
// every Marley Classic fitting, each at quantity 1.
//
// A price-book extra that carries a quantity joins EVERY job. The CSV import
// used to give every imported rate a quantity of 1, so importing a merchant's
// price list charged the whole list on every quote — well over a thousand
// dollars of material the job never touches, sitting under the real take-off
// where it is easy to miss on the way to a customer.
//
// The import writes 0 now. This is about the books that were imported before
// that and are still in the old state.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r2 = v => Math.round(v * 100) / 100;

// The tail of the reported table, verbatim in shape: an imported rate list,
// every row at quantity 1.
const IMPORTED = [
  ['Aquaseal Mini EPDM Pipe Flashing (3-25mm OPD)','ea',11.30],
  ['Aquaseal No 1 EPDM Pipe Flashing (3-60mm OPD)','ea',13.36],
  ['Aquaseal No 2 EPDM Pipe Flashing (10-90mm OPD)','ea',16.55],
  ['Aquaseal No 3 EPDM Pipe Flashing (40-110mm OPD)','ea',21.69],
  ['Aquaseal No 4 EPDM Pipe Flashing (75-150mm OPD)','ea',25.64],
  ['Aquaseal No 5 EPDM Pipe Flashing (130-200mm OPD)','ea',37.46],
  ['Aquaseal No 6 EPDM Pipe Flashing (150-250mm OPD)','ea',55.67],
  ['Aquaseal No 7 EPDM Pipe Flashing (200-300mm OPD)','ea',70.07],
  ['Aquaseal No 8 EPDM Pipe Flashing (280-380mm OPD)','ea',105.61],
  ['Aquaseal No 9 EPDM Pipe Flashing (330-450mm OPD)','ea',171.25],
  ['Aquaseal No 10 EPDM Pipe Flashing (400-750mm OPD)','ea',335.36],
  ['270mm Corrugate back-tray','lm',16.80],
  ['340mm Corrugate back-tray','lm',19.32],
  ['570mm Corrugate back-tray','lm',27.60],
  ['725mm Corrugate back-tray','lm',33.18],
  ['800mm Corrugate back-tray','lm',35.88],
  ['250mm 5-Rib back-tray','lm',16.08],
  ['420mm 5-Rib back-tray','lm',22.20],
  ['610mm 5-Rib back-tray','lm',29.04],
  ['800mm 5-Rib back-tray','lm',35.88],
  ['MC1-5 Classic 5m length','ea',89.18],
  ['MC1-3 Classic 3m length','ea',57.81],
  ['MC2 Classic bracket','ea',3.05],
  ['MC5 Classic joiner','ea',3.82],
  ['MC17 Classic expansion joiner','ea',21.92],
  ['MC8-80 Classic 80mm expansion outlet','ea',24.21],
  ['MC6 Classic external angle','ea',19.74],
  ['MC7 Classic internal angle','ea',19.74],
  ['MC3 Classic LH stopend','ea',5.16],
  ['MC4 Classic RH stopend','ea',5.16],
  ['95deg Female/Female Bend 80mm','ea',8.31],
];
const IMPORTED_TOTAL = IMPORTED.reduce((s, x) => s + x[2], 0);

const b = await chromium.launch();
async function open(extras){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript(() => {
    localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1');
    localStorage.setItem('fr_settings','null');
  });
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2600);
  // mergeSettings is what every load path funnels a stored book through —
  // cloud, localStorage or defaults — so running it with the roofer's own
  // book is the honest way to reach the repair.
  await pg.evaluate((ex) => {
    S.settings = mergeSettings({
      price_book: {
        list_prices:false,
        sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:26.84}],
        ridge_lm:21.97, gutter_lm:16.37, barge_lm:17.87,
        screws_each:0.26, rivets_each:0.08,
        extras: ex,
      }
    });
  }, extras);
  // A drawn, calibrated roof so the real take-off has something to say.
  await pg.evaluate(() => {
    DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 20;
    DRAW.outline = [[100,100],[900,100],[900,500],[100,500]]; DRAW.outlineDone = true;
    DRAW.lines = [
      { type:'ridge',  pts:[[100,300],[900,300]], measM:12.7 },
      { type:'gutter', pts:[[100,100],[900,100]], measM:12.7 },
      { type:'gutter', pts:[[100,500],[900,500]], measM:12.7 },
      { type:'barge',  pts:[[100,100],[100,300]], measM:6.4 },
    ];
    DRAW.roofs = null; try { redrawAll(); } catch(e){}
    gotoTab('pricing');
  });
  await pg.waitForTimeout(1600);
  // The pricing pop-out does not necessarily render the material table on tab
  // change; in the app the settings land first and the panel draws after. Draw
  // it here so what is on screen reflects the loaded book.
  await pg.evaluate(() => { try { renderMaterialPriceTable(); } catch(e){} });
  await pg.waitForTimeout(300);
  return { ctx, pg, errs };
}

// ── the reported book: an imported list, every rate at qty 1 ───────
let { ctx, pg, errs } = await open(IMPORTED.map(x => ({ desc:x[0], unit:x[1], qty:1, price:x[2] })));

let v = await pg.evaluate(() => {
  const rows = _buildMaterialPriceRows();
  return {
    repaired: window.__pbExtrasRepaired || 0,
    extras: (S.settings.price_book.extras || []).length,
    withQty: (S.settings.price_book.extras || []).filter(x => (+x.qty || 0) > 0).length,
    customRows: rows.filter(r => r.isCustom).length,
    realRows: rows.filter(r => !r.isCustom).map(r => r.key),
    total: _materialsTotalFromRows(rows),
  };
});
check('an imported rate list at quantity 1 is spotted on load',
  v.repaired === 31, v.repaired + ' repaired');
check('…every one of those rates is still in the price book', v.extras === 31,
  v.extras + ' rates kept');
check('…with none of them carrying a quantity any more', v.withQty === 0,
  v.withQty + ' still charged');
check('…so not one of them lands on the material price', v.customRows === 0,
  v.customRows + ' one-of-everything rows');
check('…while the real take-off is untouched',
  v.realRows.length >= 4 && v.total > 0,
  v.realRows.join(', ') + ' = $' + r2(v.total));

// The number that matters: what the roofer was being over-quoted.
const damage = await pg.evaluate((rates) => {
  const pb = S.settings.price_book;
  const clean = _materialsTotalFromRows(_buildMaterialPriceRows());
  pb.extras.forEach((x, i) => { x.qty = 1; });     // put the book back as it was
  const dirty = _materialsTotalFromRows(_buildMaterialPriceRows());
  pb.extras.forEach(x => { x.qty = 0; });
  return { clean, dirty };
}, IMPORTED);
// The material total carries the book's mark-up, so the difference is the
// rates plus that — never less than the raw list, and not wildly more.
check('…which is what was being added to every quote',
  (damage.dirty - damage.clean) >= IMPORTED_TOTAL - 1 &&
  (damage.dirty - damage.clean) <= IMPORTED_TOTAL * 1.25,
  '$' + r2(damage.dirty - damage.clean) + ' of material the job never touches (rates $' +
  r2(IMPORTED_TOTAL) + ' + mark-up)');

// It has to be told, not done quietly — this changes somebody's prices.
const note = await pg.evaluate(() => {
  const wrap = document.getElementById('materialPriceTableWrap');
  const t = (wrap && wrap.innerText) || '';
  return { shown: /charged on every job/i.test(t),
           saysKept: /still in your price book/i.test(t),
           saysWhere: /Settings/i.test(t) };
});
check('the roofer is told it happened', note.shown, JSON.stringify(note));
check('…that the rates were kept, and where to put a quantity back',
  note.saysKept && note.saysWhere, JSON.stringify(note));
// This table re-renders on every edit. A notice that shows once flashes past
// on the first render and is gone before anyone reads it.
const stays = await pg.evaluate(() => {
  renderMaterialPriceTable(); renderMaterialPriceTable();
  const t = (document.getElementById('materialPriceTableWrap')||{}).innerText || '';
  return /charged on every job/i.test(t);
});
check('…and it survives the re-renders instead of flashing past', stays);
const dismissed = await pg.evaluate(() => {
  const btn = document.querySelector('#materialPriceTableWrap [onclick*="__pbExtrasNoted"]');
  if (!btn) return { noBtn: true };
  btn.click();
  const t = (document.getElementById('materialPriceTableWrap')||{}).innerText || '';
  return { gone: !/charged on every job/i.test(t) };
});
check('…until it is dismissed', dismissed.gone === true, JSON.stringify(dismissed));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();

// ── a short, hand-written "charge this on every job" list is NOT an import ──
// Somebody may genuinely want two tubes of sealant on every quote. The
// signature has to be narrow enough not to wipe that.
({ ctx, pg, errs } = await open([
  { desc:'Sealant', unit:'ea', qty:2, price:14.5 },
  { desc:'Site consumables', unit:'ea', qty:1, price:35 },
  { desc:'Skip bin', unit:'ea', qty:1, price:280 },
]));
v = await pg.evaluate(() => {
  const rows = _buildMaterialPriceRows();
  return { repaired: window.__pbExtrasRepaired || 0,
           withQty: (S.settings.price_book.extras || []).filter(x => (+x.qty||0) > 0).length,
           customRows: rows.filter(r => r.isCustom).map(r => r.label) };
});
check('a short hand-written list is left alone', v.repaired === 0 && v.withQty === 3,
  JSON.stringify(v));
check('…and still charged on the job', v.customRows.length === 3, v.customRows.join(', '));
await ctx.close();

// A long list with VARYING quantities is somebody's own work too — only the
// all-identical-1s signature is an import artefact.
({ ctx, pg, errs } = await open(
  Array.from({length: 12}, (_, i) => ({ desc:'Item '+i, unit:'ea', qty: (i % 3) + 1, price: 10 + i }))));
v = await pg.evaluate(() => ({
  repaired: window.__pbExtrasRepaired || 0,
  withQty: (S.settings.price_book.extras || []).filter(x => (+x.qty||0) > 0).length,
}));
check('a long list with varying quantities is left alone too',
  v.repaired === 0 && v.withQty === 12, JSON.stringify(v));
await ctx.close();

// And a book that was imported correctly (quantities already 0) needs no
// repair and says nothing.
({ ctx, pg, errs } = await open(IMPORTED.map(x => ({ desc:x[0], unit:x[1], qty:0, price:x[2] }))));
v = await pg.evaluate(() => {
  const wrap = document.getElementById('materialPriceTableWrap');
  return { repaired: window.__pbExtrasRepaired || 0,
           customRows: _buildMaterialPriceRows().filter(r => r.isCustom).length,
           note: /charged on every job/i.test((wrap && wrap.innerText) || '') };
});
check('a book already imported at quantity 0 needs no repair and no notice',
  v.repaired === 0 && v.customRows === 0 && !v.note, JSON.stringify(v));
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
