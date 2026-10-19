// Feedback report 65 (2026-10-18): "diagonal straight gable not good, ridge
// should keep with the angle of the roof (2nd roof) not try stay horizontal".
//
// His second roof on job 3307 is an 8.3 x 6.2 m rectangle traced at 44
// degrees. The straight-gable builder works in SCREEN axes — bounding box,
// ridge along its midline, each wall sorted into gutter or barge by whether
// dx or dy is the bigger — so the ridge ran corner to corner ACROSS the roof
// and the roof came out with SIX BARGES AND NO GUTTER. Not an odd-looking
// line: a roof with nowhere for the water to go, no gutter in the take-off,
// and (measured on the old build) no sheet groups at all, so it ordered no
// steel either.
//
// Pinned here from his own outline, to the pixel:
//   • the ridge runs parallel to the long walls, midway between them;
//   • two gutters on the long walls, barges on the ends;
//   • the lengths are the building's (8.3 m ridge, 3.20 m rake at 15°);
//   • the sheets come out 22 at 3.18 m — the old build counted none;
//   • Rotate roof 90° still turns it onto the short axis;
//   • AND NOTHING SQUARE TO THE PICTURE MOVES: an axis-aligned gable is
//     line-for-line what it was, and a dog-leg still takes its own branch.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = process.env.FR_FRONTEND_DIR || _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// His roof 2, exactly as the report carries it.
const R65 = [[1176,803],[1293,917],[1378,830],[1260,716]];
const MPP = 0.05085925494654802, PITCH = 15;

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

// Build one roof from an outline and read back what the builder drew.
async function build(outline, opts){
  return pg.evaluate(async (a) => {
    const [ol, o] = a;
    gotoTab('roof'); try { _fergusPanelClose(); } catch(e){}
    clearAll(true);
    DRAW.scaleMetresPerPx = o.mpp; DRAW.calPitch = o.pitch;
    DRAW.outline = ol.map(p => p.slice()); DRAW.outlineDone = true; DRAW.lines = [];
    DRAW.roofs = [Object.assign(_newEmptyRoof('Roof'), { outline: DRAW.outline })];
    DRAW.activeRoofIdx = 0;
    autoGenerateRoof(o.type || 'gable');
    if (o.rotate){ try { rotateActiveRoof(); } catch(e){} }
    try { autoCalcLineMeasurements(); } catch(e){}
    try { _syncCurrentToRoof(); syncToRoofData(); } catch(e){}
    try { renderRoofSheetPlan(); } catch(e){}
    await new Promise(r => setTimeout(r, 400));
    const counts = {};
    DRAW.lines.forEach(l => { counts[l.type] = (counts[l.type] || 0) + 1; });
    const of = (t) => DRAW.lines.filter(l => l.type === t);
    return {
      counts,
      horiz: DRAW.roofBaseHoriz,
      ridge: (of('ridge')[0] || {}).pts || null,
      lines: DRAW.lines.map(l => ({ t: l.type, s: l.subtype || '', p: l.pts, m: l.measM })),
      groups: ((window._lastSheetCounts || {}).groups) || null,
    };
  }, [outline, Object.assign({ mpp: MPP, pitch: PITCH }, opts || {})]);
}
const ang = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
const par = (x, y) => { let d = Math.abs(x - y) % 180; return Math.min(d, 180 - d); };
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const near = (p, q, t) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= (t == null ? 2 : t);

// ── his roof ─────────────────────────────────────────────────────
const v = await build(R65);
// The two long walls are 1176,803 -> 1293,917 and 1378,830 -> 1260,716.
const LONG = ang(R65[0], R65[1]);
check('the ridge runs with the building, not across it',
  v.ridge && par(ang(v.ridge[0], v.ridge[1]), LONG) < 1.5,
  v.ridge ? (ang(v.ridge[0], v.ridge[1]).toFixed(2) + '° vs wall ' + LONG.toFixed(2) + '°') : 'no ridge');
// Midway between the long walls is the midpoint of each SHORT wall.
check('…from the middle of one gable end to the middle of the other',
  v.ridge && ((near(v.ridge[0], mid(R65[3], R65[0])) && near(v.ridge[1], mid(R65[1], R65[2]))) ||
              (near(v.ridge[1], mid(R65[3], R65[0])) && near(v.ridge[0], mid(R65[1], R65[2])))),
  JSON.stringify(v.ridge) + ' want ' + JSON.stringify([mid(R65[3], R65[0]), mid(R65[1], R65[2])]));
check('A GABLE HAS GUTTERS: two of them, on the long walls — it had NONE',
  v.counts.gutter === 2 &&
  v.lines.filter(l => l.t === 'gutter').every(l => par(ang(l.p[0], l.p[1]), LONG) < 1.5),
  JSON.stringify(v.counts));
check('…and barges on the two ends, not six of them round the whole roof',
  v.counts.barge === 4 && !v.counts.hip && !v.counts.valley, JSON.stringify(v.counts));
// 8.31 m long, 6.19 m wide, 15°: the rake is 3.095 / cos 15 = 3.20 m.
const m = (t) => v.lines.filter(l => l.t === t).map(l => +(l.m || 0).toFixed(2));
check('the ridge measures the building’s long side, about 8.3 m',
  Math.abs(m('ridge')[0] - 8.31) < 0.1, m('ridge').join(','));
check('…the gutters the same, and the barges the 3.20 m rake at 15°',
  m('gutter').every(x => Math.abs(x - 8.32) < 0.1) && m('barge').every(x => Math.abs(x - 3.20) < 0.06),
  'gutters ' + m('gutter').join(',') + ' barges ' + m('barge').join(','));
