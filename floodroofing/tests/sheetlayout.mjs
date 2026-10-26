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
      endFace:!!f.endFace, gablet:!!f.gablet, walls:f.walls ? f.walls.length : 0, c:f.c, edges:f.edges.map(e => ({ kind:e.kind, len:e.len, a:e.a, b:e.b })), areaPx:f.areaPx, template:f.template ? f.template.id : null }));
    const pieces = pz.pieces.map(p => ({ face:p.face.id, k:p.k, widthPx:p.widthPx, longPx:p.longPx, shortPx:p.shortPx, tip:p.tip,
      longMm:p.longMm, shortMm:p.shortMm, cutShortMm:p.cutShortMm, widthMm:p.widthMm, areaPx:p.areaPx, poly:p.poly, c:_ccCentroid(p.poly),
      full:p.full, cutTop:p.cutTop, cutBot:p.cutBot, hand:p.hand, label:p.label, from:p.from || null, ordered:!!p.ordered, lapMm:p.lapMm, lapped:!!p.lapped, scrap:!!p.scrap, fromHand:(p.fromHand === undefined ? null : p.fromHand),
      block:p.block ? p.block.letter : null, pushed:!!p.pushed, series:!!p.series, strung:!!p.strung, via:!!p.viaTemplate, chain:p.chainBelow ? p.chainBelow.length : 0,
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
    return { faces, pieces, blocks, tally: pz.tally, fed: pz.fedPieces, extras: pz.extraSheets, pushed: pz.pushSheets, unused: pz.unusedOffcuts, unusedList: pz.unusedList || [], unusedMaxMm: pz.unusedMaxMm,
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
  // A face with no gutter at all (an L's narrow arm between its barge, the
  // valley and the ridge) runs off its ridge — the owner's rule, not a lapse.
  check(name + ': every face runs its sheets off a gutter (off its ridge only where it has none)', r.faces.every(f => f.ref === 'gutter' || (f.ref === 'ridge' && !f.edges.some(e => e.kind === 'gutter'))),
    r.faces.map(f => 'F' + f.id + ':' + f.ref).join(' '));
  check('…square to the gutter and the ridge, never along them',
    r.faces.every(f => f.edges.filter(e => e.kind === 'gutter' || e.kind === 'ridge').every(e => Math.abs(dot(f.d, dirOf(e))) < 0.02)));
  check('…and meeting a hip or valley at 45°',
    r.faces.every(f => f.edges.filter(e => e.kind === 'hip' || e.kind === 'valley').every(e => Math.abs(Math.abs(dot(f.d, dirOf(e))) - Math.SQRT1_2) < 0.03)));
  check('…no piece runs past a roof line', r.straddles === 0, r.straddles + ' straddle');
  check('…the pieces cover the roof once (cover ' + r.cover.toFixed(3) + ', doubled ' + r.overlap.toFixed(3) + ')',
    r.cover >= (opts.minCover || 0.995) && r.overlap <= 0.002 && Math.abs(r.pieceArea - r.roofArea) / r.roofArea < 0.005);
  check('…every strip is one cover wide (the closer may be narrower: at the far end, where a slope\'s rectangle runs on under a wing, at both corners of a hip end laid from its apex or cut on a slope\'s columns, against both walls of a dutch gablet and under its apron, at a slope\'s corners beside a gablet; a sliver trimmed off an offcut is not a strip)',
    r.faces.every(f => { const ps = r.pieces.filter(p => p.face === f.id && !p.scrap); const full = ps.filter(p => Math.abs(p.widthPx - r.coverPx) < 0.05).length;
      const virt = Math.abs(f.T0 - f.tg0) > 1 || Math.abs(f.T1 - f.tg1) > 1;   // a slope whose rectangle runs on under a wing: its last column is clipped where the face ends
      return full >= ps.length - (f.gablet && f.lay === 'apex' ? 3 : f.walls ? f.walls + 1 : (f.lay === 'apex' || f.lay === 'grid' || virt ? 2 : 1)); }),
    JSON.stringify(r.faces.map(f => { const ps = r.pieces.filter(p => p.face === f.id && !p.scrap); return [f.id, f.lay, ps.filter(p => Math.abs(p.widthPx - r.coverPx) >= 0.05).map(p => p.label + ':' + p.widthMm)]; }).filter(x => x[2].length)));
  // The fill's own rules, on every shape.
  check('…every piece is a numbered sheet of a block or cut from a named sheet\'s offcut',
    r.pieces.every(p => p.block && p.label && (p.ordered ? /^[A-Z]+\d+$/.test(p.label) : (p.from && r.pieces.some(q => q.ordered && q.label === p.from)))));
  check('…an offcut is spun, never flipped: every fed piece has the hand of the sheet it came from (a sheet\'s own foot, carried along its column, is not spun; a RECTANGULAR offcut, hand 0, has none to keep)',
    r.pieces.filter(p => !p.ordered && !p.scrap && !p.strung && p.hand).every(p => (p.fromHand === p.hand || p.fromHand === 0) && !!r.pieces.find(q => q.ordered && q.label === p.from)));
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
check('…the west face (the main\'s hip end and the wing\'s slope on one plane) is fed in the plain hip\'s own places: its south half from the north slope\'s nine west sheets (C1 at the apex, the wing\'s whole sheets and the valley-cut heads among them), its north half from the south slope\'s D1 to D6 — D6 on the junction strip where the wing\'s ridge dies into the hip, which is cut ONCE along the hip (the owner, 2026-10-22: "a straight cut, not have extra length to go along the ridge"), so its short side is the diagonal\'s own 2.68 and the plain hip\'s offcut fits it — then the wing\'s seven full sheets, an eighth B sheet heading the top run, and the top — the plain hip\'s top strips pushed up 6 m — from D7 to D9',
  (() => { const ps = seq(bl.W); if (!ps || bl.W.lay !== 'apex') return false; const mid = ps.slice(1, -1).map(p => p.label).join(',');
    const j = ps.find(p => p.label === '↺D6');
    return ps[0].scrap && ps[ps.length - 1].scrap && mid === '↺C9,↺C8,↺C7,↺C6,↺C5,↺C4,↺C3,↺C2,↺C1,↺D1,↺D2,↺D3,↺D4,↺D5,↺D6,B1,B2,B3,B4,B5,B6,B7,B8,↺D7,↺D8,↺D9' && !!j && j.longMm === 3520 && j.shortMm === 3310 && Math.abs(j.cutShortMm - 2680) <= 10 && !ps.some(p => p.pushed); })(),
  (() => { const f = bl.W; return f ? f.lay + ' ' + JSON.stringify(seq(f).map(p => p.label + ':' + p.longMm)) : 'no 28-piece face'; })());
check('…the main\'s east end is fed exactly as on the plain hip — all 20 from the two slopes\' east-corner sheets, D16 to D24 on the north half and C24 to C16 on the south',
  (() => { const ps = seq(bl.E); if (!ps || bl.E.lay !== 'apex') return false; const mid = ps.slice(1, -1).map(p => p.label).join(',');
    return ps.every(p => !p.ordered) && mid === '↺D16,↺D17,↺D18,↺D19,↺D20,↺D21,↺D22,↺D23,↺D24,↺C24,↺C23,↺C22,↺C21,↺C20,↺C19,↺C18,↺C17,↺C16'; })(),
  (() => { const f = bl.E; return f ? JSON.stringify(seq(f).map(p => p.label)) : 'no 20-piece face'; })());
check('…the wing\'s slope is its own plain hip: 8 sheets, the 6 m gutter divided by the cover, the four cut at its hip leaving the four valley pieces as their offcuts (the owner: "the number of orange sheets = the length of that gutter divided by sheet width")',
  (() => { const ps = seq(bl.wingE); if (!ps) return false; const A = r.blocks.find(b => b.face === bl.wingE.id && !b.extra);
    return A && A.count === 8 && ps.filter(p => p.ordered).length === 8 && ps.filter(p => !p.ordered).map(p => p.label).sort().join(',') === '↺A1,↺A2,↺A3,↺A4' && ps.filter(p => !p.ordered).every(p => p.from && p.from[0] === A.letter); })(),
  (() => { const f = bl.wingE; return f ? JSON.stringify(seq(f).map(p => p.label)) : 'no 12-piece face'; })());
check('…so the order is 64 sheets where the apex-laid wing cost 78: 48 × 7.73 m and 16 × 3.32 m — the 16th the B sheet heading the top run, where a 3.52 m extra for the junction strip stood before the straight-cut rule; nothing extra, nothing pushed, six offcuts left over',
  r.tally.map(t => t.count + 'x' + t.Lmm).join(',') === '48x7730,16x3320' && r.extras === 0 && r.pushed === 0 && r.unused === 6,
  JSON.stringify(r.tally) + ' extras ' + r.extras + ' pushed ' + r.pushed + ' unused ' + r.unused);
check('…a north-slope sheet cut by the valley at its foot AND the hip at its head is ONE sheet in two places: its foot on the wing\'s end, its offcut above the hip on the west end just as on the plain hip',
  seq(bl.N).filter(p => p.cutTop && p.cutBot && p.ordered && p.chain === 1).length === 4 &&
  seq(bl.N).filter(p => p.chain === 1).every(p => r.pieces.some(q => q.strung && q.from === p.label && q.face === bl.wingN.id) && r.pieces.some(q => !q.strung && !q.scrap && q.from === p.label && q.face === bl.W.id)),
  JSON.stringify(seq(bl.N).filter(p => p.chain === 1).map(p => [p.label, r.pieces.filter(q => q.from === p.label).map(q => q.label + '@F' + q.face)])));
rules('the Big-L', r);
check('…FILLED the way Auto-Block 2 blocks a ridge side: the wing\'s two slopes at 3.3 m, the main\'s two at 7.73 m, and the main\'s west hip end — the part of the shared west face longer than the wing\'s sheets — fed from offcuts or ordered on its own',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).length === 2 && r.blocks.filter(b => !b.extra && b.Lmm < 3400).length === 2,
  JSON.stringify(r.blocks));
check('…and the blocks: the main\'s two slopes 24 each at 7.73 m, the wing\'s slope 8 and the west face\'s wing run 8 at 3.32 m',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).map(b => b.count).sort().join(',') === '24,24' && r.blocks.filter(b => !b.extra && b.Lmm === 3320).map(b => b.count).sort((x, y) => x - y).join(',') === '8,8',
  JSON.stringify(r.blocks));

// ── The T: a bar within a sheet of its stem's width keeps the plain hip ──
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[ox,oy],[ox+900,oy],[ox+900,oy+260],[ox+600,oy+260],[ox+600,oy+720],[ox+300,oy+720],[ox+300,oy+260],[ox,oy+260]], autoType: 'hip' });
check('a T with hips is eight faces', r.faces.length === 8, r.faces.length);
check('…its bar is 5.2 m deep beside a stem 6 m wide — within a sheet of each other — so the bar\'s ends keep their apex and are fed from the sheets their own hips cut, the plain hip\'s way (the owner, 2026-10-22: the T "looks about 95% correct too so don\'t change much"); the cookie cutter is for a wing a sheet narrower each side',
  r.faces.filter(f => f.lay === 'grid').length === 0 && r.faces.filter(f => f.lay === 'apex').length === 3 && r.faces.filter(f => f.lay === 'apex').every(f => r.pieces.filter(p => p.face === f.id).every(p => !p.ordered || p.pushed)) && r.pushed <= 1,
  r.faces.map(f => f.lay).join(',') + ' ' + JSON.stringify(r.faces.filter(f => f.lay === 'apex').map(f => r.pieces.filter(p => p.face === f.id && p.ordered).length)) + ' pushed ' + r.pushed);
