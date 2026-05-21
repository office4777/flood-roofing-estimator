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
const CASES = [
  { label: 'K: arm_w=400, arm_len=1000 (canonical)', ox: 100, oy: 100, arm_w: 400, arm_len: 1000 },
  { label: 'L: arm_w=300, arm_len=900 (smaller)',    ox: 100, oy: 100, arm_w: 300, arm_len: 900 },
  { label: 'M: arm_w=500, arm_len=1100 (wider)',     ox: 100, oy: 100, arm_w: 500, arm_len: 1100 },
  { label: 'N: arm_w=350, arm_len=1100 (longer)',    ox: 100, oy: 100, arm_w: 350, arm_len: 1100 },
];

// ── Build the cascade design SVG for one case ──────────────────────────
async function renderCase(page, c) {
  const { ox, oy, arm_w, arm_len } = c;
  const half_w  = arm_w / 2;                    // = sheet length for all faces
  const reflex_x = ox + arm_w;
  const reflex_y = oy + arm_len - arm_w;
  const ridge_corner_x = ox + half_w;
  const ridge_corner_y = oy + arm_len - half_w;
  const main_apex_x = ox + arm_len - half_w;    // ridge end on the main arm
  const wing_apex_y = oy + half_w;               // ridge top on the wing arm
  const valley_sum = ox + oy + arm_len;          // valley line: x + y = valley_sum
  const sw_corner_x = ox;
  const sw_corner_y = oy + arm_len;
  const se_corner_x = ox + arm_len;
  const se_corner_y = oy + arm_len;
  const ne_corner_x = ox + arm_len;
  const ne_corner_y = oy + arm_len - arm_w;      // = reflex_y

  const outline = [
    [ox, oy], [ox+arm_w, oy], [ox+arm_w, reflex_y],
    [ox+arm_len, reflex_y], [ox+arm_len, oy+arm_len], [ox, oy+arm_len]
  ];

  // Push outline into the app and grab the 6-face cascade output.
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
  const strips = await page.evaluate(() => (window.__lastAllStrips || []).map(s => ({
    origColor: s.color,
    facePoly: s.face && s.face.poly ? s.face.poly.map(p => p.slice()) : null,
    poly: s.poly.map(p => p.slice()),
  })));

  // ── Classify each strip by its strip-centroid position ──
  // Robust position-based classification using building geometry.
  function classify(s) {
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

    // C area: main N donor zone between valley apex (reflex_x) and main E apex.
    if (cx > reflex_x && cx < main_apex_x && cy > reflex_y && cy < ridge_corner_y) return 'mainN';
    // Wing N hip-end: above wing N apex (cy < wing_apex_y), cx in [ox, ox+arm_w].
    if (cy < wing_apex_y && cx > ox && cx < ox + arm_w) {
      return cx < ridge_corner_x ? 'wingN_W_half' : 'wingN_E_half';
    }
    // Main E hip-end: right of main E apex.
    if (cx > main_apex_x && cy > reflex_y && cy < oy + arm_len) {
      return cy < ridge_corner_y ? 'mainE_N_half' : 'mainE_S_half';
    }
    // Wing W long-side: cx < ridge_corner_x, cy between wing N apex and SW corner.
    if (cx < ridge_corner_x && cy > wing_apex_y && cy < oy + arm_len) {
      // SW-clipped (extHip) if centroid is below ridge_corner_y (i.e., near SW hip area)
      return cy > ridge_corner_y ? 'wingW_extHip' : 'wingW';
    }
    // Wing E long-side: between ridge and reflex_x, above reflex_y.
    if (cx > ridge_corner_x && cx < reflex_x && cy > wing_apex_y && cy < reflex_y) return 'wingE';
    // Main S long-side: cy > ridge_corner_y, cx between SW corner area and main_apex_x area.
    if (cy > ridge_corner_y && cy < oy + arm_len && cx > ox && cx < main_apex_x) return 'mainS';
    return 'other';
  }
  strips.forEach(s => { s.region = classify(s); });

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
  const stripsKept = strips.filter(s => {
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (cx > reflex_x && cx < main_apex_x + C_eps && cy > reflex_y && cy < ridge_corner_y) return false;
    if (inValleyA(cx, cy) || inValleyB(cx, cy)) return false;
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
    if (s.region === 'mainN' && cx > main_apex_x - arm_w) s.region = 'mainN_east';
    if (s.region === 'mainS' && cx > main_apex_x - arm_w) s.region = 'mainS_east';
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

  // ── Compose the per-case SVG ──
  const W = 600, H = 600;
  const minX = ox - 30, minY = oy - 30, maxX = ox + arm_len + 30, maxY = oy + arm_len + 30;
  const scale = Math.min((W - 30) / (maxX - minX), (H - 80) / (maxY - minY));
  const padX = (W - (maxX - minX) * scale) / 2;
  const padY = 60;
  const toX = x => padX + (x - minX) * scale;
  const toY = y => padY + (y - minY) * scale;
  const polyAttr = (p) => p.map(pt => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ');

  // Hip / ridge / valley lines for this geometry.
  const hips = [
    [[ox, oy], [ridge_corner_x, wing_apex_y]],
    [[ox+arm_w, oy], [ridge_corner_x, wing_apex_y]],
    [[ox+arm_len, reflex_y], [main_apex_x, ridge_corner_y]],
    [[ox+arm_len, oy+arm_len], [main_apex_x, ridge_corner_y]],
    [[ox, oy+arm_len], [ridge_corner_x, ridge_corner_y]],
  ];
  const ridges = [
    [[ridge_corner_x, wing_apex_y], [ridge_corner_x, ridge_corner_y]],
    [[ridge_corner_x, ridge_corner_y], [main_apex_x, ridge_corner_y]],
  ];
  const valleys = [[[reflex_x, reflex_y], [ridge_corner_x, ridge_corner_y]]];
  const lineSvg = (lines, color, dash='') => lines.map(([a, b]) =>
    `<line x1="${toX(a[0])}" y1="${toY(a[1])}" x2="${toX(b[0])}" y2="${toY(b[1])}" stroke="${color}" stroke-width="2" ${dash?`stroke-dasharray="6,3"`:''}/>`
  ).join('');

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
    return g.map((s, i) => ({ cx: s._centroid[0], cy: s._centroid[1], num: s._num, lx: lxFn(i, g.length), ly: lyFn(i, g.length) }));
  }
  // Place callouts outside the building outline.
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

  // ── 2x2 grid of cases ──
  const W = 600, H = 600;
  const totalW = W * 2 + 40, totalH = H * 2 + 60;
  const cellPositions = [
    `<g transform="translate(0, 0)">${groups[0]}</g>`,
    `<g transform="translate(${W + 20}, 0)">${groups[1]}</g>`,
    `<g transform="translate(0, ${H + 30})">${groups[2]}</g>`,
    `<g transform="translate(${W + 20}, ${H + 30})">${groups[3]}</g>`,
  ];
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
