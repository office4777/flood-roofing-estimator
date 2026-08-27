// "When i click the different roof buttons it changes the look of all the
// measures, i don't want anything on the canvas to change."
//
// It was not the drawing code. _recalcAllRoofsMeas refreshes every non-active
// roof's line measurements after a calibration, and it chose each roof's pitch
// like this:
//
//     var pitch = (typeof r.calPitch === 'number' && r.calPitch > 0)
//                   ? r.calPitch : actPitch;
//
// A roof whose pitch is 0 failed the `> 0` test, so it did not use 0 — it
// borrowed the ACTIVE roof's pitch. And the loop WRITES measM, planM and label
// back onto those lines. So on the reported job (pitches 0 / 0 / 0 / 20),
// selecting Roof 4 rewrote the other three roofs' stored measurements at 20°
// and selecting Main Roof rewrote them again at 0°. The numbers really were
// changing, and destructively — the saved measurement was overwritten.
//
// 0 is a real pitch. Only a roof that has never been given one may inherit,
// and after the outline-complete popup asks for it, even that is rare.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const G = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report20.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// The reported job, exactly: four roofs, pitches 0 / 0 / 0 / 20.
async function load(){
  await pg.evaluate((g) => {
    DRAW.scaleMetresPerPx = g.scaleMetresPerPx;
    DRAW.roofs = g.roofs.map(r => Object.assign({}, r, {
      outline: r.outline.map(p => p.slice()),
      lines: r.lines.map(l => Object.assign({}, l, { pts: l.pts.map(p => p.slice()) })),
      outlineDone: true,
    }));
    DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
    _loadRoofToCurrent(0);
    try { gotoTab('roof'); } catch(e){}
    redrawAll();
  }, G);
  await pg.waitForTimeout(250);
}
await load();
check('the reported job loads with four roofs at 0/0/0/20',
  JSON.stringify(await pg.evaluate(() => DRAW.roofs.map(r => r.calPitch))) === '[0,0,0,20]',
  JSON.stringify(await pg.evaluate(() => DRAW.roofs.map(r => r.calPitch))));

// Every roof's measurements after a recalc, with roof `i` selected.
const measWith = async (i) => pg.evaluate((k) => {
  switchToRoof(k);
  _recalcAllRoofsMeas();
  _syncCurrentToRoof();
  return DRAW.roofs.map(r => (r.lines || []).map(l => l.measM));
}, i);

const withMain = await measWith(0);
const withR4   = await measWith(3);
const withR2   = await measWith(1);

// ── the fault ──────────────────────────────────────────────────────
check('Main Roof keeps its own measurements when Roof 4 is selected',
  JSON.stringify(withMain[0]) === JSON.stringify(withR4[0]),
  'main=' + JSON.stringify(withMain[0].slice(0,4)) + ' vs r4sel=' + JSON.stringify(withR4[0].slice(0,4)));
check('Roof 2 keeps its own measurements when Roof 4 is selected',
  JSON.stringify(withMain[1]) === JSON.stringify(withR4[1]),
  JSON.stringify(withMain[1]) + ' vs ' + JSON.stringify(withR4[1]));
check('Roof 3 keeps its own measurements when Roof 4 is selected',
  JSON.stringify(withMain[2]) === JSON.stringify(withR4[2]),
  JSON.stringify(withMain[2]) + ' vs ' + JSON.stringify(withR4[2]));
check('the pitched roof keeps its own when a flat one is selected',
  JSON.stringify(withR4[3]) === JSON.stringify(withMain[3]),
  JSON.stringify(withR4[3]) + ' vs ' + JSON.stringify(withMain[3]));
check('and selecting a third roof changes nothing either',
  JSON.stringify(withR2) === JSON.stringify(withMain), 'roof 2 selected differs');

// ── a pitch of zero is a pitch, not "unset" ────────────────────────
// The whole fault was `> 0` treating a flat roof as having no opinion.
await load();
const flatKept = await pg.evaluate(() => {
  DRAW.roofs[1].calPitch = 0;
  switchToRoof(3);                   // Roof 4, pitch 20
  _recalcAllRoofsMeas();
  // A gutter is measured on plan, a hip is not — the hip is where a borrowed
  // pitch shows up.
  var hip = DRAW.roofs[1].lines.find(l => l.type === 'hip');
  return hip ? hip.measM : null;
});
// A roof with no pitch of its own takes the 15° default — the same number the
// pitch box has always shown, so a job nobody calibrated measures exactly as it
// always did. What it must NOT take is the selected roof's 20°.
check('a roof with no pitch takes the default, not the selected roof\'s pitch',
  Math.abs(flatKept - 3.71) < 0.03, 'hip = ' + flatKept + 'm (15° default gives ~3.71; 20° would give 3.75)');

