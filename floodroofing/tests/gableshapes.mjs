// "Gable + hip/valley corner", on shapes I drew myself.
//
// The report was three photographs of an L: a hip running clean across the
// middle of the building, a ridge stopping with a free end hanging in the
// air, and a valley that never quite reached the ridge it was running to.
// The last one is the root of it. The builder walked out from the inside
// corner a pixel at a time and stopped at the first step that came within
// seven pixels of a ridge — so the valley ended up to seven pixels short of
// the junction, the ridge tips beside it were left where the arm stopped
// being the top of the roof, and every face those lines were meant to bound
// stayed open. Nothing failed, because the suites of the day asked how many
// lines came out, not whether they joined up.
//
// So this suite is structural, on a spread of shapes rather than the one that
// was reported: four orientations of an L, a fat one, a thin one, a square
// one, a rectangle, a T, a U and a Z. Every line inside the building, every
// ridge level or plumb, and — the point — every end of every line either on a
// wall, at a junction, or landing on another line.
//
// The one end allowed to stop in mid-air is the one a roofer asked for: a
// narrow link's roof runs into the side of a taller wing and dies there
// instead of climbing to its ridge. So "in mid-air" is allowed exactly where
// a taller roof stands over it, and nowhere else — and where the builder
// cannot manage that it returns nothing and the straight-skeleton solver
// takes the shape instead, which is the last check here.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const SHAPES = {
  'an L with the wing to the north-west': [[0,0],[400,0],[400,300],[900,300],[900,700],[0,700]],
  'the same L flipped north-east':        [[0,300],[500,300],[500,0],[900,0],[900,700],[0,700]],
  'and south-east':                       [[0,0],[900,0],[900,400],[400,400],[400,700],[0,700]],
  'and south-west':                       [[0,0],[900,0],[900,700],[500,700],[500,400],[0,400]],
  'a fat L, both arms wide':              [[0,0],[600,0],[600,400],[1000,400],[1000,900],[0,900]],
  'a thin L, a narrow wing':              [[0,0],[200,0],[200,500],[800,500],[800,700],[0,700]],
  'a square L':                           [[0,0],[500,0],[500,500],[1000,500],[1000,1000],[0,1000]],
  'a plain rectangle':                    [[0,0],[400,0],[400,700],[0,700]],
  'a T':                                  [[0,0],[900,0],[900,300],[650,300],[650,700],[250,700],[250,300],[0,300]],
  'a U':                                  [[0,0],[250,0],[250,450],[650,450],[650,0],[900,0],[900,700],[0,700]],
  'a Z':                                  [[0,0],[400,0],[400,300],[800,300],[800,700],[400,700],[400,400],[0,400]],
  'a plus, four arms to a middle':        [[300,0],[600,0],[600,300],[900,300],[900,600],[600,600],[600,900],
                                           [300,900],[300,600],[0,600],[0,300],[300,300]],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