check('…the stem\'s slopes run from the free end; their valley pieces under the bar try the pool first — the bar\'s own valley-cut sheets feed the shorter ones once they are sheets (2026-10-22: a strip under half the block\'s length is never a block sheet) — so the two stem slopes are 15 each where they were 16',
  r.blocks.filter(b => !b.extra && b.Lmm === 3320).map(b => b.count).join(',') === '15,15', JSON.stringify(r.blocks));
check('…74 sheets (75 until a half-width two-cut triangle at a stem slope\'s clipped last column became a scrap, 2026-10-22 evening, which freed the offcut that had been feeding it and put the bar\'s east end wholly on offcuts with nothing pushed; 78 before the offcut rules of 2026-10-22), the only extras the two bar columns between the valleys that are longer than the bar\'s sheets',
  r.tally.reduce((s2, t) => s2 + t.count, 0) === 74 && r.extras === 2 && r.pushed === 0, JSON.stringify(r.tally) + ' extras ' + r.extras + ' pushed ' + r.pushed);
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
  check(name + ' is the Big-L to the sheet: 48 × 7.73 and 16 × 3.32, nothing extra, nothing pushed, six offcuts over',
    tallyOf(r) === '48x7730,16x3320' && r.extras === 0 && r.pushed === 0 && r.unused === 6, tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed + ' unused ' + r.unused);
  check('…the wing\'s end is cut from the slope\'s columns: the run starts at the wing\'s end, so its four whole sheets are the block\'s FIRST four and the four feet follow — the sequence of the original L whichever way it faces',
    !!g && g.template !== null && labels(r, g).map(strip).join(',') === '1,2,3,4,5,6,7,8' && labels(r, g).slice(0, 4).every(l => /^[A-Z]\d$/.test(l)) && labels(r, g).slice(4).every(l => l[0] === '✂'),
    g ? JSON.stringify(labels(r, g)) : 'no grid face: ' + r.faces.map(f => f.lay).join(','));
  rules(name, r);
}
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[340,140],[340,540],[1340,540],[1340,1140],[140,1140]], autoType: 'hip' });
check('a 24 × 12 m L with a 4 × 8 m wing: the same cut — three whole sheets, two feet and one piece from an offcut on the wing\'s end; 64 × 6.63 and 23 × 2.21 (the junction strip cut straight and fed from D6, the top run headed by a pushed-in B sheet), where it was 64 + 23 + a 2.42 extra — and the owner\'s "that ones perfect" (2026-10-23): no later pass may move it',
  tallyOf(r) === '64x6630,23x2210' && r.extras === 0 && r.pushed === 1 && gridFaces(r).length === 1 && labels(r, gridFaces(r)[0]).map(l => l[0] === '✂' ? 'foot' : l[0] === '↺' ? 'offcut' : 'whole').join(',') === 'whole,whole,whole,foot,foot,offcut',
  tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed + ' ' + JSON.stringify(gridFaces(r).map(f => labels(r, f))));
