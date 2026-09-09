// The canvas view comes back the way it was left, on any screen — and a job
// with no saved view opens fitted to ALL its roofs, not zoomed into the one
// that happened to be active. Report 44: "when I loaded this job the canvas
// was zoomed in weird and I had to move the canvas to centre the roofs; it
// doesn't seem to save from when it's first centred to the next time."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Report 44's job: a hip main roof and a small second roof, the SECOND one active.
const GEOM = { scaleMetresPerPx: 0.02986233125621634, calPitch: 15, outlineDone: true,
  outline: [[843,1157],[843,1356],[1047,1356],[1047,1157]],
  lines: [{type:'apron',pts:[[843,1356],[1047,1356]]},{type:'barge',pts:[[1047,1356],[1047,1157]]},{type:'gutter',pts:[[1047,1157],[843,1157]]},{type:'barge',pts:[[843,1157],[843,1356]]}],
  roofs: [{ name:'Main Roof', outline:[[1229,1055],[1229,1259],[1187,1259],[1187,1504],[1538,1504],[1538,1055]], lines:[{type:'ridge',pts:[[1384,1210],[1384,1350]]}], calPitch:15 },
          { name:'Roof 2', outline:[[843,1157],[843,1356],[1047,1356],[1047,1157]], lines:[], calPitch:15 }],
  activeRoofIdx: 1 };

const b = await chromium.launch();
async function open(width){
  const ctx = await b.newContext({ viewport: { width, height: 950 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
    localStorage.setItem('fr_user', JSON.stringify({ email:'b@k.nz' })); localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} })); });
  await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove();
    try { document.getElementById('selectJobOverlay').style.display = 'none'; document.getElementById('selectJobModal').style.display = 'none'; } catch(e){} });
  return { ctx, pg };
}
// Where every corner of every roof lands on the canvas, in CSS px.
const corners = pg => pg.evaluate(() => {
  const cv = document.getElementById('roofCanvas'), dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  const t = getImgTransform(); const pts = [];
  (DRAW.roofs || []).forEach(r => (r.outline || []).forEach(p => pts.push(imgToCanvas(p, t))));
  (DRAW.outline || []).forEach(p => pts.push(imgToCanvas(p, t)));
  return { W, H, zoom: DRAW.zoom, inside: pts.every(p => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H), n: pts.length,
    centre: (function(){ const c = canvasToImg([W / 2, H / 2], t); return [Math.round(c[0]), Math.round(c[1])]; })() };
});

// ── no saved view: fitted to every roof, on open ─────────────────
let o = await open(1400);
await o.pg.evaluate((g) => { restoreFromJob({ id: 'j1', client_name: 'R', updated_at: '2026-09-09T00:00:00Z', draw_state: { draw: g } }); gotoTab('roof'); }, GEOM);
await o.pg.waitForTimeout(1200);
let v = await corners(o.pg);
check('a job with no saved view opens with every roof on the canvas', v.inside && v.n >= 10, JSON.stringify(v));
check('…not zoomed to the maximum into the active roof', v.zoom < 4.5, 'zoom ' + v.zoom);

// ── the view is saved as a world point ───────────────────────────
await o.pg.evaluate(() => { S.jobLocked = false; DRAW.zoom = 2.2; IMG_OFFSET.x = 0; IMG_OFFSET.y = 0;
  const cv = document.getElementById('roofCanvas'), dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  const t = getImgTransform(); const at = imgToCanvas([1229, 1259], t); IMG_OFFSET.x = W / 2 - at[0]; IMG_OFFSET.y = H / 2 - at[1]; redrawAll(); });
const saved = await o.pg.evaluate(() => snapshotCurrentJob().draw.view);
check('the save carries the zoom and the world point under the centre', !!saved && Math.abs(saved.zoom - 2.2) < 0.01 && Math.abs(saved.cx - 1229) < 1 && Math.abs(saved.cy - 1259) < 1, JSON.stringify(saved));
await o.ctx.close();