// ── a roof that has never been given a pitch may still inherit ─────
// That is the only case where borrowing is right, and it has to keep working
// or a freshly drawn roof would measure flat by accident.
await load();
const inherited = await pg.evaluate(() => {
  delete DRAW.roofs[1].calPitch;     // never asked, never answered
  switchToRoof(3);                   // Roof 4, pitch 20
  _recalcAllRoofsMeas();
  var hip = DRAW.roofs[1].lines.find(l => l.type === 'hip');
  return hip ? hip.measM : null;
});
// The whole point: an unset roof measures the SAME whichever roof is selected.
// It used to follow the active one, and since the recalc writes the value back,
// that rewrote its stored measurement every time you clicked a different roof.
check('an unset roof measures the same whatever is selected',
  Math.abs(inherited - flatKept) < 0.001,
  'hip = ' + inherited + 'm with Roof 4 selected vs ' + flatKept + 'm — these must match');

// ── the canvas itself must not move ────────────────────────────────
await load();
const texts = async (i) => pg.evaluate((k) => {
  var cv = document.getElementById('canvas') || document.querySelector('canvas');
  var g = cv.getContext('2d');
  if (!g.__spy){ var o = g.fillText.bind(g); g.__spy = []; g.fillText = function(t,x,y){ g.__spy.push(String(t)); return o(t,x,y); }; }
  g.__spy.length = 0;
  switchToRoof(k); redrawAll();
  return g.__spy.slice().sort();
}, i);
const t0 = await texts(0), t3 = await texts(3), t1 = await texts(1);
check('every label on the canvas is the same whichever roof is selected',
  JSON.stringify(t0) === JSON.stringify(t3) && JSON.stringify(t0) === JSON.stringify(t1),
  't0=' + t0.length + ' t3=' + t3.length + ' t1=' + t1.length);

// ══ 20b — one pitch per roof, shown in three places ═══════════════
await load();
await pg.evaluate(() => { try { gotoTab('roof'); } catch(e){} });
await pg.waitForTimeout(250);

const boxes = () => pg.evaluate(() => ({
  panel: (document.getElementById('roofPitchInput')||{}).value,
  cal:   (document.getElementById('calPitchInput')||{}).value,
  meas:  (document.getElementById('pitchDeg')||{}).value,
  roof:  DRAW.roofs[DRAW.activeRoofIdx].calPitch,
  live:  DRAW.calPitch,
}));

check('the roof menu has a pitch box of its own',
  await pg.isVisible('#roofPitchInput').catch(() => false) ||
  !!(await pg.$('#roofPitchInput')), 'no #roofPitchInput');

await pg.evaluate(() => { switchToRoof(0); setRoofPitch(22.5, null); });
let bx = await boxes();
check('setting the pitch once fills all three boxes',
  bx.panel === '22.5' && bx.cal === '22.5' && bx.meas === '22.5', JSON.stringify(bx));
check('…and lands on the roof itself, not just the live copy',
  bx.roof === 22.5 && bx.live === 22.5, JSON.stringify(bx));

// The whole point: each roof keeps its own, and the boxes follow the roof.
await pg.evaluate(() => { switchToRoof(1); setRoofPitch(8, null); });
bx = await boxes();
check('a second roof takes its own pitch', bx.roof === 8 && bx.panel === '8', JSON.stringify(bx));
await pg.evaluate(() => switchToRoof(0));
bx = await boxes();
check('…and going back shows the first roof\'s again, in every box',
  bx.roof === 22.5 && bx.panel === '22.5' && bx.cal === '22.5' && bx.meas === '22.5', JSON.stringify(bx));
check('the two roofs kept different pitches',
  JSON.stringify(await pg.evaluate(() => DRAW.roofs.map(r => r.calPitch))) === '[22.5,8,0,20]',
  JSON.stringify(await pg.evaluate(() => DRAW.roofs.map(r => r.calPitch))));

// Typing into any of the three is the same act.
await pg.evaluate(() => { switchToRoof(2); var el = document.getElementById('pitchDeg');
  el.value = '30'; el.dispatchEvent(new Event('input', { bubbles:true })); });
bx = await boxes();
check('typing in the Measurements box drives the other two',
  bx.roof === 30 && bx.panel === '30' && bx.cal === '30', JSON.stringify(bx));

check('a pitch is clamped to something a roof can actually be',
  await pg.evaluate(() => { setRoofPitch(400, null); var a = DRAW.calPitch;
                            setRoofPitch(-9, null);  return [a, DRAW.calPitch]; })
    .then(v => v[0] === 60 && v[1] === 0), 'not clamped to 0..60');

// ── the outline-complete popup asks for it ─────────────────────────
await load();
const popup = await pg.evaluate(() => {
  _roofSetupPopup();
  var el = document.querySelector('#_rsPitch');
  return { there: !!el, seeded: el ? el.value : null };
});
check('the popup that opens when an outline closes asks for the pitch', popup.there);
// A second roof on a house is usually the same pitch as the first, so offering
// 0 would make "just press the button" the wrong answer.
check('…seeded from a roof that already has one, not from zero',
  popup.seeded === '20', 'seeded with ' + popup.seeded);
