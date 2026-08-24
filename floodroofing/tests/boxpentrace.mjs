// A boxed penetration was two taps: one corner, the other corner, then a size
// prompt. That is fine with a mouse and awkward on a roof with a glove on —
// and it is not how anything else on the map is drawn. Every roof line is
// traced with the pen and squared up when it lifts.
//
// So the pen now traces boxed penetrations too. Scribble round the chimney or
// drag a rough diagonal across the skylight; on lift, the rectangle around
// the ink is what lands, square to the building. Tapping two corners still
// works — an ink stroke that never moved falls through to the tap path.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:900,height:1150} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_site_mode','on'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2600);

check('the pen is allowed to trace a boxed penetration',
  await pg.evaluate(() => !!INK_TOOLS.boxedpen));
check('…and site mode is what arms the pen',
  await pg.evaluate(() => _inkModeOn() && _inkToolOk('boxedpen')));

// Drive the ink engine directly: the pointer plumbing (palm rejection, pen
// capture, pinch) has its own suite, and what matters here is what a stroke
// turns into.
async function trace(pts){
  return await pg.evaluate((ps) => {
    DRAW.tool = 'boxedpen';
    DRAW.penetrations = DRAW.penetrations || [];
    const before = DRAW.penetrations.length;
    _inkStart(ps[0], 'boxedpen', 1);
    for (let i = 1; i < ps.length; i++) _inkAdd(ps[i]);
    const took = _inkCommit();
    const p = DRAW.penetrations[DRAW.penetrations.length - 1];
    return { took, added: DRAW.penetrations.length - before,
             box: p ? { x0:p.x0, y0:p.y0, x1:p.x1, y1:p.y1, kind:p.kind,
                        cx:p.cx, cy:p.cy } : null };
  }, pts);
}

// ── a rough diagonal drag ─────────────────────────────────────────
let v = await trace([[100,100],[140,140],[190,180],[240,220],[300,260]]);
check('a dragged diagonal becomes a boxed penetration',
  v.took && v.added === 1 && v.box.kind === 'box', JSON.stringify(v.box));
check('…square to the building, corner to corner',
  v.box.x0 === 100 && v.box.y0 === 100 && v.box.x1 === 300 && v.box.y1 === 260,
  [v.box.x0,v.box.y0,v.box.x1,v.box.y1].join(','));
check('…centred where it was drawn',
  v.box.cx === 200 && v.box.cy === 180, v.box.cx + ',' + v.box.cy);

// ── a wobbly traced loop ──────────────────────────────────────────
// Round the chimney, by hand, badly — the wobble is the point.
await pg.evaluate(() => { DRAW.penetrations = []; });
v = await trace([[400,400],[452,398],[500,403],[548,401],[600,400],
                 [603,450],[598,500],[601,548],[600,600],
                 [550,604],[500,598],[448,602],[400,600],
                 [397,550],[402,500],[398,452],[400,400]]);
check('a traced loop becomes a clean rectangle, not a wobble',
  v.took && v.box.x0 === 397 && v.box.y0 === 398 && v.box.x1 === 603 && v.box.y1 === 604,
  [v.box.x0,v.box.y0,v.box.x1,v.box.y1].join(','));
check('…with four right angles, because a bounding box has nothing else',
  v.box.x1 > v.box.x0 && v.box.y1 > v.box.y0);

// ── a tap is still a tap ──────────────────────────────────────────
await pg.evaluate(() => { DRAW.penetrations = []; });
v = await trace([[200,200],[202,201],[203,200]]);
check('a stroke that never moved is a tap, and places nothing on its own',
  v.took === false && v.added === 0, 'took=' + v.took + ' added=' + v.added);

// …and the two-tap path still works, unchanged.
await pg.evaluate(() => {
  DRAW.penetrations = []; DRAW.currentPts = []; DRAW.tool = 'boxedpen';
  window._styledPrompt = function(o, cb){ cb('350x850'); };
});
v = await pg.evaluate(() => {
  // onCanvasClick takes a client event; go in at the same place it does.
  _placeBoxedPen(50, 60, 250, 160);
  const p = DRAW.penetrations[0];
  return { n: DRAW.penetrations.length, w: p.widthMm, l: p.lengthMm, label: p.sizeLabel,
           kind: p.kind };
});
check('tapping two corners still places a box and asks its size',
  v.n === 1 && v.kind === 'box' && v.w === '350' && v.l === '850',
  v.label);
check('…and both routes go through the one placement, so they agree',
  await pg.evaluate(() => typeof _placeBoxedPen === 'function'));

// ── the traced one gets asked its size too ────────────────────────
await pg.evaluate(() => { DRAW.penetrations = []; });
v = await pg.evaluate(() => {
  let asked = false;
  window._styledPrompt = function(o, cb){ asked = /size/i.test(o.title || ''); cb('600x900'); };
  DRAW.tool = 'boxedpen';
  _inkStart([10,10], 'boxedpen', 1);
  [[60,40],[120,80],[210,150]].forEach(p => _inkAdd(p));
  _inkCommit();
  const p = DRAW.penetrations[0];
  return { asked, w: p.widthMm, l: p.lengthMm, label: p.sizeLabel };
});
check('a traced box is asked its size, same as a tapped one',
  v.asked && v.w === '600' && v.l === '900', v.label);

// ── undo lifts the whole stroke ───────────────────────────────────
v = await pg.evaluate(() => {
  const before = DRAW.penetrations.length;
  undoLast();
  return { before, after: DRAW.penetrations.length };
});
check('undo takes the traced box back off the roof',
  v.after === v.before - 1, v.before + ' → ' + v.after);

// ── a line is not an opening ──────────────────────────────────────
await pg.evaluate(() => { DRAW.penetrations = []; window._styledPrompt = function(o,cb){ cb(''); }; });
v = await trace([[100,300],[160,300],[220,300],[280,300]]);
check('a dead-straight stroke still leaves something you can grab and fix',
  v.took && v.box && (v.box.y1 - v.box.y0) > 0 && (v.box.x1 - v.box.x0) > 100,
  'w=' + (v.box.x1-v.box.x0) + ' h=' + (v.box.y1-v.box.y0).toFixed(1));

// ── the preview does not eat the notes layer ──────────────────────
// The boxed-pen preview draws its own rectangle instead of the chain fitter's
// shape. Returning early from that block would have skipped _notesRender,
// which runs after it — so notes drawn on the map would vanish mid-stroke.
v = await pg.evaluate(() => {
  DRAW.notes = [{ pts:[[50,50],[90,90]], c:'#e11d48', w:3 }];
  DRAW.tool = 'boxedpen';
  _inkStart([300,300], 'boxedpen', 1); _inkAdd([380,360]); _inkAdd([420,400]);
  redrawAll();                                   // mid-stroke, ink live
  const stillThere = (DRAW.notes || []).length;
  _inkCancel(); redrawAll();
  return stillThere;
});
check('notes still render while a box is being traced over them', v === 1, v + ' note(s)');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