rules('the 24 × 12 L', r);
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[640,140],[640,390],[1040,390],[1040,1090],[140,1090]], autoType: 'hip' });
check('a 10 m wide wing on an 18 × 14 main is still two sheets narrower than the main, so it is still cut from the slope\'s columns: seven whole sheets and six feet',
  gridFaces(r).length === 1 && labels(r, gridFaces(r)[0]).filter(l => /^[A-Z]\d+$/.test(l)).length === 7 && labels(r, gridFaces(r)[0]).filter(l => l[0] === '✂').length === 6 && r.extras === 0,
  JSON.stringify(gridFaces(r).map(f => labels(r, f))) + ' extras ' + r.extras);
// The owner's corrections on this roof (2026-10-22): "the blue B7 sheet should
// be a green offcut … orange offcuts A5 & A6 in the bottom left corner should
// have been purple offcuts to the sheets C8 & C9 … add another full sheet in
// the middle of the apex to push all the offcuts down one making them longer".
{
  const W = r.faces.find(f => f.lay === 'apex' && Math.abs(f.tg1 - f.tg0) * r.scaleM > 18.9);
  const ps = W ? r.pieces.filter(p => p.face === W.id).sort((a, b) => a.k - b.k) : [];
  const lab = ps.map(p => p.label);
  check('…the west face: C9 and C8\'s offcuts (the north slope\'s sheets cut by the main\'s hip) on the two bottom-left corner pieces, then C7 up to C1 at the apex; D1\'s offcut at the apex (the owner: "Does E1 actually have to be a full sheet or can it be the offcut to D1?"), D2, then D3 on the junction strip cut straight along the hip (6.04 / 5.20 for the fit, though the face reads 5.52 along the ridge), the six B sheets and a SEVENTH beside B6 — his "7th Blue B sheet" — and D4 to D9 each a strip further out, D8 on the piece that was the blue B7',
    !!W && lab.slice(1, 10).join(',') === '↺C9,↺C8,↺C7,↺C6,↺C5,↺C4,↺C3,↺C2,↺C1' && lab.slice(10, 13).join(',') === '↺D1,↺D2,↺D3' && Math.abs(ps[12].longMm - 6040) <= 10 && Math.abs(ps[12].shortMm - 5520) <= 10 && Math.abs(ps[12].cutShortMm - 5200) <= 10 && lab.slice(13, 20).join(',') === 'B1,B2,B3,B4,B5,B6,B7' && ps[19].ordered && ps[19].shortMm < ps[19].longMm && lab.slice(20).join(',') === '↺D4,↺D5,↺D6,↺D7,↺D8,↺D9' && !lab.some(l => /^E\d/.test(l)),
    JSON.stringify(lab));
  const wingE = r.faces.find(f => f.lay === 'run' && Math.abs(f.tg1 - f.tg0) * r.scaleM < 6 && Math.abs(f.T1 - f.T0) * r.scaleM > 18);
  const wl = wingE ? r.pieces.filter(p => p.face === wingE.id).sort((a, b) => a.k - b.k).map(p => p.label) : [];
  check('…and the wing\'s east slope takes its valley pieces from its OWN hip-cut sheets A1 to A6, not from C8 and C9 — an offcut belongs to the face across the HIP that cut it, never the face across a valley',
    !!wingE && wl.slice(7, 13).join(',') === '↺A1,↺A2,↺A3,↺A4,↺A5,↺A6', JSON.stringify(wl));
  check('…62 sheets where the first cut of this roof ordered 63: 48 × 7.73, 7 + 7 × 5.52, nothing extra and nothing pushed',
    tallyOf(r) === '48x7730,14x5520' && r.extras === 0 && r.pushed === 0, tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed);
}
rules('the wide-wing L', r);
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[790,140],[790,440],[1040,440],[1040,1140],[140,1140]], autoType: 'hip' });
check('a 13 m wing on a 14 m main: the wing\'s block (13 × 20 m) is the bigger one, so IT is the rectangle and its end keeps the apex lay (the T\'s rule)',
  gridFaces(r).length === 0 && r.faces.filter(f => f.lay === 'apex').length >= 2, r.faces.map(f => f.lay).join(','));
