// Feedback report 50: an inverted-T hip roof with three PARALLEL ridges.
// The sheet calculation check drew the main's sheets ninety degrees round
// and ordered 13 × 4.34 m + 36 shorts. The office counts it:
//   main   across the 2.94 m ridge: 8.38 m gutter ÷ 0.762 = 11 a side,
//          22 + 1 valley spare = 23 @ 2.82 m
//   wings  west 2.68 m → 4 a side (8), east 2.14 m → 3 a side (6) = 14 @ 1.40 m
// "Always start with the longest sheets; the area with the longest sheet
// is turned into a square, then work down from there."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report50.json'), 'utf8'));
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
const r = await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.roofType = 'hip';
  DRAW.sheetPlanDeletedIds = []; DRAW.sheetGroupQtyOverrides = {}; DRAW.sheetGroupOverrides = {};
  const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
  renderRoofSheetPlan();
  const secs = (window._lastSheetSections || []).map(s => ({
    main: !!s.isPrimary, perSide: s.perSide, total: s.total, mm: s.orderedMm, spare: s.valleyExtra || 0,
    // sheet direction = ACROSS the ridge: the ridge direction is rdir
    rdirX: Math.abs(s.rdir[0]), rdirY: Math.abs(s.rdir[1]),
  }));
  const groups = ((window._lastSheetCounts || {}).groups || []).map(g => ({ mm: g.orderedMm, count: g.count }));
  const strips = (window.__lastAllStrips || []);
  return { secs, groups, stripCount: strips.filter(s => s.seq != null && !s.isOffcut).length,
           cookie: strips.length > 0 && strips.every(s => /^cc\|/.test(String(s._id || ''))) };
}, GEOM);

const main = r.secs.find(s => s.main) || {};
const wings = r.secs.filter(s => !s.main);
check('the main runs ACROSS the 2.94 m ridge (ridge is east–west)',
  main.rdirX > 0.99 && main.rdirY < 0.01, JSON.stringify([main.rdirX, main.rdirY]));
check('…11 sheets a side off the 8.38 m gutter, not 12 for the last millimetre',
  main.perSide === 11, main.perSide + ' a side');
check('…22 + 1 valley spare = 23', main.total === 23 && main.spare === 1, main.total + ' (+' + main.spare + ')');
check('…at 2.8 m', Math.abs(main.mm - 2820) < 40, main.mm + ' mm');
check('the two wings are 4 a side and 3 a side',
  wings.map(w => w.perSide).sort().join(',') === '3,4', wings.map(w => w.perSide).join(','));
check('…at 1.4 m', wings.every(w => Math.abs(w.mm - 1400) < 40), wings.map(w => w.mm).join(','));
const byMm = {}; r.groups.forEach(g => { byMm[Math.round(g.mm / 100)] = (byMm[Math.round(g.mm / 100)] || 0) + g.count; });
check('SHEETS TO ORDER says 23 long and 14 short', byMm[28] === 23 && byMm[14] === 14, JSON.stringify(r.groups));
check('the total is 37', r.groups.reduce((a, g) => a + g.count, 0) === 37);
check('the layout diagram is cut from those sections, not the cascade\'s diagonal triangles',
  r.cookie, r.stripCount + ' strips, cookie=' + r.cookie);
check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
