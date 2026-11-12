// FEEDBACK REPORT 21 (2026-11-13, ethan@ on job 3351): "when I'm moving a
// corner, say the bottom left corner from the gutter length 13.08 where it
// meets 7.18 ... when I drag it to the left, it also moves the top left corner
// where the two gutters 6.73 and 9.95 meters meet. It moves that whole corner
// at the same time to force it to keep in line, where that's wrong."
//
// Every corner edit rebuilds the roof, and the rebuild first squared the
// DRAWING with _roofSquareUp — which treats two different walls within ~5% of
// the building's span as one wall. A corner moved half a metre off the line of
// another wall was averaged back with it. The drawing now squares each wall on
// its own; the roof is still built on the tidied shape.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);

// His roof, as the report printed it.
const OUT = [[1072,541],[1072,628],[1188,628],[1188,776],[1269,776],[1269,628],[1301,628],[1301,465],[1188,465],[1188,541]];
const build = () => pg.evaluate((o) => {
  ['setupWizard', '_rsModal', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0885445205014095; DRAW.calPitch = 15;
  DRAW.outline = o.map(p => p.slice()); DRAW.outlineDone = true;
  autoGenerateRoof('hip'); setTool('select'); DRAW.zoom = 0.5; redrawAll();
  document.getElementById('roofCanvas').scrollIntoView({ block: 'center' });
}, OUT);
const outline = () => pg.evaluate(() => DRAW.outline.map(p => [Math.round(p[0]), Math.round(p[1])]));
const drag = async (idx, dx, dy) => {
  const loc = await pg.evaluate((i) => { const t = getImgTransform(), c = imgToCanvas(DRAW.outline[i], t), r = document.getElementById('roofCanvas').getBoundingClientRect(); return { x: r.left + c[0], y: r.top + c[1], s: t.s }; }, idx);
  await pg.mouse.move(loc.x, loc.y); await pg.mouse.down();
  await pg.mouse.move(loc.x + dx * loc.s, loc.y + dy * loc.s, { steps: 10 });
  const mid = await outline();
  await pg.mouse.up(); await pg.waitForTimeout(250);
  return { mid, after: await outline() };
};

await build();
check('his roof is built as he had it (the top-left corners on the line of the 13.08 m wall)', JSON.stringify(await outline()) === JSON.stringify(OUT), JSON.stringify(await outline()));

// THE REPORT: a short drag of the bottom-left corner of the 13.08 m wall.
for (const [dx, dy] of [[-8, 0], [-5, -3], [-8, 4]]){
  await build();
  const r = await drag(3, dx, dy);
  const o = r.after;
  check('dragging that corner ' + Math.abs(dx) + 'px left moves only its own wall — the 6.73 / 9.95 m corner stays put',
    o[8][0] === 1188 && o[9][0] === 1188 && o[8][1] === 465 && o[9][1] === 541 &&
    r.mid[8][0] === 1188 && r.mid[9][0] === 1188 && o[3][0] < 1188 && o[2][0] === o[3][0],
    JSON.stringify({ mid: r.mid, after: o }));
  check('…the moved wall stays plumb and its corners square', o[2][0] === o[3][0] && o[3][1] === o[4][1], JSON.stringify(o));
}
// A long drag always was fine, and still is.
await build();
let r = await drag(3, -40, 0);
check('a long drag the same: only the 13.08 m wall moves', r.after[8][0] === 1188 && r.after[9][0] === 1188 && r.after[3][0] === 1148, JSON.stringify(r.after));

// The roof is still built: hips and valleys, nothing outside the building.
const roof = await pg.evaluate(() => {
  const o = DRAW.outline, xs = o.map(p => p[0]), ys = o.map(p => p[1]);
  const inBox = p => p[0] >= Math.min(...xs) - 1 && p[0] <= Math.max(...xs) + 1 && p[1] >= Math.min(...ys) - 1 && p[1] <= Math.max(...ys) + 1;
  const struct = DRAW.lines.filter(l => ['hip', 'valley', 'ridge'].includes(l.type));
  return { n: struct.length, inside: struct.every(l => l.pts.every(inBox)) };
});
check('…and the roof is rebuilt over it, inside the building', roof.n >= 8 && roof.inside, JSON.stringify(roof));

// The nudge pad, a hundredth of a metre at a time.
await build();
const nudged = await pg.evaluate(() => {
  window._cornerRepo = window._cornerRepo || {}; window._cornerRepo.idx = 3;
  for (let i = 0; i < 30; i++) _cornerRepoNudge(-1, 0);
  return DRAW.outline.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]);
});
check('the nudge pad moves the corner 0.30 m and leaves the other wall where it is',
  nudged[8][0] === 1188 && nudged[9][0] === 1188 && Math.abs(nudged[3][0] - (1188 - 0.30 / 0.0885445205014095)) < 0.05,
  JSON.stringify(nudged));

// A fresh hand trace is still tidied: a wall drawn 3px out of plumb comes straight.
const traced = await pg.evaluate(() => {
  clearAll(true); DRAW.scaleMetresPerPx = 0.03;
  DRAW.outline = [[200,300],[800,300],[802,600],[200,600]]; DRAW.outlineDone = true;
  autoGenerateRoof('hip'); regenerateAutoRoofLines('hip');
  return DRAW.outline.map(p => [Math.round(p[0]), Math.round(p[1])]);
});
check('a wall traced a few pixels out of plumb is still squared', traced[1][0] === traced[2][0], JSON.stringify(traced));

check('nothing threw', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
