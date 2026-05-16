// Render multiple tabs to verify the Fergus → Settings + Inspection
// report → Quote moves landed cleanly.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const pageUrl = 'file://' + path.resolve('floodroofing/frontend/index.html');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1680, height: 920 },
  });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  page.on('console', () => {});
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const app = document.querySelector('.app');
    if (app) app.style.display = '';
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);

  for (const tab of ['settings', 'quote']) {
    await page.evaluate(t => window.gotoTab && window.gotoTab(t), tab);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `floodroofing/docs/redesign_v6_${tab}.png`,
      fullPage: false,
    });
    console.log('wrote', `floodroofing/docs/redesign_v6_${tab}.png`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
