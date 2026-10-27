// THE RIDGE / VALLEY JUNCTION IS DRAGGABLE (2026-10-14).
//
// The owner: "it won't let me click that junction where the two valleys meet
// the ridge to drag it keeping it inline with the connecting ridge".
//
// The solver puts the ridge end where the straight skeleton says it goes, and
// on a real building that is often a foot out — but the only way to move it
// was to delete the generated structure and draw three lines by hand. An
// outline CORNER has had a grab handle and a nudge pad for a year; a junction
// had neither, and it is the same kind of point.
//
// What this must never become is a change to the roof engine, which this repo
// records as broken twice. The lines are already built; moving a junction is
// an edit to the drawn lines, the same shape as the endpoint drag that has
// always existed. The hard assertions here are that the move is CONSTRAINED
// to the ridge, that every line meeting the junction follows it, and that the
// measurements come out right.
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

const build = () => pg.evaluate(() => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  DRAW.outline = [[200,200],[800,200],[800,520],[200,520]]; DRAW.outlineDone = true;
  regenerateAutoRoofLines('hip'); redrawAll(); setTool('select');
});
await build();
await pg.waitForTimeout(300);

// ── a junction is a point three generated lines share ─────────────
const found = await pg.evaluate(() => {
  const js = _roofJunctions();
  return { n: js.length,
           kinds: js.map(j => j.ends.map(e => e.type).sort().join('+')),
           axes: js.map(j => !!_junctAxis(j)),
           pts: js.map(j => j.pt.map(n => Math.round(n))) };
});
check('both ridge ends of a hip roof are junctions',
  found.n === 2 && found.kinds.every(k => k === 'hip+hip+ridge'), JSON.stringify(found.kinds));
check('…each with a ridge to stay in line with',
  found.axes.every(Boolean), JSON.stringify(found.axes));

// A gutter corner is the OUTLINE's to move, so it is not offered here.
const nog = await pg.evaluate(() => _roofJunctions().some(j =>
  j.ends.some(e => e.type === 'gutter' || e.type === 'barge')));
check('…and a gutter or barge end is never one of them', nog === false);

// ── the drag runs along the ridge and nowhere else ────────────────
await pg.evaluate(() => { document.getElementById('roofCanvas').scrollIntoView({ block:'center' }); });
await pg.waitForTimeout(250);
const loc = await pg.evaluate(() => {
  const j = _roofJunctions()[0], t = getImgTransform(), c = imgToCanvas(j.pt, t);
  const r = document.getElementById('roofCanvas').getBoundingClientRect();
  const rid = DRAW.lines.filter(l => l.type === 'ridge')[0];
  return { x: r.left + c[0], y: r.top + c[1], pt: j.pt.slice(),
           ridgeM: rid.measM, hips: DRAW.lines.filter(l => l.type === 'hip').map(l => l.measM) };
});
// 60 px along the ridge AND 40 px across it. The 40 must be thrown away.
await pg.mouse.move(loc.x, loc.y);
await pg.mouse.down();
await pg.mouse.move(loc.x + 60, loc.y + 40, { steps: 6 });
await pg.mouse.up();
await pg.waitForTimeout(250);
const moved = await pg.evaluate(() => {
  const rid = DRAW.lines.filter(l => l.type === 'ridge')[0];
  const pad = document.getElementById('junctRepoPopup');
  return { ends: rid.pts.map(p => p.map(n => Math.round(n * 10) / 10)), ridgeM: rid.measM,
           hips: DRAW.lines.filter(l => l.type === 'hip').map(l => l.measM),
           juncts: _roofJunctions().length,
           padOpen: !!(pad && pad.style.display === 'block'),
           padKey: window._junctRepo.key,
           padLen: (document.getElementById('junctRepoLen') || {}).textContent || '' };
});
check('dragging a junction moves it ALONG the ridge',
  moved.ends[0][0] === Math.round(loc.pt[0]) + 60, JSON.stringify(moved.ends));
check('…and not one pixel across it — that is the whole ask',
  moved.ends[0][1] === Math.round(loc.pt[1]), JSON.stringify({ was: loc.pt[1], now: moved.ends[0][1] }));
check('…the ridge is re-measured by what it actually is now',
  moved.ridgeM < loc.ridgeM && Math.abs(moved.ridgeM - (loc.ridgeM - 60 * 0.03)) < 0.03,
  JSON.stringify({ was: loc.ridgeM, now: moved.ridgeM }));
// Both hips at THAT end have to come with it, and the far two must not move.
const hipsUp = moved.hips.filter((m, i) => m > loc.hips[i] + 0.01).length;
const hipsSame = moved.hips.filter((m, i) => Math.abs(m - loc.hips[i]) < 0.01).length;
check('…both hips at that end follow it, and the other two do not move',
  hipsUp === 2 && hipsSame === 2, JSON.stringify({ was: loc.hips, now: moved.hips }));
check('…the roof still has its two junctions, not four loose ends',
  moved.juncts === 2, String(moved.juncts));
check('…and the nudge pad opened on the junction where it landed',
  moved.padOpen && moved.padKey && /ridge/.test(moved.padLen),
  JSON.stringify({ key: moved.padKey, len: moved.padLen }));

// ── the pad's buttons say what they do ────────────────────────────
// THE SIGN IS THE TRAP: the axis points from the junction towards the ridge's
// far end, so a positive step walks the junction UP the ridge and shortens
// it. The first version read "Longer" and shortened it.
const nudged = await pg.evaluate(() => {
  const r = {}, rid = () => DRAW.lines.filter(l => l.type === 'ridge')[0];
  r.start = rid().measM;
  for (let i = 0; i < 5; i++) _junctRepoNudge(1);
  r.longer = rid().measM;
  for (let i = 0; i < 10; i++) _junctRepoNudge(-1);
  r.shorter = rid().measM;
  return r;
});
check('"Longer" makes the ridge longer', nudged.longer > nudged.start + 0.03,
  JSON.stringify({ start: nudged.start, longer: nudged.longer }));
