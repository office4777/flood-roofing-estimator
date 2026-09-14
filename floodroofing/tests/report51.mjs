// Feedback report 51, the five-roof job: "the material quantities won't let
// me change them, the calculations are wrong and the sheet calculation
// diagram isn't showing all the roofs".
//
// The report's cut-list state showed why: the order had only THREE groups
// (5.90, 3.88, 2.93). Roofs 3, 4 and 5 — lean-tos drawn as apron + barge +
// gutter — carried the label "gable" and the gable takeoff, finding no
// ridge, counted nothing. Their sheet runs were then on the map with no row
// to land on, so the bump-out splitter peeled sheets out of the other rows
// to invent them (3.88: 12 → 8, 2.93: 10 → 1), and the 12 the office typed
// on the 3.88 row was peeled straight back off.
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
  // Every roof labelled "gable", as the report's job had them — the three
  // lean-tos included.
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { roofType: 'gable', lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.roofType = 'gable';
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  DRAW.sheetGroupQtyOverrides = { 3884: 12, 3888: 12 };
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3500);

const r = await pg.evaluate(() => {
  const sc = window._lastSheetCounts || {};
  const groups = (sc.groups || []).map(g => ({ mm: g.orderedMm, n: g.count }));
  const rows = _jpBuildSheetRows(sc).map(x => ({ len: (x.len/1000).toFixed(2), qty: x.qty }));
  const secRoofs = [...new Set((window._lastSheetSections || []).map(s => s.roof))];
  return { groups, rows, secRoofs, total: groups.reduce((a, g) => a + g.n, 0) };
});
check('all five roofs are in the order, lean-tos labelled "gable" included',
  r.groups.length === 6, JSON.stringify(r.groups));
check('…64 sheets in all', r.total === 64, String(r.total));
check('the sheet calculation check has sections for all five roofs',
  r.secRoofs.length === 5, r.secRoofs.join(','));
const byLen = {}; r.rows.forEach(x => { byLen[x.len] = (byLen[x.len] || 0) + x.qty; });
check('no cut-list row was peeled down to one sheet', r.rows.every(x => x.qty > 1), JSON.stringify(byLen));
check('2.95 reads 11, 3.28 reads 14, 2.93 reads 10',
  byLen['2.95'] === 11 && byLen['3.28'] === 14 && byLen['2.93'] === 10, JSON.stringify(byLen));
check('the 12 the office typed on the 3.88 row is what the row shows', byLen['3.88'] === 12, JSON.stringify(byLen));

// ── the photos pop-out on the Job Pack, as a second tab under MAPS ──
const ui = await pg.evaluate(() => {
  const fp = document.getElementById('fergusRoofPanel'), mp = document.getElementById('jpMapPanel');
  const before = { shown: fp && getComputedStyle(fp).display !== 'none', second: fp && fp.classList.contains('jp-second'),
    open: fp && fp.classList.contains('is-open'), mapsOpen: mp && mp.classList.contains('is-open'),
    tabTop: fp ? getComputedStyle(document.getElementById('fergusRoofPanelToggle')).top : null };
  return { before };
});
await pg.evaluate(() => _fergusPanelToggle());
await pg.waitForTimeout(400);                       // the slide-out opens on the next frame
ui.afterOpen = await pg.evaluate(() => ({ open: document.getElementById('fergusRoofPanel').classList.contains('is-open'),
  mapsOpen: document.getElementById('jpMapPanel').classList.contains('is-open') }));
await pg.evaluate(() => _jpToggleMapPanel());
await pg.waitForTimeout(400);
ui.afterMaps = await pg.evaluate(() => ({ open: document.getElementById('fergusRoofPanel').classList.contains('is-open'),
  mapsOpen: document.getElementById('jpMapPanel').classList.contains('is-open') }));
ui.grab = await pg.evaluate(() => getComputedStyle(document.getElementById('fergusRoofPhotoScroll')).cursor);
check('on the Job Pack the photos pop-out is there, as a second tab under MAPS',
  ui.before.shown && ui.before.second && ui.before.tabTop === '180px', JSON.stringify(ui.before));
check('…closed by default, with Maps the default choice', !ui.before.open && ui.before.mapsOpen, JSON.stringify(ui.before));
check('pressing PHOTOS slides the photos out and puts the maps away', ui.afterOpen.open && !ui.afterOpen.mapsOpen, JSON.stringify(ui.afterOpen));
check('pressing MAPS brings the maps back and puts the photos away', ui.afterMaps.mapsOpen && !ui.afterMaps.open, JSON.stringify(ui.afterMaps));
check('the photo window pans by grabbing it', ui.grab === 'grab', ui.grab);

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