rules('the too-wide wing', r);
// FEEDBACK REPORT 70 (2026-10-27, the owner: "use the plain hip logic first,
// then slice the sheets ... like a cookie cutter ... that plain hip logic is
// there should be 30 sheets (same as the green southside) then that whole
// north triangle should be cut from the purple sheets"). A 10 m wing standing
// only 4.17 m out from a 22.78 × 11.39 m main: its end is 5.00 m deep beside
// the main's 5.69 m slope, within a sheet, and its apex reaches past the
// slope's gutter line — both used to keep it on its own apex, with four
// extras (5.00, 4.24, 3.48, 2.72) ordered for it and the A sheets' offcuts in
// its west half.
r = await lay(fx('report70'));
{
  const gf = gridFaces(r), lab = gf.length ? labels(r, gf[0]) : [];
  const north = gf.length ? r.blocks.find(b => b.face === gf[0].template) : null;
  const south = r.blocks.find(b => b !== north && b.count === 30);
  check('report 70: the wing\'s north triangle is cut from the main\'s north-slope sheets — seven whole and the feet of six more (C1–C7, ✂C8–✂C13), the tip off an offcut, nothing ordered for it',
    gf.length === 1 && lab.filter(l => /^[A-Z]\d+$/.test(l)).length === 7 && lab.filter(l => l[0] === '✂').length === 6 &&
    r.pieces.filter(p => p.face === gf[0].id && p.ordered && !p.via && !p.strung && p.block && r.blocks.find(b => b.letter === p.block && b.extra)).length === 0,
    JSON.stringify(lab));
  check('…the north slope is the plain hip\'s 30 sheets, the same as the south side',
    !!north && north.count === 30 && !!south, JSON.stringify(r.blocks.map(b => b.letter + ':' + b.count + (b.extra ? '(' + b.extra + ')' : ''))));
  check('…74 sheets where it was 75, the four extras for the wing\'s end gone: one extra and one pushed in',
    r.tally.reduce((s, x) => s + x.count, 0) === 74 && r.extras === 1 && r.pushed === 1, tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed);
}
rules('report 70', r);
// "Make sure the same logic carries through on these attached roofs too"
// (the owner, 2026-10-27, feedback reports 71–76). 72 and 73: a wing in
// front of the main's SLOPE, cut from its sheets as report 70's is.
const nOf = r2 => r2.tally.reduce((s, x) => s + x.count, 0);
const mOf = r2 => r2.tally.reduce((s, x) => s + x.count * x.Lmm, 0);
const tmplLay = (r2, g) => { const T = r2.faces.find(f => f.id === g.template); return T ? T.lay : null; };
for (const [n, want] of [[72, 69], [73, 136]]){
  r = await lay(fx('report' + n));
  const gf = gridFaces(r);
  check('report ' + n + ': the wing\'s end is cut from the main\'s slope sheets (whole sheets and feet), ' + want + ' sheets, nothing extra',
    gf.length === 1 && tmplLay(r, gf[0]) === 'run' && labels(r, gf[0]).some(l => l[0] === '✂') && nOf(r) === want && r.extras === 0,
    tallyOf(r) + ' extras ' + r.extras + ' ' + JSON.stringify(gf.map(f => labels(r, f))));
  rules('report ' + n, r);
}
// 74, 75, 76: the wing stands in front of the main's hip END. The plain
// hip's end strip in each column is the wing's piece plus what is left of
// the main's end between the valley and its hip — one sheet, fed from one
// offcut, the foot carried. The main is the block with the longest sheets.
for (const [n, want, was] of [[74, 125, 137], [75, 130, 142], [76, 177, 183]]){
  r = await lay(fx('report' + n));
  const gf = gridFaces(r);
  check('report ' + n + ': the wing\'s end is laid on the main\'s hip-end strips and paired with them (feet carried), ' + want + ' sheets where it was ' + was,
    gf.length === 1 && tmplLay(r, gf[0]) === 'apex' && labels(r, gf[0]).filter(l => l[0] === '✂').length >= 3 && nOf(r) === want,
    tallyOf(r) + ' extras ' + r.extras + ' ' + JSON.stringify(gf.map(f => [tmplLay(r, f), labels(r, f)])));
  rules('report ' + n, r);
  if (n !== 76) continue;
  // "The plain hip logic would mean there should be the same number of
  // purple sheets as there is orange sheets, purple sheet c31 should be a
  // green sheet ... the missing purple sheets should go where green sheets
  // d40 ... d56 are" (the owner on report 76, 2026-10-27).
  const shared = r.faces.slice().sort((a, b) => b.pieces - a.pieces)[0];
  const seq = r.pieces.filter(p => p.face === shared.id && p.ordered).sort((a, b) => a.k - b.k);
  const runs = []; seq.forEach(p => { if (!runs.length || runs[runs.length - 1].b !== p.block) runs.push({ b: p.block, n: 0, first: p }); runs[runs.length - 1].n++; });
  const bl = L => r.blocks.find(b => b.letter === L);
  check('report 76: the main\'s two slopes carry the same number of sheets — 48 orange, 48 purple — the purple ones the wing\'s far hip cuts at the main\'s own length',
    bl('A') && bl('C') && bl('A').count === 48 && bl('C').count === 48 && runs.map(x => x.b).join('') === 'CDC' && runs[2].n >= 17 && bl('C').Lmm === bl('A').Lmm,
    JSON.stringify(runs.map(x => x.b + x.n)) + ' ' + JSON.stringify(r.blocks.map(b => b.letter + ':' + b.count + '@' + b.Lmm)));
  check('…the strip where the main\'s hip runs down onto the wing\'s ridge (82 mm of hip across one corner) is a green sheet, the corner under the hip cap',
    runs[1] && runs[1].b === 'D' && runs[1].first.longMm > bl('D').Lmm && runs[1].first.longMm - bl('D').Lmm <= 100, runs[1] ? runs[1].first.label + ' ' + runs[1].first.longMm + ' vs ' + bl('D').Lmm : '');
}
// Report 50 (hand-counted): the T's bottom slope runs under both wings, so
// the strips its wings' far hips cut are the main's 2.82 sheets (rule 5),
// and their offcuts feed the wings' ends: 38 sheets where it was 41.
r = await lay(fx('report50'));
check('report 50: the bottom slope carries the strips its wings\' far hips cut at the main\'s length — 38 sheets, 3 extras, where it was 41 and 6',
  nOf(r) === 38 && r.extras === 3, tallyOf(r) + ' extras ' + r.extras);