const report = await pg.evaluate((shapes) => {
  const out = {};
  for (const [name, ol] of Object.entries(shapes)){
    const lines = buildGableRoofLines_legacy(ol)
      .map(l => ({ t: l.type, a: l.pts[0], b: l.pts[1] }))
      .filter(l => l.a && l.b && l.t !== 'eave');
    const inPoly = (p) => {
      let c = false;
      for (let i = 0, j = ol.length - 1; i < ol.length; j = i++){
        const xi = ol[i][0], yi = ol[i][1], xj = ol[j][0], yj = ol[j][1];
        if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    const wallDist = (p) => {
      let best = Infinity;
      for (let i = 0, j = ol.length - 1; i < ol.length; j = i++){
        const a = ol[i], b2 = ol[j];
        const dx = b2[0]-a[0], dy = b2[1]-a[1], L2 = dx*dx + dy*dy;
        const t = L2 ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L2)) : 0;
        best = Math.min(best, Math.hypot(a[0] + t*dx - p[0], a[1] + t*dy - p[1]));
      }
      return best;
    };
    // A barge runs down the gable wall itself, so it is on the outline, not
    // inside it. Everything else has to be within the building.
    const strays = lines.filter(l => l.t !== 'barge' && [0.25, 0.5, 0.75].some(t =>
      !inPoly([l.a[0] + (l.b[0]-l.a[0])*t, l.a[1] + (l.b[1]-l.a[1])*t]))).map(l => l.t);
    const key = p => Math.round(p[0]/2) + ',' + Math.round(p[1]/2);
    const deg = {};
    lines.forEach(l => [l.a, l.b].forEach(p => { deg[key(p)] = (deg[key(p)] || 0) + 1; }));
    // Landing part-way along another line is a junction too — a valley meets
    // a ridge that carries on past it, and a wing's ridge tees into the ridge
    // crossing it.
    const onOther = (p, self) => lines.some(l => {
      if (l === self) return false;
      const dx = l.b[0]-l.a[0], dy = l.b[1]-l.a[1], L2 = dx*dx + dy*dy;
      if (L2 < 1) return false;
      const t = ((p[0]-l.a[0])*dx + (p[1]-l.a[1])*dy) / L2;
      if (t < 0.002 || t > 0.998) return false;
      return Math.hypot(l.a[0] + t*dx - p[0], l.a[1] + t*dy - p[1]) <= 2;
    });
    const loose = [];
    lines.forEach(l => [l.a, l.b].forEach(p => {
      if (deg[key(p)] >= 2 || wallDist(p) <= 2.5 || onOther(p, l)) return;
      loose.push(l.t + ' @ ' + p.map(Math.round));
    }));
    const skew = lines.filter(l => l.t === 'ridge' &&
      Math.min(Math.abs(l.b[0]-l.a[0]), Math.abs(l.b[1]-l.a[1])) > 1).map(l =>
        JSON.stringify(l.a) + '->' + JSON.stringify(l.b));
    // A gable end is two barges meeting at one peak.
    const peaks = {};
    lines.filter(l => l.t === 'barge').forEach(l => { const k = key(l.b); peaks[k] = (peaks[k]||0)+1; });
    const reflex = (() => {
      let n = 0;
      for (let i = 0; i < ol.length; i++){
        const a = ol[(i-1+ol.length)%ol.length], b2 = ol[i], c = ol[(i+1)%ol.length];
        if ((b2[0]-a[0])*(c[1]-b2[1]) - (b2[1]-a[1])*(c[0]-b2[0]) < 0) n++;
      }
      return n;
    })();
    // Two ends a few pixels apart are one junction the builder missed. This
    // is the reported fault in its purest form: the valley stopped seven
    // pixels short of the ridge junction it was running to, which reads on
    // screen as a line not quite arriving and leaves the face open.
    const pts = [];
    lines.forEach(l => [l.a, l.b].forEach(p => {
      if (!pts.some(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 0.5)) pts.push(p);
    }));
    const nearMiss = [];
    for (let i = 0; i < pts.length; i++) for (let j = i+1; j < pts.length; j++)
      if (Math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1]) <= 8)
        nearMiss.push(pts[i].map(Math.round) + ' / ' + pts[j].map(Math.round));
    const hips = lines.filter(l => l.t === 'hip');
    const is45 = l => Math.abs(Math.abs(l.b[0]-l.a[0]) - Math.abs(l.b[1]-l.a[1])) <= 1.5;
    // The T's stem: hips coming off the ridge that runs the other way.
    const stem = lines.filter(l => l.t === 'ridge' && Math.abs(l.a[0]-l.b[0]) < 1);
    const stemTip = stem.length ? [stem[0].a, stem[0].b].sort((p,q) => p[1]-q[1])[0] : null;
    const touching = p => hips.filter(l =>
      Math.hypot(l.a[0]-p[0], l.a[1]-p[1]) < 2 || Math.hypot(l.b[0]-p[0], l.b[1]-p[1]) < 2);
    // The fat L: does the hip off the outside corner reach the taller arm's
    // ridge line, or stop at the first ridge it meets?
    const tall = lines.filter(l => l.t === 'ridge' && Math.abs(l.a[0]-l.b[0]) < 1);
    const hipEnds = hips.map(l => JSON.stringify(l.a) + '->' + JSON.stringify(l.b)).join(' ');
    const reaches = tall.length && hips.some(l => [l.a, l.b].some(p =>
      Math.abs(p[0] - tall[0].a[0]) <= 2));
    const apexes = {};
    lines.filter(l => l.t === 'valley').forEach(l => { const k = key(l.b); apexes[k] = (apexes[k]||0)+1; });
    out[name] = { nearMiss, count: lines.length,
      hips: stemTip ? touching(stemTip).length : hips.length,
      hips45: stemTip ? touching(stemTip).filter(is45).length : hips.filter(is45).length,
      hipToTallRidge: !!reaches, hipEnds: hipEnds.slice(0, 90),
      apex: Object.values(apexes).filter(v => v >= 3).length, strays, loose, skew, reflex,
      gableEnds: Object.values(peaks).filter(v => v >= 2).length,
      valleys: lines.filter(l => l.t === 'valley').length,
      ridges: lines.filter(l => l.t === 'ridge').length };
  }
  return out;
}, SHAPES);

