// Tick toggles above the zoom decide which kinds of map the Job Pack's Maps
// panel offers. Since 2026-10-27 every kind starts ticked, in the owner's
// order, and the Sheet calc check is withdrawn.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1700,height:1200} });
const pg = await ctx.newPage();
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
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3000);

const st = () => pg.evaluate(() => ({
  toggles: [...document.querySelectorAll('#jpMapKinds input[data-mapkind]')]
    .map(i => ({ kind: i.getAttribute('data-mapkind'), on: i.checked })),
  kinds: [...new Set([...document.querySelectorAll('#jpMapPanelList .jp-map-thumb')]
    .map(t => (t.getAttribute('data-map-key')||'').split(':')[0]))].sort(),
  n: document.querySelectorAll('#jpMapPanelList .jp-map-thumb').length,
  aboveZoom: (() => {
    const k = document.getElementById('jpMapKinds'), z = document.getElementById('jpMapPanelZoom');
    if (!k || !z) return false;
    return !!(k.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING);
  })(),
}));

let v = await st();
// THE OWNER'S ORDER, ALL TICKED (2026-10-27: "have them all default clicked
// as showing in the list but reorder them as detailed map at the top, then
// sheet layout below, then flashing ref below, then basic map below that").
// The Sheet calc check is withdrawn (CALC_CHECK_HIDDEN) and offers no tick.
check('there is a tick per map kind, in the owner\'s order', v.toggles.map(t => t.kind).join(',') === 'detailed,sheetplan,flashref,basic',
  v.toggles.map(t => t.kind).join(','));
check('…sitting above the zoom, where they were asked for', v.aboveZoom);
check('every one is ticked by default', v.toggles.length === 4 && v.toggles.every(t => t.on),
  v.toggles.filter(t => t.on).map(t => t.kind).join(','));
const order = await pg.evaluate(() => [...new Set([...document.querySelectorAll('#jpMapPanelList .jp-map-thumb')]
  .map(t => (t.getAttribute('data-map-key')||'').split(':')[0]))].join(','));
check('…and the maps are offered in that order, no calc check among them', order === 'detailed,sheetplan,flashref,basic', order);
check('…whatever a device had stored under the old ticks', await pg.evaluate(() => {
  localStorage.setItem('fr_jp_map_kind_detailed', '0');
  return _jpMapKindOn('detailed') && JP_MAP_KIND_KEY !== 'fr_jp_map_kind_';
}));

// ── unticking one takes its maps out, ticking brings them back ────
const before = v.n;
await pg.evaluate(() => _jpMapKindSet('basic', false));
await pg.waitForTimeout(1200);
v = await st();
check('unticking a kind takes its maps out',
  v.kinds.indexOf('basic') < 0 && v.n < before, v.kinds.join(',') + ' (' + v.n + ')');
check('the choice is remembered for next time', await pg.evaluate(() =>
  localStorage.getItem(JP_MAP_KIND_KEY + 'basic') === '0' && !_jpMapKindOn('basic')));
await pg.evaluate(() => _jpMapKindSet('basic', true));
await pg.waitForTimeout(1200);
v = await st();
check('…and ticking it back on brings them back', v.kinds.indexOf('basic') >= 0 && v.n === before, v.kinds.join(',') + ' (' + v.n + ')');

// ── all off says why, rather than looking broken ──────────────────
v = await pg.evaluate(async () => {
  ['detailed', 'sheetplan', 'flashref', 'basic'].forEach(k => _jpMapKindSet(k, false));
  await new Promise(r => setTimeout(r, 600));
  return document.getElementById('jpMapPanelList').textContent.trim();
});
check('with every kind off the panel says why, not "draw your roof"',
  /No map types ticked/.test(v), v.slice(0, 60));
await pg.evaluate(() => { ['detailed', 'sheetplan', 'flashref', 'basic'].forEach(k => _jpMapKindSet(k, true)); });
await pg.waitForTimeout(1200);

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
