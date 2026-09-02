// "All hip and valley lines must always be forced to 45deg … shortening the
// building to a certain point snaps the hip line out of 45deg."
//
// On a building whose walls are square to each other, and one pitch, a hip
// and a valley run at exactly 45° in plan. That is not a preference, it is
// what the geometry is: the hip is the crest between two faces rising at the
// same rate off walls at right angles. So it is an invariant, and this suite
// holds it.
//
// What broke it was not the solver — the straight skeleton had it right, all
// four hips at 45° — but the tidy-up afterwards. Junctions the solver leaves
// a few pixels apart are welded together, within a radius that is a share of
// the building: on a big house, tens of pixels. A 510×533 arm has a ridge 23
// pixels long, which is REAL, and it sat entirely inside that radius. The
// hips landing on one end of it were close enough to the other end to be
// swept into the same cluster, the whole lot collapsed onto one point, and
// two hips came out 23px off 45°. It was on the plain rectangle as much as
// on the reported stair, and it moved as the building was resized — which is
// exactly what the roofer described.
//
// The fix: a ridge end is an anchor, and every other end goes to its NEAREST
// anchor, never to a further one. A ridge's own two ends are never one
// junction, however short the ridge.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The reported roof, verbatim, and the shapes around it. Every one of these
// has walls square to each other, so every hip and valley on them is 45°.
const SQUARE = {
  'the reported stair': [[134,25],[134,558],[644,558],[644,363],[875,363],[875,256],[1075,256],[1075,25]],
  'a plain rectangle, near square': [[0,0],[510,0],[510,533],[0,533]],
  'a plain rectangle, long': [[0,0],[300,0],[300,900],[0,900]],
  'a square': [[0,0],[500,0],[500,500],[0,500]],
  'an L': [[0,0],[400,0],[400,300],[900,300],[900,700],[0,700]],
  'a T': [[0,0],[900,0],[900,300],[650,300],[650,700],[250,700],[250,300],[0,300]],
  'a U': [[0,0],[250,0],[250,450],[650,450],[650,0],[900,0],[900,700],[0,700]],
  'a plus': [[300,0],[600,0],[600,300],[900,300],[900,600],[600,600],[600,900],[300,900],[300,600],[0,600],[0,300],[300,300]],
  'the H, squared up': [[-219,82],[-219,1009],[311,1009],[311,517],[650,517],[650,1044],[1146,1044],[1146,25],[650,25],[650,242],[311,242],[311,82]],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

const measure = (shapes) => pg.evaluate((s) => {
  const out = {};
  for (const [name, ol] of Object.entries(s)){
    const lines = buildHipValleyLines(ol);
    const off = [];
    lines.forEach(l => {
      if (l.type !== 'hip' && l.type !== 'valley') return;
      const dx = Math.abs(l.pts[1][0] - l.pts[0][0]), dy = Math.abs(l.pts[1][1] - l.pts[0][1]);
      if (Math.abs(dx - dy) > 1) off.push(l.type + ' ' + JSON.stringify(l.pts[0].map(Math.round)) +
        '->' + JSON.stringify(l.pts[1].map(Math.round)) + ' out by ' + Math.round(Math.abs(dx - dy)));
    });
    out[name] = { off, n: lines.length,
      hips: lines.filter(l => l.type === 'hip').length,
      valleys: lines.filter(l => l.type === 'valley').length,
      ridges: lines.filter(l => l.type === 'ridge').length };
  }
  return out;
}, shapes);

const rep = await measure(SQUARE);
for (const [name, r] of Object.entries(rep)){
  check(name + ': every hip and valley at 45°', r.off.length === 0, r.off.slice(0, 3).join(' | '));
  check('…and it got a roof at all', r.n > 0 && r.hips > 0, r.n + ' lines, ' + r.hips + ' hips');
}

// The reported fault moved as the building was resized: "shortening the
// building to a certain point snaps the hip line out of 45deg". So walk the
// wall past that point, a pixel at a time, and hold the invariant at every
// length. The ridge shrinks as the arm approaches square and comes back the
// other way round on the far side, which is the moment it used to break.
//
// One band is excepted, and named rather than papered over: while an arm is
// within a few pixels of EXACTLY square the ridge is shorter than the
// drawing's own accuracy, and the solver hands back a single apex instead of
// a two-or-three-pixel ridge. Four hips on one point cannot all be 45° on a
// 530×533 rectangle — that is arithmetic, not a bug — so there the invariant
// is held to a couple of pixels instead of one, and it is checked separately
// below so the exception cannot quietly widen.
const nearlySquare = (w, h) => Math.abs(w - h) <= 4;

const walk = {};
for (let h = 470; h <= 580; h += 2)
  walk['stair ' + h] = [[134,25],[134,25+h],[644,25+h],[644,363],[875,363],[875,256],[1075,256],[1075,25]];
const w = await measure(walk);
// The left arm is 510 wide; its depth is the number in the name.
const broke = Object.entries(w).filter(([k, r]) => r.off.length && !nearlySquare(510, +k.split(' ')[1]));
check('THE REPORT: shortening the building never knocks a hip off 45°, at any length',
  broke.length === 0, broke.length + ' of ' + Object.keys(w).length + ' lengths off — ' +
  broke.slice(0, 2).map(([k, r]) => k + ': ' + r.off[0]).join(' | '));

// The same walk on a plain rectangle, through square and out the other side,
// where the ridge flips from one axis to the other.
const sq = {};
for (let wd = 480; wd <= 560; wd += 2) sq['rect ' + wd] = [[0,0],[wd,0],[wd,533],[0,533]];
const s2 = await measure(sq);
const broke2 = Object.entries(s2).filter(([k, r]) => r.off.length && !nearlySquare(+k.split(' ')[1], 533));
check('…and neither does resizing a plain rectangle through square',
  broke2.length === 0, broke2.length + ' of ' + Object.keys(s2).length + ' off — ' +
  broke2.slice(0, 2).map(([k, r]) => k + ': ' + r.off[0]).join(' | '));

// The excepted band, held to its own limit so it cannot widen unnoticed.
const band = Object.entries(s2).filter(([k]) => nearlySquare(+k.split(' ')[1], 533));
const bandWorst = band.reduce((m, [, r]) => Math.max(m, r.off.reduce((x, t) =>
  Math.max(x, parseInt((t.match(/out by (\d+)/) || [0, 0])[1], 10)), 0)), 0);
check('…and on an arm within a few pixels of square, the apex is a point and the error stays under 3px',
  bandWorst <= 2, 'worst ' + bandWorst + 'px across ' + band.length + ' near-square widths');

// A short ridge is real and must survive. It is what the weld was eating.
const near = rep['a plain rectangle, near square'];
check('a near-square arm keeps its short ridge rather than collapsing to a point',
  near.ridges === 1 && near.hips === 4, near.ridges + ' ridges, ' + near.hips + ' hips');

// The other half of the roofer's rule: a building drawn OUT of square cannot
// have 45° hips without lying about the building, and it must not be made to.
// This is the H from report 29 as it was actually drawn — its wing is 201
// wide at the bottom and 197 at the top. Snap Square is the remedy, and the
// same outline squared up (above) comes out at 45° throughout.
const drawn = await measure({ 'as drawn': [[921,1165],[921,1528],[1122,1528],[1122,1411],[1218,1411],
  [1218,1511],[1462,1511],[1462,1159],[1202,1159],[1202,1247],[1118,1247],[1118,1165]] });
check('a building drawn out of square is shown as drawn, not forced to 45°',
  drawn['as drawn'].off.length > 0, drawn['as drawn'].off.length + ' lines follow the walls as drawn');

// Manual drawing already snaps to 45° off the wall it starts from, with
// Shift to draw free — the roofer named that as the exception, so hold it.
const snapped = await pg.evaluate(() => {
  const r = snapTo45(100, 100, 260, 180, 0);          // 160 across, 80 down, off a level wall
  return { x: Math.round(r[0]), y: Math.round(r[1]) };
});
check('drawing a hip by hand snaps it to 45° off the wall',
  Math.abs(Math.abs(snapped.x - 100) - Math.abs(snapped.y - 100)) <= 1, JSON.stringify(snapped));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
