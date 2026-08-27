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
check('a flat roof is measured flat, not at the selected roof\'s pitch',
  Math.abs(flatKept - 3.63) < 0.02, 'hip = ' + flatKept + 'm (3.63 is its plan length; 20° stretches it to 3.75)');

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
// Its own pitch would give 3.7 (the plan length); the active roof's 20° gives
// 3.75. Small, because a hip runs diagonally and takes only part of the slope
// — which is exactly why this drift went unnoticed for so long.
check('a roof with no pitch of its own still follows the active one',
  Math.abs(inherited - 3.75) < 0.02 && inherited > flatKept,
  'hip = ' + inherited + 'm (flat would be ' + flatKept + 'm)');

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

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