// 71: the wing carries the main's west slope on. The rows its far hip cuts
// are the main's west-slope sheets (8.50, not the wing's 5.00), so their
// offcuts feed the paired end strips as the plain hip's would: 70 sheets
// where the wing's end fed from its own slopes took 74. The roof is still
// laid both ways and the one ordering fewer sheets kept.
r = await lay(fx('report71'));
check('report 71: the wing\'s end paired with the main\'s north end, the rows its far hip cuts at the main\'s 8.50 — 70 sheets where it was 74',
  gridFaces(r).length === 1 && nOf(r) === 70, tallyOf(r) + ' ' + mOf(r));
rules('report 71', r);
// Wings off the top AND the bottom at the same end: both are cut from their
// slope's columns, both runs start at the wings' end, and the west face —
// now the main's hip end between two wing slopes — still anchors at its apex.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[440,140],[440,440],[1040,440],[1040,1140],[440,1140],[440,1440],[140,1440]], autoType: 'hip' });
check('wings off the top and the bottom of the main at the west end: BOTH wing ends are cut from their slope\'s columns, four whole sheets and four feet each',
  gridFaces(r).length === 2 && gridFaces(r).every(f => labels(r, f).map(strip).join(',') === '1,2,3,4,5,6,7,8' && labels(r, f).slice(4).every(l => l[0] === '✂')),
  JSON.stringify(gridFaces(r).map(f => labels(r, f))));
check('…the main\'s west hip end sits between the two wing slopes on the one 26 m face and is still laid from its apex (its two hips stop at the wings\' ridges, half the depth down, which is a hip end and not a bump)',
  (() => { const W = r.faces.find(f => Math.abs(f.tg1 - f.tg0) * r.scaleM > 25); return !!W && W.lay === 'apex'; })(), JSON.stringify(r.faces.map(f => [f.lay, +(Math.abs(f.tg1 - f.tg0) * r.scaleM).toFixed(1)])));
check('…80 sheets — the Big-L\'s 48 × 7.73 with 32 × 3.32 for the four wing slopes, the two junction strips (one per wing) cut straight and fed from the slopes\' own offcuts, nothing extra and nothing pushed',
  tallyOf(r) === '48x7730,32x3320' && r.extras === 0 && r.pushed === 0, tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed);
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
// THE GABLE + HIP & VALLEY T (2026-10-23, the owner: "The offcuts to blue
// B9, B10 and purple C9, C10, they're not being utilized anywhere. They could
// be utilized in D14, D15, E15, E14"). The stem's top strip ends at its ridge
// but clips 33 mm off the little hip where the ridge starts — under the cap,
// so it is ONE cut, and the bar's valley-cut sheet across the stem fits it (a
// sheet is never flipped: B's offcut lands on the EAST stem slope, C's on the
// west). The greedy match had handed C10's offcut to the bar's own last
// strip, which D14's offcut, lying unused, fits just as well: one swap, one
// sheet back on each side.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[1040,140],[1040,400],[740,400],[740,860],[440,860],[440,400],[140,400]], autoType: 'gable-hv' });
{
  const near = mm => r.pieces.filter(p => Math.abs(p.longMm - mm) < 30 && Math.abs(p.widthPx - r.coverPx) < 0.6).map(p => p.label).sort();
  check('the gable + hip & valley T: 72 sheets — 29 × 3.32, 1 × 3.16, 42 × 2.87 — where it was 74', tallyOf(r) === '29x3320,1x3160,42x2870' && r.extras === 2, tallyOf(r) + ' extras ' + r.extras);
  check('…the stem\'s top strips (1.69 m) come off the bar\'s valley-cut sheets across the stem, C10 on the west and B10 on the east, never ordered', JSON.stringify(near(1690)) === '["↺B10","↺C10"]', JSON.stringify(near(1690)));
  check('…and are one cut: the 33 mm the little hip clips off under the ridge cap is not a second', r.pieces.filter(p => Math.abs(p.longMm - 1690) < 30).every(p => !(p.cutTop && p.cutBot)));
  check('…the bar\'s last valley strips (1.08 m) move onto the stem\'s D14 and E14 offcuts, which nothing used', JSON.stringify(near(1080)) === '["↺D14","↺E14"]', JSON.stringify(near(1080)));
  check('…no offcut a metre long is left over', r.unusedMaxMm < 1000, r.unusedList.join(' '));
}
rules('the gable + hip & valley T', r);
// THE GABLE + HIP & VALLEY L (2026-10-23): the three L roofs of feedback
// reports 17, 19 and 20, on the builder that drew them. The pieces round the
// corner that no offcut fits are extras, each a sheet at its own length (the
// owner: "e1 should just be a full sheet with a small amount of wastage" — an
// extra's sheet lengthened so its remainder fed another piece was tried the
// same evening and withdrawn as a cut nobody would make).
for (const [nm, ol, tal, ex, left, was] of [
  ['report 17 (a wide arm over a narrow one)', [[443,131],[443,532],[979,532],[979,235],[779,235],[779,131]], '11x3710,1x3430,22x3280,1x2440,1x1600,1x960', 6, 11, '37 sheets'],
  ['report 19 (the wing wider than the main is deep)', [[443,220],[443,480],[964,480],[964,390],[680,390],[680,220]], '11x2620,1x2250,1x2150,1x1410,1x1300,2x1090,17x1000', 7, 14, '34 sheets'],
  ['report 20 (a narrow arm over a wide one)', [[395,220],[395,756],[1047,756],[1047,390],[680,390],[680,220]], '27x4040,1x3880,1x3370,18x3150', 4, 9, '48 sheets'],
]){
  r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: ol, autoType: 'gable-hv' });
  check('the gable + hip & valley L, ' + nm + ': ' + tal + ', ' + left + ' offcuts left over (this morning ' + was + ')',
    tallyOf(r) === tal && r.extras === ex && r.unused === left, tallyOf(r) + ' extras ' + r.extras + ' unused ' + r.unused);
  rules('the gable + hip & valley L, ' + nm, r);
  if (nm.startsWith('report 20')){
    // The owner on this roof, 2026-10-23: "purple sheets c10,11,12,13, those
    // off cuts should fill the area which has purple offcuts 12, 13 and green
    // offcut E2. Then offcuts to green sheets D10,11,12,13 should fill the
    // area of orange sheet A6, green offcut d12 and orange offcut a6 … they
    // can start in a valley area or hip area from the shortest first and only
    // use half of the longest sheet if necessary" — then "they don't have to
    // go specifically where i said … it should go which ever way is most
    // efficient". The wide arm's valley tail (under A5) takes D13, D12, D11 in
    // turn; the narrow arm's tail below its hip end is laid from the valley's
    // point, C11, C12, C13 from the point out, and only the strip at the barge
    // — part-width — is a sheet's.
    const fA = r.pieces.filter(p => p.longMm > 900 && p.longMm < 3000 && /↺D1[123]/.test(p.label)).map(p => p.label + '@' + Math.round(p.longMm / 10) * 10).sort();
    check('…report 20: the valley tail under A5 is D13, D12 and D11\'s offcuts, not an A sheet',
      JSON.stringify(fA) === JSON.stringify(['↺D11@1010', '↺D12@1850', '↺D13@2690']), JSON.stringify(fA));
    const tail = r.pieces.filter(p => /^↺C1[123]$/.test(p.label)).map(p => p.label + '@' + Math.round(p.longMm / 10) * 10);
    check('…report 20: the tail below the hip end is laid from the valley\'s point — C11, C12, C13 shortest first',
      ['↺C11@840', '↺C12@1680', '↺C13@2520'].every(x => tail.includes(x)), JSON.stringify(tail));
    const half = r.pieces.filter(p => Math.abs(p.longMm - 3140) < 20 && p.widthPx < r.coverPx * 0.8 && p.widthPx > r.coverPx * 0.25);
    check('…report 20: the strip at the barge is the part-width one, a 3.15 m sheet of its own',
      half.length === 1 && !/^↺/.test(half[0].label) && r.pieces.some(p => p === half[0]) && tallyOf(r).includes('18x3150'), half.map(p => p.label + ' w' + (p.widthPx * r.scaleM).toFixed(2)).join(' '));
    check('…report 20: no extra is lengthened to feed another piece — every sheet is 4.04 m or shorter',
      r.tally.every(t => t.Lmm <= 4040), tallyOf(r));
  }
}
// Wings at OPPOSITE ends (a Z): no end to start from, so the runs fall back to
// the world-low corner; the far wing's corner column is then the plain hip's
// lapped corner sheet, a whole sheet whose offcut is a whole sheet's width.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[140,140],[440,140],[440,440],[1040,440],[1040,1440],[740,1440],[740,1140],[140,1140]], autoType: 'hip' });
check('a Z — a wing off the top at the west and off the bottom at the east — cuts both wing ends from the slopes\' columns, the east wing\'s corner column a lapped whole sheet',
  gridFaces(r).length === 2 && gridFaces(r).some(f => labels(r, f).map(strip).join(',') === '1,2,3,4,5,6,7,8') && gridFaces(r).some(f => r.pieces.some(p => p.face === f.id && p.via && p.lapped)),
  JSON.stringify(gridFaces(r).map(f => labels(r, f).map(l => l + (r.pieces.find(p => p.face === f.id && p.label === l) || {}).lapMm))));
