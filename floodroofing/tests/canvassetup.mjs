// "As soon as a roof outline is completed, can a pop-up appear and make the
//  user input the roof type so it auto-generates, and the roof's main material
//  (explain very shortly that clearlites can be added as a 'roof item'). Then
//  hide the roof type buttons into one button called 'Change roof type'. Also
//  change 'Add Roof Lines or Details' to 'Add items/details'. And I don't need
//  to select different roofs in the canvas — remove those buttons and always
//  be viewing all. There's a lot of buttons currently, I want it simplified."
//
// The toolbar had grown to seven coloured roof-type buttons, a roof-picker row
// carrying two controls per roof, and a sheet-material select on the far side
// of the bar — all competing with the drawing for attention, and all of it
// optional, so a roof could easily end up generated as the wrong shape or
// ordered in the wrong steel without anyone being asked.
//
// One question when the outline closes; one button afterwards to change your
// mind; no roof picker at all.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2700);

const draw = pts => pg.evaluate((p) => {
  setTool('outline'); DRAW.currentPts = p; finishCurrent();
}, pts);

// ── the popup, on the outline closing ──────────────────────────────
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); DRAW.scaleMetresPerPx = 0.02; });
await draw([[200,150],[560,150],[560,430],[200,430]]);
await pg.waitForTimeout(800);
let v = await pg.evaluate(() => {
  const m = document.getElementById('_rsModal');
  if (!m) return { popup:false };
  const t = m.innerText || '';
  return { popup:true, title:t.split('\n')[0],
           types:[...m.querySelectorAll('[data-rstype]')].map(x => x.getAttribute('data-rstype')),
           sheets:[...m.querySelectorAll('[data-rssheet]')].map(x => x.getAttribute('data-rssheet')),
           suggested:/SUGGESTED/.test(t),
           clearliteNote:/Clearlite sheet/.test(t) && /Add items\/details/.test(t),
           canSkip:!!m.querySelector('#_rsSkip') };
});
check('closing an outline asks what the roof is', v.popup, v.title || 'no popup');
check('…offering every roof shape the generator can build',
  v.types && v.types.join() === 'hip,gable,stepgable,gable-hv,dutch,mono', (v.types||[]).join());
check('…and every sheet material',
  v.sheets && v.sheets.join() === 'steel-corrugate,steel-5rib,clearlite-5rib,clearlite-corrugate',
  (v.sheets||[]).join());
check('…with the footprint’s own suggestion already picked', v.suggested);
check('…saying briefly that a few clear sheets are added as an item instead',
  v.clearliteNote);
check('…and a way past it, since a popup you cannot dismiss is a trap', v.canSkip);

// EACH SHAPE IS A PICTURE OF THIS OUTLINE (2026-10-22, feedback report 67:
// "show all possible roof types as boxed pictures with the roof type name
// under … each boxed roof picture should show the roof map as the outline is
// drawn but with roof type lines drawn in").
const pics = await pg.evaluate(() => {
  const m = document.getElementById('_rsModal');
  const boxes = [...m.querySelectorAll('[data-rstype]')].map(x => ({ t: x.getAttribute('data-rstype'),
    poly: x.querySelectorAll('svg polygon').length, lines: x.querySelectorAll('svg line').length,
    label: (x.textContent || '').replace(/SUGGESTED/, '').trim(),
    ridge: [...x.querySelectorAll('svg line')].some(l => l.getAttribute('stroke') === LINE_COLORS.ridge),
    hip: [...x.querySelectorAll('svg line')].some(l => l.getAttribute('stroke') === LINE_COLORS.hip) }));
  const before = JSON.stringify([DRAW.lines.map(l => l.type), DRAW.roofType, DRAW.roofBaseHoriz, DRAW.ridgeBreaks, DRAW.hipEnds]);
  const gablePreview = _roofPreviewLines('gable').map(l => l.type).filter(t => t !== 'gutter').sort().join(',');
  const after = JSON.stringify([DRAW.lines.map(l => l.type), DRAW.roofType, DRAW.roofBaseHoriz, DRAW.ridgeBreaks, DRAW.hipEnds]);
  return { boxes, same: before === after, gablePreview };
});
check('…every shape is a boxed picture of this outline with that shape\u2019s own lines in the map\u2019s colours, named under it',
  pics.boxes.length === 6 && pics.boxes.every(b => b.poly === 1 && b.lines >= 1 && b.label) &&
  pics.boxes.find(b => b.t === 'hip').hip && pics.boxes.find(b => b.t === 'hip').ridge && pics.boxes.find(b => b.t === 'gable').ridge && !pics.boxes.find(b => b.t === 'gable').hip,
  JSON.stringify(pics.boxes));
