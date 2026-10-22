// THE SHEET LAYOUT IS THE PUZZLE (2026-10-21, the owner: "start fresh, i
// want a full new build, start by dividing the roof inside sheet width
// without filling any colour yet, lets make the puzzle then fill it
// afterwards, remember every sheet must run perpendicular to the
// gutter/ridge lines and they are allow to run 45deg to a hip or valley
// only, sheet must never run parralell to the gutter or ridge, sheets
// (colours) must also never run past any roof line").
// _sheetPuzzleBuild (sheet-plan.js) reads the roof's OWN outline and lines
// — nothing from the counting pass — cuts them into faces and divides each
// face into strips one cover wide, square to its gutter. THE FILL
// (_sheetPuzzleFill, the owner the same afternoon: "Try to use roof wizards
// logic and methods") is AppliCad Roof Wizard's block cutting: a block is
// ordered at one length, its hip- and valley-cut sheets leave offcuts, and
// the hip ends are cut from those offcuts spun round — same hand, never
// flipped. These pins hold the picture to those rules on the shapes the
// owner counts by hand.
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

// Lay a geometry out the way the Job Pack does and read the puzzle back:
// the faces, every piece, and a coverage / overlap sample over the roof.
async function lay(g){
  return pg.evaluate((g) => {
    DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
    DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch; DRAW.lowPitch = g.lowPitch || 0;
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
    (g.extraLines || []).forEach(l => DRAW.lines.push(Object.assign({}, l)));
    try { redrawAll(); } catch(e){}
    renderRoofSheetPlan();
    // The live card builds one roof at a time; the job's puzzle is the
    // whole set, as the Job Pack page asks for it.
    const pz = DRAW.roofs.length ? (_syncCurrentToRoof(), _sheetPuzzleBuild({})) : window._lastSheetPuzzle;
    const cover = pz.coverPx;
    const outlines = pz.roofs.map(R => R.outline);
    const faces = pz.faces.map(f => ({ id:f.id, roofIdx:f.roofIdx, ref:f.ref.kind, refLen:f.ref.len, t:f.t, d:f.d, strips:f.strips,
      pieces:f.pieces.length, hasGutter:f.hasGutter, hasBarge:f.hasBarge, hasCp:f.hasCp, pf:f.pf, fromEnd:f.fromEnd, lay:f.lay, T0:f.T0, T1:f.T1, runFromT0:f.runFromT0, anchorT:f.anchorT, tg0:f.tg0, tg1:f.tg1,
      endFace:!!f.endFace, c:f.c, edges:f.edges.map(e => ({ kind:e.kind, len:e.len, a:e.a, b:e.b })), areaPx:f.areaPx, template:f.template ? f.template.id : null }));
    const pieces = pz.pieces.map(p => ({ face:p.face.id, k:p.k, widthPx:p.widthPx, longPx:p.longPx, shortPx:p.shortPx, tip:p.tip,
      longMm:p.longMm, shortMm:p.shortMm, widthMm:p.widthMm, areaPx:p.areaPx, poly:p.poly, c:_ccCentroid(p.poly),
      full:p.full, cutTop:p.cutTop, cutBot:p.cutBot, hand:p.hand, label:p.label, from:p.from || null, ordered:!!p.ordered, lapMm:p.lapMm, lapped:!!p.lapped, scrap:!!p.scrap, fromHand:(p.fromHand === undefined ? null : p.fromHand),
      block:p.block ? p.block.letter : null, strung:!!p.strung, via:!!p.viaTemplate, chain:p.chainBelow ? p.chainBelow.length : 0,
      ends:(p.endsA && p.endsB) ? [p.endsA, p.endsB].map(e => e.map(v => Math.round((v - p.face.dMin) * pz.scaleM * 1000))) : null }));
    const blocks = (pz.blocks || []).map(b => ({ letter:b.letter, face:b.face.id, Lmm:b.Lmm, count:b.count, extra:b.extra, cutCount:b.cutCount, feeds:b.feeds }));
    // Coverage / overlap: sample a grid over the roof.
    const bb = pz.bbox; let inRoof = 0, covered = 0, doubled = 0;
    const step = Math.max(3, cover / 5);
    for (let y = bb[1] + step/2; y < bb[3]; y += step) for (let x = bb[0] + step/2; x < bb[2]; x += step){
      if (!outlines.some(o => _spPointInPoly(x, y, o))) continue;
      inRoof++;
      let n = 0; pz.pieces.forEach(p => { if (_spPointInPoly(x, y, p.poly)) n++; });
      if (n >= 1) covered++; if (n >= 2) doubled++;
    }
    // A piece straddling a roof line: vertices clearly on BOTH sides of a
    // cutting line, within that line's span.
    const cutLines = [];
    pz.roofs.forEach(R => R.lines.forEach(l => { if (/^(ridge|hip|valley|apron|changepitch)$/.test(l.type)) cutLines.push(l.pts); }));
    let straddles = 0;
    pz.pieces.forEach(p => {
      cutLines.forEach(([a, b]) => {
        const dx = b[0]-a[0], dy = b[1]-a[1], L = Math.hypot(dx, dy) || 1;
        let pos = 0, neg = 0, uLo = 1, uHi = 0;
        p.poly.forEach(q => {
          const u = ((q[0]-a[0])*dx + (q[1]-a[1])*dy) / (L*L);
          if (u < 0.01 || u > 0.99) return;   // strictly within the line: a vertex at the line's END belongs to the next line
          const s = ((q[0]-a[0])*dy - (q[1]-a[1])*dx) / L;
          if (s > 0.8) pos++; else if (s < -0.8) neg++;
          uLo = Math.min(uLo, u); uHi = Math.max(uHi, u);
        });
        // Vertices either side are not enough: a piece bounded by two valleys
        // meeting at a ridge's END has vertices either side of that ridge and
        // never crosses it. The line itself has to pass through the piece.
        if (pos && neg && [0.25, 0.5, 0.75].some(f => { const u = uLo + (uHi - uLo) * f; return _spPointInPoly(a[0] + dx*u, a[1] + dy*u, p.poly); })) straddles++;
      });
    });
    const roofArea = outlines.reduce((s, o) => s + _ccPolyArea(o), 0);
    const pieceArea = pz.pieces.reduce((s, p) => s + p.areaPx, 0);
    return { faces, pieces, blocks, tally: pz.tally, fed: pz.fedPieces, extras: pz.extraSheets, unused: pz.unusedOffcuts, unusedMaxMm: pz.unusedMaxMm,
             cover: covered / Math.max(1, inRoof), overlap: doubled / Math.max(1, inRoof), straddles,
             roofArea, pieceArea, coverPx: cover, coverMm: pz.coverMm, scaleM: pz.scaleM, nRoofs: pz.roofs.length };
  }, g);
}
const dot = (u, v) => u[0]*v[0] + u[1]*v[1];
const dirOf = e => { const L = Math.hypot(e.b[0]-e.a[0], e.b[1]-e.a[1]) || 1; return [(e.b[0]-e.a[0])/L, (e.b[1]-e.a[1])/L]; };
const sum = a => a.reduce((s, x) => s + x, 0);
// The owner's rules, checked on every face of a shape.
function rules(name, r, opts){
  opts = opts || {};
  check(name + ': every face runs its sheets off a gutter', r.faces.every(f => f.ref === 'gutter'),
    r.faces.map(f => 'F' + f.id + ':' + f.ref).join(' '));
  check('…square to the gutter and the ridge, never along them',
    r.faces.every(f => f.edges.filter(e => e.kind === 'gutter' || e.kind === 'ridge').every(e => Math.abs(dot(f.d, dirOf(e))) < 0.02)));
  check('…and meeting a hip or valley at 45°',
    r.faces.every(f => f.edges.filter(e => e.kind === 'hip' || e.kind === 'valley').every(e => Math.abs(Math.abs(dot(f.d, dirOf(e))) - Math.SQRT1_2) < 0.03)));
  check('…no piece runs past a roof line', r.straddles === 0, r.straddles + ' straddle');
  check('…the pieces cover the roof once (cover ' + r.cover.toFixed(3) + ', doubled ' + r.overlap.toFixed(3) + ')',
    r.cover >= (opts.minCover || 0.995) && r.overlap <= 0.002 && Math.abs(r.pieceArea - r.roofArea) / r.roofArea < 0.005);
  check('…every strip is one cover wide (the closer may be narrower: at the far end, where a slope\'s rectangle runs on under a wing, at both corners of a hip end laid from its apex or cut on a slope\'s columns; a sliver trimmed off an offcut is not a strip)',
    r.faces.every(f => { const ps = r.pieces.filter(p => p.face === f.id && !p.scrap); const full = ps.filter(p => Math.abs(p.widthPx - r.coverPx) < 0.05).length;
      const virt = Math.abs(f.T0 - f.tg0) > 1 || Math.abs(f.T1 - f.tg1) > 1;   // a slope whose rectangle runs on under a wing: its last column is clipped where the face ends
      return full >= ps.length - (f.lay === 'apex' || f.lay === 'grid' || virt ? 2 : 1); }),
    JSON.stringify(r.faces.map(f => { const ps = r.pieces.filter(p => p.face === f.id && !p.scrap); return [f.id, f.lay, ps.filter(p => Math.abs(p.widthPx - r.coverPx) >= 0.05).map(p => p.label + ':' + p.widthMm)]; }).filter(x => x[2].length)));
  // The fill's own rules, on every shape.
  check('…every piece is a numbered sheet of a block or cut from a named sheet\'s offcut',
    r.pieces.every(p => p.block && p.label && (p.ordered ? /^[A-Z]+\d+$/.test(p.label) : (p.from && r.pieces.some(q => q.ordered && q.label === p.from)))));
  check('…an offcut is spun, never flipped: every fed piece has the hand of the sheet it came from (a sheet\'s own foot, carried along its column, is not spun)',
    r.pieces.filter(p => !p.ordered && !p.scrap && !p.strung && p.hand).every(p => p.fromHand === p.hand && !!r.pieces.find(q => q.ordered && q.label === p.from)));
  check('…and the tally is the blocks added up', r.tally.reduce((s, x) => s + x.count, 0) === r.blocks.reduce((s, b) => s + b.count, 0));
}

