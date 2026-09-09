// "The quote's aerial photos keep moving when I click to a different tab and
//  back — and the placement on page 2 affects the last page and vice versa."
//
// Two causes. The quote re-read the canvas framing on every render, and the
// canvas is re-laid-out whenever a tab or side panel opens — so leaving the
// quote and coming back moved the picture. And the two frames (page 2, the
// accept page) shared one placement. The framing is now read from the canvas
// only when the office actually zooms, pans or turns it; each frame keeps its
// own placement.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(async ({ g, png }) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15; S.quote.client = 'R';
  await new Promise(res => { const im = new Image(); im.onload = () => { _applyCanvasBg(im); res(); }; im.src = png; });
  gotoTab('roof'); DRAW.tool = 'select'; try { fitDrawingToCanvas(); } catch(e){}
  DRAW._viewTouched = false;
}, { g: GEOM, png: PNG });
await pg.waitForTimeout(600);

const frame = () => pg.evaluate(() => { const g = S.quote.roofMapGeom; return g && g.view ? JSON.stringify(g.view) : null; });
await pg.evaluate(() => { gotoTab('quote'); refreshQuoteProposal(); });
await pg.waitForTimeout(900);
const v1 = await frame();
check('the quote frames the photo the way the canvas shows it', !!v1, v1);

// Leave for the roof tab (the canvas is re-laid-out) and come back.
await pg.evaluate(() => { gotoTab('roof'); });
await pg.waitForTimeout(500);
await pg.evaluate(() => { const cv = document.getElementById('roofCanvas'); cv.style.width = '640px'; fitCanvasToWrap(); });
await pg.waitForTimeout(300);
await pg.evaluate(() => { gotoTab('quote'); refreshQuoteProposal(); });
await pg.waitForTimeout(900);
const v2 = await frame();
check('THE FIX: switching tabs (and the canvas changing size underneath) leaves the quote’s framing alone', v2 === v1, v2 + ' vs ' + v1);

// A deliberate change on the canvas DOES reach the quote.
await pg.evaluate(() => { gotoTab('roof'); adjustZoom(0.5); });
await pg.waitForTimeout(300);
await pg.evaluate(() => { gotoTab('quote'); refreshQuoteProposal(); });
await pg.waitForTimeout(900);
const v3 = await frame();
check('…while zooming the canvas on purpose re-frames the quote', v3 !== v2, v3);
await pg.evaluate(() => { refreshQuoteProposal(); });
await pg.waitForTimeout(600);
check('…once, then it holds again', (await frame()) === v3);

// ── page 2 and the accept page keep their own placement ──
const per = await pg.evaluate(() => {
  _qpRoofMapViewSet({ offX: 40, offY: -12, zoom: 1.3 }, 'main');
  const acceptBefore = _qpRoofMapView('accept');
  _qpRoofMapViewSet({ offX: -70, zoom: 0.8 }, 'accept');
  const main = _qpRoofMapView('main'), accept = _qpRoofMapView('accept');
  refreshQuoteProposal();
  const frames = Array.from(document.querySelectorAll('.qp-map-frame')).map(f => ({ key: f.getAttribute('data-map-key'), t: (f.querySelector('.qp-map-inner') || {}).style.transform }));
  return { acceptBefore, main, accept, frames };
});
check('the accept page starts from page 2’s placement', per.acceptBefore.offX === 40 && per.acceptBefore.zoom === 1.3, JSON.stringify(per.acceptBefore));
check('THE FIX: moving the picture on the accept page leaves page 2 where it was', per.main.offX === 40 && per.main.zoom === 1.3 && per.accept.offX === -70 && per.accept.zoom === 0.8, JSON.stringify({ main: per.main, accept: per.accept }));
const fMain = per.frames.find(f => f.key === 'main'), fAcc = per.frames.find(f => f.key === 'accept');
check('…and each frame on the page renders its own', !!fMain && !!fAcc && /40px/.test(fMain.t) && /-70px/.test(fAcc.t) && /0\.8/.test(fAcc.t), JSON.stringify(per.frames));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