check('…and drawing the pictures moves nothing on the roof', pics.same);

// Confirming draws the roof and sets the material.
await pg.evaluate(() => {
  document.querySelector('[data-rstype="gable"]').click();
  document.querySelector('[data-rssheet="steel-5rib"]').click();
  document.querySelector('#_rsOk').click();
});
check('…and the picture that was picked is the roof that is built: the same lines, type for type (gutters aside, which the build lays off the outline)',
  await pg.evaluate((want) => DRAW.lines.filter(l => l.autoGenerated && l.type !== 'gutter').map(l => l.type).sort().join(',') === want, pics.gablePreview),
  pics.gablePreview);
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ type:DRAW.roofType, sheet:DRAW.sheetType,
  lines:(DRAW.lines||[]).length, gone:!document.getElementById('_rsModal') }));
check('answering it generates the roof lines', v.lines > 0 && v.type === 'gable',
  v.type + ', ' + v.lines + ' lines');
check('…and sets the sheet material for the roof', v.sheet === 'steel-5rib', v.sheet);
check('…and closes', v.gone);

// Skip leaves the roof alone rather than guessing.
await pg.evaluate(() => { _addAndSwitchToNewRoof(); });
await draw([[620,200],[820,200],[820,380],[620,380]]);
await pg.waitForTimeout(800);
await pg.evaluate(() => { const s = document.querySelector('#_rsSkip'); if (s) s.click(); });
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({ type:DRAW.roofType || '', gone:!document.getElementById('_rsModal') }));
check('skipping leaves the roof type unset rather than guessing',
  v.type === '' && v.gone, JSON.stringify(v));