// ── and comes back centred on a different screen ─────────────────
o = await open(1000);
await o.pg.evaluate((g) => { restoreFromJob({ id: 'j1', client_name: 'R', updated_at: '2026-09-09T00:00:00Z', draw_state: { draw: Object.assign({}, g, { view: { zoom: 2.2, cx: 1229, cy: 1259 } }) } }); gotoTab('roof'); }, GEOM);
await o.pg.waitForTimeout(1200);
v = await corners(o.pg);
check('opened on a narrower screen, the saved view comes back at its zoom', Math.abs(v.zoom - 2.2) < 0.01, 'zoom ' + v.zoom);
check('…with the same world point under the centre of the canvas', Math.abs(v.centre[0] - 1229) <= 1 && Math.abs(v.centre[1] - 1259) <= 1, JSON.stringify(v.centre));

// ── with an aerial, the view waits for the picture ───────────────
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC';
await o.pg.evaluate(({ g, png }) => { restoreFromJob({ id: 'j2', client_name: 'R', updated_at: '2026-09-09T00:00:00Z', draw_state: { draw: Object.assign({}, g, { bg: png, bgW: 10, bgH: 10, view: { zoom: 1.5, cx: 1300, cy: 1300 } }) } }); gotoTab('roof'); }, { g: GEOM, png: PNG });
await o.pg.waitForTimeout(1500);
v = await corners(o.pg);
check('with an aerial on the job, the saved view is applied once the picture has loaded', Math.abs(v.zoom - 1.5) < 0.01 && Math.abs(v.centre[0] - 1300) <= 1 && Math.abs(v.centre[1] - 1300) <= 1, JSON.stringify({ zoom: v.zoom, centre: v.centre, bg: await o.pg.evaluate(() => !!DRAW.bgImg) }));
await o.ctx.close();

// ── report 48: a save made before Map Roof was shown keeps the saved view ─
// The job was opened from Home, unlocked (which saves), and only then was
// Map Roof opened — zoomed to a corner at 100%. The unlock's save had read
// the framing of a canvas nobody had looked at and written it over the view
// the roofer left. A view that has not been applied yet is still the view.
o = await open(1400);
await o.pg.evaluate(({ g, png }) => { gotoTab('home'); restoreFromJob({ id: 'j3', client_name: 'R', updated_at: '2026-09-09T00:00:00Z', draw_state: { draw: Object.assign({}, g, { bg: png, bgW: 10, bgH: 10, view: { zoom: 1.5, cx: 1300, cy: 1300 } }) } }); S.jobLocked = false; }, { g: GEOM, png: PNG });
await o.pg.waitForTimeout(800);
const early = await o.pg.evaluate(() => snapshotCurrentJob().draw.view);
check('a save made before Map Roof is shown carries the view the roofer left, not a blind one',
  !!early && Math.abs(early.zoom - 1.5) < 0.01 && Math.abs(early.cx - 1300) <= 1 && Math.abs(early.cy - 1300) <= 1, JSON.stringify(early));
await o.pg.evaluate(() => gotoTab('roof'));
await o.pg.waitForTimeout(1500);
v = await corners(o.pg);
check('…and Map Roof then opens on that view', Math.abs(v.zoom - 1.5) < 0.01 && Math.abs(v.centre[0] - 1300) <= 1 && Math.abs(v.centre[1] - 1300) <= 1, JSON.stringify({ zoom: v.zoom, centre: v.centre }));
// Off the roof tab again, the save still says what was last on screen.
await o.pg.evaluate(() => gotoTab('quote'));
await o.pg.waitForTimeout(600);
const later = await o.pg.evaluate(() => snapshotCurrentJob().draw.view);
check('…and a save from another tab afterwards still says what was last on screen',
  !!later && Math.abs(later.zoom - 1.5) < 0.01 && Math.abs(later.cx - 1300) <= 2 && Math.abs(later.cy - 1300) <= 2, JSON.stringify(later));
await o.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
