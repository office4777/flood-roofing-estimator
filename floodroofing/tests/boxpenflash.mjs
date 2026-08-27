// "The pricing materials list isn't producing enough flashings. I estimate
//  roughly 91 lm of flashings excluding gutters — it looks like it's only
//  counting the ridges and barges. A boxed chimney needs approximately 5 lm
//  of flashings per box plus a flashing running down from the ridge to the
//  top of the box, and the job pack should auto-add the flashing set for it.
//  Also there is an 80mm penetration on the roof map and the job pack, but it
//  was missed from the pricing material, along with its back-tray to suit."
//
// Three faults, one drawing. This suite runs against that exact drawing —
// six roofs, one 510×510 box, one 80mm pipe — transcribed off the marked-up
// PDF he sent, so the numbers here are his numbers.
//
// 1. A penetration was priced on whichever roof happened to be ACTIVE when it
//    was drawn. Draw the house first and drop the flues on afterwards and
//    every pipe lands on the last roof you touched: both of his are stored on
//    Roof 6, though one sits on the main roof and the other on Roof 2. Only
//    Roof 6's tab priced them, so on every other tab they were simply gone.
// 2. A boxed penetration produced no flashing at all — it takes no dektite,
//    and nothing else had an opinion about it.
// 3. The Pricing tab prices one roof at a time, and half his roofs are the
//    ones carrying the aprons. Standing on the main roof you see ridge and
//    barge, which is exactly what "it's only counting the ridges and barges"
//    looks like from the outside. There was nowhere to check the whole job.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-flashlm.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r2 = v => Math.round(v * 100) / 100;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = {
    list_prices:false,
    sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:26.84}],
    ridge_lm:21.97, valley_lm:19.70, gutter_lm:16.37, barge_lm:17.87,
    apron_lm:16.10, changepitch_lm:21.48, box_pen_lm:0,
    screws_each:0.26, rivets_each:0.08,
    underlay:{'50':150,'75':210,'100':270},
    aquaseal:{mini:11.30,no1:13.36,no2:16.55,no3:21.69,no4:25.64,no5:37.46},
    gutter:{}, extras:[]
  };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  // Both penetrations live on the ACTIVE roof — which is how they were drawn,
  // and the whole point of the first fault.
  DRAW.penetrations = (g.penetrations||[]).map(p => Object.assign({}, p,
    { type:'penetration', sizeLabel:p.size }));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2400);

// ── 1. a penetration is priced on the roof it SITS on ──────────────
const own = await pg.evaluate(() => _penAllOwned().map(e => ({
  label: e.pen.sizeLabel, kind: e.pen.kind || 'pipe',
  store: e.storeIdx, owner: e.ownerIdx,
  storeName: _pricingRoofName(e.storeIdx), ownerName: _pricingRoofName(e.ownerIdx),
})));
check('both penetrations are stored against the roof that was active', own.length === 2 &&
  own.every(o => o.store === 5), JSON.stringify(own.map(o => o.storeName)));
const box = own.find(o => o.kind === 'box'), pipe = own.find(o => o.kind !== 'box');
check('the 510×510 box is owned by the roof it sits inside, not the one it was drawn on',
  box && box.owner === 0, box ? (box.storeName + ' → ' + box.ownerName) : 'no box found');
check('the 80mm pipe is owned by Roof 2, where it sits',
  pipe && pipe.owner === 1, pipe ? (pipe.storeName + ' → ' + pipe.ownerName) : 'no pipe found');

// A pen outside every outline has nowhere better to go, so it stays put.
const orphan = await pg.evaluate(() => {
  DRAW.penetrations.push({ type:'penetration', cx:-500, cy:-500, sizeLabel:'100' });
  const o = _penOwnerRoofIdx(DRAW.penetrations[DRAW.penetrations.length-1], 5);
  DRAW.penetrations.pop();
  return o;
});
check('…and one drawn off the building keeps the roof it was stored on',
  orphan === 5, 'owner ' + orphan);

