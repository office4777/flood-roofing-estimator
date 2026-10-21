// LEGACY SHEET LAYOUT DRAWING — kept for reference, not loaded by anything.
//
// The owner, 2026-10-21: "my sheet layout diagram methods are very ad hoc and
// per roof type and need a full overhaul, but save the code in case we need
// to revert back." These are the pieces the block-cut plan replaced in
// fcaab9a: the click-to-delete edit mode on the old canvas, the cookie-plan
// repaint, and the tail of _renderRoofSheetPlanInner that chose between the
// cascade canvas and the cookie plan. The last full build that drew the old
// picture is commit b81e5c5 (git show b81e5c5:floodroofing/frontend/sheet-plan.js);
// the per-roof-type face / strip / offcut-pairing machinery that fed it is
// STILL in sheet-plan.js, because the counts and __lastAllStrips come off it.
// To put the old picture back: restore these into sheet-plan.js at b81e5c5's
// positions and set SHEET_LAYOUT_HIDDEN as you want it.

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



// Repaint the sheet-plan canvas from a cookie plan. Same canvas + same
// image→canvas transform the legacy engine used, so click-to-delete and
// downstream captures keep working unchanged.
function _ccDrawCookiePlan(cv, plan, outline, lines, T){
  var ctx = cv.getContext('2d');
  function toC(p){ return [(p[0]-T.minX)*T.sc + T.padX, (p[1]-T.minY)*T.sc + T.padY]; }
  function poly(pts){ ctx.beginPath(); pts.forEach(function(p,i){ var c=toC(p); i?ctx.lineTo(c[0],c[1]):ctx.moveTo(c[0],c[1]); }); ctx.closePath(); }
  function rr(x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function hatch(pts, col){
    ctx.save(); poly(pts); ctx.fillStyle = col; ctx.fill(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.4;
    var a=Infinity,b2=-Infinity,c2=Infinity,d2=-Infinity;
    pts.forEach(function(p){ var q=toC(p); a=Math.min(a,q[0]); b2=Math.max(b2,q[0]); c2=Math.min(c2,q[1]); d2=Math.max(d2,q[1]); });
    for (var hx=a-(d2-c2); hx<b2; hx+=6){ ctx.beginPath(); ctx.moveTo(hx,c2); ctx.lineTo(hx+(d2-c2),d2); ctx.stroke(); }
    ctx.restore();
  }
  ctx.clearRect(0, 0, T.W, T.H);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, T.W, T.H);
  // Pale roof ground.
  poly(outline); ctx.fillStyle = 'rgba(249,115,22,0.05)'; ctx.fill();
  // A tidy plan: EVERYTHING is clipped to the roof outline — no sheet ever
  // pokes past the roof edge (round-up overhang is the calc-check map's
  // story, not the layout's).
  ctx.save();
  poly(outline); ctx.clip();
  // Deleted sheets ghost as dashed outlines.
  plan.columns.forEach(function(col){
    if (!col.deleted) return;
    ctx.save(); poly(col.rect); ctx.setLineDash([4,3]);
    ctx.strokeStyle = 'rgba(15,23,42,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  });
  // Base coat — the raw in-place offcut territory, hatched with no strip
  // lines. The re-tiled reuse strips draw over it, so a hairline seam
  // between the two grids shows this coat instead of a white gap.
  (plan.rawOffcuts || []).forEach(function(s){
    if (s._deleted) return;
    hatch(s.poly, s.color);
  });
  // Hatched reuse strips (the offcuts spun perpendicular to their gutter).
  // A FRESH-sheet piece is NOT an offcut — it's new full material, so it
  // draws below as a full solid in its group's colour, never hatched.
  plan.strips.forEach(function(s){
    if (s._deleted || !s.isOffcut || s._fresh) return;
    hatch(s.poly, s.color);
    // Seam killer — bleed ~1px so neighbours meet without white seams.
    poly(s.poly); ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.stroke();
    poly(s.poly); ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1; ctx.stroke();
  });
  // Solid donor pieces (and fresh-sheet fills).
  plan.strips.forEach(function(s){
    if (s._deleted || (s.isOffcut && !s._fresh)) return;
    poly(s.poly); ctx.fillStyle = s.color; ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.stroke();   // seam killer
    ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 1; ctx.stroke();
  });
  // Valley spares — hatched "+1", clipped to the roof; skip when the spare
  // sits wholly outside (the order legend still counts it).
  plan.spares.forEach(function(sp){
    var inPoly = _ccClipToConvex(outline, sp.rect);
    if (!inPoly) return;
    hatch(inPoly, sp.color);
    poly(inPoly); ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1; ctx.stroke();
    var cc = toC(_ccCentroid(inPoly));
    ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0a1628'; ctx.fillText('+1', cc[0], cc[1]);
  });
  ctx.restore();
  // Roof structure on top.
  poly(outline); ctx.strokeStyle = '#0a1628'; ctx.lineWidth = 2.2; ctx.stroke();
  (lines || []).forEach(function(l){
    if (!l || !l.pts || l.pts.length !== 2) return;
    if (l.type === 'gutter' || l.type === 'barge') return;
    var a = toC(l.pts[0]), b = toC(l.pts[1]);
    if (l.type === 'ridge'){ ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; }
    else if (l.type === 'valley'){ ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.6; }
    else { ctx.strokeStyle = 'rgba(10,22,40,0.55)'; ctx.lineWidth = 1.4; }
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  });
  // Numbers — one badge per ordered sheet on its biggest SOLID piece (at
  // the calc-check number spot when that spot is inside the piece), plus a
  // small number on each sizeable offcut piece so the reuse stays traceable.
  var colWpx = 0;
  plan.columns.forEach(function(c){
    var w = Math.hypot(toC(c.rect[1])[0]-toC(c.rect[0])[0], toC(c.rect[1])[1]-toC(c.rect[0])[1]);
    if (w > colWpx) colWpx = w;
  });
  var numFont = Math.max(8, Math.min(13, colWpx*0.5));
  var byId = {};
  plan.strips.forEach(function(s){
    if (s._deleted) return;
    (byId[s._id] = byId[s._id] || []).push(s);
  });
  plan.columns.forEach(function(col){
    if (col.deleted) return;
    var pieces = byId[col.id] || [];
    if (!pieces.length) return;
    var solids = pieces.filter(function(p){ return !p.isOffcut; });
    var main = (solids.length ? solids : pieces).slice().sort(function(a,b){ return _ccPolyArea(b.poly)-_ccPolyArea(a.poly); })[0];
    var at = _spPointInPoly(col.numAt[0], col.numAt[1], main.poly) ? col.numAt : main.centroid;
    var cc = toC(at);
    ctx.font = '700 ' + numFont + 'px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; rr(cc[0]-8, cc[1]-7, 16, 14, 3); ctx.fill();
    ctx.fillStyle = '#0a1628'; ctx.fillText(String(col.seq), cc[0], cc[1]);
    // Offcut number — ONE badge per donor, on its largest reuse piece
    // (several slivers of the same donor would otherwise spam the corner
    // with repeated numbers).
    var reuse = pieces.filter(function(p){ return p.isOffcut && p !== main; })
                      .sort(function(a2, b2){ return _ccPolyArea(b2.poly) - _ccPolyArea(a2.poly); })[0];
    if (reuse && _ccPolyArea(reuse.poly) >= colWpx*colWpx*0.25/(T.sc*T.sc)){
      var oc = toC(reuse.centroid);
      ctx.font = '700 ' + Math.max(7, numFont-2) + 'px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; rr(oc[0]-7, oc[1]-6, 14, 12, 3); ctx.fill();
      ctx.fillStyle = 'rgba(10,22,40,0.9)'; ctx.fillText(String(col.seq), oc[0], oc[1]);
    }
  });
}

// render its sheet plan into a labelled section.  Single-roof or
// pre-multi-roof code paths go straight to the inner renderer.


// ── tail of _renderRoofSheetPlanInner at b81e5c5 ──
  // ── Cookie-cutter layout ─────────────────────────────────────────
  // Rebuild the diagram from the calc-check sections (columns laid where
  // the Sheet Calculation Check tiles them, cut along the roof lines,
  // offcuts hatched in place). ONLY for the roof types it has been signed
  // off on — Dutch gable and mono-pitch. Hip & valley (and every other
  // type) keeps the legacy cascade diagram, which lays those roofs
  // correctly. Even for dutch/mono it replaces the cascade canvas only
  // when the cookie pieces cover the roof.
  try {
    var __ccLines = (_tLines || __origDrawLines || DRAW.lines);
    var __ccPlan = (DRAW.roofType === 'dutch' || DRAW.roofType === 'mono')
      ? _ccBuildCookiePlan(window._lastSheetSections, outline, __ccLines)
      : null;
    // Hip & valley: lay it the way the crew does (see _ccHipBandSections —
    // self-populating hip ends, trimmed donor faces, valley filled from
    // corner offcuts), but ONLY when the band layout's sheet count agrees
    // EXACTLY with the counted SHEETS TO ORDER total. Any disagreement
    // means this roof doesn't fit the band model — the cascade diagram
    // stays (e.g. a plain rectangle counts full-length donors instead).
    // Dutch gable on a non-rectangle: the plain cookie can't cover it, but
    // the band model can — the gablet ends self-populate exactly like hip
    // ends (band depth to the apron instead of the apex) and the valley is
    // fed from the corner offcuts. Same strict gate as hip below.
    if ((!__ccPlan || !__ccPlan.ok) && (DRAW.roofType === 'hip' || DRAW.roofType === 'dutch')){
      var __hb = _ccHipBandSections(outline, __ccLines, coverPx,
                   function(d){ return orderedLengthMm(d * effectiveScale * pitchFactor); });
      if (__hb && __hb.length){
        var __hp = _ccBuildCookiePlan(__hb, outline, __ccLines, { fillGaps: true, valleyRayOK: true, bandColours: true });
        // The gate compares PER-LENGTH groups, not just the grand total — a
        // roof whose band count happens to hit the same total with a
        // different length mix must stay on the cascade, or the diagram
        // would contradict the SHEETS TO ORDER legend.
        var __cm = {}, __bm = {}, __gOK = !!(__hp && __hp.ok);
        ((window._lastSheetCounts && window._lastSheetCounts.groups) || []).forEach(function(g){
          var mm = g.orderedMm || g.lengthMm || 0; __cm[mm] = (__cm[mm]||0) + g.count;
        });
        __hb.forEach(function(bb){ __bm[bb.orderedMm] = (__bm[bb.orderedMm]||0) + bb.perSide; });
        Object.keys(__cm).forEach(function(k){ if (__cm[k] !== __bm[k]) __gOK = false; });
        Object.keys(__bm).forEach(function(k){ if (__cm[k] !== __bm[k]) __gOK = false; });
        if (__gOK) __ccPlan = __hp;
      }
    }
    if (__ccPlan && __ccPlan.ok){
      _ccDrawCookiePlan(cv, __ccPlan, outline, (_tLines || __origDrawLines || DRAW.lines),
                        { minX: minX, minY: minY, sc: sc, padX: padX, padY: padY, W: W, H: H });
      allStrips = __ccPlan.strips;
      try { window.__lastAllStrips = allStrips; } catch(e){}
    }
  } catch(e){}
  outEl.innerHTML = '';
  // Wire up click-to-delete: stash the strips + image→canvas transform
  // on the element and mount the click handler.  Cursor shows the edit
  // affordance while Edit mode is on.
  cv._sheetPlanStrips = allStrips;
  cv._sheetPlanTransform = { minX: minX, minY: minY, sc: sc, padX: padX, padY: padY };
  cv.addEventListener('click', _onSheetPlanCanvasClick);
  if (window._sheetPlanEditMode) cv.style.cursor = 'crosshair';
  outEl.appendChild(cv);
