// Render the new saved-flashings library: Order Material with a
// flashing card showing the Save-to-library button, and the picker
// modal open with seeded entries.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1680, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });

  // Reveal app and seed catalog + a couple of flashings, plus a couple
  // of pre-saved library entries (including a sketch as a data URL) so
  // we can screenshot both the card-with-save-button and the picker.
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    if (!window.S.settings) window.S.settings = window.defaultSettings();
    // Small inline SVG, base64-encoded, used as a fake sketch thumbnail.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120"><path d="M20 100 L20 30 L120 30 L160 60 L200 60" stroke="#0a1628" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 30 L20 20 M120 30 L120 20" stroke="#0099cc" stroke-width="1.2" stroke-dasharray="3 3"/></svg>';
    const sketchUrl = 'data:image/svg+xml;base64,' + btoa(svg);
    window.S.settings.materials_catalog = {
      suppliers: [{ name: 'Roofing Industries', email: 'orders@ri.co.nz' }],
      products:  [{ name: 'Colorsteel Maxam' }],
      underlays: [{ name: 'Thermakraft 215' }],
      screws:    [{ name: '12g × 65mm Tek' }],
      flashings: [{ name: 'Apron flashing' }, { name: 'Ridge flashing' }, { name: 'Valley flashing' }],
      savedFlashings: [
        { name: 'Std apron (90°)',  type: 'Apron flashing',  qty: 1, faces:[{label:'Face A', length:120},{label:'Face B', length:180}], lineBreaks:'', notes:'Match roof colour', sketch: sketchUrl },
        { name: 'Wide barge',        type: 'Barge flashing',  qty: 2, faces:[{label:'Face A', length:150},{label:'Face B', length:60}],  lineBreaks:'', notes:'', sketch: sketchUrl },
        { name: 'Box gutter — deep', type: 'Box gutter',      qty: 1, faces:[{label:'Web',length:240},{label:'Sole',length:200},{label:'Web',length:240}], lineBreaks:'1 join at 6m', notes:'', sketch:'' },
      ]
    };
    window.gotoTab('order');
    // Seed one flashing on the current order so the "Save to library"
    // button is visible on a real card.
    window.S.order.flashings = [
      { type:'Apron flashing', qty:2, faces:[{label:'Face A',length:120},{label:'Face B',length:180}], lineBreaks:'', notes:'90° bend, match roof', sketch:'' }
    ];
    window._renderFlashings();
  });
  await page.waitForTimeout(300);

  // Screenshot 1: Order tab with the seeded flashing showing the new
  // "💾 Save to library" button on the card, and the header showing
  // "+ Add from saved" with the count badge.
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('#tab-order .card .card-hd'))
      .find(h => /Flashings/.test(h.textContent));
    if (card) card.scrollIntoView({block:'start'});
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v8_order_save.png', fullPage: false });
  console.log('wrote redesign_v8_order_save.png');

  // Screenshot 2: open the picker
  await page.evaluate(() => window.openSavedFlashingsPicker());
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v8_picker.png', fullPage: false });
  console.log('wrote redesign_v8_picker.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