check('…81 sheets: the west end\'s junction strip cut straight and fed from D6, a full sheet pushed in at the east end\'s apex (where the east wing takes a hand of the offcuts that end would have had on the plain hip), and the east wing\'s clipped corner stub ordered at its own 1.16 m rather than cut from a 7.73 m sheet',
  r.tally.reduce((s2, t) => s2 + t.count, 0) === 81 && r.extras === 1 && r.pushed === 1 && tallyOf(r).endsWith(',1x1160'), tallyOf(r) + ' extras ' + r.extras + ' pushed ' + r.pushed);
// The owner, 2026-10-22, on this roof: "the green offcuts D18, D17, D16, they
// should actually be the offcuts to the red sheets F5, F6, F7, and F8".
{
  const wingS = r.faces.find(f => f.lay === 'run' && f.T0 < -1400 && Math.abs(f.tg1 - f.tg0) * r.scaleM < 6.1);
  const wl = wingS ? r.pieces.filter(p => p.face === wingS.id).sort((a, b) => a.k - b.k) : [];
  const own = wl.filter(p => p.ordered && p.cutTop && !p.cutBot).map(p => p.label);
  check('…the east wing\'s slope: its four valley pieces are the offcuts of its own four hip-cut sheets, strip for strip (the 3.0 m valley piece from the 1.05 m hip sheet\'s offcut, the stub from the 3.31 m sheet\'s)',
    !!wingS && own.length === 4 && wl.filter(p => !p.ordered && !p.scrap && p.cutBot).map(p => p.from).join(',') === own.join(','),
    JSON.stringify(wl.map(p => p.label)));
}
// And, 2026-10-22, on the same roof: "on the Z shape the green D20 is out of
// place" — the east wing's own sheet, cut by the wing's hip and so at home on
// the end face, sorted in by size between C21 and C20. A series is one run of
// sheets: C21 then C20 then C19, and D20 waits for the strip the C run cannot
// fill, under the wing's own sheets.
{
  const east = r.faces.find(f => f.lay === 'apex' && r.pieces.some(p => p.face === f.id && p.ordered && /^E\d/.test(p.label)));
  const lab = east ? seq(east).map(p => p.label) : [];
  const south = lab.filter(l => /^↺[CD]\d/.test(l)).slice(lab.filter(l => /^↺[CD]\d/.test(l)).indexOf('↺C24'));
  check('…the east end\'s south half is the C run unbroken — C24 down to C19 on the junction strip — then the wing\'s seven sheets, then D20 (the wing\'s own sheet\'s offcut) on the strip under them and C18 to C16 below it',
    !!east && lab.indexOf('↺C24', 1) > 0 && lab.slice(lab.indexOf('↺C24', 1), lab.indexOf('↺C24', 1) + 6).join(',') === '↺C24,↺C23,↺C22,↺C21,↺C20,↺C19' && lab.indexOf('E1') === lab.indexOf('↺C19') + 1 && lab.slice(lab.indexOf('E7') + 1, lab.indexOf('E7') + 5).join(',') === '↺D20,↺C18,↺C17,↺C16',
    JSON.stringify(lab));
}
rules('the Z', r);

// ── The dutch gable: a hip end with its apex cut off (2026-10-22, the
// owner: "do the dutch gable now, aswell as a dutch gable T & L shape") ──
const seqOf = (r, f) => r.pieces.filter(p => p.face === f.id).sort((p, q) => p.k - q.k);
r = await lay(JSON.parse(JSON.stringify({ scaleMetresPerPx: 0.02, calPitch: 25, outline: RECT(900, 600), autoType: 'dutch' })));
check('a dutch gable is four faces, the long ones ending at the gablet\'s apron',
  r.faces.length === 4 && r.faces.filter(f => f.pieces === 24).every(f => f.edges.some(e => e.kind === 'apron')), r.faces.map(f => f.pieces + ':' + f.edges.map(e => e.kind[0]).join('')).join(' '));
