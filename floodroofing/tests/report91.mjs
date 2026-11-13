// FEEDBACK REPORT 91 (2026-11-13, job 3351): "snaps out of square, when i
// moved the clicked corner across it snaps the 3x valleys, 2x ridges and 1x
// hip together out of 45deg, it should always keep true 45deg no matter how
// close together the corners are, only when holding down the shift button
// should it be able to lock in out of 45deg".
//
// The roof builder squares the outline again with _roofSquareUp, which merges
// two DIFFERENT walls within ~5% of the building's span into one. Dragging the
// stem's left wall 11px off the line of the main block's left wall merged the
// two at 1182.5, so the roof was worked out on a building that is not there and
// every line off the moved corner, put back on the real corner, came out bent.
// Once a corner has been MOVED (drag, nudge, typed length) the roof is built on
// the walls where the office put them: DRAW.trueWalls.
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

// His roof before the drag (report 91's screenshot 3), the stem flush with the main block.
const OUT = [[1072,541],[1072,628],[1188,628],[1188,778],[1269,778],[1269,628],[1300,628],[1300,467],[1188,467],[1188,541]];
const build = (o, bm) => pg.evaluate(([o, bm]) => {
  ['setupWizard', '_rsModal', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0885445205014095; DRAW.calPitch = 15;
  DRAW.outline = o.map(p => p.slice()); DRAW.outlineDone = true;
  autoGenerateRoof('hip'); if (bm) { DRAW.bumpModes = bm; regenerateAutoRoofLines('hip'); }
  setTool('select'); DRAW.zoom = 0.5; redrawAll();
  document.getElementById('roofCanvas').scrollIntoView({ block: 'center' });
}, [o, bm || null]);
const angles = () => pg.evaluate(() => DRAW.lines.filter(l => ['hip', 'valley', 'ridge'].includes(l.type)).map(l => {
  const [a, c] = l.pts, dx = Math.abs(c[0] - a[0]), dy = Math.abs(c[1] - a[1]);
  if (dx < 0.01 && dy < 0.01) return { t: l.type, deg: 0 };
  return { t: l.type, deg: +(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) };
}));
const bad = (ls) => ls.filter(l => l.t === 'ridge' ? !(l.deg === 0 || l.deg === 90) : Math.abs(l.deg - 45) > 0.05);
const drag = async (idx, dx, dy, shift) => {
  const loc = await pg.evaluate((i) => { const t = getImgTransform(), c = imgToCanvas(DRAW.outline[i], t), r = document.getElementById('roofCanvas').getBoundingClientRect(); return { x: r.left + c[0], y: r.top + c[1], s: t.s }; }, idx);
  if (shift) await pg.keyboard.down('Shift');
  await pg.mouse.move(loc.x, loc.y); await pg.mouse.down();
  await pg.mouse.move(loc.x + dx * loc.s, loc.y + dy * loc.s, { steps: 12 });
  const mid = await angles();
  await pg.mouse.up(); if (shift) await pg.keyboard.up('Shift'); await pg.waitForTimeout(250);
  return mid;
};
const outl = () => pg.evaluate(() => DRAW.outline.map(p => [Math.round(p[0]), Math.round(p[1])]));

await build(OUT, { 0: 'hv', 3: 'hv' });
check('as drawn, every hip and valley is 45° and every ridge level or plumb', bad(await angles()).length === 0, JSON.stringify(bad(await angles())));

// THE REPORT: the stem's bottom-left corner dragged 11px left, off the main block's wall.
for (const dx of [-11, -6, -3, -18]){
  await build(OUT, { 0: 'hv', 3: 'hv' });
  const mid = await drag(3, dx, 0);
  const o = await outl(), ls = await angles();
  check('stem corner dragged ' + Math.abs(dx) + 'px off the main wall: the corner went where it was put',
    o[3][0] < 1188 && Math.abs(o[3][0] - (1188 + dx)) <= 2 && o[8][0] === 1188 && o[9][0] === 1188, JSON.stringify(o));
  check('…every hip and valley stays a true 45°, every ridge level or plumb (after the drag)', bad(ls).length === 0, JSON.stringify(bad(ls)));
  check('…and during it', bad(mid).length === 0, JSON.stringify(bad(mid)));
}
// The same with no bump choice made, and from the nudge pad.
await build(OUT);
await drag(3, -11, 0);
check('with no bump choice made, a dragged corner keeps the roof at 45° too', bad(await angles()).length === 0, JSON.stringify(bad(await angles())));
await build(OUT, { 0: 'hv', 3: 'hv' });
await pg.evaluate(() => { window._cornerRepo = window._cornerRepo || {}; window._cornerRepo.idx = 3; for (let i = 0; i < 100; i++) _cornerRepoNudge(-1, 0); });
check('the nudge pad, a metre over: true 45° throughout', bad(await angles()).length === 0, JSON.stringify(bad(await angles())));
// It is the roof's: saved with it, and a rebuild later keeps it.
const kept = await pg.evaluate(() => { const s = snapshotCurrentJob(); const tw = !!(s && s.draw && s.draw.trueWalls); regenerateAutoRoofLines('hip'); return tw; });
check('…the roof remembers it (saved with the job) and a later rebuild stays at 45°', kept && bad(await angles()).length === 0, JSON.stringify(bad(await angles())));
const fresh = await pg.evaluate(() => { clearAll(true); return !!DRAW.trueWalls; });
check('a new job starts without it', fresh === false);

check('nothing threw', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
