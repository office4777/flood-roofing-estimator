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
      endFace:!!f.endFace, c:f.c, edges:f.edges.map(e => ({ kind:e.kind, len:e.len, a:e.a, b:e.b })), areaPx:f.areaPx }));
    const pieces = pz.pieces.map(p => ({ face:p.face.id, k:p.k, widthPx:p.widthPx, longPx:p.longPx, shortPx:p.shortPx, tip:p.tip,
      longMm:p.longMm, shortMm:p.shortMm, widthMm:p.widthMm, areaPx:p.areaPx, poly:p.poly, c:_ccCentroid(p.poly),
      full:p.full, cutTop:p.cutTop, cutBot:p.cutBot, hand:p.hand, label:p.label, from:p.from || null, ordered:!!p.ordered, lapMm:p.lapMm, lapped:!!p.lapped, scrap:!!p.scrap, fromHand:(p.fromHand === undefined ? null : p.fromHand),
      block:p.block ? p.block.letter : null }));
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
        let pos = 0, neg = 0;
        p.poly.forEach(q => {
          const u = ((q[0]-a[0])*dx + (q[1]-a[1])*dy) / (L*L);
          if (u < 0.01 || u > 0.99) return;   // strictly within the line: a vertex at the line's END belongs to the next line
          const s = ((q[0]-a[0])*dy - (q[1]-a[1])*dx) / L;
          if (s > 0.8) pos++; else if (s < -0.8) neg++;
        });
        if (pos && neg) straddles++;
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
  check('…every strip is one cover wide (the closer may be narrower: at the far end, in the middle of a face laid from both corners, at both corners of a hip end laid from its apex)',
    r.faces.every(f => { const ps = r.pieces.filter(p => p.face === f.id); const full = ps.filter(p => Math.abs(p.widthPx - r.coverPx) < 0.05).length; return full >= ps.length - (f.lay === 'apex' ? 2 : 1); }));
  // The fill's own rules, on every shape.
  check('…every piece is a numbered sheet of a block or cut from a named sheet\'s offcut',
    r.pieces.every(p => p.block && p.label && (p.ordered ? /^[A-Z]+\d+$/.test(p.label) : (p.from && r.pieces.some(q => q.ordered && q.label === p.from)))));
  check('…an offcut is spun, never flipped: every fed piece has the hand of the sheet it came from',
    r.pieces.filter(p => !p.ordered && !p.scrap && p.hand).every(p => p.fromHand === p.hand && !!r.pieces.find(q => q.ordered && q.label === p.from)));
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
check('…112 pieces: 28 off the 20 m west gutter, 24 and 20 off the main\'s, 20 off the east (laid from its apex), 8 and 12 off the wing\'s',
  r.pieces.length === 112 && r.faces.map(f => f.pieces).sort((a, b) => b - a).join(',') === '28,24,20,20,12,8',
  r.pieces.length + ': ' + r.faces.map(f => f.pieces).join(','));
// THE RECTANGLE IS THE TEMPLATE (the owner, 2026-10-22: "imagine the L-shape and a
// rectangle ... run the exact same logic as the plain hip ... like a cookie cutter").
check('…the main\'s north slope is laid along the whole 18 m side of its rectangle (the gutter followed under the wing), not the 12 m the wall shows, from its one real corner — the east',
  (() => { const f = r.faces.find(x => x.pieces === 20 && x.lay === 'run'); if (!f) return false; const span = Math.abs(f.T1 - f.T0) * r.scaleM; const real = Math.abs(f.tg1 - f.tg0) * r.scaleM;
    const ps = r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k); return Math.abs(span - 18) < 0.05 && Math.abs(real - 12) < 0.05 && ps[0].c[0] > ps[ps.length - 1].c[0]; })(),
  JSON.stringify(r.faces.filter(x => x.lay === 'run').map(f => [f.pieces, +(Math.abs(f.T1 - f.T0) * r.scaleM).toFixed(2), f.runFromT0])));