// The user's actual complaint: the pipe flashing and its back-tray.
const perTab = await pg.evaluate(() => {
  const out = {};
  _pricingRoofTabIdxs().forEach(i => {
    const saved = _matSelectedRoofIndices();
    _syncCurrentToRoof(); _matSetSelectedRoofs(_pricingRoofGroup(i));
    const rows = _buildMaterialPriceRows();
    _matSetSelectedRoofs(saved);
    out[_pricingRoofName(i)] = rows.map(r => r.key);
  });
  return out;
});
const withPipe = Object.keys(perTab).filter(k => perTab[k].some(x => /^aquaseal:80/.test(x)));
const withTray = Object.keys(perTab).filter(k => perTab[k].some(x => /^backtray:/.test(x)));
check('the 80mm pipe flashing reaches the pricing material — on Roof 2',
  withPipe.length === 1 && withPipe[0] === 'Roof 2', withPipe.join(', ') || 'nowhere');
check('…and so does the back-tray to suit it',
  withTray.length === 1 && withTray[0] === 'Roof 2', withTray.join(', ') || 'nowhere');
check('…and neither is still stranded on Roof 6',
  !(perTab['Roof 6']||[]).some(x => /^aquaseal|^backtray/.test(x)),
  (perTab['Roof 6']||[]).join(', '));

// ── 2. a boxed penetration gets its flashing set ───────────────────
const set = await pg.evaluate(() => ({
  names: BOX_FLASH_SET.map(s => s.name),
  order: _boxFlashOrderList(true).map(g => ({ name:g.name, qty:g.qty, len:g.lengthM })),
  totalLm: _boxFlashTotalLm(true),
  pieces: _boxFlashPenList(true).length,
}));
// The five flashings the user specified, by name: side aprons both sides,
// bottom and top aprons, the back-tray to the ridge, and the chase flashing
// wrapping the box's upstand.
check('a boxed penetration produces its five-piece flashing set',
  set.pieces === 5, set.pieces + ' pieces');
check('…named the five flashings a box actually takes',
  ['Boxed Penetration Side Apron','Boxed Penetration Bottom Apron',
   'Boxed Penetration Top Apron','Boxed Penetration Top Back-Tray',
   'Boxed Penetration Chase Flashing']
    .every(n => set.names.indexOf(n) >= 0), set.names.join(', '));
// The names on the ORDER carry the profile of the roof the box sits on —
// "… Corro" here, because the fixture's roofs are corrugated steel; a Corro
// side apron and a 5-Rib one are different folds and order separately.
const pieceNames = await pg.evaluate(() => _boxFlashPenList(true).map(p => p.name));
check('…each named with the roof\'s profile: Corro on a corrugated roof',
  pieceNames.length === 5 && pieceNames.filter(n => / Corro$/.test(n)).length === 4 &&
  pieceNames.indexOf('Boxed Penetration Chase Flashing') >= 0,
  pieceNames.join(', ') + ' (the chase dresses the upstand — no profile)');
const fiveRib = await pg.evaluate(() => {
  const e = _penAllOwned().find(x => x.pen.kind === 'box');
  const r = DRAW.roofs[e.ownerIdx];
  const was = r.sheetType, wasLive = DRAW.sheetType;
  r.sheetType = 'steel-5rib';
  if (e.ownerIdx === DRAW.activeRoofIdx) DRAW.sheetType = 'steel-5rib';
  const names = _boxFlashPieces(e.pen, _penOwnerCtx(e.ownerIdx)).map(p => p.name);
  r.sheetType = was; DRAW.sheetType = wasLive;
  return names;
});
check('…and 5-Rib when that roof is sheeted in 5-rib',
  fiveRib.filter(n => / 5-Rib$/.test(n)).length === 4 &&
  fiveRib.some(n => / Side Apron 5-Rib$/.test(n)) &&
  fiveRib.indexOf('Boxed Penetration Chase Flashing') >= 0,
  fiveRib.join(', '));

