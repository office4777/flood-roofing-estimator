// Freehand notes over the roof map.
//
// The whole feature is one property: a note is in its OWN list. Nothing that
// reads DRAW.lines, DRAW.outline or DRAW.penetrations can pick one up, so a
// scribble can never be fitted to a wall, measured, counted as a flashing or
// ordered. The pointer handlers enforce the other half — while the Notes tool
// is armed they stopPropagation in the capture phase, so the drawing engine's
// own handlers never run at all.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:950} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2400);

// A roof, so we can prove notes never disturb it.
const base = await pg.evaluate(() => {
  gotoTab('roof');
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]]; DRAW.outlineDone = true;
  DRAW.lines = [['gutter',[0,0],[2000,0]],['ridge',[500,500],[1500,500]]]
    .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:null, sheetLengthM:null}));
  DRAW.penetrations = [{cx:900, cy:400, sizeLabel:'100mm'}];
  DRAW.scaleMetresPerPx = 0.01; DRAW.calPitch = 20;
  DRAW.notes = [];
  redrawAll();
  return { outline:DRAW.outline.length, lines:DRAW.lines.length, pens:DRAW.penetrations.length };
});
const roofSame = async () => pg.evaluate((b) => ({
  ok: (DRAW.outline||[]).length === b.outline && (DRAW.lines||[]).length === b.lines &&
      (DRAW.penetrations||[]).length === b.pens && DRAW.scaleMetresPerPx === 0.01 && DRAW.calPitch === 20,
  got: (DRAW.outline||[]).length + '/' + (DRAW.lines||[]).length + '/' + (DRAW.penetrations||[]).length,
}), base);

async function canvasOrigin(){
  return pg.evaluate(() => {
    const cv = document.getElementById('roofCanvas');
    cv.scrollIntoView({ block:'start' });
    const q = cv.getBoundingClientRect();
    return { x:q.x, y:q.y, w:q.width, h:q.height };
  });
}
async function scribble(x0,y0,x1,y1){
  const r = await canvasOrigin();
  await pg.mouse.move(r.x+x0, r.y+y0); await pg.mouse.down();
  for (let i=1;i<=8;i++) await pg.mouse.move(r.x+x0+(x1-x0)*i/8, r.y+y0+(y1-y0)*i/8);
  await pg.mouse.up(); await pg.waitForTimeout(80);
}

// ── the tool ──────────────────────────────────────────────────────
let v = await pg.evaluate(() => ({ btn: !!document.getElementById('btn-notes'),
                                   barHidden: getComputedStyle(document.getElementById('notesBar')).display === 'none' }));
check('the menu offers a free-draw note', v.btn);
check('…and its bar stays out of the way until it is armed', v.barHidden);

await pg.evaluate(() => setTool('notes'));
await pg.waitForTimeout(200);
v = await pg.evaluate(() => getComputedStyle(document.getElementById('notesBar')).display !== 'none');
check('arming the tool brings up the pen bar', v);

// ── drawing a note ────────────────────────────────────────────────
await scribble(120, 60, 340, 180);
v = await pg.evaluate(() => ({ n: (DRAW.notes||[]).length, pts: (DRAW.notes[0]||{}).pts, c: (DRAW.notes[0]||{}).colour }));
check('a drag lays down one note', v.n === 1 && v.pts && v.pts.length > 2, v.n + ' note, ' + (v.pts||[]).length + ' points');
let r = await roofSame();
check('…and the roof is untouched by it', r.ok, r.got);

// The real point: the drawing engine never saw the event.
v = await pg.evaluate(() => ({ lines: DRAW.lines.length, cur: (DRAW.currentPts||[]).length,
                               sel: DRAW.selectedLine, sec: (DRAW.sections||[]).length }));
check('no line was started, nothing was selected',
  v.lines === base.lines && v.cur === 0 && v.sec === 0,
  v.lines + ' lines, ' + v.cur + ' pending pts, selectedLine ' + v.sel);

// ── colour and width come from the bar ────────────────────────────
await pg.evaluate(() => { setNotesColour('#0891b2'); setNotesWidth(8); });
await scribble(120, 200, 340, 250);
v = await pg.evaluate(() => { const n = DRAW.notes[1] || {}; return { c: n.colour, w: n.width, n: DRAW.notes.length }; });
check('the pen picked is the pen drawn', v.n === 2 && v.c === '#0891b2' && v.w === 8, v.c + ' @ ' + v.w);

// ── notes are in image space, so they stay put through a zoom ─────
const at = await pg.evaluate(() => DRAW.notes[0].pts[0].slice());
await pg.evaluate(() => { DRAW.zoom = 2.2; redrawAll(); });
v = await pg.evaluate((a) => { const p = DRAW.notes[0].pts[0]; return p[0] === a[0] && p[1] === a[1]; }, at);
check('a note is anchored to the roof, not the screen — it survives a zoom', v);
await pg.evaluate(() => { DRAW.zoom = 1; redrawAll(); });

// ── undo, erase, clear ────────────────────────────────────────────
await pg.evaluate(() => undoLast());
await pg.waitForTimeout(150);
v = await pg.evaluate(() => (DRAW.notes||[]).length);
check('undo takes back the last note', v === 1, v + ' note(s)');
r = await roofSame();
check('…without disturbing the roof', r.ok, r.got);

await pg.evaluate(() => { toggleNotesErase(); });
v = await pg.evaluate(() => DRAW.tool);
check('the eraser is its own tool', v === 'noteserase', v);
await canvasOrigin();
const mid = await pg.evaluate(() => {
  const p = DRAW.notes[0].pts[Math.floor(DRAW.notes[0].pts.length/2)];
  const t = getImgTransform();
  const cv = document.getElementById('roofCanvas'), rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = p[0]*t.s + t.ix, cy = p[1]*t.s + t.iy;
  return { x: rect.x + cx * dpr * rect.width / cv.width, y: rect.y + cy * dpr * rect.height / cv.height };
});
await pg.mouse.move(mid.x, mid.y); await pg.mouse.down(); await pg.mouse.up();
await pg.waitForTimeout(150);
v = await pg.evaluate(() => (DRAW.notes||[]).length);
check('rubbing out removes the note under the finger', v === 0, v + ' left');
r = await roofSame();
check('…and still leaves the roof alone', r.ok, r.got);

// ── it saves with the job ─────────────────────────────────────────
await pg.evaluate(() => { setTool('notes'); });
await scribble(520, 60, 720, 160);
v = await pg.evaluate(() => {
  const s = snapshotCurrentJob();
  return { saved: (s.draw.notes||[]).length, live: (DRAW.notes||[]).length };
});
check('a note is saved with the job', v.saved === 1 && v.live === 1, v.saved + ' in the snapshot');

// ── and the tool releases the canvas when it is done ──────────────
await pg.evaluate(() => setTool('select'));
await pg.waitForTimeout(150);
const before = await pg.evaluate(() => (DRAW.notes||[]).length);
await scribble(200, 60, 400, 160);
v = await pg.evaluate(() => (DRAW.notes||[]).length);
check('with the tool put away, a drag no longer draws notes', v === before, v + ' note(s)');
v = await pg.evaluate(() => getComputedStyle(document.getElementById('notesBar')).display === 'none');
check('…and the pen bar goes away with it', v);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