// ── The plain hip the owner counts by hand ────────────────────────
let r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: RECT(900, 600), autoType: 'hip' });
check('a 18 × 12 m hip is four faces', r.faces.length === 4, r.faces.length + ' faces');
check('…the long faces 24 strips each (18 / 0.762 = 23.6 → 24) and the hip ends 16 (12 / 0.762 = 15.7 → 16): 80 pieces',
  r.pieces.length === 80 && r.faces.map(f => f.pieces).sort((a, b) => b - a).join(',') === '24,24,16,16',
  r.pieces.length + ' pieces: ' + r.faces.map(f => f.pieces).join(','));
check('…a full strip up a long face is the rafter at the pitch: 6 m run / cos 25° = 6.62 m',
  r.pieces.filter(p => p.longMm === 6620).length >= 16, [...new Set(r.pieces.map(p => p.longMm))].sort((a, b) => b - a).slice(0, 3).join(','));
check('…a strip cut by a hip is a trapezoid or a triangle, its short edge shorter than its long edge: 66 of 80 (every hip-end piece, 8 at the near corner of each long face and 9 at the far one, where the lapped corner sheet and the strip the hip just clips both count)',
  r.pieces.filter(p => p.shortPx < p.longPx - 0.5).length === 66 && r.pieces.filter(p => p.tip).length > 0,
  r.pieces.filter(p => p.shortPx < p.longPx - 0.5).length + ' cut, ' + r.pieces.filter(p => p.tip).length + ' tips');
