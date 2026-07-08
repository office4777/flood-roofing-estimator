// Single-price variant (no options) — mirrors the real-world Harrison-style quote.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1750 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    if (!window.S.settings) window.S.settings = {};
    if (!window.S.settings.branding) window.S.settings.branding = {};
    Object.assign(window.S.settings.branding, {
      company_name: 'Flood Roofing LTD',
      tagline: "Northland's Roofing Specialists",
      website: 'floodroofing.co.nz',
      phone: '0800 4 FLOOD',
      email: 'office@floodroofing.co.nz',
      address: '494C Kerikeri Road, Kerikeri 0293',
      gst_number: '120 543 997',
    });
    window.S.roofData = { roof_type: 'Hip', area_m2: 96.4, pitch: 12 };
    if (!window.S.quote) window.S.quote = window.defaultQuote();
    Object.assign(window.S.quote, {
      ref: '2231', date: '8/07/2026', validUntil: '30 days',
      client: 'Jim Harrison', phone: '027 555 0123', email: 'client@email.co.nz',
      addr: '900 Horeke Road',
      preparedByName: 'Matthew Smith', preparedByRole: 'Sales Manager',
      materialBase: 3540, gutterLm: 21, gutterLines: 2,
      gstRate: 15,
      options: [],
      lineItems: [ { desc:'Re-roof — main house', qty: 1, unit: 5090.98 } ],
      scope: 'This quotation includes the following work:\nInstall edge protection/scaffolding as required for safe access.\nRemove and dispose of the existing roof sheeting.\nInspect roof framing and replace any rotten or damaged purlins found during the re-roof (within reason).\nSupply and install premium synthetic roof underlay.\nSupply and install new COLORSTEEL® Maxam® long-run roofing (0.40 BMT Corrugate profile unless otherwise specified).\nSupply and install all associated flashings, ridging, barges, apron flashings and closures required for a complete roof.\nReplace all roofing screws with new colour-matched Class 4 fasteners.\nLeave the roof and work area clean and tidy upon completion.\nRemove all roofing waste from site.\n\nWarranty:\nManufacturer\'s warranty on roofing materials (subject to product and environmental conditions).\nFlood Roofing workmanship warranty in accordance with our standard terms and conditions.',
      conditionSummary: '',
      conditionObservations: [],
      condRoofType: 'Hip roof', condPitch: '12°',
      startDate: '',
      timeline: [],
    });
    window.gotoTab && window.gotoTab('quote');
    window.applyQuoteToInputs && window.applyQuoteToInputs();
    window.refreshQuoteProposal && window.refreshQuoteProposal();
    document.documentElement.classList.add('print-quote');
    var keep = document.getElementById('quoteProposal');
    var body = document.body;
    var holder = document.createElement('div');
    holder.id = '__pdfHolder';
    holder.style.cssText = 'background:#fff;width:794px;margin:0 auto;padding:0';
    while (body.firstChild) body.removeChild(body.firstChild);
    var clone = keep.cloneNode(true);
    clone.style.border = 'none'; clone.style.borderRadius = '0'; clone.style.boxShadow = 'none';
    holder.appendChild(clone);
    body.appendChild(holder);
    var st = document.createElement('style');
    st.textContent = '@page { size: A4; margin: 0; }' +
      'html, body { margin:0; padding:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
      '#__pdfHolder .rp-page { page-break-inside: avoid; break-inside: avoid; page-break-after: always; break-after: page; }' +
      '#__pdfHolder .rp-page:last-of-type { page-break-after: auto; break-after: auto; }' +
      '#__pdfHolder img { max-width:100%; }';
    document.head.appendChild(st);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: 'floodroofing/docs/proposal_single_harrison.pdf', format: 'A4', printBackground: true,
    margin: { top:'0', right:'0', bottom:'0', left:'0' }, preferCSSPageSize: true });
  console.log('wrote floodroofing/docs/proposal_single_harrison.pdf');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
