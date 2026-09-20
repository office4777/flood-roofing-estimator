// Feedback report 57: "visual edits actually moved the building to scale —
//  I changed a gutter length measure and it moved the whole drawing. In
//  visual edits mode it should only change the measurements; it should
//  never move any lines, and an entered measure should never affect
//  anything else on the drawing."
//
// The hole: tapping a measure pill on a wall line opened "Set true length"
// and went straight to the true-measure solver, which stretches the outline
// — with no look at the edit mode. The other typed-measure paths (the line
// editor, the wall double-click, the sheet pill) already stopped in visual
// mode; this one did not. Now, in visual mode, the typed number lands on
// that line only: no corner moves, the scale stays, no other line changes,
// and the map is marked off scale. In scaled mode the wall still stretches.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report57.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1700,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });
await pg.waitForTimeout(400);

// Load the report's roof exactly as drawn, and type a new length on the
// bottom gutter by tapping its measure pill — the path the user took.
const typeOnGutter = (mode, metres) => pg.evaluate(([g, mode, metres]) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => JSON.parse(JSON.stringify(l)));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.roofType = 'gable';
  DRAW.offScale = null; DRAW.editMode = mode; DRAW.tool = 'select';
  redrawAll();
  const before = { outline: JSON.stringify(DRAW.outline), scale: DRAW.scaleMetresPerPx,
                   lines: DRAW.lines.map(l => l.measM) };
  const hits = (window._roofCanvasHits && window._roofCanvasHits.measures) || [];
  const gutter = DRAW.lines[0];
  const hit = hits.find(h => h.line === gutter);
  if (!hit) return { noHit: true, hits: hits.length };
  // The prompt answers at once with the typed number.
  window._styledPrompt = (opts, cb) => { window.__promptTitle = opts.title; cb(String(metres)); };
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const ev = { clientX: r.left + hit.x * dpr * r.width / cv.width, clientY: r.top + hit.y * dpr * r.height / cv.height };
  const handled = _roofCanvasHitMeasureLabel(ev);
  return { handled, title: window.__promptTitle, before,
           after: { outline: JSON.stringify(DRAW.outline), scale: DRAW.scaleMetresPerPx, lines: DRAW.lines.map(l => l.measM) },
           label: DRAW.lines[0].label, offScale: !!(DRAW.offScale && DRAW.offScale.reasons && DRAW.offScale.reasons.length),
           mode: DRAW.editMode };
}, [GEOM, mode, metres]);

// ── visual edits: the number, and only the number ────────────────
const v = await typeOnGutter('visual', 9.5);
check('the gutter pill is there to tap and the tap is handled', !v.noHit && v.handled, JSON.stringify({ noHit: v.noHit, handled: v.handled }));
check('in Visual edits the prompt says only this line changes', /this measurement/i.test(v.title || ''), v.title);
check('…the typed length lands on that gutter', v.after.lines[0] === 9.5 && v.label === '9.50m', v.after.lines[0] + ' / ' + v.label);
check('…NOT ONE corner of the outline moves', v.after.outline === v.before.outline, v.after.outline);
check('…and the scale is untouched', v.after.scale === v.before.scale, v.before.scale + ' → ' + v.after.scale);
check('…and no other line changes', v.before.lines.slice(1).every((m, i) => m === v.after.lines[i + 1]),
  JSON.stringify(v.after.lines));
check('…and the map is marked no longer to scale, still in visual mode', v.offScale && v.mode === 'visual');

// ── scaled edits: the wall still stretches, as designed ──────────
const s = await typeOnGutter('scaled', 9.5);
check('in Scaled edits the same tap stretches the wall to the typed length',
  s.handled && s.after.outline !== s.before.outline, s.after.outline === s.before.outline ? 'outline did not move' : 'outline moved');

// The solvers refuse outright in visual mode, whoever calls them.
const solver = await pg.evaluate(() => {
  DRAW.editMode = 'visual';
  const o = JSON.stringify(DRAW.outline);
  const a = _applyTrueEdgeMeasure(1, 7.0), b = _applySegmentTrueMeasure(1, DRAW.lines[0], 7.0);
  return { a, b, same: JSON.stringify(DRAW.outline) === o };
});
check('the true-measure solvers refuse in visual mode and move nothing', solver.a === false && solver.b === false && solver.same, JSON.stringify(solver));
check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
