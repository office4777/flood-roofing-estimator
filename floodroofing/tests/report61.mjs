// Feedback report 61 (2026-10-01): "this real life roof has a hip end at one
// end, and a gable end at the other end ... when a barge or hip line is
// selected, inside the popup window box add an option to convert it to the
// opposite end". Pinned on the report's own roof (a 6.21 m straight gable):
//   • a selected gable-end barge offers "Convert this gable end to a hip end";
//     pressed, that end loses its barges, its wall becomes a gutter, the ridge
//     stops short by the run and two hips run up from the corners — the other
//     end untouched;
//   • a selected hip on that end offers the way back, and the roof is exactly
//     the gable it was;
//   • it survives a corner drag, Undo puts it back, it is saved per roof;
//   • a plain hip roof's hip offers "Convert this hip end to a gable end" —
//     the roof becomes a gable with the OTHER end still hipped;
//   • a dog-leg's end converts the same way;
//   • the sheet count is unchanged (the hip end is cut from the same sheets).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const R60 = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report60.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_shift_tip_off','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// The report's roof: a 131 × 65 px rectangle at 0.0477 m/px, straight gable.
const OUTLINE = [[350,221],[350,286],[219,286],[219,221]];
const setup = (type) => pg.evaluate(([ol, type]) => {
  gotoTab('roof'); try { _fergusPanelClose(); } catch(e){}
  clearAll(true);
  DRAW.scaleMetresPerPx = 0.04767303024022914; DRAW.calPitch = 15;
  DRAW.outline = ol.map(p => p.slice()); DRAW.outlineDone = true; DRAW.lines = [];
  DRAW.roofs = [Object.assign(_newEmptyRoof('Main Roof'), { outline: DRAW.outline })]; DRAW.activeRoofIdx = 0;
  DRAW.roofType = type; DRAW.roofBaseHoriz = true;
  autoGenerateRoof(type, 0); try { autoCalcLineMeasurements(); } catch(e){}
  _syncCurrentToRoof(); redrawAll();
}, [OUTLINE, type]);
const lines = () => pg.evaluate(() => DRAW.lines.map(l => ({ t: l.type, sub: l.subtype || '', he: l.hipEnd || '', p: l.pts.map(q => q.map(v => Math.round(v * 10) / 10)) })));
const select = (pred) => pg.evaluate((src) => {
  const f = new Function('l', 'return (' + src + ')(l)');
  const i = DRAW.lines.findIndex(l => f(l)); if (i < 0) return null;
  DRAW.selectedLine = i; showLineEditor(i);
  const box = document.getElementById('ridgeBreakBox'), btn = document.getElementById('hipEndBtn');
  return { i, shown: !!btn && box.style.display !== 'none', text: btn ? btn.textContent : '' };
}, pred.toString());

// Select and press in one step (see the convert calls): a late boot task on a
// loaded CI runner cleared the selection between two separate calls.
await setup('gable');
let L = await lines();
const ridge0 = L.find(x => x.t === 'ridge');
check('the report’s roof: a straight gable, four barges and one ridge end to end', L.filter(x => x.t === 'barge').length === 4 && ridge0 && ridge0.p.some(p => p[0] === 219) && ridge0.p.some(p => p[0] === 350), JSON.stringify(ridge0));

let v = await select(l => l.type === 'barge' && l.subtype === 'starter');
check('a selected gable-end barge offers "Convert this gable end to a hip end"', v && v.shown && /Convert this gable end to a hip end/.test(v.text), JSON.stringify(v));
await pg.evaluate((i) => { if (i != null && i >= 0) DRAW.selectedLine = i; _hipEndConvert(); }, v && v.i);
L = await lines();
const hips = L.filter(x => x.t === 'hip'), ridge = L.find(x => x.t === 'ridge'), barges = L.filter(x => x.t === 'barge'), endGutter = L.find(x => x.t === 'gutter' && x.he === 'starter');
check('…pressed: that end loses its barges, the other end keeps its two', barges.length === 2 && barges.every(x => x.sub === 'finish'), JSON.stringify(barges));
check('…its end wall becomes a gutter', !!endGutter && endGutter.p.every(p => p[0] === 219), JSON.stringify(endGutter));
check('…the ridge stops short by the run (32.5 px — a 45° hip in plan) at that end only',
  !!ridge && Math.abs(Math.min(...ridge.p.map(p => p[0])) - (219 + 32.5)) < 0.2 && Math.max(...ridge.p.map(p => p[0])) === 350, JSON.stringify(ridge));
check('…and two hips run up from that end’s corners to the ridge’s new end',
  hips.length === 2 && hips.every(h => h.he === 'starter' && h.p[0][0] === 219 && Math.abs(h.p[1][0] - 251.5) < 0.2), JSON.stringify(hips));
