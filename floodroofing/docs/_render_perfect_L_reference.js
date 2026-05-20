// Render a clean reference of one even-armed L-shape (both arms equal
// width and length).  Shows just the building outline + auto-generated
// roof lines (gutters, hips, valley, ridge) with dimensions and key
// vertex coordinates labelled — no sheet cascade.  Use this to point
// at when explaining how a perfect-L cascade should work.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  // Even-armed L-shape: 400-wide arms, both 1000 long, meeting at corner.
  //   Vertical arm:   x = [100, 500], y = [100, 1100]   (400 wide × 1000 tall)
  //   Horizontal arm: x = [100, 1100], y = [700, 1100]  (1000 wide × 400 tall)
  //   Overlap (the L's inside corner block): x = [100, 500], y = [700, 1100]
  //   Reflex (inside corner) at (500, 700).
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

  // Extract auto-generated lines so we can draw a clean reference.
  const lines = await page.evaluate(() => {
    return (window.DRAW.lines || []).map(l => ({
      type: l.type,
      pts: l.pts ? l.pts.map(p => p.slice()) : null,
    }));
  });
  await browser.close();

  // Draw a clean SVG reference.
  const W = 1400, H = 1400;
  const minX = 0, minY = 0, maxX = 1200, maxY = 1200;
  const scale = Math.min((W - 200) / (maxX - minX), (H - 200) / (maxY - minY));
  const padX = (W - (maxX - minX) * scale) / 2;
  const padY = (H - (maxY - minY) * scale) / 2;
  const toX = x => padX + (x - minX) * scale;
  const toY = y => padY + (y - minY) * scale;

  // Find lines by type
  const ridges = lines.filter(l => l.type === 'ridge');
  const hips = lines.filter(l => l.type === 'hip');
  const valleys = lines.filter(l => l.type === 'valley');
  const gutters = lines.filter(l => l.type === 'gutter');
  const barges = lines.filter(l => l.type === 'barge');

  const linesPath = (ls, color, dash = '') => ls.map(l => {
    if (!l.pts || l.pts.length !== 2) return '';
    return `<line x1="${toX(l.pts[0][0])}" y1="${toY(l.pts[0][1])}" x2="${toX(l.pts[1][0])}" y2="${toY(l.pts[1][1])}" stroke="${color}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  }).join('');

  // Building outline (closed polygon).
  const outlinePoly = outline.map(p => `${toX(p[0])},${toY(p[1])}`).join(' ');

  // Vertex labels.
  const vertexLabels = outline.map((p, i) => {
    const cx = toX(p[0]), cy = toY(p[1]);
    return `
      <circle cx="${cx}" cy="${cy}" r="6" fill="#dc2626" stroke="#fff" stroke-width="2"/>
      <text x="${cx + 14}" y="${cy - 8}" font-size="14" font-weight="600" fill="#111">(${p[0]}, ${p[1]})</text>`;
  }).join('');

  // Dimension lines + labels.
  const dim = (x1, y1, x2, y2, label, offset = 30) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    const nx = -dy / len, ny = dx / len;  // perpendicular
    const ox = nx * offset, oy = ny * offset;
    const mx = (x1 + x2) / 2 + ox, my = (y1 + y2) / 2 + oy;
    return `
      <line x1="${toX(x1) + ox*scale}" y1="${toY(y1) + oy*scale}" x2="${toX(x2) + ox*scale}" y2="${toY(y2) + oy*scale}" stroke="#0277bd" stroke-width="1.5"/>
      <line x1="${toX(x1)}" y1="${toY(y1)}" x2="${toX(x1) + ox*scale}" y2="${toY(y1) + oy*scale}" stroke="#0277bd" stroke-width="1"/>
      <line x1="${toX(x2)}" y1="${toY(y2)}" x2="${toX(x2) + ox*scale}" y2="${toY(y2) + oy*scale}" stroke="#0277bd" stroke-width="1"/>
      <text x="${toX(mx)}" y="${toY(my) - 5}" font-size="15" font-weight="700" fill="#0277bd" text-anchor="middle">${label}</text>`;
  };

  // Arm labels.
  const armLabel = (x, y, lbl, sub) => `
    <text x="${toX(x)}" y="${toY(y)}" font-size="22" font-weight="700" fill="#374151" text-anchor="middle">${lbl}</text>
    <text x="${toX(x)}" y="${toY(y) + 22}" font-size="13" fill="#6b7280" text-anchor="middle">${sub}</text>`;

  const reflexX = 500, reflexY = 700;

  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Inter,sans-serif">
    <!-- Title -->
    <text x="${W/2}" y="40" text-anchor="middle" font-size="24" font-weight="700" fill="#0a1628">Perfect L-shape reference — 400-wide arms × 1000 long</text>
    <text x="${W/2}" y="62" text-anchor="middle" font-size="14" fill="#475569">Both arms have the same width (400px = 8m at scale 0.02m/px) and same length (1000px). All face sheets are the same length: 200px (= arm_width / 2).</text>

    <!-- Building footprint (translucent fill) -->
    <polygon points="${outlinePoly}" fill="#fef3c7" fill-opacity="0.4" stroke="none"/>

    <!-- Gutters / outline -->
    ${linesPath(gutters, '#0a1628')}

    <!-- Hips (45° green) -->
    ${linesPath(hips, '#16a34a')}

    <!-- Ridges (red) -->
    ${linesPath(ridges, '#dc2626')}

    <!-- Valleys (orange, dashed) -->
    ${linesPath(valleys, '#f59e0b', '10,5')}

    <!-- Barges (purple) -->
    ${linesPath(barges, '#7c3aed')}

    <!-- Vertex markers -->
    ${vertexLabels}

    <!-- Reflex marker -->
    <circle cx="${toX(reflexX)}" cy="${toY(reflexY)}" r="10" fill="none" stroke="#dc2626" stroke-width="3"/>
    <text x="${toX(reflexX) + 18}" y="${toY(reflexY) + 6}" font-size="14" font-weight="700" fill="#dc2626">reflex</text>

    <!-- Arm labels -->
    ${armLabel(300, 400, 'WING ARM', '400 × 1000 (tall)')}
    ${armLabel(800, 900, 'MAIN ARM', '1000 × 400 (wide)')}

    <!-- Legend -->
    <g transform="translate(${W - 280}, 100)">
      <rect x="0" y="0" width="260" height="180" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" rx="8"/>
      <text x="14" y="22" font-size="13" font-weight="700" fill="#0a1628">Roof lines</text>
      <line x1="14" y1="40" x2="40" y2="40" stroke="#0a1628" stroke-width="3"/>
      <text x="48" y="44" font-size="13" fill="#111">gutter (outline)</text>
      <line x1="14" y1="60" x2="40" y2="60" stroke="#16a34a" stroke-width="3"/>
      <text x="48" y="64" font-size="13" fill="#111">hip (45°, green)</text>
      <line x1="14" y1="80" x2="40" y2="80" stroke="#dc2626" stroke-width="3"/>
      <text x="48" y="84" font-size="13" fill="#111">ridge (red)</text>
      <line x1="14" y1="100" x2="40" y2="100" stroke="#f59e0b" stroke-width="3" stroke-dasharray="10,5"/>
      <text x="48" y="104" font-size="13" fill="#111">valley (orange, dashed)</text>
      <line x1="14" y1="120" x2="40" y2="120" stroke="#7c3aed" stroke-width="3"/>
      <text x="48" y="124" font-size="13" fill="#111">barge</text>
      <circle cx="27" cy="146" r="6" fill="#dc2626" stroke="#fff" stroke-width="2"/>
      <text x="48" y="150" font-size="13" fill="#111">outline vertex</text>
      <circle cx="27" cy="166" r="8" fill="none" stroke="#dc2626" stroke-width="2"/>
      <text x="48" y="170" font-size="13" fill="#111">reflex (inside corner)</text>
    </g>

    <!-- Dimensions box -->
    <g transform="translate(40, ${H - 200})">
      <rect x="0" y="0" width="380" height="170" fill="#f0f9ff" stroke="#bae6fd" stroke-width="1" rx="8"/>
      <text x="14" y="24" font-size="13" font-weight="700" fill="#0a1628">Dimensions (px at 0.02m/px)</text>
      <text x="14" y="48" font-size="12" fill="#111">Wing (vertical arm):  400 wide × 1000 tall (8m × 20m)</text>
      <text x="14" y="68" font-size="12" fill="#111">Main (horizontal arm): 1000 wide × 400 tall (20m × 8m)</text>
      <text x="14" y="88" font-size="12" fill="#111">Overlap (corner):       400 × 400 (8m × 8m)</text>
      <text x="14" y="108" font-size="12" fill="#111">Arm half-width:         200 px = 4m  (= all sheet lengths)</text>
      <text x="14" y="138" font-size="12" font-weight="700" fill="#0a1628">Reflex at (500, 700) = inside corner</text>
    </g>
  </svg>`;

  fs.writeFileSync('floodroofing/docs/perfect_L_reference.svg', svg);

  // Also render as PNG using Playwright.
  const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx2 = await browser2.newContext({ deviceScaleFactor: 2, viewport: { width: W, height: H } });
  const page2 = await ctx2.newPage();
  await page2.setContent(svg);
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: 'floodroofing/docs/perfect_L_reference.png', fullPage: false, omitBackground: false });
  console.log('wrote floodroofing/docs/perfect_L_reference.png');
  await browser2.close();
})().catch(e => { console.error(e); process.exit(1); });
