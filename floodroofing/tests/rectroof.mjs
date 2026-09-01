// "at each roof end it should be a typical gable barge end … the valleys can
// terminate in the middle of a roof face, at the moment it keeps forcing lines
// to connect to the ridge" — the H with gable+hip/valley, from the feedback.
//
// What was happening: the roof came off a general-purpose solver, and the
// gable ends were then worked out from the SHAPE OF ITS OUTPUT — two hips
// meeting at a ridge tip and nothing else there. On a wing a few percent out
// of square the solver puts those hips on slightly different points, the tip
// stops looking like an open hip end, and the arm silently keeps a hip. The
// reported H came out with barge ends on one wing and hips on the other, its
// 506px-long wing carrying 60px of ridge, and the gap filled with stray hips
// and valleys running back to the ridges.
//
// A roof over a square-walled building is not a guess: its height anywhere is
// the distance to the nearest wall, and every ridge, hip and valley follows.
// So these shapes are built from the shape itself. Anything unusual — an
// angled wall, something that will not decompose — still goes to the solver.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const REPORTED = [[310,251],[310,650],[449,650],[449,446],[697,446],[697,650],
                  [922,650],[922,144],[678,144],[678,365],[439,365],[439,251]];
const RECT = [[0,0],[400,0],[400,700],[0,700]];
const L    = [[0,0],[400,0],[400,300],[900,300],[900,700],[0,700]];
const T    = [[0,0],[900,0],[900,300],[650,300],[650,700],[250,700],[250,300],[0,300]];
const U    = [[0,0],[250,0],[250,450],[650,450],[650,0],[900,0],[900,700],[0,700]];
const ANGLED = [[0,0],[600,0],[900,300],[900,800],[0,800]];

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

const gen = (ol, gable) => pg.evaluate(([o,g]) => {
  const L2 = g ? buildGableRoofLines_legacy(o) : buildHipValleyLines(o);
  const r = n => Math.round(n * 100) / 100;
  return L2.map(l => ({ t:l.type, a:[r(l.pts[0][0]), r(l.pts[0][1])], b:[r(l.pts[1][0]), r(l.pts[1][1])] }));
}, [ol, gable]);
const cnt  = (ls,t) => ls.filter(l => l.t === t).length;
const skew = l => Math.min(Math.abs(l.a[0]-l.b[0]), Math.abs(l.a[1]-l.b[1]));
// A gable end is two barges meeting at one peak.
const gableEnds = ls => {
  const peaks = {};
  ls.filter(l => l.t === 'barge').forEach(l => { const k = l.b[0]+','+l.b[1]; peaks[k] = (peaks[k]||0)+1; });
  return Object.values(peaks).filter(v => v >= 2).length;
};

// ── the reported roof ─────────────────────────────────────────────
const H = await gen(REPORTED, true);
check('the reported H puts a gable on every one of its four arm ends',
  gableEnds(H) === 4, gableEnds(H) + ' gable ends, ' + cnt(H,'barge') + ' barges');
check('…on BOTH wings, not just the one that happened to come out clean',
  H.filter(l => l.t==='barge' && l.a[0] < 500).length === 4 &&
  H.filter(l => l.t==='barge' && l.a[0] > 650).length === 4,
  'left ' + H.filter(l=>l.t==='barge'&&l.a[0]<500).length + ', right ' + H.filter(l=>l.t==='barge'&&l.a[0]>650).length);
const HR = H.filter(l => l.t === 'ridge');
check('every ridge runs dead level or dead plumb', HR.every(l => skew(l) < 0.5),
  HR.map(l => JSON.stringify(l.a)+'->'+JSON.stringify(l.b)).join('  '));
check('each wing carries one full-length ridge, not a 60px stub',
  HR.filter(l => Math.abs(l.a[1]-l.b[1]) > 300).length === 2,
  HR.map(l => Math.round(Math.hypot(l.b[0]-l.a[0], l.b[1]-l.a[1]))).join(', '));
check('a valley runs out of each of its four inside corners', cnt(H,'valley') === 4, cnt(H,'valley') + ' valleys');
// The point of the report: nothing is forced to run to a ridge any more.
check('…and no stray hips are left over', cnt(H,'hip') === 0, cnt(H,'hip') + ' hips');

// ── the other shapes a roofer actually draws ──────────────────────
for (const [name, ol, ends, valleys] of [
  ['a plain rectangle', RECT, 2, 0],
  ['an L', L, 2, 1],
  ['a T', T, 3, 2],
  ['a U', U, 2, 2],
]){
  const g = await gen(ol, true);
  check(name + ' gables every arm end and nothing else', gableEnds(g) === ends,
    gableEnds(g) + ' gable ends, expected ' + ends);
  check('…and runs a valley out of each inside corner', cnt(g,'valley') === valleys,
    cnt(g,'valley') + ' valleys, expected ' + valleys);
  check('…with every ridge level or plumb',
    g.filter(l=>l.t==='ridge').every(l => skew(l) < 0.5),
    g.filter(l=>l.t==='ridge').map(l=>JSON.stringify(l.a)+'->'+JSON.stringify(l.b)).join(' '));
}

// ── hip roofs get the same treatment ──────────────────────────────
const Hh = await gen(REPORTED, false);
// Counted, not enumerated. A correct straight skeleton puts a hip at every
// outside corner AND carries hip-type segments between junctions inside the
// roof, so an exact total pins one solver's topology rather than the roof.
// What has to be true is that no corner is left without its hip and that a
// hip roof grew no barges.
check('the same H as a hip roof gets a hip at every outside corner, and no barges',
  cnt(Hh,'hip') >= 8 && cnt(Hh,'barge') === 0, cnt(Hh,'hip') + ' hips, ' + cnt(Hh,'barge') + ' barges');
check('…and a valley for each of its four inside corners',
  cnt(Hh,'valley') >= 4, cnt(Hh,'valley') + ' valleys');

// ── anything unusual is left to the old solver ────────────────────
const ang = await gen(ANGLED, true);
check('a building with an angled wall still gets a roof', ang.length > 0, ang.length + ' lines');
check('…and is left to the general solver, which allows a sloping ridge',
  ang.some(l => l.t === 'ridge'));

check('the page threw no errors', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