v = await pg.evaluate(() => DRAW.hipEnds);
check('…remembered on the roof as its hip end', v && v.starter === true && !v.finish, JSON.stringify(v));

// it lasts: a corner drag rebuilds the roof with the hip end still there
v = await pg.evaluate(() => {
  DRAW.outline[1][1] += 10; DRAW.outline[2][1] += 10;          // the bottom wall moved down
  regenerateAutoRoofLines('gable');
  return { hips: DRAW.lines.filter(l => l.type === 'hip').length, barges: DRAW.lines.filter(l => l.type === 'barge').length };
});
check('a corner drag rebuilds the roof with the hip end still in it', v.hips === 2 && v.barges === 2, JSON.stringify(v));
v = await pg.evaluate(() => { undoLast(); return { he: DRAW.hipEnds, hips: DRAW.lines.filter(l => l.type === 'hip').length }; });
check('…and Undo goes back to the gable it was before the conversion', !(v.he && v.he.starter) && v.hips === 0, JSON.stringify(v));
await pg.evaluate(() => { DRAW.selectedLine = DRAW.lines.findIndex(l => l.type === 'barge' && l.subtype === 'starter'); _hipEndConvert(); });

// the sheets: the same as the gable (the hip end is cut from the same sheets)
v = await pg.evaluate(async () => {
  gotoTab('materials'); await new Promise(r => setTimeout(r, 3000));
  const s = (window._lastSheetSections || []).reduce((a, x) => a + x.total, 0);
  gotoTab('roof'); return s;
});
check('the sheet count is the gable’s: 9 + 9 = 18 (the hip end is cut from those sheets)', v === 18, String(v));

// and back again
v = await select(l => l.type === 'hip' && l.hipEnd === 'starter');
check('a selected hip on that end offers "Convert this hip end to a gable end"', v && v.shown && /Convert this hip end to a gable end/.test(v.text), JSON.stringify(v));
await pg.evaluate((i) => { if (i != null && i >= 0) DRAW.selectedLine = i; _hipEndConvert(); }, v && v.i);
L = await lines();
check('…pressed: the roof is exactly the gable it was', L.filter(x => x.t === 'barge').length === 4 && !L.some(x => x.t === 'hip') &&
  JSON.stringify(L.find(x => x.t === 'ridge').p.map(p => p[0]).sort()) === JSON.stringify([219, 350]), JSON.stringify(L.map(x => x.t)));

// a plain hip roof: one end to a gable, the other stays hipped
await setup('hip');
v = await select(l => l.type === 'hip' && l.pts.some(p => Math.abs(p[0] - 350) < 0.5));
check('on a plain hip roof a selected hip offers "Convert this hip end to a gable end"', v && v.shown && /hip end to a gable end/.test(v.text), JSON.stringify(v));
await pg.evaluate((i) => { if (i != null && i >= 0) DRAW.selectedLine = i; _hipEndConvert(); }, v && v.i);
L = await lines();
v = await pg.evaluate(() => ({ type: DRAW.roofType, he: DRAW.hipEnds }));
check('…pressed: it is a gable with barges at that end and the other end still a hip',
  v.type === 'gable' && L.filter(x => x.t === 'barge').length === 2 && L.filter(x => x.t === 'barge').every(x => x.p.every(p => p[0] === 350)) &&
  L.filter(x => x.t === 'hip').length === 2 && L.filter(x => x.t === 'hip').every(x => x.p.some(p => p[0] === 219)), JSON.stringify({ v, L: L.map(x => x.t + x.sub) }));

// a dog-leg's end converts the same way
v = await pg.evaluate((g) => {
  clearAll(true);
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = 15; DRAW.roofType = 'gable';
  DRAW.outline = g.outline.map(p => [p[0] - 1000, p[1] - 380]); DRAW.outlineDone = true; DRAW.lines = [];
  DRAW.roofs = [Object.assign(_newEmptyRoof('Main Roof'), { outline: DRAW.outline })]; DRAW.activeRoofIdx = 0;
  _autoSquareOutline(); autoGenerateRoof('gable', 0);
  DRAW.selectedLine = DRAW.lines.findIndex(l => l.type === 'barge' && l.subtype === 'finish');
  const offer = _hipEndOf(DRAW.lines[DRAW.selectedLine]);
  _hipEndConvert();
  return { offer, hips: DRAW.lines.filter(l => l.type === 'hip').length, valleys: DRAW.lines.filter(l => l.type === 'valley').length,
           barges: DRAW.lines.filter(l => l.type === 'barge').length, ridges: DRAW.lines.filter(l => l.type === 'ridge' && l.dogleg).length };
}, R60);
check('a dog-leg’s gable end converts to a hip end the same way (its bend untouched)',
  v.offer && v.offer.to === 'hip' && v.hips === 3 && v.valleys === 1 && v.barges === 2 && v.ridges === 2, JSON.stringify(v));
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 300));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
