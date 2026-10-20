// The owner, 2026-09-25, on the Map Roof tab:
//  - "Can the roof image section always stay open, never collapse, also
//    remove the big outer border … just have the two boxes there. Then remove
//    the whole roof map history box."
//  - "When I start a second building outline on top of one of the first
//    building's lines, it selects the first building's line — when I'm using
//    the building outline tool it should never select a line."
//  - "A measuring tape button on the canvas: click to start, click to stop; a
//    grey line with arrows at each end pointing outwards; snaps horizontal or
//    vertical but can be rotated like an image in Word; moved around keeping
//    its rotation; when clicked it has a delete button; two end points that
//    are adjustable."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });
// Since 2026-09-30 the side panels sit OVER the page (the owner's), so the
// open Photos panel covers the right of it — fold it before clicking there.
await pg.evaluate(() => { try { _fergusPanelClose(); } catch(e){} });

// ── the roof image boxes: always open, no frame; no history box ──
const top = await pg.evaluate(() => {
  const card = document.getElementById('roofBgCard'), body = document.getElementById('roofBgBody'), bar = document.getElementById('roofBgBar');
  _collapseRoofBg();
  const cs = getComputedStyle(card);
  return { open: getComputedStyle(body).display !== 'none', barHidden: getComputedStyle(bar).display === 'none', framed: card.classList.contains('card') || (parseFloat(cs.borderTopWidth) > 0),
           history: !!document.querySelector('#tab-roof #roofHistoryCard'), inPopup: !!document.querySelector('#jobHistModal #roofHistoryCard') };
});
check('the roof image section stays open — even when something asks it to fold — with no outer frame or title bar', top.open && top.barHidden && !top.framed, JSON.stringify(top));
check('the roof map history box is gone from Map Roof (kept, folded, in the History popup)', !top.history && top.inPopup, JSON.stringify(top));

// a roof: 600 × 300 px at 0.02 m/px
await pg.evaluate(() => { clearAll(true); setTool('outline'); DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.02; });
await pg.waitForTimeout(300);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }
const client = (pts) => pg.evaluate((pts) => {
  try { fitDrawingToCanvas(); } catch(e){}
  document.getElementById('roofCanvas').scrollIntoView({ block: 'start' });
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), t = getImgTransform(), dpr = window.devicePixelRatio || 1;
  return pts.map(p => [r.left + (p[0] * t.s + t.ix) * (r.width / (cv.width / dpr)), r.top + (p[1] * t.s + t.iy) * (r.height / (cv.height / dpr))]);
}, pts);

// ── the outline tool never selects ──
await pg.evaluate(() => { autoGenerateRoof('gable'); setTool('outline'); });
let [onLine] = await client([[500, 300]]);   // the first building's top edge
await pg.mouse.click(onLine[0], onLine[1]);
await pg.waitForTimeout(200);
const ol = await pg.evaluate(() => ({ pts: DRAW.currentPts.length, sel: DRAW.selectedLine, panel: getComputedStyle(document.getElementById('propPanel')).display }));
check('with the outline tool, a click on the first building’s line starts the next outline — it does not select the line', ol.pts === 1 && ol.sel < 0 && ol.panel === 'none', JSON.stringify(ol));
await pg.evaluate(() => { DRAW.currentPts = []; DRAW._pendingNewRoof = false; setTool('select'); });

// ── the measuring tape ──
const btn = await pg.evaluate(() => { const b = document.getElementById('btn-tape'); return b ? b.textContent : ''; });
check('the canvas toolbar has a Measuring tape button', /Measuring tape/.test(btn), btn);
await pg.evaluate(() => setTool('tape'));
let [p1, p2] = await client([[250, 400], [650, 407]]);   // a little off level: it snaps
await pg.mouse.click(p1[0], p1[1]); await pg.waitForTimeout(120);
await pg.mouse.move(p2[0], p2[1], { steps: 4 }); await pg.waitForTimeout(120);
await pg.mouse.click(p2[0], p2[1]); await pg.waitForTimeout(200);
let t = await pg.evaluate(() => ({ n: (DRAW.tapes || []).length, t: DRAW.tapes && DRAW.tapes[0], sel: DRAW.selTape, label: _tapeLenText(DRAW.tapes[0]) }));
const r1 = (v) => Math.round(v);
check('click, click: a tape, level (it snapped), reading its length', t.n === 1 && r1(t.t.a[1]) === r1(t.t.b[1]) && Math.abs(r1(t.t.b[0]) - 650) <= 2 && t.label === '8.00m' && t.sel === 0, JSON.stringify(t));

