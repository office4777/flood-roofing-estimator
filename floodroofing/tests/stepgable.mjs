// The owner's L: a tall main gable and a lower wing hung off it, each wing
// its OWN gable at its own height — ridges the same way, no hip, no valley,
// the wing's roof dying into the main roof's gable wall. "Step-down Gable"
// (his sketch: barge/barge along the top, Gutter down each side, a Ridge up
// each block, the wing tucked under the main block).
//
// Pinned: the type is offered; on the L each block gets a ridge, gutters on
// the edges along the ridge and rake barges across it; where the blocks meet
// the wider block keeps its barge (the gable wall) and the narrower gets an
// apron; Rotate flips the ridge direction and keeps the type; a T gets three
// ridges; grabbing the ridge does not re-label it a straight gable; the
// sheet engine counts it. And the undo that the owner saw double lines from:
// a snapshot carries EVERY roof, so undoing back past a second roof leaves
// one roof with one set of lines, and redo brings the second back.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(); const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings'); localStorage.setItem('fr_site_mode','off');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });
const drawOutline = async (pts) => {
  await pg.evaluate((pts) => { setTool('outline'); DRAW.currentPts = pts; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; }, pts);
  await pg.waitForTimeout(300);
  const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click();
  await pg.waitForTimeout(200);
};
const L = [[180,560],[635,560],[635,880],[860,880],[860,1215],[180,1215]];
await pg.evaluate(() => clearAll(true));
await drawOutline(L);

const g = await pg.evaluate(() => {
  autoGenerateRoof('stepgable');
  const R = (t) => DRAW.lines.filter(l => l.type === t).map(l => l.pts.map(p => p.map(Math.round)));
  const counts = () => { const c = {}; DRAW.lines.forEach(l => { c[l.type] = (c[l.type]||0)+1; }); return c; };
  const out = { type: DRAW.roofType, offered: /Step-down Gable/.test(_roofTypeMenuHtml()), chooser: ROOF_TYPE_CHOICES.some(c => c.type === 'stepgable'),
    a: { counts: counts(), ridges: R('ridge'), aprons: R('apron'), barges: R('barge') } };
  rotateActiveRoof();
  out.b = { type: DRAW.roofType, counts: counts(), ridges: R('ridge'), aprons: R('apron'), barges: R('barge'), rotation: DRAW.rotation };
  return out;
});
check('Step-down Gable is one of the roof shapes on offer', g.offered && g.chooser);
check('on the L it is two gables: a ridge down the middle of each block, gutters along them, rake barges across', g.type === 'stepgable' && g.a.counts.ridge === 2 && g.a.counts.gutter === 4 && (g.a.counts.barge || 0) >= 6, JSON.stringify(g.a.counts));
// bbox 680 wide x 655 tall → ridges run horizontal; the cut is at x=635, the
// left block (full height, 655 wide) is the higher one, the right wing
// (335 wide) dies into it: apron on the wing's edge at x=635 from 880 to 1215.
check('…the ridges are one per block, each down its own middle', JSON.stringify(g.a.ridges) === '[[[180,888],[635,888]],[[635,1048],[860,1048]]]', JSON.stringify(g.a.ridges));
check('…the narrower wing runs an APRON up to the wider block\'s gable wall', JSON.stringify(g.a.aprons) === '[[[635,880],[635,1215]]]', JSON.stringify(g.a.aprons));
check('…and the wider block keeps its barge along that same stretch (the wall above the lower roof)',
  g.a.barges.some(bg => bg[0][0] === 635 && bg[1][0] === 635 && Math.min(bg[0][1], bg[1][1]) >= 880 && Math.max(bg[0][1], bg[1][1]) <= 1215), JSON.stringify(g.a.barges));
