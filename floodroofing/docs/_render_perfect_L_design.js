// Annotated cascade design for the perfect L — v2 after user feedback.
//   * N wing N hip-end: cross-pair confirmed (W donors -> E half, E -> W).
//   * SE wing E hip-end: same cross-pair (N donors -> S half, S -> N).
//   * External corner (SW): both offcut triangles flow to the two valley
//     areas at the internal corner.
//     - Main's S long-side west donors' offcuts -> NORTH side of valley.
//     - Wing's W long-side bottom donors' offcuts -> SOUTH side of valley.

const fs = require('fs');
const path = require('path');

const outline = [[100,100],[500,100],[500,700],[1100,700],[1100,1100],[100,1100]];

const W = 1400, H = 1300;
const minX = 0, minY = 0, maxX = 1200, maxY = 1200;
const scale = Math.min((W - 240) / (maxX - minX), (H - 240) / (maxY - minY));
const padX = (W - (maxX - minX) * scale) / 2;
const padY = 110;
const toX = x => padX + (x - minX) * scale;
const toY = y => padY + (y - minY) * scale;

const outlinePoly = outline.map(p => `${toX(p[0])},${toY(p[1])}`).join(' ');

const hips = [
  [[100,100],[300,300]],
  [[500,100],[300,300]],
  [[1100,700],[900,900]],
  [[1100,1100],[900,900]],
  [[100,1100],[300,900]],
];
const ridges = [
  [[300,300],[300,900]],
  [[300,900],[900,900]],
];
const valleys = [
  [[500,700],[300,900]],
];

