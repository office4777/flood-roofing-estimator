// Render Order Material tab + Settings → Suppliers & materials sub-tab
// so we can see the new feature.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const pageUrl = 'file://' + path.resolve('floodroofing/frontend/index.html');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1680, height: 1100 },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const app = document.querySelector('.app');
    if (app) app.style.display = '';
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
  });

  // Seed some catalog data so the dropdowns aren't all empty.
  await page.evaluate(() => {
    if (!window.S.settings) window.S.settings = window.defaultSettings();
    window.S.settings.materials_catalog = {
      suppliers: [
        { name: 'Roofing Industries', email: 'orders@roofingindustries.co.nz', phone: '09 415 7575', yard_addr: '12 Yard Rd, Auckland' },
        { name: 'Steel & Tube',       email: 'orders@steelandtube.co.nz',     phone: '09 444 0000', yard_addr: '34 Industrial Ave' },
      ],
      products:  [{ name: 'Colorsteel Maxam' }, { name: 'Colorcote ZRX' }, { name: 'Zincalume' }],
      underlays: [{ name: 'Thermakraft 215' }, { name: 'Bitumen building paper' }],
      screws:    [{ name: '12g × 65mm Tek hex' }, { name: '14g × 100mm timber' }],
      flashings: [{ name: 'Apron flashing' }, { name: 'Barge flashing' }, { name: 'Ridge flashing' }, { name: 'Valley flashing' }, { name: 'Gable flashing' }, { name: 'Box gutter' }, { name: 'Soaker' }, { name: 'Custom' }],
    };
    window.gotoTab('order');
    // Seed a couple of flashings so the layout is visible.
    if (window.S.order) {
      window.S.order.flashings = [
        { type:'Apron flashing', qty:2, faces:[{label:'Face A', length:120}, {label:'Face B', length:180}], lineBreaks:'1 join at 6.0m', notes:'90° bend, match roof colour', sketch:'' },
        { type:'Ridge flashing', qty:1, faces:[{label:'Face A', length:200}, {label:'Face B', length:200}], lineBreaks:'', notes:'', sketch:'' },
      ];
      window._renderFlashings();
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v7_order.png', fullPage: false });
  console.log('wrote redesign_v7_order.png');

  // Now Settings → Suppliers & materials
  await page.evaluate(() => {
    window.gotoTab('settings');
    // Activate the new sub-tab
    const btns = document.querySelectorAll('#tab-settings .tab-row .tab-sm');
    const sup = Array.from(btns).find(b => /supplier/i.test(b.textContent));
    if (sup) sup.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v7_settings_supl.png', fullPage: false });
  console.log('wrote redesign_v7_settings_supl.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