check('no hip and no valley anywhere on it', !g.a.counts.hip && !g.a.counts.valley);
check('Rotate roof 90° turns both ridges the other way and keeps the type', g.b.type === 'stepgable' && g.b.rotation === 90 && JSON.stringify(g.b.ridges) === '[[[408,560],[408,880]],[[520,880],[520,1215]]]', JSON.stringify(g.b));
check('…with the apron now along the cut at y=880 under the narrower top block', JSON.stringify(g.b.aprons) === '[[[180,880],[635,880]]]', JSON.stringify(g.b.aprons));

// a corner drag regenerates it as a step-down gable, not something else
const regen = await pg.evaluate(() => {
  rotateActiveRoof();   // back to horizontal ridges
  DRAW.outline[4] = [900, 1215]; DRAW.outline[3] = [900, 880];
  regenerateAutoRoofLines(DRAW.roofType);
  return { type: DRAW.roofType, ridges: DRAW.lines.filter(l => l.type === 'ridge').length, hips: DRAW.lines.filter(l => l.type === 'hip').length };
});
check('after a corner moves it is still two ridges and no hips', regen.type === 'stepgable' && regen.ridges === 2 && regen.hips === 0, JSON.stringify(regen));

// a T: three blocks, three ridges
await pg.evaluate(() => clearAll(true));
await drawOutline([[100,100],[700,100],[700,300],[500,300],[500,600],[300,600],[300,300],[100,300]]);
const t = await pg.evaluate(() => { DRAW.roofBaseHoriz = false; autoGenerateRoof('stepgable', 90); const c = {}; DRAW.lines.forEach(l => { c[l.type] = (c[l.type]||0)+1; }); return c; });
check('a T footprint becomes three gables — one ridge per block, an apron where the stem meets the bar', t.ridge === 3 && !t.hip && !t.valley && (t.apron || 0) >= 1, JSON.stringify(t));

// the sheet engine counts it like the gables it is
const sheets = await pg.evaluate(() => { try { renderRoofSheetPlan(); return (window._lastSheetCounts || {}); } catch(e){ return { err: e.message }; } });
check('the sheet engine takes it off (no error, sheets counted)', !sheets.err && ((sheets.orangeLong || 0) + (sheets.blueLong || 0) + (sheets.purpleLong || 0) + (sheets.shortCount || 0)) > 0, JSON.stringify(sheets).slice(0, 120));

// ── UNDO carries every roof ───────────────────────────────────────
await pg.evaluate(() => clearAll(true));
await drawOutline(L);
const u = await pg.evaluate(async () => {
  autoGenerateRoof('stepgable');
  const snap = () => ({ roofs: DRAW.roofs.length, active: DRAW.activeRoofIdx, lines: DRAW.lines.length, per: DRAW.roofs.map(r => (r.lines||[]).length), outline: DRAW.outline.length,
    drawn: DRAW.lines.length + DRAW.roofs.reduce((a, r, i) => a + (i === DRAW.activeRoofIdx ? 0 : (r.lines||[]).length), 0) });
  const s0 = snap();
  _addAndSwitchToNewRoof();
  setTool('outline'); DRAW.currentPts = [[230,1340],[655,1340],[655,1610],[230,1610]]; finishCurrent();
  await new Promise(r => setTimeout(r, 200)); const m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('hip');
  const s1 = snap();
  let n = 0; while (DRAW.undoStack.length && n < 12){ undoLast(); n++; if (DRAW.roofs.length === 1 && DRAW.lines.length === s0.lines) break; }
  const s2 = snap();
  redoLast(); const s3 = snap();
  return { s0, s1, s2, s3, n };
});
check('a second roof (hip) drawn after the step-down gable', u.s1.roofs === 2 && u.s1.active === 1 && u.s1.per[0] === u.s0.lines);
check('undo walks back to ONE roof with ONE set of lines — nothing doubled on the canvas', u.s2.roofs === 1 && u.s2.active === 0 && u.s2.lines === u.s0.lines && u.s2.drawn === u.s0.lines && u.s2.outline === 6, JSON.stringify(u.s2));
check('…and redo brings the second roof back', u.s3.roofs === 2 && u.s3.active === 1, JSON.stringify(u.s3));
check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