rules('the hip', r);
check('…FILLED: two blocks of 24 at 6.63 m (6.62 rounded up to 10 mm), nothing extra — the textbook 48',
  r.blocks.length === 2 && r.blocks.every(b => b.count === 24 && b.Lmm === 6630 && !b.extra) && r.extras === 0, JSON.stringify(r.blocks));
check('…every one of the 32 hip-end pieces is cut from an offcut, and what is left over is two slivers under 0.3 m (the tips the far hip clips off the strip beside its corner)', r.fed === 32 && r.unused === 2 && r.unusedMaxMm < 300, r.fed + ' fed, ' + r.unused + ' unused, biggest ' + Math.round(r.unusedMaxMm || 0) + ' mm');
check('…the long faces are ONE run of full-width sheets from the west corner: 23 full, then the remainder at the far hip corner as a full sheet that laps its neighbour 0.29 m and shows 0.47 (the owner: "must always be full width sheets ... force all sheets across to the edges"), never a narrow closer mid-face',
  r.faces.filter(f => f.pieces === 24).every(f => { const ps = r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k); const last = ps[23];
    return f.lay === 'run' && ps.slice(0, 23).every(p => Math.abs(p.widthPx - r.coverPx) < 0.05 && !p.lapped) && last.lapped && Math.abs(last.widthMm - 474) <= 2 && Math.abs(last.lapMm - 288) <= 2; }),
  r.faces.map(f => f.lay).join(',') + ' ' + JSON.stringify(r.pieces.filter(p => p.lapped).map(p => [p.face, p.widthMm, p.lapMm])));
check('…both long faces start at the SAME corner (the world-low one), so the far hip end is fed from both sides alike',
  (() => { const longs = r.faces.filter(f => f.pieces === 24); const starts = longs.map(f => { const ps = r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k); return Math.round(ps[0].c[0]); }); return starts.length === 2 && Math.abs(starts[0] - starts[1]) < 3; })(),
  JSON.stringify(r.faces.filter(f => f.pieces === 24).map(f => f.runFromT0)));
check('…and the lapped corner sheet IS the mirror split\'s corner sheet: its offcut feeds the far hip end\'s apex strip, the full 6.62 m',
  r.pieces.filter(p => p.lapped && p.ordered).every(p => { const fed = r.pieces.find(q => q.from === p.label); return fed && fed.longMm === 6620; }),
  JSON.stringify(r.pieces.filter(p => p.lapped && p.ordered).map(p => [p.label, (r.pieces.find(q => q.from === p.label) || {}).longMm])));
check('…a hip end is laid from its apex, and the half nearest the FRONT slope is cut from the BACK slope\'s sheets (a spin crosses over; a flip would not)',
  (() => {
    const longs = r.faces.filter(f => f.pieces === 24), ends = r.faces.filter(f => f.pieces === 16);
    if (!ends.every(f => f.lay === 'apex')) return false;
    return ends.every(e => r.pieces.filter(p => p.face === e.id && !p.ordered).every(p => {
      // the long face nearest this piece's centroid, by the gutter it stands on
      const near = longs.slice().sort((a, b) => Math.hypot(a.c[0]-p.c[0], a.c[1]-p.c[1]) - Math.hypot(b.c[0]-p.c[0], b.c[1]-p.c[1]))[0];
      const donorFace = r.pieces.find(q => q.ordered && q.label === p.from).face;
      return donorFace !== near.id;
    }));
  })());
check('…and a corner sheet\'s offcut is the apex strip opposite: ↺A1 is 6.62 m long, the sheet 0.84',
  (() => { const a1 = r.pieces.find(p => p.label === 'A1'); const fed = r.pieces.find(p => p.from === 'A1'); return a1 && fed && a1.longMm === 841 && fed.longMm === 6620 && fed.shortMm === 5779; })());

// ── A gable starts its strips at the barge ───────────────────────
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: RECT(900, 600), autoType: 'gable' });
check('a gable is two faces of 24 strips', r.faces.length === 2 && r.pieces.length === 48 && r.faces.every(f => f.hasBarge),
  r.faces.length + ' faces, ' + r.pieces.length + ' pieces');
check('…laid from one barge: 23 full strips then a 0.47 m closer against the other',
  r.faces.every(f => { const ps = r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k); return ps.slice(0, 23).every(p => Math.abs(p.widthPx - r.coverPx) < 0.05) && Math.abs(ps[23].widthMm - 474) <= 2; }),
  JSON.stringify(r.pieces.filter(p => p.face === 1).map(p => p.widthMm).slice(-2)));
