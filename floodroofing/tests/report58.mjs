// Feedback report 58 (2026-09-25), on the owner's broken-ridge roof
// (fixtures-report58.json): "it's missing short sheets in the top left corner
// at the length of the 5.34 m barge, also the orange sheets 1 & 2 should be
// longer to extend that 0.45 m step. Also make the roof lines show over the
// sheet lines … I can't see the ridge lines. Also the short 1.64 m gutter
// should actually be a head barge not a gutter. Change the double arrow sheet
// measures to a single arrow always pointing at the gutter." And, with it:
// "when I hover over the broken ridge can it show the mouse arrows symbol …
// the sides of that broken ridge do the same but pointing the way it moves".
//
// The roof is re-built the way the app builds it — the outline, a straight
// gable, the same broken section — and the fault reproduced first: the
// report's order was 6.95×6, 6.46×17, 6.01×6, 5.59×5 with nothing for the
// top-left block.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const G = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report58.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);

const r = await pg.evaluate((g) => {
  gotoTab('roof'); clearAll(true);
  DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true; DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = 0;
  DRAW.roofBaseHoriz = true; DRAW.roofType = 'gable'; DRAW.rotation = 0;
  autoGenerateRoof('gable', 0);
  DRAW.ridgeBreaks = [{ a: (588-280)/755, b: (800-280)/755, off: (490-446.5)/323.5 }];
  regenerateAutoRoofLines('gable'); autoCalcLineMeasurements();
  const find = (f) => DRAW.lines.filter(f).map(l => ({ pts: l.pts.map(p => p.map(Math.round)), m: l.measM }));
  renderRoofSheetPlan();
  const g2 = (window._lastSheetCounts || {}).groups || {};
  const groups = {}; let total = 0;
  Object.keys(g2).forEach(k => { groups[g2[k].orderedMm] = (groups[g2[k].orderedMm] || 0) + g2[k].count; total += g2[k].count; });
  const secs = (window._lastSheetSections || []);
  return {
    headBarge: find(l => l.type === 'barge' && l.subtype === 'head'),
    gutterAt390: find(l => l.type === 'gutter' && Math.round(l.pts[0][1]) === 390 && Math.round(l.pts[1][1]) === 390).length,
    groups, total,
    topLeft: secs.filter(s => Math.round(s.obU0) < 300).map(s => ({ mm: s.orderedMm, n: s.perSide, v: [Math.round(s.obV0), Math.round(s.obV1)] })),
    ridgeOnCheck: secs.length > 0 && secs.every(s => (s.roofLines || []).some(l => l.type === 'ridge')),
    headOnCheck: secs.some(s => (s.roofLines || []).some(l => l.type === 'apron')),
  };
}, G);
check('the 1.64 m edge beside the ridge’s end is a HEAD BARGE, not a gutter — and measured level', r.headBarge.length === 1 && JSON.stringify(r.headBarge[0].pts) === '[[280,390],[365,390]]' && r.headBarge[0].m === 1.64 && r.gutterAt390 === 0, JSON.stringify(r.headBarge));
check('the top-left block gets its short sheets: 3 at the barge’s length, gutter up to the head barge', r.topLeft.length === 1 && r.topLeft[0].n === 3 && r.topLeft[0].v[0] === 123 && r.topLeft[0].v[1] === 390 && Math.abs(r.topLeft[0].mm - 5330) < 60, JSON.stringify(r.topLeft));
check('the orange sheets over the 0.45 m step are longer to reach it (2 of them), the rest of the section as before', r.groups[7324] === 2 && r.groups[6885] === 4 && !r.groups[6953], JSON.stringify(r.groups));
check('…and nothing else moved: 17 at 6.46, 6 at 6.02, 5 at 5.59 — 37 in all (was 34, the 3 were missing)', r.groups[6456] === 17 && r.groups[6017] === 6 && r.groups[5588] === 5 && r.total === 37, JSON.stringify({ groups: r.groups, total: r.total }));
check('the Sheet calc check draws the roof’s own lines — the ridge and the broken section — over the columns', r.ridgeOnCheck && r.headOnCheck, JSON.stringify({ ridge: r.ridgeOnCheck, head: r.headOnCheck }));

// ── one arrow each, downhill ──
const ar = await pg.evaluate(() => {
  try { fitDrawingToCanvas(); } catch(e){}
  redrawAll();
  const t = getImgTransform(), hits = (window._roofCanvasHits || {}).sheets || [];
  return hits.filter(h => h.downhill).map(h => ({ y: Math.round((h.y - t.iy) / t.s), dy: Math.sign(Math.round(h.downhill[1] * 100)), label: h.label }));
});
const up = ar.filter(a => a.y < 447), dn = ar.filter(a => a.y > 500);
check('every sheet measure has ONE arrow, pointing downhill at its gutter — up above the ridge, down below it', ar.length >= 6 && up.length && dn.length && up.every(a => a.dy < 0) && dn.every(a => a.dy > 0), JSON.stringify(ar));

const upL = ar.filter(a => a.y < 447).map(a => a.label).sort();
check('the map’s runs are this roof’s: 6.24 m ridge-to-gutter over the left ridge (it borrowed the corner block’s 5.34 m barge), 7.07 and 6.65 over the section, 6.02 on the right', ['6.02m', '6.24m', '6.65m', '7.07m'].every(x => upL.includes(x)) && !upL.includes('5.34m'), JSON.stringify(upL));

check('the corner block’s sheets are measured on the map too — 5.33 m (its 3 sheets’ length), from its head barge down to its gutter', ar.filter(a => a.label === '5.33m' && a.dy < 0).length === 1 && ar.some(a => a.label === '6.24m'), JSON.stringify(ar.map(a => a.label)));

// ── hover arrows on the broken ridge ──
const pos = await pg.evaluate(() => {
  setTool('select');
  document.getElementById('roofCanvas').scrollIntoView({ block: 'start' });
  const cv = document.getElementById('roofCanvas'), rc = cv.getBoundingClientRect(), t = getImgTransform(), dpr = window.devicePixelRatio || 1;
  const toClient = (p) => [rc.left + (p[0] * t.s + t.ix) * (rc.width / (cv.width / dpr)), rc.top + (p[1] * t.s + t.iy) * (rc.height / (cv.height / dpr))];
  return { mid: toClient([700, 490]), end: toClient([588, 470]), ridge: toClient([470, 447]) };
});
const cursorAt = async (p) => { await pg.mouse.move(p[0] + 30, p[1] + 60); await pg.mouse.move(p[0], p[1]); await pg.waitForTimeout(80); return pg.evaluate(() => document.getElementById('roofCanvas').style.cursor); };
const cur = { ridge: await cursorAt(pos.ridge), mid: await cursorAt(pos.mid), end: await cursorAt(pos.end) };
check('hovering the broken section shows the up-down arrows it moves by, like the ridge', cur.mid === 'ns-resize' && cur.ridge === 'ns-resize', JSON.stringify(cur));
check('…and hovering an end shows left-right arrows — it slides along the ridge', cur.end === 'ew-resize', JSON.stringify(cur));

// ── a report carries what rebuilds the roof ──
const pay = await pg.evaluate(() => { const g = _roofGeometryPayload(); return { breaks: (g.ridgeBreaks || []).length, type: g.roofType, chain: (g.lines || []).some(l => l.ridgeChain), mid: (g.lines || []).some(l => l.breakRole === 'mid') }; });
check('a feedback report now carries the roof type, the breaks and the lines’ flags', pay.breaks === 1 && pay.type === 'gable' && pay.chain && pay.mid, JSON.stringify(pay));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
