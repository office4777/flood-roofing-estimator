// Open the saved-flashings picker, click "Load 7 default flashings",
// then screenshot the resulting grid so we can confirm the SVG path
// data renders correctly and the entries look like the user's
// hand-drawn template.

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
    if (!window.S.settings) window.S.settings = window.defaultSettings();
    window.S.settings.materials_catalog = { suppliers:[], products:[], underlays:[], screws:[], flashings:[], savedFlashings:[] };
    window.gotoTab('order');
    window.openSavedFlashingsPicker();
    window.loadDefaultFlashings();
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'floodroofing/docs/redesign_v9_default_set.png', fullPage: false });
  console.log('wrote redesign_v9_default_set.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
