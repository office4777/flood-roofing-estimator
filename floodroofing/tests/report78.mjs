// FEEDBACK REPORTS 78 AND 79 (2026-10-28, the owner on job 3302). A short wall
// standing out from a straight one — a BUMP — on a hip roof:
//   78: "when dragging a corner, inside the fine adjustments window that appears
//   with the arrows, can it also show a button to convert this section/corner
//   from hip & valley to mono-extension because as you can see from the
//   background, the roof extends slightly but it doesn't have hip and valley
//   like what appears if i go too far"
//   79: "this is fix two, showing i pulled it too far and it converted to a hip
//   & valley (i also don't want it to auto change to a mono-extension if i make
//   it short like what fix 1 shows)"
// The builder decided the KIND of roof over the bump from its depth: under
// _roofSquareUp's squaring tolerance (about 0.5 m on his roof) it was squared
// into the wall, over it it got its own little hip end. Now the office decides:
// two buttons on the corner pad, and grabbing a bump's corner fixes the kind on
// screen so a drag never changes it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => {
  const e = document.getElementById(i); if (e) e.remove(); }); });

// His roof (report 78's geometry): the bump is corners 4–7, its outer corners 5 and 6.
const build = (depth) => pg.evaluate((d) => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.029851033982678972; DRAW.calPitch = 15;
  DRAW.outline = [[989,567],[989,753],[1447,753],[1447,425],[1334,425],[1334,425-d],[1196,425-d],[1196,425],[1153,425],[1153,487],[1054,487],[1054,567]];
  DRAW.outlineDone = true;
  autoGenerateRoof('hip'); setTool('select');
  DRAW.zoom = 0.7; redrawAll();   // his roof is wider than the test canvas at 100%
}, depth);
const state = () => pg.evaluate(() => {
  const o = DRAW.outline, cs = [4,5,6,7].map(i => o[i]);
  const near = (p, c) => Math.hypot(p[0]-c[0], p[1]-c[1]) < 4;
  const atBump = DRAW.lines.filter(l => (l.type === 'hip' || l.type === 'valley') && l.pts.some(p => cs.some(c => near(p, c))));
  const side = (a, c) => DRAW.lines.filter(l => l.pts.length === 2 && ((near(l.pts[0], a) && near(l.pts[1], c)) || (near(l.pts[0], c) && near(l.pts[1], a)))).map(l => l.type);
  const mainHips = DRAW.lines.filter(l => l.type === 'hip' && l.pts.some(p => near(p, [1153,425]) || near(p, [1447,425])));
  const row = document.getElementById('cornerBumpRow');
  return { hvAtBump: atBump.length, sideL: side(o[4], o[5]), sideR: side(o[6], o[7]),
           outer: side(o[5], o[6]), depth: +(425 - o[5][1]).toFixed(1),
           mainHip45: mainHips.length === 2 && mainHips.every(l => { const dx = Math.abs(l.pts[1][0]-l.pts[0][0]), dy = Math.abs(l.pts[1][1]-l.pts[0][1]); return Math.abs(dx - dy) < 1.5; }),
           modes: JSON.stringify(DRAW.bumpModes || null),
           row: row && row.style.display !== 'none' ? row.innerText.replace(/\s+/g, ' ').trim() : '',
           on: row ? [...row.querySelectorAll('.crn-bump.on')].map(x => x.dataset.bump).join() : '' };
});

// ── the bump is found, and only that ──
let v = await (async () => { await build(15); return pg.evaluate(() => _outlineBumps(DRAW.outline).map(b => [b.a, b.b, b.c, b.d])); })();
check('his outline has one bump: corners 4 to 7', JSON.stringify(v) === '[[4,5,6,7]]', JSON.stringify(v));

// ── report 78: shallow, the main roof carried over it ──
v = await state();
check('report 78 as he drew it: no hip or valley at the bump (the slope carries over it)', v.hvAtBump === 0, JSON.stringify(v));

// A REAL drag on corner 5, the way he did it: the pad opens with the switch.
await pg.evaluate(() => { document.getElementById('roofCanvas').scrollIntoView({ block:'center' }); });
await pg.waitForTimeout(250);
const loc = await pg.evaluate(() => {
  const t = getImgTransform(), c = imgToCanvas(DRAW.outline[5], t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1], s: t.s };
});
await pg.mouse.move(loc.x, loc.y);
await pg.mouse.down();
await pg.mouse.move(loc.x, loc.y - 20 * loc.s, { steps: 8 });   // 20 image px deeper: past where it used to turn hip & valley
await pg.mouse.up();
await pg.waitForTimeout(250);
v = await state();
check('grabbing the bump\'s corner opens the pad with "This bump\'s roof": Hip & valley | Mono extension',
  /This bump.s roof/i.test(v.row) && /Hip & valley/.test(v.row) && /Mono extension/.test(v.row), v.row);