// ── one button, not seven ──────────────────────────────────────────
v = await pg.evaluate(() => {
  const panel = document.getElementById('roofTypePanel');
  const html = panel ? panel.innerHTML : '';
  return { loose:(html.match(/onclick="autoGenerateRoof\('/g)||[]).length,
           dropBtn:!!document.getElementById('roofTypeDropBtn'),
           buttons:panel ? panel.querySelectorAll('button').length : -1,
           label:(document.getElementById('roofTypeDropLabel')||{}).textContent };
});
check('the five coloured roof-type buttons are gone from the toolbar',
  v.loose === 0, v.loose + ' still loose');
check('…replaced by one "Change roof type" button', v.dropBtn);
// 2026-09-24: one row — shape, Rotate 90°, Snap square, Make main roof,
// Delete roof — plus the phone's collapse and the gable Centre button.
// 2026-10-12: and the full-width "Close roof settings" bar, which is the
// way out of the overlay the panel became (the owner: "an up arrow so the
// user knows where and how to collapse this dropdown window"). Eight, and
// the cap still means what it meant: this panel is a handful of controls,
// not a settings page.
check('…so the roof panel is down to a handful of controls',
  v.buttons > 0 && v.buttons <= 8, v.buttons + ' buttons');

const menu = await pg.evaluate(() => {
  toggleRoofTypeMenu();
  const m = document.getElementById('roofTypeDropMenu');
  return { open:m.style.display === 'block',
           types:(m.innerHTML.match(/_pickRoofType/g)||[]).length,
           sheets:(m.innerHTML.match(/_pickRoofSheet/g)||[]).length };
});
check('…that opens a menu with every shape', menu.open && menu.types === 6,
  JSON.stringify(menu));
check('…and the sheet materials too, so the spec is in one place',
  menu.sheets === 4, String(menu.sheets));

const picked = await pg.evaluate(() => {
  _pickRoofType('mono');
  return { type:DRAW.roofType, label:(document.getElementById('roofTypeDropLabel')||{}).textContent,
           closed:document.getElementById('roofTypeDropMenu').style.display === 'none' };
});
check('picking from it changes the roof', picked.type === 'mono', picked.type);
check('…and the button then says what the roof IS',
  /Mono/.test(picked.label), picked.label);
check('…with the menu closed behind you', picked.closed);

// ── the toolbar reads plainly ──────────────────────────────────────
v = await pg.evaluate(() => ({
  label:(document.querySelector('.rl-drop-label')||{}).textContent,
  old:/Add Roof Lines or Details/.test(document.body.innerHTML),
}));
check('the details menu is called "Add items/details"',
  v.label === 'Add items/details', v.label);
check('…and the old wording is nowhere left', !v.old);

// ── no roof picker; always viewing all ─────────────────────────────
v = await pg.evaluate(() => {
  renderRoofSwitcher();
  const el = document.getElementById('roofSwitcher');
  return { display:el.style.display, html:el.innerHTML.length,
           showAll:DRAW.showAllRoofs, roofs:DRAW.roofs.length };
});
check('the canvas roof-picker row is gone', v.display === 'none' && v.html === 0,
  JSON.stringify(v));
check('…on a job with more than one roof', v.roofs >= 2, v.roofs + ' roofs');
check('…and the canvas is viewing them all', v.showAll === true);

// Clicking into a roof still decides where new lines land, without hiding the rest.
const sw = await pg.evaluate(() => {
  switchToRoof(0);
  return { active:DRAW.activeRoofIdx, showAll:DRAW.showAllRoofs };
});
check('picking a roof still sets where new lines attach', sw.active === 0, String(sw.active));
check('…without hiding every other roof, the way it used to', sw.showAll === true);

const toggled = await pg.evaluate(() => { toggleShowAllRoofs(); return DRAW.showAllRoofs; });
check('and nothing can put the canvas back into single-roof mode', toggled === true);

// ── Ctrl + scroll zooms the drawing, whatever the tool ─────────────
v = await pg.evaluate(() => {
  const c = document.getElementById('roofCanvas');
  const before = DRAW.zoom || 1;
  c.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
  return { before, after: DRAW.zoom, label: document.getElementById('zoomLabel').textContent };
});
check('Ctrl + scroll zooms the canvas and updates the % label',
  v.after > v.before && v.label === Math.round(v.after * 100) + '%', JSON.stringify(v));

// ── the canvas keeps its centre when its size changes ─────────────
// The photos panel opening, a tab coming back: the canvas got narrower and
// the view stayed pinned to the top-left, so the roof the office had centred
// was found half off the canvas on every return.
v = await pg.evaluate(() => {
  const c = document.getElementById('roofCanvas'), wrap = c.parentElement;
  const dpr = window.devicePixelRatio || 1;
  fitCanvasToWrap();
  const w0 = c.width;
  // A point in the middle of the canvas, in world (image) space
  const t0 = getImgTransform(), cx0 = (c.width / dpr / 2 - t0.ix) / t0.s;
  // The WRAP narrows (a panel opening) — the canvas is never pinned itself.
  wrap.style.maxWidth = Math.round(wrap.getBoundingClientRect().width * 0.6) + 'px';
  fitCanvasToWrap();
  const t1 = getImgTransform(), cx1 = (c.width / dpr / 2 - t1.ix) / t1.s, w1 = c.width;
  wrap.style.maxWidth = '';
  fitCanvasToWrap();
  return { w0, w1, cx0: Math.round(cx0), cx1: Math.round(cx1) };
});
check('when the canvas gets narrower, what was at its centre stays at its centre',
  v.w1 < v.w0 && Math.abs(v.cx0 - v.cx1) <= 1, JSON.stringify(v));

// ── THE SCALE BAR SAYS WHAT A METRE IS ON SCREEN ──────────────────
// The owner, 6 October 2026: "as I zoom in, that scale is still the same for
// the number of pixels, which is wrong." The scale itself is metres per IMAGE
// pixel and must NOT follow the zoom; the BAR is drawn in screen pixels and
// must. It was a fixed 10 m divided by the image scale alone, so it was out
// by exactly the zoom — and after an aerial capture the zoom starts at
// AERIAL_PAD, never 1, so it was never once right. It was also hidden
// altogether whenever 10 m would not fit ("I can't see the actual satellite
// scale guide ... it's cut off from the canvas").
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const bar = (z) => pg.evaluate((zz) => {
  DRAW.zoom = zz; redrawAll();
  const c = document.getElementById('roofCanvas'), dpr = window.devicePixelRatio || 1;
  const x = c.getContext('2d'), H = c.height / dpr;
  // The rule is drawn at H-22 in CSS pixels, from x=10 rightwards, in #0a1628.
  const y = Math.round((H - 22) * dpr);
  const n = Math.min(c.width, Math.round(700 * dpr));
  const d = x.getImageData(0, y, n, 1).data;
  const dark = (p) => d[p * 4] < 90 && d[p * 4 + 1] < 100 && d[p * 4 + 2] < 120;
  // The rule starts at x=10 and runs unbroken to its far tick; the label sits
  // 5px past it. So walk from the start and stop at the first real gap —
  // anything else dark on that row (a roof line, the grid) is not the bar.
  let a = -1;
  for (let p = Math.round(6 * dpr); p < Math.round(20 * dpr); p++) if (dark(p)){ a = p; break; }
  let b = a, gap = 0;
  for (let p = a + 1; a >= 0 && p < n; p++){
    if (dark(p)){ b = p; gap = 0; } else if (++gap > Math.round(3 * dpr)) break;
  }
  const t = getImgTransform();
  return { px: a < 0 ? 0 : (b - a) / dpr, mScr: DRAW.scaleMetresPerPx / t.s, zoom: DRAW.zoom,
    mImg: DRAW.scaleMetresPerPx, s: t.s };
}, z);
await pg.evaluate(() => { _autoScaleFromAerial(-35.3696, 18.84, true); redrawAll(); });
const bars = [];
for (const z of [1, 2, 3, 6, 12]) bars.push(await bar(z));
const round = (b) => STEPS.some(m => Math.abs(b.px * b.mScr - m) < m * 0.02);
check('the scale bar spans a round number of metres ON SCREEN at every zoom, and is always drawn',
  bars.every(b => b.px >= 60 && b.px <= 260 && round(b)),
  JSON.stringify(bars.map(b => ({ z: b.zoom, px: Math.round(b.px), m: +(b.px * b.mScr).toFixed(2), s: +b.s.toFixed(3), mImg: +b.mImg.toFixed(4) }))));
// Zooming in has to shorten the ground the bar covers — the whole complaint.
check('…and zooming in makes the bar cover less ground, not the same',
  (bars[0].px * bars[0].mScr) > (bars[4].px * bars[4].mScr) * 4,
  JSON.stringify({ at1: +(bars[0].px * bars[0].mScr).toFixed(2), at12: +(bars[4].px * bars[4].mScr).toFixed(2) }));
await pg.evaluate(() => { DRAW.zoom = 1; redrawAll(); });

// ── THE ALIGNMENT GRID (2026-10-18, the owner: "in the canvas rotating grid
// lines that appear can you change the colour to a bright orange and make the
// grid line 3x closer together"). A pale cyan line over a green-and-grey
// aerial is the one colour on the picture you cannot see, and eight columns
// across the whole canvas meant the line you were lining a ridge up with was
// usually nowhere near one.
const grid = await pg.evaluate(async () => {
  DRAW.zoom = 1;
  DRAW.showAlignGrid = true; redrawAll();
  await new Promise(r => setTimeout(r, 120));
  const cv = document.getElementById('roofCanvas');
  const dpr = window.devicePixelRatio || 1;
  const ctx = cv.getContext('2d');
  // A scanline well below the label, across the full width.
  const y = Math.round(cv.height * 0.55);
  const d = ctx.getImageData(0, y, cv.width, 1).data;
  // A 1px line on an integer coordinate straddles two pixel columns, so each
  // is only part-covered and the blend over a pale canvas is pale too. What
  // survives that is the HUE: orange leaves red ahead of blue, cyan the
  // other way round. Measure the lean, not the exact colour.
  let orange = 0, cyan = 0, runs = 0, inRun = false;
  for (let x = 0; x < cv.width; x++){
    const r = d[x*4], g = d[x*4+1], bl = d[x*4+2];
    const isOrange = (r - bl) > 30 && (r - bl) > (g - bl);
    const isCyan   = (bl - r) > 30;
    if (isOrange) orange++;
    if (isCyan) cyan++;
    if (isOrange && !inRun){ runs++; inRun = true; }
    else if (!isOrange) inRun = false;
  }
  const W = cv.width / dpr;
  DRAW.showAlignGrid = false; redrawAll();
  return { cols: (typeof ALIGN_GRID_COLS === 'number' ? ALIGN_GRID_COLS : 0),
           colour: (typeof ALIGN_GRID_COLOUR === 'string' ? ALIGN_GRID_COLOUR : ''),
           orange, cyan, runs, W: Math.round(W) };
});
check('the alignment grid is three times as fine as it was — 24 columns, not 8',
  grid.cols === 24, JSON.stringify({ cols: grid.cols }));
check('…and it is drawn in bright orange, with no cyan line left on the canvas',
  grid.orange > 0 && grid.cyan === 0 && /255,\s*1\d\d,\s*0/.test(grid.colour),
  JSON.stringify({ orange: grid.orange, cyan: grid.cyan, colour: grid.colour }));
// The dashes break each line up, so count RUNS of orange on one scanline and
// allow for a dash gap landing on it: 24 columns, never 8.
check('…and a scanline crosses about two dozen of them, not eight',
  grid.runs >= 14, JSON.stringify({ runs: grid.runs }));

// ── THE BAR'S OWN CONTROLS (2026-10-18, the same message) ───────────
const bar2 = await pg.evaluate(() => {
  const menu = document.getElementById('viewMenu');
  const btn  = document.getElementById('viewMenuBtn');
  const op   = document.getElementById('bgOpacity');
  const row  = document.getElementById('roofToolRow');
  const si   = document.getElementById('scaleIntegrityRow');
  const cal  = document.getElementById('btn-calibrate');
  return {
    hasSlider: !!op,
    inMenu: !!(op && menu && menu.contains(op)),
    // visible with the menu shut, which is how it is nearly always read
    menuShut: !!(menu && menu.style.display === 'none'),
    sliderShown: !!(op && op.offsetParent !== null),
    afterBtn: !!(op && btn && (btn.compareDocumentPosition(op) & Node.DOCUMENT_POSITION_FOLLOWING)),
    editsInToolbar: !!(si && row && row.contains(si)),
    // the scalemode pin's rule still holds: it follows the Calibrate button
    editsAfterCal: !!(si && cal && (cal.compareDocumentPosition(si) & Node.DOCUMENT_POSITION_FOLLOWING)),
    hasModeBtns: !!(document.getElementById('btnModeScaled') && document.getElementById('btnModeVisual')),
  };
});
check('the Background slider is out of the Edit font size menu…',
  bar2.hasSlider && !bar2.inMenu, JSON.stringify(bar2));
check('…and shown on the bar beside that button with the menu shut',
  bar2.menuShut && bar2.sliderShown && bar2.afterBtn, JSON.stringify(bar2));
check('the Edits buttons no longer have a row of their own — they ride with the toolbar',
  bar2.editsInToolbar && bar2.hasModeBtns && bar2.editsAfterCal, JSON.stringify(bar2));

// ── THE ZOOM BOX (2026-10-20, the owner, mid-job on Relocate Background
// Image: "the plus/minus zoom jumps too much between clicks, it should also
// let me enter an exact number (the 311% text should be editable), also as you
// can see the number doesn't change of the zoom when in 'moving picture only'
// mode"). Three faults in one control, and the first two were there long
// before the relocate mode: a flat ±0.1 step is a tenth of the picture at
// 100% and a twenty-fifth at 250%, and there was no way to type a figure at
// all.
const zm = await pg.evaluate(async () => {
  const lbl = () => document.getElementById('zoomLabel').textContent;
  const cap = () => (document.getElementById('zoomCaption') || {}).textContent;
  gotoTab('roof');
  const out = {};
  DRAW.zoom = 3.11; _zoomLabelSync();
  out.start = lbl();
  adjustZoom(0.1); out.up1 = lbl();
  adjustZoom(0.1); out.up2 = lbl();
  adjustZoom(-0.1); out.back = lbl();
  // a small zoom steps by a small amount, which a flat step cannot do
  DRAW.zoom = 0.5; _zoomLabelSync(); adjustZoom(0.1); out.lowUp = Math.round(DRAW.zoom * 100);
  out.editable = document.getElementById('zoomLabel').getAttribute('contenteditable') === 'true';
  out.capOff = cap();
  // and in relocate mode it is the PICTURE's size that moves
  const img = await new Promise(res => { const c = document.createElement('canvas');
    c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#8a8'; x.fillRect(0, 0, 600, 400);
    const im = new Image(); im.onload = () => res(im); im.src = c.toDataURL(); });
  _applyCanvasBg(img, null);
  DRAW.outline = [[50,50],[250,50],[250,200],[50,200]]; DRAW.outlineDone = true;
  DRAW.scaleMetresPerPx = 0.05;
  DRAW.zoom = 2; _zoomLabelSync();
  _bgRelocateToggle();
  out.capOn = cap(); out.picStart = lbl(); out.viewWas = DRAW.zoom;
  adjustZoom(-0.1); out.picDown = lbl(); out.picScale = Math.round(_bgAdj().scale * 100);
  out.viewNow = DRAW.zoom;
  return out;
});
// 311 → 336 → 363: 8% of whatever it is now, which reads the same at every size.
check('the zoom steps by a PROPORTION, so one click is the same size move at 311% as at 50%',
  zm.start === '311%' && zm.up1 === '336%' && zm.up2 === '363%' && zm.back === '336%' && zm.lowUp === 54,
  JSON.stringify(zm));
check('…and the figure itself can be typed in', zm.editable && zm.capOff === 'Zoom:', JSON.stringify(zm));
check('…and while the picture is being relocated the box shows the PICTURE\u2019s size, and says so',
  zm.capOn === 'Picture size:' && zm.picStart === '100%' && zm.picDown === '93%' && zm.picScale === 93,
  JSON.stringify(zm));
check('…without the view\u2019s own zoom moving an inch', zm.viewWas === 2 && zm.viewNow === 2, JSON.stringify(zm));

// typed with a real keyboard, because the commit is a blur/Enter handler
await pg.evaluate(() => { try { _bgRelocateToggle(); } catch(e){} });
await pg.click('#zoomLabel');
await pg.keyboard.press('Control+A');
await pg.keyboard.type('180%');
await pg.keyboard.press('Enter');
await pg.waitForTimeout(250);
const typed = await pg.evaluate(() => ({ lbl: document.getElementById('zoomLabel').textContent,
  view: Math.round(DRAW.zoom * 100) }));
check('an exact zoom typed into the box is the zoom', typed.lbl === '180%' && typed.view === 180, JSON.stringify(typed));
// nonsense keeps what was there rather than zooming to nothing
await pg.click('#zoomLabel');
await pg.keyboard.press('Control+A');
await pg.keyboard.type('abc');
await pg.keyboard.press('Enter');
await pg.waitForTimeout(250);
const junk = await pg.evaluate(() => ({ lbl: document.getElementById('zoomLabel').textContent,
  view: Math.round(DRAW.zoom * 100) }));
check('…and a figure that is not one leaves the zoom where it was', junk.lbl === '180%' && junk.view === 180, JSON.stringify(junk));

check('none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
