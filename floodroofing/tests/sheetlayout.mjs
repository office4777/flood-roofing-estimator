// THE SHEET LAYOUT IS THE BLOCK-CUT PLAN (2026-10-21). Hidden since
// 2026-09-14 because its own face-finder, colours and numbering disagreed
// with the cut list, the picture is now built from the SAME sections the
// calc check and the SHEETS TO ORDER legend read (_sheetLayoutBuild in
// sheet-plan.js): every slope is a block ordered at one length, every sheet
// is cut where the roof lines cut it, and a hip end is sheeted from the
// mirrored offcuts of the sheets cut at that hip — AppliCad Roof Wizard's
// Auto-Block 2 / Block-Cut, and the owner's own counting rule drawn out.
// These pins hold the picture to the count: the pieces ARE the counted
// sheets, they cover the roof, and the hip-end arithmetic closes.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const fx = name => JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-' + name + '.json'), 'utf8'));
const ox = 140, oy = 140;
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1700,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => gotoTab('materials'));
await pg.waitForTimeout(600);

// Lay a geometry out the way the Job Pack does and read the plan back:
// one record per piece plus a coverage / overlap sample over the roof.
async function lay(g){
  return pg.evaluate((g) => {
    DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
    DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch; DRAW.lowPitch = 0;
    DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true;
    DRAW.lines = (g.lines || []).map(l => Object.assign({}, l));
    DRAW.sheetPlanDeletedIds = []; DRAW.sheetGroupQtyOverrides = {}; DRAW.sheetGroupOverrides = {};
    DRAW.roofType = g.autoType || g.roofType || 'hip';
    if (g.roofs && g.roofs.length){
      DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
      DRAW.activeRoofIdx = g.activeRoofIdx || 0;
    } else if (g.autoType && !(g.lines||[]).length){
      try { autoGenerateRoof(g.autoType); } catch(e){}
    }
    try { redrawAll(); } catch(e){}
    renderRoofSheetPlan();
    const secs = window._lastSheetSections || [];
    const lay = _sheetLayoutBuild(secs);
    _slBlocks(lay);   // stamps the block letter on every piece, as the picture does
    const pieces = lay.pieces.map(p => ({ kind:p.kind, num:p.num, block:p.block, sd:p.sd, j:p.j, phantom:!!p.phantom,
      lenMm:p.lenMm, shortMm:p.shortMm, offcutMm:p.offcutMm, orderedMm:p.orderedMm, cut:!!p.cut, from:p.from,
      donorNum:p.donorNum, fits:p.fits, needMm:p.needMm, endSign:p.endSign, area: p.poly ? _ccPolyArea(p.poly) : 0, roof:p.roof }));
    // Coverage: sample the roof(s) on a grid, count points under a piece
    // and points under two.
    let inN = 0, covN = 0, dblN = 0;
    const polys = lay.pieces.filter(p => p.poly && p.kind !== 'spare').map(p => p.poly);
    lay.outlines.forEach(o => {
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      o.forEach(p => { minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); });
      const step = Math.max(2, (maxX-minX)/80);
      for (let x = minX + step/2; x < maxX; x += step) for (let y = minY + step/2; y < maxY; y += step){
        if (!_spPointInPoly(x, y, o)) continue;
        inN++;
        let n = 0; for (const P of polys){ if (_spPointInPoly(x, y, P)) n++; }
        if (n) covN++; if (n > 1) dblN++;
      }
    });
    const groups = ((window._lastSheetCounts||{}).groups||[]).map(g => ({ mm:g.orderedMm, count:g.count }));
    return { pieces, secs: secs.map(s => ({ perSide:s.perSide, perNeg:s.perNeg, perPos:s.perPos, total:s.total, mono:!!s.mono, mm:s.orderedMm, spare:s.valleyExtra||0, roof:s.roof||'' })),
             groups, cover: inN ? covN/inN : 0, overlap: inN ? dblN/inN : 0, phantoms: lay.phantoms };
  }, g);
}
const sheetsOf = r => r.pieces.filter(p => p.kind === 'sheet');
const grand = r => r.groups.reduce((a, g) => a + g.count, 0);

