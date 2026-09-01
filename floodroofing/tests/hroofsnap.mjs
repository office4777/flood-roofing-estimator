// The H-shaped house from the feedback report: "the canvas drawing couldn't
// correctly draw the roof lines … this is for gable ends".
//
// Two separate things were happening on that job, and only one of them was
// ours.
//
// Theirs: the outline is not square. The left wing's top edge is 486 wide and
// its bottom edge 530, so the roof genuinely steps partway down. The app must
// keep showing that step — a roof drawn for a building 8% out of square
// SHOULD look wrong, or nobody ever reaches for Snap Square.
//
// Ours: on a footprint whose walls are all square to each other, a ridge runs
// between two parallel walls and therefore cannot slope. One came out falling
// 4px across its 610px length, three junctions landed within 10px of each
// other where the roof has one, and a valley and a hip ran between the same
// two points — a spur with no width that draws as a spike off the roof.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Exactly as it arrived in the report.
const REPORTED = [[-219,82],[-219,1009],[311,1009],[311,517],[650,517],[650,1044],
                  [1146,1044],[1146,25],[642,25],[642,242],[267,242],[267,82]];
// The same H with both wings a uniform width — what Snap Square would give.
const SQUARED  = [[-219,82],[-219,1009],[311,1009],[311,517],[650,517],[650,1044],
                  [1146,1044],[1146,25],[650,25],[650,242],[311,242],[311,82]];
// A roof with a genuinely angled wall. The cleanup must not touch this one:
// here a sloping ridge is real.
const ANGLED   = [[0,0],[600,0],[900,300],[900,800],[0,800]];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

async function gen(outline){
  return await pg.evaluate((ol) => {
    const L = buildGableRoofLines_legacy(ol), r = n => Math.round(n * 100) / 100;
    return L.map(l => ({ t: l.type, a: [r(l.pts[0][0]), r(l.pts[0][1])], b: [r(l.pts[1][0]), r(l.pts[1][1])] }));
  }, outline);
}
const skew = l => Math.min(Math.abs(l.a[0] - l.b[0]), Math.abs(l.a[1] - l.b[1]));
function nearDupes(lines, tol){
  const pts = []; lines.forEach(l => { pts.push(l.a); pts.push(l.b); });
  const uniq = [];
  pts.forEach(p => { if (!uniq.some(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 0.4)) uniq.push(p); });
  let n = 0;
  for (let i = 0; i < uniq.length; i++) for (let j = i+1; j < uniq.length; j++)
    if (Math.hypot(uniq[i][0]-uniq[j][0], uniq[i][1]-uniq[j][1]) <= tol) n++;
  return n;
}
function dupSegments(lines){
  const k = l => { const p=[Math.round(l.a[0]),Math.round(l.a[1])], q=[Math.round(l.b[0]),Math.round(l.b[1])];
    return (p[0]<q[0]||(p[0]===q[0]&&p[1]<=q[1])) ? p.concat(q).join(',') : q.concat(p).join(','); };
  const seen = {}; let n = 0;
  lines.forEach(l => { const s = k(l); if (seen[s]) n++; seen[s] = 1; });
  return n;
}

// ── the reported roof ─────────────────────────────────────────────
const rep = await gen(REPORTED);
const ridges = rep.filter(l => l.t === 'ridge');
check('every ridge on a square-walled house runs dead level or dead plumb',
  ridges.every(l => skew(l) < 0.5), ridges.map(l => JSON.stringify(l.a)+'->'+JSON.stringify(l.b)).join('  '));
check('…including the one across the middle, which used to fall 4px over its length',
  ridges.some(l => Math.abs(l.a[1] - l.b[1]) < 0.5 && Math.abs(l.a[0] - l.b[0]) > 250),
  JSON.stringify(ridges.filter(l => Math.abs(l.a[0] - l.b[0]) > 250)));
check('junctions the roof has as one point are one point',
  nearDupes(rep, 12) === 0, nearDupes(rep, 12) + ' still within 12px');
check('no line runs between the same two points as another — the spike is gone',
  dupSegments(rep) === 0, dupSegments(rep) + ' duplicate segments');

// A later report (the H with gable ends) settled this the other way: a wing
// drawn a few percent out of square is one wing, and the roofer wants one
// straight ridge down it, not a dog-leg where the drawing wobbled. So the
// builder squares each arm up to a single width. The outline itself is left
// exactly as drawn — only the roof lines are worked out from a squared copy.
const leftRidges = ridges.filter(l => l.a[0] < 200 && l.b[0] < 200);
check('a wing drawn slightly out of square still gets ONE straight ridge',
  leftRidges.length === 1 && Math.abs(leftRidges[0].a[0] - leftRidges[0].b[0]) < 0.5,
  JSON.stringify(leftRidges));

// ── squared up, it comes out clean ────────────────────────────────
const sq = await gen(SQUARED);
const sqRidges = sq.filter(l => l.t === 'ridge');
// Three: one down each wing, and one along the bar between them. The bar's
// stops where it runs into each wing rather than carrying on through it.
check('squared up, the same house gives a clean ridge down each wing and the bar',
  sqRidges.length === 3 && sqRidges.every(l => skew(l) < 0.5),
  sqRidges.map(l => JSON.stringify(l.a)+'->'+JSON.stringify(l.b)).join('  '));
check('…with nothing doubled up', nearDupes(sq, 12) === 0 && dupSegments(sq) === 0);

// ── an angled wall is left alone ──────────────────────────────────
const ang = await gen(ANGLED);
check('a roof with a genuinely angled wall still generates lines',
  ang.length > 0 && ang.some(l => l.t === 'ridge'), ang.length + ' lines');
check('…and keeps them — a sloping ridge is real there, not drift',
  ang.filter(l => l.t === 'ridge').length > 0);

check('the page threw no errors', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
