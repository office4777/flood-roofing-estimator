// Verify: picker empty state (no default-loader button), and picker
// with a couple of seeded entries so the inline qty + face-length
// editors are visible.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
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
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v10_empty.png', fullPage: false });
  console.log('wrote redesign_v10_empty.png');

  // Now seed two entries — one with a sketch, one without — to show
  // the inline qty + face-length editors that pre-fill from saved
  // defaults but are editable before "Use this".
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120"><path d="M55 100 L70 88 L70 30 L160 30 L160 22 L150 22" stroke="#0a1628" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    window.S.settings.materials_catalog.savedFlashings = [
      { name: 'My standard apron', type: 'Apron flashing', qty: 2,
        faces: [{label:'Vertical', length:180}, {label:'Top', length:120}],
        lineBreaks: '', notes: '', sketch: url },
      { name: 'Wide ridge cap', type: 'Ridge flashing', qty: 1,
        faces: [{label:'Left slope', length:200}, {label:'Right slope', length:200}],
        lineBreaks: '', notes: '', sketch: '' },
    ];
    window._renderSavedFlashingsPicker();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v10_editable.png', fullPage: false });
  console.log('wrote redesign_v10_editable.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
