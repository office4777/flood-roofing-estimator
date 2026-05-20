// Annotated diagram of the perfect-L cascade design as I currently
// understand it.  Highlights donor zones (with their current colours)
// and destination zones, and draws arrows showing where the offcut
// material flows.  Use this to confirm the design or correct me.

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

// Roof lines (hand-computed from autoGenerateRoof output)
const hips = [
  [[100,100],[300,300]],     // wing NW
  [[500,100],[300,300]],     // wing NE
  [[1100,700],[900,900]],    // main NE
  [[1100,1100],[900,900]],   // main SE
  [[100,1100],[300,900]],    // main SW / wing S corner
];
const ridges = [
  [[300,300],[300,900]],     // wing ridge (vertical)
  [[300,900],[900,900]],     // main ridge (horizontal)
];
const valleys = [
  [[500,700],[300,900]],     // valley from reflex SW to ridge meeting
];

const lineSvg = (lines, color, dash = '') => lines.map(([a, b]) =>
  `<line x1="${toX(a[0])}" y1="${toY(a[1])}" x2="${toX(b[0])}" y2="${toY(b[1])}" stroke="${color}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
).join('');

// Filled zone polygons.
const fillPoly = (pts, fill, opacity = 0.45, stroke = 'rgba(0,0,0,0.3)') => {
  const s = pts.map(p => `${toX(p[0])},${toY(p[1])}`).join(' ');
  return `<polygon points="${s}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,3"/>`;
};

// Donor and destination zones
const donorWLongSide  = [[100,100],[300,300],[300,900],[100,1100]];  // wing W long-side (full face) — top portion is donor for N hip-end E half
const donorELongSide  = [[500,100],[500,700],[300,900],[300,300]];   // wing E long-side
const nHipEndE        = [[300,100],[500,100],[300,300]];              // N hip-end east half (destination)
const nHipEndW        = [[100,100],[300,100],[300,300]];              // N hip-end west half (destination)
const eHipEnd         = [[1100,700],[1100,1100],[900,900]];           // SE wing E hip-end (destination)
const mainSLongSideSW = [[100,1100],[300,900],[300,900],[100,1100]];  // can't, degenerate. use trapezoid:
const mainSLongSWZone = [[100,900],[300,900],[100,1100]];             // SW corner of main S long-side (donor for valley)
const valleyNorth     = [[500,700],[300,900],[300,300],[500,100]];    // wing E side near valley (= wing's E long-side, north of valley)
const valleySouth     = [[500,700],[300,900],[100,900],[100,700],[500,700]];  // main's NW interior, S of valley — bounded weirdly

// Arrows
function arrow(x1, y1, x2, y2, color = '#dc2626', dash = false) {
  const xa = toX(x1), ya = toY(y1), xb = toX(x2), yb = toY(y2);
  return `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${color}" stroke-width="2.5" ${dash ? 'stroke-dasharray="6,4"' : ''} marker-end="url(#arrowhead)"/>`;
}

const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Inter,sans-serif">
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626"/>
    </marker>
  </defs>

  <text x="${W/2}" y="38" text-anchor="middle" font-size="24" font-weight="700" fill="#0a1628">Perfect-L cascade design — my current understanding</text>
  <text x="${W/2}" y="62" text-anchor="middle" font-size="13" fill="#475569">Coloured zones = donor sheets (their offcuts flow). Hatched zones = destinations. Red arrows = offcut flow direction.</text>
  <text x="${W/2}" y="82" text-anchor="middle" font-size="13" fill="#475569">Tell me if any of these zones, colours, or arrows are wrong.</text>

  <!-- Building footprint -->
  <polygon points="${outlinePoly}" fill="#fffbeb" stroke="#0a1628" stroke-width="2.5"/>

  <!-- Donor zones (current sheet colour, dashed border) -->
  ${fillPoly([[100,100],[300,300],[100,300]], '#f97316', 0.55)}
  <text x="${toX(170)}" y="${toY(220)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">orange donors</text>
  <text x="${toX(170)}" y="${toY(238)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">22,20,17,12,6</text>
  <text x="${toX(170)}" y="${toY(253)}" font-size="10" fill="#7c2d12" text-anchor="middle">(wing W top)</text>

  ${fillPoly([[500,100],[300,300],[500,300]], '#2563eb', 0.55)}
  <text x="${toX(430)}" y="${toY(220)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">blue donors</text>
  <text x="${toX(430)}" y="${toY(238)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">21,19,16,11,5</text>
  <text x="${toX(430)}" y="${toY(253)}" font-size="10" fill="#1e3a8a" text-anchor="middle">(wing E top)</text>

  ${fillPoly([[100,900],[300,900],[100,1100]], '#f97316', 0.55)}
  <text x="${toX(180)}" y="${toY(1000)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">orange donors</text>
  <text x="${toX(180)}" y="${toY(1018)}" font-size="11" font-weight="700" fill="#7c2d12" text-anchor="middle">76,78,96,102,108</text>
  <text x="${toX(180)}" y="${toY(1033)}" font-size="10" fill="#7c2d12" text-anchor="middle">(main S, SW corner)</text>

  ${fillPoly([[1100,700],[1100,1100],[900,900]], '#2563eb', 0.55)}
  <text x="${toX(1020)}" y="${toY(890)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">currently blue</text>
  <text x="${toX(1020)}" y="${toY(906)}" font-size="11" font-weight="700" fill="#1e3a8a" text-anchor="middle">73,71,61,54,47</text>
  <text x="${toX(1020)}" y="${toY(922)}" font-size="10" fill="#1e3a8a" text-anchor="middle">(should be offcut dest)</text>

  <!-- Destination zones (hatched green) -->
  <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#16a34a" stroke-width="2"/>
  </pattern>
  ${fillPoly([[300,100],[500,100],[300,300]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(370)}" y="${toY(170)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">N hip-end</text>
  <text x="${toX(370)}" y="${toY(187)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">EAST half</text>

  ${fillPoly([[100,100],[300,100],[300,300]], 'url(#hatch)', 1, '#16a34a')}
  <text x="${toX(230)}" y="${toY(170)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">N hip-end</text>
  <text x="${toX(230)}" y="${toY(187)}" font-size="11" font-weight="700" fill="#14532d" text-anchor="middle">WEST half</text>

  <!-- Valley north side (wing E long-side wedge above valley) -->
  ${fillPoly([[500,700],[300,900],[300,300],[500,100]], 'url(#hatch)', 0.6, '#16a34a')}
  <text x="${toX(420)}" y="${toY(630)}" font-size="10" font-weight="700" fill="#14532d" text-anchor="middle">NORTH of valley</text>
  <text x="${toX(420)}" y="${toY(648)}" font-size="10" fill="#14532d" text-anchor="middle">(in wing E side)</text>

  <!-- Valley south side (main NW interior below valley) -->
  ${fillPoly([[300,900],[500,700],[100,700],[100,900]], 'url(#hatch)', 0.6, '#16a34a')}
  <text x="${toX(280)}" y="${toY(820)}" font-size="10" font-weight="700" fill="#14532d" text-anchor="middle">SOUTH of valley</text>
  <text x="${toX(280)}" y="${toY(838)}" font-size="10" fill="#14532d" text-anchor="middle">(in main NW)</text>

  <!-- Hips / ridges / valleys (on top) -->
  ${lineSvg(hips, '#16a34a')}
  ${lineSvg(ridges, '#dc2626')}
  ${lineSvg(valleys, '#f59e0b', '10,5')}

  <!-- Cascade arrows -->
  <!-- N wing cross-pair -->
  ${arrow(200, 280, 380, 200)}
  ${arrow(400, 280, 200, 200)}

  <!-- Orange 76-108 → north of valley -->
  ${arrow(220, 950, 380, 600)}

  <!-- SW hip 'offcut offcuts' → south of valley -->
  ${arrow(220, 1030, 280, 840)}

  <!-- SE wing donors (S long-side?) → E hip-end (currently 73/71/61/54/47) -->
  ${arrow(700, 1030, 980, 870)}

  <!-- Reflex marker -->
  <circle cx="${toX(500)}" cy="${toY(700)}" r="10" fill="none" stroke="#dc2626" stroke-width="3"/>
  <text x="${toX(500) + 16}" y="${toY(700) + 5}" font-size="13" font-weight="700" fill="#dc2626">reflex</text>

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
    <line x1="14" y1="106" x2="40" y2="106" stroke="#dc2626" stroke-width="2.5" marker-end="url(#arrowhead)"/>
    <text x="48" y="110" font-size="12" fill="#111">offcut flow direction</text>
    <line x1="14" y1="126" x2="40" y2="126" stroke="#16a34a" stroke-width="2.5"/>
    <text x="48" y="130" font-size="12" fill="#111">hip line</text>
    <line x1="14" y1="146" x2="40" y2="146" stroke="#dc2626" stroke-width="2.5"/>
    <text x="48" y="150" font-size="12" fill="#111">ridge</text>
    <line x1="14" y1="166" x2="40" y2="166" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="10,5"/>
    <text x="48" y="170" font-size="12" fill="#111">valley</text>
    <circle cx="27" cy="190" r="8" fill="none" stroke="#dc2626" stroke-width="2"/>
    <text x="48" y="194" font-size="12" fill="#111">reflex (inside corner)</text>
    <text x="14" y="220" font-size="11" font-style="italic" fill="#475569">Tell me what's wrong or missing.</text>
  </g>
</svg>`;

fs.writeFileSync('floodroofing/docs/perfect_L_cascade_design.svg', svg);

// Convert SVG to PNG via playwright.
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
