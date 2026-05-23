// Render the modernised proposal sample to a PDF (A4) so the
// office can share / print / email it as a real file.
//
// Seeds the same Smith Residence sample data the screenshot harness
// uses, then triggers Chromium's PDF engine with the @media print
// rules applied so the proposal-only view renders without the editor
// chrome.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1750 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';

    function tile(hex, label){
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'+
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+hex+'"/><stop offset="1" stop-color="'+hex+'" stop-opacity=".55"/></linearGradient></defs>'+
        '<rect width="400" height="300" fill="url(#g)"/>'+
        '<g stroke="rgba(255,255,255,.18)" stroke-width="1.5" fill="none">'+
          '<path d="M0 240 L120 180 L240 240 L360 180 L400 200"/>'+
          '<path d="M40 260 V300 M120 220 V300 M200 250 V300 M280 220 V300 M360 230 V300"/>'+
        '</g>'+
        '<text x="20" y="40" font-family="Arial" font-size="22" font-weight="700" fill="rgba(255,255,255,.92)">'+label+'</text>'+
      '</svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    if (!window.S.settings) window.S.settings = {};
    if (!window.S.settings.branding) window.S.settings.branding = {};
    Object.assign(window.S.settings.branding, {
      company_name: 'FLOOD ROOFING',
      tagline: "Northland's Roofing Specialists",
      website: 'floodroofing.co.nz',
      phone: '021 277 5555',
      email: 'office@floodroofing.co.nz',
      address: 'Whangarei, Northland, NZ',
    });
    window.S.settings.branding.gallery_photos = [
      { src: tile('#3f3a32', 'Ironsand Hip — Tutukaka'),     caption: 'Ironsand Maxam — Tutukaka' },
      { src: tile('#1f2a23', 'Karaka Re-Roof — Whangarei'),  caption: 'Karaka Maxam — Whangarei' },
      { src: tile('#3a4654', 'New Denim — Onerahi'),         caption: 'New Denim — Onerahi' },
      { src: tile('#a8a59e', 'Sandstone Grey — Kerikeri'),   caption: 'Sandstone — Kerikeri' },
    ];

    window.S.roofData = {
      roof_type: 'Hip',
      area_m2: 148.6,
      pitch: 22,
      outline: [[10,20],[90,20],[90,80],[10,80]],
      faces: [
        { name:'Face A (N)', poly:[[10,20],[90,20],[70,50],[30,50]], area_m2:46.2, slope_dir:'N' },
        { name:'Face B (E)', poly:[[90,20],[90,80],[70,50]],          area_m2:28.4, slope_dir:'E' },
        { name:'Face C (S)', poly:[[90,80],[10,80],[30,50],[70,50]],  area_m2:46.2, slope_dir:'S' },
        { name:'Face D (W)', poly:[[10,80],[10,20],[30,50]],          area_m2:27.8, slope_dir:'W' },
      ],
      ridges:  [ { from:[30,50], to:[70,50], lengthM:7.6, label:'Main ridge' } ],
      valleys: [],
      hips:    [
        { from:[10,20], to:[30,50], lengthM:4.2 },
        { from:[90,20], to:[70,50], lengthM:4.2 },
        { from:[90,80], to:[70,50], lengthM:4.2 },
        { from:[10,80], to:[30,50], lengthM:4.2 },
      ],
      penetrations: [],
    };
    window.S.materials = { sheets: 78 };
    window.S.photos = [
      { src: tile('#1b1b1d', 'Site overview'),            caption: 'Site overview' },
      { src: tile('#5a4a3a', 'Existing ridge cap'),       caption: 'Existing ridge cap — flat-bar fixings' },
      { src: tile('#2c3128', 'North face'),               caption: 'North face — paint film failure' },
      { src: tile('#4a4a4d', 'East gutter line'),         caption: 'East gutter line + downpipe' },
      { src: tile('#5b6577', 'South soffit'),             caption: 'South soffit — rust at fixings' },
    ];

    if (!window.S.quote) window.S.quote = window.defaultQuote();
    Object.assign(window.S.quote, {
      ref: 'FR-2026-051',
      date: '22 May 2026',
      validUntil: '30 days',
      client: 'Smith Residence',
      addr:   '14 Pataua South Rd, Whangarei',
      email:  'mike.smith@example.co.nz',
      coverTitle: 'Roof Replacement — Smith Residence, Pataua South',
      aboutText:
        'Flood Roofing is a Northland-based roofing specialist established in 2016. Owner Aron Flood has 15+ years on the tools — from high-end architectural homes through to large commercial re-roofs — and only hires the best team along the way. We install premium NZ-made Colorsteel® Maxam and Endura products only, and back every roof with a written 10-year workmanship warranty.',
      scope: '• Strip existing corrugated steel roof + dispose to landfill\n• Inspect, replace damaged purlins (PC sum allowed)\n• Install new Maxam corrugate, all flashings, ridge caps\n• Re-flash chimney + 2× plumbing vents\n• 6m of new spouting on the south elevation',
      terms: '10-year workmanship warranty. Materials carry NZ Steel\'s 25-year perforation warranty in this exposure zone. 25% deposit on acceptance, 50% progress on completion of roof & gutters, 25% on practical completion. Quote valid 30 days.',
      gstRate: 15,
      options: [
        {
          id: 'optA',
          title: 'Standard Re-Roof — Colorsteel® Endura',
          description: 'Strip and replace using NZ Steel\'s standard Endura corrugate — proven NZ-made pre-painted steel with a 15-year manufacturer\'s warranty.',
          inclusions: [
            'Strip existing roof + safe disposal',
            'Install Endura corrugated sheet (0.55mm)',
            'New ridge, apron, and barge flashings',
            'Re-flash 1× chimney + 2× pipe penetrations',
            'Underlay (foil + breathable)',
            'Site clean-up + magnet sweep',
          ],
          lineItems: [
            { desc:'Endura corrugate sheet (0.55mm)',          qty: 78, unit: 78.50 },
            { desc:'Ridge & apron flashings — Endura',         qty: 32, unit: 36.00 },
            { desc:'Underlay + barge fixings',                 qty:  1, unit: 1240.00 },
            { desc:'Penetrations + chimney flashing kit',      qty:  3, unit: 285.00 },
            { desc:'Labour — strip, install, sign-off',        qty:  1, unit: 7800.00 },
            { desc:'Skip hire + disposal',                     qty:  1, unit: 480.00 },
          ],
          upgrades: [
            { id:'upA1', title:'Upgrade to 0.55mm Heavy-duty fixings', description:'Stainless tek screws + EPDM washers throughout. Recommended on coastal sites.', lineItems:[{desc:'HD tek-screw upgrade', qty:1, unit:380.00}] },
          ],
        },
        {
          id: 'optB',
          title: 'Premium Maxam Re-Roof — coastal-grade',
          description: 'Upgraded to Colorsteel® Maxam — thicker zinc-aluminium coating and a tougher paint film, engineered for Severe Marine zones. Best long-term value within 100m of the surf.',
          inclusions: [
            'Strip existing roof + safe disposal',
            'Install Maxam corrugated sheet (0.55mm)',
            'Stainless screws + EPDM washers',
            'Maxam ridge, apron, barge & gutter flashings',
            'Re-flash 1× chimney + 2× pipe penetrations',
            'Premium foil + breathable underlay',
            'Annual wash-down reminder service',
          ],
          lineItems: [
            { desc:'Maxam corrugate sheet (0.55mm)',           qty: 78, unit: 92.40 },
            { desc:'Maxam ridge & apron flashings',            qty: 32, unit: 44.00 },
            { desc:'Stainless tek screws + EPDM washers',      qty:  1, unit: 620.00 },
            { desc:'Underlay + barge fixings',                 qty:  1, unit: 1240.00 },
            { desc:'Penetrations + chimney flashing kit',      qty:  3, unit: 320.00 },
            { desc:'Labour — strip, install, sign-off',        qty:  1, unit: 8400.00 },
            { desc:'Skip hire + disposal',                     qty:  1, unit: 480.00 },
          ],
          upgrades: [
            { id:'upB1', title:'Re-line existing spouting in Maxam', description:'Replace 6m of south-elevation spouting in matching Maxam colour.', lineItems:[{desc:'Spouting re-line, south', qty:6, unit:78}, {desc:'Brackets + downpipe', qty:1, unit:240}] },
          ],
        },
      ],
      imageSlots: {
        cover_hero: { source:'stock', ref: 0 },
        recent_1:   { source:'stock', ref: 1 },
        recent_2:   { source:'stock', ref: 2 },
        recent_3:   { source:'stock', ref: 3 },
        maxam_1:    { source:'stock', ref: 0 },
        maxam_2:    { source:'stock', ref: 1 },
        maxam_3:    { source:'stock', ref: 2 },
        maxam_4:    { source:'stock', ref: 3 },
      },
    });

    window.gotoTab && window.gotoTab('quote');
    window.applyQuoteToInputs && window.applyQuoteToInputs();
    window.refreshQuoteProposal && window.refreshQuoteProposal();

    // Strip the editor chrome so the PDF only contains the proposal.
    // This sits alongside (not instead of) the existing @media print
    // rules — those work via window.print(); page.pdf() doesn't pick
    // them up reliably across all CSS in this file.
    var keep = document.getElementById('quoteProposal');
    var body = document.body;
    // Wrap the proposal in a clean container at the body root.
    var holder = document.createElement('div');
    holder.id = '__pdfHolder';
    holder.style.cssText = 'background:#fff;width:1100px;margin:0 auto;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    // Move (don't clone) so any inline event hooks stay live.
    while (body.firstChild) body.removeChild(body.firstChild);
    var clone = keep.cloneNode(true);
    clone.style.border = 'none';
    clone.style.borderRadius = '0';
    clone.style.boxShadow = 'none';
    holder.appendChild(clone);
    body.appendChild(holder);
    // Force every .rp-page onto its own printed page.
    var st = document.createElement('style');
    st.textContent =
      '@page { size: A4; margin: 0; }' +
      'html, body { margin:0; padding:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
      // 5-page compact layout: each .rp-page forces a new sheet.  The
      // tail footer must stick to the last page so it doesn't spill.
      '#__pdfHolder .rp-page { page-break-inside: avoid; break-inside: avoid; page-break-after: always; break-after: page; }' +
      '#__pdfHolder .rp-page:last-of-type { page-break-after: auto; break-after: auto; }' +
      '#__pdfHolder .rp-header { page-break-after: avoid; break-after: avoid; }' +
      '#__pdfHolder .rp-pdf-footer { page-break-before: avoid; break-before: avoid; page-break-inside: avoid; break-inside: avoid; }' +
      '#__pdfHolder img { max-width:100%; }';
    document.head.appendChild(st);
  });

  // Let the slot images + svgs fully paint before snapshotting.
  await page.waitForTimeout(800);

  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/proposal_modern_smith_residence.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: true,
  });
  console.log('wrote floodroofing/docs/proposal_modern_smith_residence.pdf');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
