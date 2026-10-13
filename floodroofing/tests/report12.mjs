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
// ALL THREE ARE SETTLED NOW (the owner, 2026-10-13).
//
// The 90mm stub is wrong on anybody's reading: the shared stretch was split
// at the WIDER block's ridge, and where that ridge does not line up with the
// wing's edge the split leaves a sliver that is not a flashing anybody can
// order or fit. Dropped (anything under 0.25m).
//
// The 4.93m barge behind the apron was the open question, and he settled it:
// "the barge going down from the top ridge line to the lower ridge line
// shouldn't carry through to the gutter" … "the north west long barge
// shouldn't go all the way to the gutter". THE GEOMETRY AGREES, which is why
// this is a fix and not a preference: both blocks slope at the same pitch off
// the same eave line, so from the eave up to the LOWER block's ridge the two
// roof planes sit at exactly the same height — there is no wall above that
// roof and nothing to flash. Past the lower ridge its roof falls away while
// the taller one keeps climbing, and that triangle, ridge to ridge, is the
// barge: 2.42m here, not 4.93m. tests/stepgable.mjs pinned the old behaviour
// from what was believed to be his sketch; he has since said that drawing was
// the app's own output, not his, so that pin was pinning the bug.
//
// The 4.85m barge below the wing he confirmed as correct, and it is untouched.
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
check('the junction is two barges, not three — the sliver is dropped',
  barges.length === 2, JSON.stringify(barges));
// THE SETTLED ANSWER. The wider block's ridge is at 667.5 and the wing's at
// 626; the barge is the stretch between them and stops there. 583 is the
// gutter it used to run down to.
check('THE JUNCTION BARGE STOPS AT THE WING\'S RIDGE — it no longer carries '
    + 'through to the gutter',
  barges.some(x => x.lo === 626 && x.hi === 667.5), JSON.stringify(barges));
check('…so it measures 2.42m of gable wall, not the 4.93m it ran before',
  barges.some(x => x.lo === 626 && x.m === 2.42), JSON.stringify(barges));
check('…and nothing on this junction reaches the top gutter at 583 but the apron',
  barges.every(x => x.lo !== 583), JSON.stringify(barges));
check('the roof is otherwise the same shape — two ridges, four gutters',
  r.counts.ridge === 2 && r.counts.gutter === 4, JSON.stringify(r.counts));
check('and the ORDER does not move: shortening a flashing to the wall that is '
    + 'really there must not change the steel', r.sheets === 40, String(r.sheets));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
