// Test the perfect-L cascade design across multiple L-shape sizes.
// Renders each in its own SVG and combines them in a grid for comparison.
//
// A "perfect L" has both arms of the same width (so all face sheets are
// the same length = arm_w/2) and the same length.  Cases vary arm_w and
// arm_len to verify the cascade adapts.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DESIGN_ORANGE = '#f97316';
const DESIGN_BLUE   = '#2563eb';

// ── Per-case parameters ────────────────────────────────────────────────
// Orientations of a perfect-L (all arm_w=400, arm_len=1000):
//   N — wing points north (canonical orient 0)
//   E — wing points east  (rotated 90° CW)
//   S — wing points south (rotated 180°)
//   W — wing points west  (rotated 90° CCW)
//   mirror — horizontal mirror of orient 0 (notch top-left, wing top-right)
const CASES = [
  { label: 'N — wing points north',  ox: 100, oy: 100, arm_w: 400, arm_len: 1000, orient: 0 },
  { label: 'E — wing points east',   ox: 100, oy: 100, arm_w: 400, arm_len: 1000, orient: 1 },
  { label: 'S — wing points south',  ox: 100, oy: 100, arm_w: 400, arm_len: 1000, orient: 2 },
  { label: 'W — wing points west',   ox: 100, oy: 100, arm_w: 400, arm_len: 1000, orient: 3 },
  { label: 'inverted — horizontal mirror of canonical',  ox: 100, oy: 100, arm_w: 400, arm_len: 1000, orient: 0, mirror: true },
];

