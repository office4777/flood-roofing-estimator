// The office's way of counting a hip roof with several ridges, pinned on
// the shapes the owner ruled on:
//   · a T: "71 is correct" — the stem's longer sheets run on through the
//     bar (19 a side), the bar keeps its two ends (8 a side each).
//   · a double L: "10 m ÷ 0.762 = 14 sheets each side, 28 long sheets, then
//     work out the north and east wings separately" — the main is only the
//     stretch where BOTH its slopes land on a gutter; the tall wing runs to
//     the bottom eave as one piece; the step column and the band under it
//     are a wing of their own.
//   · the canonical L keeps its 65.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const fx = n => JSON.parse(readFileSync(_j(_ROOT, 'tests', n), 'utf8'));

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{width:1700,height:1200} })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
const count = g => pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true; DRAW.lines = []; DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  DRAW.sheetPlanDeletedIds = []; DRAW.sheetGroupQtyOverrides = {}; DRAW.sheetGroupOverrides = {};
  autoGenerateRoof(g.autoType);
  renderRoofSheetPlan();
  const secs = (window._lastSheetSections || []).map(s => ({ main: !!s.isPrimary, total: s.total,
    perNeg: s.perNeg, perPos: s.perPos, mm: s.orderedMm, spare: s.valleyExtra || 0 }));
  const groups = ((window._lastSheetCounts || {}).groups || []).map(g => ({ mm: g.orderedMm, count: g.count }));
  return { secs, groups, total: groups.reduce((a, x) => a + x.count, 0) };
}, g);
const byLen = r => { const o = {}; r.groups.forEach(g => { const k = (g.mm/1000).toFixed(1); o[k] = (o[k]||0) + g.count; }); return o; };

// ── the T ─────────────────────────────────────────────────────────
let r = await count(fx('fixtures-tee.json'));
let main = r.secs.find(s => s.main) || {};
check('T: the stem\'s longer sheets run on through the bar, 19 a side',
  main.perNeg === 19 && main.perPos === 19, JSON.stringify(main));
check('T: the bar keeps two ends of 8 a side',
  r.secs.filter(s => !s.main).map(s => s.perNeg + '/' + s.perPos).join(',') === '8/8,8/8',
  r.secs.filter(s => !s.main).map(s => s.perNeg + '/' + s.perPos).join(','));
check('T: 71 sheets, as the owner ruled', r.total === 71, r.total + ' — ' + JSON.stringify(byLen(r)));

// ── the double L ──────────────────────────────────────────────────
r = await count(fx('fixtures-doublel.json'));
main = r.secs.find(s => s.main) || {};
check('double L: the main is 10 m ÷ 0.762 = 14 a side — only where both slopes reach a gutter',
  main.perNeg === 14 && main.perPos === 14 && main.spare === 1, JSON.stringify(main));
const wings = r.secs.filter(s => !s.main).map(s => s.perNeg + s.perPos).sort((a, b) => b - a);
check('double L: the tall wing runs to the bottom eave as one piece (21 a side)',
  wings[0] === 42, wings.join(','));
check('double L: the step column and the band under it are an east wing of their own (14 a side)',
  wings[1] === 28, wings.join(','));
check('double L: both wings order the same 2.70 m sheet, one row',
  Object.keys(byLen(r)).sort().join(',') === '2.7,3.2', JSON.stringify(byLen(r)));

// ── the canonical L is untouched ──────────────────────────────────
const ox = 140, oy = 140;
const L = [[ox,oy],[ox+300,oy],[ox+300,oy+300],[ox+900,oy+300],[ox+900,oy+1000],[ox,oy+1000]];
r = await count({ scaleMetresPerPx: 0.02, calPitch: 22, outline: L, autoType: 'hip' });
check('the canonical L still orders 49 long + 16 short = 65', r.total === 65, r.total + ' — ' + JSON.stringify(byLen(r)));

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