check('…every piece the full rafter, square at both ends', r.pieces.every(p => p.longMm === 6620 && p.shortMm === 6620));
rules('the gable', r);
check('…FILLED: two blocks of 24, nothing cut, nothing fed', r.blocks.length === 2 && r.blocks.every(b => b.count === 24 && b.cutCount === 0) && r.fed === 0 && r.extras === 0);

// ── A change of pitch is its own band at its own pitch ────────────
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, lowPitch: 10, outline: RECT(900, 600), autoType: 'gable',
  extraLines: [{ type: 'changepitch', pts: [[ox, oy + 500], [ox + 900, oy + 500]] }] });
check('a change of pitch line cuts a face in two: three faces', r.faces.length === 3, r.faces.length + ' faces');
check('…the band below it is at the lower pitch (2 m / cos 10° = 2.03 m), the slope above at the roof\'s (4 m / cos 25° = 4.41 m)',
  r.faces.some(f => f.hasCp && f.hasGutter && Math.abs(f.pf - 1 / Math.cos(10 * Math.PI / 180)) < 1e-6) &&
  r.pieces.some(p => p.longMm === 2031) && r.pieces.some(p => p.longMm === 4414),
  [...new Set(r.pieces.map(p => p.longMm))].join(','));
check('…and the upper band, with no gutter of its own, runs square to its ridge (which the change of pitch is parallel to)',
  r.faces.filter(f => f.hasCp && !f.hasGutter).every(f => f.ref === 'ridge' && f.edges.filter(e => e.kind === 'changepitch').every(e => Math.abs(dot(f.d, dirOf(e))) < 0.02)));

// ── The Big-L ─────────────────────────────────────────────────────
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: L(300, 300, 900, 700), autoType: 'hip' });
check('the Big-L is six faces (the west slope of wing and main is ONE plane)', r.faces.length === 6, r.faces.length);
check('…113 pieces: 28 off the 20 m west gutter, 24 and 21 off the main\'s, 20 off the east, 12 off the wing\'s slope and 8 on its end',
  r.pieces.length === 113 && r.faces.map(f => f.pieces).sort((a, b) => b - a).join(',') === '28,24,21,20,12,8',
  r.pieces.length + ': ' + r.faces.map(f => f.pieces).join(','));
// THE PLAIN HIP OVER THE BIG-L (the owner, 2026-10-22: "imagine the L-shape and a
// rectangle ... run the exact same logic as the plain hip ... using the offcuts in
// the same locations ... like a cookie cutter"): the main 18 × 14 is laid exactly
// as the plain hip lays it, and the wing's end is sliced out of its sheets.
const bl = {
  N: r.faces.find(x => x.pieces === 21), S: r.faces.find(x => x.pieces === 24), W: r.faces.find(x => x.pieces === 28),
  E: r.faces.find(x => x.pieces === 20), wingE: r.faces.find(x => x.pieces === 12), wingN: r.faces.find(x => x.pieces === 8) };
const seq = f => r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k);
check('…the main\'s two slopes are laid as the plain hip lays them: along the whole 18 m side of the rectangle (the north\'s gutter followed under the wing, where the wall shows 12 m), both from the WEST corner, the plain hip\'s own',
  (() => { const N = bl.N, S = bl.S; if (!N || !S) return false; const spanN = Math.abs(N.T1 - N.T0) * r.scaleM, realN = Math.abs(N.tg1 - N.tg0) * r.scaleM;
    const fromWest = f => { const ps = seq(f); return ps[0].c[0] < ps[ps.length - 1].c[0]; };
    return N.lay === 'run' && S.lay === 'run' && Math.abs(spanN - 18) < 0.05 && Math.abs(realN - 12) < 0.05 && fromWest(N) && fromWest(S); })(),
  JSON.stringify(r.faces.filter(x => x.lay === 'run').map(f => [f.pieces, +(Math.abs(f.T1 - f.T0) * r.scaleM).toFixed(2), f.runFromT0])));
check('…THE COOKIE CUTTER: the wing\'s north end is laid on the north slope\'s columns, not from its apex — C1 to C4 are the plain hip\'s own west-corner sheets slid north whole, and ✂C5 to ✂C8 the FEET of the sheets the valley cuts',
  (() => { const f = bl.wingN; if (!f || f.lay !== 'grid' || f.template !== bl.N.id) return false;
    return seq(f).map(p => p.label).join(',') === 'C1,C2,C3,C4,✂C5,✂C6,✂C7,✂C8' && !r.blocks.some(b => b.face === f.id) && seq(f).slice(0, 4).every(p => p.ordered && p.via && p.block === 'C') && seq(f).slice(4).every(p => p.strung && !p.ordered); })(),
  (() => { const f = bl.wingN; return f ? f.lay + ' tmpl F' + f.template + ' ' + JSON.stringify(seq(f).map(p => p.label)) : 'no 8-piece face'; })());
check('…and each foot tiles with its sheet\'s top edge for edge: in its column the foot\'s hip cut IS the slope piece\'s valley cut, 6 m apart, so the two add up to the plain hip\'s sheet and nothing is cut twice',
  (() => { const feet = seq(bl.wingN).filter(p => p.strung); if (feet.length !== 4) return false;
    return feet.every(ft => { const head = r.pieces.find(p => p.face === bl.N.id && p.k === ft.k && p.ordered);
      return head && head.chain === 1 && head.cutTop && head.cutBot && ft.cutTop && !ft.cutBot && ft.ends && head.ends &&
        Math.abs(ft.ends[0][1] - head.ends[0][0]) <= 20 && Math.abs(ft.ends[1][1] - head.ends[1][0]) <= 20; }); })(),
  JSON.stringify(seq(bl.wingN).filter(p => p.strung).map(ft => { const h = r.pieces.find(p => p.face === bl.N.id && p.k === ft.k && p.ordered); return [ft.label, ft.ends, h && h.ends]; })));