// ── A plain hip: the textbook picture ──────────────────────────────
let r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: RECT(900, 600), lines: [], autoType: 'hip' });
check('a plain hip is two blocks of 24 full-length sheets: 48 pieces for 48 sheets',
  sheetsOf(r).length === 48 && grand(r) === 48, sheetsOf(r).length + ' pieces, ' + grand(r) + ' counted');
check('…numbered 1–24 on one slope and 25–48 on the other, the calc check\'s numbers',
  sheetsOf(r).map(p => p.num).sort((a, b) => a - b).join(',') === Array.from({length:48}, (_, i) => i + 1).join(','));
check('…in two blocks A and B', [...new Set(sheetsOf(r).map(p => p.block))].sort().join('') === 'AB');
const cutS = sheetsOf(r).filter(p => p.cut);
check('…the sheets at the hips are cut short (seven or eight a side at each end), the middle ones full',
  cutS.length >= 28 && cutS.length <= 32, cutS.length + ' cut');
check('…a cut sheet\'s short edge plus its offcut is the ordered length',
  cutS.every(p => Math.abs(p.shortMm + p.offcutMm - p.orderedMm) <= 1), JSON.stringify(cutS.slice(0,2)));
const ends = r.pieces.filter(p => p.kind === 'end');
check('…and both hip ends are sheeted from offcuts: 32 end pieces, every one named for its donor',
  ends.length === 32 && ends.every(p => p.donorNum != null), ends.length + ' end pieces, ' + ends.filter(p => p.donorNum == null).length + ' without a donor');
check('…every offcut is long enough for the piece it becomes (equal pitches mirror exactly)',
  ends.every(p => p.fits), ends.filter(p => !p.fits).map(p => p.donorNum + ':' + p.offcutMm + '<' + p.needMm).join(' '));
const corner = sheetsOf(r).filter(p => p.j === 0 || p.j === 23);
check('…the corner sheet is a sliver, not a full sheet (the hip springs from the very corner)',
  corner.every(p => p.lenMm < 1200), corner.map(p => p.lenMm).join(','));
check('…and the pieces cover the roof with no doubling up',
  r.cover > 0.98 && r.overlap < 0.02, 'cover ' + r.cover.toFixed(3) + ' overlap ' + r.overlap.toFixed(3));
check('no sheet was left off the roof', r.phantoms === 0, r.phantoms + ' phantoms');

// ── The canonical Big-L ────────────────────────────────────────────
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: L(300,300,900,700), lines: [], autoType: 'hip' });
check('the Big-L lays one piece per counted sheet (the valley spare aside)',
  sheetsOf(r).length === grand(r) - r.secs.reduce((a, s) => a + s.spare, 0), sheetsOf(r).length + ' vs ' + grand(r));
check('…its main\'s far hip end and the wing\'s hip end are sheeted from offcuts',
  r.pieces.filter(p => p.kind === 'end' && p.donorNum != null).length >= 24,
  r.pieces.filter(p => p.kind === 'end').length + ' end pieces');
const endsBy = L => new Set(r.pieces.filter(p => p.kind === 'end' && p.block === L).map(p => p.endSign));
check('…the hip to the wing\'s ridge end is a junction, not a hip end: the upper slope has one end sheeted from offcuts, the lower slope both',
  endsBy('A').size === 1 && endsBy('B').size === 2, 'A ends ' + [...endsBy('A')] + ' B ends ' + [...endsBy('B')]);
check('…and the roof is covered but for the valley triangle the +1 spare is for',
  r.cover > 0.93 && r.overlap < 0.02, 'cover ' + r.cover.toFixed(3) + ' overlap ' + r.overlap.toFixed(3));