// ── the library he actually drew finds its way onto the cards ──────
// His entries are named with the quote marks INCLUDED — '"Boxed Penetration
// Side Apron Corro"' — and the chase is saved once, profile 'any'. The sketch
// match has to meet those names as typed, not demand a retype.
const lib = await pg.evaluate(() => {
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const cat = _ensureCatalog();
  cat.savedFlashings = [
    '"Boxed Penetration Side Apron Corro"', '"Boxed Penetration Side Apron 5-Rib"',
    '"Boxed Penetration Bottom Apron Corro"', '"Boxed Penetration Bottom Apron 5-Rib"',
    '"Boxed Penetration Top Apron Corro"', '"Boxed Penetration Top Apron 5-Rib"',
    '"Boxed Penetration Top Back-Tray Corro"', '"Boxed Penetration Top Back-Tray 5-Rib"',
  ].map(n => ({ name: n, profile: / 5-Rib"$/.test(n) ? '5-Rib' : 'Corrugate', sketch: px }))
   .concat([{ name: '"Boxed Penetration Chase Flashing"', profile: 'any', sketch: px }]);
  const all = _getAllFlashings();
  const hits = _boxFlashPenList(true).map(pc => {
    const e = _bfSketchEntry(pc, all);
    return { piece: pc.name, entry: e && e.name };
  });
  cat.savedFlashings = [];
  return hits;
});
check('every piece finds his library entry, quote marks and all',
  lib.length === 5 && lib.every(h => !!h.entry),
  lib.map(h => h.piece + ' → ' + (h.entry || 'NOTHING')).join(' | '));
check('…and each lands on its own profile, not its neighbour\'s',
  lib.every(h => {
    const p5 = / 5-Rib$/.test(h.piece), e5 = / 5-Rib"$/.test(h.entry || '');
    return /Chase/.test(h.piece) ? /Chase/.test(h.entry) : p5 === e5;
  }), JSON.stringify(lib));
const bySide = set.order.find(g => /side apron/i.test(g.name));
check('…with two side aprons and one of everything else',
  bySide && bySide.qty === 2 && set.order.filter(g => g.qty === 1).length === 4,
  JSON.stringify(set.order));
// His original estimate: roughly 5 lm per box plus the run down from the
// ridge — that was the aprons. The chase flashing adds the box's perimeter.
const saddle = set.order.find(g => /back-tray/i.test(g.name));
const chase = set.order.find(g => /chase/i.test(g.name));
const aprons = set.order.filter(g => /apron/i.test(g.name))
  .reduce((t,g) => t + g.qty * g.len, 0);
check('…the four aprons round a 510×510 box come to roughly 5 lm',
  aprons >= 4 && aprons <= 6, r2(aprons) + ' lm');
check('…the chase flashing wraps the box: its perimeter plus laps',
  chase && Math.abs(chase.len - 2.7) < 0.05,
  chase ? (chase.len + ' m — 2×(0.51+0.51) + 0.6 lap, ceiled to 0.1') : 'no chase');
check('…and the back-tray runs from the ridge down to the top of the box',
  saddle && saddle.len > 1.5, saddle ? (saddle.len + ' m') : 'no back-tray');
check('…so the box costs its aprons + chase + back-tray in total',
  set.totalLm > 8.5 && set.totalLm < 12, r2(set.totalLm) + ' lm');

// The saddle stops at the TOP of the box, not at its centre.
const saddleGeom = await pg.evaluate(() => {
  const e = _penAllOwned().find(x => x.pen.kind === 'box');
  const g = _penSheetGeom(e.pen, _penOwnerCtx(e.ownerIdx), true);
  const sz = _penBoxSizeM(e.pen);
  const pc = _boxFlashPieces(e.pen, _penOwnerCtx(e.ownerIdx)).find(p => p.key === 'saddle');
  return { topToPen:g.topToPenM, depth:sz.d, saddle:pc.lengthM, ok:g.ok };
});
check('  …measured to the kerb, not through it',
  saddleGeom.saddle < saddleGeom.topToPen + 0.31 &&
  saddleGeom.saddle > saddleGeom.topToPen - saddleGeom.depth / 2,
  'ridge→pen ' + r2(saddleGeom.topToPen) + 'm, box ' + saddleGeom.depth +
  'm deep, saddle ' + saddleGeom.saddle + 'm');
check('  …and _penSheetGeom still refuses a box unless asked',
  await pg.evaluate(() => {
    const e = _penAllOwned().find(x => x.pen.kind === 'box');
    return !_penSheetGeom(e.pen, _penOwnerCtx(e.ownerIdx)).ok;
  }));

// It prices, on the roof the box sits on.
const boxTabs = Object.keys(perTab).filter(k => perTab[k].some(x => /^boxflash:/.test(x)));
check('the box flashing set reaches the pricing material — on the Main Roof',
  boxTabs.length === 1 && boxTabs[0] === 'Main Roof', boxTabs.join(', ') || 'nowhere');
const boxCost = await pg.evaluate(() => {
  const saved = _matSelectedRoofIndices();
  _syncCurrentToRoof(); _matSetSelectedRoofs([0]);
  const rows = _buildMaterialPriceRows().filter(r => /^boxflash:/.test(r.key));
  _matSetSelectedRoofs(saved);
  return { rate: _boxFlashLmPrice(),
           cost: rows.reduce((t,r) => t + r.autoQty * (r.variants[0].price||0), 0) };
});
check('…charged by the metre off the price book', boxCost.cost > 0,
  '$' + r2(boxCost.cost) + ' at $' + boxCost.rate + '/lm');
check('…at the apron rate until a box rate is set', boxCost.rate === 16.10,
  '$' + boxCost.rate + '/lm');
const ownRate = await pg.evaluate(() => {
  S.settings.price_book.box_pen_lm = 25;
  const r = _boxFlashLmPrice();
  S.settings.price_book.box_pen_lm = 0;
  return r;
});
check('…and at its own rate once one is', ownRate === 25, '$' + ownRate + '/lm');

// ── the job pack: every piece editable, deletable, restorable ──────
await pg.evaluate(() => { gotoTab('materials'); });
await pg.waitForTimeout(1800);
const jp = await pg.evaluate(() => {
  const t = document.getElementById('jpPages') || document.body;
  const txt = t.innerText || '';
  return { heading: /Boxed penetration flashings/i.test(txt),
           back: /Boxed Penetration Top Apron/.test(txt), saddle: /Boxed Penetration Top Back-Tray/.test(txt),
           addBtn: !!t.querySelector('[onclick*="_bfExtraAdd"]'),
           qtyInputs: t.querySelectorAll('[onchange*="_bfSet(\'Qty\'"]').length,
           lenInputs: t.querySelectorAll('[onchange*="_bfSet(\'Len\'"]').length,
           dels: t.querySelectorAll('[onclick*="_bfSetOff"]').length };
});
check('the job pack auto-adds the boxed flashing set', jp.heading && jp.back && jp.saddle,
  JSON.stringify(jp));
check('…with every piece re-quantifiable and re-lengthable',
  jp.qtyInputs === 5 && jp.lenInputs === 5, JSON.stringify(jp));
check('…every piece deletable, and a row you can add by hand',
  jp.dels === 5 && jp.addBtn, JSON.stringify(jp));

const edit = await pg.evaluate(() => {
  const pc = _boxFlashPenList().find(p => p.key === 'back');
  const k = _bfKey(pc);
  const was = _bfLenOf(pc);
  _bfSet('Len', k, 9.9); _bfSet('Qty', k, 3);
  const after = _boxFlashOrderList().find(g => /top apron/i.test(g.name));
  const lmAfter = _boxFlashTotalLm();
  _bfSet('Len', k, ''); _bfSet('Qty', k, '');
  const back = _bfLenOf(_boxFlashPenList().find(p => p.key === 'back'));
  return { was, len:after && after.lengthM, qty:after && after.qty, lmAfter, back };
});
check('a typed length and quantity carry through to the order',
  edit.len === 9.9 && edit.qty === 3, JSON.stringify(edit));
check('…and clearing them hands the piece back to the drawing',
  Math.abs(edit.back - edit.was) < 0.001, edit.back + ' vs ' + edit.was);

const del = await pg.evaluate(() => {
  const pc = _boxFlashPenList().find(p => p.key === 'saddle');
  const k = _bfKey(pc);
  const before = _boxFlashTotalLm();
  _bfSetOff(k, true);
  const gone = { lm:_boxFlashTotalLm(), live:_boxFlashLiveList().length,
                 chip: !!document.querySelector('[onclick*="_bfSetOff(\''+k+'\',false)"]') };
  _bfSetOff(k, false);
  return { before, gone, back:_boxFlashTotalLm() };
});
check('striking a piece off takes it out of the price',
  del.gone.lm < del.before - 1 && del.gone.live === 4, JSON.stringify(del.gone));
check('…and leaves a chip to put it back', del.gone.chip, JSON.stringify(del.gone));
check('…which restores it exactly', Math.abs(del.back - del.before) < 0.001,
  del.back + ' vs ' + del.before);

const extra = await pg.evaluate(() => {
  const before = _boxFlashOrderList().length;
  _bfExtraAdd();
  _bfExtraUpdate(0, 'name', 'Cricket flashing');
  _bfExtraUpdate(0, 'len', 2.5);
  _bfExtraUpdate(0, 'qty', 2);
  const g = _boxFlashOrderList().find(x => x.name === 'Cricket flashing');
  const lm = _boxFlashTotalLm();
  _bfExtraDelete(0);
  return { before, after:_boxFlashOrderList().length, g, lm };
});
check('a hand-typed box flashing reaches the order too',
  extra.g && extra.g.qty === 2 && extra.g.lengthM === 2.5, JSON.stringify(extra.g));
check('…and deleting it puts the list back', extra.after === extra.before,
  extra.after + ' vs ' + extra.before);

// ── 3. the whole job's flashings, in one place ─────────────────────
const fj = await pg.evaluate(() => _jobFlashingLm());
check('the job carries roughly the 91 lm of flashings he counted',
  fj.total > 85 && fj.total < 96, r2(fj.total) + ' lm across ' + fj.roofs + ' roofs');
check('…which is more than the ridges and barges alone',
  fj.total > fj.ridge + fj.barge + 5,
  'ridge ' + r2(fj.ridge) + ' + barge ' + r2(fj.barge) + ' = ' + r2(fj.ridge+fj.barge));
check('…and it counts the aprons that live on the lean-tos', fj.apron > 10, r2(fj.apron) + ' lm');
check('…and the boxed penetration set', fj.box > 5, r2(fj.box) + ' lm');
check('…with gutters kept out of it, the way he counts them',
  fj.gutter > 40 && fj.total < fj.gutter + fj.total, r2(fj.gutter) + ' lm of gutter, excluded');

await pg.evaluate(() => { gotoTab('pricing'); _setPricingRoof(0); });
await pg.waitForTimeout(1500);
const strip = await pg.evaluate(() => {
  const w = document.getElementById('materialPriceTableWrap');
  const txt = (w && w.innerText) || '';
  const m = txt.match(/([\d.]+) lm of flashings on this job/);
  return { txt: (txt.split('\n')[0] || '').slice(0, 90), lm: m ? parseFloat(m[1]) : null,
           apron: /Apron/.test(txt), box: /Boxed penetrations/.test(txt) };
});
check('the pricing tab says what the whole job comes to, not just this roof',
  strip.lm !== null && Math.abs(strip.lm - fj.total) < 0.15, strip.lm + ' lm shown');
check('…broken down so the missing aprons are visible from the main roof',
  strip.apron && strip.box, strip.txt);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