check('…the west face (the main\'s hip end and the wing\'s slope on one plane) is fed in the plain hip\'s own places: its south half from the north slope\'s nine west sheets (C1 at the apex, the wing\'s whole sheets and the valley-cut heads among them), its north half from the south slope\'s D1 to D5, then the wing\'s seven full sheets, and the top — the plain hip\'s top strips pushed up 6 m — from D6 to D9',
  (() => { const ps = seq(bl.W); if (!ps || bl.W.lay !== 'apex') return false; const mid = ps.slice(1, -1).map(p => p.label).join(',');
    return ps[0].scrap && ps[ps.length - 1].scrap && mid === '↺C9,↺C8,↺C7,↺C6,↺C5,↺C4,↺C3,↺C2,↺C1,↺D1,↺D2,↺D3,↺D4,↺D5,E1,B1,B2,B3,B4,B5,B6,B7,↺D6,↺D7,↺D8,↺D9'; })(),
  (() => { const f = bl.W; return f ? f.lay + ' ' + JSON.stringify(seq(f).map(p => p.label + ':' + p.longMm)) : 'no 28-piece face'; })());
check('…the main\'s east end is fed exactly as on the plain hip — all 20 from the two slopes\' east-corner sheets, D16 to D24 on the north half and C24 to C16 on the south',
  (() => { const ps = seq(bl.E); if (!ps || bl.E.lay !== 'apex') return false; const mid = ps.slice(1, -1).map(p => p.label).join(',');
    return ps.every(p => !p.ordered) && mid === '↺D16,↺D17,↺D18,↺D19,↺D20,↺D21,↺D22,↺D23,↺D24,↺C24,↺C23,↺C22,↺C21,↺C20,↺C19,↺C18,↺C17,↺C16'; })(),
  (() => { const f = bl.E; return f ? JSON.stringify(seq(f).map(p => p.label)) : 'no 20-piece face'; })());
check('…the wing\'s slope is its own plain hip: 8 sheets, the 6 m gutter divided by the cover, the four cut at its hip leaving the four valley pieces as their offcuts (the owner: "the number of orange sheets = the length of that gutter divided by sheet width")',
  (() => { const ps = seq(bl.wingE); if (!ps) return false; const A = r.blocks.find(b => b.face === bl.wingE.id && !b.extra);
    return A && A.count === 8 && ps.filter(p => p.ordered).length === 8 && ps.filter(p => !p.ordered).map(p => p.label).sort().join(',') === '↺A1,↺A2,↺A3,↺A4' && ps.filter(p => !p.ordered).every(p => p.from && p.from[0] === A.letter); })(),
  (() => { const f = bl.wingE; return f ? JSON.stringify(seq(f).map(p => p.label)) : 'no 12-piece face'; })());
check('…so the order is 64 sheets where the apex-laid wing cost 78: 48 × 7.73 m, 15 × 3.32 m, and ONE extra 3.52 m for the junction strip where the wing\'s ridge meets the main\'s hip (the one strip no plain-hip offcut is shaped for); six offcuts left over',
  r.tally.map(t => t.count + 'x' + t.Lmm).join(',') === '48x7730,1x3520,15x3320' && r.extras === 1 && r.unused === 6,
  JSON.stringify(r.tally) + ' extras ' + r.extras + ' unused ' + r.unused);
check('…a north-slope sheet cut by the valley at its foot AND the hip at its head is ONE sheet in two places: its foot on the wing\'s end, its offcut above the hip on the west end just as on the plain hip',
  seq(bl.N).filter(p => p.cutTop && p.cutBot && p.ordered && p.chain === 1).length === 4 &&
  seq(bl.N).filter(p => p.chain === 1).every(p => r.pieces.some(q => q.strung && q.from === p.label && q.face === bl.wingN.id) && r.pieces.some(q => !q.strung && !q.scrap && q.from === p.label && q.face === bl.W.id)),
  JSON.stringify(seq(bl.N).filter(p => p.chain === 1).map(p => [p.label, r.pieces.filter(q => q.from === p.label).map(q => q.label + '@F' + q.face)])));
rules('the Big-L', r);
check('…FILLED the way Auto-Block 2 blocks a ridge side: the wing\'s two slopes at 3.3 m, the main\'s two at 7.73 m, and the main\'s west hip end — the part of the shared west face longer than the wing\'s sheets — fed from offcuts or ordered on its own',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).length === 2 && r.blocks.filter(b => !b.extra && b.Lmm < 3400).length === 2,
  JSON.stringify(r.blocks));
check('…and the blocks: the main\'s two slopes 24 each at 7.73 m, the wing\'s slope 8 and the west face\'s wing run 7 at 3.32 m',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).map(b => b.count).sort().join(',') === '24,24' && r.blocks.filter(b => !b.extra && b.Lmm === 3320).map(b => b.count).sort((x, y) => x - y).join(',') === '7,8',
  JSON.stringify(r.blocks));

