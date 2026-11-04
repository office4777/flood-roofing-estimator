// THE ROOF PITCH PLATE (2026-11-05, the owner with a picture of his 15° plate
// sitting on the ridge's own 16.26m measure: "the roof pitch always goes
// straight over top of usually a ridge measure, put it off to the side, also
// allow me to click to delete it, also in the 'edit font size' add a tick box
// to 'show roof pitch' which adds or deletes the roof pitch on all roofs").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1500, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? '{"branding":{"company_name":"Flood Roofing"}}' : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// His two roofs: a 15° gable with its ridge running down the middle, and a 10° lean-to above it.
await pg.evaluate(async () => {
  gotoTab('roof'); await new Promise(r => setTimeout(r, 300));
  DRAW.scaleMetresPerPx = 0.0447; DRAW.calPitch = 15;
  DRAW.outline = [[300,300],[300,620],[680,620],[680,300]]; DRAW.outlineDone = true; DRAW.lines = [];
  DRAW.rotation = 0; DRAW.roofType = 'gable';
  autoGenerateRoof('gable', 90); DRAW.rotation = 90;
  try { autoCalcLineMeasurements(); } catch(e){}
  try { _syncCurrentToRoof(); } catch(e){}
  setTool('select'); redrawAll();
});
await pg.waitForTimeout(400);

const state = () => pg.evaluate(() => {
  const H = window._roofCanvasHits || {};
  const pl = (H.pitch || []).map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, roof: p.roofIdx }));
  const over = pl.map(p => (H.measures || []).concat(H.sheets || []).filter(m =>
    Math.abs(p.x - m.x) < (p.w + m.w) / 2 && Math.abs(p.y - m.y) < (p.h + m.h) / 2).length);
  const t = getImgTransform();
  const ridge = (DRAW.lines.find(l => l.type === 'ridge') || {}).pts;
  const rs = ridge ? ridge.map(q => imgToCanvas(q, t)) : null;
  const onRidge = (rs && pl[0]) ? (Math.abs(rs[0][0] - pl[0].x) <= pl[0].w / 2 && pl[0].y >= Math.min(rs[0][1], rs[1][1]) && pl[0].y <= Math.max(rs[0][1], rs[1][1])) : null;
  const ctr = imgToCanvas([490, 460], t);
  return { pl, over, onRidge, ctr, ridgeX: rs && rs[0][0] };
});
let v = await state();
check('the plate is drawn', v.pl.length === 1, JSON.stringify(v.pl));
check('…over no measure and no sheet label (the ridge\'s 16.26m among them)', v.over[0] === 0, JSON.stringify(v));
check('…and off the ridge line itself', v.onRidge === false, JSON.stringify(v));
check('…off to the side of the ridge, near the middle of the roof', Math.abs(v.pl[0].y - v.ctr[1]) < 3 * v.pl[0].h && Math.abs(v.pl[0].x - v.ridgeX) > v.pl[0].w / 2, JSON.stringify(v));

// A click on it (no drag) offers Remove
await pg.evaluate(() => document.getElementById('roofCanvas').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(150);
const pt = await pg.evaluate(() => { const H = window._roofCanvasHits.pitch[0]; const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect();
  return [r.left + H.x * r.width / (cv.width / devicePixelRatio), r.top + H.y * r.height / (cv.height / devicePixelRatio)]; });
await pg.mouse.click(pt[0], pt[1]); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ pop: !!document.getElementById('pitchPlatePop'), txt: (document.getElementById('pitchPlatePop') || {}).textContent || '' }));
check('a click on the plate opens "Roof pitch 15° — Remove from map"', v.pop && /15°/.test(v.txt) && /Remove from map/.test(v.txt), v.txt);
await pg.click('#pitchPlateDel'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ off: !!(DRAW.pitchLabel && DRAW.pitchLabel.off), plates: (window._roofCanvasHits.pitch || []).length, pitch: DRAW.calPitch, pop: !!document.getElementById('pitchPlatePop') }));
check('Remove takes the plate off this roof, and leaves the pitch itself alone', v.off && v.plates === 0 && v.pitch === 15 && !v.pop, JSON.stringify(v));

// A second roof, then the tick in Canvas view
await pg.evaluate(() => {
  const r0 = { name:'Main Roof', outline: DRAW.outline.map(p => p.slice()), lines: JSON.parse(JSON.stringify(DRAW.lines)),
    calPitch: DRAW.calPitch, outlineDone: true, pitchLabel: DRAW.pitchLabel, roofType: DRAW.roofType, rotation: DRAW.rotation };
  DRAW.roofs = [r0, { name:'Roof 2', outline:[[700,200],[700,290],[900,290],[900,200]], lines:[], calPitch:10, outlineDone:true, pitchLabel:{ dx:0, dy:0 } }];
  DRAW.activeRoofIdx = -1; _loadRoofToCurrent(0); redrawAll();
});
await pg.waitForTimeout(200);
await pg.evaluate(() => toggleViewMenu()); await pg.waitForTimeout(100);
v = await pg.evaluate(() => ({ tick: !!document.getElementById('viewShowPitch'), on: document.getElementById('viewShowPitch').checked,
  label: (document.getElementById('viewShowPitch').closest('label') || {}).textContent || '' }));
check('Canvas view (Edit font size) carries a "Show roof pitch" tick, ticked while any roof shows one', v.tick && v.on && /Show roof pitch/.test(v.label), JSON.stringify(v));
await pg.click('#viewShowPitch'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ plates: (window._roofCanvasHits.pitch || []).length, off: DRAW.roofs.map((r, i) => !!((i === DRAW.activeRoofIdx ? DRAW : r).pitchLabel || {}).off) }));
check('unticked, every roof\'s plate goes', v.plates === 0 && v.off.every(Boolean), JSON.stringify(v));
await pg.click('#viewShowPitch'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ plates: (window._roofCanvasHits.pitch || []).length, n: DRAW.roofs.length }));
check('ticked again, every roof\'s plate comes back (the one removed by hand included)', v.plates === v.n && v.n === 2, JSON.stringify(v));

// A drag still moves it rather than opening the pop-up
await pg.evaluate(() => { closeViewMenu(); document.getElementById('roofCanvas').scrollIntoView({ block: 'center' }); }); await pg.waitForTimeout(150);
const p2 = await pg.evaluate(() => { const H = window._roofCanvasHits.pitch[0]; const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect();
  return [r.left + H.x * r.width / (cv.width / devicePixelRatio), r.top + H.y * r.height / (cv.height / devicePixelRatio), H.roofIdx]; });
await pg.mouse.move(p2[0], p2[1]); await pg.mouse.down(); await pg.mouse.move(p2[0] + 30, p2[1] + 20, { steps: 5 }); await pg.mouse.up(); await pg.waitForTimeout(250);
v = await pg.evaluate((ri) => { const r = (ri === DRAW.activeRoofIdx) ? DRAW : DRAW.roofs[ri]; return { lbl: r.pitchLabel, pop: !!document.getElementById('pitchPlatePop') }; }, p2[2]);
check('a drag still moves the plate, with no pop-up', v.lbl && (v.lbl.dx || v.lbl.dy) && !v.pop, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
