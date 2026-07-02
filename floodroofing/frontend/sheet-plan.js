// ── Flood Roofing — sheet-plan renderer + click-to-delete ──────────
// Extracted from index.html (was the final inline <script> block) so the
// sheet engine lives in its own file: smaller merge surface, and two
// parallel work-streams can touch UI vs engine without colliding.
// Plain global-scope script (NOT a module) — every function stays global,
// exactly as when it was inline. Loaded LAST (same position as the block
// it replaced), so every global it references (DRAW, esc2, COL_*, the
// geometry builders, polyCentroid, _sheetKey, renderMaterialsCutLists, …)
// is already defined by the time any of these functions is CALLED.

// Multi-roof dispatcher: when several roofs are drawn, iterate each and
// ── Customisable sheet plan — Phase 1: click-to-delete sheets ──────
// A stable per-sheet ID (centroid + ordered length + colour) survives
// re-renders because the strip layout is deterministic for a given
// outline+lines geometry.  Deleting a sheet stores its ID in
// DRAW.sheetPlanDeletedIds; the renderer then skips its fill + label +
// order count but keeps a dashed grey outline ("always show the sheet
// lines").  Deleting a donor cascades to its paired offcut.
function _sheetStripId(s){
  var c = s.centroid || (s.poly && s.poly[0]) || [0, 0];
  return Math.round(c[0]) + '_' + Math.round(c[1]) + '_' +
    (s.orderedLengthMm || 0) + '_' + (s.color || '').replace('#','');
}
// Toggle Edit mode on the sheet plan card.
function toggleSheetPlanEdit(){
  window._sheetPlanEditMode = !window._sheetPlanEditMode;
  var btn = document.getElementById('sheetPlanEditBtn');
  var restore = document.getElementById('sheetPlanRestoreBtn');
  var hint = document.getElementById('sheetPlanEditHint');
  if (window._sheetPlanEditMode) {
    if (btn) { btn.style.background = '#fef3c7'; btn.style.borderColor = '#fbbf24'; btn.textContent = '✓ Done editing'; }
    if (restore) restore.style.display = '';
    if (hint) hint.style.display = 'block';
  } else {
    if (btn) { btn.style.background = '#fff'; btn.style.borderColor = '#cbd5e1'; btn.textContent = '🔧 Edit sheets'; }
    if (restore) restore.style.display = 'none';
    if (hint) hint.style.display = 'none';
  }
  var canvas = document.querySelector('#roofSheetPlanOut canvas');
  if (canvas) canvas.style.cursor = window._sheetPlanEditMode ? 'crosshair' : 'default';
}
// Restore every user-deleted strip.
function restoreAllSheets(){
  if (!DRAW.sheetPlanDeletedIds || !DRAW.sheetPlanDeletedIds.length) return;
  saveSnapshot();
  DRAW.sheetPlanDeletedIds = [];
  try { renderRoofSheetPlan(); } catch(e){}
  try { renderMaterialsCutLists(); } catch(e){}
  try { renderMatRoofMap(); } catch(e){}
}
// Ray-cast point-in-polygon on canvas-space coordinates.
function _spPointInPoly(x, y, poly){
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1];
    var xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-10) + xi)) inside = !inside;
  }
  return inside;
}
// Click handler mounted on the sheet plan canvas.  In Edit mode a
// click toggles the hit strip's ID in DRAW.sheetPlanDeletedIds and
// re-renders everything downstream so the cut list + roof map update
// in step with the removal.
function _onSheetPlanCanvasClick(ev){
  if (!window._sheetPlanEditMode) return;
  var canvas = ev.currentTarget;
  var strips = canvas._sheetPlanStrips;
  var t = canvas._sheetPlanTransform;
  if (!strips || !t) return;
  var rect = canvas.getBoundingClientRect();
  var cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
  var cy = (ev.clientY - rect.top)  * (canvas.height / rect.height);
  function toC(p){ return [(p[0]-t.minX)*t.sc + t.padX, (p[1]-t.minY)*t.sc + t.padY]; }
  var hit = null;
  for (var i = 0; i < strips.length; i++) {
    var s = strips[i];
    if (!s.poly || s.poly.length < 3) continue;
    var cpoly = s.poly.map(toC);
    if (_spPointInPoly(cx, cy, cpoly)) { hit = s; break; }
  }
  if (!hit) return;
  if (!Array.isArray(DRAW.sheetPlanDeletedIds)) DRAW.sheetPlanDeletedIds = [];
  var id = hit._id || _sheetStripId(hit);
  var idx = DRAW.sheetPlanDeletedIds.indexOf(id);
  saveSnapshot();
  if (idx >= 0) DRAW.sheetPlanDeletedIds.splice(idx, 1);
  else          DRAW.sheetPlanDeletedIds.push(id);
  try { renderRoofSheetPlan(); } catch(e){}
  try { renderMaterialsCutLists(); } catch(e){}
  try { renderMatRoofMap(); } catch(e){}
}

// render its sheet plan into a labelled section.  Single-roof or
// pre-multi-roof code paths go straight to the inner renderer.
function renderRoofSheetPlan() {
  if (DRAW.roofs && DRAW.roofs.length > 1) {
    var outEl = document.getElementById('roofSheetPlanOut');
    if (!outEl) return;
    var savedActive = DRAW.activeRoofIdx;
    _syncCurrentToRoof();
    outEl.innerHTML = '';
    var combined = {orangeLong:0, blueLong:0, purpleLong:0, shortCount:0, shortLen:0, longLen:0, groups:[]};
    // Combined groups map keyed by colour+orderedMm so identical
    // (colour, length) entries from different roofs collapse cleanly.
    var combinedGroups = {};
    DRAW.roofs.forEach(function(r, idx){
      _loadRoofToCurrent(idx);
      if (!r.outline || r.outline.length < 3) return;
      var hdr = document.createElement('h2');
      hdr.textContent = _nthName(idx + 1);
      hdr.style.cssText = 'margin:20px 0 8px;color:#0a1628;background:linear-gradient(135deg,#f0f8ff,#e8f4fd);padding:12px 16px;border-radius:8px;font-size:17px;text-align:center;border:1px solid #b3d4f0';
      outEl.appendChild(hdr);
      var sec = document.createElement('div');
      sec.id = '__rrspSect_' + idx;
      outEl.appendChild(sec);
      window.__rrspTargetEl = sec;
      try { _renderRoofSheetPlanInner(); } finally { window.__rrspTargetEl = null; }
      // Accumulate counts for combined order quantities.
      var c = window._lastSheetCounts;
      if (c) {
        combined.orangeLong += c.orangeLong || 0;
        combined.blueLong   += c.blueLong   || 0;
        combined.purpleLong += c.purpleLong || 0;
        combined.shortCount += c.shortCount || 0;
        combined.shortLen    = c.shortLen   || combined.shortLen;
        combined.longLen     = c.longLen    || combined.longLen;
        // Merge per-(colour, length) groups so the Materials cut list
        // can report ACTUAL ordered lengths (e.g. 36 × 4.40m + 10 ×
        // 5.20m) instead of collapsing everything onto the legacy
        // longLen default and showing 46 × 7.65m.
        (c.groups || []).forEach(function(g){
          var key = (g.color || '') + '|' + g.orderedMm;
          if (!combinedGroups[key]) combinedGroups[key] = { color: g.color, orderedMm: g.orderedMm, count: 0 };
          combinedGroups[key].count += g.count || 0;
        });
      }
    });
    combined.groups = Object.keys(combinedGroups).map(function(k){ return combinedGroups[k]; });
    window._lastSheetCounts = combined;
    _loadRoofToCurrent(savedActive);
    return;
  }
  _renderRoofSheetPlanInner();
}

