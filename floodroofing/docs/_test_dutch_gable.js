// Headless render of floodroofing/docs/_test_dutch_gable.html → PNG.
// Uses the Chromium that's pre-installed under /opt/pw-browsers.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node floodroofing/docs/_test_dutch_gable.js [output.png]

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const out = path.resolve(process.argv[2] || 'floodroofing/docs/dutch_gable_test_render.png');
  const page_url = 'file://' + path.resolve('floodroofing/docs/_test_dutch_gable.html');

  // The pre-installed browser is chromium-1194; the bundled headless shell
  // path that Playwright 1.56 expects is the 1223 build. Point launch at
  // the actual chrome binary that's on disk.
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 880, height: 640 } });
  const page = await ctx.newPage();
  await page.goto(page_url, { waitUntil: 'load' });
  await page.waitForFunction(() => window._renderDone === true, { timeout: 5000 });
  // Let the canvas settle one frame
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Tight crop: shrink the viewport to the body's content height
  const dims = await page.evaluate(() => {
    const b = document.body;
    return { w: Math.ceil(b.scrollWidth), h: Math.ceil(b.scrollHeight) };
  });
  await page.setViewportSize({ width: Math.min(dims.w, 1600), height: Math.min(dims.h, 1200) });

  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
