// Feedback report 12 (2026-10-12): "step-down gable isnt right, the barge
// going down from the top ridge line to the lower ridge line shouldn't carry
// through to the gutter."
//
// His L: a narrow block on the left (86px across) meeting a wider one on the
// right (169px), ridges the same way, the step at x=1093. His junction came
// out carrying all of:
//
//   apron  583 -> 669    4.85m   the wing flashing into the wall
//   barge  583 -> 667.5  4.93m   the wider block's wall, behind that apron
//   barge  667.5 -> 669  0.09m   a 90mm stub where the two ridges missed
//   barge  669 -> 752    4.85m   the wall below the wing
//
// TWO OF THOSE ARE SETTLED AND ONE IS NOT.
//
// The 90mm stub is wrong on anybody's reading: the shared stretch is split
// at the WIDER block's ridge, and where that ridge does not line up with the
// wing's edge the split leaves a sliver that is not a flashing anybody can
// order or fit. Dropped (anything under 0.25m).
//
// The 4.93m barge behind the apron is the OPEN question, and it is the
// owner's to settle, not this file's. He is reporting it as wrong here — but
// tests/stepgable.mjs pins it as RIGHT, deliberately, from his own sketch
// when the shape was built: "the wider block keeps its barge along that same
// stretch (the wall above the lower roof)". On a step-down gable the taller
// block's gable rake really does continue above the lower roof, so there is
// a case for each. Taking it out passes this report and breaks that pin, so
// the shipped behaviour stands until he says which he wants. What this file
// pins is that nothing ELSE moved while the question is open.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// His outline, exactly as the report printed it.
const OUTLINE = [[1037,583],[1037,669],[1093,669],[1093,752],[1308,752],[1308,583]];
const SCALE = 0.05639220550069446, PITCH = 15, JUNCTION = 1093;

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

const r = await pg.evaluate(([OUTLINE, SCALE, PITCH, JUNCTION]) => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = OUTLINE.map(p => p.slice()); finishCurrent();
  DRAW.scaleMetresPerPx = SCALE; DRAW.calPitch = PITCH;
  DRAW.roofBaseHoriz = true; DRAW.rotation = 0; DRAW.roofType = 'stepgable';
  autoGenerateRoof('stepgable', 0); autoCalcLineMeasurements(); renderRoofSheetPlan();
  const at = x => (DRAW.lines || []).filter(l => l.pts && l.pts[0][0] === x && l.pts[1][0] === x)
    .map(l => ({ t: l.type, lo: Math.min(l.pts[0][1], l.pts[1][1]), hi: Math.max(l.pts[0][1], l.pts[1][1]),
                 m: +(l.measM || 0).toFixed(2) }))
    .sort((a, b) => a.lo - b.lo);
  const gg = (window._lastSheetCounts || {}).groups || {};
  let tot = 0; Object.keys(gg).forEach(k => tot += gg[k].count);
  return { junction: at(JUNCTION),
           counts: (DRAW.lines || []).reduce((a, l) => { a[l.type] = (a[l.type] || 0) + 1; return a; }, {}),
           tiny: (DRAW.lines || []).filter(l => (l.measM || 0) > 0 && (l.measM || 0) < 0.5)
                   .map(l => ({ t: l.type, m: l.measM })),
           sheets: tot };
}, [OUTLINE, SCALE, PITCH, JUNCTION]);

const j = r.junction;
const aprons = j.filter(x => x.t === 'apron');
const barges = j.filter(x => x.t === 'barge');

check('the step still flashes: the lower wing runs an apron up to the wall',
  aprons.length === 1 && aprons[0].lo === 583 && aprons[0].hi === 669,
  JSON.stringify(aprons));
check('THE SLIVER IS GONE — no 90mm stub where the two ridges miss each other',
  r.tiny.length === 0, JSON.stringify(r.tiny));
check('the wall below the wing still gets its barge — the stretch that is '
    + 'plainly exposed', barges.some(x => x.lo === 669 && x.hi === 752),
  JSON.stringify(barges));
check('the junction is now two barges, not three: the disputed one and the '
    + 'exposed one, with the sliver dropped', barges.length === 2,
  JSON.stringify(barges));
check('the roof is otherwise the same shape — two ridges, four gutters',
  r.counts.ridge === 2 && r.counts.gutter === 4, JSON.stringify(r.counts));
check('and the ORDER does not move: dropping a flashing nobody can fix to a '
    + 'wall must not change the steel', r.sheets === 40, String(r.sheets));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