// drag it somewhere else — the whole tape moves, still level
await pg.evaluate(() => setTool('select'));
let [mid, mid2] = await client([[450, 400], [450, 520]]);
await pg.mouse.move(mid[0], mid[1]); await pg.mouse.down(); await pg.mouse.move(mid[0], mid[1] + 10, { steps: 2 }); await pg.mouse.move(mid2[0], mid2[1], { steps: 5 }); await pg.mouse.up();
await pg.waitForTimeout(200);
t = await pg.evaluate(() => DRAW.tapes[0]);
check('dragging the tape moves it, keeping its length and angle', Math.abs(r1(t.a[1]) - 520) <= 2 && r1(t.a[1]) === r1(t.b[1]) && Math.abs((t.b[0] - t.a[0]) - 400) <= 2, JSON.stringify(t));

// drag an end — adjustable
let [endB, endB2] = await client([[t.b[0], t.b[1]], [t.b[0] + 100, t.b[1] + 3]]);
await pg.mouse.move(endB[0], endB[1]); await pg.mouse.down(); await pg.mouse.move(endB2[0], endB2[1], { steps: 5 }); await pg.mouse.up();
await pg.waitForTimeout(200);
t = await pg.evaluate(() => ({ t: DRAW.tapes[0], label: _tapeLenText(DRAW.tapes[0]) }));
check('dragging an end point lengthens it (still level), and the reading follows', Math.abs((t.t.b[0] - t.t.a[0]) - 500) <= 3 && r1(t.t.a[1]) === r1(t.t.b[1]) && t.label === '10.00m', JSON.stringify(t));

// rotate it with the handle
const rot = await pg.evaluate(() => { const h = _tapeHandles(DRAW.tapes[0], getImgTransform()); const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const toC = (P) => [r.left + P[0] * (r.width / (cv.width / dpr)), r.top + P[1] * (r.height / (cv.height / dpr))];
  const M = h.M; return { handle: toC(h.rot), target: toC([M[0] + 60, M[1] - 60]) }; });
await pg.mouse.move(rot.handle[0], rot.handle[1]); await pg.mouse.down(); await pg.mouse.move(rot.target[0], rot.target[1], { steps: 6 }); await pg.mouse.up();
await pg.waitForTimeout(200);
t = await pg.evaluate(() => { const x = DRAW.tapes[0]; return { ang: Math.round(Math.atan2(x.b[1] - x.a[1], x.b[0] - x.a[0]) * 180 / Math.PI), len: Math.round(Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1])), label: _tapeLenText(x) }; });
check('the rotate handle turns it about its middle, keeping its length', Math.abs(Math.abs(t.ang) - 45) <= 4 && Math.abs(t.len - 500) <= 3 && t.label === '10.00m', JSON.stringify(t));

// saved with the job, kept through undo
const sv = await pg.evaluate(() => { const s = snapshotCurrentJob(); undoLast(); const undone = DRAW.tapes[0]; return { saved: (s.draw.tapes || []).length, undoneAng: Math.round(Math.atan2(undone.b[1] - undone.a[1], undone.b[0] - undone.a[0]) * 180 / Math.PI) }; });
check('the tape is saved with the job, and undo steps its rotation back', sv.saved === 1 && sv.undoneAng === 0, JSON.stringify(sv));

// the delete button
await pg.evaluate(() => { DRAW.selTape = 0; redrawAll(); });
const del = await pg.evaluate(() => { const h = _tapeHandles(DRAW.tapes[0], getImgTransform()); const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return [r.left + h.del[0] * (r.width / (cv.width / dpr)), r.top + h.del[1] * (r.height / (cv.height / dpr))]; });
await pg.mouse.click(del[0], del[1]);
await pg.waitForTimeout(200);
check('clicking a tape shows a delete button, and it deletes it', await pg.evaluate(() => (DRAW.tapes || []).length === 0));
check('…and a new job starts with none', await pg.evaluate(() => { DRAW.tapes = [{ a: [0, 0], b: [10, 0] }]; clearAll(true); return (DRAW.tapes || []).length === 0; }));