// 8.31 / 0.762 = 10.9 -> 11 a face, two faces.
check('the sheets come out 22 at about 3.2 m — the old build counted NONE',
  Array.isArray(v.groups) && v.groups.length === 1 && v.groups[0].count === 22 &&
  Math.abs(v.groups[0].orderedMm - 3184) < 60,
  JSON.stringify(v.groups));

// Rotate roof 90° still turns it — onto the SHORT axis of the building.
const r = await build(R65, { rotate: true });
check('Rotate roof 90° turns the ridge onto the building’s short axis',
  r.ridge && Math.abs(par(ang(r.ridge[0], r.ridge[1]), LONG) - 90) < 1.5,
  r.ridge ? ang(r.ridge[0], r.ridge[1]).toFixed(2) + '°' : 'no ridge');
check('…and it is still a proper gable, gutters and all',
  r.counts.gutter === 2 && r.counts.barge === 4, JSON.stringify(r.counts));

// ── NOTHING SQUARE TO THE PICTURE MOVES ──────────────────────────
// The same rectangle, laid square: the builder must be untouched.
const SQ = [[300,300],[760,300],[760,640],[300,640]];
const sq = await build(SQ);
check('a gable square to the picture is the same roof it always was',
  sq.counts.ridge === 1 && sq.counts.gutter === 2 && sq.counts.barge === 4 &&
  sq.ridge && Math.abs(ang(sq.ridge[0], sq.ridge[1])) < 0.01,
  JSON.stringify(sq.counts) + ' ridge ' + JSON.stringify(sq.ridge));
check('…its ridge still runs the midline of the long axis exactly',
  sq.ridge && Math.abs(sq.ridge[0][1] - 470) < 0.01 && Math.abs(sq.ridge[1][1] - 470) < 0.01,
  JSON.stringify(sq.ridge));
// Hand wobble on a square trace is not an angle: a degree of slop must not
// start rotating frames about.
const WOB = [[300,300],[760,303],[757,640],[300,638]];
const wob = await build(WOB);
check('a degree of hand wobble on a square trace does not spin the frame',
  wob.ridge && Math.abs(ang(wob.ridge[0], wob.ridge[1])) < 1.2,
  wob.ridge ? ang(wob.ridge[0], wob.ridge[1]).toFixed(2) + '°' : 'no ridge');

// A dog-leg keeps its own branch (report 60) — it is not rectilinear in ANY
// frame, so the rotation above must never reach it.
const DOGLEG = [[200,400],[560,400],[760,640],[700,700],[500,470],[200,470]];
const dl = await build(DOGLEG);
check('a dog-leg still takes the dog-leg builder — a valley and a hip, two ridges',
  dl.counts.ridge === 2 && dl.counts.valley === 1 && dl.counts.hip === 1,
  JSON.stringify(dl.counts));

// An L traced at an angle is rectilinear in its own frame: it must come out
// as the stepped straight gable does, not fall over.
const c45 = Math.cos(Math.PI / 6), s45 = Math.sin(Math.PI / 6);
const ROTL = [[300,300],[700,300],[700,500],[520,500],[520,620],[300,620]]
  .map(p => [Math.round(500 + (p[0]-500)*c45 - (p[1]-460)*s45), Math.round(460 + (p[0]-500)*s45 + (p[1]-460)*c45)]);
const rl = await build(ROTL);
check('an L traced at an angle builds a gable with its ridge on the building',
  rl.counts.ridge >= 1 && rl.counts.gutter >= 1 &&
  par(ang(rl.ridge[0], rl.ridge[1]), ang(ROTL[0], ROTL[1])) < 2,
  JSON.stringify(rl.counts) + ' ridge ' + (rl.ridge ? ang(rl.ridge[0], rl.ridge[1]).toFixed(1) : '-') + '°');

// A STEP GABLE HAS THE IDENTICAL FAULT, and the identical fix. On the same
// L lying at 30 degrees it came out with horizontal ridges and TEN gutters,
// half of them running across the walls.
const sg = await build(ROTL, { type: 'stepgable' });
const sgWall = ang(ROTL[0], ROTL[1]);
check('a step gable traced at an angle keeps its ridges on the building',
  sg.counts.ridge === 2 &&
  sg.lines.filter(l => l.t === 'ridge').every(l => par(ang(l.p[0], l.p[1]), sgWall) < 1.5),
  JSON.stringify(sg.lines.filter(l => l.t === 'ridge').map(l => +ang(l.p[0], l.p[1]).toFixed(1))));
check('…with four gutters along its walls, not ten across them',
  sg.counts.gutter === 4 &&
  sg.lines.filter(l => l.t === 'gutter').every(l => par(ang(l.p[0], l.p[1]), sgWall) < 1.5),
  JSON.stringify(sg.counts));
// And mono, dutch and hip were always right — the skeleton and the
// direction classifier do not care which way the picture is turned. Pinned
// so a later change to the frame cannot quietly break them.
const mo = await build(R65, { type: 'mono' });
check('a mono pitch on the same roof still falls down the building’s own slope',
  mo.counts.gutter === 1 && par(ang(mo.lines.filter(l => l.t === 'gutter')[0].p[0],
                                   mo.lines.filter(l => l.t === 'gutter')[0].p[1]), LONG) < 1.5,
  JSON.stringify(mo.counts));
const du = await build(R65, { type: 'dutch' });
check('…and a dutch gable keeps its ridge on the long axis',
  du.counts.ridge === 1 && du.counts.hip === 4 &&
  par(ang(du.ridge[0], du.ridge[1]), LONG) < 1.5, JSON.stringify(du.counts));

check('none of it threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