rules('the dutch', r);
{
  const ends = r.faces.filter(f => f.pieces === 16), slopes = r.faces.filter(f => f.pieces === 24);
  check('…each gablet end is laid from its two corners in (a full sheet at each corner, the narrow strip against the wall) and knows it is a gablet; each slope beside one is laid from the walls',
    ends.length === 2 && ends.every(f => f.lay === 'apex' && f.gablet && f.endFace) && slopes.every(f => f.lay === 'run' && !f.gablet && f.walls === 2),
    r.faces.map(f => f.id + ':' + f.lay + (f.gablet ? '/gablet' : '')).join(' '));
  const west = ends.find(f => f.c[0] < 500), east = ends.find(f => f.c[0] > 500);
  const lw = seqOf(r, west).map(p => p.label), le = seqOf(r, east).map(p => p.label);
  // The owner, putting the first try right: "the number of those short
  // sheets (blue and purple looking at the plain rectangle) should be full
  // sheets the whole length of that gutter line, then the offcuts cut at
  // the hips should be used in the orange and green areas on the other
  // side of the hip". Every strip across a gablet's gutter is one of its
  // own short sheets; the slopes' corner strips take what they leave above
  // their hips. A sheet is never flipped, so a gablet strip cut at one hip
  // fits the slope corner at the gablet's OTHER hip — across the end, the
  // plain hip's own pairing — and stays at its own end of the house.
  check('…each gablet end is ordered whole: B1–B16 on the west and C1–C16 on the east, all sixteen across its gutter, none fed',
    lw.join(',') === Array.from({length:16}, (_, i) => 'B' + (i + 1)).join(',') && le.join(',') === Array.from({length:16}, (_, i) => 'C' + (i + 1)).join(',') && seqOf(r, west).concat(seqOf(r, east)).every(p => p.ordered), lw.join(',') + ' | ' + le.join(','));
  const north = slopes.slice().sort((f, g) => f.c[1] - g.c[1])[0], south = slopes.slice().sort((f, g) => g.c[1] - f.c[1])[0];
  const ln = seqOf(r, north).map(p => p.label), ls = seqOf(r, south).map(p => p.label);
  // The owner, on the first of these: "all offcuts of the short sheets
  // aren't being used so it's not as efficient as it can be". The gablet
  // is laid from its corners and the slope from the gablet's wall, so the
  // two grids are each other's complement across the hip: the k-th gablet
  // sheet's offcut is the slope's k-th piece from the wall, the narrow
  // strip at the corner included, and the sheet beside the wall no longer
  // straddles it (a 6.62 m sheet for a 3.3 m piece, two of them a roof).
  check('…the north slope\'s corners are all four of their gablet\'s offcuts, at its own end: ↺B4–↺B1 at the west, ↺C16–↺C13 at the east, and sixteen 6.62 m sheets between the walls',
    ln.slice(0, 4).join(',') === '↺B4,↺B3,↺B2,↺B1' && ln.slice(-4).join(',') === '↺C16,↺C15,↺C14,↺C13' && ln.slice(4, -4).join(',') === Array.from({length:16}, (_, i) => 'A' + (i + 1)).join(','), ln.join(','));
  check('…and the south slope\'s the same way round: ↺C4–↺C1 at the east, ↺B16–↺B13 at the west',
    ls.slice(0, 4).join(',') === '↺C4,↺C3,↺C2,↺C1' && ls.slice(-4).join(',') === '↺B16,↺B15,↺B14,↺B13', ls.join(','));
  check('…every fed corner piece is the hand of the offcut it came from, and no offcut crosses to the far end of the house',
    seqOf(r, north).concat(seqOf(r, south)).filter(p => !p.ordered).every(p => p.fromHand === p.hand && ((p.c[0] < 590) === /^↺B/.test(p.label))), ln.join(',') + ' | ' + ls.join(','));
  check('…64 sheets: 32 × 6.63 m + 32 × 3.32 m (the two gablets, sixteen each), nothing extra, nothing pushed, NOT ONE OFFCUT LEFT OVER — 20 m less steel than the 68 laid from the house corner',
    r.tally.map(x => x.count + 'x' + x.Lmm).join(',') === '32x6630,32x3320' && r.extras === 0 && r.pushed === 0 && r.unused === 0, JSON.stringify(r.tally) + ' extras ' + r.extras + ' pushed ' + r.pushed + ' unused ' + r.unused);
}
// The dutch L: the Big-L's outline with gablets on its two FREE ends (the
// wing's north end and the main's east end); the main's west end, whose
// north hip the wing's ridge dies into, stays a hip end.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: L(300, 300, 900, 700), autoType: 'dutch' });
rules('the dutch L', r);
{
  const gab = r.faces.filter(f => f.gablet).sort((f, g) => f.c[0] - g.c[0]), wingEnd = gab[0], eastEnd = gab[gab.length - 1];
  const west = r.faces.find(f => f.lay === 'apex' && !f.gablet), north = r.faces.filter(f => f.lay === 'run').sort((f, g) => f.c[1] - g.c[1]).find(f => f.pieces > 12);
  check('…two gablets (the wing\'s north end and the main\'s east end); the main\'s west end is still a hip end on the plane of the wing\'s west slope (the wing\'s ridge and apron on its boundary)',
    gab.length === 2 && !!wingEnd && !!eastEnd && !!west && west.edges.some(e => e.kind === 'ridge') && west.edges.some(e => e.kind === 'apron') && west.edges.filter(e => e.kind === 'hip').length === 3, r.faces.map(f => f.id + ':' + f.lay + (f.gablet ? '/gablet' : '')).join(' '));
  check('…the wing\'s gablet is the cookie cutter on the north slope\'s columns: its strips under the apron are the slope\'s own 7.73 m sheets slid up whole (C1–C6), its hip-cut strips the feet of C7 and C8',
    wingEnd.lay === 'grid' && wingEnd.template === north.id && seqOf(r, wingEnd).map(p => p.label + (p.via ? '^' : '') + (p.strung ? '~' : '')).join(',') === 'C1^,C2^,C3^,C4^,C5^,C6^,✂C7~,✂C8~',
    seqOf(r, wingEnd).map(p => p.label + (p.via ? '^' : '') + (p.strung ? '~' : '')).join(','));
  const lw = seqOf(r, west).map(p => p.label);
  check('…and the 6 m left over each slid-up sheet (a RECTANGLE, no hand) still feeds the west hip end\'s valley side — ↺C9–↺C7, then ↺C5–↺C1 — with one 7.73 m sheet pushed in at the apex now the east gablet\'s offcuts stay at the east',
    lw.slice(1, 10).join(',') === '↺C9,↺C8,↺C7,↺C5,↺C4,↺C3,↺C2,↺C1,F1' && lw.slice(10, 16).join(',') === '↺E19,↺E18,↺E17,↺E16,↺E15,↺E14', lw.join(','));
  const le = seqOf(r, eastEnd).map(p => p.label);
  const n6 = r.faces.filter(f => f.lay === 'run').sort((f, g) => g.c[1] - f.c[1])[0], ls6 = seqOf(r, n6).map(p => p.label);
  check('…the east gablet is ordered whole, D1–D20 (3.87 m), and its hip offcuts are the main slopes\' east corners: ↺D5–↺D1 on the south slope (laid from the gablet\'s wall), ↺D20–↺D17 on the north',
    le.join(',') === Array.from({length:20}, (_, i) => 'D' + (i + 1)).join(',') && ls6.slice(0, 5).join(',') === '↺D5,↺D4,↺D3,↺D2,↺D1' && seqOf(r, north).map(p => p.label).slice(-4).join(',') === '↺D20,↺D19,↺D18,↺D17', le.join(',') + ' | ' + ls6.join(','));
  check('…81 sheets: 40 × 7.73 m, 20 × 3.87 m for the east gablet, 20 × 3.32 m, one 1.79 m valley stub — the south slope\'s sheet beside the gablet\'s wall no longer straddles it',
    r.tally.map(x => x.count + 'x' + x.Lmm).join(',') === '40x7730,20x3870,20x3320,1x1790' && r.extras === 1 && r.pushed === 3, JSON.stringify(r.tally) + ' extras ' + r.extras + ' pushed ' + r.pushed);
}
// The dutch T: gablets on all three free ends. The bar is within a sheet of
// the stem MEASURED TO WHERE ITS HIPS WOULD MEET, so its ends keep their
// centre line (the hip T's own rule) and are never sliced from the stem.
r = await lay({ scaleMetresPerPx: 0.02, calPitch: 25, outline: [[ox,oy],[ox+900,oy],[ox+900,oy+260],[ox+600,oy+260],[ox+600,oy+720],[ox+300,oy+720],[ox+300,oy+260],[ox,oy+260]], autoType: 'dutch' });
rules('the dutch T', r);
{
  const gab = r.faces.filter(f => f.gablet);
  check('…three gablets, every one laid from its corners and none cut from the stem\'s columns',
    gab.length === 3 && gab.every(f => f.lay === 'apex' && f.template === null), r.faces.map(f => f.id + ':' + f.lay + (f.gablet ? '/gablet' : '') + (f.template ? '@' + f.template : '')).join(' '));
  const eastEnd = gab.slice().sort((f, g) => g.c[0] - f.c[0])[0], le = seqOf(r, eastEnd).map(p => p.label);
  check('…the bar\'s east end is ordered whole, C1–C8 at 1.44 m, none fed',
    le.join(',') === 'C1,C2,C3,C4,C5,C6,C7,C8' && seqOf(r, eastEnd).every(p => p.ordered), le.join(','));
  const bar = r.faces.filter(f => f.lay === 'run').sort((f, g) => f.c[1] - g.c[1])[0], lb = seqOf(r, bar).map(p => p.label);
  check('…the bar\'s north slope takes each gablet\'s offcuts at its own end — ↺B2, ↺B1 at the west, ↺C8, ↺C7 at the east — never the far gablet\'s',
    lb.slice(0, 2).join(',') === '↺B2,↺B1' && lb.slice(-2).join(',') === '↺C8,↺C7', lb.join(','));
  const gabLetters = new Set(r.blocks.filter(b => r.faces.find(f => f.id === b.face).gablet).map(b => b.letter));
  check('…no gablet\'s short sheet leaves an offcut unused (what is left over comes off the stem\'s valley sheets and the junction strips)',
    r.unusedList.every(u => !gabLetters.has(u.replace(/\d.*$/, ''))), r.unusedList.join(' '));
  check('…87 sheets: the three gablets 16 × 1.44 m and 8 × 1.66 m whole, the only extras the two junction strips — 9.5 m less steel than the 90 laid from the corners',
    r.tally.map(x => x.count + 'x' + x.Lmm).join(',') === '27x3320,1x3230,35x2870,8x1660,16x1440' && r.extras === 2 && r.pushed === 0, JSON.stringify(r.tally) + ' extras ' + r.extras + ' pushed ' + r.pushed);
}