// ── A LINE THAT GOES NOWHERE IS NOT A LINE (feedback report 13) ────
// info@wellingtonroof.co.nz sent a roof carrying SIX change-of-pitch lines,
// two of which were the same point twice with measM null — a double-tap, or a
// click landing twice on one snap point. Nothing is drawn, so nothing can be
// clicked to delete it, and _roofHasChangePitch reads the LIST: two invisible
// ones are enough to tell a roof it changes pitch.
const zero = await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[980,648],[1550,648],[1550,965],[980,965]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.0306; DRAW.calPitch = 25;
  const before = DRAW.lines.length;
  const place = (t, a, z) => { setTool(t); DRAW.currentPts = [a, z]; finishCurrent(); };
  place('changepitch', [1076,857], [1076,857]);     // the exact pair he sent
  const afterSame = DRAW.lines.length;
  place('changepitch', [1076,857], [1076,857.4]);   // under half a pixel
  const afterNear = DRAW.lines.length;
  place('changepitch', [1076,727], [1454,730]);     // a real one of his
  const afterReal = DRAW.lines.length;
  return { before, afterSame, afterNear, afterReal,
           zeroLen: DRAW.lines.filter(l => l.pts && l.pts.length > 1 &&
             Math.hypot(l.pts[1][0]-l.pts[0][0], l.pts[1][1]-l.pts[0][1]) < 0.5).length,
           hasCp: (typeof _roofHasChangePitch === 'function') ? _roofHasChangePitch() : null };
});
check('a line drawn start-to-finish in one spot is not stored',
  zero.afterSame === zero.before, JSON.stringify(zero));
check('…nor one under half a pixel long', zero.afterNear === zero.before, JSON.stringify(zero));
check('…but a real change-of-pitch line still is',
  zero.afterReal === zero.before + 1, JSON.stringify(zero));
check('…so the roof carries no zero-length lines at all', zero.zeroLen === 0, String(zero.zeroLen));

// ── A TAPE ON A PLAN SETS THE SCALE (2026-10-14) ────────────────
// The owner, on an imported A3 consent plan: "can't you just base the scale
// of this physical bar?". "Click a measurement to correct the scale" has been
// the rule since 2026-09-24, but on a freshly imported plan there is no roof
// line to click — and the measuring tape, which is the thing you lay along a
// dimension before you have drawn anything, counted for nothing.
const tape = await pg.evaluate(() => {
  const r = {};
  clearAll(true);
  DRAW.scaleMetresPerPx = 0;              // a plan just imported: no scale yet
  DRAW.tapes = [{ a:[100,100], b:[1063,100] }];   // 963 px, his own dimension line
  DRAW.selTape = 0;
  r.noScaleLabel = _tapeLenText(DRAW.tapes[0]);
  // the handle exists and is not on top of the delete button
  const h = _tapeHandles(DRAW.tapes[0], getImgTransform());
  r.hasScl = !!h.scl;
  r.apart = h.scl ? Math.hypot(h.scl[0]-h.del[0], h.scl[1]-h.del[1]) : 0;
  // 31.56 m over 963 px
  _tapeSetScale(0);
  const inp = document.getElementById('_spInput');
  r.prompted = !!inp;
  if (inp){ inp.value = '31.56'; document.getElementById('_spOk').click(); }
  r.mpp = DRAW.scaleMetresPerPx;
  r.reads = _tapeLenText(DRAW.tapes[0]);
  // mm typed instead of metres is the obvious slip on a plan dimensioned in mm
  _tapeSetScale(0);
  const inp2 = document.getElementById('_spInput');
  if (inp2){ inp2.value = '31560'; document.getElementById('_spOk').click(); }
  r.mmSlip = DRAW.scaleMetresPerPx;
  return r;
});
check('an unscaled tape says what to do instead of a length',
  /set the scale/.test(tape.noScaleLabel), tape.noScaleLabel);
check('a selected tape carries a scale button, clear of the delete one',
  tape.hasScl && tape.apart > 15, JSON.stringify({ apart: Math.round(tape.apart) }));
check('typing the plan\'s own dimension sets the scale',
  tape.prompted && Math.abs(tape.mpp - 31.56 / 963) < 1e-6,
  JSON.stringify({ mpp: tape.mpp, want: 31.56 / 963 }));