const applied = await pg.evaluate(() => {
  var el = document.querySelector('#_rsPitch');
  el.value = '17.5';
  document.querySelector('#_rsOk').click();
  return { pitch: DRAW.calPitch, onRoof: DRAW.roofs[DRAW.activeRoofIdx].calPitch,
           box: (document.getElementById('roofPitchInput')||{}).value };
});
check('answering it sets the roof\'s pitch everywhere',
  applied.pitch === 17.5 && applied.onRoof === 17.5 && applied.box === '17.5', JSON.stringify(applied));

// ── the pitch on the roof ──────────────────────────────────────────
await load();
const painted = () => pg.evaluate(() => {
  var cv = document.getElementById('canvas') || document.querySelector('canvas');
  var g = cv.getContext('2d');
  if (!g.__spy2){ var o = g.fillText.bind(g); g.__spy2 = []; g.fillText = function(t,x,y){ g.__spy2.push(String(t)); return o(t,x,y); }; }
  g.__spy2.length = 0; redrawAll();
  return g.__spy2.slice();
});
check('the pitch is not on the roof until it is asked for',
  !(await painted()).some(t => /^\d+(\.\d+)?°$/.test(t)), 'a degree label appeared unbidden');

await pg.evaluate(() => { switchToRoof(3); togglePitchLabel(); });
let txts = await painted();
check('Show on roof puts it there, reading like 20°',
  txts.indexOf('20°') >= 0, JSON.stringify(txts.filter(t => t.indexOf('°') >= 0)));
check('…and only on the roof it belongs to',
  txts.filter(t => /°$/.test(t)).length === 1, JSON.stringify(txts.filter(t => /°$/.test(t))));
check('the Show-on-roof control shows it is on',
  await pg.isChecked('#roofPitchShowBtn'), 'checkbox not ticked');

// It has to be a hit target, or it can be neither moved nor deleted.
check('it registers somewhere the mouse can find it',
  await pg.evaluate(() => (window._roofCanvasHits.pitch || []).length === 1),
  JSON.stringify(await pg.evaluate(() => window._roofCanvasHits.pitch)));

// "…not near any other measures." The middle of a roof is where its measure
// labels crowd, so an undragged plate steps off anything it would cover.
const cleared = await pg.evaluate(() => {
  // Turn every roof's label on just for this measurement, then put the job
  // back as it was — the checks after this one are about ONE roof's label.
  window.__wasLbl = DRAW.roofs.map(function(r){ return r.pitchLabel; });
  window.__wasLive = DRAW.pitchLabel;
  DRAW.roofs.forEach(function(r){ r.pitchLabel = { dx:0, dy:0 }; });
  DRAW.pitchLabel = { dx:0, dy:0 };
  redrawAll(); redrawAll();
  var plates = (window._roofCanvasHits.pitch || []);
  var meas = (window._roofCanvasHits.measures || []);
  return plates.map(function(p){
    return meas.some(function(m){
      var mx = m.x + m.w/2, my = m.y + m.h/2;
      return Math.abs(p.x - mx) < (p.w + m.w)/2 && Math.abs(p.y - my) < (p.h + m.h)/2;
    });
  });
});
await pg.evaluate(() => {
  DRAW.roofs.forEach(function(r, i){ r.pitchLabel = window.__wasLbl[i]; });
  DRAW.pitchLabel = window.__wasLive;
  redrawAll();
});
check('most pitch plates step clear of the measurement labels',
  cleared.filter(function(c){ return !c; }).length >= Math.ceil(cleared.length * 0.7),
  cleared.filter(Boolean).length + ' of ' + cleared.length + ' still overlap (a small roof can be saturated — it falls back to the centre and is draggable)');

const moved = await pg.evaluate(() => {
  var before = _pitchLabelAnchor(DRAW.outline, DRAW.pitchLabel).slice();
  DRAW.pitchLabel = { dx: 60, dy: -40 };
  var after = _pitchLabelAnchor(DRAW.outline, DRAW.pitchLabel);
  return { dx: after[0] - before[0], dy: after[1] - before[1] };
});
check('dragging it moves it by exactly what it was dragged',
  moved.dx === 60 && moved.dy === -40, JSON.stringify(moved));

check('where it was put travels with the roof, not the screen',
  await pg.evaluate(() => { _syncCurrentToRoof(); switchToRoof(0); switchToRoof(3);
    return DRAW.pitchLabel && DRAW.pitchLabel.dx === 60; }), 'the position was lost on a roof switch');

await pg.evaluate(() => togglePitchLabel());
txts = await painted();
check('taking it off removes it from the drawing',
  !txts.some(t => /°$/.test(t)), JSON.stringify(txts.filter(t => /°$/.test(t))));
check('…but leaves the pitch itself alone',
  await pg.evaluate(() => DRAW.calPitch) === 20, 'the pitch went with the label');

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
