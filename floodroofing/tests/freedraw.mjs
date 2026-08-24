// A notes page. Not the roof canvas — that one fits every stroke to a wall
// or a flashing line, which is the opposite of what you want when scribbling
// "check the flue on the north face". Separate surface, separate strokes,
// and nothing it does can reach DRAW.
//
// The eraser is a stroke, not a rubbing-out of pixels, so it undoes like any
// other stroke. That is the property this suite is really holding.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:820,height:1180}, hasTouch:true, isMobile:true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_site_mode','on');
});
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2400);

// A drawn roof, so we can prove the pad never touches it.
await pg.evaluate(() => {
  gotoTab('roof');
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]]; DRAW.outlineDone = true;
  DRAW.lines = [['ridge',[500,500],[1500,500]]].map(l => ({type:l[0],pts:[l[1],l[2]],label:'',lengthM:'',measM:null,sheetLengthM:null}));
  DRAW.scaleMetresPerPx = 0.01;
});

await pg.evaluate(() => { toggleRoofLinesMenu(); });
await pg.waitForTimeout(250);
let v = await pg.evaluate(() => {
  const el = document.getElementById('btn-notespad');
  return { there: !!el, shown: el ? getComputedStyle(el).display !== 'none' : false };
});
check('the site sheet offers a Notes page', v.there && v.shown, 'present=' + v.there);

await pg.evaluate(() => openFreeDrawPad());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  open: !!document.getElementById('freeDrawPad'),
  colours: document.querySelectorAll('#freeDrawPad [data-fdc]').length,
  widths: document.querySelectorAll('#freeDrawPad [data-fdw]').length,
  hasEraser: !!document.getElementById('fdEraser'),
  hasUndo: !!document.getElementById('fdUndo'), hasRedo: !!document.getElementById('fdRedo'),
  hasClear: !!document.getElementById('fdClear'), hasSave: !!document.getElementById('fdSave'),
}));
check('it opens with a full set of tools',
  v.open && v.colours === 6 && v.widths === 3 && v.hasEraser && v.hasUndo && v.hasRedo && v.hasClear && v.hasSave,
  v.colours + ' colours, ' + v.widths + ' sizes');

// ── drawing ───────────────────────────────────────────────────────
async function stroke(x0, y0, x1, y1){
  const box = await pg.evaluate(() => {
    const r = document.getElementById('fdCanvas').getBoundingClientRect();
    return { x:r.x, y:r.y };
  });
  await pg.mouse.move(box.x + x0, box.y + y0);
  await pg.mouse.down();
  for (let i = 1; i <= 6; i++)
    await pg.mouse.move(box.x + x0 + (x1-x0)*i/6, box.y + y0 + (y1-y0)*i/6);
  await pg.mouse.up();
  await pg.waitForTimeout(60);
}
await stroke(60, 80, 300, 200);
v = await pg.evaluate(() => ({ n: FD.strokes.length, pts: FD.strokes[0] ? FD.strokes[0].pts.length : 0,
                               tool: FD.strokes[0] && FD.strokes[0].tool }));
check('a drag lays down one stroke', v.n === 1 && v.pts > 2 && v.tool === 'pen', v.n + ' stroke, ' + v.pts + ' points');

await pg.evaluate(() => _fdSetColour('#dc2626'));
await stroke(60, 250, 300, 320);
v = await pg.evaluate(() => ({ n: FD.strokes.length, c: FD.strokes[1] && FD.strokes[1].colour }));
check('the colour picked is the colour drawn', v.n === 2 && v.c === '#dc2626', v.c);

await pg.evaluate(() => _fdSetWidth(8));
await stroke(60, 380, 300, 420);
v = await pg.evaluate(() => ({ w: FD.strokes[2] && FD.strokes[2].width }));
check('so is the pen size', v.w === 8, 'width ' + v.w);

// ── the eraser is a stroke, so it undoes like one ─────────────────
await pg.evaluate(() => _fdToggleEraser());
await stroke(80, 90, 280, 190);
v = await pg.evaluate(() => ({ n: FD.strokes.length, tool: FD.strokes[3] && FD.strokes[3].tool }));
check('the eraser lays down a stroke of its own', v.n === 4 && v.tool === 'eraser', v.tool);

await pg.evaluate(() => _fdUndo());
v = await pg.evaluate(() => ({ n: FD.strokes.length, redo: FD.redo.length }));
check('…so undo takes the erase back', v.n === 3 && v.redo === 1, v.n + ' strokes, ' + v.redo + ' redo');

await pg.evaluate(() => _fdRedo());
v = await pg.evaluate(() => ({ n: FD.strokes.length, redo: FD.redo.length }));
check('…and redo puts it back', v.n === 4 && v.redo === 0, v.n + ' strokes');

await pg.evaluate(() => { _fdUndo(); _fdUndo(); });
await stroke(400, 100, 500, 200);
v = await pg.evaluate(() => ({ n: FD.strokes.length, redo: FD.redo.length }));
check('a new stroke drops the redo stack, as it should', v.n === 3 && v.redo === 0,
  v.n + ' strokes, ' + v.redo + ' redo');

// ── saving ────────────────────────────────────────────────────────
await pg.evaluate(() => { S.files = []; _fdSave(); });
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ n: (S.files||[]).length, f: (S.files||[])[0] }));
check('Save writes a PNG into the job files',
  v.n === 1 && v.f.mime === 'image/png' && /^Note 1\.png$/.test(v.f.name) && /^data:image\/png/.test(v.f.data),
  v.f && v.f.name);
check('…with a real size on it, not zero', v.f && v.f.size > 200, v.f && v.f.size + ' bytes');

await pg.evaluate(() => _fdSave());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => (S.files||[]).map(f => f.name).join(', '));
check('a second note does not overwrite the first', v === 'Note 1.png, Note 2.png', v);

// ── and it never reaches the roof ─────────────────────────────────
v = await pg.evaluate(() => ({
  outline:(DRAW.outline||[]).length, lines:(DRAW.lines||[]).length, scale: DRAW.scaleMetresPerPx,
  notesOnDraw: typeof DRAW.strokes,
}));
check('none of it touches the roof drawing',
  v.outline === 4 && v.lines === 1 && v.scale === 0.01, v.outline + ' outline pts, ' + v.lines + ' lines');

await pg.evaluate(() => _fdClose());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ gone: !document.getElementById('freeDrawPad'), files: (S.files||[]).length }));
check('closing the pad keeps the saved notes', v.gone && v.files === 2, v.files + ' file(s)');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