// ── The T: a bar within a sheet of its stem's width keeps the plain hip ──
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[ox,oy],[ox+900,oy],[ox+900,oy+260],[ox+600,oy+260],[ox+600,oy+720],[ox+300,oy+720],[ox+300,oy+260],[ox,oy+260]], autoType: 'hip' });
check('a T with hips is eight faces', r.faces.length === 8, r.faces.length);
check('…its bar is 5.2 m deep beside a stem 6 m wide — within a sheet of each other — so the bar\'s ends keep their apex and are fed from the sheets their own hips cut, the plain hip\'s way (the owner, 2026-10-22: the T "looks about 95% correct too so don\'t change much"); the cookie cutter is for a wing a sheet narrower each side',
  r.faces.filter(f => f.lay === 'grid').length === 0 && r.faces.filter(f => f.lay === 'apex').length === 3 && r.faces.filter(f => f.lay === 'apex').every(f => r.pieces.filter(p => p.face === f.id).every(p => !p.ordered)),
  r.faces.map(f => f.lay).join(',') + ' ' + JSON.stringify(r.faces.filter(f => f.lay === 'apex').map(f => r.pieces.filter(p => p.face === f.id && p.ordered).length)));
check('…the stem\'s slopes run from the free end; their valley pieces under the bar try the pool first and, with the stem\'s hip end claiming its own hips\' offcuts, fall back on the block — 16 each, as before',
  r.blocks.filter(b => !b.extra && b.Lmm === 3320).map(b => b.count).join(',') === '16,16', JSON.stringify(r.blocks));
check('…78 sheets, the only extras the two bar columns between the valleys that are longer than the bar\'s sheets', r.tally.reduce((s2, t) => s2 + t.count, 0) === 78 && r.extras === 2, JSON.stringify(r.tally) + ' extras ' + r.extras);
rules('the T', r);

// ── THE SAME LOGIC ON EVERY L (the owner, 2026-10-22: "used same logic/mechanics
// on different sizes and orientations of the l-shape making sure the logic hold,
// also the same logic should transfer to a both with a wing off the top and the
// buttom of the main plain hip") ──────────────────────────────────────────────
const gridFaces = r2 => r2.faces.filter(f => f.lay === 'grid');
const labels = (r2, f) => r2.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k).map(p => p.label);
const tallyOf = r2 => r2.tally.map(t => t.count + 'x' + t.Lmm).join(',');
const strip = l => l.replace(/^[↺✂]/, '').replace(/^[A-Z]/, '');   // the sequence without its block letter
for (const [name, outline] of [
  ['the Big-L MIRRORED (wing at the east end)', [[140,440],[740,440],[740,140],[1040,140],[1040,1140],[140,1140]]],
  ['the Big-L TURNED (wing off the south-east)', [[140,140],[1140,140],[1140,1040],[440,1040],[440,440],[140,440]]],
  ['the Big-L with its wing off the BOTTOM', [[140,140],[1040,140],[1040,840],[440,840],[440,1140],[140,1140]]]]){
  r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline, autoType: 'hip' });
  const g = gridFaces(r)[0];
  check(name + ' is the Big-L to the sheet: 48 × 7.73, 15 × 3.32 and the one 3.52 junction strip, six offcuts over',
    tallyOf(r) === '48x7730,1x3520,15x3320' && r.extras === 1 && r.unused === 6, tallyOf(r) + ' extras ' + r.extras + ' unused ' + r.unused);
  check('…the wing\'s end is cut from the slope\'s columns: the run starts at the wing\'s end, so its four whole sheets are the block\'s FIRST four and the four feet follow — the sequence of the original L whichever way it faces',
    !!g && g.template !== null && labels(r, g).map(strip).join(',') === '1,2,3,4,5,6,7,8' && labels(r, g).slice(0, 4).every(l => /^[A-Z]\d$/.test(l)) && labels(r, g).slice(4).every(l => l[0] === '✂'),
    g ? JSON.stringify(labels(r, g)) : 'no grid face: ' + r.faces.map(f => f.lay).join(','));
  rules(name, r);
}
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[340,140],[340,540],[1340,540],[1340,1140],[140,1140]], autoType: 'hip' });
check('a 24 × 12 m L with a 4 × 8 m wing: the same cut — three whole sheets, two feet and one piece from an offcut on the wing\'s end; 64 × 6.63, 23 × 2.21 and one junction strip',
  tallyOf(r) === '64x6630,1x2420,23x2210' && r.extras === 1 && gridFaces(r).length === 1 && labels(r, gridFaces(r)[0]).map(l => l[0] === '✂' ? 'foot' : l[0] === '↺' ? 'offcut' : 'whole').join(',') === 'whole,whole,whole,foot,foot,offcut',
  tallyOf(r) + ' extras ' + r.extras + ' ' + JSON.stringify(gridFaces(r).map(f => labels(r, f))));
rules('the 24 × 12 L', r);
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[640,140],[640,390],[1040,390],[1040,1090],[140,1090]], autoType: 'hip' });
check('a 10 m wide wing on an 18 × 14 main is still two sheets narrower than the main, so it is still cut from the slope\'s columns: seven whole sheets and six feet',
  gridFaces(r).length === 1 && labels(r, gridFaces(r)[0]).filter(l => /^[A-Z]\d+$/.test(l)).length === 7 && labels(r, gridFaces(r)[0]).filter(l => l[0] === '✂').length === 6 && r.extras === 1,
  JSON.stringify(gridFaces(r).map(f => labels(r, f))) + ' extras ' + r.extras);
rules('the wide-wing L', r);
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[790,140],[790,440],[1040,440],[1040,1140],[140,1140]], autoType: 'hip' });
check('a 13 m wing on a 14 m main is within a sheet of it, so there is nothing to slice: its end keeps the apex lay (the T\'s rule)',
  gridFaces(r).length === 0 && r.faces.filter(f => f.lay === 'apex').length >= 2, r.faces.map(f => f.lay).join(','));