check('…and "Shorter" makes it shorter', nudged.shorter < nudged.longer - 0.05,
  JSON.stringify({ longer: nudged.longer, shorter: nudged.shorter }));

// ── undo, and the explicit rebuild that is allowed to win ─────────
const undone = await pg.evaluate(() => {
  const before = DRAW.lines.filter(l => l.type === 'ridge')[0].measM;
  undoLast();
  return { before, after: DRAW.lines.filter(l => l.type === 'ridge')[0].measM };
});
check('a nudge is its own undo step', undone.after !== undone.before,
  JSON.stringify(undone));
// Changing the roof type says "work this roof out again", and it should.
const regen = await pg.evaluate(() => {
  regenerateAutoRoofLines('hip');
  const j = _roofJunctions()[0];
  return { pt: j ? j.pt.map(n => Math.round(n)) : null };
});
check('an explicit roof rebuild puts the solver back in charge',
  regen.pt && regen.pt[0] === 360 && regen.pt[1] === 360, JSON.stringify(regen.pt));

// ── the pad closes the way the corner pad does ────────────────────
const closed = await pg.evaluate(() => {
  const j = _roofJunctions()[0];
  _junctRepoOpen(j);
  const open = document.getElementById('junctRepoPopup').style.display;
  _closeJunctRepo();
  return { open, shut: document.getElementById('junctRepoPopup').style.display,
           key: window._junctRepo.key };
});
check('the pad opens and shuts, leaving nothing selected',
  closed.open === 'block' && closed.shut === 'none' && !closed.key, JSON.stringify(closed));

// ── the hips snap to 45° as the ridge slides (2026-10-27) ─────────
// The owner: "snap the hips to 45deg, but also show the hip degrees as i'm
// sliding it, and also let me hold the shift button to remove the 45deg snap
// point (default the snap point to between 42 @ 48deg it snaps to 45deg)".
// On this 600 x 320 hip the left junction sits at x 360, where both of its
// hips are 45° in plan; 10 px along the ridge they read 43.3°, 40 px 38.7°.
const slide = async (dx, shift, peek) => {
  await pg.evaluate(() => { regenerateAutoRoofLines('hip'); setTool('select'); redrawAll(); });
  await pg.waitForTimeout(150);
  const p = await pg.evaluate(() => {
    const j = _roofJunctions().sort((a, b) => a.pt[0] - b.pt[0])[0], t = getImgTransform();
    const c = imgToCanvas(j.pt, t), r = document.getElementById('roofCanvas').getBoundingClientRect();
    return { x: r.left + c[0], y: r.top + c[1], s: t.s };
  });
  await pg.mouse.move(p.x, p.y);
  await pg.mouse.down();
  if (shift) await pg.keyboard.down('Shift');
  await pg.mouse.move(p.x + dx * p.s, p.y, { steps: 5 });
  const during = peek ? await pg.evaluate(() => ({
    labels: _junctLeanLabels(DRAG_JUNCT).map(h => h.type + ' ' + h.deg.toFixed(1) + (h.square ? ' sq' : '')),
    snapped: !!DRAG_JUNCT.snapped })) : null;
  await pg.mouse.up();
  if (shift) await pg.keyboard.up('Shift');
  await pg.waitForTimeout(150);
  const x = await pg.evaluate(() => Math.round(_roofJunctions().sort((a, b) => a.pt[0] - b.pt[0])[0].pt[0] * 10) / 10);
  try { await pg.evaluate(() => _closeJunctRepo()); } catch(e){}
  return { x, during };
};
const s10 = await slide(10, false, true);
check('a junction slid to 43° snaps back to where its hips are 45°',
  s10.x === 360, JSON.stringify(s10));
check('…and the canvas reads both hips at 45° with the tick while it is held',
  s10.during && s10.during.snapped && s10.during.labels.length === 2 &&
  s10.during.labels.every(l => l === 'hip 45.0 sq'), JSON.stringify(s10.during));
const s10f = await slide(10, true, true);
check('holding Shift lets it sit at 43° — no snap', Math.abs(s10f.x - 370) < 1.5, JSON.stringify(s10f));
check('…and the hips read their real angle, not 45',
  s10f.during && !s10f.during.snapped && s10f.during.labels.length === 2 &&
  s10f.during.labels.every(l => /^hip 4[34]\.\d$/.test(l)), JSON.stringify(s10f.during));
const s40 = await slide(40, false, true);
check('outside 42–48° nothing snaps (38.7° stays 38.7°)', Math.abs(s40.x - 400) < 1.5, JSON.stringify(s40));
check('…and the label says so', s40.during && s40.during.labels.every(l => /^hip 38\.\d$/.test(l)),
  JSON.stringify(s40.during));
const sNeg = await slide(-9, false, false);
check('the snap pulls from the other side too (46.6° → 45°)', sNeg.x === 360, JSON.stringify(sNeg));

// A gable has ONE line at each ridge end, not three — nothing to grab, and
// no handle drawn where there is nothing to do.
const gable = await pg.evaluate(() => {
  regenerateAutoRoofLines('gable'); redrawAll();
  return { types: (DRAW.lines||[]).map(l => l.type).join(','), juncts: _roofJunctions().length };
});
check('a plain gable offers no junction to drag', gable.juncts === 0,
  JSON.stringify(gable));

check('and none of this threw', errs.length === 0, errs.join(' | ').slice(0, 160) || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
