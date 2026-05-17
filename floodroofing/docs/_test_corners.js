// Confirm the corner-handle dots draw on top of a building outline
// while the Move tool is active. Headless drag isn't really meaningful
// to screenshot (cursor changes etc.) — this just checks the visual
// affordance lands.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    // Seed an outline shaped like a simple L so handles are clearly
    // visible at all six corners.
    if (window.DRAW) {
      window.DRAW.outline = [[200,150],[600,150],[600,300],[450,300],[450,500],[200,500]];
      window.DRAW.outlineDone = true;
      window.setTool && window.setTool('select');
      window.redrawAll && window.redrawAll();
    }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const cv = document.getElementById('roofCanvas');
    cv && cv.scrollIntoView({ block:'start' });
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v12_corners.png', fullPage: false });
  console.log('wrote redesign_v12_corners.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
