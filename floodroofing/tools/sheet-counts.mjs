// Print the SHEETS TO ORDER groups the engine produces for the gate's key
// shapes (auto-generated hip roofs), so a counting change can be compared
// shape by shape before it is gated. node floodroofing/tools/sheet-counts.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ox = 140, oy = 140;
const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
const T = (cw, ch, sw, sh) => { const sx = ox + (cw-sw)/2; return [[ox,oy],[ox+cw,oy],[ox+cw,oy+ch],[sx+sw,oy+ch],[sx+sw,oy+ch+sh],[sx,oy+ch+sh],[sx,oy+ch],[ox,oy+ch]]; };
const CASES = [
  ['Canonical Big-L', L(300,300,900,700)],
  ['L Wide-wing', L(356,329,972,615)],
  ['L Narrow tall', L(220,460,900,640)],
  ['L Small wing', L(200,200,1000,820)],
  ['T-shape', T(900,260,300,460)],
  ['Simple hip 900x600', RECT(900,600)],
];
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + ROOT + '/frontend/app.html'); await pg.waitForTimeout(2800);
for (const [label, outline] of CASES) {
  const r = await pg.evaluate(({ outline }) => {
    DRAW.sheetPlanDeletedIds = []; DRAW.outline = outline; DRAW.outlineDone = true;
    DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 22; DRAW.lines = []; DRAW.roofs = []; DRAW.activeRoofIdx = -1;
    autoGenerateRoof('hip'); renderRoofSheetPlan();
    const g = ((window._lastSheetCounts || {}).groups || []).map(x => x.count + '×' + (x.orderedMm/1000).toFixed(2));
    const s = (window._lastSheetSections || []).map(x => (x.isPrimary ? 'MAIN ' : 'wing ') + x.perSide + '/side @' + (x.orderedMm/1000).toFixed(2) + (x.valleyExtra ? ' +' + x.valleyExtra : ''));
    const strips = (window.__lastAllStrips || []).filter(x => x.seq != null && !x.isOffcut).length;
    return { g, s, strips, total: ((window._lastSheetCounts || {}).groups || []).reduce((a, x) => a + x.count, 0) };
  }, { outline });
  console.log(label.padEnd(20), 'order', r.total, '[' + r.g.join(' ') + ']', ' sections:', r.s.join(' | '), ' strips:', r.strips);
}
await b.close();
