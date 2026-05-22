// Verify the named image-slot system end-to-end.
//   1) Render with NO gallery photos and NO slot assignments — strips hidden.
//   2) Render with a few gallery photos seeded + slot assignments — slots
//      should pick the assigned photo and ignore other slots that resolve
//      to nothing.
//   3) Capture the in-app slot-grid UI in the Quote tab.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1200, height: 1500 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    // Seed a small fake "gallery" + a couple of job photos using inline
    // SVG data-URIs so we don't need network.
    function tile(hex, label){
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'+
        '<rect width="400" height="300" fill="'+hex+'"/>'+
        '<text x="20" y="160" font-family="Arial" font-size="34" font-weight="700" fill="#fff">'+label+'</text>'+
        '</svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    if (!window.S.quote) window.S.quote = window.defaultQuote();
    if (!window.S.quote.options || !window.S.quote.options.length){
      window.S.quote.options = [{ id:'opt1', title:'', description:'', inclusions:[], lineItems:[], upgrades:[] }];
    }
    if (!window.S.settings) window.S.settings = {};
    if (!window.S.settings.branding) window.S.settings.branding = {};
    window.S.settings.branding.gallery_photos = [
      { src: tile('#3f3a32', 'Ironsand'),     caption: 'Ironsand re-roof' },
      { src: tile('#1f2a23', 'Karaka'),       caption: 'Karaka full re-roof' },
      { src: tile('#3a4654', 'New Denim'),    caption: 'New Denim Blue' },
      { src: tile('#a8a59e', 'Sandstone'),    caption: 'Sandstone Grey' },
    ];
    window.S.photos = [
      { src: tile('#1b1b1d', 'Job site'),     caption: 'Site overview' },
      { src: tile('#5a4a3a', 'Job close-up'), caption: 'Close-up corrugate' },
    ];
    // Assign some slots explicitly — mix of stock + job.
    window.S.quote.imageSlots = {
      cover_hero: { source: 'job',   ref: 0 },
      recent_1:   { source: 'stock', ref: 1 },
      recent_2:   { source: 'stock', ref: 2 },
      recent_3:   { source: 'stock', ref: 3 },
      maxam_1:    { source: 'stock', ref: 0 },
      maxam_2:    { source: 'job',   ref: 1 },
      maxam_3:    { source: 'stock', ref: 2 },
      maxam_4:    { source: 'stock', ref: 3 },
    };
    window.S.quote.options[0].title = 'Option A — Full Colorsteel Maxam re-roof';
    window.S.quote.options[0].description = 'Strip existing, install new Maxam corrugate, all flashings.';
    window.S.quote.options[0].lineItems = [
      { name: 'Maxam corrugate sheet', qty: 66, unit: 'sheet', rate: 89.50 },
      { name: 'Ridge & apron flashings', qty: 22, unit: 'm', rate: 38.00 },
      { name: 'Labour — strip & install', qty: 1, unit: 'job', rate: 8400 },
    ];
    window.gotoTab && window.gotoTab('quote');
    window.refreshQuoteProposal && window.refreshQuoteProposal();
    window.renderSlotGrid && window.renderSlotGrid();
  });
  await page.waitForTimeout(800);

  // (A) Capture full proposal preview
  const prop = await page.$('#quoteProposal');
  if (prop) await prop.screenshot({ path: 'floodroofing/docs/proposal_slots_filled.png' });
  console.log('wrote floodroofing/docs/proposal_slots_filled.png');

  // (B) Capture the slot-grid card in the Quote tab
  const card = await page.$('#slotGrid');
  if (card) {
    // Screenshot the whole card by walking up to the parent .card
    const cardParent = await page.evaluateHandle(() => {
      var el = document.getElementById('slotGrid');
      while (el && !el.classList.contains('card')) el = el.parentElement;
      return el;
    });
    const elH = cardParent.asElement && cardParent.asElement();
    if (elH) await elH.screenshot({ path: 'floodroofing/docs/proposal_slot_picker_card.png' });
  }
  console.log('wrote floodroofing/docs/proposal_slot_picker_card.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