const lineSvg = (lines, color, dash = '') => lines.map(([a, b]) =>
  `<line x1="${toX(a[0])}" y1="${toY(a[1])}" x2="${toX(b[0])}" y2="${toY(b[1])}" stroke="${color}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
).join('');

const fillPoly = (pts, fill, opacity = 0.45, stroke = 'rgba(0,0,0,0.3)', strokeDash = '4,3') => {
  const s = pts.map(p => `${toX(p[0])},${toY(p[1])}`).join(' ');
  return `<polygon points="${s}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5" ${strokeDash ? `stroke-dasharray="${strokeDash}"` : ''}/>`;
};

function arrow(x1, y1, x2, y2, color = '#dc2626', dash = false) {
  const xa = toX(x1), ya = toY(y1), xb = toX(x2), yb = toY(y2);
  return `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${color}" stroke-width="2.5" ${dash ? 'stroke-dasharray="6,4"' : ''} marker-end="url(#arrow_${color.slice(1)})"/>`;
}

const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Inter,sans-serif">
  <defs>
    <marker id="arrow_dc2626" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626"/>
    </marker>
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#16a34a" stroke-width="2"/>
    </pattern>
  </defs>

  <text x="${W/2}" y="38" text-anchor="middle" font-size="24" font-weight="700" fill="#0a1628">Perfect-L cascade design — v2 after corner correction</text>
  <text x="${W/2}" y="62" text-anchor="middle" font-size="13" fill="#475569">Cross-pair logic applied to both hip-ends. External corner (SW) feeds both valley areas at the internal corner.</text>

  <!-- Building footprint -->
  <polygon points="${outlinePoly}" fill="#fffbeb" stroke="#0a1628" stroke-width="2.5"/>

  <!-- ====== N WING (top arm) ====== -->
  <!-- W long-side TOP donor zone (orange, clipped by NW hip) -->
  ${fillPoly([[100,100],[300,300],[100,300]], '#f97316', 0.5)}
  <text x="${toX(170)}" y="${toY(225)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">orange donors</text>
  <text x="${toX(170)}" y="${toY(242)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">22,20,17,12,6</text>

  <!-- E long-side TOP donor zone (blue, clipped by NE hip) -->
  ${fillPoly([[500,100],[300,300],[500,300]], '#2563eb', 0.5)}
  <text x="${toX(440)}" y="${toY(225)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">blue donors</text>
  <text x="${toX(440)}" y="${toY(242)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">21,19,16,11,5</text>

  <!-- N hip-end E half destination -->
  ${fillPoly([[300,100],[500,100],[300,300]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(370)}" y="${toY(175)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">N hip-end</text>
  <text x="${toX(370)}" y="${toY(192)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">EAST half</text>

  <!-- N hip-end W half destination -->
  ${fillPoly([[100,100],[300,100],[300,300]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(230)}" y="${toY(175)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">N hip-end</text>
  <text x="${toX(230)}" y="${toY(192)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">WEST half</text>

  <!-- ====== SE WING (east horizontal arm) — cross-pair on E hip-end ====== -->
  <!-- N long-side EAST donor zone (clipped by NE hip) -->
  ${fillPoly([[900,700],[1100,700],[900,900]], '#f97316', 0.5)}
  <text x="${toX(960)}" y="${toY(800)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">SE wing N donors</text>
  <text x="${toX(960)}" y="${toY(817)}" font-size="10" fill="#7c2d12" text-anchor="middle">(N long-side, NE clip)</text>

  <!-- S long-side EAST donor zone (clipped by SE hip) -->
  ${fillPoly([[900,1100],[1100,1100],[900,900]], '#2563eb', 0.5)}
  <text x="${toX(960)}" y="${toY(1000)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">SE wing S donors</text>
  <text x="${toX(960)}" y="${toY(1017)}" font-size="10" fill="#1e3a8a" text-anchor="middle">(S long-side, SE clip)</text>

  <!-- E hip-end S half destination (top->bottom cross-pair: N donors -> S half) -->
  ${fillPoly([[1100,900],[1100,1100],[900,900]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(1035)}" y="${toY(995)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">E hip-end</text>
  <text x="${toX(1035)}" y="${toY(1012)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">SOUTH half</text>

  <!-- E hip-end N half destination -->
  ${fillPoly([[1100,700],[1100,900],[900,900]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(1035)}" y="${toY(800)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">E hip-end</text>
  <text x="${toX(1035)}" y="${toY(817)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">NORTH half</text>

  <!-- ====== EXTERNAL CORNER (SW) -> internal corner (valley) ====== -->
  <!-- Wing W long-side BOTTOM donor zone (clipped by SW hip) -->
  ${fillPoly([[100,900],[300,900],[100,1100]], '#f97316', 0.45)}
  <text x="${toX(170)}" y="${toY(1005)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">wing W</text>
  <text x="${toX(170)}" y="${toY(1022)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">bottom donors</text>
  <text x="${toX(170)}" y="${toY(1038)}" font-size="10" fill="#7c2d12" text-anchor="middle">(SW-hip clipped)</text>

  <!-- Main S long-side WEST donor zone (clipped by SW hip), orange 76-108 -->
  ${fillPoly([[300,900],[100,1100],[300,1100]], '#f97316', 0.55)}
  <text x="${toX(240)}" y="${toY(1015)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">main S west</text>
  <text x="${toX(240)}" y="${toY(1032)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">76,78,96,102,108</text>

  <!-- North side of valley destination (wing E long-side wedge near valley) -->
  ${fillPoly([[500,700],[300,900],[450,750]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(420)}" y="${toY(800)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">NORTH of valley</text>

  <!-- South side of valley destination (main NW interior wedge below valley) -->
  ${fillPoly([[500,700],[300,900],[100,900],[100,700]], 'url(#hatch)', 0.6, '#16a34a')}
  <text x="${toX(280)}" y="${toY(820)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">SOUTH of valley</text>

  <!-- Roof lines on top -->
  ${lineSvg(hips, '#16a34a')}
  ${lineSvg(ridges, '#dc2626')}
  ${lineSvg(valleys, '#f59e0b', '10,5')}

  <!-- Cross-pair arrows for N hip-end -->
  ${arrow(180, 270, 370, 200)}
  ${arrow(440, 270, 220, 200)}

  <!-- Cross-pair arrows for E hip-end -->
  ${arrow(970, 800, 1050, 1000)}
  ${arrow(970, 1000, 1050, 810)}

  <!-- External corner (SW) -> valley areas -->
  <!-- Main S west orange (76-108) -> NORTH of valley -->
  ${arrow(240, 1010, 410, 790)}
  <!-- Wing W bottom donors -> SOUTH of valley -->
  ${arrow(170, 1000, 290, 830)}

  <!-- Mark external & internal corners -->
  <circle cx="${toX(100)}" cy="${toY(1100)}" r="9" fill="none" stroke="#7c3aed" stroke-width="3"/>
  <text x="${toX(100) - 10}" y="${toY(1100) + 22}" font-size="12" font-weight="700" fill="#7c3aed" text-anchor="end">external corner</text>

  <circle cx="${toX(500)}" cy="${toY(700)}" r="10" fill="none" stroke="#dc2626" stroke-width="3"/>
  <text x="${toX(500) + 16}" y="${toY(700) + 5}" font-size="13" font-weight="700" fill="#dc2626">reflex (internal corner)</text>

  <!-- Legend -->
  <g transform="translate(${W - 320}, 110)">
    <rect x="0" y="0" width="300" height="240" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" rx="8"/>
    <text x="14" y="22" font-size="13" font-weight="700" fill="#0a1628">Legend</text>
    <rect x="14" y="34" width="26" height="14" fill="#f97316" fill-opacity="0.55" stroke="rgba(0,0,0,0.3)" stroke-dasharray="4,3"/>
    <text x="48" y="46" font-size="12" fill="#111">orange donor zone</text>
    <rect x="14" y="56" width="26" height="14" fill="#2563eb" fill-opacity="0.55" stroke="rgba(0,0,0,0.3)" stroke-dasharray="4,3"/>
    <text x="48" y="68" font-size="12" fill="#111">blue donor zone</text>
    <rect x="14" y="78" width="26" height="14" fill="url(#hatch)" stroke="#16a34a" stroke-dasharray="4,3"/>
    <text x="48" y="90" font-size="12" fill="#111">offcut destination</text>
    <line x1="14" y1="106" x2="40" y2="106" stroke="#dc2626" stroke-width="2.5" marker-end="url(#arrow_dc2626)"/>
    <text x="48" y="110" font-size="12" fill="#111">offcut flow</text>
    <line x1="14" y1="126" x2="40" y2="126" stroke="#16a34a" stroke-width="2.5"/>
    <text x="48" y="130" font-size="12" fill="#111">hip line</text>
    <line x1="14" y1="146" x2="40" y2="146" stroke="#dc2626" stroke-width="2.5"/>
    <text x="48" y="150" font-size="12" fill="#111">ridge</text>
    <line x1="14" y1="166" x2="40" y2="166" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="10,5"/>
    <text x="48" y="170" font-size="12" fill="#111">valley</text>
    <circle cx="27" cy="190" r="8" fill="none" stroke="#dc2626" stroke-width="2"/>
    <text x="48" y="194" font-size="12" fill="#111">internal (reflex) corner</text>
    <circle cx="27" cy="212" r="7" fill="none" stroke="#7c3aed" stroke-width="2"/>
    <text x="48" y="216" font-size="12" fill="#111">external corner</text>
  </g>
</svg>`;

fs.writeFileSync('floodroofing/docs/perfect_L_cascade_design.svg', svg);

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.setContent(svg);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'floodroofing/docs/perfect_L_cascade_design.png', fullPage: false });
  console.log('wrote floodroofing/docs/perfect_L_cascade_design.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
