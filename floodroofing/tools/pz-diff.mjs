// Lay every tests/fixtures-*.json (as sheet-shots does) with a switch off and
// on and print each tally that moves. node floodroofing/tools/pz-diff.mjs "window.__PZ_X"
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
const ROOT = '/home/user/flood-roofing-estimator/floodroofing';
const SW = process.argv[2] || 'window.__PZ_LONGEST_TMPL';
const files = readdirSync(ROOT + '/tests').filter(f => /^fixtures-.*\.json$/.test(f)).sort();
const b = await chromium.launch();
for (const f of files){
  let G; try { G = JSON.parse(readFileSync(ROOT + '/tests/' + f, 'utf8')); } catch(e){ continue; }
  if (!G.outline && !(G.roofs && G.roofs.length)) continue;
  const pg = await (await b.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
  await pg.goto('file://' + ROOT + '/frontend/app.html'); await pg.waitForTimeout(2500);
  const r = await pg.evaluate(([g, sw]) => {
    try {
      DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch; DRAW.lowPitch = g.lowPitch || 0;
      DRAW.outline = (g.outline || []).map(p => p.slice()); DRAW.outlineDone = true;
      DRAW.lines = (g.lines || []).map(l => Object.assign({}, l));
      DRAW.roofs = (g.roofs || []).map(r => Object.assign({}, r, { lines: (r.lines || []).map(l => Object.assign({}, l)) }));
      DRAW.activeRoofIdx = DRAW.roofs.length ? (g.activeRoofIdx || 0) : -1; DRAW.showAllRoofs = true;
      DRAW.roofType = g.autoType || g.roofType || 'hip';
      if (g.autoType && !(g.lines || []).length && !DRAW.roofs.length){ try { autoGenerateRoof(g.autoType); } catch (e) {} }
      if (DRAW.roofs.length && DRAW.roofs.some(r => r.autoType && !(r.lines || []).length)){
        DRAW.roofs.forEach((r, i) => { if (!r.autoType || (r.lines || []).length) return; _loadRoofToCurrent(i); DRAW.roofType = r.autoType; try { autoGenerateRoof(r.autoType); } catch (e) {} _syncCurrentToRoof(); });
        _loadRoofToCurrent(g.activeRoofIdx || 0); DRAW.showAllRoofs = true;
      }
      (g.extraLines || []).forEach(l => DRAW.lines.push(Object.assign({}, l)));
      if (DRAW.roofs.length) _syncCurrentToRoof();
      window.__PZ_NO_CACHE = true;
      const T = () => { const z = _sheetPuzzleBuild({}); return z.tally.map(x => x.count + 'x' + x.Lmm).join(' ') + ' | ' + z.tally.reduce((t, x) => t + x.count, 0) + ' / ' + (z.tally.reduce((t, x) => t + x.count * x.Lmm, 0) / 1000).toFixed(1) + 'm'; };
      (0, eval)(sw + ' = false'); const off = T();
      (0, eval)(sw + ' = true'); const on = T();
      return { off, on };
    } catch(e){ return { err: e.message }; }
  }, [G, SW]);
  console.log((r.err ? 'ERR ' : (r.off === r.on ? 'same ' : 'MOVED')) + ' ' + f + (r.err ? ' ' + r.err : (r.off === r.on ? '' : '\n   off: ' + r.off + '\n   on:  ' + r.on)));
  await pg.context().close();
}
await b.close();
