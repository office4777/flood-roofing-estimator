// Render the perfect L with the user's cascade design applied.
// Approach: take the 6-face cascade's strip positions (which are
// geometrically correct), reclassify each strip into one of the design
// regions, recolour and re-pair, then render externally with arrows.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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

  const outline = [[100,100],[500,100],[500,700],[1100,700],[1100,1100],[100,1100]];
  await page.evaluate((outline) => {
    window.DRAW.outline = outline;
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  }, outline);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.gotoTab && window.gotoTab('materials');
    window.renderRoofSheetPlan && window.renderRoofSheetPlan();
  });
  await page.waitForTimeout(700);

  const strips = await page.evaluate(() => {
    const all = window.__lastAllStrips || [];
    return all.map(s => ({
      origColor: s.color,
      faceType: s.face && s.face.type,
      facePoly: s.face && s.face.poly ? s.face.poly.map(p => p.slice()) : null,
      centroid: s.centroid.slice(),
      poly: s.poly.map(p => p.slice()),
    }));
  });
  await browser.close();

  // Face-polygon centroid for each strip's face to identify which face
  // it belongs to robustly.
  function faceCentroid(poly) {
    if (!poly || !poly.length) return null;
    let cx = 0, cy = 0;
    poly.forEach(p => { cx += p[0]; cy += p[1]; });
    return [cx / poly.length, cy / poly.length];
  }

  // ── Cascade-design classification (face-based using face polygon) ──
  // Use the strip's face polygon centroid to identify which face it's
  // on.  Each Big-L face has a distinctive centroid:
  //   wing N hip-end   : ~(300, 167)   small y
  //   main E hip-end   : ~(1033, 900)  large x
  //   wing W long-side : ~(200, 600)
  //   wing E long-side : ~(375, 525)   (with valley clip, smaller area)
  //   main N long-side : ~(700, 800)
  //   main S long-side : ~(600, 1000)
  function classify(s) {
    const fc = faceCentroid(s.facePoly);
    if (!fc) return 'other';
    const [fx, fy] = fc;
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // Override (strip-centroid based): anything in the C area (main N
    // long-side between the valley and E hip-end) is orange regardless
    // of which face the 6-face cascade assigned it to.  This catches
    // phantom-extended wing E strips and any offcut-purple strips
    // that ended up in this region.
    if (cx > 500 && cx < 900 && cy > 700 && cy < 900) return 'mainN';
    // Wing N hip-end (face centroid near top)
    if (fy < 220 && fx > 200 && fx < 400) {
      return cx < 300 ? 'wingN_W_half' : 'wingN_E_half';
    }
    // Main E hip-end (face centroid far east)
    if (fx > 1000 && fy > 800 && fy < 1000) {
      return cy < 900 ? 'mainE_N_half' : 'mainE_S_half';
    }
    // Wing W long-side: split into TOP (regular orange) and BOTTOM
    // (clipped by SW hip — this is the "external hip face" donor)
    if (fx < 250 && fy > 400 && fy < 900) {
      return cy > 900 ? 'wingW_extHip' : 'wingW';
    }
    // Wing E long-side
    if (fx > 300 && fx < 500 && fy > 200 && fy < 700) return 'wingE';
    // Main N long-side (face-centroid catch — most strips already
    // caught by the C-area override above)
    if (fx > 500 && fx < 1000 && fy > 700 && fy < 900) return 'mainN';
    // Main S long-side
    if (fx > 300 && fx < 1000 && fy > 950) return 'mainS';
    return 'other';
  }

  strips.forEach(s => { s.region = classify(s); });

  // ── Recolour per design ──
  // Donor zones keep their colour; offcut destinations take the donor's colour.
  //   wingW donors (orange) -> wing N E half  (orange offcuts there)
  //   wingE donors (blue)   -> wing N W half  (blue offcuts there)
  //   mainN donors (orange) -> main E S half  (orange offcuts there)
  //   mainS donors (blue)   -> main E N half  (blue offcuts there)
  //   mainS-west (orange)   -> valley N       (orange offcut there)
  //   wingW-bottom (orange) -> valley S       (orange offcut there)
  const DESIGN_ORANGE = '#f97316';
  const DESIGN_BLUE   = '#2563eb';
  // Keep main N / main S in their original 6-face colours; only the END
  // HIPS get re-coloured so the offcut matches its donor.
  const designColor = {
    wingW: DESIGN_ORANGE,
    wingW_top: DESIGN_ORANGE,           // sub-region (matches wingW)
    wingE: DESIGN_BLUE,
    wingE_top: DESIGN_BLUE,             // sub-region (matches wingE)
    wingW_extHip: DESIGN_ORANGE,        // I: SW-clipped wing W = orange donor (matches A)
    mainN: DESIGN_ORANGE,               // C: orange main N
    mainN_east: DESIGN_ORANGE,          // sub-region (matches mainN)
    mainS: DESIGN_BLUE,                 // J: blue main S (incl. SW corner 76..108)
    mainS_east: DESIGN_BLUE,            // sub-region (matches mainS)
    // End-hip offcuts: each half coloured to match the donor it pairs with
    wingN_W_half: DESIGN_BLUE,          // offcut from wing E (blue)
    wingN_E_half: DESIGN_ORANGE,        // offcut from wing W (orange)
    mainE_N_half: DESIGN_BLUE,          // offcut from main S (blue)
    mainE_S_half: DESIGN_ORANGE,        // offcut from main N (orange)
  };

  // ── Render to SVG ──
  // Layout
  const W = 1500, H = 1300;
  const minX = 0, minY = 0, maxX = 1200, maxY = 1200;
  const scale = Math.min((W - 200) / (maxX - minX), (H - 200) / (maxY - minY));
  const padX = (W - (maxX - minX) * scale) / 2;
  const padY = 110;
  const toX = x => padX + (x - minX) * scale;
  const toY = y => padY + (y - minY) * scale;
  const polyAttr = (p) => p.map(pt => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ');

  // Hip / ridge / valley lines (from auto-generate)
  const hips = [
    [[100,100],[300,300]], [[500,100],[300,300]],
    [[1100,700],[900,900]], [[1100,1100],[900,900]],
    [[100,1100],[300,900]],
  ];
  const ridges = [[[300,300],[300,900]], [[300,900],[900,900]]];
  const valleys = [[[500,700],[300,900]]];
  const lineSvg = (lines, color, dash='') => lines.map(([a, b]) =>
    `<line x1="${toX(a[0])}" y1="${toY(a[1])}" x2="${toX(b[0])}" y2="${toY(b[1])}" stroke="${color}" stroke-width="2.5" ${dash?`stroke-dasharray="${dash}"`:''}/>`
  ).join('');

  // ── Filter out the C area strips and the inside-corner valley area ──
  //    C area = main N long-side donor area between valley and E hip-end.
  //    Inside corner = the two valley triangles (A north, B south) which
  //    we redraw with our subdivisions.  Without this filter, the 6-face
  //    cascade's wing E strips and mainN strips at the valley area
  //    overlay the valley triangle subdivisions.
  const C_xMin = 500, C_xMax = 900, C_yMin = 700, C_yMax = 900;
  // Test if centroid is inside the A triangle (north of valley) OR the
  // B triangle (south of valley).  Both share x=300..500, y=700..900,
  // separated by the valley line y = 1200 - x.
  function inValleyA(cx, cy) {
    // North of valley (above the diagonal): x in [300, 500], y in [700, 900],
    // and y < 1200 - x.
    return cx >= 300 && cx <= 500 && cy >= 700 && cy <= 900 && cy < 1200 - cx;
  }
  function inValleyB(cx, cy) {
    // South of valley: x in [300, 500], y in [700, 900], and y > 1200 - x.
    return cx >= 300 && cx <= 500 && cy >= 700 && cy <= 900 && cy > 1200 - cx;
  }
  const stripsKept = strips.filter(s => {
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // C area (main N donor region) — extend slightly past x=900 to
    // catch the apex-straddle strip.
    if (cx > C_xMin && cx < C_xMax + 19 && cy > C_yMin && cy < C_yMax) return false;
    // Valley triangles: drop only strips whose centroid is strictly
    // inside A or B.
    if (inValleyA(cx, cy) || inValleyB(cx, cy)) return false;
    return true;
  });
  const coverPx = 38.1;
  const fullLengthStrips = [];
  for (let x = C_xMin; x < C_xMax - 0.1; x += coverPx) {
    const xa = x, xb = Math.min(x + coverPx, C_xMax);
    fullLengthStrips.push({
      poly: [[xa, C_yMin], [xb, C_yMin], [xb, C_yMax], [xa, C_yMax]],
      region: 'mainN',  // → DESIGN_ORANGE
      isFullLength: true,
    });
  }

  // ── The two internal valley triangles ──
  // A = north of valley (orange offcuts from wing W bottom donors).
  //     Horizontal strips matching wing W natural orientation.
  // B = south of valley (BLUE offcuts from main S east donors clipped
  //     by SE hip).  Vertical strips matching main N donor orientation
  //     (perpendicular to the N gutter at y=700).
  const valleyStrips = [];
  // A: horizontal strips of A clipped to triangle (500,700)-(300,700)-(300,900).
  for (let i = 0; i < 5; i++) {
    const ya = 700 + i * 40, yb = 700 + (i + 1) * 40;
    const xEa = 1200 - ya, xEb = 1200 - yb;
    valleyStrips.push({
      poly: [[300, ya], [xEa, ya], [xEb, yb], [300, yb]],
      region: 'valley_A',                  // orange offcut
      _designColor: DESIGN_ORANGE,
      _pairRegion: 'wingW_extHip',         // pairs with wing W bottom donor
      _pairIdx: i,                         // i=0 (top of A, smallest) ↔ wingW bottom idx 0
      _isOffcut: true,
    });
  }
  // B: vertical strips of B clipped to triangle (500,700)-(500,900)-(300,900).
  //   x bands from x=300..500.  Each strip clipped above by valley
  //   (y_top = 1200 - x), below by ridge y=900.
  for (let i = 0; i < 5; i++) {
    const xa = 300 + i * 40, xb = 300 + (i + 1) * 40;
    const yTa = 1200 - xa, yTb = 1200 - xb;
    valleyStrips.push({
      poly: [[xa, yTa], [xb, yTb], [xb, 900], [xa, 900]],
      region: 'valley_B',                  // blue offcut
      _designColor: DESIGN_BLUE,
      _pairRegion: 'mainS_east',           // pairs with main S east donor
      _pairIdx: i,                         // i=0 (smallest strip) ↔ mainS east idx 0
      _isOffcut: true,
    });
  }

  // For strips classified as one of our design regions, recolour.  For
  // everything else (the main face strips not touched by the cascade),
  // keep the original 6-face colour.
  const allRenderStrips = [...stripsKept, ...fullLengthStrips, ...valleyStrips];
  allRenderStrips.forEach(s => { if (!s.region) s.region = classify(s); });

  // Compute strip centroid using polygon shoelace (area-weighted).  This
  // is necessary so that triangle-shaped strips in the valley don't
  // collide with their neighbours at the same bbox centroid.  Falls back
  // to bbox centroid for degenerate polygons.
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

  // Refine region: split big regions into donor sub-regions used by the
  // pairing map.  Without this the pairTo lookup misses (e.g. wingN_E_half
  // pairs with 'wingW_top' but the actual donor strip's region is just
  // 'wingW' until we tag it).
  allRenderStrips.forEach(s => {
    const [cx, cy] = s._centroid;
    if (s.region === 'wingW' && cy < 300) s.region = 'wingW_top';
    if (s.region === 'wingE' && cy < 300) s.region = 'wingE_top';
    if (s.region === 'mainN' && cx > 900) s.region = 'mainN_east';
    if (s.region === 'mainS' && cx > 900) s.region = 'mainS_east';
  });

  // ── Sheet-identity numbering by SORT-AND-INDEX ──
  // Group strips by region, sort by appropriate axis, assign sequential
  // indices.  Pairs share keys so donor and offcut get the same final
  // sheet number after global numbering.  Length-conservation: smallest
  // donor (clipped most, largest offcut) pairs with largest destination
  // strip.
  const regionGroups = {};
  allRenderStrips.forEach(s => {
    (regionGroups[s.region] = regionGroups[s.region] || []).push(s);
  });
  function sortAndIndex(region, comparator) {
    const g = regionGroups[region];
    if (!g) return;
    g.sort(comparator);
    g.forEach((s, i) => { s._idx = i; });
  }
  // Donors: ascending by their position axis (small-to-large donor).
  sortAndIndex('wingW_top',    (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('wingE_top',    (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('mainN_east',   (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('mainS_east',   (a, b) => a._centroid[0] - b._centroid[0]);
  // Destinations: sort to pair with donor's offcut size (length conservation).
  // - Wing W/E top donors: smallest cy = LARGEST offcut. Dest idx 0 must be
  //   the LARGEST dest (closest to apex).
  //     wingN_E_half cx ASC: small cx = near apex = LARGEST dest.
  //     wingN_W_half cx DESC: large cx = near apex = LARGEST dest.
  // - Main N/S east donors: smallest cx = least-clipped = SMALLEST offcut.
  //   Dest idx 0 must be SMALLEST dest (closest to gutter).
  //     mainE_S_half cy DESC: large cy = near gutter = SMALLEST dest.
  //     mainE_N_half cy ASC: small cy = near gutter = SMALLEST dest.
  sortAndIndex('wingN_E_half', (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('wingN_W_half', (a, b) => b._centroid[0] - a._centroid[0]);
  sortAndIndex('mainE_S_half', (a, b) => b._centroid[1] - a._centroid[1]);
  sortAndIndex('mainE_N_half', (a, b) => a._centroid[1] - b._centroid[1]);
  // Non-paired regions.
  sortAndIndex('wingW',        (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('wingW_extHip', (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('wingE',        (a, b) => a._centroid[1] - b._centroid[1]);
  sortAndIndex('mainN',        (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('mainS',        (a, b) => a._centroid[0] - b._centroid[0]);
  sortAndIndex('mainS_west',   (a, b) => a._centroid[1] - b._centroid[1]);

  // Cross-pair: destination shares its donor's region+index key.
  const pairTo = {
    'wingN_E_half': 'wingW_top',
    'wingN_W_half': 'wingE_top',
    'mainE_S_half': 'mainN_east',
    'mainE_N_half': 'mainS_east',
  };
  allRenderStrips.forEach(s => {
    // Valley strips have explicit pair info.
    if (s._pairRegion != null && s._pairIdx != null) {
      s._key = `${s._pairRegion}:${s._pairIdx}`;
      return;
    }
    if (s._key) return;
    const region = pairTo[s.region] || s.region;
    s._key = `${region}:${s._idx != null ? s._idx : Math.round(s._centroid[0])+','+Math.round(s._centroid[1])}`;
  });

  // Sort distinct keys by representative position and assign 1..N.
  const keyGroups = {};
  allRenderStrips.forEach(s => {
    (keyGroups[s._key] = keyGroups[s._key] || []).push(s);
  });
  const keysList = Object.keys(keyGroups);
  keysList.sort((a, b) => {
    // Use the FIRST non-offcut piece (largest area) as representative.
    const aRep = keyGroups[a].slice().sort((x, y) => (y.poly.length - x.poly.length))[0]._centroid;
    const bRep = keyGroups[b].slice().sort((x, y) => (y.poly.length - x.poly.length))[0]._centroid;
    return aRep[1] - bRep[1] || aRep[0] - bRep[0];
  });
  const numByKey = {};
  keysList.forEach((k, i) => { numByKey[k] = i + 1; });
  allRenderStrips.forEach(s => { s._num = numByKey[s._key]; });

  // Offcut destinations: cross-pair hip-end halves + valley strips.
  // These should be rendered with a hatched pattern (like Big-L's
  // isOffcut shading) so they're visibly distinct from donor sheets.
  function isOffcutStrip(s) {
    if (s._isOffcut) return true;
    if (s.region && s.region.endsWith('_half')) return true;
    return false;
  }
  const stripSvg = allRenderStrips.map(s => {
    const c = s._designColor || designColor[s.region] || s.origColor || '#cccccc';
    const op = isOffcutStrip(s) ? 0.5 : 0.65;
    // Hatched overlay for offcuts: draw the solid colour at lower
    // opacity, then overlay a diagonal hatch pattern.
    const patternId = c === DESIGN_ORANGE ? 'hatchOrange' :
                      c === DESIGN_BLUE   ? 'hatchBlue'   : 'hatchGrey';
    const fill = isOffcutStrip(s)
      ? `<polygon points="${polyAttr(s.poly)}" fill="${c}" fill-opacity="${op}" stroke="rgba(0,0,0,0.3)" stroke-width="0.6"/>
         <polygon points="${polyAttr(s.poly)}" fill="url(#${patternId})" stroke="none"/>`
      : `<polygon points="${polyAttr(s.poly)}" fill="${c}" fill-opacity="${op}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>`;
    return fill;
  }).join('');

  // Polygon area helper (shoelace).
  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  // Sheet-number labels.  For small strips (where a label wouldn't fit)
  // use a leader line to an external callout circle so the number is
  // readable.  For larger strips, label inside at the centroid.
  function stripDims(s) {
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    return {
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  // A strip needs a callout if its bbox is small OR if it's in a
  // hip-end region (where centroids are too close together for inline
  // labels to read clearly).
  function isSmall(s) {
    const d = stripDims(s);
    if (d.w < 22 || d.h < 22) return true;
    if (s.region && s.region.endsWith('_half')) return true;
    return false;
  }

  // Group small strips by their region for callout placement.
  const calloutsByRegion = {};
  const insideLabels = [];
  allRenderStrips.forEach(s => {
    if (isSmall(s)) {
      (calloutsByRegion[s.region] = calloutsByRegion[s.region] || []).push(s);
    } else {
      const [cx, cy] = s._centroid;
      insideLabels.push({ cx, cy, num: s._num });
    }
  });

  // Place callouts per region in an outside zone with a sensible
  // direction.  Each region's callouts are stacked along the edge
  // farthest from the building, sorted by the donor band so the
  // sequence reads naturally.
  function place(region, sortFn, lxFn, lyFn) {
    const group = (calloutsByRegion[region] || []).slice();
    group.sort(sortFn);
    return group.map((s, i) => ({
      cx: s._centroid[0], cy: s._centroid[1], num: s._num,
      lx: lxFn(i, group.length), ly: lyFn(i, group.length),
    }));
  }
  // wingN_W_half (top-left of wing) → callouts above the wing.
  const cN_W = place('wingN_W_half',
    (a, b) => a._centroid[0] - b._centroid[0],   // sort by x ascending
    (i, n) => 100 + i * 32,                       // x stacked
    (i) => 50);                                   // y above building
  // wingN_E_half (top-right of wing) → callouts above the wing too.
  const cN_E = place('wingN_E_half',
    (a, b) => a._centroid[0] - b._centroid[0],
    (i, n) => 320 + i * 32,
    (i) => 50);
  // mainE_N_half (north half of E hip-end) → callouts above the main arm.
  const cE_N = place('mainE_N_half',
    (a, b) => a._centroid[1] - b._centroid[1],
    (i, n) => 1170,
    (i) => 700 + i * 32);
  // mainE_S_half → callouts to the right.
  const cE_S = place('mainE_S_half',
    (a, b) => a._centroid[1] - b._centroid[1],
    (i, n) => 1170,
    (i) => 950 + i * 32);
  // wingW_extHip (SW area of wing W) → callouts to the left of bottom.
  const cWext = place('wingW_extHip',
    (a, b) => a._centroid[1] - b._centroid[1],
    (i, n) => 30,
    (i) => 920 + i * 32);
  // mainS_west (SW corner of main S) → callouts below the main arm.
  const cSwest = place('mainS_west',  // may not have entries
    (a, b) => a._centroid[0] - b._centroid[0],
    (i, n) => 100 + i * 32,
    (i) => 1180);

  const allCallouts = [...cN_W, ...cN_E, ...cE_N, ...cE_S, ...cWext, ...cSwest];

  const calloutSvg = allCallouts.map(c => {
    return `<line x1="${toX(c.cx).toFixed(1)}" y1="${toY(c.cy).toFixed(1)}" x2="${toX(c.lx).toFixed(1)}" y2="${toY(c.ly).toFixed(1)}" stroke="rgba(0,0,0,0.55)" stroke-width="0.8"/>
            <circle cx="${toX(c.lx).toFixed(1)}" cy="${toY(c.ly).toFixed(1)}" r="11" fill="#fff" stroke="#0a1628" stroke-width="1"/>
            <text x="${toX(c.lx).toFixed(1)}" y="${toY(c.ly).toFixed(1)}" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="#0a1628" text-anchor="middle" dominant-baseline="central">${c.num}</text>`;
  }).join('');

  const labelSvg = insideLabels.map(l => {
    return `<text x="${toX(l.cx).toFixed(1)}" y="${toY(l.cy).toFixed(1)}" font-family="Inter,sans-serif" font-size="11" font-weight="700" fill="#0a1628" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="rgba(255,255,255,0.93)" stroke-width="2.8" stroke-linejoin="round">${l.num}</text>`;
  }).join('') + calloutSvg;

  const outlinePolyAttr = polyAttr(outline);

  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Inter,sans-serif">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/>
      </marker>
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
    <text x="${W/2}" y="38" text-anchor="middle" font-size="24" font-weight="700" fill="#0a1628">Perfect-L cascade — sheets placed per the design</text>
    <text x="${W/2}" y="62" text-anchor="middle" font-size="13" fill="#475569">Strips re-coloured: orange = orange-fed donor or destination, blue = blue-fed. Geometry from the 6-face cascade.</text>
    <text x="${W/2}" y="82" text-anchor="middle" font-size="13" fill="#475569">Each cross-pair arrow shows where the donor sheets' offcuts land.</text>

    <polygon points="${outlinePolyAttr}" fill="none" stroke="#0a1628" stroke-width="2.5"/>
    ${stripSvg}
    ${lineSvg(hips, '#16a34a')}
    ${lineSvg(ridges, '#dc2626')}
    ${lineSvg(valleys, '#f59e0b', '10,5')}
    ${labelSvg}

    <!-- Cross-pair arrows -->
    <!-- Wing N: W donors -> E half ; E donors -> W half -->
    <line x1="${toX(180)}" y1="${toY(270)}" x2="${toX(380)}" y2="${toY(200)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>
    <line x1="${toX(420)}" y1="${toY(270)}" x2="${toX(220)}" y2="${toY(200)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>

    <!-- Main E: N donors -> S half ; S donors -> N half -->
    <line x1="${toX(960)}" y1="${toY(810)}" x2="${toX(1040)}" y2="${toY(1000)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>
    <line x1="${toX(960)}" y1="${toY(1000)}" x2="${toX(1040)}" y2="${toY(810)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>

    <!-- External corner -> valleys -->
    <!-- main S west (76,78,96,102,108) -> NORTH of valley -->
    <line x1="${toX(220)}" y1="${toY(1020)}" x2="${toX(400)}" y2="${toY(800)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>
    <!-- wing W bottom -> SOUTH of valley -->
    <line x1="${toX(170)}" y1="${toY(1000)}" x2="${toX(290)}" y2="${toY(830)}" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/>

    <text x="${toX(500)}" y="${toY(700) - 14}" font-size="14" font-weight="700" fill="#dc2626" text-anchor="start">↑ reflex</text>

    <!-- Legend -->
    <g transform="translate(${W - 320}, 110)">
      <rect x="0" y="0" width="300" height="190" fill="#f8fafc" stroke="#cbd5e1" rx="8"/>
      <text x="14" y="22" font-size="13" font-weight="700">Legend</text>
      <rect x="14" y="34" width="22" height="14" fill="${DESIGN_ORANGE}" fill-opacity="0.65"/><text x="44" y="46" font-size="12">orange donor face / its offcut dest.</text>
      <rect x="14" y="56" width="22" height="14" fill="${DESIGN_BLUE}" fill-opacity="0.65"/><text x="44" y="68" font-size="12">blue donor face / its offcut dest.</text>
      <line x1="14" y1="86" x2="40" y2="86" stroke="#111" stroke-width="2.2" marker-end="url(#arrow)"/><text x="44" y="90" font-size="12">offcut flow direction</text>
      <line x1="14" y1="106" x2="40" y2="106" stroke="#16a34a" stroke-width="2.2"/><text x="44" y="110" font-size="12">hip</text>
      <line x1="14" y1="126" x2="40" y2="126" stroke="#dc2626" stroke-width="2.2"/><text x="44" y="130" font-size="12">ridge</text>
      <line x1="14" y1="146" x2="40" y2="146" stroke="#f59e0b" stroke-width="2.2" stroke-dasharray="10,5"/><text x="44" y="150" font-size="12">valley</text>
      <text x="14" y="178" font-size="11" font-style="italic" fill="#475569">Lighter shading on hip-ends &amp; valley = offcut destination</text>
    </g>
  </svg>`;

  fs.writeFileSync('floodroofing/docs/perfect_L_design_sheets.svg', svg);
  const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx2 = await browser2.newContext({ deviceScaleFactor: 2, viewport: { width: W, height: H } });
  const page2 = await ctx2.newPage();
  await page2.setContent(svg);
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: 'floodroofing/docs/perfect_L_design_sheets.png', fullPage: false });
  console.log('wrote floodroofing/docs/perfect_L_design_sheets.png');
  await browser2.close();
})().catch(e => { console.error(e); process.exit(1); });