check('…the kind on screen is the one ticked, and it is remembered', v.on === 'mono' && v.modes === '{"5":"mono"}', v.on + ' ' + v.modes);
check('REPORT 79: dragged deeper it STAYS a mono extension — no hip or valley sprouts', v.depth > 25 && v.hvAtBump === 0, JSON.stringify(v));
check('…its sides are barges and its end is gutter', v.sideL.join() === 'barge' && v.sideR.join() === 'barge' && v.outer.includes('gutter'), JSON.stringify([v.sideL, v.sideR, v.outer]));
check('…and the main hips run at 45° from the main corners, ignoring the bump', v.mainHip45, JSON.stringify(v));

// ── the button makes it hip & valley, and shallow does not undo that ──
v = await pg.evaluate(() => { document.querySelector('#cornerBumpRow [data-bump="hv"]').click(); return null; });
v = await state();
check('"Hip & valley" gives the bump its own hip end: two hips, two valleys', v.hvAtBump === 4 && v.on === 'hv' && v.modes === '{"5":"hv"}', JSON.stringify(v));
check('…with gutters round all of it, the short sides too', v.sideL.join() === 'gutter' && v.sideR.join() === 'gutter', JSON.stringify([v.sideL, v.sideR]));
await pg.evaluate(() => { for (let k = 0; k < 85; k++) _cornerRepoNudge(0, 1); });   // 0.85 m shallower, to ~0.2 m deep
v = await state();
check('REPORT 79\'s other half: made SHORT it stays hip & valley — never turns mono by itself',
  v.depth < 10 && v.depth > 0 && v.hvAtBump === 4, JSON.stringify(v));

// ── and back ──
await pg.evaluate(() => _bumpSetMode('mono'));
v = await state();
check('"Mono extension" takes the hip end off again at any depth', v.hvAtBump === 0 && v.sideL.join() === 'barge' && v.on === 'mono', JSON.stringify(v));

// ── report 79's own roof: deep, built hip & valley; the button fixes it ──
await build(26);
v = await state();
check('report 79 as he drew it: hip & valley over the deeper bump', v.hvAtBump === 4, JSON.stringify(v));
await pg.evaluate(() => _cornerRepoOpen(6));
v = await state();
check('…the pad shows Hip & valley ticked', v.on === 'hv' && v.modes === '{"5":"hv"}', v.on + ' ' + v.modes);
const tallies = await pg.evaluate(() => {
  const t = () => { try { const r = _sheetPuzzleBuild({}); return { n: (r.tally || []).reduce((a, x) => a + (x.n || x.count || 0), 0), extra: JSON.stringify(r.tally).includes('extra') }; } catch(e){ return { err: e.message }; } };
  const before = t(); _bumpSetMode('mono'); const after = t();
  return { before, after };
});
v = await state();
check('…Mono extension takes the little hip end away', v.hvAtBump === 0 && v.sideL.join() === 'barge', JSON.stringify(v));
check('…and the sheet layout orders fewer sheets and no extras for it',
  tallies.after.n > 0 && tallies.after.n < tallies.before.n && !tallies.after.extra, JSON.stringify(tallies));

v = await pg.evaluate(() => { undoLast(); const a = JSON.stringify(DRAW.bumpModes); redoLast(); return a + ' ' + JSON.stringify(DRAW.bumpModes); });
check('Undo puts the last choice back, and Redo the new one', v === '{"5":"hv"} {"5":"mono"}', v);

// ── saved with the job ──
v = await pg.evaluate(() => {
  const snap = JSON.parse(JSON.stringify(snapshotCurrentJob()));
  DRAW.bumpModes = null;
  restoreFromJob({ id: 'r78', client_name: 'X', site_address: 'Y', draw_state: snap });
  return JSON.stringify(DRAW.bumpModes);
});
check('the choice is saved with the job', v === '{"5":"mono"}', v);

// ── where it is not offered ──
v = await pg.evaluate(() => { _cornerRepoOpen(0); const r = document.getElementById('cornerBumpRow'); return r.style.display; });
check('a corner that is not a bump shows no switch', v === 'none', v);
v = await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 15;
  DRAW.outline = [[989,567],[989,753],[1447,753],[1447,425],[1334,425],[1334,399],[1196,399],[1196,425],[1153,425],[1153,487],[1054,487],[1054,567]];
  DRAW.outlineDone = true; autoGenerateRoof('gable');
  _cornerRepoOpen(5); return document.getElementById('cornerBumpRow').style.display + ' ' + JSON.stringify(DRAW.bumpModes || null);
});
check('…nor a gable roof, which is not touched', v === 'none null', v);

// ── nothing moves for a roof nobody has set ──
v = await pg.evaluate(() => {
  const ol = [[989,567],[989,753],[1447,753],[1447,425],[1334,425],[1334,410],[1196,410],[1196,425],[1153,425],[1153,487],[1054,487],[1054,567]];
  clearAll(true); DRAW.outline = ol.map(p => p.slice()); DRAW.bumpModes = null;
  const a = JSON.stringify(_hipLinesWithBumps(DRAW.outline)), b = JSON.stringify(buildHipValleyLines(ol.map(p => p.slice())));
  return a === b;
});
check('with no choice made the hip roof is built exactly as before', v);

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