function _renderRoofSheetPlanInner() {
  // Clean SOP-aligned sheet layout. Reads the building outline and the
  // auto-generated hip / valley / ridge / gutter lines, identifies each
  // roof FACE (a polygon bounded by one gutter on the bottom edge and
  // adjacent hips / ridge / barges around the top), lays virtual
  // sheet strips perpendicular to that face's gutter, then groups the
  // resulting sheets into colour families per the Flood Roofing SOP:
  //
  //   Orange (COL_ORANGE)  — long full sheets on the main rectangle's
  //                          long-side face(s)
  //   Blue   (COL_BLUE)    — opposite long-side face; pieces here come
  //                          from offcuts of the orange sheets
  //   Purple (COL_PURPLE)  — short repeated runs (a wing of an L-shape,
  //                          or any face whose sheet length is much
  //                          shorter than the main run)
  //
  // Hip-end faces (triangular) reuse the SAME colour as the long-side
  // face they touch — A1 ↔ A2 / B1 ↔ B2 pairing from the SOP.
  //
  // Numbers run sequentially within each colour group so the installer
  // has a clear cut/install order.
  // Multi-roof mode passes the target via window.__rrspTargetEl so
  // each roof's plan renders into its own section.  Default to the
  // top-level container otherwise.
  var outEl = window.__rrspTargetEl || document.getElementById('roofSheetPlanOut');
  if (!outEl) return;
  if (!DRAW.outline || DRAW.outline.length < 3) {
    outEl.innerHTML = '<p style="color:var(--text2)">Draw your building outline first.</p>';
    return;
  }
  if (!DRAW.lines.some(function(l){return l.type==='gutter';})) {
    try { autoPopulateGutters && autoPopulateGutters(); } catch(e){}
  }
  if (!DRAW.lines.some(function(l){return l.type==='hip'||l.type==='ridge'||l.type==='barge';})) {
    outEl.innerHTML = '<p style="color:var(--text2)">Add hip / ridge lines (or use Auto-generate → Hip & Valley), then Refresh.</p>';
    return;
  }

  // ── Constants + parameters ─────────────────────────────────────
  var COL_ORANGE = '#f97316';
  var COL_BLUE   = '#2563eb';
  var COL_PURPLE = '#a855f7';
  var COL_GREEN  = '#16a34a';

  var effectiveScale = DRAW.scaleMetresPerPx > 0 ? DRAW.scaleMetresPerPx : 0.02;
  var pitchDeg = DRAW.calPitch || parseFloat((document.getElementById('pitchDeg')||{}).value) || 0;
  var sheetCoverMm = parseFloat((document.getElementById('sheetWidth')||{}).value || 762) || 762;
  var overlapMm    = parseFloat((document.getElementById('overlapMm')||{}).value || 150) || 150;
  var coverM       = sheetCoverMm / 1000;
  var coverPx      = coverM / effectiveScale;
  var pitchFactor  = (pitchDeg > 0 && pitchDeg < 80) ? (1 / Math.cos(pitchDeg * Math.PI / 180)) : 1;

  // Ordered sheet length brackets — SOP says we round up to common
  // ordering increments. NZ corrugate is commonly 7650 (long) and
  // 3900 (short). The "long" group is whatever a face actually needs
  // rounded up to one of these; the "short" group is anything below
  // SHORT_MM / LONG_MM are kept only as semantic thresholds for the
  // legacy Order-Material cut-list sync + the _lastSheetCounts legacy
  // fields (orangeLong / blueLong / shortCount). The legend + Materials
  // cut-list source the real ordered lengths from the groups array so
  // a 3.98m sheet is ordered as 4100mm, not bucketed up to 7650mm.
  var SHORT_MM = 3900;
  var LONG_MM  = 7650;
  function orderedLengthMm(sheetMetres) {
    var mm = Math.ceil(sheetMetres * 1000 + 50);  // +50mm trim
    // Round up to the nearest 100mm — roofing iron is cut-to-order
    // at the supplier so there's no benefit to forcing every sheet
    // into a SHORT (3900mm) or LONG (7650mm) standard length. Min
    // 1000mm to leave enough material for endlap.
    return Math.max(1000, Math.ceil(mm / 100) * 100);
  }

  // ── Geometry helpers ───────────────────────────────────────────
  var EPS = 4;
  function ptDist(a, b){ var dx=b[0]-a[0], dy=b[1]-a[1]; return Math.sqrt(dx*dx+dy*dy); }
  function ptEq(a, b){ return ptDist(a, b) < EPS; }
  function vlen(v){ return Math.sqrt(v[0]*v[0] + v[1]*v[1]); }
  function polyArea(pts){
    var a = 0;
    for (var i = 0; i < pts.length; i++){
      var p = pts[i], q = pts[(i+1) % pts.length];
      a += p[0]*q[1] - q[0]*p[1];
    }
    return Math.abs(a) / 2;
  }
  function polyCentroid(pts){
    var cx = 0, cy = 0;
    pts.forEach(function(p){ cx += p[0]; cy += p[1]; });
    return [cx / pts.length, cy / pts.length];
  }
  function ptOnSegment(p, a, b){
    var dx = b[0]-a[0], dy = b[1]-a[1];
    var L2 = dx*dx + dy*dy;
    if (L2 < 1) return ptDist(p, a) < EPS;
    var t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L2;
    if (t < -0.05 || t > 1.05) return false;
    var perp = Math.abs((p[0]-a[0])*(-dy) + (p[1]-a[1])*dx) / Math.sqrt(L2);
    return perp < EPS;
  }
  // Sutherland-Hodgman half-plane clip — clips a polygon against the
  // half-plane to the LEFT of the directed edge eA→eB.
  function clipHalf(pts, eA, eB){
    if (!pts || pts.length < 3) return [];
    var edx = eB[0]-eA[0], edy = eB[1]-eA[1];
    function ins(p){ return (p[0]-eA[0])*(-edy) + (p[1]-eA[1])*edx >= -0.001; }
    function isc(a, b){
      var dx = b[0]-a[0], dy = b[1]-a[1];
      var dn = dx*(-edy) + dy*edx;
      if (Math.abs(dn) < 1e-9) return null;
      var t = ((eA[0]-a[0])*(-edy) + (eA[1]-a[1])*edx) / dn;
      return [a[0]+t*dx, a[1]+t*dy];
    }
    var out = [];
    for (var i = 0; i < pts.length; i++){
      var c = pts[i], p = pts[(i-1+pts.length) % pts.length];
      var ci = ins(c), pi = ins(p);
      if (ci) {
        if (!pi) { var ip = isc(p, c); if (ip) out.push(ip); }
        out.push(c);
      } else if (pi) {
        var ip2 = isc(p, c); if (ip2) out.push(ip2);
      }
    }
    return out;
  }
  // Clip rect against a convex polygon by walking each polygon edge.
  function _isConvexPoly(poly){
    if (!poly || poly.length < 4) return true;  // tri / degenerate → convex
    var n = poly.length, sign = 0;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i+1)%n], c = poly[(i+2)%n];
      var cr = (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
      if (Math.abs(cr) < 1e-6) continue;
      var s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }
  function clipToConvexPoly(pts, poly){
    var n = poly.length;
    // Force CCW
    var sa = 0;
    for (var i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i+1)%n];
      sa += p[0]*q[1] - q[0]*p[1];
    }
    var ccw = sa > 0 ? poly : poly.slice().reverse();
    var cur = pts.slice();
    for (var i = 0; i < ccw.length; i++) {
      cur = clipHalf(cur, ccw[i], ccw[(i+1)%ccw.length]);
      if (!cur.length) return [];
    }
    return cur;
  }

  // Outline winding: force CCW so our face polygons are CCW too.
  var outline = DRAW.outline.slice();
  var olSA = 0;
  for (var i = 0; i < outline.length; i++) {
    var p = outline[i], q = outline[(i+1)%outline.length];
    olSA += p[0]*q[1] - q[0]*p[1];
  }
  if (olSA < 0) outline = outline.slice().reverse();
  // Ray-cast point-in-outline (works for concave L/T outlines too).
  function _ptInOutline(px, py){
    var inside = false, n2 = outline.length;
    for (var k = 0, j = n2-1; k < n2; j = k++) {
      var xi = outline[k][0], yi = outline[k][1];
      var xj = outline[j][0], yj = outline[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi+1e-10) + xi))
        inside = !inside;
    }
    return inside;
  }

  // ── Big-L detection (all 4 orientations) ──────────────────────
  // A "Big-L" outline has 6 vertices and exactly one reflex.  The
  // canonical orientation (used by buildBigLLayout below) is
  // wing-top-left, main-bottom-right, which means at the reflex the
  // prev_edge runs SOUTH and the next_edge runs EAST.  All three
  // other orientations (90° CW / 180° / 270° CW rotations of the
  // canonical) are also valid L-shapes — we detect their orientation
  // and let the caller rotate the outline into canonical, run the
  // hand-designed layout, then rotate the output back.
  //
  // Orientation table (CCW outline, screen y-down):
  //   0: prev=S, next=E   (wing top-left)      — canonical
  //   1: prev=E, next=N   (wing top-right)
  //   2: prev=N, next=W   (wing bottom-right)
  //   3: prev=W, next=S   (wing bottom-left)
  //
  // `n` quarter-turns CW around the outline's bbox centre brings the
  // outline to canonical: n == orientation.
  function _detectBigL(ol){
    if (!ol || ol.length !== 6) return null;
    var n = ol.length;
    var reflexIdx = -1;
    for (var i = 0; i < n; i++) {
      var prev = ol[(i-1+n)%n], curr = ol[i], next = ol[(i+1)%n];
      var ex1 = curr[0]-prev[0], ey1 = curr[1]-prev[1];
      var ex2 = next[0]-curr[0], ey2 = next[1]-curr[1];
      var cross = ex1*ey2 - ey1*ex2;
      if (cross < -1) {
        if (reflexIdx !== -1) return null;  // more than one reflex → not a simple L
        reflexIdx = i;
      }
    }
    if (reflexIdx < 0) return null;
    var reflex = ol[reflexIdx];
    var prevP = ol[(reflexIdx-1+n)%n];
    var nextP = ol[(reflexIdx+1)%n];
    // Classify each edge direction (axis-aligned only).
    function dirOf(from, to){
      var dx = to[0]-from[0], dy = to[1]-from[1];
      if (Math.abs(dx) < 4 && dy >  4) return 'S';
      if (Math.abs(dx) < 4 && dy < -4) return 'N';
      if (Math.abs(dy) < 4 && dx >  4) return 'E';
      if (Math.abs(dy) < 4 && dx < -4) return 'W';
      return null;
    }
    var prevDir = dirOf(prevP, reflex);
    var nextDir = dirOf(reflex, nextP);
    if (!prevDir || !nextDir) return null;
    var orientation = -1;
    if (prevDir === 'S' && nextDir === 'E') orientation = 0;
    else if (prevDir === 'E' && nextDir === 'N') orientation = 1;
    else if (prevDir === 'N' && nextDir === 'W') orientation = 2;
    else if (prevDir === 'W' && nextDir === 'S') orientation = 3;
    else return null;
    // Bounding-box pivot (used by the rotation wrapper).
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ol.forEach(function(p){
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return {
      orientation: orientation,
      pivot: [cx, cy],
      reflex: reflex.slice(),
      // wing/main bboxes are computed AFTER rotation to canonical
      // (filled in by the caller).  For orientation 0 they're already
      // in canonical space and we fill them here for compatibility.
      wing: orientation === 0
        ? { x0: minX, y0: minY, x1: reflex[0], y1: reflex[1] }
        : null,
      main: orientation === 0
        ? { x0: minX, y0: reflex[1], x1: maxX, y1: maxY }
        : null
    };
  }

  // ── Rotation helpers ──────────────────────────────────────────
  // `n` quarter-turns CW around pivot (cx, cy).  In screen y-down
  // coords, "CW" means a visual clockwise rotation (E→S→W→N→E).
  // 90° CW around (cx, cy):  (x, y) → (cx - (y - cy), cy + (x - cx))
  // 180° :                   (x, y) → (2cx - x, 2cy - y)
  // 90° CCW (== 3 CW):       (x, y) → (cx + (y - cy), cy - (x - cx))
  function rotate90(pt, cx, cy, nTurns){
    var n = ((nTurns % 4) + 4) % 4;
    var x = pt[0], y = pt[1];
    for (var k = 0; k < n; k++) {
      var nx = cx - (y - cy);
      var ny = cy + (x - cx);
      x = nx; y = ny;
    }
    return [x, y];
  }
  // Rotate a free vector (no pivot translation).
  function rotateVec(v, nTurns){
    var n = ((nTurns % 4) + 4) % 4;
    var x = v[0], y = v[1];
    for (var k = 0; k < n; k++) {
      var nx = -y, ny = x;
      x = nx; y = ny;
    }
    return [x, y];
  }
  function rotatePoly(poly, cx, cy, nTurns){
    return poly.map(function(p){ return rotate90(p, cx, cy, nTurns); });
  }

  // ── Big-L canonicalization (orientation 0–3 + horizontal mirror) ───
  // We try the Big-L cascade twice: once on the input outline, and if
  // that fails the proportions gate, again on a horizontally-mirrored
  // copy.  The detection table only covers four rotations, but a
  // mirrored Big-L confuses it into picking an orientation whose
  // rotation produces a shape with swapped wing/main dimensions (gate
  // fails).  Mirroring the input first canonicalises the chirality so
  // the gate can pass.
  //
  // For non-canonical orientations we rotate the outline + DRAW.lines
  // by `bigL.orientation` quarter-turns CW into canonical space, run
  // the hand-designed Big-L layout, then rotate every output back.
  // `DRAW.outline` itself is NEVER mutated (idempotency: future runs
  // re-read it fresh).  `DRAW.lines` is rotated to canonical, the
  // layout function mutates it (removes bridge hip, adds ridge), and
  // then we rotate it back so it sits in original coordinate space.
  // The original lines are saved in __origDrawLines and restored at the
  // very end of this function, so the synthetic ridge/hip changes never
  // persist onto the Map Roof canvas (they're internal to the cut plan).
  var __nTurnsCW = 0;     // quarter-turns CW applied to canonical
  var __pivot    = null;  // rotation pivot (bbox centre of original)
  var __origDrawLines = DRAW.lines;
  var __origOutlineSnap = outline.slice();  // post-CCW-force outline
  // Mirror state:
  var __mirrored      = false;
  var __mirrorPivotX  = null;
  // Try Big-L; if the proportions gate fails, retry with a horizontal
  // mirror of the input outline + DRAW.lines.
  var bigL = null;
  var isBigL = false;
  for (var __attempt = 0; __attempt < 2; __attempt++) {
    bigL = _detectBigL(outline);
    isBigL = !!bigL;
    __nTurnsCW = 0;
    __pivot = null;
    if (bigL && bigL.orientation !== 0) {
      __nTurnsCW = bigL.orientation;
      __pivot    = bigL.pivot.slice();
      outline = outline.map(function(p){ return rotate90(p, __pivot[0], __pivot[1], __nTurnsCW); });
      DRAW.lines = DRAW.lines.map(function(l){
        if (!l || !l.pts) return l;
        var newL = {};
        for (var k in l) if (l.hasOwnProperty(k)) newL[k] = l[k];
        newL.pts = l.pts.map(function(p){ return rotate90(p, __pivot[0], __pivot[1], __nTurnsCW); });
        return newL;
      });
      bigL = _detectBigL(outline);
      if (!bigL || bigL.orientation !== 0) {
        // Rotation didn't produce canonical orientation — skip this attempt.
        isBigL = false;
      }
    }
    // Proportions gate: the cascade is parameterised so any wing DEPTH
    // works — a short north wing simply yields a shorter wing ridge (fewer
    // purple sheets) and its N hip-end apex clips against the main; the
    // donor/offcut/valley cascade still tiles cleanly (verified across
    // short → tall wings).  The only requirement kept is that the wing's
    // sheets stay shorter than the main's (wing_w < main_h) so the wing is
    // genuinely the smaller arm; an oversized wing falls to the generic
    // path.  (We previously also required wing_w ≤ 2·wing_h — a real N-S
    // ridge apex north of the junction — which wrongly rejected every
    // short/shallow wing and dropped it onto the generic path that doesn't
    // run the donor logic at all.)
    if (isBigL && bigL && bigL.orientation === 0 && bigL.wing && bigL.main) {
      var _bgWingW = bigL.wing.x1 - bigL.wing.x0;
      var _bgMainH = bigL.main.y1 - bigL.main.y0;
      var _bgWingShorter = (_bgWingW <  _bgMainH);
      if (!_bgWingShorter) {
        isBigL = false;
      }
    } else {
      isBigL = false;
    }
    if (isBigL) break;
    // Reset to original state before next attempt.
    DRAW.lines = __origDrawLines;
    outline = __origOutlineSnap.slice();
    __nTurnsCW = 0;
    __pivot = null;
    // Second attempt: horizontally mirror the outline + DRAW.lines.
    if (__attempt === 0) {
      var _omX = Infinity, _oMX = -Infinity;
      outline.forEach(function(p){
        if (p[0] < _omX) _omX = p[0];
        if (p[0] > _oMX) _oMX = p[0];
      });
      __mirrorPivotX = (_omX + _oMX) / 2;
      __mirrored = true;
      outline = outline.map(function(p){ return [2*__mirrorPivotX - p[0], p[1]]; });
      DRAW.lines = DRAW.lines.map(function(l){
        if (!l || !l.pts) return l;
        var newL = {};
        for (var k in l) if (l.hasOwnProperty(k)) newL[k] = l[k];
        newL.pts = l.pts.map(function(p){ return [2*__mirrorPivotX - p[0], p[1]]; });
        return newL;
      });
      // Force CCW winding on the mirrored outline (mirror reverses winding).
      var _olSAm = 0;
      for (var _im = 0; _im < outline.length; _im++) {
        var _pm = outline[_im], _qm = outline[(_im+1)%outline.length];
        _olSAm += _pm[0]*_qm[1] - _qm[0]*_pm[1];
      }
      if (_olSAm < 0) outline = outline.slice().reverse();
    }
  }
  // If both attempts failed, ensure we end up in a clean fallback state.
  if (!isBigL) {
    DRAW.lines = __origDrawLines;
    outline = __origOutlineSnap.slice();
    __nTurnsCW = 0;
    __pivot = null;
    __mirrored = false;
    __mirrorPivotX = null;
  }

  if (!isBigL) {

  // Count reflex corners on the (CCW-forced) outline.  The robust
  // coverage path below — boundary-walked faces, full-span strips,
  // concave-face clipping, no phantom routing — is scoped to a simple
  // single-reflex L-shape.  Plain (0-reflex) and multi-reflex (T/U/+)
  // outlines keep the original strip logic untouched.
  var _reflexCount = 0;
  (function(){
    var n = outline.length;
    for (var i = 0; i < n; i++) {
      var p0 = outline[(i-1+n)%n], p1 = outline[i], p2 = outline[(i+1)%n];
      var cr = (p1[0]-p0[0])*(p2[1]-p1[1]) - (p1[1]-p0[1])*(p2[0]-p1[0]);
      if (cr < -1) _reflexCount++;
    }
  })();
  var _isLShape = (_reflexCount === 1);
  // The robust direct-sheeting path (sheet each face over its true
  // boundary-walked polygon: full projected span, concave-face clipping,
  // no phantom-4-hip cross-valley routing) also handles the T topology
  // (a central stem/wing flanked by two valleys → 2 reflex corners).
  // Without full-span sheeting the stem faces — which reach UP past their
  // gutter into the cap as a triangle bounded by the two valleys — would
  // leave that triangle unsheeted.
  var _directSheet = (_reflexCount === 1 || _reflexCount === 2);

  // ── Build faces ────────────────────────────────────────────────
  // For each gutter line, find the two adjacent inward boundaries
  // (hips / barges / valleys), trace them to their interior endpoints,
  // and produce the face polygon. Triangular if the two inward lines
  // meet at the same apex (hip-end); quadrilateral if they reach
  // distinct ridge endpoints.
  function findConnectedInward(p, excludeLine){
    var matches = [];
    DRAW.lines.forEach(function(l){
      if (l === excludeLine) return;
      if (l.type !== 'hip' && l.type !== 'barge' && l.type !== 'valley') return;
      if (!l.pts || l.pts.length !== 2) return;
      if (ptEq(l.pts[0], p)) matches.push({ line: l, far: l.pts[1].slice() });
      else if (ptEq(l.pts[1], p)) matches.push({ line: l, far: l.pts[0].slice() });
    });
    return matches;
  }
  // Shortest path between two interior endpoints over the inner line
  // network (hips / ridges / valleys / barges — never gutters).  Used so
  // a long-side face whose two inward lines reach ridge points joined by
  // an intermediate ridge+hip chain follows that real boundary instead
  // of cutting a straight chord across it (which both leaves a gap below
  // the chord and overlaps the neighbouring face).  Returns the list of
  // INTERMEDIATE vertices (excluding both endpoints), or [] if directly
  // connected / no path.
  function _innerPath(from, to){
    var segs = DRAW.lines.filter(function(l){
      return l && l.pts && l.pts.length === 2 &&
        (l.type === 'hip' || l.type === 'ridge' || l.type === 'valley' || l.type === 'barge');
    });
    var visited = [from], queue = [[from]];
    while (queue.length) {
      var pathv = queue.shift();
      var node = pathv[pathv.length - 1];
      if (ptEq(node, to)) return pathv.slice(1, -1);
      segs.forEach(function(l){
        var nxt = ptEq(l.pts[0], node) ? l.pts[1] : (ptEq(l.pts[1], node) ? l.pts[0] : null);
        if (!nxt) return;
        if (visited.some(function(v){return ptEq(v, nxt);})) return;
        visited.push(nxt.slice());
        queue.push(pathv.concat([nxt.slice()]));
      });
    }
    return [];
  }
  var faces = [];
  DRAW.lines.forEach(function(g){
    if (g.type !== 'gutter') return;
    if (!g.pts || g.pts.length !== 2) return;
    var a = g.pts[0], b = g.pts[1];
    var aSide = findConnectedInward(a, g);
    var bSide = findConnectedInward(b, g);
    if (!aSide.length || !bSide.length) return;
    var sa = aSide[0], sb = bSide[0];
    var faceType, poly;
    if (ptEq(sa.far, sb.far)) {
      faceType = 'hip-end';
      poly = [a.slice(), sa.far, b.slice()];
    } else {
      faceType = 'long-side';
      var mids = _directSheet ? _innerPath(sa.far, sb.far) : [];
      poly = [a.slice(), sa.far].concat(mids).concat([sb.far, b.slice()]);
    }
    // Force the face polygon to CCW so clipHalf works downstream.
    var fsa = 0;
    for (var i = 0; i < poly.length; i++) {
      var pp = poly[i], qq = poly[(i+1)%poly.length];
      fsa += pp[0]*qq[1] - qq[0]*pp[1];
    }
    if (fsa < 0) poly = poly.reverse();
    // Verify the centroid is inside the outline — rejects spurious
    // faces (e.g. inner-step gutter on an L pointing the wrong way).
    var cc = polyCentroid(poly);
    if (!_ptInOutline(cc[0], cc[1])) return;
    // Compute the perpendicular distance (gutter to apex / ridge) —
    // this is the plan sheet length BEFORE the pitch correction.
    var gdx = b[0]-a[0], gdy = b[1]-a[1];
    var gL  = vlen([gdx, gdy]);
    if (gL < 1) return;
    var nx = -gdy / gL, ny = gdx / gL;  // perp candidate
    // Flip so it points away from the gutter into the face.
    var toApex = [cc[0]-a[0], cc[1]-a[1]];
    if (nx*toApex[0] + ny*toApex[1] < 0) { nx = -nx; ny = -ny; }
    var perpPx = 0;
    poly.forEach(function(pp){
      var d = (pp[0]-a[0])*nx + (pp[1]-a[1])*ny;
      if (d > perpPx) perpPx = d;
    });
    faces.push({
      gutter: g,
      poly:   poly,
      type:   faceType,
      a: a, b: b,
      gL: gL, gAng: Math.atan2(gdy, gdx),
      tx: gdx/gL, ty: gdy/gL,    // along-gutter unit
      nx: nx, ny: ny,            // inward perpendicular unit
      perpPx: perpPx,
      planSheetM:  perpPx * effectiveScale,
      sheetM:      perpPx * effectiveScale * pitchFactor,
      area: polyArea(poly),
      centroid: cc
    });
  });

  // ── T-shape clean-face override ───────────────────────────────────
  // A T (cap + central stem) yields a complex straight skeleton whose
  // non-convex faces the strip clipper can't tile (large junction gaps
  // at mid/wide stem widths).  Detect the T and REPLACE the skeleton
  // faces with an imposed clean topology — cap 4-hip + stem hip + two
  // valleys, all convex — so the direct-sheet tiler covers them cleanly
  // for ANY stem size and orientation.
  function _mkTFace(a, b, poly, faceType, color){
    var p = [];
    for (var i = 0; i < poly.length; i++){
      var q = poly[i], pv = p[p.length-1];
      if (!pv || Math.abs(pv[0]-q[0])>0.5 || Math.abs(pv[1]-q[1])>0.5) p.push([q[0],q[1]]);
    }
    if (p.length>2 && Math.abs(p[0][0]-p[p.length-1][0])<0.5 && Math.abs(p[0][1]-p[p.length-1][1])<0.5) p.pop();
    var gdx=b[0]-a[0], gdy=b[1]-a[1], gL=Math.sqrt(gdx*gdx+gdy*gdy);
    var nx=-gdy/gL, ny=gdx/gL, cc=polyCentroid(p);
    if (nx*(cc[0]-a[0])+ny*(cc[1]-a[1])<0){ nx=-nx; ny=-ny; }
    var perpPx=0; p.forEach(function(pp){var d=(pp[0]-a[0])*nx+(pp[1]-a[1])*ny; if(d>perpPx)perpPx=d;});
    return { poly:p, type:faceType, a:[a[0],a[1]], b:[b[0],b[1]], gL:gL, gAng:Math.atan2(gdy,gdx),
      tx:gdx/gL, ty:gdy/gL, nx:nx, ny:ny, perpPx:perpPx,
      planSheetM:perpPx*effectiveScale, sheetM:perpPx*effectiveScale*pitchFactor,
      area:polyArea(p), centroid:cc, color:color };
  }
  function _buildTFaces(ol){
    if (!ol || ol.length !== 8) return null;
    var n=8, reflex=[];
    for (var i=0;i<n;i++){
      var q0=ol[(i-1+n)%n],q1=ol[i],q2=ol[(i+1)%n];
      var cr=(q1[0]-q0[0])*(q2[1]-q1[1])-(q1[1]-q0[1])*(q2[0]-q1[0]);
      if (cr<-1) reflex.push(i);
    }
    if (reflex.length!==2) return null;
    var rA=reflex[0], rB=reflex[1], dd=(rB-rA+n)%n, btw;
    if (dd===3) btw=[(rA+1)%n,(rA+2)%n];
    else if (n-dd===3) btw=[(rB+1)%n,(rB+2)%n];
    else return null;
    var R1=ol[rA],R2=ol[rB],T1=ol[btw[0]],T2=ol[btw[1]];
    var jc=[(R1[0]+R2[0])/2,(R1[1]+R2[1])/2], sc=[(T1[0]+T2[0])/2,(T1[1]+T2[1])/2];
    var sdir=[sc[0]-jc[0], sc[1]-jc[1]];
    var nTurns = (Math.abs(sdir[1])>=Math.abs(sdir[0])) ? (sdir[1]>0?0:2) : (sdir[0]>0?1:3);
    var mnx=Infinity,mxx=-Infinity,mny=Infinity,mxy=-Infinity;
    ol.forEach(function(p){mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mny=Math.min(mny,p[1]);mxy=Math.max(mxy,p[1]);});
    var pvx=(mnx+mxx)/2, pvy=(mny+mxy)/2;
    var rot = ol.map(function(p){return rotate90(p,pvx,pvy,nTurns);});
    var creflex=[];
    for (var i=0;i<n;i++){
      var q0=rot[(i-1+n)%n],q1=rot[i],q2=rot[(i+1)%n];
      var cr=(q1[0]-q0[0])*(q2[1]-q1[1])-(q1[1]-q0[1])*(q2[0]-q1[0]);
      if (cr<-1) creflex.push(rot[i]);
    }
    if (creflex.length!==2) return null;
    var cmnx=Infinity,cmxx=-Infinity,cmny=Infinity,cmxy=-Infinity;
    rot.forEach(function(p){cmnx=Math.min(cmnx,p[0]);cmxx=Math.max(cmxx,p[0]);cmny=Math.min(cmny,p[1]);cmxy=Math.max(cmxy,p[1]);});
    var jy=(creflex[0][1]+creflex[1][1])/2;
    var cx0=cmnx, cx1=cmxx, cy0=cmny, sy1=cmxy;
    var sx0=Math.min(creflex[0][0],creflex[1][0]), sx1=Math.max(creflex[0][0],creflex[1][0]);
    if (!(sx0>cx0-0.5 && sx1<cx1+0.5 && jy>cy0+1 && sy1>jy+1 && Math.abs(creflex[0][1]-creflex[1][1])<2)) return null;
    var ch=jy-cy0, sw=sx1-sx0, sxc=(sx0+sx1)/2, capMidY=(cy0+jy)/2;
    var capWap=[cx0+ch/2,capMidY], capEap=[cx1-ch/2,capMidY];
    var stemSap=[sxc, sy1-sw/2], ridgeN=[sxc,capMidY];
    var OR=COL_ORANGE, BL=COL_BLUE, PU=COL_PURPLE, descs=[];
    // "Main" should be whichever rectangle has the LONGER per-piece sheet
    // length running through it — that's where end-to-end long sheets get
    // laid + the donor cascade lives. Cap sheets run ridge-to-eave a
    // distance of ch/2; stem sheets run a distance of sw/2.
    // Tie or cap longer → cap is main (orange/blue), stem is wing (purple).
    // Stem strictly longer → stem is main (orange/blue), cap is wing (purple).
    var _stemIsMain = sw > ch + 0.5;
    var capLong = _stemIsMain ? PU : OR;     // cap N long-side colour
    var capHip  = _stemIsMain ? PU : OR;     // cap W/E hip-end colour
    var capStub = _stemIsMain ? PU : BL;     // cap S-W and S-E stub colour
    var stemLong  = _stemIsMain ? OR : PU;   // stem long-side OR colour
    var stemLongB = _stemIsMain ? BL : PU;   // stem long-side BL colour
    var stemHipS  = _stemIsMain ? OR : BL;   // stem S hip-end
    var stemHipN  = _stemIsMain ? BL : BL;   // stem N phantom hip (only present when sw > ch)
    descs.push({a:[cx0,cy0],b:[cx1,cy0],poly:[[cx0,cy0],[cx1,cy0],capEap,capWap],t:'long-side',c:capLong}); // cap N
    descs.push({a:[cx0,cy0],b:[cx0,jy],poly:[[cx0,cy0],capWap,[cx0,jy]],t:'hip-end',c:capHip});             // cap W hip
    descs.push({a:[cx1,cy0],b:[cx1,jy],poly:[[cx1,cy0],capEap,[cx1,jy]],t:'hip-end',c:capHip});             // cap E hip
    descs.push({a:[sx0,sy1],b:[sx1,sy1],poly:[[sx0,sy1],stemSap,[sx1,sy1]],t:'hip-end',c:stemHipS});        // stem S hip
    if (sw > ch + 0.5){
      // Stem ridge HIGHER than the cap ridge → the stem is a phantom 4-hip: its
      // long-sides are hip-cut at BOTH the south hip (stemSap) AND a north
      // hip-end (the notch triangle W1-T0-E1 whose apex T0 is the high stem-
      // ridge top).  cap N stays a plain trapezoid; the notch is its own hip-
      // end, fed by the stem long-sides' north offcuts via the same L-shape
      // corner cascade as the south hip.
      var W1=[sx0+ch/2,capMidY], E1=[sx1-ch/2,capMidY], T0=[sxc,cy0+sw/2];
      descs.push({a:W1,b:E1,poly:[W1,T0,E1],t:'hip-end',c:stemHipN});                                       // stem N phantom hip-end
      descs.push({a:[cx0,jy],b:[sx0,jy],poly:[[cx0,jy],[sx0,jy],W1,capWap],t:'long-side',c:capStub});        // cap S-W stub
      descs.push({a:[sx1,jy],b:[cx1,jy],poly:[[sx1,jy],[cx1,jy],capEap,E1],t:'long-side',c:capStub});        // cap S-E stub
      descs.push({a:[sx0,jy],b:[sx0,sy1],poly:[[sx0,jy],W1,T0,stemSap,[sx0,sy1]],t:'long-side',c:stemLong});  // stem W
      descs.push({a:[sx1,jy],b:[sx1,sy1],poly:[[sx1,jy],[sx1,sy1],stemSap,T0,E1],t:'long-side',c:stemLongB}); // stem E
    } else {
      // Stem ridge LOWER than / equal to the cap ridge (at sw==ch, V==ridgeN).
      var V=[sxc, jy-sw/2];
      descs.push({a:[cx0,jy],b:[sx0,jy],poly:[[cx0,jy],[sx0,jy],V,ridgeN,capWap],t:'long-side',c:capStub});
      descs.push({a:[sx1,jy],b:[cx1,jy],poly:[[sx1,jy],[cx1,jy],capEap,ridgeN,V],t:'long-side',c:capStub});
      descs.push({a:[sx0,jy],b:[sx0,sy1],poly:[[sx0,jy],V,stemSap,[sx0,sy1]],t:'long-side',c:stemLong});
      descs.push({a:[sx1,jy],b:[sx1,sy1],poly:[[sx1,jy],[sx1,sy1],stemSap,V],t:'long-side',c:stemLongB});
    }
    var inv=(4-nTurns)%4;
    function rb(p){return rotate90(p,pvx,pvy,inv);}
    return descs.map(function(d){return _mkTFace(rb(d.a),rb(d.b),d.poly.map(rb),d.t,d.c);});
  }
  var _tFaces = _buildTFaces(outline);
  // Overlay lines from the SAME imposed T topology as the faces (and as the
  // main diagram via buildTRoofLines), so the sheet plan's ridge/hip/valley
  // lines always match the sheets instead of the unstable skeleton auto-lines.
  var _tLines = _tFaces ? buildTRoofLines(outline) : null;
  var _tCascade = !!(_tFaces && _tFaces.length);
  if (_tCascade) faces = _tFaces;

  // ── Skeleton planar-subdivision faces (3+ reflex shapes) ──────────
  // L (1 reflex) and T (2 reflex) have dedicated clean topologies above.
  // For richer rectilinear outlines (double-wing, U, +, …) the gutter-
  // walk face builder can't trace faces through the complex skeleton and
  // produces overlapping/ballooning polygons.  Instead, treat the outline
  // edges + skeleton arcs (hips/valleys/ridges) as a planar segment
  // arrangement: split every segment at its intersections/T-junctions,
  // then extract the bounded faces.  Each roof plane is one bounded face
  // containing exactly one outline (gutter) edge — clean and non-
  // overlapping for ANY rectilinear footprint.
  function _buildSkeletonFaces(){
    if (_reflexCount < 3) return null;
    var TOL = 2.5;
    var raw = [];
    for (var i = 0; i < outline.length; i++)
      raw.push({a: outline[i].slice(), b: outline[(i+1)%outline.length].slice(), g: true});
    DRAW.lines.forEach(function(l){
      if (l.type === 'gutter' || !l.pts || l.pts.length !== 2) return;
      raw.push({a: l.pts[0].slice(), b: l.pts[1].slice(), g: false});
    });
    function onSeg(p, a, b){
      var dx = b[0]-a[0], dy = b[1]-a[1], L2 = dx*dx+dy*dy;
      if (L2 < 1) return null;
      var t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L2;
      if (t < -0.001 || t > 1.001) return null;
      if (Math.hypot(a[0]+t*dx-p[0], a[1]+t*dy-p[1]) > TOL) return null;
      return t;
    }
    function segInt(a, b, c, d){
      var rx = b[0]-a[0], ry = b[1]-a[1], sx = d[0]-c[0], sy = d[1]-c[1];
      var den = rx*sy - ry*sx; if (Math.abs(den) < 1e-6) return null;
      var t = ((c[0]-a[0])*sy - (c[1]-a[1])*sx) / den;
      var u = ((c[0]-a[0])*ry - (c[1]-a[1])*rx) / den;
      if (t < 0.001 || t > 0.999 || u < 0.001 || u > 0.999) return null;
      return [a[0]+t*rx, a[1]+t*ry];
    }
    var allPts = []; raw.forEach(function(s){ allPts.push(s.a, s.b); });
    var pieces = [];
    raw.forEach(function(s){
      var ts = [0, 1];
      allPts.forEach(function(p){ var t = onSeg(p, s.a, s.b); if (t != null && t > 0.001 && t < 0.999) ts.push(t); });
      raw.forEach(function(o){ if (o === s) return; var ip = segInt(s.a, s.b, o.a, o.b);
        if (ip){ var t = onSeg(ip, s.a, s.b); if (t != null && t > 0.001 && t < 0.999) ts.push(t); } });
      ts.sort(function(a, b){ return a-b; });
      for (var i = 0; i < ts.length-1; i++){
        if (ts[i+1]-ts[i] < 0.005) continue;
        pieces.push({
          a: [s.a[0]+ts[i]*(s.b[0]-s.a[0]),   s.a[1]+ts[i]*(s.b[1]-s.a[1])],
          b: [s.a[0]+ts[i+1]*(s.b[0]-s.a[0]), s.a[1]+ts[i+1]*(s.b[1]-s.a[1])],
          g: s.g
        });
      }
    });
    var nodes = [];
    function nid(p){ for (var i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i][0]-p[0], nodes[i][1]-p[1]) < TOL) return i; nodes.push([p[0], p[1]]); return nodes.length-1; }
    var seen = {}, H = [];
    pieces.forEach(function(s){
      var u = nid(s.a), v = nid(s.b); if (u === v) return;
      [[u, v], [v, u]].forEach(function(e){
        var k = e[0]+'_'+e[1]; if (seen[k]) return; seen[k] = 1;
        H.push({u: e[0], v: e[1], gut: s.g, ang: Math.atan2(nodes[e[1]][1]-nodes[e[0]][1], nodes[e[1]][0]-nodes[e[0]][0])});
      });
    });
    var outE = {}; H.forEach(function(h){ (outE[h.u] = outE[h.u] || []).push(h); });
    Object.keys(outE).forEach(function(k){ outE[k].sort(function(a, b){ return a.ang-b.ang; }); });
    function nextCW(h){ var lst = outE[h.v]; for (var i = 0; i < lst.length; i++) if (lst[i].v === h.u) return lst[(i-1+lst.length)%lst.length]; return null; }
    var visited = {}, cycles = [];
    H.forEach(function(h0){
      if (visited[h0.u+'_'+h0.v]) return;
      var face = [], h = h0, g = 0;
      do { visited[h.u+'_'+h.v] = 1; face.push(h); h = nextCW(h); g++; }
      while (h && !(h.u === h0.u && h.v === h0.v) && g < 500);
      if (g < 500 && face.length >= 3) cycles.push(face);
    });
    function cyArea(f){ var s = 0; for (var i = 0; i < f.length; i++){ var a = nodes[f[i].u], b = nodes[f[(i+1)%f.length].u]; s += a[0]*b[1]-b[0]*a[1]; } return s/2; }
    var built = [];
    cycles.forEach(function(f){
      var ar = cyArea(f);
      if (ar < 50) return;                     // outer face (negative) + noise slivers
      var gutEdges = f.filter(function(h){ return h.gut; });
      if (!gutEdges.length) return;
      // pick the longest gutter edge as the face's gutter
      var ge = gutEdges.sort(function(a, b){
        return Math.hypot(nodes[b.v][0]-nodes[b.u][0], nodes[b.v][1]-nodes[b.u][1])
             - Math.hypot(nodes[a.v][0]-nodes[a.u][0], nodes[a.v][1]-nodes[a.u][1]);
      })[0];
      var verts = f.map(function(h){ return nodes[h.u].slice(); });
      var gi = f.indexOf(ge);
      // Reorder to the standard face convention: gutter endpoints at the
      // two ends of the poly, ridge/apex vertices in between (poly[1]/[2]
      // are the apexes).  Rotate so the gutter edge leads, then fold the
      // remainder back so it reads [a, …apexes…, b].  This lets the plain
      // 4-hip corner→hip-end cascade match these faces by apex.
      var rot = verts.slice(gi).concat(verts.slice(0, gi)); // [a, b, …rest]
      var poly = [rot[0]].concat(rot.slice(1).reverse());   // [a, …rest…, b]
      var fsa = 0;
      for (var pi = 0; pi < poly.length; pi++){
        var pp = poly[pi], qq = poly[(pi+1)%poly.length];
        fsa += pp[0]*qq[1] - qq[0]*pp[1];
      }
      if (fsa < 0) poly = poly.reverse();
      var a = nodes[ge.u].slice(), b = nodes[ge.v].slice();
      var gdx = b[0]-a[0], gdy = b[1]-a[1], gL = vlen([gdx, gdy]);
      if (gL < 1) return;
      var cc = polyCentroid(poly);
      var nx = -gdy/gL, ny = gdx/gL;
      if (nx*(cc[0]-a[0]) + ny*(cc[1]-a[1]) < 0){ nx = -nx; ny = -ny; }
      var perpPx = 0;
      poly.forEach(function(pp){ var d = (pp[0]-a[0])*nx + (pp[1]-a[1])*ny; if (d > perpPx) perpPx = d; });
      built.push({
        poly: poly, type: (poly.length === 3 ? 'hip-end' : 'long-side'),
        a: a, b: b, gL: gL, gAng: Math.atan2(gdy, gdx),
        tx: gdx/gL, ty: gdy/gL, nx: nx, ny: ny, perpPx: perpPx,
        planSheetM: perpPx*effectiveScale, sheetM: perpPx*effectiveScale*pitchFactor,
        area: polyArea(poly), centroid: cc
      });
    });
    return built.length ? built : null;
  }
  var _skelFaces = !_tCascade ? _buildSkeletonFaces() : null;
  if (_skelFaces){ faces = _skelFaces; _directSheet = true; }

  if (!faces.length) {
    outEl.innerHTML = '<p style="color:var(--text2)">Could not detect any roof faces. Make sure hip/ridge lines connect to the gutter corners.</p>';
    return;
  }

  // ── Main rectangle detection (for phantom-4-hip extension) ────
  // The "main rectangle" is the largest axis-aligned rectangle that
  // fits inside the outline.  For an L / T shape this is the main body
  // (ignoring the wing).  For a plain 4-hip it's the building itself.
  // Orange / blue are picked as the two long-side faces whose gutters
  // run along the main rect's LONG axis — if either gutter is shorter
  // than the main rect edge it lies on, the missing piece is a
  // "phantom" extension that gets sheets ordered for it but routed as
  // offcuts onto the wing faces.
  function _findMainRect() {
    var xs = [], ys = [];
    outline.forEach(function(p){
      if (xs.every(function(v){return Math.abs(v-p[0]) > 1;})) xs.push(p[0]);
      if (ys.every(function(v){return Math.abs(v-p[1]) > 1;})) ys.push(p[1]);
    });
    xs.sort(function(a,b){return a-b;});
    ys.sort(function(a,b){return a-b;});
    // How much of a rect edge is a REAL eave: sample points just OUTSIDE
    // the edge; the fraction that lands outside the outline is its realness.
    // Used to break area ties — a telescoping/stepped outline has a wide
    // shallow rectangle equal in area to the true (deeper) main, but the
    // shallow one's far long edge runs through the interior (it's a phantom
    // eave), so the main, whose both long edges are real eaves, wins.
    function edgeReal(horizontal, fixed, a, b){
      var hits = 0, N = 7;
      for (var t = 1; t <= N; t++) {
        var f = a + (b-a)*t/(N+1);
        var p1 = horizontal ? [f, fixed-3] : [fixed-3, f];
        var p2 = horizontal ? [f, fixed+3] : [fixed+3, f];
        if (!_ptInOutline(p1[0],p1[1]) || !_ptInOutline(p2[0],p2[1])) hits++;
      }
      return hits / N;
    }
    var best = null, bestA = 0, bestReal = -1, bestSL = 0;
    for (var i = 0; i < xs.length - 1; i++) {
      for (var j = i + 1; j < xs.length; j++) {
        for (var k = 0; k < ys.length - 1; k++) {
          for (var l = k + 1; l < ys.length; l++) {
            var x0 = xs[i], x1 = xs[j], y0 = ys[k], y1 = ys[l];
            // All inner sample points must be inside the outline.  Sample at
            // 1/10 steps (not 1/5) so a narrow notch — e.g. a shallow wing
            // step — isn't stepped over, which would wrongly accept a wide
            // rectangle that actually pokes outside the outline.
            var ok = true;
            for (var u = 1; u <= 9 && ok; u++) {
              for (var v = 1; v <= 9 && ok; v++) {
                if (!_ptInOutline(x0 + (x1-x0)*u/10, y0 + (y1-y0)*v/10)) ok = false;
              }
            }
            if (!ok) continue;
            var area = (x1-x0)*(y1-y0);
            // Realness of the two LONG edges (the donor-slope eaves).
            var horiz = (x1-x0) >= (y1-y0);
            var real = horiz
              ? edgeReal(true, y0, x0, x1) + edgeReal(true, y1, x0, x1)
              : edgeReal(false, x0, y0, y1) + edgeReal(false, x1, y0, y1);
            // Per-piece sheet length = half the SHORTER side (ridge runs
            // along the longer side, sheets run perpendicular). The
            // rectangle with the longer per-piece sheet length is the
            // one where "the long sheets" run end-to-end, which is the
            // user's mental model for which rectangle should be MAIN.
            // Ties broken by area, then by edge realness.
            var sheetLen = Math.min(x1-x0, y1-y0) / 2;
            var SLEPS = 2;  // px tolerance — sheet lengths within ~10cm tie
            var better =
              sheetLen > bestSL + SLEPS
              || (Math.abs(sheetLen - bestSL) <= SLEPS && area > bestA + 1)
              || (Math.abs(sheetLen - bestSL) <= SLEPS && Math.abs(area - bestA) <= 1 && real > bestReal);
            if (better) {
              bestSL = sheetLen; bestA = area; bestReal = real; best = {x0:x0,y0:y0,x1:x1,y1:y1};
            }
          }
        }
      }
    }
    return best;
  }
  var mainRect = _findMainRect();
  var mainAxis = mainRect && (mainRect.x1-mainRect.x0) >= (mainRect.y1-mainRect.y0) ? 'h' : 'v';

  // ── Colour assignment ─────────────────────────────────────────
  // Orange = long-side along main rect's "low" long edge
  // Blue   = long-side along main rect's "high" long edge
  // Hip-end faces inherit the colour of whichever long-side they share
  // an apex with.  Anything else (wing faces) gets PURPLE.
  faces.sort(function(a, b){ return b.gL - a.gL; });
  var mainA = null, mainB = null;  // orange, blue
  if (_tCascade) {
    // T faces already carry their imposed colours; pick the orange/blue
    // long-sides as the nominal main pair for downstream sequencing.
    faces.forEach(function(f){
      if (f.type==='long-side' && f.color===COL_ORANGE && (!mainA || f.gL>mainA.gL)) mainA=f;
      if (f.type==='long-side' && f.color===COL_BLUE && (!mainB || f.gL>mainB.gL)) mainB=f;
    });
  } else {
  faces.forEach(function(f){ f.color = COL_PURPLE; });
  if (mainRect) {
    faces.forEach(function(f){
      // A square main is a pyramid: its N/S slopes trace as TRIANGLES
      // (hip-ends) rather than 4-vertex long-sides, but they are still the
      // orange/blue main slopes.  Accept a hip-end whose gutter runs along
      // the main rect's long edge as well as a long-side.
      if (f.type !== 'long-side' && f.type !== 'hip-end') return;
      var a = f.a, b = f.b;
      if (mainAxis === 'h') {
        if (Math.abs(a[1]-b[1]) > 4) return;       // gutter not horizontal
        if (Math.abs(a[1]-mainRect.y0) < 4) {
          if (!mainA || f.gL > mainA.gL) mainA = f;
        } else if (Math.abs(a[1]-mainRect.y1) < 4) {
          if (!mainB || f.gL > mainB.gL) mainB = f;
        }
      } else {
        if (Math.abs(a[0]-b[0]) > 4) return;       // gutter not vertical
        if (Math.abs(a[0]-mainRect.x0) < 4) {
          if (!mainA || f.gL > mainA.gL) mainA = f;
        } else if (Math.abs(a[0]-mainRect.x1) < 4) {
          if (!mainB || f.gL > mainB.gL) mainB = f;
        }
      }
    });
  }
  // Fallback (no main rect detected): pick the longest long-side and
  // its anti-parallel partner.
  if (!mainA) {
    for (var fi = 0; fi < faces.length; fi++) {
      if (faces[fi].type === 'long-side') { mainA = faces[fi]; break; }
    }
    if (mainA) {
      for (var fi = 0; fi < faces.length; fi++) {
        var f = faces[fi];
        if (f === mainA || f.type !== 'long-side') continue;
        var dot = mainA.tx*f.tx + mainA.ty*f.ty;
        if (Math.abs(dot) > 0.85) { mainB = f; break; }
      }
    }
  }
  if (mainA) mainA.color = COL_ORANGE;
  if (mainB) mainB.color = COL_BLUE;
  // Hip-end faces inherit colour of whichever long-side face they
  // share a hip with.
  faces.forEach(function(f){
    if (f.type !== 'hip-end') return;
    if (f === mainA || f === mainB) return;   // mains keep their own colour
    var apex = f.poly[1];
    var partner = null;
    [mainA, mainB].forEach(function(m){
      if (!m || partner) return;
      if (ptEq(m.poly[1], apex) || ptEq(m.poly[2], apex)) partner = m;
    });
    if (partner) f.color = partner.color;
  });
  }  // end of !_tCascade colour assignment

  // ── Telescoping (stepped) main detection ──────────────────────────
  // Distinguish a telescoping main (a flush-edged footprint that steps out in
  // shallower sections to one side) from a perpendicular double-wing (whose
  // wing slopes are also "parallel" to a square main's axis).  Requires BOTH:
  //   (a) a MERGED long-side spanning the whole flush edge (one continuous
  //       slope over the main + every wing), and
  //   (b) at least one NON-main parallel long-side (a stepped wing slope).
  var _bx0 = Infinity, _bx1 = -Infinity, _by0 = Infinity, _by1 = -Infinity;
  outline.forEach(function(p){ _bx0=Math.min(_bx0,p[0]); _bx1=Math.max(_bx1,p[0]); _by0=Math.min(_by0,p[1]); _by1=Math.max(_by1,p[1]); });
  var _fullSpan = (mainAxis === 'h') ? (_bx1-_bx0) : (_by1-_by0);
  function _isParallel(f){
    if (f.type !== 'long-side') return false;
    var horiz = Math.abs(f.a[1]-f.b[1]) < 4;
    return (mainAxis === 'h') ? horiz : !horiz;
  }
  var _hasFullSpan = faces.some(function(f){
    return _isParallel(f) && Math.hypot(f.a[0]-f.b[0], f.a[1]-f.b[1]) > _fullSpan * 0.92;
  });
  var _hasParallelWing = faces.some(function(f){
    return f !== mainA && f !== mainB && _isParallel(f);
  });
  var _hasTelesc = !_tCascade && mainRect && _hasFullSpan && _hasParallelWing;

  // Telescoping wings: south-facing slopes PARALLEL to the main but stepped
  // onto their own shorter ridge.  Each is a separate wing whose sheets are a
  // different length, so give each its own colour (purple, green, …) to make
  // the lengths legible.  Only for true telescoping mains — perpendicular
  // wings (L/T/U/double-wing) keep purple.
  if (_hasTelesc) {
    var _wingPalette = [COL_PURPLE, COL_GREEN, '#0891b2', '#d97706'];
    faces.filter(function(f){ return f !== mainA && f !== mainB && _isParallel(f); })
      .sort(function(a,b){ return b.gL - a.gL; })
      .forEach(function(f, i){ f.color = _wingPalette[i % _wingPalette.length]; });
  }

  // ── Canonical telescoping frame (orientation-invariant) ───────────
  // The west offcut chain & the wing-length recolour below were written
  // assuming the wings step toward LOW coordinates (west/north) and the
  // full-span slope is mainA.  Both assumptions break under 180°/270°
  // rotation or mirroring.  Derive an orientation-free frame instead:
  //   _merged  = the full-span main slope (longest gutter; spans the wings)
  //   _donorSlope = the opposite, main-only slope (feeds the west chain)
  //   _cx(p)   = position along the main axis, increasing wings → main
  //   _cy(p)   = position across the main axis, increasing merged → stepped
  // so "wing-side" is always low _cx and the "merged half" is always low _cy.
  var _axisH = (mainAxis === 'h');
  var _merged = null, _donorSlope = null;
  var _cx = null, _cy = null, _gmidCx = null;
  if (_hasTelesc && mainA && mainB) {
    _merged     = (mainA.gL >= mainB.gL) ? mainA : mainB;
    _donorSlope = (_merged === mainA) ? mainB : mainA;
    var _mc = [(mainRect.x0+mainRect.x1)/2, (mainRect.y0+mainRect.y1)/2];
    var _mgMid = [(_merged.a[0]+_merged.b[0])/2, (_merged.a[1]+_merged.b[1])/2];
    var _perpSign = _axisH ? (Math.sign(_mgMid[1]-_mc[1])||-1) : (Math.sign(_mgMid[0]-_mc[0])||-1);
    var _wc = [0,0], _wn = 0;
    faces.forEach(function(f){
      if (f === mainA || f === mainB || !_isParallel(f)) return;
      _wc[0]+=f.centroid[0]; _wc[1]+=f.centroid[1]; _wn++;
    });
    if (_wn){ _wc[0]/=_wn; _wc[1]/=_wn; }
    var _wingSign = _axisH ? (Math.sign(_wc[0]-_mc[0])||-1) : (Math.sign(_wc[1]-_mc[1])||-1);
    _cx = function(p){ var a = _axisH ? p[0] : p[1]; return _wingSign>0 ? -a : a; };  // wings = low _cx
    _cy = function(p){ var b = _axisH ? p[1] : p[0]; return _perpSign>0 ? -b : b; };  // merged = low _cy
    _gmidCx = function(f){ return _cx([(f.a[0]+f.b[0])/2, (f.a[1]+f.b[1])/2]); };
  }

  // ── Phantom-4-hip extents ─────────────────────────────────────
  // For each of orange/blue, see if the gutter spans the whole main
  // rect edge.  If not, record the missing interval(s) as phantom.
  function _phantomFor(face) {
    if (!face || !mainRect) return null;
    var a = face.a, b = face.b;
    var t0, t1, full0, full1;
    if (mainAxis === 'h') {
      t0 = Math.min(a[0], b[0]); t1 = Math.max(a[0], b[0]);
      full0 = mainRect.x0;       full1 = mainRect.x1;
    } else {
      t0 = Math.min(a[1], b[1]); t1 = Math.max(a[1], b[1]);
      full0 = mainRect.y0;       full1 = mainRect.y1;
    }
    var phantoms = [];
    if (t0 - full0 > 4) phantoms.push([full0, t0]);
    if (full1 - t1 > 4) phantoms.push([t1, full1]);
    if (!phantoms.length) return null;
    return { phantoms: phantoms, full: [full0, full1], real: [t0, t1] };
  }
  if (!_tCascade) {
    if (mainA) mainA.phantom = _phantomFor(mainA);
    if (mainB) mainB.phantom = _phantomFor(mainB);
  }

  // Generic point-in-polygon (ray cast). Used to detect strips that
  // lie inside the donor's REAL face vs its phantom extension.
  function _ptInPoly(px, py, poly){
    var inside = false, n2 = poly.length;
    for (var k = 0, j = n2-1; k < n2; j = k++) {
      var xi = poly[k][0], yi = poly[k][1];
      var xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi+1e-10) + xi))
        inside = !inside;
    }
    return inside;
  }

  // For phantom-extended donor faces, the strip layout walks the FULL
  // main rect edge (real + phantom), clipped against the phantom-4-hip
  // trapezoid (not the truncated real face polygon).  Strips whose
  // centroid lands OUTSIDE the donor's real face polygon are tagged
  // `isPhantom` — they're counted as ordered sheets for the donor
  // colour but their physical install location is on a wing face.
  function _extendedDonor(f) {
    if (!f.phantom || !mainRect) return null;
    var w = mainRect.x1 - mainRect.x0;
    var h = mainRect.y1 - mainRect.y0;
    var aStart, aEnd, nx, ny, poly, perpPx;
    if (mainAxis === 'h') {
      var rY  = (mainRect.y0 + mainRect.y1) / 2;
      var rX0 = mainRect.x0 + h/2;
      var rX1 = mainRect.x1 - h/2;
      perpPx = h/2;
      if (Math.abs(f.a[1] - mainRect.y0) < 4) {
        // Top long-side — face on the low-Y edge, normal points +y
        aStart = f.tx > 0 ? [mainRect.x0, mainRect.y0] : [mainRect.x1, mainRect.y0];
        aEnd   = f.tx > 0 ? [mainRect.x1, mainRect.y0] : [mainRect.x0, mainRect.y0];
        nx = 0; ny = 1;
        poly = [[mainRect.x0, mainRect.y0], [rX0, rY], [rX1, rY], [mainRect.x1, mainRect.y0]];
      } else {
        aStart = f.tx > 0 ? [mainRect.x0, mainRect.y1] : [mainRect.x1, mainRect.y1];
        aEnd   = f.tx > 0 ? [mainRect.x1, mainRect.y1] : [mainRect.x0, mainRect.y1];
        nx = 0; ny = -1;
        poly = [[mainRect.x0, mainRect.y1], [mainRect.x1, mainRect.y1], [rX1, rY], [rX0, rY]];
      }
    } else {
      var rX  = (mainRect.x0 + mainRect.x1) / 2;
      var rY0 = mainRect.y0 + w/2;
      var rY1 = mainRect.y1 - w/2;
      perpPx = w/2;
      if (Math.abs(f.a[0] - mainRect.x0) < 4) {
        aStart = f.ty > 0 ? [mainRect.x0, mainRect.y0] : [mainRect.x0, mainRect.y1];
        aEnd   = f.ty > 0 ? [mainRect.x0, mainRect.y1] : [mainRect.x0, mainRect.y0];
        nx = 1; ny = 0;
        poly = [[mainRect.x0, mainRect.y0], [mainRect.x0, mainRect.y1], [rX, rY1], [rX, rY0]];
      } else {
        aStart = f.ty > 0 ? [mainRect.x1, mainRect.y0] : [mainRect.x1, mainRect.y1];
        aEnd   = f.ty > 0 ? [mainRect.x1, mainRect.y1] : [mainRect.x1, mainRect.y0];
        nx = -1; ny = 0;
        poly = [[mainRect.x1, mainRect.y0], [rX, rY0], [rX, rY1], [mainRect.x1, mainRect.y1]];
      }
    }
    var gL = Math.abs(aEnd[0]-aStart[0]) + Math.abs(aEnd[1]-aStart[1]);
    return {
      aStart: aStart, aEnd: aEnd,
      tx: (aEnd[0]-aStart[0])/gL, ty: (aEnd[1]-aStart[1])/gL,
      nx: nx, ny: ny,
      gL: gL, perpPx: perpPx, poly: poly
    };
  }

  // ── Lay sheet strips on each face ─────────────────────────────
  // Strips run perpendicular to the face's gutter. Each strip is a
  // narrow rectangle of width = coverPx centred on its line, clipped
  // against the face polygon.  Phantom-extended donors (orange/blue
  // on an L-shape) walk the FULL main-rect edge and clip against the
  // phantom-4-hip trapezoid; strips landing outside the donor's real
  // face polygon are flagged for routing to a wing receiver face.
  var allStrips = [];
  faces.forEach(function(f){
    // For a single-reflex L the path sheets every face directly over its
    // true (boundary-walked) polygon, so it skips the phantom-4-hip donor
    // extension — that cross-valley rotation was the source of the wing
    // double-sheeting overlap on wider wings.  Other shapes keep the
    // original phantom behaviour.
    var ext = _directSheet ? null : _extendedDonor(f);
    var aStart = ext ? ext.aStart : f.a;
    var tx     = ext ? ext.tx    : f.tx;
    var ty     = ext ? ext.ty    : f.ty;
    var nx     = ext ? ext.nx    : f.nx;
    var ny     = ext ? ext.ny    : f.ny;
    var gL     = ext ? ext.gL    : f.gL;
    var perpPx = ext ? ext.perpPx: f.perpPx;
    var clipPoly = ext ? ext.poly : f.poly;
    // Walk strips across the face's FULL projected span along the gutter
    // tangent (not just the gutter length).  An L-face whose polygon
    // extends past its gutter ends — e.g. a long-side that reaches down
    // into a valley triangle below the reflex — would otherwise leave
    // that triangle unsheeted.  Strip boundaries stay anchored to the
    // coverPx grid at the gutter start so courses remain regular.
    var tMin = 0, tMax = gL;
    if (_directSheet) {
      clipPoly.forEach(function(p){
        var t = (p[0]-aStart[0])*tx + (p[1]-aStart[1])*ty;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      });
    }
    var sLo = Math.floor(tMin / coverPx), sHi = Math.ceil(tMax / coverPx);
    for (var s = sLo; s < sHi; s++){
      var s0 = Math.max(s * coverPx, tMin);
      var s1 = Math.min((s + 1) * coverPx, tMax);
      if (s1 - s0 < 0.5) continue;
      var stripPoly = [
        [aStart[0] + s0*tx, aStart[1] + s0*ty],
        [aStart[0] + s1*tx, aStart[1] + s1*ty],
        [aStart[0] + s1*tx + (perpPx + 4)*nx, aStart[1] + s1*ty + (perpPx + 4)*ny],
        [aStart[0] + s0*tx + (perpPx + 4)*nx, aStart[1] + s0*ty + (perpPx + 4)*ny]
      ];
      // Sutherland–Hodgman needs a CONVEX clip window.  For the common
      // convex face (triangle / quad) clip the strip rect against the
      // face (original behaviour).  For a CONCAVE face — a long-side that
      // follows a bent ridge/hip boundary around an L — swap roles and
      // clip the face against the (convex) strip rect instead.
      var clipped = (_directSheet && !_isConvexPoly(clipPoly))
        ? clipToConvexPoly(clipPoly, stripPoly)
        : clipToConvexPoly(stripPoly, clipPoly);
      if (!clipped || clipped.length < 3) continue;
      var sCent = polyCentroid(clipped);
      // For non-phantom strips, require the centroid to be inside the
      // building outline (rejects spurious strips that poke into the
      // other arm of an L).  For phantom donors the centroid can be
      // outside the donor's real polygon but should still be inside
      // the building footprint.
      if (!_ptInOutline(sCent[0], sCent[1])) continue;
      var isPhantomStrip = false;
      if (ext) {
        // Phantom if the centroid lies OUTSIDE the donor's real face polygon
        isPhantomStrip = !_ptInPoly(sCent[0], sCent[1], f.poly);
      }
      var maxDeep = 0;
      clipped.forEach(function(p){
        var d = (p[0]-aStart[0])*nx + (p[1]-aStart[1])*ny;
        if (d > maxDeep) maxDeep = d;
      });
      var stripPieceM = maxDeep * effectiveScale * pitchFactor;
      // Strip's "would-be" full rectangle (before face-poly clipping).
      // If clipped area is materially smaller than the rectangle, the
      // strip has an offcut cut at a hip — i.e. it's a corner donor.
      var rectArea = (s1 - s0) * perpPx;
      var clipArea = polyArea(clipped);
      allStrips.push({
        face:   f,
        poly:   clipped,
        color:  f.color,
        pieceM: stripPieceM,
        orderedLengthMm: orderedLengthMm(f.sheetM),
        centroid: sCent,
        isPhantom: isPhantomStrip,
        rectArea: rectArea,
        clipArea: clipArea
      });
    }
  });

  // ── Rotate phantom strips onto the wing receiver ──────────────
  // The phantom donor sheet doesn't physically sit at its natural
  // donor-face position (which is over the wing's footprint, not on
  // the wing's roof at all).  It gets ROTATED 90° about the outline's
  // reflex vertex onto the wing face that fronts the bridge area, so
  // its corrugation matches that face's gutter-to-ridge flow.
  function _findReflexVertex(){
    var n = outline.length;
    // We've already forced the outline CCW (positive shoelace), so a
    // reflex vertex has a NEGATIVE cross product at that corner.
    for (var i = 0; i < n; i++) {
      var prev = outline[(i-1+n)%n], curr = outline[i], next = outline[(i+1)%n];
      var ex1 = curr[0]-prev[0], ey1 = curr[1]-prev[1];
      var ex2 = next[0]-curr[0], ey2 = next[1]-curr[1];
      var cross = ex1*ey2 - ey1*ex2;
      if (cross < -1) return curr.slice();
    }
    return null;
  }
  var reflexV = _findReflexVertex();
  function _rotPt(p, pivot, dir){
    var dx = p[0]-pivot[0], dy = p[1]-pivot[1];
    return dir > 0 ? [pivot[0]-dy, pivot[1]+dx] : [pivot[0]+dy, pivot[1]-dx];
  }
  // For each donor, find the PRIMARY receiver face: the wing's
  // long-side face whose gutter shares an endpoint with the reflex
  // vertex (i.e. the wing face that physically sits next to the
  // bridge).  Phantom strips rotate cleanly onto this single face —
  // anything that overflows past the receiver's apex becomes cascade
  // offcut that fills the bridge-junction triangle.
  function _primaryReceiver(donor) {
    if (!reflexV || !donor) return null;
    var best = null;
    faces.forEach(function(f){
      if (f === donor || f.type !== 'long-side') return;
      // Receiver gutter must TOUCH the reflex vertex.
      var touchesReflex = ptEq(f.a, reflexV) || ptEq(f.b, reflexV);
      if (!touchesReflex) return;
      // Receiver gutter must be PERPENDICULAR to donor's gutter
      // (otherwise rotating donor onto it makes no sense).
      var dot = Math.abs(donor.tx*f.tx + donor.ty*f.ty);
      if (dot > 0.3) return;
      if (!best || f.gL > best.gL) best = f;
    });
    return best;
  }
  // Construct the bridge-triangle "face" — the small region near the
  // reflex vertex bounded by the valley, the bridge-hip, and the line
  // back to the reflex vertex.  This region isn't picked up by the
  // gutter-driven face detection because it has no gutter of its own;
  // we synthesise it here so cascade overflow has a place to land.
  function _bridgeTriangle(){
    if (!reflexV) return null;
    // Find the valley line emanating from the reflex vertex.
    var valley = null;
    DRAW.lines.forEach(function(l){
      if (l.type !== 'valley') return;
      if (ptEq(l.pts[0], reflexV)) valley = { far: l.pts[1].slice() };
      else if (ptEq(l.pts[1], reflexV)) valley = { far: l.pts[0].slice() };
    });
    if (!valley) return null;
    var valleyFar = valley.far;
    // Find a 'hip' line that connects to valleyFar — that's the bridge hip.
    var bridgeFar = null;
    DRAW.lines.forEach(function(l){
      if (l.type !== 'hip') return;
      if (ptEq(l.pts[0], valleyFar) && !ptEq(l.pts[1], reflexV)) bridgeFar = l.pts[1].slice();
      else if (ptEq(l.pts[1], valleyFar) && !ptEq(l.pts[0], reflexV)) bridgeFar = l.pts[0].slice();
    });
    if (!bridgeFar) return null;
    return [reflexV.slice(), valleyFar.slice(), bridgeFar.slice()];
  }
  var bridgeTri = _bridgeTriangle();

  // Route phantom strips: rotate, clip cleanly to the primary
  // receiver, and route the overflow to the bridge triangle (if any).
  // Each donor strip's PRIMARY piece replaces a receiver-face slot;
  // the cascade overflow piece (if it exists) sits in the bridge tri
  // with the same seq number.
  var primaryRecvA = _primaryReceiver(mainA);
  var primaryRecvB = _primaryReceiver(mainB);
  function _routePhantom(strip){
    if (!reflexV) return null;
    var primaryRecv = (strip.face === mainA) ? primaryRecvA :
                      (strip.face === mainB) ? primaryRecvB : null;
    if (!primaryRecv) return null;
    // Pick rotation direction that maps the strip's centroid TOWARD
    // the primary receiver.
    var c = strip.centroid;
    var ccw = _rotPt(c, reflexV, +1), cw = _rotPt(c, reflexV, -1);
    var ccwIn = _ptInPoly(ccw[0], ccw[1], primaryRecv.poly);
    var cwIn  = _ptInPoly(cw[0], cw[1], primaryRecv.poly);
    var dir = ccwIn ? +1 : (cwIn ? -1 : null);
    if (!dir) {
      // Centroid landed outside the receiver — but the strip itself
      // (which is bigger than its centroid) may still overlap it.
      // Try both directions; keep the one that yields a non-empty
      // clipped piece on the primary receiver.
      [+1, -1].forEach(function(d){
        if (dir) return;
        var rp = strip.poly.map(function(p){return _rotPt(p, reflexV, d);});
        var cp = clipToConvexPoly(rp, primaryRecv.poly);
        if (cp && cp.length >= 3 && polyArea(cp) > 60) dir = d;
      });
    }
    if (!dir) return null;
    var rotPoly = strip.poly.map(function(p){return _rotPt(p, reflexV, dir);});
    var primary = clipToConvexPoly(rotPoly, primaryRecv.poly);
    if (!primary || primary.length < 3 || polyArea(primary) < 60) return null;
    var pieces = [{ poly: primary, centroid: polyCentroid(primary), face: primaryRecv, area: polyArea(primary) }];
    // Cascade overflow → bridge triangle (if it exists and the rotated
    // strip overlaps it).
    if (bridgeTri) {
      var overflow = clipToConvexPoly(rotPoly, bridgeTri);
      if (overflow && overflow.length >= 3 && polyArea(overflow) > 60) {
        pieces.push({ poly: overflow, centroid: polyCentroid(overflow), face: null, area: polyArea(overflow) });
      }
    }
    return pieces;
  }
  var phantomStrips = allStrips.filter(function(s){return s.isPhantom;});
  var cascadeAdds = [];
  phantomStrips.forEach(function(s){
    var pieces = _routePhantom(s);
    if (!pieces || !pieces.length) { s.isPhantom = false; return; }
    s.poly     = pieces[0].poly;
    s.centroid = pieces[0].centroid;
    s.receiver = pieces[0].face;
    for (var i = 1; i < pieces.length; i++) {
      cascadeAdds.push({
        face: s.face, color: s.color,
        pieceM: s.pieceM, orderedLengthMm: s.orderedLengthMm,
        poly: pieces[i].poly, centroid: pieces[i].centroid,
        isPhantom: true, isCascade: true, cascadeParent: s,
        receiver: pieces[i].face
      });
    }
  });
  cascadeAdds.forEach(function(s){ allStrips.push(s); });
  phantomStrips = allStrips.filter(function(s){return s.isPhantom;});

  // Suppress receiver-face strips that overlap a rotated phantom strip
  // — the phantom donor sheet PHYSICALLY occupies that slot, so the
  // wing's own purple sheet isn't ordered there.
  if (phantomStrips.length) {
    allStrips = allStrips.filter(function(s){
      if (s.isPhantom) return true;
      if (s.face === mainA || s.face === mainB) return true;
      for (var i = 0; i < phantomStrips.length; i++) {
        if (_ptInPoly(s.centroid[0], s.centroid[1], phantomStrips[i].poly)) return false;
      }
      return true;
    });
  }

  // ── Number strips & pair offcuts ──────────────────────────────
  // SOP §8: offcuts can be rotated by 90°/180°/270° but NEVER flipped
  // (corrugation direction must stay correct for water flow). When
  // a sheet on one long-side gets clipped by a hip at its end, the
  // triangular offcut left over can rotate 180° to fit the matching
  // corner on the OPPOSITE long-side. We pair those two pieces by
  // sharing the same sheet reference number so the roofer can see
  // "sheet 5" appears once on top (the source) and once at the
  // matching corner on the bottom (the offcut destination).
  //
  // Pairing rule: for each pair of opposite long-side faces, walk
  // the strips on the donor face in order, find strips that are
  // clipped (the strip's piece length is noticeably shorter than
  // the face's full sheet length), and match each with the
  // corresponding clipped strip at the mirror corner of the
  // receiver face. Mark the receiver strip as offcut-fed so the
  // legend can deduct it from the receiver face's order count.
  function _isClipped(s){
    return s.pieceM < s.face.sheetM * 0.9;
  }
  function _pairOffcuts(donor, receiver){
    if (!donor || !receiver) return;
    var donorStrips = allStrips.filter(function(s){return s.face === donor;});
    var recvStrips  = allStrips.filter(function(s){return s.face === receiver;});
    // Project each strip's centroid onto the donor's along-gutter
    // axis (in image coords). Closest along-axis position wins.
    function alongPos(face, strip){
      var dx = strip.centroid[0] - face.a[0];
      var dy = strip.centroid[1] - face.a[1];
      return dx*face.tx + dy*face.ty;
    }
    var donorClipped = donorStrips.filter(_isClipped);
    var recvClipped  = recvStrips.filter(_isClipped);
    if (!donorClipped.length || !recvClipped.length) return;
    // Donor and receiver gutters likely point in opposite directions
    // for an upside-down long-side. Use the FRACTION along each
    // gutter (0..1) so we can match left↔left and right↔right
    // regardless of direction.
    function frac(face, strip){
      var t = alongPos(face, strip) / face.gL;
      // If the receiver's tangent runs opposite to the donor's, flip
      // the fraction so the same building corner gives the same f.
      return t;
    }
    var sameDir = (donor.tx*receiver.tx + donor.ty*receiver.ty) > 0;
    donorClipped.forEach(function(ds){
      var df = frac(donor, ds);
      // Find the closest still-unmatched receiver clipped strip.
      var best = null, bestD = Infinity;
      recvClipped.forEach(function(rs){
        if (rs._offcutMatched) return;
        var rf = sameDir ? frac(receiver, rs) : (1 - frac(receiver, rs));
        var d  = Math.abs(rf - df);
        if (d < bestD) { bestD = d; best = rs; }
      });
      if (best && bestD < 0.18) {
        best._offcutMatched = true;
        best._offcutSource  = ds;
        ds._offcutDest      = best;
      }
    });
  }
  // _pairOffcuts (orange↔blue cross-pairing) is legacy logic that
  // predates the corner cascade.  It used to bind blue's clipped
  // corner strips to orange's truncated-end strips, but this created
  // chained pairings (blue receiver → blue donor that is itself an
  // offcut of orange) which pass-2 inheritance can't resolve in one
  // step.  With _routePhantom handling wing routing and
  // _pairCornerToHipEnd handling all corner-to-hip-end cascades, it's
  // no longer needed — keep the function defined for clarity but
  // never call it.

  // ── 4-hip corner cascade ──────────────────────────────────────
  // For every hip-end face, its strips are physically OFFCUTS of the
  // adjacent long-side's corner sheets (the sheet is laid on the
  // long-side; the part that overhangs the hip is cut off and
  // rotated 90° onto the hip-end).  We pair each hip-end strip with
  // a clipped long-side corner strip so they share a seq number and
  // no separate hip-end sheets get ordered.
  function _pairCornerToHipEnd(longSide, hipEnd, apex, donorColor) {
    if (!longSide || !hipEnd || !apex) return;
    function distToApex(p){return Math.hypot(p[0]-apex[0], p[1]-apex[1]);}
    var longApexL = longSide.poly[1], longApexR = longSide.poly[2];
    var apexIsL = ptEq(apex, longApexL);
    var otherLongApex = apexIsL ? longApexR : longApexL;
    // Donor strips: long-side corner-zone strips clipped by a hip.  The
    // corner zone is the half of the long-side nearest the gutter corner
    // it SHARES with this hip-end — so the SE-corner sheets feed the E
    // hip-end, the SW-corner sheets feed the W hip-end, etc.  On a
    // rectangular main this equals "nearest this hip-end's ridge apex";
    // on a SQUARE/pyramid main all four slopes meet at one centre apex, so
    // keying off the apex sends BOTH hip-ends the same corner's sheets
    // (they end up swapped).  Keying off the shared gutter corner keeps
    // each hip-end fed by its own adjacent corner.  Donors sorted
    // FURTHEST-from-apex first (corner-most sheet = biggest hip-cut offcut)
    // and receivers CLOSEST-to-apex first, so sheet N body + offcut N
    // reassemble into one full sheet.
    var sharedCorner = null, farCorner = null;
    [longSide.a, longSide.b].forEach(function(c){
      if (ptEq(c, hipEnd.a) || ptEq(c, hipEnd.b)) sharedCorner = c.slice();
      else farCorner = c.slice();
    });
    if (!sharedCorner || !farCorner) { sharedCorner = apex; farCorner = otherLongApex; }
    function distTo(p, q){ return Math.hypot(p[0]-q[0], p[1]-q[1]); }
    var donorStrips = allStrips.filter(function(s){
      if (s.face !== longSide) return false;
      if (donorColor && s.color !== donorColor) return false;
      if (!s.rectArea || s.clipArea >= s.rectArea - 1) return false;
      return distTo(s.centroid, sharedCorner) < distTo(s.centroid, farCorner);
    }).sort(function(a,b){return distToApex(b.centroid) - distToApex(a.centroid);});
    // Receiver strips: hip-end strips on the OPPOSITE side of the
    // (apex → gutter-mid) line from the long-side's gutter midpoint —
    // i.e. north's NW corner offcut crosses the apex line and lands on
    // the SW half of the west hip-end (and vice versa).  Per the
    // roofer's SOP, this is the spin-direction the cascade actually
    // uses.
    var gmid = [(hipEnd.a[0]+hipEnd.b[0])/2, (hipEnd.a[1]+hipEnd.b[1])/2];
    var longMid = [(longSide.a[0]+longSide.b[0])/2, (longSide.a[1]+longSide.b[1])/2];
    var lx = apex[0]-gmid[0], ly = apex[1]-gmid[1];
    function sg(p){ return lx*(p[1]-gmid[1]) - ly*(p[0]-gmid[0]); }
    var longSign = Math.sign(sg(longMid));
    var recvStrips = allStrips.filter(function(s){
      return s.face === hipEnd && !s._offcutMatched && Math.sign(sg(s.centroid)) !== longSign;
    }).sort(function(a,b){return distToApex(a.centroid) - distToApex(b.centroid);});
    var n = Math.min(donorStrips.length, recvStrips.length);
    for (var i = 0; i < n; i++) {
      recvStrips[i]._offcutMatched = true;
      recvStrips[i]._offcutSource  = donorStrips[i];
      // The offcut is physically a piece of the donor sheet, so it
      // takes the donor's colour — orange offcuts on the south-side
      // hip-end halves, blue offcuts on the north-side halves.
      recvStrips[i].color          = donorStrips[i].color;
      donorStrips[i]._offcutDest   = recvStrips[i];
    }
  }
  // North slope of a telescoping main varies in length by section: long over
  // the main, shorter over each wing.  Recolour its sheets by length BEFORE
  // any hip-end cascade — a north sheet matching a wing's uniform sheet size
  // becomes that wing's colour (purple/green); long main + ramp/transition
  // sheets stay orange.  Doing it first means only the orange sheets feed the
  // main's hip-ends (the wing-length sheets aren't main donors), so a main
  // hip-end never sources an offcut from a recoloured wing sheet.
  if (_hasTelesc && _merged) {
    var _wingSheet0 = [];
    faces.forEach(function(wf){
      if (wf === mainA || wf === mainB || wf.type !== 'long-side') return;
      var horiz = Math.abs(wf.a[1]-wf.b[1]) < 4;
      if ((mainAxis === 'h') ? !horiz : horiz) return;        // parallel wings only
      var areas = allStrips.filter(function(s){
        return s.face === wf && s.rectArea && s.clipArea > s.rectArea - 1;
      }).map(function(s){ return s.clipArea; }).sort(function(a,b){ return a-b; });
      if (areas.length) _wingSheet0.push({ area: areas[Math.floor(areas.length/2)], color: wf.color });
    });
    allStrips.forEach(function(s){
      if (s.face !== _merged || s._offcutMatched) return;
      for (var _wj = 0; _wj < _wingSheet0.length; _wj++) {
        if (Math.abs(s.clipArea - _wingSheet0[_wj].area) < _wingSheet0[_wj].area * 0.02) { s.color = _wingSheet0[_wj].color; break; }
      }
    });
  }
  [mainA, mainB].forEach(function(longSide){
    // longSide is always mainA/mainB here.  On a SQUARE main it's a
    // triangular slope (hip-end type) rather than a 4-vertex long-side, so
    // don't require the long-side type — its poly[1] is still the apex.
    if (!longSide) return;
    // Telescoping MERGED slope: its full-span polygon carries the whole stepped
    // ridge, so poly[1]/poly[2] aren't reliable apexes — they flip when the
    // outline winding reverses (mirroring) and mis-match the hip-ends.  Feed it
    // from the wing-ward chain below instead, which keys off gutter corners.
    if (_hasTelesc && longSide === _merged) return;
    var apexL = longSide.poly[1], apexR = longSide.poly[2];
    var _oc = null;
    faces.forEach(function(hipEnd){
      if (hipEnd.type !== 'hip-end') return;
      if (hipEnd === mainA || hipEnd === mainB) return;  // the mains are donors, not receivers
      // hip-end's apex (poly[1] after CCW) is the inland point where
      // the two hips converge.  Match it to the long-side's apex.
      if (ptEq(hipEnd.poly[1], apexL))      _pairCornerToHipEnd(longSide, hipEnd, apexL, _oc);
      else if (ptEq(hipEnd.poly[1], apexR)) _pairCornerToHipEnd(longSide, hipEnd, apexR, _oc);
    });
  });

  // ── Telescoping wing-ward offcut chain ────────────────────────────
  // On a stepped/telescoping main, the donor (main-only) slope's wing-ward
  // sheets are cut and that one offcut set cascades toward the wing tip,
  // filling the MERGED-side part of every step riser plus the ENTIRE outermost
  // wing tip.  (The stepped-side parts of those risers stay the wing colour;
  // this only claims the merged-side strips.)  Expressed in the canonical
  // frame (_cx/_cy) so it works at any rotation/mirror.  Scoped (via
  // _hasTelesc) to outlines with a parallel wing, so L/T/U/double-wing are
  // untouched.
  if (!_tCascade && mainRect && _donorSlope && _hasTelesc) {
    var _mcCx = _cx(_mc);
    var westFaces = faces.filter(function(f){
      if (f === mainA || f === mainB) return false;
      var across = _axisH ? Math.abs(f.a[0]-f.b[0]) < 4 : Math.abs(f.a[1]-f.b[1]) < 4;
      if (!across) return false;
      return _gmidCx(f) < _mcCx;                              // wing-side risers only (low _cx)
    }).sort(function(a,b){ return _gmidCx(a) - _gmidCx(b); }); // outermost (tip) = lowest _cx, first
    if (westFaces.length) {
      var _tip = westFaces[0];
      // One donor offcut runs the full wing-ward width, re-trimmed at each step
      // — so ONE donor sheet feeds one strip on every step (its number repeats
      // across the risers + tip).  Collect each face's MERGED-side receiver
      // strips (the whole outer tip; the merged half of the inner risers),
      // ordered merged→stepped, then assign donor #k to the k-th such strip on
      // EVERY face.  Donor count = the deepest face's row count, not the sum.
      var _mainWf = westFaces[westFaces.length-1];
      var _perFace = westFaces.map(function(f){
        // Split merged/stepped halves at the section RIDGE (apex) level so each
        // offcut set starts at the apex.  The main-W riser's centroid is skewed
        // by its tall exposed wall, so use the main ridge for it.
        var splitCy = (f === _mainWf) ? _cy(_mc) : _cy(f.centroid);
        return allStrips.filter(function(s){
          if (s.face !== f || s._offcutMatched) return false;
          var merged = _cy(s.centroid) < splitCy;             // merged-side half (low _cy)
          return (f === _tip) || merged;
        }).sort(function(a,b){ return _cy(a.centroid) - _cy(b.centroid); });  // merged → stepped
      });
      var donorsW = allStrips.filter(function(s){
        return s.face === _donorSlope && s.rectArea && s.clipArea < s.rectArea - 1 && !s._offcutDest;
      }).sort(function(a,b){ return _cx(b.centroid) - _cx(a.centroid); });   // away-from-wings donor first
      var _maxRows = _perFace.reduce(function(m,a){ return Math.max(m, a.length); }, 0);
      for (var _k = 0; _k < _maxRows; _k++) {
        var _donor = donorsW[_k] || donorsW[donorsW.length-1];
        if (!_donor) break;
        _perFace.forEach(function(ns){
          var s = ns[_k];
          if (!s) return;
          s._offcutMatched = true;
          s._offcutSource  = _donor;
          s.color          = _donor.color;
          if (!_donor._offcutDest) _donor._offcutDest = s;
        });
      }
      // Main's own wing-side hip-end (the deepest such face): the MERGED slope's
      // wing-ward offcuts fill its stepped half (the chain above took its merged
      // half).  Donors restricted to the merged slope's own colour so recoloured
      // wing-length sheets aren't consumed here.
      var _mainW = westFaces[westFaces.length-1];
      var _apexMW = null;
      if (_mainW && _mainW !== _tip && _merged) {
        // The main-W riser is a long-side with TWO ridge apexes; "furthest from
        // gutter-mid" ties between them and flips under mirroring.  Pick the
        // merged-side ridge apex (lowest _cy) deterministically so the feed is
        // orientation-invariant.
        var _bdm = Infinity;
        _mainW.poly.forEach(function(v){
          if (Math.hypot(v[0]-_mainW.a[0],v[1]-_mainW.a[1]) < 4 || Math.hypot(v[0]-_mainW.b[0],v[1]-_mainW.b[1]) < 4) return;
          var cyv = _cy(v); if (cyv < _bdm){ _bdm = cyv; _apexMW = v; }
        });
        if (!_apexMW) {
          var _gmw = [(_mainW.a[0]+_mainW.b[0])/2, (_mainW.a[1]+_mainW.b[1])/2], _bd = -1;
          _mainW.poly.forEach(function(v){ var d = Math.hypot(v[0]-_gmw[0], v[1]-_gmw[1]); if (d > _bd){ _bd = d; _apexMW = v; } });
        }
        _pairCornerToHipEnd(_merged, _mainW, _apexMW, _merged.color);
      }
      // The main's FAR hip-end (the hip on the side away from the wings): also
      // fed by the merged slope's main-portion offcuts.  Excluded from the
      // generic apex-match cascade (merged poly[1] is unreliable), so feed it
      // here too — _pairCornerToHipEnd keys off the shared gutter corner, which
      // is robust to rotation and mirroring.
      var _farHip = faces.filter(function(f){
        return f.type === 'hip-end' && f !== _tip && westFaces.indexOf(f) < 0;
      }).sort(function(a,b){ return _cx(b.centroid) - _cx(a.centroid); })[0];
      if (_farHip && _merged) {
        // A hip-end triangle's apex is its inland convergence vertex = poly[1]
        // (reliable for a 3-vertex face, unlike a furthest-from-gutter test
        // which ties on an isosceles hip).
        _pairCornerToHipEnd(_merged, _farHip, _farHip.poly[1], _merged.color);
      }
      // Inner risers (between the outer tip and the main-W): their stepped-side
      // strips are SECOND pieces re-cut at the valley.  Reuse the chain offcuts
      // that cross the valley (the 2nd/3rd chain donors) and the main-W's first
      // merged-slope offcut, instead of fresh wing sheets.
      var _or1 = null;
      if (_apexMW && _merged) {
        var _mwOr = allStrips.filter(function(s){ return s.face===_mainW && s._offcutMatched && s.color===_merged.color; })
          .sort(function(a,b){ return Math.hypot(a.centroid[0]-_apexMW[0],a.centroid[1]-_apexMW[1]) - Math.hypot(b.centroid[0]-_apexMW[0],b.centroid[1]-_apexMW[1]); });
        if (_mwOr.length) _or1 = _mwOr[0]._offcutSource;
      }
      var _innerSrc = [donorsW[1], donorsW[2], _or1].filter(Boolean);   // chain #7, chain #6, merged #1
      if (_innerSrc.length) westFaces.forEach(function(rf){
        if (rf === _tip || rf === _mainW) return;
        allStrips.filter(function(s){ return s.face===rf && !s._offcutMatched; })
          .sort(function(a,b){ return _cy(a.centroid) - _cy(b.centroid); })  // valley(merged) → stepped
          .forEach(function(s, i){
            var src = _innerSrc[Math.min(i, _innerSrc.length-1)];
            if (!src) return;
            s._offcutMatched = true; s._offcutSource = src; s.color = src.color;
          });
      });
    }
  }

  // ── T-shape: stem south hip-end built from blue cap-S offcuts ──
  // The stem sides are self-contained (their own purple sheets — the wing
  // cascade is skipped above), but the stem's south hip-end is built from
  // the blue cap-S sheets that cross the stem opening: those sheets are
  // cut at the stem valley and their cut-off ends drop down to form the
  // south hip-end rather than ordering fresh sheets for it.  The hip-end's
  // south eave is parallel to the cap eaves, so a blue sheet cut at the
  // valley pairs with the hip-end strip at the same along-eave position.
  // We pair each hip-end strip with the nearest blue cap-S clipped donor
  // strip over the stem span whose offcut isn't already claimed; the
  // hip-end strip inherits the donor's blue seq and drops out of the
  // order count.
  if (_tCascade && mainA) {
    // The cap hip-ends' apexes are ridge vertices shared with cap N
    // (mainA); the stem hip-ends' apexes are not, so pick the hip-ends whose
    // apex is not a vertex of mainA's polygon.  A long-stem T has TWO such
    // hip-ends — the south hip and the north notch (phantom-4-hip top).
    var _stemHips = faces.filter(function(f){ return f.type === 'hip-end'; })
      .filter(function(f){
        return mainA.poly.every(function(v){ return !ptEq(v, f.poly[1]); });
      });
    if (_stemHips.length) {
      // Donor arm = the one with LONGER sheets (L-shape rule): its hip-cut
      // offcuts fill the shorter arm.  Compare the cap (mainA, orange) sheet
      // length against the stem long-sides (purple).  Even / long-cap Ts keep
      // the cap as donor (original behaviour); a long-stem T flips to the stem.
      var _stemLS = faces.filter(function(f){ return f.type==='long-side' && f.color===COL_PURPLE; });
      if (_stemHips.length >= 2) {
        // Two stem hip-ends ⇒ wide-stem T (stem ridge higher than cap ridge):
        // the STEM is the donor phantom 4-hip.  Its long sheets are hip-cut at
        // BOTH the south hip and the north notch, and those offcuts fill each
        // hip-end instead of starving them with the cap's short sheets.  Feed
        // each half of every stem hip-end from its adjacent stem long-side
        // (gutter-corner matching, robust to orientation/mirror).
        _stemHips.forEach(function(hip){
          _stemLS.forEach(function(ls){
            _pairCornerToHipEnd(ls, hip, hip.poly[1], COL_PURPLE);
          });
        });
      } else {
      var _stemHip = _stemHips[0];
      var _ax = mainA.tx, _ay = mainA.ty;
      var _along = function(p){ return p[0]*_ax + p[1]*_ay; };
      var _e0 = _along(_stemHip.poly[0]), _e2 = _along(_stemHip.poly[2]);
      var _sLo = Math.min(_e0, _e2) - 2, _sHi = Math.max(_e0, _e2) + 2;
      var _blueDonors = allStrips.filter(function(s){
        return s.face && s.face.type === 'long-side' && s.face.color === COL_BLUE
          && s.rectArea && s.clipArea < s.rectArea - 1
          && !s._offcutDest
          && _along(s.centroid) >= _sLo && _along(s.centroid) <= _sHi;
      });
      allStrips.filter(function(s){ return s.face === _stemHip; }).forEach(function(rs){
        var rp = _along(rs.centroid), best = null, bd = Infinity;
        _blueDonors.forEach(function(ds){
          if (ds._offcutDest) return;
          var d = Math.abs(_along(ds.centroid) - rp);
          if (d < bd) { bd = d; best = ds; }
        });
        if (best) {
          rs._offcutMatched = true;
          rs._offcutSource  = best;
          rs.color          = best.color;
          best._offcutDest  = rs;
        }
      });
      }
    }
    // The CAP is a 4-hip: fill each of its E/W hip-ends from BOTH adjacent
    // long-sides' corner offcuts, exactly like a plain rectangle's hip-end —
    // the cap-N slope (orange) supplies the half on its side, the cap-S stub
    // (blue) the other half.  The general corner cascade above misses the cap
    // because cap N is wound so its apexes sit at poly[2]/[3], not poly[1]/[2].
    faces.forEach(function(h){
      if (h.type !== 'hip-end' || h.color !== COL_ORANGE) return;
      var apex = h.poly[1];
      faces.forEach(function(ls){
        if (ls.type === 'long-side' && ls.poly.some(function(v){ return ptEq(v, apex); }))
          _pairCornerToHipEnd(ls, h, apex, ls.color);
      });
    });
  }

  // ── L-shape corner-to-wing cascade ────────────────────────────
  // When one of mainA/mainB's apexes is shared with a LONG-SIDE face
  // (the wing's adjacent long-side) instead of a hip-end, the corner
  // sheets at that apex still need a cascade target. Per the SOP
  // (per-roofer demo), the 10 corner sheets nearest the apex donate
  // their offcuts to 10 wing-long-side strips: 5 nearest the shared
  // apex on the wing-long-side (the "lower" group), and 5 nearest
  // the wing's FAR end (the "upper" group).  The roofer cuts each
  // offcut to fit and rotates 90° onto the wing.
  function _pairCornerToWing(longSide, wingFace, sharedApex) {
    if (!longSide || !wingFace || !sharedApex) return;
    function dist(p, q){return Math.hypot(p[0]-q[0], p[1]-q[1]);}
    // Identify which gutter endpoint of longSide is nearest the
    // shared apex — donors are the 10 strips closest to THIS gutter
    // endpoint (the corner side).
    var longGutterNear = (dist(longSide.a, sharedApex) < dist(longSide.b, sharedApex))
                         ? longSide.a : longSide.b;
    var donorStrips = allStrips.filter(function(s){return s.face === longSide;})
      .sort(function(a,b){
        return dist(a.centroid, longGutterNear) - dist(b.centroid, longGutterNear);
      }).slice(0, 10);
    if (!donorStrips.length) return;
    var half = Math.ceil(donorStrips.length / 2);
    var donorsLower = donorStrips.slice(0, half);   // closest to gutter corner = biggest offcuts → lower (near shared apex)
    var donorsUpper = donorStrips.slice(half);      // smaller offcuts → upper (near wing's far gutter end)
    // Wing-long-side face has two ridge apexes — the sharedApex (with
    // longSide) and the wing's "top" apex where the wing's own hips
    // converge.  Project onto wing's along-gutter axis so we can
    // partition wing strips into:
    //   • "mid zone"  — between top apex and shared apex (the section
    //     of the wing-long-side that runs alongside the main, just
    //     above the wing-junction hip).  Lower group receivers live
    //     here.
    //   • "tip zone"  — beyond the top apex (the wing's actual roof
    //     section).  Upper group receivers live here.
    var wingApexes = [wingFace.poly[1], wingFace.poly[2]];
    var wingTopApex = ptEq(wingApexes[0], sharedApex) ? wingApexes[1] : wingApexes[0];
    function gutterProj(p){
      return (p[0]-wingFace.a[0])*wingFace.tx + (p[1]-wingFace.a[1])*wingFace.ty;
    }
    var sharedProj = gutterProj(sharedApex);
    var topProj    = gutterProj(wingTopApex);
    var midLo = Math.min(topProj, sharedProj), midHi = Math.max(topProj, sharedProj);
    var wingStrips = allStrips.filter(function(s){return s.face === wingFace && !s._offcutMatched;});
    var lowerRecv = wingStrips.filter(function(s){
      var p = gutterProj(s.centroid);
      return p >= midLo && p <= midHi;
    }).sort(function(a,b){return dist(a.centroid, sharedApex) - dist(b.centroid, sharedApex);})
      .slice(0, donorsLower.length);
    var lowerSet = new Set(lowerRecv);
    var upperRecv = wingStrips.filter(function(s){
      if (lowerSet.has(s)) return false;
      var p = gutterProj(s.centroid);
      return (topProj < sharedProj) ? (p < topProj) : (p > topProj);
    }).sort(function(a,b){return dist(a.centroid, wingTopApex) - dist(b.centroid, wingTopApex);})
      .slice(0, donorsUpper.length);
    // Reverse upper group order so the LARGEST (most-clipped) of the
    // upper donors pairs with the wing-tip strip nearest the top apex
    // — keeps the donor-N → receiver-N walking sequentially.
    upperRecv.reverse();
    function pair(donors, receivers) {
      var n = Math.min(donors.length, receivers.length);
      for (var i = 0; i < n; i++) {
        receivers[i]._offcutMatched = true;
        receivers[i]._offcutSource  = donors[i];
        receivers[i].color          = donors[i].color;
        donors[i]._offcutDest       = receivers[i];
      }
    }
    pair(donorsLower, lowerRecv);
    pair(donorsUpper, upperRecv);
  }
  // The L-shape wing cascade routes a main long-side's corner offcuts
  // onto an adjacent wing long-side.  For a T it would treat each stem
  // side as a "wing" of the blue cap-S and dump blue offcuts onto it —
  // but per the roofer's SOP each stem side is self-contained (its own
  // sheets, its own valley offcuts feeding its own hip), so skip it.
  if (!_tCascade) [mainA, mainB].forEach(function(longSide){
    if (!longSide || longSide.type !== 'long-side') return;
    // Telescoping merged slope: poly[1]/poly[2] aren't real apexes (they flip
    // under mirroring), so they can spuriously match a wing long-side and dump
    // the full-span slope's offcuts onto it.  Telescoping wings are fed by the
    // wing-ward chain, so skip the merged slope in this L-shape cascade.
    if (_hasTelesc && longSide === _merged) return;
    var apexL = longSide.poly[1], apexR = longSide.poly[2];
    [apexL, apexR].forEach(function(apex){
      // Skip if this apex already paired with a hip-end (4-hip cascade).
      var hasHipEnd = faces.some(function(f){
        return f.type === 'hip-end' && ptEq(f.poly[1], apex);
      });
      if (hasHipEnd) return;
      // Look for a long-side face that shares this apex AND isn't
      // mainA / mainB itself (i.e. the wing's long-side).
      var wingFace = null;
      faces.forEach(function(f){
        if (wingFace) return;
        if (f.type !== 'long-side') return;
        if (f === longSide || f === mainA || f === mainB) return;
        if (ptEq(f.poly[1], apex) || ptEq(f.poly[2], apex)) wingFace = f;
      });
      if (wingFace) _pairCornerToWing(longSide, wingFace, apex);
    });
  });

  // ── L-shape phantom-4th-hip cascade ───────────────────────────
  // The donor long-side (orange in Big-L) extends past the reflex
  // into the wing's column; its strips in that extension are either
  // phantom-flagged or body strips whose centroid sits past the
  // gutter's reflex endpoint.  In the roofer's SOP these 8 strips
  // are CUT TWICE — once at the imaginary "phantom 4th hip" line
  // (the would-be hip of the rectangle if the wing weren't carved
  // out) and once at the valley (the wing's own inner ridge) —
  // producing pieces that fill:
  //   • The wing's MAIN long-side (face 0 in Big-L), at the far end
  //     from the wing's top apex (i.e. the strips adjacent to the
  //     SW main hip).  7 receivers.
  //   • The wing's HIP-END (face 4 in Big-L) — ALL of its strips.
  //     8 receivers.
  // We mark these receivers as cascade offcuts of the orange donor
  // strips so they share seq + colour.
  function _pairPhantomToWing() {
    if (!reflexV) return;
    function dist(p,q){return Math.hypot(p[0]-q[0],p[1]-q[1]);}
    // Donor long-side = the mainA/mainB face whose poly extends past
    // the reflex (has phantom strips or strips in the wing column).
    var donorFace = null;
    [mainA, mainB].forEach(function(f){
      if (donorFace || !f) return;
      var hasPhantom = allStrips.some(function(s){return s.face===f && s.isPhantom;});
      if (hasPhantom) donorFace = f;
    });
    if (!donorFace) return;
    // Inner long-side = long-side face whose gutter touches reflex.
    var innerLS = null;
    faces.forEach(function(f){
      if (innerLS) return;
      if (f === donorFace || f.type !== 'long-side') return;
      if (ptEq(f.a, reflexV) || ptEq(f.b, reflexV)) innerLS = f;
    });
    if (!innerLS) return;
    // Wing's top apex = the ridge end of innerLS opposite the reflex.
    // innerLS.poly is CCW from b; poly[1]=sb.far, poly[2]=sa.far.
    var aIsReflex_inner = ptEq(innerLS.a, reflexV);
    var wingTopApex = aIsReflex_inner ? innerLS.poly[1] : innerLS.poly[2];
    // Wing's hip-end: a hip-end whose apex is wingTopApex.
    var wingHipEnd = null;
    faces.forEach(function(f){
      if (wingHipEnd) return;
      if (f.type !== 'hip-end') return;
      if (ptEq(f.poly[1], wingTopApex)) wingHipEnd = f;
    });
    // Wing's main long-side: long-side touching wingTopApex (not innerLS).
    var wingMainLS = null;
    faces.forEach(function(f){
      if (wingMainLS) return;
      if (f.type !== 'long-side' || f === innerLS || f === donorFace) return;
      if (ptEq(f.poly[1], wingTopApex) || ptEq(f.poly[2], wingTopApex)) wingMainLS = f;
    });
    if (!wingHipEnd || !wingMainLS) return;
    // Identify donors on donorFace: strips with centroid past the reflex
    // (along the donor's gutter direction, past the reflex endpoint).
    var aIsReflex = ptEq(donorFace.a, reflexV);
    var reflexEnd = aIsReflex ? donorFace.a : donorFace.b;
    var farEnd    = aIsReflex ? donorFace.b : donorFace.a;
    var dx = farEnd[0]-reflexEnd[0], dy = farEnd[1]-reflexEnd[1];
    var dlen = Math.hypot(dx, dy); dx /= dlen; dy /= dlen;
    var donors = allStrips.filter(function(s){
      if (s.face !== donorFace) return false;
      var px = s.centroid[0]-reflexEnd[0], py = s.centroid[1]-reflexEnd[1];
      return (px*dx + py*dy) < 0;       // past reflex into wing column
    }).sort(function(a,b){
      // Sort by along-axis projection: most-negative (furthest into
      // wing) first.
      var pa = (a.centroid[0]-reflexEnd[0])*dx + (a.centroid[1]-reflexEnd[1])*dy;
      var pb = (b.centroid[0]-reflexEnd[0])*dx + (b.centroid[1]-reflexEnd[1])*dy;
      return pa - pb;
    });
    if (!donors.length) return;
    // Re-skin wingHipEnd strips first so face-4 sheets enter the
    // pairing as orange long donors (the "big-triangle hip" upper
    // half).  Tag them as a separate seq sub-group so they number
    // 1..8 within orange independent of face-3 body strips.
    allStrips.forEach(function(s){
      if (s.face !== wingHipEnd) return;
      s.color           = donorFace.color;
      s.orderedLengthMm = orderedLengthMm(donorFace.sheetM);
      s.pieceM          = donorFace.sheetM;
      s._seqGroup       = 'wingHipDonor';   // separate seq counter
    });
    // Sort wingHipEnd donors east-to-west along their gutter so seq 1
    // is the westernmost long donor.
    var hipDonors = allStrips.filter(function(s){return s.face === wingHipEnd;})
      .sort(function(a,b){
        var pa = (a.centroid[0]-wingHipEnd.a[0])*wingHipEnd.tx
               + (a.centroid[1]-wingHipEnd.a[1])*wingHipEnd.ty;
        var pb = (b.centroid[0]-wingHipEnd.a[0])*wingHipEnd.tx
               + (b.centroid[1]-wingHipEnd.a[1])*wingHipEnd.ty;
        return pa - pb;
      });
    // Stage 1 cascade: only the 3 wing-column donors closest to the
    // donor-face's gutter (the SW corner of Big-L) produce face-0
    // south offcuts.  The other phantom-extension donors don't yield
    // usable offcuts at the SW corner.
    var wmlsFarGutter = (dist(wingMainLS.a, wingTopApex) > dist(wingMainLS.b, wingTopApex))
                       ? wingMainLS.a : wingMainLS.b;
    var stage1Recv = allStrips.filter(function(s){
      return s.face === wingMainLS && !s._offcutMatched;
    }).sort(function(a,b){
      return dist(a.centroid, wmlsFarGutter) - dist(b.centroid, wmlsFarGutter);
    });
    // Keep only the 3 face-3 donors that physically reach the SW
    // corner (those at the lowest-x in the wing-column extension).
    var stage1Donors = donors.slice(0, 3);
    var stage1FaceMainLS = stage1Recv.slice(0, stage1Donors.length);
    for (var i = 0; i < stage1FaceMainLS.length; i++) {
      stage1FaceMainLS[i]._offcutMatched = true;
      stage1FaceMainLS[i]._offcutSource  = stage1Donors[i];
      stage1FaceMainLS[i].color          = stage1Donors[i].color;
    }
    // Stage 1b: the 2 westernmost wingHipEnd donors (long sheets 1 & 2)
    // produce offcuts that fit the wingMainLS strips JUST SOUTH of the
    // SW apex — the 2 strips between the existing cascade zone and the
    // apex itself.
    var swApex = ptEq(wingMainLS.poly[1], wingTopApex) ? wingMainLS.poly[2] : wingMainLS.poly[1];
    var stage1bRecv = allStrips.filter(function(s){
      return s.face === wingMainLS && !s._offcutMatched;
    }).sort(function(a,b){
      return dist(a.centroid, swApex) - dist(b.centroid, swApex);
    }).slice(0, 2);
    var westHipDonors = hipDonors.slice(0, 2);
    for (var i = 0; i < Math.min(westHipDonors.length, stage1bRecv.length); i++) {
      stage1bRecv[i]._offcutMatched = true;
      stage1bRecv[i]._offcutSource  = westHipDonors[i];
      stage1bRecv[i].color          = westHipDonors[i].color;
    }
    // Re-source any existing innerLS cascade pieces (originally from
    // donorFace phantoms) to point at wingHipEnd donors instead.  Pair
    // by along-axis order — the eastern hipDonors map to the southern
    // innerLS cascade pieces.
    var innerLSPieces = allStrips.filter(function(s){
      return s.face === innerLS && (s.isOffcut || s.isCascade || s._offcutMatched);
    }).sort(function(a,b){
      // Sort by distance from wingTopApex (closer first matches western
      // wingHipEnd donors).  Actually we want east-donor → south-piece,
      // so sort by distance ASCENDING from reflexV.
      function dst(p,q){return Math.hypot(p[0]-q[0],p[1]-q[1]);}
      return dst(b.centroid, reflexV) - dst(a.centroid, reflexV);
    });
    // Pair donor[i] → innerLSPieces[i] using the EAST half of hipDonors
    // (those reach into innerLS area when cut at valley).
    var eastHalf = hipDonors.slice(Math.floor(hipDonors.length/2));
    for (var i = 0; i < Math.min(eastHalf.length, innerLSPieces.length); i++) {
      innerLSPieces[i]._offcutMatched = true;
      innerLSPieces[i]._offcutSource  = eastHalf[i];
      innerLSPieces[i].color          = eastHalf[i].color;
    }
  }
  _pairPhantomToWing();

  // ── Double-wing cascade (skeleton-face shapes) ────────────────────
  // Each wing follows the T-stem logic:
  //  • the wing's side faces use their OWN sheets; the offcuts cut from
  //    their valley sheets (the end that meets the main) fill the hip-
  //    adjacent area of the SAME side face (within-face reuse).
  //  • the wing's hip-end FACE is cut from the main 4-hip sheets — its
  //    strips are offcuts of the nearest main long-side, so they take the
  //    main colour and drop out of the order count rather than ordering
  //    fresh sheets.
  if (_skelFaces && mainA) {
    var _dwClip = function(s){ return s.rectArea && s.clipArea < s.rectArea - 1; };
    var _dwD    = function(p, q){ return Math.hypot(p[0]-q[0], p[1]-q[1]); };
    var _mainPts = (mainA ? mainA.poly : []).concat(mainB ? mainB.poly : []);
    var _sharesMain = function(pt){ return _mainPts.some(function(v){ return ptEq(v, pt); }); };
    var _wingHips = faces.filter(function(f){
      return f.type === 'hip-end' && f !== mainA && f !== mainB && !_sharesMain(f.poly[1]);
    });
    var _wingFaceSet = new Set();
    _wingHips.forEach(function(hip){
      var apex = hip.poly[1];
      // wing side faces meeting at this hip's apex: valley→hip reuse.
      var sides = faces.filter(function(f){
        return f.type === 'long-side' && f !== mainA && f !== mainB
          && f.poly.some(function(p){ return ptEq(p, apex); });
      });
      _wingFaceSet.add(hip);
      sides.forEach(function(s){ _wingFaceSet.add(s); });
      sides.forEach(function(side){
        var clipped = allStrips.filter(function(s){ return s.face === side && _dwClip(s); })
          .sort(function(a, b){ return _dwD(a.centroid, apex) - _dwD(b.centroid, apex); });
        var half = Math.floor(clipped.length / 2);
        if (half < 1) return;
        var recv   = clipped.slice(0, half);                       // nearest hip = receivers
        var donors = clipped.slice(clipped.length - half).reverse(); // farthest (valley) = donors, biggest first
        for (var i = 0; i < half; i++){
          if (recv[i] === donors[i] || recv[i]._offcutMatched || donors[i]._offcutDest) continue;
          recv[i]._offcutMatched = true;
          recv[i]._offcutSource  = donors[i];
          donors[i]._offcutDest  = recv[i];
        }
      });
    });

    // ── West side: the main 4-hip's W hip-end, fragmented by the stems.
    // Same offcut logic as the E hip-end — orange on the half nearer the
    // orange long-side, blue nearer the blue one — except the donor sheets
    // are cut where the wings interrupt them.  West-region faces are those
    // that are neither a main long-side, the main E hip-end (already
    // cascaded), nor any wing face.
    if (mainB) {
      var _isMainHip = function(f){ return f.type === 'hip-end' && _sharesMain(f.poly[1]); };
      var westFaces = faces.filter(function(f){
        return f !== mainA && f !== mainB && !_isMainHip(f) && !_wingFaceSet.has(f);
      });
      // mainA/mainB share the east ridge apex; their other apex is the west one.
      var eApex = mainA.poly.filter(function(p){ return mainB.poly.some(function(q){ return ptEq(p, q); }); })[0];
      var aW = (eApex && ptEq(mainA.poly[1], eApex)) ? mainA.poly[2] : mainA.poly[1];
      var bW = (eApex && ptEq(mainB.poly[1], eApex)) ? mainB.poly[2] : mainB.poly[1];
      // Split receivers by nearest main gutter: north strips take BLUE
      // offcuts, south strips take ORANGE (the corner piece rotates across
      // the apex).
      var _perp = function(s, mn){ return Math.abs((s.centroid[0]-mn.a[0])*mn.ty - (s.centroid[1]-mn.a[1])*mn.tx); };
      var recvA = [], recvB = [];
      westFaces.forEach(function(face){
        allStrips.filter(function(s){ return s.face === face && !s._offcutMatched; }).forEach(function(s){
          (_perp(s, mainA) <= _perp(s, mainB) ? recvA : recvB).push(s);
        });
      });
      // Orange long-side offcuts land on the SOUTH half of the hip-end and
      // blue on the NORTH half (the corner piece rotates across the apex),
      // matching the E hip-end — so the N-half receivers pair with the BLUE
      // long-side and the S-half receivers with the ORANGE one.
      [[recvA, mainB, bW], [recvB, mainA, aW]].forEach(function(pr){
        var mn = pr[1], wApex = pr[2];
        // The corner-most donor sheet has the BIGGEST hip-cut offcut, which
        // fills the longest hip-end slot — the one nearest the apex (the
        // mid-height of the hip-end), NOT the corner.  So pair the
        // corner-most donor with the APEX-most receiver, exactly as the E
        // hip-end (_pairCornerToHipEnd) does.  This mirrors the E hip-end's
        // spin so the offcuts reassemble by pure rotation; sorting receivers
        // corner-first instead would lay them flipped upside-down.
        var recv = pr[0];
        recv.sort(function(a, b){ return _dwD(a.centroid, wApex) - _dwD(b.centroid, wApex); });
        // Donors in sheet-number order: project onto mainA's along-gutter
        // axis — the SAME key the seq pass uses — so donor[i] is sheet i+1.
        // (Distance-to-apex isn't monotonic in sheet number because the apex
        // sits mid-span.)  Apex-most receiver ← sheet 1, walking to the corner.
        var _seqProj = function(s){ return (s.centroid[0]-mainA.a[0])*mainA.tx + (s.centroid[1]-mainA.a[1])*mainA.ty; };
        var donors = allStrips.filter(function(s){ return s.face === mn && _dwClip(s) && !s._offcutDest; })
          .sort(function(a, b){ return _seqProj(a) - _seqProj(b); });
        var n = Math.min(recv.length, donors.length);
        for (var i = 0; i < n; i++){
          recv[i]._offcutMatched = true;
          recv[i]._offcutSource  = donors[i];
          recv[i].color          = mn.color;
          donors[i]._offcutDest  = recv[i];
        }
      });

      // ── Wing hip-end tips ← the main west-hip offcuts, cut AGAIN at the
      // valley.  Each tip strip reuses a west-region offcut (itself a main
      // offcut): the west sheet runs past the valley, is cut there, and the
      // remainder covers the tip — so the tip takes that main sheet's colour
      // and sequence number rather than ordering a fresh sheet.  Chaining to
      // the originating main strip (not the intermediate west strip) keeps
      // the single-pass seq inheritance order-independent.
      var _westMatched = recvA.concat(recvB).filter(function(s){ return s._offcutMatched && s._offcutSource; });
      _wingHips.forEach(function(hip){
        var apex = hip.poly[1];
        allStrips.filter(function(s){ return s.face === hip; })
          .sort(function(a, b){ return _dwD(a.centroid, apex) - _dwD(b.centroid, apex); })
          .forEach(function(s){
            var best = null, bd = Infinity;
            _westMatched.forEach(function(w){
              if (w._tipUsed) return;
              var d = _dwD(w.centroid, s.centroid);
              if (d < bd){ bd = d; best = w; }
            });
            if (!best) return;
            best._tipUsed     = true;
            s._offcutMatched  = true;
            s._offcutSource   = best._offcutSource;  // originating main sheet
            s.color           = best.color;
          });
      });
    }
  }

  // Sequence numbering — paired strips share a number; non-paired
  // strips get fresh numbers, walking left-to-right within colour.
  // Three passes: (1) plain non-offcut strips (donors), (2) offcut-
  // matched strips inherit their donor's seq, (3) cascade pieces
  // inherit their parent's seq.  Pass 1 must complete across ALL
  // colours before pass 2, so a donor in another colour is numbered
  // before its receivers reference it.
  // Group by (color + optional sub-group).  Strips with the same
  // colour but a distinct `_seqGroup` get an independent seq counter
  // — e.g. the wing-hip donors run 1..8 separately from the donor
  // long-side's body 1..N.
  var byColor = {};
  allStrips.forEach(function(s){
    var key = s.color + (s._seqGroup ? '|' + s._seqGroup : '');
    (byColor[key] = byColor[key] || []).push(s);
  });
  // Sort each colour group by projection onto a SHARED canonical axis
  // (mainA's along-gutter direction) so both long-sides number 1..N
  // walking in the SAME direction across the building — e.g. both
  // start at the south hip-corner and end at the north hip-corner.
  // mainA and mainB have anti-parallel gutters, so projecting onto
  // mainA's axis gives a consistent direction for blue as well.
  // Falls back to x-then-y for colours with no long-side (e.g. an
  // L-shape wing).
  Object.keys(byColor).forEach(function(c){
    byColor[c].sort(function(a, b){
      if (mainA) {
        var pa = (a.centroid[0]-mainA.a[0])*mainA.tx +
                 (a.centroid[1]-mainA.a[1])*mainA.ty;
        var pb = (b.centroid[0]-mainA.a[0])*mainA.tx +
                 (b.centroid[1]-mainA.a[1])*mainA.ty;
        return pa - pb;
      }
      return a.centroid[0] - b.centroid[0] || a.centroid[1] - b.centroid[1];
    });
  });
  var nextSeq = 1;
  // Pass 1: number donor / standalone strips.  Sequence counter
  // RESETS per colour so orange and blue both run 1..N — each donor
  // and its matched offcut share that number within their own colour.
  Object.keys(byColor).forEach(function(c){
    nextSeq = 1;
    byColor[c].forEach(function(s){
      if (s.isCascade) return;          // cascade piece — handled in pass 3
      if (s._offcutMatched) return;     // offcut receiver — handled in pass 2
      s.seq = nextSeq++;
    });
  });
  // Pass 2: offcut receivers inherit their donor's seq.
  Object.keys(byColor).forEach(function(c){
    byColor[c].forEach(function(s){
      if (s.isCascade) return;
      if (s._offcutMatched && s._offcutSource && s._offcutSource.seq) {
        s.seq = s._offcutSource.seq;
        s.isOffcut = true;
      } else if (!s.seq) {
        s.seq = nextSeq++;              // fallback if pairing was incomplete
      }
    });
  });
  // Pass 3: cascade pieces inherit parent seq.
  Object.keys(byColor).forEach(function(c){
    byColor[c].forEach(function(s){
      if (s.isCascade && s.cascadeParent && s.cascadeParent.seq) {
        s.seq = s.cascadeParent.seq;
        s.isOffcut = true;
      }
    });
  });

  }  // end of if (!isBigL) — non-Big-L path uses the generic cascade above.

  // ── Big-L branch ──────────────────────────────────────────────
  // Hand-designed sheet layout for the wing-top-left L-shape.
  // Mutates DRAW.lines (removes the bridge hip, extends the main
  // ridge west) and populates `faces` + `allStrips` from scratch.
  var faces, allStrips, mainA, mainB;
  if (isBigL) {
    var bl = bigL;
    var refX = bl.reflex[0], refY = bl.reflex[1];
    var mx0 = bl.main.x0, my0 = bl.main.y0, mx1 = bl.main.x1, my1 = bl.main.y1;
    var wx0 = bl.wing.x0, wy0 = bl.wing.y0, wx1 = bl.wing.x1, wy1 = bl.wing.y1;
    // Main rectangle apexes (4-hip with phantom NW removed):
    //   W-apex at (mx0 + mainHalfHeight, midY), E-apex at (mx1 - mainHalfHeight, midY)
    var mainH = my1 - my0;
    var midY = (my0 + my1) / 2;
    var wApexX = mx0 + mainH / 2;     // 450 for our test case
    var eApexX = mx1 - mainH / 2;     // 650
    var wApex = [wApexX, midY];       // (450, 750)
    var eApex = [eApexX, midY];       // (650, 750)
    // Wing apex (where wing's two N hips meet) and valley far end.
    var wingApex = [(wx0 + wx1) / 2, wy0 + (wx1 - wx0) / 2];   // (250, 250)
    var valleyEnd = [(wx0 + wx1) / 2, refY + (wx1 - wx0) / 2]; // (250, 550)

    // ── Update DRAW.lines ──
    // Remove: bridge hip (valleyEnd → wApex) — formerly (250,550)→(450,750).
    // (The "phantom NW hip" (mx0, refY)→wApex is not actually generated by
    // autoGenerateRoof for this outline, so nothing to remove there.)
    // Add: lower ridge segment (mx0, midY) → wApex — extends main ridge west.
    //      The wing's vertical ridge (wingApex → valleyEnd) is already
    //      produced by autoGenerateRoof.
    DRAW.lines = DRAW.lines.filter(function(l){
      if (l.type !== 'hip' || !l.pts || l.pts.length !== 2) return true;
      var a = l.pts[0], b = l.pts[1];
      // Remove the bridge hip (valleyEnd ↔ wApex)
      var isBridge = (ptEq(a, valleyEnd) && ptEq(b, wApex)) ||
                     (ptEq(a, wApex) && ptEq(b, valleyEnd));
      return !isBridge;
    });
    // Add the lower ridge extension — but only if not already present
    // (renderRoofSheetPlan may run multiple times per page load).
    var lowerRidgeExists = DRAW.lines.some(function(l){
      if (l.type !== 'ridge' || !l.pts || l.pts.length !== 2) return false;
      var a = l.pts[0], b = l.pts[1];
      return (Math.abs(a[0]-mx0) < 1 && Math.abs(a[1]-midY) < 1 &&
              Math.abs(b[0]-wApex[0]) < 1 && Math.abs(b[1]-midY) < 1) ||
             (Math.abs(b[0]-mx0) < 1 && Math.abs(b[1]-midY) < 1 &&
              Math.abs(a[0]-wApex[0]) < 1 && Math.abs(a[1]-midY) < 1);
    });
    if (!lowerRidgeExists) {
      DRAW.lines.push({ type: 'ridge', pts: [[mx0, midY], [wApex[0], midY]] });
    }

    // ── Constants ──
    var coverPxL  = coverPx;
    // All rainbow donor sheets render in main-N orange — the donor
    // identity is conveyed by the shared seq number on each piece,
    // not by colour.  (Each donor sheet originates on the main's N
    // long-side, which is orange.)
    function _faceMakeNS(a, b, perpPx, color, type){
      // Build a face whose gutter runs a→b, with inward perpendicular
      // pointing away from the gutter into the face interior.  Returns
      // a face-shaped object compatible with the canvas + legend code.
      var gdx = b[0]-a[0], gdy = b[1]-a[1];
      var gL  = Math.sqrt(gdx*gdx + gdy*gdy);
      var tx = gdx/gL, ty = gdy/gL;
      var nx = -ty, ny = tx;  // 90° CCW perpendicular
      var poly = [a.slice(), b.slice(), [b[0]+perpPx*nx, b[1]+perpPx*ny], [a[0]+perpPx*nx, a[1]+perpPx*ny]];
      var cent = polyCentroid(poly);
      return {
        poly:   poly,
        type:   type || 'long-side',
        a: a, b: b, gL: gL,
        tx: tx, ty: ty, nx: nx, ny: ny,
        perpPx: perpPx,
        planSheetM: perpPx * effectiveScale,
        sheetM:     perpPx * effectiveScale * pitchFactor,
        area: polyArea(poly),
        centroid: cent,
        color: color
      };
    }
    function _faceFromPoly(poly, a, b, perpPx, color, type){
      var gdx = b[0]-a[0], gdy = b[1]-a[1];
      var gL  = Math.sqrt(gdx*gdx + gdy*gdy);
      return {
        poly:   poly,
        type:   type || 'long-side',
        a: a, b: b, gL: gL,
        tx: gdx/gL, ty: gdy/gL,
        nx: -gdy/gL, ny: gdx/gL,
        perpPx: perpPx,
        planSheetM: perpPx * effectiveScale,
        sheetM:     perpPx * effectiveScale * pitchFactor,
        area: polyArea(poly),
        centroid: polyCentroid(poly),
        color: color
      };
    }

    // ── Face objects (used by the legend's per-face breakdown) ──
    var faceMainN = _faceFromPoly(
      [[wApexX, midY], [eApexX, midY], [mx1, my0], [mx0, my0]],
      [mx0, my0], [mx1, my0], (mainH/2), COL_ORANGE, 'long-side');
    var faceMainS = _faceFromPoly(
      [[mx1, my1], [mx0, my1], [wApexX, midY], [eApexX, midY]],
      [mx1, my1], [mx0, my1], (mainH/2), COL_BLUE, 'long-side');
    var faceMainE = _faceFromPoly(
      [[mx1, my0], [mx1, my1], [eApexX, midY]],
      [mx1, my0], [mx1, my1], (mx1 - eApexX), COL_BLUE, 'hip-end');
    var faceMainW = _faceFromPoly(
      [[mx0, midY], [mx0, my1], [wApexX, midY]],
      [mx0, midY], [mx0, my1], (mainH/2), COL_BLUE, 'hip-end');
    var faceMainSW = _faceFromPoly(
      [[mx0, my1], [wApexX, midY], [mx0, midY]],
      [mx0, my1], [mx0, midY], (mainH/2), COL_BLUE, 'hip-end');
    // Wing faces
    var faceWingW = _faceFromPoly(
      [[wx0, wy1], [wx0, wy0], [wingApex[0], wingApex[1]], [wingApex[0], valleyEnd[1]]],
      [wx0, wy1], [wx0, wy0], (wx1 - wx0)/2, COL_PURPLE, 'long-side');
    var faceWingE = _faceFromPoly(
      [[wingApex[0], wingApex[1]], [wx1, wy0], [wx1, refY], [refX, refY], [valleyEnd[0], valleyEnd[1]]],
      [wx1, wy0], [wx1, refY], (wx1 - wx0)/2, COL_PURPLE, 'long-side');
    var faceWingN = _faceFromPoly(
      [[wx0, wy0], [wx1, wy0], [wingApex[0], wingApex[1]]],
      [wx0, wy0], [wx1, wy0], (wx1 - wx0)/2, COL_PURPLE, 'hip-end');

    faces = [faceMainN, faceMainS, faceMainW, faceMainE, faceMainSW,
             faceWingW, faceWingE, faceWingN];
    // Dedupe the W/SW pair if they share area (they do in this geometry).
    // Keep faceMainW only; remove faceMainSW from `faces` to avoid
    // duplicate legend entries (the SW is filled by rotated donor offcuts).
    faces = faces.filter(function(f){return f !== faceMainSW;});
    mainA = faceMainN;
    mainB = faceMainS;
    // Collect strips into draw-ordered groups so rainbow donor pieces
    // land ON TOP of the purple wing-N offcuts in the canvas.
    var stripsBase   = [];   // main rect + face fills (drawn first)
    var stripsWing   = [];   // wing purple sheets + valley offcuts
    var stripsBlueMv = [];   // wing W moved-blue offcuts
    var stripsDonors = [];   // rainbow donor pieces (drawn last → on top)
    allStrips = [];

    // ── Donor cascade (D1..D10) ──
    // Each donor is a vertical strip of width coverPx on the main's N
    // long-side, starting at x = mx0.  D1..D8 (x_mid < 400) "fit the
    // wing" — their north piece translates to the wing's N hip-end,
    // they may have a middle piece in the chunk, and a south piece
    // rotates 90° CCW onto the SW corner.  D9..D10 don't fit the wing.
    //
    // Cascade geometry (parameterised so any Big-L proportions work):
    //   - phantom NW hip line:  y = x + phantomHipB     (slope +1)
    //   - valley line:          y = valleyA - x         (slope -1)
    var phantomHipB = refY - mx0;     // intercept of phantom NW hip
    var valleyA    = refX + refY;     // x+y on the valley line
    // Number of donor columns: enough so the cascade reaches past
    // wApex (the donor at index nDonors-1 either straddles or sits
    // east of wApex).  For canonical Big-L this gives 10; for wider
    // wings (or smaller mains) it scales up.
    // The donor cascade covers columns out to the main's W apex; it fills
    // the wing N hip-end WEST of the apex and the main W hip-end reuse.
    // The wing N hip-end EAST of the W apex is handled in the main-N strip
    // loop, where each piece pairs (shares a seq) with the long main-N
    // donor sheet whose offcut it is.
    var nMainDonors = Math.max(1, Math.ceil((wApexX - mx0) / coverPxL));
    var nDonors = nMainDonors;
    function _seqFromCounter(){ /* placeholder, seq is assigned later */ }
    var donorSeqs = [];  // donor index → seq number
    for (var di = 0; di < nDonors; di++) {
      var x0 = mx0 + coverPxL * di;
      var x1 = mx0 + coverPxL * (di+1);
      var xMid = (x0 + x1) / 2;
      var hasValley = (xMid > wx1 - (wx1 - wx0) / 2 - 0.5 + (wx1 - wx0)) ? false : (xMid >= valleyEnd[0] && xMid <= wx1);
      // Equivalent simpler check using the spec: x_mid ∈ [250, 400]
      hasValley = (xMid >= valleyEnd[0] && xMid <= wx1);
      // A column that STARTS within the wing contributes a wing N
      // hip-end piece (clamped to wx1); a column fully east of the wing
      // is a pure main-N column handled by the main-N strips east loop.
      var fitsWing = (x0 < wx1 - 0.5);
      var donorColor = COL_ORANGE;
      // Pure main-N column east of the wing AND east of where the main-N
      // strips loop begins → skip (the east loop covers it; emitting here
      // would double-cover).
      if (!fitsWing && x0 >= mx0 + nMainDonors * coverPxL - 0.5) continue;
      // North piece placement.
      //  • fitsWing columns: the donor's slice of the WING N hip-end — a
      //    clean vertical strip from the wing N gutter (wy0) down to the
      //    bounding wing hip.  hipY(x) = wy0 + min(x-wx0, wx1-x): zero at
      //    the wing's side edges, peaking at the wing apex.  This tiles
      //    the N hip-end for ANY wing width (the old phantom-hip/valley
      //    bound only matched a wing that fit inside the main's W hip-end).
      //  • non-fitsWing columns (east of the wing): the north piece stays
      //    on the main N face, bounded by the phantom NW hip / ridge.
      // Donor wing pieces stop at the W apex; the wing N hip-end east of
      // the apex is filled (and seq-paired) by the main-N strip loop.
      var northPlaced;
      var _wingRx = Math.min(x1, wx1, wApexX);
      if (fitsWing && _wingRx > Math.max(x0, wx0) + 0.5) {
        var lx = Math.max(x0, wx0), rx = _wingRx;
        var apX = wingApex[0], apY = wingApex[1];
        var lyB = wy0 + Math.min(lx - wx0, wx1 - lx);
        var ryB = wy0 + Math.min(rx - wx0, wx1 - rx);
        if (lx < apX && rx > apX)
          northPlaced = [[lx, wy0], [rx, wy0], [rx, ryB], [apX, apY], [lx, lyB]];
        else
          northPlaced = [[lx, wy0], [rx, wy0], [rx, ryB], [lx, lyB]];
      } else if (x1 <= wApexX) {
        northPlaced = [[x0, refY], [x1, refY], [x1, x1 + phantomHipB], [x0, x0 + phantomHipB]];
      } else if (x0 < wApexX && x1 > wApexX) {
        northPlaced = [[x0, refY], [x1, refY], [x1, midY], [wApexX, midY], [x0, x0 + phantomHipB]];
      } else {
        northPlaced = [[x0, refY], [x1, refY], [x1, midY], [x0, midY]];
      }
      var nCent = polyCentroid(northPlaced);
      // The donor's PRIMARY (counted) piece is its largest piece — use
      // the north piece for simplicity.  All other pieces from this
      // donor are offcuts.
      var donorPrimary = {
        face: faceMainN, color: donorColor,
        poly: northPlaced, centroid: nCent,
        orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
        pieceM: faceMainN.sheetM,
        isOffcut: false, isPhantom: false,
        _donorIdx: di
      };
      stripsDonors.push(donorPrimary);
      donorSeqs.push(donorPrimary);
      // Middle piece (only when has_valley AND west of the main W apex,
      // where the phantom NW hip line is defined).
      if (hasValley && x1 <= wApexX + 0.5) {
        var midPoly = [[x0, valleyA - x0], [x1, valleyA - x1], [x1, x1 + phantomHipB], [x0, x0 + phantomHipB]];
        // Middle stays in chunk (no translation); but mid-piece is
        // in the area below wing & above ridge — that's the
        // "Main W hip-end UPPER" zone (y in [400, 750], x near valley).
        stripsDonors.push({
          face: faceMainN, color: donorColor,
          poly: midPoly, centroid: polyCentroid(midPoly),
          orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
          pieceM: faceMainN.sheetM,
          isOffcut: true, isPhantom: false,
          _donorIdx: di
        });
      }
      // South piece.
      var southPoly = null;
      if (x1 <= wApexX) {
        southPoly = [[x0, x0 + phantomHipB], [x1, x1 + phantomHipB], [x1, midY], [x0, midY]];
      } else if (x0 < wApexX && x1 > wApexX) {
        southPoly = [[x0, x0 + phantomHipB], [wApexX, midY], [x0, midY]];
      }
      if (southPoly) {
        // Rotate 90° CCW around (mx0, midY): (x,y) → (mx0 - (y - midY), midY + (x - mx0))
        var rotated = southPoly.map(function(p){
          return [mx0 - (p[1] - midY), midY + (p[0] - mx0)];
        });
        // Clip to building outline (in particular, to SW hip-end region).
        var swClipped = clipToConvexPoly(rotated,
          [[mx0, my1], [wApexX, midY], [mx0, midY]]);
        if (swClipped && swClipped.length >= 3 && polyArea(swClipped) > 1) {
          stripsDonors.push({
            face: faceMainW, color: donorColor,
            poly: swClipped, centroid: polyCentroid(swClipped),
            orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
            pieceM: faceMainN.sheetM,
            isOffcut: true, isPhantom: false,
            _donorIdx: di
          });
        }
      }
    }

    // ── Main N long-side strips east of D10 ──
    // From x = mx0 + 10*coverPx to eApex (and beyond to mx1, but those
    // are cut by the NE hip).
    // Where the main-N strips begin.  For a NARROW wing the donor columns
    // near the W apex are non-fitsWing and cover the main N proper out to
    // the cover-aligned column edge, so start there.  For a WIDE wing
    // (wx1 east of the W apex) those columns feed the wing instead, so the
    // main N proper is exposed right from the W apex — start exactly there.
    var nStartX = (wx1 > wApexX + 0.5) ? wApexX : (mx0 + nMainDonors * coverPxL);
    // Where the wing's E face dips below the wing/main junction (columns
    // x ∈ [wingApex_x, wx1]) the main-N strip top follows the valley line
    // y = valleyA - x rather than the main's N gutter (my0); the wing
    // E-face sheets cover everything north of the valley there.
    function _nTop(xx){
      if (xx >= wingApex[0] - 0.5 && xx <= wx1 + 0.5) return Math.max(my0, valleyA - xx);
      return my0;
    }
    var x = nStartX;
    var _epIdx = 0;  // pairs a main-N donor with the wing N hip-end offcut
    while (x < mx1 - 0.1) {
      var xa = x, xb = Math.min(x + coverPxL, mx1);
      var ntA = _nTop(xa), ntB = _nTop(xb);
      // North strip from its top (gutter or valley) down to ridge (midY)
      // if x in middle, or NE hip (y = -x + (mx1 + midY)) if x > eApex.
      var poly;
      if (xb <= eApexX) {
        poly = [[xa, ntA], [xb, ntB], [xb, midY], [xa, midY]];
      } else if (xa >= eApexX) {
        // East of E-apex, bounded by NE hip from (mx1, my0)→eApex.
        // Hip line: y = (mx1 + my0) - x   (slope -1, intercept mx1+my0)
        var yhiA = Math.min(midY, (mx1 + my0) - xa);
        var yhiB = Math.min(midY, (mx1 + my0) - xb);
        poly = [[xa, my0], [xb, my0], [xb, yhiB], [xa, yhiA]];
      } else {
        // Straddle E-apex
        poly = [[xa, my0], [xb, my0], [xb, (mx1 + my0) - xb], [eApexX, midY], [xa, midY]];
      }
      // Wing N hip-end offcut: the part of THIS main-N donor sheet that
      // runs north past the junction into the wing (east of the W apex,
      // bounded by the wing's NE hip).  It is the SAME physical sheet as
      // the main-N strip, so it shares its seq.  Total length is exactly
      // one main-N sheet (main part + wing offcut), so a long main donor
      // leaves a short wing offcut and vice-versa.
      var wofcLx = Math.max(xa, wApexX), wofcRx = Math.min(xb, wx1);
      var wOfc = null, pairIdx = -1;
      if (wofcRx > wofcLx + 0.5) {
        wOfc = [[wofcLx, wy0], [wofcRx, wy0],
                [wofcRx, wy0 + (wx1 - wofcRx)], [wofcLx, wy0 + (wx1 - wofcLx)]];
        pairIdx = _epIdx++;
      }
      if (polyArea(poly) > 1) {
        var mnStrip = {
          face: faceMainN, color: COL_ORANGE,
          poly: poly, centroid: polyCentroid(poly),
          orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
          pieceM: faceMainN.sheetM,
          isOffcut: false, isPhantom: false
        };
        if (wOfc) mnStrip._eastPairIdx = pairIdx;
        stripsBase.push(mnStrip);
      }
      if (wOfc && polyArea(wOfc) > 1) {
        stripsDonors.push({
          face: faceMainN, color: COL_ORANGE,
          poly: wOfc, centroid: polyCentroid(wOfc),
          orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
          pieceM: faceMainN.sheetM,
          isOffcut: true, isPhantom: false,
          _eastPairIdx: pairIdx
        });
      }
      x += coverPxL;
    }

    // ── Main S long-side strips (full width) ──
    x = mx0;
    while (x < mx1 - 0.1) {
      var xa = x, xb = Math.min(x + coverPxL, mx1);
      // South strip from top boundary down to my1 (S gutter).
      // Top boundary depends on x range:
      //   x <= wApexX:    SW hip line y = -x + (wApexX + midY) = -x + 1200
      //   wApexX < x < eApexX: ridge y = midY
      //   x >= eApexX:    SE hip y = x + (midY - eApexX) = x + 100
      var topA, topB;
      function topAt(xx){
        if (xx <= wApexX) return (wApexX + midY) - xx;
        if (xx >= eApexX) return xx + (midY - eApexX);
        return midY;
      }
      topA = topAt(xa); topB = topAt(xb);
      var poly;
      if (xb <= wApexX) {
        poly = [[xa, topA], [xb, topB], [xb, my1], [xa, my1]];
      } else if (xa < wApexX && xb > wApexX) {
        poly = [[xa, topA], [wApexX, midY], [xb, topB], [xb, my1], [xa, my1]];
        // For xb in (wApexX, eApexX], topB = midY
        poly = [[xa, topA], [wApexX, midY], [xb, midY], [xb, my1], [xa, my1]];
      } else if (xa >= wApexX && xb <= eApexX) {
        poly = [[xa, midY], [xb, midY], [xb, my1], [xa, my1]];
      } else if (xa < eApexX && xb > eApexX) {
        poly = [[xa, midY], [eApexX, midY], [xb, topB], [xb, my1], [xa, my1]];
      } else {
        poly = [[xa, topA], [xb, topB], [xb, my1], [xa, my1]];
      }
      if (polyArea(poly) > 1) {
        stripsBase.push({
          face: faceMainS, color: COL_BLUE,
          poly: poly, centroid: polyCentroid(poly),
          orderedLengthMm: orderedLengthMm(faceMainS.sheetM),
          pieceM: faceMainS.sheetM,
          isOffcut: false, isPhantom: false
        });
      }
      x += coverPxL;
    }

    // ── Main W hip-end UPPER (blue offcuts paired with BS donors) ──
    // Horizontal strips at y in [550, 750].  Each strip is an OFFCUT of
    // a south long-side BS donor at a SW-hip-clipped column: the BS
    // donor's leftover (after the SW hip cut) is rotated into this
    // W hip-end position.  Marked isOffcut so it doesn't count toward
    // the order — the BS donor it pairs with is the counted sheet.
    var wUpperY0 = valleyEnd[1];  // 550
    var wUpperY1 = midY;          // 750
    var y = wUpperY0;
    while (y < wUpperY1 - 0.1) {
      var ya = y, yb = Math.min(y + coverPxL, wUpperY1);
      // Right edge: phantom NW hip line x = y - 300
      var xEastA = ya - (refY - mx0);
      var xEastB = yb - (refY - mx0);
      if (xEastA > mx0 + 0.1) {
        var poly = [[mx0, ya], [xEastA, ya], [xEastB, yb], [mx0, yb]];
        stripsBase.push({
          face: faceMainW, color: COL_BLUE,
          poly: poly, centroid: polyCentroid(poly),
          orderedLengthMm: orderedLengthMm(faceMainW.sheetM),
          pieceM: faceMainW.sheetM,
          isOffcut: true, isPhantom: false,
          _wUpperLongerIdx: Math.round((y - wUpperY0) / coverPxL)
        });
      }
      y += coverPxL;
    }

    // ── Wing W long-side UPPER half (moved-short-strips) ──
    // The shorter W hip-end upper strips (y in [refY, valleyEnd[1]]) are
    // conceptually MOVED to the wing's NW area by translating dy =
    // wy0 - refY.  Their right edge follows the wing's NW hip, which runs
    // from (wx0, wy0) to wingApex at slope +1: x = wx0 + (y - wy0).  Left
    // edge is the W eave (mx0 == wx0).  (The earlier code hardcoded x = y,
    // valid only when wx0 == wy0 — i.e. the canonical test placement; that
    // mis-placed the offcut for any other position, including rotated
    // orientations where canonicalisation gives wx0 != wy0.)
    // Mark isOffcut (these reuse material from the longer strips above).
    y = refY;
    while (y < valleyEnd[1] - 0.1) {
      var ya = y, yb = Math.min(y + coverPxL, valleyEnd[1]);
      var dy = wy0 - refY;
      var ya2 = ya + dy, yb2 = yb + dy;
      var poly = [[mx0, ya2], [wx0 + (ya2 - wy0), ya2],
                  [wx0 + (yb2 - wy0), yb2], [mx0, yb2]];
      if (polyArea(poly) > 1) {
        stripsBlueMv.push({
          face: faceWingW, color: COL_BLUE,
          poly: poly, centroid: polyCentroid(poly),
          orderedLengthMm: orderedLengthMm(faceMainW.sheetM),
          pieceM: faceMainW.sheetM,
          isOffcut: true, isPhantom: false
        });
      }
      y += coverPxL;
    }

    // ── Wing W face LOWER (NEW short sheets, purple) ──
    // Horizontal sheets covering the W face from the wing apex level down
    // to the valley end, x in [wx0, wingApex_x].  These COUNT toward the
    // order.  The W face ABOVE the apex level (the NW-hip triangle) is the
    // moved-blue offcut zone; the two meet exactly at wingApex[1], so the
    // purple starts there for ANY wing height (a taller wing simply has
    // more rows; the N hip-end above is filled by donor sheets).
    var wingLeftY0 = wingApex[1];
    var wingLeftY1 = valleyEnd[1];                 // 550
    var wingPerpPx = wingApex[0] - wx0;            // 150 (half wing width)
    y = wingLeftY0;
    while (y < wingLeftY1 - 0.1) {
      var ya = y, yb = Math.min(y + coverPxL, wingLeftY1);
      var poly = [[wx0, ya], [wingApex[0], ya], [wingApex[0], yb], [wx0, yb]];
      stripsWing.push({
        face: faceWingW, color: COL_PURPLE,
        poly: poly, centroid: polyCentroid(poly),
        orderedLengthMm: orderedLengthMm(wingPerpPx * effectiveScale * pitchFactor),
        pieceM: wingPerpPx * effectiveScale * pitchFactor,
        isOffcut: false, isPhantom: false
      });
      y += coverPxL;
    }

    // ── Wing E face (NEW short sheets, purple) ──
    // Tile the whole E face with horizontal sheets, each clipped to the
    // convex E-face polygon.  Clipping handles the NE-hip upper triangle
    // (above the wing apex), the rectangular body, and the valley cut on
    // the lower-east — for ANY wing width.  Starts at the wing N gutter so
    // the E-eave-top triangle is covered.
    var _wingEPoly = faceWingE.poly;
    y = wy0;
    while (y < valleyEnd[1] - 0.1) {
      var ya = y, yb = Math.min(y + coverPxL, valleyEnd[1]);
      var band = [[wingApex[0], ya], [wx1, ya], [wx1, yb], [wingApex[0], yb]];
      var clip = clipToConvexPoly(band, _wingEPoly);
      if (clip && clip.length >= 3 && polyArea(clip) > 1) {
        stripsWing.push({
          face: faceWingE, color: COL_PURPLE,
          poly: clip, centroid: polyCentroid(clip),
          orderedLengthMm: orderedLengthMm(wingPerpPx * effectiveScale * pitchFactor),
          pieceM: wingPerpPx * effectiveScale * pitchFactor,
          isOffcut: false, isPhantom: false
        });
      }
      y += coverPxL;
    }

    // ── Main E hip-end (with swapped colors per spin-only rule) ──
    // Upper half (y < midY): BLUE offcuts; lower half (y >= midY): ORANGE
    // offcuts.  Horizontal strips perpendicular to E gutter (x = mx1).
    // West boundary: NE hip (above) or SE hip (below); but the NE hip
    // is y = (mx1 + midY) - x (slope -1 from (mx1,my0) to eApex), so
    // x_west = (mx1 + midY) - y.  SE hip is y = x + (midY - eApexX)
    // (slope +1 from eApex to (mx1, my1)), so x_west = y - (midY - eApexX) = y - 100.
    // Both bottom out at x = eApexX.
    y = my0;
    while (y < my1 - 0.1) {
      var ya = y, yb = Math.min(y + coverPxL, my1);
      var isUpper = (yb <= midY + 0.1);
      var isLower = (ya >= midY - 0.1);
      function eHipXWestUpper(yy){ return Math.max(eApexX, (mx1 + my0) - yy); }
      function eHipXWestLower(yy){ return Math.max(eApexX, yy - (midY - eApexX)); }
      var poly, color;
      if (isUpper) {
        var xwA = eHipXWestUpper(ya), xwB = eHipXWestUpper(yb);
        poly = [[xwA, ya], [mx1, ya], [mx1, yb], [xwB, yb]];
        color = COL_BLUE;
      } else if (isLower) {
        var xwA = eHipXWestLower(ya), xwB = eHipXWestLower(yb);
        poly = [[xwA, ya], [mx1, ya], [mx1, yb], [xwB, yb]];
        color = COL_ORANGE;
      } else {
        // Straddle midY — split: rare case, just use upper for now.
        var xwA = eHipXWestUpper(ya), xwB = eHipXWestLower(yb);
        poly = [[xwA, ya], [mx1, ya], [mx1, yb], [xwB, yb]];
        color = COL_BLUE;
      }
      if (polyArea(poly) > 1) {
        stripsBase.push({
          face: faceMainE, color: color,
          poly: poly, centroid: polyCentroid(poly),
          orderedLengthMm: orderedLengthMm(faceMainN.sheetM),
          pieceM: faceMainN.sheetM,
          isOffcut: true, isPhantom: false
        });
      }
      y += coverPxL;
    }

    // Concatenate groups in desired DRAW ORDER so the rainbow donor
    // pieces visually overlay the purple wing offcuts where they
    // share a region (e.g. the wing N hip-end).
    allStrips = stripsBase.concat(stripsWing, stripsBlueMv, stripsDonors);

    // ── Sequence numbering (sheet-identity based) ──
    // Each physical sheet gets one seq number, shared across all its
    // pieces.  Numbers are global 1..N in reading order (top-to-bottom,
    // then left-to-right).  Multi-piece sheets:
    //   - Rainbow donors (D1..D10): _donorIdx identifies the sheet.
    //   - PR + PN purple pair: keyed by yMax (PN's yMax + |dy|).
    //   - BS-SW donor + BN/BW offcut pair: keyed by SW col index.
    //   - BS-SE donor + BE offcut pair: keyed by SE col index.
    //   - ON-SE donor + OE offcut pair: keyed by SE col index.
    var _wingApexY = wy0 + (wx1 - wx0) / 2;
    var _firstSeColIdx = Math.floor((eApex[0] - mx0) / coverPxL) + 1;
    function _sheetKey(s) {
      if (s._donorIdx !== undefined) return 'D' + s._donorIdx;
      if (s._eastPairIdx !== undefined && s._eastPairIdx >= 0) return 'EP' + s._eastPairIdx;
      var ft = s.face && s.face.type;
      var xs = s.poly.map(function(p){return p[0];});
      var ys = s.poly.map(function(p){return p[1];});
      var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
      var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
      var xMid = (xMin + xMax) / 2;
      var cp = coverPxL;
      if (s.color === COL_PURPLE) {
        if (yMax < _wingApexY + 1) return 'PR-' + Math.round(yMax + (refY - wy0));
        if (xMid < (wx0 + wx1) / 2) return 'PL-' + Math.round(yMax);
        return 'PR-' + Math.round(yMax);
      }
      if (s.color === COL_BLUE) {
        if (yMax <= _wingApexY + 1 && xMin <= mx0 + 0.5 && ft === 'long-side') {
          var idx = Math.round((yMin - wy0) / cp);
          return 'BS-SW-' + (8 - idx);
        }
        if (yMin >= valleyEnd[1] - 1 && yMax <= midY + 1 && xMin <= mx0 + 0.5 && ft === 'hip-end') {
          var idx = Math.round((yMin - valleyEnd[1]) / cp);
          if (idx <= 4) return 'BS-SW-' + (4 - idx);
          return 'BW-narrow-' + Math.round(yMin);
        }
        if (ft === 'hip-end' && xMax >= mx1 - 1 && yMin < midY) {
          var idx = Math.round((yMin - my0) / cp);
          if (idx >= 0 && idx <= 8) return 'BS-SE-' + idx;
          return 'BE-straddle-' + Math.round(yMin);
        }
        if (ft === 'long-side' && yMax > my1 - 1) {
          var col = Math.round((xMin - mx0) / cp);
          if (col >= 0 && col <= 8) return 'BS-SW-' + col;
          var seJ = col - _firstSeColIdx;
          if (seJ >= 0) return 'BS-SE-' + seJ;
          return 'BS-full-' + col;
        }
      }
      if (s.color === COL_ORANGE) {
        if (ft === 'hip-end' && xMax >= mx1 - 1 && yMin >= midY) {
          var idx = Math.round((yMin - (midY + cp)) / cp);
          if (idx >= 0 && idx <= 8) return 'ON-SE-' + (8 - idx);
          return 'OE-' + Math.round(yMin);
        }
        if (ft === 'long-side' && yMin <= my0 + 1) {
          var col = Math.round((xMin - mx0) / cp);
          var seJ = col - _firstSeColIdx;
          if (seJ >= 0) return 'ON-SE-' + seJ;
          return 'ON-' + col;
        }
      }
      return s.color + '-' + Math.round(s.centroid[0]) + '-' + Math.round(s.centroid[1]);
    }
    // Number sheets 1..N PER COLOUR (not a single global 1..total run
    // interleaved across colours).  Each physical sheet = one _sheetKey
    // group.  Within a colour, DONOR sheets are numbered first in
    // spatial order (top-to-bottom, then left-to-right), and any
    // offcut-only sheets follow — so every colour reads Blue 1..N,
    // Orange 1..N, and the donor run is never broken by an offcut's
    // number.  Function-scoped so the two post-rotation re-number
    // blocks below reuse it.
    function _numberSheetsByColour(strips){
      var groups = {};
      strips.forEach(function(s){
        var k = s._sheetKey;
        if (k == null) return;
        (groups[k] = groups[k] || []).push(s);
      });
      var meta = Object.keys(groups).map(function(k){
        var g = groups[k];
        var donor = g.find(function(s){ return !s.isOffcut; });
        var rep = donor || g[0];
        return {
          g: g,
          colour: rep.color,
          offcutOnly: !donor,
          cx: rep.centroid ? rep.centroid[0] : 0,
          cy: rep.centroid ? rep.centroid[1] : 0,
        };
      });
      // Auto-pick the primary reading axis from the roof's overall
      // shape: a WIDE roof reads left→right (numbers march across the
      // long axis), a TALL roof reads top→bottom.  Measured from the
      // spread of every sheet's representative centroid.
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      meta.forEach(function(m){
        if (m.cx < minX) minX = m.cx; if (m.cx > maxX) maxX = m.cx;
        if (m.cy < minY) minY = m.cy; if (m.cy > maxY) maxY = m.cy;
      });
      var wide = (maxX - minX) >= (maxY - minY);   // wider than tall → read across
      var byCol = {};
      meta.forEach(function(m){ (byCol[m.colour] = byCol[m.colour] || []).push(m); });
      Object.keys(byCol).forEach(function(col){
        byCol[col].sort(function(a, b){
          if (a.offcutOnly !== b.offcutOnly) return a.offcutOnly ? 1 : -1;  // donors first
          // Wide roof → left→right then top→bottom; tall roof → the flip.
          return wide ? (a.cx - b.cx || a.cy - b.cy)
                      : (a.cy - b.cy || a.cx - b.cx);
        });
        byCol[col].forEach(function(m, i){
          m.g.forEach(function(s){ s.seq = i + 1; });
        });
      });
    }
    allStrips.forEach(function(s){ s._sheetKey = _sheetKey(s); });
    _numberSheetsByColour(allStrips);
  }  // end of isBigL branch

  // ── Re-insert hip-end apex into strips that cut it off ───────────
  // Sutherland–Hodgman clipping a strip rectangle against a triangular
  // hip-end face produces a polygon whose far edge is a CHORD from
  // where the rect enters one hip line to where it exits the other —
  // bypassing the apex itself.  Visually this leaves a small white
  // triangle at the apex.  Insert the apex vertex into the strip's
  // polygon when an edge passes within ~25px of it.
  function _faceApex(f) {
    if (!f || f.type !== 'hip-end' || !f.poly || f.poly.length !== 3) return null;
    for (var i = 0; i < 3; i++) {
      var v = f.poly[i];
      var dA = Math.hypot(v[0] - f.a[0], v[1] - f.a[1]);
      var dB = Math.hypot(v[0] - f.b[0], v[1] - f.b[1]);
      if (dA > 1 && dB > 1) return v;
    }
    return null;
  }
  if (allStrips && allStrips.length) allStrips.forEach(function(s){
    var f = (s.isPhantom && s.receiver) ? s.receiver : s.face;
    var apex = _faceApex(f);
    if (!apex) return;
    var p = s.poly;
    if (!p || p.length < 3) return;
    for (var k = 0; k < p.length; k++) {
      if (Math.hypot(p[k][0] - apex[0], p[k][1] - apex[1]) < 1) return;
    }
    for (var i = 0; i < p.length; i++) {
      var a = p[i], b = p[(i+1) % p.length];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len2 = dx*dx + dy*dy;
      if (len2 < 1) continue;
      var t = ((apex[0]-a[0])*dx + (apex[1]-a[1])*dy) / len2;
      if (t < 0.02 || t > 0.98) continue;
      var px = a[0] + t*dx, py = a[1] + t*dy;
      var perpDist2 = (apex[0]-px)*(apex[0]-px) + (apex[1]-py)*(apex[1]-py);
      if (perpDist2 < 25*25) {
        p.splice(i+1, 0, apex.slice());
        break;
      }
    }
  });

  // ── Un-rotate Big-L output back into the original outline space ──
  // Inverse of the canonicalization rotation: 4-n CW quarter-turns.
  // We rotate everything that downstream canvas / legend code reads:
  //   - faces[*].poly, .a, .b, .centroid (points)
  //   - faces[*].tx/ty/nx/ny           (unit vectors — no pivot offset)
  //   - allStrips[*].poly, .centroid   (points)
  //   - DRAW.lines (the mutated set: bridge hip removed, ridge added)
  //   - outline (back to its original coords)
  // Sequence numbers ARE re-computed (centroid sort) after un-rotation
  // so the left-to-right ordering reflects the user's coordinate space.
  if (isBigL && __nTurnsCW !== 0 && __pivot) {
    var inv = (4 - __nTurnsCW) % 4;
    var px = __pivot[0], py = __pivot[1];
    function _rotPt(p){ return rotate90(p, px, py, inv); }
    function _rotVec(v){ return rotateVec(v, inv); }
    if (faces && faces.length) {
      faces.forEach(function(f){
        if (!f) return;
        if (f.poly) f.poly = f.poly.map(_rotPt);
        if (f.a) f.a = _rotPt(f.a);
        if (f.b) f.b = _rotPt(f.b);
        if (f.centroid) f.centroid = _rotPt(f.centroid);
        if (typeof f.tx === 'number' && typeof f.ty === 'number') {
          var tv = _rotVec([f.tx, f.ty]); f.tx = tv[0]; f.ty = tv[1];
        }
        if (typeof f.nx === 'number' && typeof f.ny === 'number') {
          var nv = _rotVec([f.nx, f.ny]); f.nx = nv[0]; f.ny = nv[1];
        }
      });
    }
    if (allStrips && allStrips.length) {
      allStrips.forEach(function(s){
        if (!s) return;
        if (s.poly)     s.poly     = s.poly.map(_rotPt);
        if (s.centroid) s.centroid = _rotPt(s.centroid);
      });
      // Re-number in original space (the _sheetKey survives rotation)
      // using the same per-colour, donors-first scheme as canonical.
      _numberSheetsByColour(allStrips);
    }
    // Un-rotate DRAW.lines back to original space.  The Big-L code
    // mutated DRAW.lines (in canonical space).  We rotate ALL lines
    // back so they line up with the user's outline.
    DRAW.lines = DRAW.lines.map(function(l){
      if (!l || !l.pts) return l;
      var newL = {};
      for (var k in l) if (l.hasOwnProperty(k)) newL[k] = l[k];
      newL.pts = l.pts.map(_rotPt);
      return newL;
    });
    // Restore outline local var to original-space coords for the
    // canvas drawing (toC maps original-space coords → canvas pixels).
    outline = outline.map(_rotPt);
  }

  // Un-mirror: if the input was a horizontal mirror of a Big-L, the
  // cascade ran in mirrored-then-rotated canonical space.  After
  // un-rotating, apply the same horizontal mirror (self-inverse) to
  // bring outputs back to the user's original chirality.
  if (isBigL && __mirrored && __mirrorPivotX != null) {
    var __mpx = __mirrorPivotX;
    function _mirPt(p){ return [2*__mpx - p[0], p[1]]; }
    function _mirVec(v){ return [-v[0], v[1]]; }
    if (faces && faces.length) {
      faces.forEach(function(f){
        if (!f) return;
        if (f.poly) f.poly = f.poly.map(_mirPt);
        if (f.a) f.a = _mirPt(f.a);
        if (f.b) f.b = _mirPt(f.b);
        if (f.centroid) f.centroid = _mirPt(f.centroid);
        if (typeof f.tx === 'number' && typeof f.ty === 'number') {
          var _tv = _mirVec([f.tx, f.ty]); f.tx = _tv[0]; f.ty = _tv[1];
        }
        if (typeof f.nx === 'number' && typeof f.ny === 'number') {
          var _nv = _mirVec([f.nx, f.ny]); f.nx = _nv[0]; f.ny = _nv[1];
        }
      });
    }
    if (allStrips && allStrips.length) {
      allStrips.forEach(function(s){
        if (!s) return;
        if (s.poly)     s.poly     = s.poly.map(_mirPt);
        if (s.centroid) s.centroid = _mirPt(s.centroid);
      });
      // Re-number in mirrored original space using the same per-colour,
      // donors-first scheme.
      _numberSheetsByColour(allStrips);
    }
    DRAW.lines = DRAW.lines.map(function(l){
      if (!l || !l.pts) return l;
      var newL = {};
      for (var k in l) if (l.hasOwnProperty(k)) newL[k] = l[k];
      newL.pts = l.pts.map(_mirPt);
      return newL;
    });
    outline = outline.map(_mirPt);
  }

  // ── Big-L coverage completion (offcut fills) ──
  // The hand-calibrated Big-L strip formulas assume a nominally
  // proportioned wing; a short or wide wing leaves a small interior region
  // near the wing/main junction untiled (a visible white sliver).  Now
  // that strips are in final display space with seqs assigned, scan the L
  // for any interior gap and fill it.  A donor sheet's full-length main-N
  // primary and its offcut share a horizontal band here, so a gap is the
  // missing offcut of the donor whose band it overlaps — give the fill
  // that donor's seq / colour so it reads as the donor's reused offcut and
  // adds nothing to the order.  A well-proportioned wing leaves no gap, so
  // nothing is added there.
  if (isBigL && allStrips && allStrips.length) {
    var _cw = coverPxL;
    var _oxs = outline.map(function(p){return p[0];}), _oys = outline.map(function(p){return p[1];});
    var _bx0 = Math.min.apply(null, _oxs), _bx1 = Math.max.apply(null, _oxs);
    var _by0 = Math.min.apply(null, _oys), _by1 = Math.max.apply(null, _oys);
    function _inP(poly, x, y){
      var c = false;
      for (var i = 0, j = poly.length-1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi)) c = !c;
      }
      return c;
    }
    function _openAt(x, y){
      if (!_inP(outline, x, y)) return false;
      for (var s = 0; s < allStrips.length; s++) {
        var pl = allStrips[s].poly;
        if (pl && pl.length >= 3 && _inP(pl, x, y)) return false;
      }
      return true;
    }
    var _step = 1, _minW = 1.5, _bandH = Math.max(2.5, _cw / 16);
    // 1) per thin band, find uncovered x-runs at its mid-line
    var _bands = [];
    for (var _yb = _by0; _yb < _by1 - 0.1; _yb += _bandH) {
      var _yT = _yb, _yB = Math.min(_yb + _bandH, _by1), _yM = (_yT + _yB) / 2, _runs = [], _rs = null;
      for (var _x = _bx0; _x <= _bx1 + 0.001; _x += _step) {
        var _op = (_x <= _bx1) && _openAt(_x, _yM);
        if (_op && _rs === null) _rs = _x;
        else if (!_op && _rs !== null) { if (_x - _step - _rs >= _minW) _runs.push([_rs, _x - _step]); _rs = null; }
      }
      _bands.push({ yT: _yT, yB: _yB, runs: _runs });
    }
    // 2) union vertically-adjacent overlapping runs into contiguous gaps
    var _rl = [];
    _bands.forEach(function(bd, bi){ bd.runs.forEach(function(r){
      _rl.push({ bi: bi, a: r[0], b: r[1], yT: bd.yT, yB: bd.yB }); }); });
    var _par = _rl.map(function(_, i){ return i; });
    function _find2(i){ while (_par[i] !== i){ _par[i] = _par[_par[i]]; i = _par[i]; } return i; }
    for (var _i = 0; _i < _rl.length; _i++) for (var _j = 0; _j < _rl.length; _j++) {
      if (_rl[_j].bi === _rl[_i].bi + 1 && _rl[_i].a < _rl[_j].b && _rl[_j].a < _rl[_i].b)
        _par[_find2(_i)] = _find2(_j);
    }
    var _comps = {};
    _rl.forEach(function(r, i){ var c = _find2(i); (_comps[c] = _comps[c] || []).push(r); });
    // 3) one offcut polygon per gap, hugging the bounding hip/valley lines
    var _fills = [];
    Object.keys(_comps).forEach(function(k){
      var rs = _comps[k].sort(function(p, q){ return p.bi - q.bi; });
      var lf = [], rt = [];
      rs.forEach(function(r){ lf.push([r.a, r.yT], [r.a, r.yB]); rt.push([r.b, r.yT], [r.b, r.yB]); });
      var poly = lf.concat(rt.reverse());
      if (poly.length >= 3 && Math.abs(polyArea(poly)) > _minW * _minW)
        _fills.push({ poly: poly, centroid: polyCentroid(poly), isOffcut: true, isPhantom: false, _gapFill: true });
    });
    // 4) attach each fill to the donor whose full-length primary shares its
    //    band (the sheet it is physically cut from); else nearest sheet
    _fills.forEach(function(g){
      var gys = g.poly.map(function(p){ return p[1]; });
      var gy0 = Math.min.apply(null, gys), gy1 = Math.max.apply(null, gys);
      var best = null, bestOv = 0;
      allStrips.forEach(function(s){
        if (s._gapFill || s.isOffcut || s._donorIdx === undefined || !s.poly) return;
        var sys = s.poly.map(function(p){ return p[1]; });
        var ov = Math.min(gy1, Math.max.apply(null, sys)) - Math.max(gy0, Math.min.apply(null, sys));
        if (ov > bestOv) { bestOv = ov; best = s; }
      });
      if (!best) {
        var bd = Infinity;
        allStrips.forEach(function(s){
          if (s._gapFill) return;
          var dx = s.centroid[0]-g.centroid[0], dy = s.centroid[1]-g.centroid[1], d = dx*dx + dy*dy;
          if (d < bd) { bd = d; best = s; }
        });
      }
      if (!best) return;
      g.seq = best.seq; g.color = best.color; g.face = best.face;
      g.orderedLengthMm = best.orderedLengthMm; g.pieceM = best.pieceM; g._sheetKey = best._sheetKey;
      allStrips.push(g);
    });
  }

  // DEBUG hook — expose results to window for tests.
  window.__lastSheetPlan = { faces: faces, strips: allStrips, mainA: mainA, mainB: mainB };

  // ── Canvas + draw ─────────────────────────────────────────────
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  outline.forEach(function(p){
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  });
  var W = 960, H = 480, padX = 60, padY = 50;
  var sc = Math.min((W - padX*2) / (maxX - minX || 1), (H - padY*2) / (maxY - minY || 1));
  function toC(p){ return [(p[0]-minX)*sc + padX, (p[1]-minY)*sc + padY]; }
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.style.cssText = 'width:100%;max-width:'+W+'px;border:1px solid #ccd;border-radius:8px;display:block;background:#fff';
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // ── User-deleted sheets (Phase 1 customisable sheet plan) ────────
  // Stamp a stable ID on every strip and flag the ones the user
  // removed.  Deleted donors cascade to their paired offcut so the
  // hatched sibling disappears too.
  var deletedSet = {};
  (DRAW.sheetPlanDeletedIds || []).forEach(function(id){ deletedSet[id] = true; });
  allStrips.forEach(function(s){ s._id = _sheetStripId(s); s._deleted = !!deletedSet[s._id]; });
  allStrips.forEach(function(s){
    if (s._deleted) return;
    if (s.isOffcut && s._offcutSource && s._offcutSource._deleted) s._deleted = true;
  });

  // Draw faces' background polygons (very faint) so empty areas read
  // as the face.
  faces.forEach(function(f){
    ctx.beginPath();
    f.poly.forEach(function(p, i){
      var cc = toC(p);
      if (i === 0) ctx.moveTo(cc[0], cc[1]);
      else         ctx.lineTo(cc[0], cc[1]);
    });
    ctx.closePath();
    ctx.fillStyle = f.color + '15'; ctx.fill();
  });

  // Draw each strip filled in its colour, with a thin separator line.
  // Offcut-fed strips get a diagonal hatch overlay so the roofer can
  // see at a glance "this piece comes from the matching numbered
  // sheet on the donor face".
  allStrips.forEach(function(s){
    if (s._deleted) {
      // Deleted sheet — dashed grey outline only (no fill / hatch /
      // label) so the roofer still sees where the sheet grid runs.
      ctx.save();
      ctx.beginPath();
      s.poly.forEach(function(p, i){
        var cc = toC(p);
        if (i === 0) ctx.moveTo(cc[0], cc[1]);
        else         ctx.lineTo(cc[0], cc[1]);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(15,23,42,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.beginPath();
    s.poly.forEach(function(p, i){
      var cc = toC(p);
      if (i === 0) ctx.moveTo(cc[0], cc[1]);
      else         ctx.lineTo(cc[0], cc[1]);
    });
    ctx.closePath();
    ctx.fillStyle = s.color; ctx.fill();
    if (s.isOffcut) {
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.4;
      // Diagonal hatch across the strip's bounding box.
      var minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
      s.poly.forEach(function(p){
        var cc = toC(p);
        minSx = Math.min(minSx, cc[0]); maxSx = Math.max(maxSx, cc[0]);
        minSy = Math.min(minSy, cc[1]); maxSy = Math.max(maxSy, cc[1]);
      });
      for (var hx = minSx - (maxSy - minSy); hx < maxSx; hx += 6) {
        ctx.beginPath();
        ctx.moveTo(hx, minSy);
        ctx.lineTo(hx + (maxSy - minSy), maxSy);
        ctx.stroke();
      }
    }
    ctx.restore();
    // Outline on top of (potentially hatched) fill.
    ctx.beginPath();
    s.poly.forEach(function(p, i){
      var cc = toC(p);
      if (i === 0) ctx.moveTo(cc[0], cc[1]);
      else         ctx.lineTo(cc[0], cc[1]);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Outline + hip/ridge lines on top so the structure stays readable.
  ctx.lineWidth = 2; ctx.strokeStyle = '#0a1628';
  ctx.beginPath();
  outline.forEach(function(p, i){
    var cc = toC(p);
    if (i === 0) ctx.moveTo(cc[0], cc[1]);
    else         ctx.lineTo(cc[0], cc[1]);
  });
  ctx.closePath();
  ctx.stroke();
  (_tLines || DRAW.lines).forEach(function(l){
    if (l.type === 'gutter' || l.type === 'barge') return;  // outline already drawn
    if (l.type === 'ridge')  { ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5; }
    else if (l.type === 'hip')  { ctx.strokeStyle = COL_GREEN; ctx.lineWidth = 1.2; }
    else if (l.type === 'valley') { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.2; }
    else return;
    var p0 = toC(l.pts[0]), p1 = toC(l.pts[1]);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  });

  // Strip numbers — small yellow numerals at each strip's centroid.
  ctx.fillStyle = '#fbbf24'; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 2;
  allStrips.forEach(function(s){
    if (s._deleted) return;  // deleted strips carry no number badge
    var cc = toC(s.centroid);
    var lbl = String(s.seq);
    ctx.strokeText(lbl, cc[0], cc[1]);
    ctx.fillText(lbl, cc[0], cc[1]);
  });

  // ── Legend ────────────────────────────────────────────────────
  // Group sheets by (colour, orderedLengthMm). Offcut-fed pieces
  // (the receiver of a paired offcut) DON'T add to the order count
  // — they reuse the donor sheet — so they're excluded here per the
  // SOP §10 "Large offcut reused" reward.
  try {
    window.__lastAllStrips = allStrips;
    window.__lastFaces = faces;
    window.__lastSheetTransform = { minX: minX, minY: minY, sc: sc, padX: padX, padY: padY, W: W, H: H };
  } catch(e){}
  var groups = {};
  allStrips.forEach(function(s){
    if (s._deleted) return;  // user-deleted sheets drop out of the order count
    if (s.isOffcut) return;
    var key = s.color + ':' + s.orderedLengthMm;
    if (!groups[key]) groups[key] = { color: s.color, orderedMm: s.orderedLengthMm, count: 0 };
    groups[key].count++;
  });
  var groupList = Object.keys(groups).map(function(k){ return groups[k]; });
  // Sort: orange first, then blue, then purple. Within colour, longer first.
  var colorOrder = {};
  colorOrder[COL_ORANGE] = 0; colorOrder[COL_BLUE] = 1; colorOrder[COL_PURPLE] = 2;
  groupList.sort(function(a, b){
    var co = (colorOrder[a.color]||9) - (colorOrder[b.color]||9);
    if (co) return co;
    return b.orderedMm - a.orderedMm;
  });
  var legHtml = '<div style="display:flex;gap:24px;align-items:flex-start;margin-top:14px;flex-wrap:wrap">';
  legHtml += '<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;background:#fff;min-width:280px">';
  legHtml += '<div style="font-weight:800;font-size:13px;color:#0a1628;letter-spacing:.04em;margin-bottom:10px">SHEETS TO ORDER</div>';
  if (!groupList.length) {
    legHtml += '<div style="font-size:12px;color:#6b7280">No sheets — check that the outline has gutters and hips.</div>';
  } else {
    groupList.forEach(function(g){
      legHtml += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">'+
        '<span style="font-size:24px;font-weight:800;color:'+g.color+'">'+g.count+'</span>'+
        '<span style="font-size:12px;color:#6b7280">× @ '+g.orderedMm+'mm ('+(g.orderedMm/1000).toFixed(2)+'m)</span>'+
        '</div>';
    });
  }
  legHtml += '</div></div>';
  // (FACE BREAKDOWN panel removed — area + per-face detail is shown
  // in the Materials section's cut lists below the sheet plan.)

  // Stash counts for the Materials cut-list + legacy Order Material
  // sync.  Derived from the SAME `groups` map the SHEETS TO ORDER
  // legend renders so the two can never drift (and so offcuts are
  // excluded — offcuts come out of donor sheets and don't add to
  // what we order).  Also exposes the per-length groups array
  // verbatim so the Materials cut-list can show one row per (length,
  // colour) group instead of collapsing everything into "LONG".
  var shortCount = 0, orangeLong = 0, blueLong = 0, purpleLong = 0;
  groupList.forEach(function(g){
    if (g.orderedMm <= SHORT_MM) { shortCount += g.count; return; }
    if (g.color === COL_ORANGE)  { orangeLong += g.count; return; }
    if (g.color === COL_BLUE)    { blueLong   += g.count; return; }
    purpleLong += g.count;
  });
  window._lastSheetCounts = {
    shortCount: shortCount,
    shortLen: SHORT_MM,
    orangeLong: orangeLong,
    blueLong: blueLong,
    purpleLong: purpleLong,
    longLen: LONG_MM,
    // Per (colour, length) groups straight from the legend — the
    // Materials cut-list groups by length only and uses these.
    groups: groupList.map(function(g){ return { color: g.color, orderedMm: g.orderedMm, count: g.count }; }),
  };

  outEl.innerHTML = '';
  // Wire up click-to-delete: stash the strips + image→canvas transform
  // on the element and mount the click handler.  Cursor shows the edit
  // affordance while Edit mode is on.
  cv._sheetPlanStrips = allStrips;
  cv._sheetPlanTransform = { minX: minX, minY: minY, sc: sc, padX: padX, padY: padY };
  cv.addEventListener('click', _onSheetPlanCanvasClick);
  if (window._sheetPlanEditMode) cv.style.cursor = 'crosshair';
  outEl.appendChild(cv);
  var dd = document.createElement('div');
  dd.innerHTML = legHtml;
  outEl.appendChild(dd);

  // Restore the user's drawing.  The Big-L sheet-layout math above
  // temporarily mutates DRAW.lines (removes the bridge hip, adds a
  // ridge extension) purely to compute the cut plan + diagram overlay.
  // That synthetic geometry must NOT leak back onto the Map Roof canvas,
  // so put the original lines back now that the plan + diagram are built.
  DRAW.lines = __origDrawLines;
}