// ── The owner's hand-counted hip-and-valley shapes ─────────────────
for (const [name, minCover] of [['doublel', 0.72], ['report50', 0.85], ['tee', 0.9]]){
  r = await lay(fx(name));
  check(name + ': one piece per counted sheet, every one numbered',
    sheetsOf(r).length === grand(r) - r.secs.reduce((a, s) => a + s.spare, 0) && sheetsOf(r).every(p => p.num > 0),
    sheetsOf(r).length + ' vs ' + grand(r));
  check('…covering the roof (cover ≥ ' + minCover + ') with no doubling up',
    r.cover >= minCover && r.overlap < 0.03, 'cover ' + r.cover.toFixed(3) + ' overlap ' + r.overlap.toFixed(3));
  check('…no piece without area', r.pieces.filter(p => !p.phantom).every(p => p.area > 0.5));
}

// ── A step gable / mono roof: no hips, no end pieces, every column full or cut by its apron
r = await lay(fx('report58'));
check('report 58 (gable blocks) lays every counted sheet and invents no hip ends',
  sheetsOf(r).length === grand(r) && !r.pieces.some(p => p.kind === 'end'), sheetsOf(r).length + ' vs ' + grand(r));
check('…and covers the roof (its skewed junction column doubles a little)', r.cover > 0.95 && r.overlap < 0.07, 'cover ' + r.cover.toFixed(3) + ' overlap ' + r.overlap.toFixed(3));

// ── Five roofs: the combined picture stacks them ───────────────────
r = await lay(fx('report41'));
check('a five-roof job lays every roof\'s sheets, each tagged with its roof',
  sheetsOf(r).length === grand(r) && [...new Set(sheetsOf(r).map(p => p.roof))].length === 5, sheetsOf(r).length + ' vs ' + grand(r));
const pics = await pg.evaluate(async () => {
  const size = url => new Promise(res => { if (!url) return res(null); const im = new Image(); im.onload = () => res({ w: im.width, h: im.height }); im.onerror = () => res(null); im.src = url; });
  const one = await size(_jpCaptureSheetPlan({}, 0));
  const all = await size(_jpCaptureCombined('sheetplan', {}));
  const thumb = await size(_jpCaptureSheetPlan({ thumb: true }, 0));
  return { one, all, thumb };
});
check('the Maps panel capture renders a roof\'s layout', !!(pics.one && pics.one.w > 900), JSON.stringify(pics.one));
check('…the combined capture stacks the five', !!(pics.all && pics.one && pics.all.h > pics.one.h * 3), JSON.stringify(pics.all));
check('…and the thumbnail is the same picture at 1×', !!(pics.thumb && pics.thumb.w * 2 === pics.one.w), JSON.stringify(pics.thumb));

// ── The layout is offered again ────────────────────────────────────
const ui = await pg.evaluate(() => {
  const content = document.createElement('div'); document.body.appendChild(content);
  _jpRenderSheetPlan(content, { type:'sheetplan' }, 0);
  const img = content.querySelector('img');
  const live = document.querySelector('#roofSheetPlanOut canvas');
  return { hidden: SHEET_LAYOUT_HIDDEN, pageType: _jpPageTypes().some(p => p.value === 'sheetplan'),
           kind: JP_MAP_KINDS.some(k => k.kind === 'sheetplan'), img: !!(img && /^data:image\/png/.test(img.src)),
           liveIsNew: !!(live && live._sheetLayout && live._sheetBlocks), editGone: typeof toggleSheetPlanEdit === 'undefined',
           shared: typeof _ccColumnsFor === 'function' && typeof _ccNumberColumns === 'function' };
});
check('SHEET_LAYOUT_HIDDEN is off: the page type and the map kind are back', !ui.hidden && ui.pageType && ui.kind, JSON.stringify(ui));
check('…the Sheet layout page renders the picture', ui.img);
check('…the live card shows the new plan, and the old click-to-delete edit mode is gone', ui.liveIsNew && ui.editGone);
check('…and the calc check tiles its columns through the same helpers', ui.shared);

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
