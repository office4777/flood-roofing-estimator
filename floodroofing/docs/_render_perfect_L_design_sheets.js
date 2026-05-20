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
    wingE: DESIGN_BLUE,
    wingW_extHip: DESIGN_ORANGE,     // I: SW-clipped wing W = orange donor (matches A)
    mainN: DESIGN_ORANGE,            // C: orange main N
    mainS: DESIGN_BLUE,              // J: blue main S (incl. SW corner 76..108)
    // End-hip offcuts: each half coloured to match the donor it pairs with
    wingN_W_half: DESIGN_BLUE,       // offcut from wing E (blue)
    wingN_E_half: DESIGN_ORANGE,     // offcut from wing W (orange)
    mainE_N_half: DESIGN_BLUE,       // offcut from main S (blue)
    mainE_S_half: DESIGN_ORANGE,     // offcut from main N (orange)
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

  // For strips classified as one of our design regions, recolour.  For
  // everything else (the main face strips not touched by the cascade),
  // keep the original 6-face colour.
  const stripSvg = strips.map(s => {
    const c = designColor[s.region] || s.origColor || '#cccccc';
    const op = s.region.includes('_half') ? 0.55 : 0.65;
    return `<polygon points="${polyAttr(s.poly)}" fill="${c}" fill-opacity="${op}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>`;
  }).join('');

  // ── The two internal valley triangles ──
  // The cascade fills these with offcuts from the two external hip
  // donor sheets at the SW corner.  Each offcut matches its donor's
  // colour:
  //   North of valley (in wing E face) <- offcut from main S west
  //     donor (orange 76..108) → ORANGE.
  //   South of valley (in main N face) <- offcut from wing W bottom
  //     donor (the SW-clipped wing W which is BLUE) → BLUE.
  const valleyTriangles = [
    { pts: [[500,700],[300,700],[300,900]], fill: DESIGN_ORANGE },  // north of valley
    { pts: [[500,700],[500,900],[300,900]], fill: DESIGN_BLUE   },  // south of valley
  ];
  const valleySvg = valleyTriangles.map(t =>
    `<polygon points="${polyAttr(t.pts)}" fill="${t.fill}" fill-opacity="1" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`
  ).join('');

  const outlinePolyAttr = polyAttr(outline);

  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Inter,sans-serif">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/>
      </marker>
    </defs>
    <text x="${W/2}" y="38" text-anchor="middle" font-size="24" font-weight="700" fill="#0a1628">Perfect-L cascade — sheets placed per the design</text>
    <text x="${W/2}" y="62" text-anchor="middle" font-size="13" fill="#475569">Strips re-coloured: orange = orange-fed donor or destination, blue = blue-fed. Geometry from the 6-face cascade.</text>
    <text x="${W/2}" y="82" text-anchor="middle" font-size="13" fill="#475569">Each cross-pair arrow shows where the donor sheets' offcuts land.</text>

    <polygon points="${outlinePolyAttr}" fill="none" stroke="#0a1628" stroke-width="2.5"/>
    ${stripSvg}
    ${valleySvg}
    ${lineSvg(hips, '#16a34a')}
    ${lineSvg(ridges, '#dc2626')}
    ${lineSvg(valleys, '#f59e0b', '10,5')}

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
