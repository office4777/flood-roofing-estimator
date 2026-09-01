// The four roofs a roofer actually drew, and reported as broken.
//
// These outlines are lifted verbatim from feedback reports 29-32. They are the
// evidence, so they are the test: a builder that gets these right is a builder
// that works on the shapes people draw, and one that gets them wrong is broken
// no matter what a synthetic L says.
//
// What went wrong is worth stating, because it is what these assertions catch.
// A rectilinear builder was added to fix H and T shapes and it short-circuited
// every other shape with a worse answer: on a plain L it produced two ridges
// that never met, a hip ending in mid-air, and a valley stopping short of the
// ridge it was meant to land on. Nothing failed — the suites of the day only
// asked whether lines came out, not whether they joined up.
//
// So these are STRUCTURAL checks, not coordinates. Coordinates would pin one
// solver's arithmetic; a roof is wrong in ways you can name: a line outside
// the building, a line that stops in the middle of nowhere, an apex where two
// hips climb to a point and nothing carries on from it, a ridge on the skew.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Straight off the reports. Report 29 is the H; 30, 31 and 32 are the L and T
// shapes that the rectilinear builder broke.
const SHAPES = {
  'the L from report 32': [[1218,1115],[1218,1326],[1130,1326],[1130,1563],[1587,1563],[1587,1115]],
  'the L from report 31': [[1026,1193],[1026,1492],[1241,1492],[1241,1402],[1352,1402],[1352,1193]],
  'the L from report 30': [[1162,1189],[1162,1535],[1241,1535],[1241,1398],[1467,1398],[1467,1189]],
  'the H from report 29': [[921,1165],[921,1528],[1122,1528],[1122,1411],[1218,1411],[1218,1511],
                           [1462,1511],[1462,1159],[1202,1159],[1202,1247],[1118,1247],[1118,1165]],
  'a plain rectangle':    [[100,100],[500,100],[500,340],[100,340]],
  'a U':                  [[100,100],[100,500],[220,500],[220,260],[380,260],[380,500],[500,500],[500,100]],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'b@k.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'K' }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

const report = await pg.evaluate((shapes) => {
  const out = {};
  for (const [name, ol] of Object.entries(shapes)){
    const lines = buildHipValleyLines(ol).map(l => ({ type: l.type, p: l.pts || [l.a, l.b] }))
      .filter(l => l.p && l.p[0] && l.p[1]);
    const inPoly = (p) => {
      let c = false;
      for (let i = 0, j = ol.length - 1; i < ol.length; j = i++){
        const xi = ol[i][0], yi = ol[i][1], xj = ol[j][0], yj = ol[j][1];
        if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    const onWall = (p) => {
      for (let i = 0, j = ol.length - 1; i < ol.length; j = i++){
        const a = ol[i], b2 = ol[j];
        const dx = b2[0] - a[0], dy = b2[1] - a[1], L2 = dx*dx + dy*dy;
        const t = L2 ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L2)) : 0;
        if (Math.hypot(a[0] + t*dx - p[0], a[1] + t*dy - p[1]) <= 4) return true;
      }
      return false;
    };
    // Every quarter point of every line has to be inside the building.
    const strays = lines.filter(l => [0.25, 0.5, 0.75].some(t =>
      !inPoly([l.p[0][0] + (l.p[1][0]-l.p[0][0])*t, l.p[0][1] + (l.p[1][1]-l.p[0][1])*t])));
    // Junctions: an end is legal on a wall, or where two or more lines meet.
    const key = p => Math.round(p[0]/3) + ',' + Math.round(p[1]/3);
    const deg = {}, kinds = {}, nodePt = {};
    lines.forEach(l => l.p.forEach(p => {
      const k = key(p); deg[k] = (deg[k] || 0) + 1; nodePt[k] = p;
      (kinds[k] = kinds[k] || []).push(l.type);
    }));
    const dangling = [];
    lines.forEach(l => l.p.forEach(p => {
      if (deg[key(p)] < 2 && !onWall(p)) dangling.push(l.type + ' @ ' + p.map(Math.round));
    }));
    // Two hips climbing to a point with nothing carrying on is not a roof.
    const openApex = Object.keys(deg).filter(k =>
      deg[k] === 2 && kinds[k].every(t => t === 'hip'));
    // An interior point where exactly two lines meet is not a junction — the
    // roof has nothing to change direction for there. On a U the right-hand
    // valley overran its ridge end and a stub doubled back to cover it, while
    // the mirrored left-hand one landed cleanly. Both ends of every line are
    // either on a wall or at a real junction of three or more.
    const kinked = Object.keys(deg).filter(k => deg[k] === 2 &&
      !onWall(nodePt[k]));
    const skewRidge = lines.filter(l => l.type === 'ridge' &&
      Math.min(Math.abs(l.p[1][0]-l.p[0][0]), Math.abs(l.p[1][1]-l.p[0][1])) > 3);
    const reflex = (() => {
      let n = 0;
      for (let i = 0; i < ol.length; i++){
        const a = ol[(i-1+ol.length)%ol.length], b2 = ol[i], c = ol[(i+1)%ol.length];
        const cr = (b2[0]-a[0])*(c[1]-b2[1]) - (b2[1]-a[1])*(c[0]-b2[0]);
        if (cr < 0) n++;
      }
      return n;
    })();
    out[name] = { count: lines.length, strays: strays.map(l => l.type), dangling,
      openApex: openApex.length, kinked: kinked.length, skew: skewRidge.length, reflex,
      valleys: lines.filter(l => l.type === 'valley').length,
      ridges: lines.filter(l => l.type === 'ridge').length };
  }
  return out;
}, SHAPES);

for (const [name, r] of Object.entries(report)){
  check(name + ' gets a roof at all', r.count > 0, r.count + ' lines');
  check('…with nothing drawn outside the building', r.strays.length === 0, r.strays.join(', '));
  check('…nothing stopping in mid-air', r.dangling.length === 0, r.dangling.slice(0, 3).join(' | '));
  check('…no apex with two hips and no line off it', r.openApex === 0, r.openApex + ' open');
  check('…and no line doubling back on itself mid-roof', r.kinked === 0, r.kinked + ' kinks');
  check('…and every ridge level or plumb, this being a square-walled building',
    r.skew === 0, r.skew + ' on the skew');
  if (r.reflex) check('…and an inside corner is answered with a valley',
    r.valleys >= 1, r.valleys + ' valleys for ' + r.reflex + ' inside corners');
  if (!r.reflex) check('…and a plain box needs exactly one ridge', r.ridges === 1, r.ridges + ' ridges');
}
check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
