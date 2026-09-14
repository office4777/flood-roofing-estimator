// Render one roof geometry (a feedback-report fixture) the way the Job Pack
// does and write PNGs of the sheet layout, the sheet calculation check and
// the cut list, so a change to the sheet engine can be LOOKED AT before it
// is gated. node floodroofing/tools/sheet-shots.mjs <fixture.json> <outdir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [fixture, outDir] = process.argv.slice(2);
if (!fixture || !outDir) { console.error('usage: sheet-shots.mjs <fixture.json> <outdir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const GEOM = JSON.parse(readFileSync(fixture, 'utf8'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't');
  localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + ROOT + '/frontend/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = (g.roofs || []).map(r => Object.assign({}, r, { lines: (r.lines || []).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx || 0; DRAW.showAllRoofs = true;
  // An outline-only fixture: let the app draw the roof lines itself.
  if (g.autoType && !(g.lines || []).length) { DRAW.activeRoofIdx = -1; try { autoGenerateRoof(g.autoType); } catch (e) {} }
  try { redrawAll(); } catch (e) {}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3500);
const dump = async (kind, name) => {
  const u = await pg.evaluate(k => _jpCaptureCombined(k, {}), kind);
  if (u && u.startsWith('data:image/png')) writeFileSync(join(outDir, name + '.png'), Buffer.from(u.split(',')[1], 'base64'));
  else console.log('no capture for', kind);
};
await dump('sheetplan', 'sheet-layout');
await dump('calccheck', 'calc-check');
// The cut list page of the job pack.
const cut = await pg.evaluate(() => {
  const el = [...document.querySelectorAll('.jp-block-title')].find(t => /Cut lists/i.test(t.textContent));
  return el ? true : false;
});
const pageEl = pg.locator('.jp-block-title', { hasText: 'Cut lists' }).first();
if (await pageEl.count()) {
  const card = pageEl.locator('xpath=ancestor::*[contains(@class,"jp-page")][1]');
  const target = (await card.count()) ? card : pageEl.locator('xpath=..');
  await target.screenshot({ path: join(outDir, 'cut-list.png') }).catch(async () => {
    await pg.screenshot({ path: join(outDir, 'cut-list.png'), fullPage: true });
  });
}
// The numbers, for the log.
const counts = await pg.evaluate(() => ({
  groups: (window._lastSheetCounts && window._lastSheetCounts.groups) || [],
  sections: (window._lastSheetSections || []).map(s => ({ roof: s.roof, colour: s.color, isPrimary: s.isPrimary,
    mono: !!s.mono, perSide: s.perSide, total: s.total, orderedMm: s.orderedMm, valleyExtra: s.valleyExtra || 0 })),
}));
console.log(JSON.stringify(counts, null, 1));
if (errs.length) console.log('PAGE ERRORS:', errs.join(' | '));
await b.close();
