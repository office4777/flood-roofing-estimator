// Headless render of the redesigned UI (sidebar layout, Scandi tokens).
// Loads the production index.html from file://, bypasses the login modal
// by directly revealing the .app shell, and screenshots the result so we
// can see whether the visual refresh actually lands.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   NODE_PATH=/opt/node22/lib/node_modules \
//   node floodroofing/docs/_test_redesign_render.js

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const out = path.resolve(process.argv[2] || 'floodroofing/docs/redesign_render.png');
  const pageUrl = 'file://' + path.resolve('floodroofing/frontend/index.html');

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1680, height: 920 },
  });
  const page = await ctx.newPage();
  // Silence console noise from unfinished integrations.
  page.on('pageerror', () => {});
  page.on('console', () => {});
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

  // The page hides the .app shell until login completes. Force it visible
  // and dismiss the login screen so we screenshot the actual UI.
  await page.evaluate(() => {
    const app = document.querySelector('.app');
    if (app) app.style.display = '';
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
  });
  // Settle a frame so font + layout pass.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);

  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