rules('the too-wide wing', r);
// Wings off the top AND the bottom at the same end: both are cut from their
// slope's columns, both runs start at the wings' end, and the west face —
// now the main's hip end between two wing slopes — still anchors at its apex.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[440,140],[440,440],[1040,440],[1040,1140],[440,1140],[440,1440],[140,1440]], autoType: 'hip' });
check('wings off the top and the bottom of the main at the west end: BOTH wing ends are cut from their slope\'s columns, four whole sheets and four feet each',
  gridFaces(r).length === 2 && gridFaces(r).every(f => labels(r, f).map(strip).join(',') === '1,2,3,4,5,6,7,8' && labels(r, f).slice(4).every(l => l[0] === '✂')),
  JSON.stringify(gridFaces(r).map(f => labels(r, f))));
check('…the main\'s west hip end sits between the two wing slopes on the one 26 m face and is still laid from its apex (its two hips stop at the wings\' ridges, half the depth down, which is a hip end and not a bump)',
  (() => { const W = r.faces.find(f => Math.abs(f.tg1 - f.tg0) * r.scaleM > 25); return !!W && W.lay === 'apex'; })(), JSON.stringify(r.faces.map(f => [f.lay, +(Math.abs(f.tg1 - f.tg0) * r.scaleM).toFixed(1)])));
check('…80 sheets — the Big-L\'s 48 × 7.73 with 30 × 3.32 for the four wing slopes and two junction strips, one per wing',
  tallyOf(r) === '48x7730,2x3520,30x3320' && r.extras === 2, tallyOf(r) + ' extras ' + r.extras);
rules('the two-wing L', r);
// A wing standing in the MIDDLE of each slope (a cross): the slope's gutter is
// two pieces either side of the wing and both its ends are real corners, so
// the run starts at one and laps the other, exactly as the plain hip does;
// the wing's end is all feet, and its clipped corner stubs are cut from
// offcuts, never ordered as sheets of their own.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[440,140],[740,140],[740,440],[1040,440],[1040,1140],[740,1140],[740,1440],[440,1440],[440,1140],[140,1140],[140,440],[440,440]], autoType: 'hip' });
check('a cross — a wing in the middle of each slope — cuts both wing ends from the slopes\' columns: seven feet each, the two corner stubs from offcuts, and no sheet ordered for a stub',
  gridFaces(r).length === 2 && gridFaces(r).every(f => labels(r, f).filter(l => l[0] === '✂').length === 7 && labels(r, f).filter(l => l[0] === '↺').length === 2 && !labels(r, f).some(l => /^[A-Z]\d+$/.test(l))),
  JSON.stringify(gridFaces(r).map(f => labels(r, f))));
check('…its slopes run the plain hip\'s way, flush at one real corner and lapped at the other, though the wall under the wing is in two pieces',
  r.faces.filter(f => f.lay === 'run' && Math.abs(f.T1 - f.T0) * r.scaleM > 17).filter(f => Math.abs(f.tg1 - f.tg0) * r.scaleM > 17.9).length === 2 &&
  r.faces.filter(f => f.lay === 'run' && Math.abs(f.tg1 - f.tg0) * r.scaleM > 17.9).every(f => r.pieces.some(p => p.face === f.id && p.lapped && p.ordered)),
  JSON.stringify(r.faces.filter(f => f.lay === 'run').map(f => [+(Math.abs(f.T1 - f.T0) * r.scaleM).toFixed(1), +(Math.abs(f.tg1 - f.tg0) * r.scaleM).toFixed(1), r.pieces.filter(p => p.face === f.id && p.lapped).length])));
check('…81 sheets and nothing extra: both hip ends of the main fed whole from the corner sheets\' offcuts', tallyOf(r) === '48x7730,33x3320' && r.extras === 0, tallyOf(r) + ' extras ' + r.extras);
rules('the cross', r);
// Wings at OPPOSITE ends (a Z): no end to start from, so the runs fall back to
// the world-low corner; the far wing's corner column is then the plain hip's
// lapped corner sheet, a whole sheet whose offcut is a whole sheet's width.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[440,140],[440,440],[1040,440],[1040,1440],[740,1440],[740,1140],[140,1140]], autoType: 'hip' });
check('a Z — a wing off the top at the west and off the bottom at the east — cuts both wing ends from the slopes\' columns, the east wing\'s corner column a lapped whole sheet',
  gridFaces(r).length === 2 && gridFaces(r).some(f => labels(r, f).map(strip).join(',') === '1,2,3,4,5,6,7,8') && gridFaces(r).some(f => r.pieces.some(p => p.face === f.id && p.via && p.lapped)),
  JSON.stringify(gridFaces(r).map(f => labels(r, f).map(l => l + (r.pieces.find(p => p.face === f.id && p.label === l) || {}).lapMm))));
check('…81 sheets: the east wing takes a hand of offcuts the main\'s east end would have had on the plain hip, so that end costs one extra sheet beside the junction strip',
  r.tally.reduce((s2, t) => s2 + t.count, 0) === 81 && r.extras === 2, tallyOf(r) + ' extras ' + r.extras);
rules('the Z', r);

// ── The dutch gable stops at its gablet ───────────────────────────
r = await lay(JSON.parse(JSON.stringify({ scaleMetresPerPx: 0.02, calPitch: 25, outline: RECT(900, 600), autoType: 'dutch' })));
check('a dutch gable is four faces, the long ones ending at the gablet\'s apron',
  r.faces.length === 4 && r.faces.filter(f => f.pieces === 24).every(f => f.edges.some(e => e.kind === 'apron')), r.faces.map(f => f.pieces + ':' + f.edges.map(e => e.kind[0]).join('')).join(' '));
