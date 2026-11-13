// Lay a fixture several ways and print each tally: the default, the area lay
// (rule 3b), the area rule switched on, and the first lay alone (_noAlt).
// node floodroofing/tools/pz-probe.mjs <fixture.json>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const ROOT = '/home/user/flood-roofing-estimator/floodroofing';
const G = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + ROOT + '/frontend/app.html'); await pg.waitForTimeout(2800);
console.log(JSON.stringify(await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true; DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
  if (g.autoType && !(g.lines || []).length) { try { autoGenerateRoof(g.autoType); } catch (e) {} }
  redrawAll();
  window.__PZ_NO_CACHE = true;
  const sum = z => ({ n: z.tally.reduce((t, x) => t + x.count, 0), m: +(z.tally.reduce((t, x) => t + x.Lmm * x.count, 0) / 1000).toFixed(1), tally: z.tally.map(x => x.count + 'x' + x.Lmm).join(' '), lay: z._lay || null, rectMain: !!z.rectMain,
    breaks: (typeof _pzBreaks === 'function') ? (function(){ try { return _pzBreaks(z); } catch(e){ return null; } })() : null });
  const out = { def: sum(_sheetPuzzleBuild({ roofIdxs: [-1] })), area: sum(_sheetPuzzleBuild({ roofIdxs: [-1], rectArea: true })) };
  window.__PZ_LONGEST_RECT = false; out.areaRule = sum(_sheetPuzzleBuild({ roofIdxs: [-1] })); window.__PZ_LONGEST_RECT = null;
  out.longOnly = sum(_sheetPuzzleBuild({ roofIdxs: [-1], _noAlt: true }));
  return out;
}, G), null, 1));
await b.close();
