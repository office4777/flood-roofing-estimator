// FEEDBACK REPORT 84 (2026-11-05, job FR-59839 / Fergus 3350: "straight gable
// not good, barges showing outside of outline and the barge sides are showing
// a gutters"). His 20.4 x 16.3 m shed, shape "Gable + hip/valley corner",
// turned 90°: the built lines were spun about the middle, so the 20.4 m ridge
// stood 2 m past both walls, the barges hung outside, and all four walls were
// re-laid as gutters. The same spin broke a hip and a dutch gable on any
// outline that is not a square. A turn now rebuilds the roof the other way
// (gable-hv on four corners is a straight gable) and only spins lines on an
// outline the turn lays back on itself.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1500, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? '{"branding":{"company_name":"Flood Roofing"}}' : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

const OUT = [[1169,543],[1169,748],[1426,748],[1426,543]];
const build = (type, rot, outline) => pg.evaluate(({ type, rot, outline }) => {
  DRAW.outline = outline.map(p => p.slice()); DRAW.lines = []; DRAW.scaleMetresPerPx = 0.07934450541556741;
  DRAW.calPitch = 15; DRAW.rotation = 0; DRAW.roofType = type;
  autoGenerateRoof(type, rot); DRAW.rotation = rot;
  const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const c = {}; DRAW.lines.forEach(l => c[l.type] = (c[l.type] || 0) + 1);
  return { outside: DRAW.lines.filter(l => l.pts.some(p => p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1)).length,
    c, ridge: (DRAW.lines.find(l => l.type === 'ridge') || {}).pts,
    barges: DRAW.lines.filter(l => l.type === 'barge').map(l => l.pts),
    gutters: DRAW.lines.filter(l => l.type === 'gutter').map(l => l.pts),
    aprons: DRAW.lines.filter(l => l.type === 'apron').map(l => l.pts) };
}, { type, rot, outline });

let v = await build('gable-hv', 0, OUT);
check('his shed as built: ridge along the long walls, barges on the short ones', v.outside === 0 && v.c.ridge === 1 && v.c.barge === 4 && v.c.gutter === 2 &&
  v.ridge[0][1] === 645.5 && v.ridge[1][1] === 645.5, JSON.stringify(v.c));
v = await build('gable-hv', 90, OUT);
check('turned 90°: nothing stands outside the outline (was the ridge and four barges 26 px out)', v.outside === 0, JSON.stringify(v));
check('…the ridge runs across the other way, wall to wall', v.ridge && Math.abs(v.ridge[0][0] - 1297.5) < 0.6 && Math.abs(v.ridge[1][0] - 1297.5) < 0.6 &&
  Math.min(v.ridge[0][1], v.ridge[1][1]) === 543 && Math.max(v.ridge[0][1], v.ridge[1][1]) === 748, JSON.stringify(v.ridge));
check('…the barges are on the two walls the ridge meets, the gutters on the other two (was four gutters)',
  v.c.barge === 4 && v.c.gutter === 2 && v.barges.every(p => (p[0][1] === 543 && p[1][1] === 543) || (p[0][1] === 748 && p[1][1] === 748)) &&
  v.gutters.every(p => p[0][0] === p[1][0]), JSON.stringify(v));
v = await build('gable-hv', 180, OUT);
check('turned twice it is back as it was', v.outside === 0 && v.ridge[0][1] === 645.5, JSON.stringify(v.ridge));

// The corner-drag rebuild keeps the turn
v = await pg.evaluate(() => {
  DRAW.outline = [[1169,543],[1169,748],[1426,748],[1426,543]]; DRAW.lines = []; DRAW.rotation = 0; DRAW.roofType = 'gable-hv';
  autoGenerateRoof('gable-hv', 90); DRAW.rotation = 90;
  DRAW.outline[2][0] = 1440; DRAW.outline[3][0] = 1440;
  regenerateAutoRoofLines('gable-hv');
  const r = DRAW.lines.find(l => l.type === 'ridge').pts;
  return { r, out: DRAW.lines.filter(l => l.pts.some(p => p[0] < 1168 || p[0] > 1441 || p[1] < 542 || p[1] > 749)).length };
});
check('a corner dragged afterwards keeps the roof turned, inside the walls', v.out === 0 && v.r[0][0] === v.r[1][0], JSON.stringify(v));

// Hip and dutch on a rectangle: a turn has nothing to change, and nothing hangs outside
for (const t of ['hip', 'dutch']){
  const a = await build(t, 0, OUT), c = await build(t, 90, OUT);
  check(t + ' on a rectangle turned 90°: inside the walls and the same roof', c.outside === 0 && JSON.stringify(c.ridge) === JSON.stringify(a.ridge) && JSON.stringify(c.c) === JSON.stringify(a.c),
    JSON.stringify([a.ridge, c.ridge, c.c]));
}
// A square lands on itself, so its lines may still be turned — and stay inside
{
  const SQ = [[400,400],[400,600],[600,600],[600,400]];
  for (const t of ['hip', 'dutch']){ const c = await build(t, 90, SQ); check(t + ' on a square turned 90° stays inside its walls', c.outside === 0 && Object.keys(c.c).length > 0, JSON.stringify(c.c)); }
}
// An L in gable + hip/valley: a turn leaves it inside its walls
{
  const L = [[100,100],[700,100],[700,300],[400,300],[400,600],[100,600]];
  const a = await build('gable-hv', 90, L);
  check('an L in Gable + hip/valley corner, turned, stays inside its walls', a.outside === 0 && a.c.ridge >= 1, JSON.stringify(a.c));
}
// The other shapes, turned, never leave the outline
for (const t of ['gable', 'stepgable', 'mono']){
  const c = await build(t, 90, OUT);
  check(t + ' turned 90° stays inside the walls', c.outside === 0, JSON.stringify(c.c));
}

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
