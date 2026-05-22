// Render a brand-new proposal (no user-uploaded photos, no saved gallery)
// to confirm the gallery is auto-seeded with default Colorsteel roof scenes
// and they appear on the Cover, About strip and Maxam page.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 1500 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });

  // Bypass login UI and skip any backend load by faking a fresh empty state.
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    // Force a brand-new state — no photos, no saved gallery.
    if (window.S) {
      window.S.photos = [];
      if (window.S.settings && window.S.settings.branding) {
        window.S.settings.branding.gallery_photos = [];
        window.S.settings.branding.gallery_seeded = false;
      }
    }
    // Seed a couple of line items so the totals page isn't blank.
    if (window.S && Array.isArray(window.S.quote && window.S.quote.options)) {
      var o = window.S.quote.options[0];
      if (o) {
        o.title = 'Option A — Full re-roof in Colorsteel® Maxam®';
        o.description = 'Strip existing corrugate, supply & install new Maxam corrugate, all flashings and fastenings.';
        o.lineItems = [
          { name: 'Maxam corrugate sheet (Ironsand®)', qty: 66, unit: 'sheet', rate: 89.50 },
          { name: 'Ridge cap + apron flashings', qty: 22, unit: 'm', rate: 38.00 },
          { name: 'Labour — strip & install', qty: 1, unit: 'job', rate: 8400 },
        ];
      }
    }
    // Open the quote tab.
    window.gotoTab && window.gotoTab('quote');
    window.refreshQuoteProposal && window.refreshQuoteProposal();
  });
  await page.waitForTimeout(800);

  // Capture the proposal area only.
  const target = await page.$('#quoteProposal') || await page.$('.proposal') || await page.$('#tab-quote');
  const outPng = 'floodroofing/docs/proposal_default_gallery.png';
  if (target) {
    await target.screenshot({ path: outPng });
  } else {
    await page.screenshot({ path: outPng, fullPage: true });
  }
  console.log('wrote', outPng);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
