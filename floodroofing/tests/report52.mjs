// Feedback report 52: "the picture doesn't drag properly in either photos
// pop-out", "each roof has its own number of sheets — gutter ÷ 0.762
// rounded up from a tenth", and "whenever I edit or add to the materials it
// should never autochange after I've edited it": a tab switch put a typed
// quantity on a different row and adding a row lost three others.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report41.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{width:1700,height:1200} })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);

// ── the rounding rule, on the engine's own helper ──
const rr = await pg.evaluate(() => [10, 8.38, 10.4, 7.65, 9.906].map(m => _sheetsAcross(m / 0.02, 0.762 / 0.02)));
check('10 m is 14 sheets (13.12 → up), 8.38 m is 11, 10.4 m is 14', rr[0] === 14 && rr[1] === 11 && rr[2] === 14, rr.join(','));
check('7.65 m is 10 (10.04 stays down), 9.906 m is exactly 13', rr[3] === 10 && rr[4] === 13, rr.join(','));

await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { roofType: 'gable', lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.roofType = 'gable';
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); } catch(e){}
  // Every roof in the pack, picked by hand: the pack follows the quote otherwise.
  try { _jpSelectAllRoofs(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3500);

// A multi-roof pack lists its sheets one roof at a time (report 54): the
// office's edits below go on the main roof's list (two rows) through its
// scope, and a row is hidden on Roof 2's list — each roof's edits are its own.
const RI = 0, RH = 1;
const rowsOf = (ri) => pg.evaluate((ri) => _jpSheetScope(ri, () => _jpBuildSheetRows(_jpSheetCountsInScope()).map(x => ({ len: x.len, qty: x.qty, origLen: x.origLen }))), ri);
const rows0 = await rowsOf(RI), rowsH0 = await rowsOf(RH);
const allRows = await pg.evaluate(() => _jpSheetRowsAll().reduce((n, g) => n + g.rows.length, 0));
check('the five-roof job lists its rows, a roof at a time', rows0.length >= 2 && rowsH0.length >= 1 && allRows >= 5, JSON.stringify(rows0) + ' / ' + allRows + ' rows over the roofs');
check('nothing is frozen before the office touches a row', await pg.evaluate((ri) => _jpSheetScope(ri, () => !_jpSheetFrozen()), RI));

// Type a quantity on one row, hide a row on another roof, add a row.
const edited = rows0[1], hidden = rowsH0[0];
await pg.evaluate(([o, h, ri, rh]) => { _jpSheetScoped(ri, '_jpSheetSetQty', o, 12); _jpSheetScoped(rh, '_jpSheetHide', h); _jpSheetScoped(ri, '_jpSheetExtraAdd'); _jpSheetScoped(ri, '_jpSheetExtraUpdate', 0, 'lenMm', 2.95); _jpSheetScoped(ri, '_jpSheetExtraUpdate', 0, 'qty', 11); }, [edited.origLen, hidden.origLen, RI, RH]);
await pg.waitForTimeout(300);
const read = () => pg.evaluate(([ri, rh]) => {
  const main = _jpSheetScope(ri, () => ({
    rows: _jpBuildSheetRows(_jpSheetCountsInScope()).map(x => ({ len: x.len, qty: x.qty, origLen: x.origLen })),
    extras: (DRAW.matSheetExtras || []).map(x => ({ lenMm: x.lenMm, qty: x.qty })),
    frozen: !!_jpSheetFrozen() }));
  main.rowsH = _jpSheetScope(rh, () => _jpBuildSheetRows(_jpSheetCountsInScope()).map(x => ({ len: x.len, qty: x.qty, origLen: x.origLen })));
  main.inputs = [...document.querySelectorAll('#jpPages .mat-list-row input')].map(i => i.value);
  return main;
}, [RI, RH]);
let st = await read();
check('the first edit freezes the list', st.frozen);
check('the typed 12 is on the row it was typed on',
  st.rows.find(x => x.origLen === edited.origLen).qty === 12, JSON.stringify(st.rows));
check('every other row still says what it said', rows0.filter(x => x.origLen !== edited.origLen)
  .every(x => { const n = st.rows.find(y => y.origLen === x.origLen); return n && n.qty === x.qty && n.len === x.len; }), JSON.stringify(st.rows));
check('the hidden row is gone from its roof and the added row stands at 11 @ 2.95 on the main roof',
  !st.rowsH.some(x => x.origLen === hidden.origLen) && st.extras.length === 1 && st.extras[0].qty === 11 && st.extras[0].lenMm === 2950, JSON.stringify([st.rowsH, st.extras]));

// Switch tabs, come back, redraw: nothing may change.
await pg.evaluate(() => { gotoTab('draw'); });
await pg.waitForTimeout(300);
await pg.evaluate(() => { try { redrawAll(); renderRoofSheetPlan(); } catch(e){} gotoTab('materials'); });
await pg.waitForTimeout(1500);
const st2 = await read();
check('after a tab switch and a redraw the rows are exactly as edited', JSON.stringify(st2.rows) === JSON.stringify(st.rows) && JSON.stringify(st2.rowsH) === JSON.stringify(st.rowsH), JSON.stringify(st2.rows));
check('…and the extra row too', JSON.stringify(st2.extras) === JSON.stringify(st.extras));

// A second row's quantity changes THAT row only.
const other = st2.rows.find(x => x.origLen !== edited.origLen);
await pg.evaluate(([o, ri]) => _jpSheetScoped(ri, '_jpSheetSetQty', o, 7), [other.origLen, RI]);
await pg.waitForTimeout(300);
const st3 = await read();
check('typing 7 on another row leaves the 12 alone',
  st3.rows.find(x => x.origLen === other.origLen).qty === 7 && st3.rows.find(x => x.origLen === edited.origLen).qty === 12, JSON.stringify(st3.rows));
check('the rows survive a save/load round trip', await pg.evaluate((ri) => {
  _lkgGuard._readOnly = true; const snap = JSON.parse(JSON.stringify(snapshotCurrentJob())); _lkgGuard._readOnly = false;
  const fz = snap.draw.matSheetByRoof && snap.draw.matSheetByRoof[ri] && snap.draw.matSheetByRoof[ri].matSheetFrozen;
  return fz && Array.isArray(fz.rows) && fz.rows.length === DRAW.matSheetByRoof[ri].matSheetFrozen.rows.length; }, RI));

// "Reset from map" is offered while frozen and brings the map's numbers back.
check('the Job Pack offers Reset from map while the list is frozen', await pg.evaluate(() => /Reset from map/.test(document.getElementById('jpPages').innerHTML)));
await pg.evaluate((ri) => _jpSheetScoped(ri, '_jpSheetUnfreeze'), RI);
await pg.waitForTimeout(300);
const st4 = await read();
check('Reset from map brings every row back from the roof', !st4.frozen && JSON.stringify(st4.rows) === JSON.stringify(rows0), JSON.stringify(st4.rows));

// ── the photo cannot start a native drag ──
const drag = await pg.evaluate(() => {
  const el = document.getElementById('fergusRoofPhotoScroll');
  const img = document.createElement('img'); img.width = 50; img.height = 50; el.appendChild(img);
  const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
  const cancelled = !img.dispatchEvent(ev);
  const pd = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  const pdCancelled = !img.dispatchEvent(pd);
  return { cancelled, pdCancelled, userDrag: getComputedStyle(img).webkitUserDrag };
});
check('a drag started on a photo is cancelled (the pan takes it instead)', drag.cancelled && drag.pdCancelled, JSON.stringify(drag));
check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await b.close();
const n = results.filter(Boolean).length;
console.log(`\n${n}/${results.length} passed`);
process.exit(n === results.length ? 0 : 1);