// ── Build the cascade design SVG for one case ──────────────────────────
async function renderCase(page, c) {
  const { ox, oy, arm_w, arm_len, orient = 0, mirror = false } = c;
  const half_w  = arm_w / 2;                    // = sheet length for all faces
  const reflex_x = ox + arm_w;
  const reflex_y = oy + arm_len - arm_w;
  const ridge_corner_x = ox + half_w;
  const ridge_corner_y = oy + arm_len - half_w;
  const main_apex_x = ox + arm_len - half_w;
  const wing_apex_y = oy + half_w;
  const valley_sum = ox + oy + arm_len;

  // Canonical outline (orient 0).  We always RUN the cascade design in
  // canonical space; for non-zero orientations we rotate the outline to
  // get the display outline, get strips from the app (in display space),
  // inverse-rotate them to canonical for classification, then forward-
  // rotate the final result for rendering.
  const canonical_outline = [
    [ox, oy], [ox+arm_w, oy], [ox+arm_w, reflex_y],
    [ox+arm_len, reflex_y], [ox+arm_len, oy+arm_len], [ox, oy+arm_len]
  ];

  // Rotation around bbox centre.  bbox is a square of side arm_len.
  const bcx = ox + arm_len / 2;
  const bcy = oy + arm_len / 2;
  function rot([x, y]) {
    const dx = x - bcx, dy = y - bcy;
    if (orient === 1) return [bcx - dy, bcy + dx];  // 90° CW
    if (orient === 2) return [bcx - dx, bcy - dy];  // 180°
    if (orient === 3) return [bcx + dy, bcy - dx];  // 90° CCW
    return [x, y];
  }
  function unrot([x, y]) {
    const dx = x - bcx, dy = y - bcy;
    if (orient === 1) return [bcx + dy, bcy - dx];
    if (orient === 2) return [bcx - dx, bcy - dy];
    if (orient === 3) return [bcx - dy, bcy + dx];
    return [x, y];
  }
  function mir([x, y]) { return mirror ? [2 * bcx - x, y] : [x, y]; }   // self-inverse
  // canonical → display: rotate, then (optionally) mirror.
  const fwd = (p) => mir(rot(p));
  // display → canonical: un-mirror, then un-rotate.
  const inv = (p) => unrot(mir(p));
  const display_outline = canonical_outline.map(fwd);

  // Push display outline into the app and grab the 6-face cascade output.
  await page.evaluate((outline) => {
    window.DRAW.outline = outline;
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  }, display_outline);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.gotoTab && window.gotoTab('materials');
    window.renderRoofSheetPlan && window.renderRoofSheetPlan();
  });
  await page.waitForTimeout(700);
  const rawStrips = await page.evaluate(() => (window.__lastAllStrips || []).map(s => ({
    origColor: s.color,
    facePoly: s.face && s.face.poly ? s.face.poly.map(p => p.slice()) : null,
    poly: s.poly.map(p => p.slice()),
  })));
  // Inverse-rotate strip + face polys into canonical space so the
  // cascade design code can use canonical hardcoded thresholds.
  const strips = rawStrips.map(s => ({
    origColor: s.origColor,
    facePoly: s.facePoly ? s.facePoly.map(inv) : null,
    poly: s.poly.map(inv),
  }));

  // ── Classify each strip by its strip-centroid position ──
  // Robust face-polygon-centroid classification.  We can't use the
  // strip's centroid alone because NE-hip-clipped mainN strips and
  // SE-hip-clipped mainS strips share an (x, y) bbox with the mainE
  // hip-end face — they need to be distinguished by which face they
  // belong to.  Each face's polygon centroid is unique enough.
  function faceCentroid(poly) {
    if (!poly || !poly.length) return null;
    let cx = 0, cy = 0;
    poly.forEach(p => { cx += p[0]; cy += p[1]; });
    return [cx / poly.length, cy / poly.length];
  }
  // Face centroids for the perfect L (computed from geometry, all derived
  // from ox/oy/arm_w/arm_len so this scales):
  //   wing N hip-end:  ((ox + ox+arm_w + ridge_corner_x)/3, (oy + oy + wing_apex_y)/3)
  //   wing W long:     polygon (ox,oy)-(ridge_corner_x,wing_apex_y)-(ridge_corner_x,ridge_corner_y)-(ox,oy+arm_len)
  //   wing E long:     (ox+arm_w,oy)-(ridge_corner_x,wing_apex_y)-(ridge_corner_x,ridge_corner_y)-(reflex_x,reflex_y)
  //   main N long:     (reflex_x,reflex_y)-(ox+arm_len,reflex_y)-(main_apex_x,ridge_corner_y)-(ridge_corner_x,ridge_corner_y)
  //   main E hip-end:  ((ox+arm_len + ox+arm_len + main_apex_x)/3, (reflex_y + oy+arm_len + ridge_corner_y)/3)
  //   main S long:     (ox,oy+arm_len)-(ox+arm_len,oy+arm_len)-(main_apex_x,ridge_corner_y)-(ridge_corner_x,ridge_corner_y)
  function classify(s) {
    const fc = faceCentroid(s.facePoly);
    if (!fc) return 'other';
    const [fx, fy] = fc;
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

    // C area override: anything in the main N donor zone (between valley
    // and E hip-end) is mainN regardless of which face the 6-face
    // cascade assigned it to (catches phantom-extended wing E strips).
    if (cx > reflex_x && cx < main_apex_x && cy > reflex_y && cy < ridge_corner_y) return 'mainN';

    // Tolerance for matching face centroids (allow some drift).
    const tol = arm_w * 0.25;
    // Wing N hip-end face centroid: ((2*ox + arm_w + ridge_corner_x)/3, (2*oy + wing_apex_y)/3)
    //   = (ox + (arm_w/2 + arm_w/2)/3... let me just compute from formula above):
    //   = ((2*ox + arm_w + ox + arm_w/2)/3, (2*oy + oy + arm_w/2)/3)
    //   actually easier: average the three vertices.
    const wingN_cx = (ox + ox+arm_w + ridge_corner_x) / 3;
    const wingN_cy = (oy + oy + wing_apex_y) / 3;
    if (Math.abs(fx - wingN_cx) < tol && Math.abs(fy - wingN_cy) < tol) {
      return cx < ridge_corner_x ? 'wingN_W_half' : 'wingN_E_half';
    }
    // Main E hip-end face centroid:
    const mainE_cx = ((ox+arm_len) + (ox+arm_len) + main_apex_x) / 3;
    const mainE_cy = (reflex_y + (oy+arm_len) + ridge_corner_y) / 3;
    if (Math.abs(fx - mainE_cx) < tol && Math.abs(fy - mainE_cy) < tol) {
      return cy < ridge_corner_y ? 'mainE_N_half' : 'mainE_S_half';
    }
    // Wing W long-side: face centroid roughly (ox + arm_w/4, oy + arm_len/2).
    if (fx < ridge_corner_x && fy > wing_apex_y && fy < oy + arm_len) {
      return cy > ridge_corner_y ? 'wingW_extHip' : 'wingW';
    }
    // Wing E long-side: face centroid between ridge_corner_x and reflex_x.
    if (fx > ridge_corner_x && fx < reflex_x && fy > wing_apex_y && fy < oy + arm_len) {
      return 'wingE';
    }
    // Main N long-side: face centroid roughly (avg of 4 vertices).
    const mainN_fcx = (reflex_x + (ox+arm_len) + main_apex_x + ridge_corner_x) / 4;
    const mainN_fcy = (reflex_y + reflex_y + ridge_corner_y + ridge_corner_y) / 4;
    if (Math.abs(fx - mainN_fcx) < arm_w && Math.abs(fy - mainN_fcy) < arm_w/2) return 'mainN';
    // Main S long-side: face centroid roughly (avg of 4 vertices).
    if (fy > ridge_corner_y) return 'mainS';
    return 'other';
  }
  // Position-based classification — used to RE-classify strips whose
  // centroid is outside their face polygon.  These are "phantom-extended"
  // cascade strips that the 6-face engine sometimes generates for rotated
  // outlines (e.g., a mainN strip physically living in the wing E area).
  // If we kept them with their face-based region we'd render them with
  // the wrong color; reclassify by position so they show the colour of
  // the face they're physically in.
  function classifyByPosition(s) {
    const xs = s.poly.map(p => p[0]), ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (cy < wing_apex_y && cx > ox && cx < ox + arm_w) {
      return cx < ridge_corner_x ? 'wingN_W_half' : 'wingN_E_half';
    }
    if (cx > main_apex_x && cy > reflex_y && cy < oy + arm_len) {
      return cy < ridge_corner_y ? 'mainE_N_half' : 'mainE_S_half';
    }
    if (cy < reflex_y) {
      // Wing body
      return cx < ridge_corner_x ? 'wingW' : 'wingE';
    }
    if (cy > ridge_corner_y) return 'mainS';
    return 'mainN';
  }
  function pointInPoly([px, py], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  strips.forEach(s => {
    if (s.facePoly) {
      const xs = s.poly.map(p => p[0]), ys = s.poly.map(p => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (!pointInPoly([cx, cy], s.facePoly)) {
        s.region = classifyByPosition(s);
      }
    }
  });
  const stripsOnFace = strips;

  // ── Filter and add full-length C strips + valley triangle subdivisions ──
  function inValleyA(cx, cy) {
    return cx >= ridge_corner_x && cx <= reflex_x &&
           cy >= reflex_y && cy <= ridge_corner_y &&
           cx + cy < valley_sum;
  }
  function inValleyB(cx, cy) {
    return cx >= ridge_corner_x && cx <= reflex_x &&
           cy >= reflex_y && cy <= ridge_corner_y &&
           cx + cy > valley_sum;
  }
  const C_eps = 19;  // small overlap to catch the apex-straddle strip
  // Wing E face body (canonical) — we'll regenerate clean strips inside.
  // The cascade for rotated outlines splits wing E coverage between
  // legitimate wing-E-face strips and staggered mainN-face phantoms
  // (offset by ~9px in y), so the rendered tiles look "random".
  // Bounded above by wing N hip-right (y > -x + (ox+arm_w+oy)) and below
  // by reflex_y.  Doesn't include the wing N hip-end triangle (which has
  // its own clean cascade strips) — those are above the hip line.
  function inWingEBody(cx, cy) {
    return cx > ridge_corner_x && cx < ox + arm_w &&
           cy > oy && cy < reflex_y &&
           (cx + cy) > (ox + arm_w + oy);
  }
  // Wing W face body (canonical).  Bounded above by wing N hip-left
  // (y > x - (ox-oy), i.e. cy > cx - ox + oy) and below by SW hip
  // (cy < ox + oy + arm_len - cx).
  function inWingWBody(cx, cy) {
    return cx > ox && cx < ridge_corner_x &&
           cy > oy && cy < oy + arm_len &&
           (cy - cx) > (oy - ox) &&
           (cx + cy) < (ox + oy + arm_len);
  }
  const stripsKept = stripsOnFace.filter(s => {
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (cx > reflex_x && cx < main_apex_x + C_eps && cy > reflex_y && cy < ridge_corner_y) return false;
    if (inValleyA(cx, cy) || inValleyB(cx, cy)) return false;
    if (inWingEBody(cx, cy)) return false;
    if (inWingWBody(cx, cy)) return false;
    return true;
  });

  // Full-length C strips covering main N donor area between reflex and main apex.
  const coverPx = 38.1;
  const fullLengthStrips = [];
  for (let x = reflex_x; x < main_apex_x - 0.1; x += coverPx) {
    const xa = x, xb = Math.min(x + coverPx, main_apex_x);
    fullLengthStrips.push({
      poly: [[xa, reflex_y], [xb, reflex_y], [xb, ridge_corner_y], [xa, ridge_corner_y]],
      region: 'mainN',
      isFullLength: true,
    });
  }

  // Clean wing E donor strips covering the wing E face (canonical) — replaces
  // the cascade's split coverage so the wing E body tiles uniformly.
  // Wing N hip line (right side): y = -x + (ox+arm_w+oy) → at any y, the
  // minimum x of wing E face is max(ridge_corner_x, ox+arm_w+oy - y).
  // We tile horizontal bands from y=oy to y=reflex_y.
  const hipRightX = (y) => (ox + arm_w + oy) - y;
  for (let y = oy; y < reflex_y - 0.1; y += coverPx) {
    const ya = y, yb = Math.min(y + coverPx, reflex_y);
    const xL_top = Math.max(ridge_corner_x, hipRightX(ya));
    const xL_bot = Math.max(ridge_corner_x, hipRightX(yb));
    const xR = ox + arm_w;
    if (xR - xL_top < 0.5 && xR - xL_bot < 0.5) continue;  // degenerate
    fullLengthStrips.push({
      poly: [[xL_top, ya], [xR, ya], [xR, yb], [xL_bot, yb]],
      region: 'wingE',
      isFullLength: true,
    });
  }
  // Clean wing W donor strips covering the wing W face (canonical).
  // Wing N hip line (left side): y = x - (ox-oy) → at any y, min x of wing W
  // face is ox, max x is min(ridge_corner_x, y + (ox-oy)).  Wait simpler:
  // wing N hip from (ox, oy) to (ridge_corner_x, wing_apex_y): line y = x.
  // For wing W face, x range is [ox, min(ridge_corner_x, y)].
  // SW hip from (ox, oy+arm_len) to (ridge_corner_x, ridge_corner_y):
  // line y = -x + (ox + oy + arm_len).  Below this line, x > (ox+oy+arm_len) - y.
  // For wing W body, x range is [ox + max(0, (ox+oy+arm_len) - y - ox), ...]
  //   wait simpler: max x = ridge_corner_x; min x = max(ox, hip values).
  const hipLeftX_top = (y) => y - (oy - ox);    // wing N hip line: at y, x = y - (oy - ox)... at y=oy: x=ox.  at y=wing_apex_y: x = wing_apex_y - (oy-ox) = ridge_corner_x. ✓
  const hipLeftX_bot = (y) => (ox + oy + arm_len) - y;  // SW hip: at y, x value.
  for (let y = oy; y < oy + arm_len - 0.1; y += coverPx) {
    const ya = y, yb = Math.min(y + coverPx, oy + arm_len);
    // Top clip (wing N hip): wing W face requires x < hip_x at top.
    // For wing W body, the min x is ox, max x is min(ridge_corner_x, hipLeftX_top(y)).
    // For y past wing_apex_y, hipLeftX_top > ridge_corner_x so max x = ridge_corner_x.
    const xR_top = Math.min(ridge_corner_x, Math.max(ox, hipLeftX_top(ya)));
    const xR_bot = Math.min(ridge_corner_x, Math.max(ox, hipLeftX_top(yb)));
    // Bottom clip (SW hip): wing W requires x < (ox+oy+arm_len) - y.
    const xR_swTop = Math.min(xR_top, hipLeftX_bot(ya));
    const xR_swBot = Math.min(xR_bot, hipLeftX_bot(yb));
    if (xR_swTop - ox < 0.5 && xR_swBot - ox < 0.5) continue;
    // Region: 'wingW' for body, 'wingW_extHip' for SW-clipped strips at bottom.
    const isExtHip = yb > ridge_corner_y;
    fullLengthStrips.push({
      poly: [[ox, ya], [xR_swTop, ya], [xR_swBot, yb], [ox, yb]],
      region: isExtHip ? 'wingW_extHip' : 'wingW',
      isFullLength: true,
    });
  }

  // Valley triangle subdivisions.  Number of slices = ceil(half_w / coverPx)
  // so they match the donor count at the external corners.
  const valleySlices = Math.max(1, Math.round(half_w / coverPx));
  const slice_w = half_w / valleySlices;
  const valleyStrips = [];
  // A: horizontal strips above the valley line (north).  Triangle is
  //   (reflex_x, reflex_y) - (ridge_corner_x, reflex_y) - (ridge_corner_x, ridge_corner_y).
  //   Largest strip at top (i=0), smallest at bottom (last).
  //   wingW_extHip sorted cy ASC: idx 0 = longest donor (smallest offcut);
  //     largest valley A strip needs largest offcut, so pair with reversed idx.
  for (let i = 0; i < valleySlices; i++) {
    const ya = reflex_y + i * slice_w;
    const yb = reflex_y + (i + 1) * slice_w;
    const xEa = valley_sum - ya;
    const xEb = valley_sum - yb;
    valleyStrips.push({
      poly: [[ridge_corner_x, ya], [xEa, ya], [xEb, yb], [ridge_corner_x, yb]],
      region: 'valley_A',
      _designColor: DESIGN_ORANGE,
      _pairRegion: 'wingW_extHip',
      _pairIdx: (valleySlices - 1) - i,   // reverse for length conservation
      _isOffcut: true,
    });
  }
  // B: vertical strips below the valley line (south).  Triangle is
  //   (reflex_x, reflex_y) - (reflex_x, ridge_corner_y) - (ridge_corner_x, ridge_corner_y).
  //   Smallest strip at left (i=0, near ridge corner), largest at right (near reflex).
  //   mainS_west sorted cx DESC: idx 0 = longest donor (smallest offcut).
  for (let i = 0; i < valleySlices; i++) {
    const xa = ridge_corner_x + i * slice_w;
    const xb = ridge_corner_x + (i + 1) * slice_w;
    const yTa = valley_sum - xa;
    const yTb = valley_sum - xb;
    valleyStrips.push({
      poly: [[xa, yTa], [xb, yTb], [xb, ridge_corner_y], [xa, ridge_corner_y]],
      region: 'valley_B',
      _designColor: DESIGN_BLUE,
      _pairRegion: 'mainS_west',
      _pairIdx: i,
      _isOffcut: true,
    });
  }

  // ── Region refine + sort + key ──
  const allRenderStrips = [...stripsKept, ...fullLengthStrips, ...valleyStrips];
  allRenderStrips.forEach(s => { if (!s.region) s.region = classify(s); });

  function stripCentroid(s) {
    const pts = s.poly;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const cross = x1 * y2 - x2 * y1;
      a += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 0.001) {
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    return [cx / (6 * a), cy / (6 * a)];
  }
  allRenderStrips.forEach(s => { s._centroid = stripCentroid(s); });
  allRenderStrips.forEach(s => {
    const [cx, cy] = s._centroid;
    if (s.region === 'wingW' && cy < oy + arm_w) s.region = 'wingW_top';
    if (s.region === 'wingE' && cy < oy + arm_w) s.region = 'wingE_top';
    // mainN_east / mainS_east = only the corner-clipped strips (cx > main_apex_x).
    if (s.region === 'mainN' && cx > main_apex_x) s.region = 'mainN_east';
    if (s.region === 'mainS' && cx > main_apex_x) s.region = 'mainS_east';
    if (s.region === 'mainS' && cx < ridge_corner_x) s.region = 'mainS_west';
  });

  const regionGroups = {};
  allRenderStrips.forEach(s => { (regionGroups[s.region] = regionGroups[s.region] || []).push(s); });
  function sortAndIndex(region, comparator) {
    const g = regionGroups[region]; if (!g) return;
    g.sort(comparator); g.forEach((s, i) => { s._idx = i; });
  }
  // Donors: ascending by their position axis.
  sortAndIndex('wingW_top',    (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('wingE_top',    (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('mainN_east',   (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('mainS_east',   (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('wingW_extHip', (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('mainS_west',   (a, b) => b._centroid[0] - a._centroid[0]);  // cx DESC
  // Destinations: sort so length conservation holds.
  sortAndIndex('wingN_E_half', (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('wingN_W_half', (a, b) => b._centroid[0] - a._centroid[0]);
  sortAndIndex('mainE_S_half', (a, b) => b._centroid[1] - a._centroid[1]);
  sortAndIndex('mainE_N_half', (a, b) => a._centroid[1] - b._centroid[1]);
  // Non-paired.
  sortAndIndex('wingW',     (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('wingE',     (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('mainN',     (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('mainS',     (a, b) => a._centroid[0] - b._centroid[0]);

  const pairTo = {
    'wingN_E_half': 'wingW_top',
    'wingN_W_half': 'wingE_top',
    'mainE_S_half': 'mainN_east',
    'mainE_N_half': 'mainS_east',
  };
  allRenderStrips.forEach(s => {
    if (s._pairRegion != null && s._pairIdx != null) { s._key = `${s._pairRegion}:${s._pairIdx}`; return; }
    if (s._key) return;
    const r = pairTo[s.region] || s.region;
    s._key = `${r}:${s._idx != null ? s._idx : Math.round(s._centroid[0])+','+Math.round(s._centroid[1])}`;
  });
  const keyGroups = {};
  allRenderStrips.forEach(s => { (keyGroups[s._key] = keyGroups[s._key] || []).push(s); });
  const keysList = Object.keys(keyGroups).sort((a, b) => {
    const aR = keyGroups[a].slice().sort((x, y) => (y.poly.length - x.poly.length))[0]._centroid;
    const bR = keyGroups[b].slice().sort((x, y) => (y.poly.length - x.poly.length))[0]._centroid;
    return aR[1] - bR[1] || aR[0] - bR[0];
  });
  const numByKey = {};
  keysList.forEach((k, i) => { numByKey[k] = i + 1; });
  allRenderStrips.forEach(s => { s._num = numByKey[s._key]; });

  const designColor = {
    wingW: DESIGN_ORANGE, wingW_top: DESIGN_ORANGE, wingW_extHip: DESIGN_ORANGE,
    wingE: DESIGN_BLUE, wingE_top: DESIGN_BLUE,
    mainN: DESIGN_ORANGE, mainN_east: DESIGN_ORANGE,
    mainS: DESIGN_BLUE, mainS_east: DESIGN_BLUE, mainS_west: DESIGN_BLUE,
    wingN_W_half: DESIGN_BLUE, wingN_E_half: DESIGN_ORANGE,
    mainE_N_half: DESIGN_BLUE, mainE_S_half: DESIGN_ORANGE,
  };

  function isOffcutStrip(s) {
    if (s._isOffcut) return true;
    if (s.region && s.region.endsWith('_half')) return true;
    return false;
  }

  // ── Apply forward transform to bring everything into display space ──
  // The cascade design ran in canonical space; rotate strips, centroids,
  // outline, and roof lines so the rendering matches the orientation.
  allRenderStrips.forEach(s => {
    s.poly = s.poly.map(fwd);
    s._centroid = fwd(s._centroid);
  });
  const outline = display_outline;

  // ── Compose the per-case SVG ──
  const W = 600, H = 600;
  const minX = ox - 30, minY = oy - 30, maxX = ox + arm_len + 30, maxY = oy + arm_len + 30;
  const scale = Math.min((W - 30) / (maxX - minX), (H - 80) / (maxY - minY));
  const padX = (W - (maxX - minX) * scale) / 2;
  const padY = 60;
  const toX = x => padX + (x - minX) * scale;
  const toY = y => padY + (y - minY) * scale;
  const polyAttr = (p) => p.map(pt => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ');

  // Hip / ridge / valley lines (canonical → forward-rotate to display).
  const rotLine = ([a, b]) => [fwd(a), fwd(b)];
  const hips = [
    [[ox, oy], [ridge_corner_x, wing_apex_y]],
    [[ox+arm_w, oy], [ridge_corner_x, wing_apex_y]],
    [[ox+arm_len, reflex_y], [main_apex_x, ridge_corner_y]],
    [[ox+arm_len, oy+arm_len], [main_apex_x, ridge_corner_y]],
    [[ox, oy+arm_len], [ridge_corner_x, ridge_corner_y]],
  ].map(rotLine);
  const ridges = [
    [[ridge_corner_x, wing_apex_y], [ridge_corner_x, ridge_corner_y]],
    [[ridge_corner_x, ridge_corner_y], [main_apex_x, ridge_corner_y]],
  ].map(rotLine);
  const valleys = [[[reflex_x, reflex_y], [ridge_corner_x, ridge_corner_y]]].map(rotLine);
  const lineSvg = (lines, color, dash='') => lines.map(([a, b]) =>
    `<line x1="${toX(a[0])}" y1="${toY(a[1])}" x2="${toX(b[0])}" y2="${toY(b[1])}" stroke="${color}" stroke-width="2" ${dash?`stroke-dasharray="6,3"`:''}/>`
  ).join('');

  // Face backdrops: fill each face polygon with its design colour at low
  // opacity so any tiny gap in strip tiling shows the face colour rather
  // than white.  Strips draw at 0.65 alpha on top, so the gap shows ~0.25
  // alpha of the face colour — light enough that filled areas still look
  // right but visible enough to mask cascade-extension gaps.
  const faceBackdrops = [
    { poly: [[ox, oy], [ridge_corner_x, wing_apex_y], [ridge_corner_x, ridge_corner_y], [ox, oy+arm_len]],               color: DESIGN_ORANGE }, // wing W
    { poly: [[ox+arm_w, oy], [ridge_corner_x, wing_apex_y], [ridge_corner_x, ridge_corner_y], [reflex_x, reflex_y]],     color: DESIGN_BLUE },   // wing E
    { poly: [[reflex_x, reflex_y], [ox+arm_len, reflex_y], [main_apex_x, ridge_corner_y], [ridge_corner_x, ridge_corner_y]], color: DESIGN_ORANGE }, // main N
    { poly: [[ox, oy+arm_len], [ox+arm_len, oy+arm_len], [main_apex_x, ridge_corner_y], [ridge_corner_x, ridge_corner_y]], color: DESIGN_BLUE },   // main S
  ];
  const backdropSvg = faceBackdrops.map(f => {
    const rotated = f.poly.map(fwd);
    return `<polygon points="${polyAttr(rotated)}" fill="${f.color}" fill-opacity="0.25" stroke="none"/>`;
  }).join('');

  const stripSvg = allRenderStrips.map(s => {
    const c = s._designColor || designColor[s.region] || s.origColor || '#cccccc';
    const op = isOffcutStrip(s) ? 0.5 : 0.65;
    const patternId = c === DESIGN_ORANGE ? 'hatchOrange' : c === DESIGN_BLUE ? 'hatchBlue' : 'hatchGrey';
    return isOffcutStrip(s)
      ? `<polygon points="${polyAttr(s.poly)}" fill="${c}" fill-opacity="${op}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
         <polygon points="${polyAttr(s.poly)}" fill="url(#${patternId})" stroke="none"/>`
      : `<polygon points="${polyAttr(s.poly)}" fill="${c}" fill-opacity="${op}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
  }).join('');

  // Labels: inline for non-small, callouts for hip-end / very small strips.
  function stripBBox(s) {
    const xs = s.poly.map(p => p[0]); const ys = s.poly.map(p => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  function isSmall(s) {
    const d = stripBBox(s);
    if (d.w < 22 || d.h < 22) return true;
    if (s.region && s.region.endsWith('_half')) return true;
    return false;
  }
  const calloutsByRegion = {};
  const insideLabels = [];
  allRenderStrips.forEach(s => {
    if (isSmall(s)) (calloutsByRegion[s.region] = calloutsByRegion[s.region] || []).push(s);
    else insideLabels.push({ cx: s._centroid[0], cy: s._centroid[1], num: s._num });
  });
  function place(region, sortFn, lxFn, lyFn) {
    const g = (calloutsByRegion[region] || []).slice();
    g.sort(sortFn);
    return g.map((s, i) => {
      // Callout target positions are computed in CANONICAL space and
      // then forward-rotated so they land correctly for any orientation.
      const [lx, ly] = fwd([lxFn(i, g.length), lyFn(i, g.length)]);
      return { cx: s._centroid[0], cy: s._centroid[1], num: s._num, lx, ly };
    });
  }
  // Place callouts outside the building outline (canonical-space targets).
  const cN_W = place('wingN_W_half', (a, b) => a._centroid[0] - b._centroid[0], (i) => ox + i * (arm_w / 12), () => oy - 25);
  const cN_E = place('wingN_E_half', (a, b) => a._centroid[0] - b._centroid[0], (i) => ridge_corner_x + 8 + i * (arm_w / 12), () => oy - 25);
  const cE_N = place('mainE_N_half', (a, b) => a._centroid[1] - b._centroid[1], () => ox + arm_len + 25, (i) => reflex_y + i * (arm_w / 12));
  const cE_S = place('mainE_S_half', (a, b) => a._centroid[1] - b._centroid[1], () => ox + arm_len + 25, (i) => ridge_corner_y + 8 + i * (arm_w / 12));
  const allCallouts = [...cN_W, ...cN_E, ...cE_N, ...cE_S];
  const calloutSvg = allCallouts.map(c => `
    <line x1="${toX(c.cx).toFixed(1)}" y1="${toY(c.cy).toFixed(1)}" x2="${toX(c.lx).toFixed(1)}" y2="${toY(c.ly).toFixed(1)}" stroke="rgba(0,0,0,0.5)" stroke-width="0.7"/>
    <circle cx="${toX(c.lx).toFixed(1)}" cy="${toY(c.ly).toFixed(1)}" r="8" fill="#fff" stroke="#0a1628" stroke-width="0.8"/>
    <text x="${toX(c.lx).toFixed(1)}" y="${toY(c.ly).toFixed(1)}" font-family="Inter,sans-serif" font-size="9" font-weight="700" fill="#0a1628" text-anchor="middle" dominant-baseline="central">${c.num}</text>`).join('');
  const labelSvg = insideLabels.map(l => `<text x="${toX(l.cx).toFixed(1)}" y="${toY(l.cy).toFixed(1)}" font-family="Inter,sans-serif" font-size="9" font-weight="700" fill="#0a1628" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="rgba(255,255,255,0.93)" stroke-width="2.2" stroke-linejoin="round">${l.num}</text>`).join('');

  const totalSheets = keysList.length;
  return `
    <g>
      <text x="${W/2}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#0a1628">${c.label}</text>
      <text x="${W/2}" y="38" text-anchor="middle" font-size="11" fill="#475569">${totalSheets} sheets • ${valleySlices} valley slices • sheet length ${half_w}px</text>
      <polygon points="${polyAttr(outline)}" fill="none" stroke="#0a1628" stroke-width="1.5"/>
      ${backdropSvg}
      ${stripSvg}
      ${lineSvg(hips, '#16a34a')}
      ${lineSvg(ridges, '#dc2626')}
      ${lineSvg(valleys, '#f59e0b', '6,3')}
      ${labelSvg}${calloutSvg}
    </g>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  const groups = [];
  for (const c of CASES) {
    const g = await renderCase(page, c);
    groups.push(g);
    console.log(`rendered ${c.label}`);
  }
  await browser.close();

  // ── 3-column grid of N cases ──
  const W = 600, H = 600;
  const cols = 3;
  const rows = Math.ceil(groups.length / cols);
  const totalW = W * cols + 20 * (cols + 1);
  const totalH = H * rows + 30 * (rows + 1);
  const cellPositions = groups.map((g, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return `<g transform="translate(${20 + col * (W + 20)}, ${30 + row * (H + 30)})">${g}</g>`;
  });
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="background:#fff;font-family:Inter,sans-serif">
    <defs>
      <pattern id="hatchOrange" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#c2410c" stroke-width="2.2"/>
      </pattern>
      <pattern id="hatchBlue" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#1e3a8a" stroke-width="2.2"/>
      </pattern>
      <pattern id="hatchGrey" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#374151" stroke-width="2.2"/>
      </pattern>
    </defs>
    ${cellPositions.join('')}
  </svg>`;
  fs.writeFileSync('floodroofing/docs/perfect_L_designs_grid.svg', svg);

  // Rasterise.
  const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx2 = await browser2.newContext({ deviceScaleFactor: 2, viewport: { width: totalW, height: totalH } });
  const page2 = await ctx2.newPage();
  await page2.setContent(svg);
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: 'floodroofing/docs/perfect_L_designs_grid.png', fullPage: false });
  console.log('wrote floodroofing/docs/perfect_L_designs_grid.png');
  await browser2.close();
})().catch(e => { console.error(e); process.exit(1); });
