// Five maps per roof made the Job Pack's Maps panel a long scroll, and only
// two of them are the ones that actually go on a job pack. Tick toggles above
// the zoom decide which kinds are offered: Sheet calc check and Sheet layout
// on, the other three one tick away.
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
await pg.goto('file://'+DIR+'/index.html');
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
check('there is a tick per map kind', v.toggles.length === 5,
  v.toggles.map(t => t.kind).join(','));
check('…sitting above the zoom, where they were asked for', v.aboveZoom);
check('Sheet calc check and Sheet layout are on by default',
  v.toggles.filter(t => t.on).map(t => t.kind).sort().join(',') === 'calccheck,sheetplan',
  v.toggles.filter(t => t.on).map(t => t.kind).join(','));
check('…and those are the only maps offered',
  v.kinds.join(',') === 'calccheck,sheetplan', v.kinds.join(',') + ' (' + v.n + ' thumbs)');
check('…with calc check listed first', await pg.evaluate(() =>
  JP_MAP_KINDS[0].kind === 'calccheck' && JP_MAP_KINDS[1].kind === 'sheetplan'));

// ── ticking one on brings its maps in ─────────────────────────────
const before = v.n;
await pg.evaluate(() => _jpMapKindSet('detailed', true));
await pg.waitForTimeout(1200);
v = await st();
check('ticking a kind on brings its maps in',
  v.kinds.indexOf('detailed') >= 0 && v.n > before, v.kinds.join(',') + ' (' + v.n + ')');
await pg.evaluate(() => _jpMapKindSet('detailed', false));
await pg.waitForTimeout(1200);
v = await st();
check('…and unticking takes them back out',
  v.kinds.join(',') === 'calccheck,sheetplan', v.kinds.join(','));

// ── the choice sticks ─────────────────────────────────────────────
check('the choice is remembered for next time', await pg.evaluate(() => {
  _jpMapKindSet('flashref', true);
  return localStorage.getItem('fr_jp_map_kind_flashref') === '1' && _jpMapKindOn('flashref');
}));
await pg.evaluate(() => _jpMapKindSet('flashref', false));
await pg.waitForTimeout(900);

// ── all off says why, rather than looking broken ──────────────────
v = await pg.evaluate(async () => {
  ['calccheck','sheetplan'].forEach(k => _jpMapKindSet(k, false));
  await new Promise(r => setTimeout(r, 600));
  return document.getElementById('jpMapPanelList').textContent.trim();
});
check('with every kind off the panel says why, not "draw your roof"',
  /No map types ticked/.test(v), v.slice(0, 60));
await pg.evaluate(() => { ['calccheck','sheetplan'].forEach(k => _jpMapKindSet(k, true)); });
await pg.waitForTimeout(1200);
v = await st();
check('…and ticking back on restores them', v.kinds.join(',') === 'calccheck,sheetplan',
  v.kinds.join(','));

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
