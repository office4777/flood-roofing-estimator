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

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