for (const [name, r] of Object.entries(report)){
  check(name + ' gets a roof', r.count > 0, r.count + ' lines');
  check('…with nothing drawn outside the building', r.strays.length === 0, r.strays.join(', '));
  check('…and no line left hanging in mid-air', r.loose.length === 0, r.loose.slice(0, 3).join(' | '));
  check('…every ridge level or plumb, the walls being square', r.skew.length === 0, r.skew.join('  '));
  check('…and nothing stopping a few pixels short of the junction it runs to',
    r.nearMiss.length === 0, r.nearMiss.slice(0, 2).join(' | '));
  check('…and at least one proper gable end, two barges to a peak',
    r.gableEnds >= 1, r.gableEnds + ' gable ends');
  if (r.reflex) check('…and an inside corner answered with a valley',
    r.valleys >= 1, r.valleys + ' valleys for ' + r.reflex + ' inside corners');
  else check('…and a plain box needs one ridge and no more', r.ridges === 1, r.ridges + ' ridges');
}

// Three things the roofer named, one shape each.
//
// A ridge that runs into a bigger arm does not climb onto it. Where the
// valleys land on the bigger ridge a hip comes back off each at 45°, and
// where those two meet is where this arm's ridge ends. On the T that used to
// be a stub hanging in mid-air; briefly it was a ridge stretched along the
// top of the other roof, which is worse.
const T = report['a T'];
check('the T: the stem ridge stops short of the ridge it runs into',
  T.hips === 2, T.hips + ' hips off the stem');
check('…with a hip back at 45° from each place a valley lands',
  T.hips45 === 2, T.hips45 + ' of them at 45°');

// And the hip off an outside corner runs all the way in, to the ridge of the
// arm whose roof is the higher — not stopping at the first ridge it crosses.
const F = report['a fat L, both arms wide'];
check('the fat L: the hip carries on to the taller arm\'s ridge line',
  F.hipToTallRidge, F.hipEnds);

// Four arms all the same height meeting in a middle that is higher than any
// of them. Every arm's ridge carries on to the crest, and all four inside
// corners get their valley — two of them used to be missing.
const P = report['a plus, four arms to a middle'];
check('the plus: a valley out of every one of its four inside corners',
  P.valleys === 4, P.valleys + ' valleys');
check('…all meeting at one point in the middle', P.apex === 1, P.apex + ' meeting points');

// A building with an angled wall is not this builder's job — it works from a
// grid of wall lines — and it has to say so rather than guess, because the
// straight-skeleton solver behind it handles those.
const ANGLED = [[0,0],[600,0],[900,300],[900,800],[0,800]];
const stood = await pg.evaluate((ol) => ({
  rect: buildRectilinearRoofLines(ol, true),
  full: buildGableRoofLines_legacy(ol).length,
}), ANGLED);
check('on a shape it cannot do, the shape builder answers nothing at all',
  stood.rect === null, stood.rect === null ? 'stood aside' : stood.rect.length + ' lines returned');
check('…and the roof still gets drawn, by the solver behind it', stood.full > 4, stood.full + ' lines');

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