// ── The owner's hand-counted hip-and-valley shapes ────────────────
for (const [name, g] of [['double L', fx('doublel')], ['report 50', fx('report50')], ['tee', fx('tee')], ['report 58', fx('report58')]]){
  r = await lay(g);
  check(name + ' lays out: ' + r.faces.length + ' faces, ' + r.pieces.length + ' pieces', r.faces.length >= 2 && r.pieces.length > 10);
  check('…every face has a reference line and every piece a length', r.faces.every(f => f.refLen > 0) && r.pieces.every(p => p.longMm > 0 && p.areaPx > 0.5));
  check('…no piece runs past a roof line', r.straddles === 0, r.straddles + ' straddle');
  check('…and the pieces cover the roof once (cover ' + r.cover.toFixed(3) + ', doubled ' + r.overlap.toFixed(3) + ')',
    r.cover >= 0.99 && r.overlap <= 0.005 && Math.abs(r.pieceArea - r.roofArea) / r.roofArea < 0.01);
  check('…filled: every piece a block sheet or a named offcut of the same hand, the tally adding up (' + r.tally.map(x => x.count + ' × ' + (x.Lmm/1000).toFixed(2)).join(', ') + ')',
    r.pieces.every(p => p.block && p.label) && r.pieces.filter(p => !p.ordered && !p.strung && !p.scrap && p.hand).every(p => { const d = r.pieces.find(q => q.ordered && q.label === p.from); return d && (p.fromHand !== null ? p.fromHand === p.hand : d.hand === p.hand); }) &&
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
