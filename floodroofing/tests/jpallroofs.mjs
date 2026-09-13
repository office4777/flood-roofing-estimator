// Feedback report 41 (five roofs): "show the sheet layout / calculation
// diagram on ALL the roofs in one diagram, with buttons at the top of the
// maps window to toggle the different roofs on and off … all roofs on by
// default … but keep the separate diagrams, and a select-all box, ticked."
//
// So the Maps panel now offers, for every map kind, ONE combined diagram
// carrying every ticked roof, listed above the per-roof ones — and the roof
// chips decide what goes into it.
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
await pg.waitForTimeout(3500);

const st = () => pg.evaluate(() => ({
  keys: [...document.querySelectorAll('#jpMapPanelList .jp-map-thumb')]
    .map(t => t.getAttribute('data-map-key')),
  subs: [...document.querySelectorAll('#jpMapPanelList .jp-map-thumb')]
    .map(t => (t.querySelector('.jp-map-label small')||{}).textContent || ''),
  roofChips: [...document.querySelectorAll('#jpMapRoofs input[data-jproof]')]
    .map(i => ({ i: +i.getAttribute('data-jproof'), on: i.checked })),
  allChip: (() => { const e = document.querySelector('#jpMapRoofs input[data-jproofall]');
    return e ? e.checked : null; })(),
  roofsAboveList: (() => {
    const r = document.getElementById('jpMapRoofs'), l = document.getElementById('jpMapPanelScroll');
    if (!r || !l) return false;
    return !!(r.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
  })(),
}));

let v = await st();

// ── the roof buttons ──────────────────────────────────────────────
check('there is a button per roof at the top of the maps window',
  v.roofChips.length === 5, v.roofChips.length + ' chips');
check('…above the maps themselves', v.roofsAboveList);
check('every roof is on by default', v.roofChips.every(c => c.on));
check('…and the select-all box is there, ticked', v.allChip === true, String(v.allChip));

// ── one combined diagram per kind, listed first ───────────────────
check('there is ONE combined diagram per map kind',
  v.keys.filter(k => /:all$/.test(k)).sort().join(',') === 'calccheck:all,sheetplan:all',
  v.keys.filter(k => /:all$/.test(k)).join(','));
check('…listed above the per-roof ones',
  /:all$/.test(v.keys[0]) && /:all$/.test(v.keys[1]) && !/:all$/.test(v.keys[2]),
  v.keys.slice(0,4).join(' | '));
check('…labelled "All roofs" while every roof is on',
  v.subs[0] === 'All roofs', v.subs[0]);
check('and the per-roof diagrams are still there', 
  v.keys.filter(k => /^sheetplan:\d+$/.test(k)).length === 5,
  v.keys.filter(k => /^sheetplan:\d+$/.test(k)).join(','));

// ── the combined diagram really carries every roof ────────────────
const drew = await pg.evaluate(() => {
  const secs = window._lastSheetSections || [];
  const roofs = [...new Set(secs.map(s => s.roof))].filter(Boolean);
  // Distinct outlines the combined calc-check canvas will draw.
  const keyOf = o => o.map(p => p[0]+','+p[1]).join(' ');
  const outlines = [...new Set(secs.filter(s => s.outline && s.outline.length >= 3)
    .map(s => keyOf(s.outline)))];
  return { roofs: roofs.length, outlines: outlines.length,
           combined: (_jpCaptureCombined('calccheck', {}) || '').slice(0, 22),
           one: (_jpCaptureCalcCheck({}, 0) || '').slice(0, 22) };
});
check('the sheet plan has sections from more than one roof',
  drew.roofs > 1, drew.roofs + ' roofs');
check('…and the combined diagram draws every one of their outlines, not just the first',
  drew.outlines > 1, drew.outlines + ' outlines');
check('the combined calc-check diagram renders', /^data:image\/png/.test(drew.combined), drew.combined);

// ── toggling a roof off takes it out of the one diagram ───────────
const wide = await pg.evaluate(() => (_jpCaptureCombined('calccheck', {}) || '').length);
await pg.evaluate(() => _jpRoofSet(2, false));
await pg.waitForTimeout(1500);
v = await st();
check('unticking a roof drops its own diagrams', 
  v.keys.indexOf('sheetplan:2') < 0 && v.keys.indexOf('sheetplan:3') >= 0,
  v.keys.filter(k => /^sheetplan:/.test(k)).join(','));
check('…and the combined diagram says which roofs it is now showing',
  v.subs[0] !== 'All roofs' && /Roof 3/.test(v.subs[0]) === false, v.subs[0]);
check('…and select-all unticks itself', v.allChip === false, String(v.allChip));
const narrow = await pg.evaluate(() => (_jpCaptureCombined('calccheck', {}) || '').length);
check('…and the one diagram actually changed', narrow !== wide, narrow + ' vs ' + wide);

// ── select all puts them back ─────────────────────────────────────
await pg.evaluate(() => _jpSetAllRoofs(true));
await pg.waitForTimeout(1500);
v = await st();
check('select all brings every roof back', v.roofChips.every(c => c.on) && v.allChip === true);
check('…and the combined diagram is whole again',
  v.subs[0] === 'All roofs' && v.keys.filter(k => /^sheetplan:\d+$/.test(k)).length === 5);

// ── the last roof cannot be turned off ────────────────────────────
const last = await pg.evaluate(async () => {
  _jpSetAllRoofs(false);                     // keeps roof 1
  await new Promise(r => setTimeout(r, 400));
  const before = _jpVisibleRoofIndices().slice();
  _jpRoofSet(before[0], false);              // try to remove the last one
  await new Promise(r => setTimeout(r, 400));
  return { before, after: _jpVisibleRoofIndices().slice(),
           thumbs: document.querySelectorAll('#jpMapPanelList .jp-map-thumb').length };
});
check('the last roof cannot be unticked, so the panel never goes empty',
  last.after.length === 1 && last.thumbs > 0,
  JSON.stringify(last));
await pg.evaluate(() => _jpSetAllRoofs(true));
await pg.waitForTimeout(1200);

// ── the combined sheet layout stacks the ticked roofs ─────────────
const sp = await pg.evaluate(() => {
  const url = _jpCaptureCombined('sheetplan', {});
  if (!url) return null;
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res({ w: im.width, h: im.height, ok: /^data:image\/png/.test(url) });
    im.onerror = () => res(null);
    im.src = url;
  });
});
const one = await pg.evaluate(() => {
  const url = _jpCaptureSheetPlan({}, 0);
  if (!url) return null;
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res({ w: im.width, h: im.height });
    im.onerror = () => res(null);
    im.src = url;
  });
});
check('the combined sheet layout renders', !!(sp && sp.ok), JSON.stringify(sp));
check('…and is taller than one roof on its own — it stacks them',
  !!(sp && one && sp.h > one.h), JSON.stringify(sp) + ' vs ' + JSON.stringify(one));

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