check('\u2026and the tape then reads back what was typed',
  tape.reads === '31.56m', tape.reads);
check('\u2026and millimetres typed by mistake are read as millimetres',
  Math.abs(tape.mmSlip - 31.56 / 963) < 1e-6, String(tape.mmSlip));

// ── CUSTOM SCALE (2026-10-20, the owner: "change 'set scale' to 'Scale a
// Line' and add another button called 'Custom Scale' where the user can enter
// any custom start point and an end point to set the scale, which is really
// useful on a pdf plan"). Scale a Line hit-tests a WALL and refuses outright
// with no outline drawn — which is exactly the state an imported consent plan
// is in, where the only measured thing on the sheet is its own dimension line.
const csBtns = await pg.evaluate(() => {
  const a = document.getElementById('btn-calibrate'), b = document.getElementById('btn-customscale');
  const ta = document.getElementById('ttbCal'), tb = document.getElementById('ttbCustomCal');
  return { a: a ? a.textContent.trim() : '', b: b ? b.textContent.trim() : '',
           ta: ta ? ta.textContent.trim() : '', tb: !!tb,
           oldWord: /Set scale/.test(document.body.innerText) };
});
check('the scale buttons read Scale a Line and Custom Scale, and "Set scale" is gone',
  /Scale a Line/.test(csBtns.a) && /Custom Scale/.test(csBtns.b) &&
  /Scale a Line/.test(csBtns.ta) && !csBtns.oldWord, JSON.stringify(csBtns));
// Custom Scale is NOT on the site bar: that row is a stated nine-button
// budget at 360px (tests/sitebars.mjs) and this is the widest label that
// would be on it. Scaling an imported plan is desk work; on site, Scale a
// Line is there and any measurement corrects the scale.
check('\u2026and the site bar is left at the nine buttons it is sized for', csBtns.tb === false, String(csBtns.tb));

// Nothing drawn at all: Scale a Line sends them off to draw an outline,
// Custom Scale stays put, because it needs nothing.
const csPick = await pg.evaluate(() => {
  clearAll(true);
  DRAW.scaleMetresPerPx = 0;
  setTool('calibrate');
  const afterWall = DRAW.tool;
  setTool('customscale');
  const el = document.getElementById('calInstrPopup');
  return { afterWall, afterCustom: DRAW.tool,
           instr: el ? el.style.display : '',
           says: (document.getElementById('calInstrBody') || {}).textContent || '' };
});
check('with nothing drawn, Scale a Line sends them to the outline tool and Custom Scale does not',
  csPick.afterWall === 'outline' && csPick.afterCustom === 'customscale', JSON.stringify(csPick));
check('\u2026and it says what to click', csPick.instr === 'block' && /start point/.test(csPick.says), csPick.says.slice(0, 60));

// Two clicks anywhere, then the real distance. The pixel span is read BACK
// off the app rather than assumed: getXY snaps, and what matters is that the
// scale is the typed distance over the span it actually picked.
// NOT through client(): that re-fits the drawing first, and with nothing
// drawn at all the fit leaves a transform these two points fall outside of.
// Scroll, settle, then map with the transform as it actually stands.
// Two things sit OVER the canvas by the time this runs and swallow a click:
// the roof-setup popup that finishCurrent() raises to ask shape + sheet
// (#_rsModal, a real modal), and the roof settings panel that reveals itself
// a second after a roof lands. Clear both, the way the Photos panel is
// folded at the top of this file.
await pg.evaluate(() => {
  const m = document.getElementById('_rsModal'); if (m) m.remove();
  const rtp = document.getElementById('roofTypePanel'); if (rtp) rtp.style.display = 'none';
});
await pg.evaluate(() => document.getElementById('roofCanvas').scrollIntoView({ block: 'center' }));
await pg.waitForTimeout(250);
const [cs1, cs2] = await pg.evaluate(() => {
  const m2 = document.getElementById('_rsModal'); if (m2) m2.remove();
  const r2 = document.getElementById('roofTypePanel'); if (r2) r2.style.display = 'none';
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect();
  const t = getImgTransform(), dpr = window.devicePixelRatio || 1;
  return [[250, 400], [650, 400]].map(p => [
    r.left + (p[0] * t.s + t.ix) * (r.width / (cv.width / dpr)),
    r.top  + (p[1] * t.s + t.iy) * (r.height / (cv.height / dpr))]);
});
await pg.mouse.click(cs1[0], cs1[1]); await pg.waitForTimeout(120);
const csMid = await pg.evaluate(() => ({ pts: DRAW.currentPts.length, popup: document.getElementById('calPopup').style.display }));
check('the first click places a point and asks nothing yet', csMid.pts === 1 && csMid.popup !== 'block', JSON.stringify(csMid));
await pg.mouse.move(cs2[0], cs2[1], { steps: 4 }); await pg.waitForTimeout(120);
await pg.mouse.click(cs2[0], cs2[1]); await pg.waitForTimeout(250);
const csOpen = await pg.evaluate(() => ({
  popup: document.getElementById('calPopup').style.display,
  info: document.getElementById('calPixelInfo').textContent,
  px: DRAW.calibratePixels, pts: (DRAW.calibratePts || []).length,
  left: DRAW.currentPts.length
}));
check('the second click opens the popup on the two points it picked',
  csOpen.popup === 'block' && Math.abs(csOpen.px - 400) <= 4 && csOpen.pts === 2 && csOpen.left === 0,
  JSON.stringify(csOpen));