rules('the dutch', r);
check('…FILLED as four blocks (the gablet ends have full sheets against the apron, so they are blocks too): 48 at 6.63 m + 32 at 3.32 m',
  r.blocks.length === 4 && r.tally.map(x => x.count + 'x' + x.Lmm).join(',') === '48x6630,32x3320' && r.extras === 0, JSON.stringify(r.tally));

// ── The owner's hand-counted hip-and-valley shapes ────────────────
for (const [name, g] of [['double L', fx('doublel')], ['report 50', fx('report50')], ['tee', fx('tee')], ['report 58', fx('report58')]]){
  r = await lay(g);
  check(name + ' lays out: ' + r.faces.length + ' faces, ' + r.pieces.length + ' pieces', r.faces.length >= 2 && r.pieces.length > 10);
  check('…every face has a reference line and every piece a length', r.faces.every(f => f.refLen > 0) && r.pieces.every(p => p.longMm > 0 && p.areaPx > 0.5));
  check('…no piece runs past a roof line', r.straddles === 0, r.straddles + ' straddle');
  check('…and the pieces cover the roof once (cover ' + r.cover.toFixed(3) + ', doubled ' + r.overlap.toFixed(3) + ')',
    r.cover >= 0.99 && r.overlap <= 0.005 && Math.abs(r.pieceArea - r.roofArea) / r.roofArea < 0.01);
  check('…filled: every piece a block sheet or a named offcut of the same hand, the tally adding up (' + r.tally.map(x => x.count + ' × ' + (x.Lmm/1000).toFixed(2)).join(', ') + ')',
    r.pieces.every(p => p.block && p.label) && r.pieces.filter(p => !p.ordered && !p.strung && !p.scrap && p.hand).every(p => { const d = r.pieces.find(q => q.ordered && q.label === p.from); return d && d.hand === p.hand; }) &&
    r.tally.reduce((s, x) => s + x.count, 0) === r.blocks.reduce((s, b) => s + b.count, 0));
}

// ── Five roofs ────────────────────────────────────────────────────
r = await lay(fx('report41'));
check('a five-roof job is laid out roof by roof, every face tagged with its roof',
  r.nRoofs === 5 && [...new Set(r.faces.map(f => f.roofIdx))].length === 5 && r.pieces.length > 40, r.nRoofs + ' roofs, ' + r.faces.length + ' faces, ' + r.pieces.length + ' pieces');
const pics = await pg.evaluate(async () => {
  const size = url => new Promise(res => { if (!url) return res(null); const im = new Image(); im.onload = () => res({ w: im.width, h: im.height }); im.onerror = () => res(null); im.src = url; });
  const one = await size(_jpCaptureSheetPlan({}, 0));
  const oneRoofs = window._lastSheetPuzzle.roofs.length, oneFaces = window._lastSheetPuzzle.faces.length;
  const all = await size(_jpCaptureCombined('sheetplan', {}));
  const allRoofs = window._lastSheetPuzzle.roofs.length, allFaces = window._lastSheetPuzzle.faces.length;
  const thumb = await size(_jpCaptureSheetPlan({ thumb: true }, 0));
  return { one, all, thumb, oneRoofs, oneFaces, allRoofs, allFaces };
});
check('the Maps panel capture renders one roof\'s puzzle', !!(pics.one && pics.one.w === 1920 && pics.oneRoofs === 1), JSON.stringify(pics));
check('…the combined capture puts all five in one frame', !!(pics.all && pics.allRoofs === 5 && pics.allFaces > pics.oneFaces), pics.allRoofs + ' roofs');
check('…and the thumbnail is the same picture at 1×', !!(pics.thumb && pics.thumb.w * 2 === pics.one.w), JSON.stringify(pics.thumb));

// ── The layout is offered, and the old block-cut plan is gone ─────
const ui = await pg.evaluate(() => {
  const content = document.createElement('div'); document.body.appendChild(content);
  _jpRenderSheetPlan(content, { type:'sheetplan' }, 0);
  const img = content.querySelector('img');
  const live = document.querySelector('#roofSheetPlanOut canvas');
  return { hidden: SHEET_LAYOUT_HIDDEN, pageType: _jpPageTypes().some(p => p.value === 'sheetplan'),
           kind: JP_MAP_KINDS.some(k => k.kind === 'sheetplan'), img: !!(img && /^data:image\/png/.test(img.src)),
           liveIsPuzzle: !!(live && live._sheetPuzzle && live._sheetPuzzle.pieces.length), liveW: live && live.width,
           oldGone: typeof _sheetLayoutBuild === 'undefined' && typeof _slBlocks === 'undefined' && typeof toggleSheetPlanEdit === 'undefined',
           shared: typeof _ccColumnsFor === 'function' && typeof _ccNumberColumns === 'function' };
});
check('SHEET_LAYOUT_HIDDEN is off: the page type and the map kind are offered', !ui.hidden && ui.pageType && ui.kind, JSON.stringify(ui));
check('…the Sheet layout page renders the picture', ui.img);
check('…the live card shows the puzzle at 1×, and the block-cut plan is gone', ui.liveIsPuzzle && ui.liveW === 960 && ui.oldGone, JSON.stringify(ui));
check('…and the calc check keeps its own column helpers', ui.shared);

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