check('…the west face (the wing\'s slope and the main\'s hip end on one plane) is anchored at the main\'s apex like the plain hip\'s end, so the south slope\'s corner offcuts drop into the same places: its five strips above the apex are all cut from the south slope\'s west-corner sheets',
  (() => { const f = r.faces.find(x => x.pieces === 28); if (!f || f.lay !== 'apex') return false; const ps = r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k);
    const south = r.blocks.find(b => b.count === 24 && b.Lmm === 7730); const fed = ps.filter(p => !p.ordered && !p.scrap && p.from && p.from[0] === south.letter);
    const ks = fed.map(p => p.k).sort((x, y) => x - y); const consecutive = ks.every((k, i) => i === 0 || k === ks[i - 1] + 1);
    const apex = ps.find(p => p.longMm >= 7700 && !p.ordered); return consecutive && apex && fed.indexOf(apex) >= 0 && fed.map(p => p.longMm).sort((x, y) => x - y).join(',') === '4361,5201,6042,6883,7724'; })(),
  (() => { const f = r.faces.find(x => x.pieces === 28); return f ? f.lay + ' ' + JSON.stringify(r.pieces.filter(p => p.face === f.id).sort((a, b) => a.k - b.k).map(p => p.label + ':' + p.longMm)) : 'no 28-piece face'; })());
check('…the main\'s east hip end is fed exactly as on the plain hip — all 20 from the north and south slopes\' east-corner offcuts — and the wing\'s hip end all 8',
  r.faces.filter(f => f.lay === 'apex' && (f.pieces === 20 || f.pieces === 8)).every(f => r.pieces.filter(p => p.face === f.id).every(p => !p.ordered)), r.fed + ' fed');
check('…what the wing ate — the north slope\'s west-corner sheets whose offcuts would have fed the west end\'s lower half — is ordered, each at its own length, and nothing else is',
  r.extras === 6 && r.blocks.filter(b => b.extra).length === 1 && r.tally.filter(t => t.count === 1).map(t => t.Lmm).join(',') === '6890,6050,5210,4370,3520',
  r.extras + ' extra, ' + JSON.stringify(r.tally));
check('…a north-slope sheet cut by the valley at its foot AND the hip at its head gives TWO offcuts, and the one above the hip feeds the west end just as it would on the plain hip',
  r.pieces.some(p => p.cutTop && p.cutBot && p.ordered && r.pieces.some(q => q.from === p.label && !q.scrap && q.face === r.faces.find(x => x.pieces === 28).id)),
  JSON.stringify(r.pieces.filter(p => p.cutTop && p.cutBot && p.ordered).map(p => [p.label, r.pieces.filter(q => q.from === p.label).map(q => q.label)])));
rules('the Big-L', r);
check('…FILLED the way Auto-Block 2 blocks a ridge side: the wing\'s two slopes at 3.3 m, the main\'s two at 7.73 m, and the main\'s west hip end — the part of the shared west face longer than the wing\'s sheets — fed from offcuts or ordered on its own',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).length === 2 && r.blocks.filter(b => !b.extra && b.Lmm < 3400).length === 2,
  JSON.stringify(r.blocks));
check('…and the blocks: the wing\'s two slopes at 3.32 m, the main\'s two at 7.73 m (20 and 24 sheets), the west face\'s 16 wing sheets at 3.32',
  r.blocks.filter(b => !b.extra).length === 4 && r.blocks.filter(b => !b.extra && b.Lmm === 7730).map(b => b.count).sort().join(',') === '20,24' && r.blocks.filter(b => !b.extra && b.Lmm === 3320).map(b => b.count).sort().join(',') === '12,16',
  JSON.stringify(r.blocks));

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
    r.pieces.every(p => p.block && p.label) && r.pieces.filter(p => !p.ordered && p.hand).every(p => { const d = r.pieces.find(q => q.ordered && q.label === p.from); return d && d.hand === p.hand; }) &&
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
