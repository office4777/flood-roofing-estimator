// Render 4 diverse L-shapes into a 2x2 grid to verify the Big-L
// proportions gate works across mixed cases.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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

  const cases = [
    {
      label: 'A_BigL_canonical',
      title: 'A: Canonical Big-L (square wing 300x300, main 900x700) — should use Big-L cascade',
      outline: [[100,100],[400,100],[400,400],[1000,400],[1000,1100],[100,1100]],
    },
    {
      label: 'B_BigL_orient1',
      title: 'B: Big-L wing-top-right (orientation 1) — should use Big-L cascade via rotation wrapper',
      outline: [[100,400],[700,400],[700,100],[1000,100],[1000,1100],[100,1100]],
    },
    {
      label: 'C_SOP_wide_wing',
      title: 'C: SOP-style wide wing (220x160 wing, 580x170 main) — should fall back to 6-face',
      outline: [[200,150],[780,150],[780,480],[560,480],[560,320],[200,320]],
    },
    {
      label: 'D_BigL_small',
      title: 'D: Small Big-L (square wing 200x200, main 700x500) — should use Big-L cascade',
      outline: [[100,100],[300,100],[300,300],[800,300],[800,800],[100,800]],
    },
  ];

  const shots = [];
  for (const c of cases) {
    await page.evaluate(({outline}) => {
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.autoGenerateRoof && window.autoGenerateRoof('hip');
    }, c);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
    });
    await page.waitForTimeout(600);
    // Scroll canvas into view, get its bbox, and clip a page screenshot.
    const box = await page.evaluate(() => {
      const el = document.querySelector('#tab-materials .canvas-wrap, #roofSheetPlanOut');
      if (!el) return null;
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.waitForTimeout(200);
    if (!box) { console.error('no canvas-wrap for', c.label); continue; }
    const buf = await page.screenshot({
      clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.w, height: box.h },
    });
    shots.push({ label: c.label, title: c.title, buf });
    console.log('captured', c.label);
  }

  // Compose 2x2 grid via a fresh page with HTML.
  const html = `<!doctype html><html><head><style>
    body{margin:0;padding:24px;background:#fff;font:14px/1.4 -apple-system,sans-serif;}
    h1{font-size:18px;margin:0 0 16px;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
    .cell{border:1px solid #ddd;border-radius:8px;padding:12px;background:#fafafa;}
    .cell .ttl{font-weight:600;margin-bottom:8px;font-size:13px;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eee;background:#fff;}
  </style></head><body>
  <h1>L-shape proportions gate verification</h1>
  <div class="grid">
  ${shots.map((s,i) => `<div class="cell"><div class="ttl">${s.title}</div><img src="data:image/png;base64,${s.buf.toString('base64')}"/></div>`).join('')}
  </div></body></html>`;

  const out = path.resolve('floodroofing/docs/_lshape_grid.html');
  fs.writeFileSync(out, html);
  await page.goto('file://' + out, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  // Resize viewport to content height
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w, 2400), height: Math.min(dim.h, 4000) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/lshape_verification_grid.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);

  fs.unlinkSync(out);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
