// "It just let me change one of the sheet-length quantities, which changed
// a DIFFERENT sheet length's quantity — something is wrong with the wiring."
// On the same five-roof job the cut list read 1 @ 2.95 where the roof
// needs 11.
//
// The cut list labels its rows from the sheet-run numbers drawn on the map.
// Roof 2 is a gable whose two sides both read 2.93 m: the value-matcher let
// the second 2.93 claim the next row along (2.95), 2.95 then took 3.28's
// row, and every label shifted one row down — so the row that SAID 2.95
// was another group, and a quantity typed on it changed that other group.
// The bump-out splitter, seeing lengths with "no row", then moved sheets
// between rows and left "at least one" behind: 1 @ 2.95.
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
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); } catch(e){}
  // Every roof in the pack, picked by hand: the pack follows the quote otherwise.
  try { _jpSelectAllRoofs(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3500);

// The map's sheet-run labels exactly as the report captured them — the two
// 2.93 m sides of Roof 2 among them — each spanning ten columns.
const rows = () => pg.evaluate(() => {
  // Pin the map's labels, then build the rows straight from them — the
  // way the Job Pack does — without a redraw replacing the list.
  window._roofCanvasHits = { sheets: ['2.93m','2.93m','5.90m','3.88m','2.95m','3.28m','2.10m'].map((l, i) =>
    // A label belongs to a roof the pack covers.
    ({ label: l, runLo: 0, runHi: 10 * (0.762 / DRAW.scaleMetresPerPx), key: 'k' + i, roofIdx: i % DRAW.roofs.length })) };
  const built = _jpBuildSheetRows(window._lastSheetCounts);
  return built.map(r => ({ qty: r.qty, len: r.len / 1000, key: r.origLen }));
});
let v = await rows();
const byLen = {}; v.forEach(r => { byLen[r.len.toFixed(2)] = (byLen[r.len.toFixed(2)] || 0) + r.qty; });
check('the row that says 2.95 holds the 11 sheets of the 2.95 roof', byLen['2.95'] === 11, JSON.stringify(byLen));
check('…and 2.93 holds Roof 2\'s 10, 3.28 holds 14, 3.88 holds 12',
  byLen['2.93'] === 10 && byLen['3.28'] === 14 && byLen['3.88'] === 12, JSON.stringify(byLen));
check('no row was peeled down to one sheet', v.every(r => r.qty > 1), v.map(r => r.qty).join(','));
check('the total is still 64', v.reduce((a, r) => a + r.qty, 0) === 64, String(v.reduce((a, r) => a + r.qty, 0)));

// ── typing a quantity changes THAT row and no other ────────────────
const row295 = v.find(r => r.len.toFixed(2) === '2.95');
await pg.evaluate((k) => { DRAW.sheetGroupQtyOverrides = DRAW.sheetGroupQtyOverrides || {}; DRAW.sheetGroupQtyOverrides[k] = 12; }, row295.key);
await pg.waitForTimeout(600);
const after = await rows();
const byLen2 = {}; after.forEach(r => { byLen2[r.len.toFixed(2)] = (byLen2[r.len.toFixed(2)] || 0) + r.qty; });
check('typing 12 on the 2.95 row makes it 12', byLen2['2.95'] === 12, JSON.stringify(byLen2));
check('…and every other row is exactly what it was',
  ['2.93','3.28','3.88','5.90','2.10'].every(k => byLen2[k] === byLen[k]), JSON.stringify(byLen2));

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
