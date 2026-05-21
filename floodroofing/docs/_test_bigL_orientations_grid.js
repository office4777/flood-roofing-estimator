// Test the Big-L cascade across 4 rotations + a horizontal mirror.
// The Big-L cascade lives in floodroofing/frontend/index.html and
// already handles all four canonical orientations via its rotation
// wrapper.  We just push the same outline rotated/mirrored and grab
// the canvas the app renders.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Canonical Big-L: 300×300 wing top-left + 900×700 main bottom-right.
// (Wing must satisfy the Big-L proportions gate: wing_w ≤ wing_h AND
// wing_w ≤ main_h/2.  Here wing_w = 300 ≤ main_h = 700/2 = 350. ✓)
const ox = 100, oy = 100;
const wing_w = 300, wing_h = 300;
const main_w = 900, main_h = 700;

// Canonical outline (orient 0: wing top-left, main bottom-right).
const canonical_outline = [
  [ox, oy],
  [ox + wing_w, oy],
  [ox + wing_w, oy + wing_h],
  [ox + main_w, oy + wing_h],
  [ox + main_w, oy + wing_h + main_h],
  [ox, oy + wing_h + main_h],
];
const minX = ox, maxX = ox + main_w;
const minY = oy, maxY = oy + wing_h + main_h;
// Rotation pivot = bbox centre.
const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;

const CASES = [
  { label: 'N — wing top-left, main bottom-right (canonical)', orient: 0, mirror: false },
  { label: 'E — wing top-right, main bottom-left (90° CW)',    orient: 1, mirror: false },
  { label: 'S — wing bottom-right, main top-left (180°)',      orient: 2, mirror: false },
  { label: 'W — wing bottom-left, main top-right (90° CCW)',   orient: 3, mirror: false },
  { label: 'inverted — horizontal mirror of canonical',         orient: 0, mirror: true },
];

function rot([x, y], orient) {
  const dx = x - bcx, dy = y - bcy;
  if (orient === 1) return [bcx - dy, bcy + dx];
  if (orient === 2) return [bcx - dx, bcy - dy];
  if (orient === 3) return [bcx + dy, bcy - dx];
  return [x, y];
}
function mir([x, y]) { return [2 * bcx - x, y]; }

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  const captures = [];
  for (const c of CASES) {
    let outline = canonical_outline.map(p => rot(p, c.orient));
    if (c.mirror) outline = outline.map(mir);

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
    const result = await page.evaluate(() => {
      const cvs = document.querySelector('#roofSheetPlanOut canvas');
      const all = window.__lastAllStrips || [];
      const bySeq = {};
      all.forEach(s => { (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      return {
        canvasDataURL: cvs ? cvs.toDataURL('image/png') : null,
        totalSheets: Object.keys(bySeq).length,
        multiPieceCount: Object.entries(bySeq).filter(([n, ps]) => ps.length >= 2).length,
        usingBigL: !!window.__usingBigL,
      };
    });
    captures.push({ ...c, ...result });
    console.log(`captured ${c.label}: ${result.totalSheets} sheets, ${result.multiPieceCount} multi-piece, big-L: ${result.usingBigL}`);
  }

  // Build a 3-column grid of the captured canvases.
  const cellW = 540, cellH = 540;
  const cols = 3;
  const rows = Math.ceil(captures.length / cols);
  const totalW = cellW * cols + 20 * (cols + 1);
  const totalH = cellH * rows + 60 * (rows + 1);

  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;}
    body{margin:0;padding:20px;background:#fff;font:13px/1.4 -apple-system,Inter,sans-serif;color:#111;}
    h1{font-size:18px;margin:0 0 16px;text-align:center;}
    .grid{display:grid;grid-template-columns:repeat(${cols}, ${cellW}px);gap:20px 20px;justify-content:center;}
    .cell{border:1px solid #ddd;border-radius:8px;padding:10px;background:#fafafa;}
    .ttl{font-weight:600;font-size:12.5px;margin-bottom:6px;text-align:center;}
    .stat{font-size:11.5px;color:#555;margin-bottom:8px;text-align:center;}
    img{display:block;width:100%;height:auto;border:1px solid #eee;background:#fff;}
  </style></head><body>
  <h1>Big-L cascade across 5 orientations (canonical: 300×300 wing + 900×700 main)</h1>
  <div class="grid">
  ${captures.map(c => `
    <div class="cell">
      <div class="ttl">${c.label}</div>
      <div class="stat">${c.totalSheets} sheets • ${c.multiPieceCount} multi-piece</div>
      <img src="${c.canvasDataURL}"/>
    </div>
  `).join('')}
  </div></body></html>`;

  const tmp = path.resolve('floodroofing/docs/_bigL_orientations_grid.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w + 24, 2400), height: Math.min(dim.h + 24, 3200) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/bigL_orientations_grid.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);
  fs.unlinkSync(tmp);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