check('\u2026and the popup talks about two points, not a wall',
  /two points/i.test(csOpen.info) && !/wall/i.test(csOpen.info), csOpen.info);
// The popup is shared with Scale a Line, so its heading and the box's own
// label have to say which tool opened it \u2014 "Real length of this wall" over
// two points on a dimension line is the word the button was renamed to lose.
const csWords2 = await pg.evaluate(() => ({
  title: (document.getElementById('calPopTitle') || {}).textContent || '',
  label: (document.getElementById('calRealLabel') || {}).textContent || ''
}));
check('\u2026and so does its heading and the box beside it',
  /Custom Scale/.test(csWords2.title) && /between the two points/.test(csWords2.label),
  JSON.stringify(csWords2));

const csSet = await pg.evaluate(() => {
  const px = DRAW.calibratePixels;
  document.getElementById('calRealInput').value = '31.56';
  confirmCalibrate();
  return { px, mpp: DRAW.scaleMetresPerPx, want: 31.56 / px, byHand: !DRAW.scaleAuto,
           // the popup stays up to report what it worked out — existing behaviour
           shown: document.getElementById('calScaleInfo').style.display };
});
check('typing the real distance sets the scale off exactly the span it picked',
  Math.abs(csSet.mpp - csSet.want) < 1e-9 && csSet.byHand && csSet.shown === 'block',
  JSON.stringify(csSet));

// A double-click lands both points in one place; that is a misclick, not a
// scale of infinity.
const csDouble = await pg.evaluate(() => {
  const was = DRAW.scaleMetresPerPx;
  setTool('customscale');
  DRAW.currentPts = [[400, 400]];
  onCanvasClick({ clientX: 0, clientY: 0, detail: 1, shiftKey: true,
                  preventDefault(){}, stopPropagation(){} });
  return { was, now: DRAW.scaleMetresPerPx, left: DRAW.currentPts.length };
});
check('two points in the same place are refused, and the scale does not move',
  Math.abs(csDouble.now - csDouble.was) < 1e-12, JSON.stringify(csDouble));

// Correcting a scale means clicking a measurement \u2014 and a plan with no roof
// drawn on it has none, so this one button has to stay.
const csStays = await pg.evaluate(() => {
  DRAW.scaleMetresPerPx = 0.03; _scaleStateShow();
  const vis = (id) => { const e = document.getElementById(id); return e ? e.style.display !== 'none' : null; };
  return { wall: vis('btn-calibrate'), custom: vis('btn-customscale'),
           line: (document.getElementById('scaleState') || {}).textContent || '' };
});
check('a scale hides Scale a Line and leaves Custom Scale, the only way back on a bare plan',
  csStays.wall === false && csStays.custom === true, JSON.stringify(csStays));
const csWords = await pg.evaluate(() => { DRAW.scaleMetresPerPx = 0; _scaleStateShow(); return (document.getElementById('scaleState') || {}).textContent || ''; });
check('\u2026and with no scale the line names both buttons',
  /Scale a Line/.test(csWords) && /Custom Scale/.test(csWords), csWords);

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
