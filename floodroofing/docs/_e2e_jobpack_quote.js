// End-to-end app test: draw an L-shape roof, run the real engine, then
// produce a single PDF per job containing BOTH the Job Pack (materials /
// sheet plan / cut lists) and the customer Quote — exactly what the
// office would generate for a real job. Two jobs: a hipped L and a
// gabled L.
//
// Each job does ONE page load: seed → draw + autoGenerateRoof → render
// Job Pack, capture it via the app's own print-jobpack CSS → then set
// up + capture the Quote via the rp-page print holder. The two page
// ranges are merged with pdf-lib into one file.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require(path.resolve('node_modules/pdf-lib'));

const CHROMIUM = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// L-shape outline: wing 300×300 top-left, main 600×700 below-right.
const L_OUTLINE = [[140,140],[440,140],[440,440],[1040,440],[1040,1140],[140,1140]];

const JOBS = [
  {
    key: 'hip',
    roofType: 'hip',
    file: 'floodroofing/docs/e2e_lshape_hip.pdf',
    ref: 'FR-2026-101',
    client: 'Anderson Residence',
    addr: '42 Ridgeway Road, Kerikeri',
    cover: 'Roof Replacement — Anderson Residence, Kerikeri',
    roofLabel: 'L-shape hipped roof (hip & valley)',
  },
  {
    key: 'gable',
    roofType: 'gable',
    file: 'floodroofing/docs/e2e_lshape_gable.pdf',
    ref: 'FR-2026-102',
    client: 'Whittaker Residence',
    addr: '8 Parua Bay Road, Whangarei',
    cover: 'Roof Replacement — Whittaker Residence, Parua Bay',
    roofLabel: 'L-shape gable roof',
  },
];

// Shared seed (branding + quote options), parameterised by job.
function seedScript(job) {
  return (j) => {
    document.querySelector('.app').style.display = '';
    const ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'none';

    function tile(hex, label){
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="'+hex+'"/><text x="20" y="40" font-family="Arial" font-size="20" fill="#fff">'+label+'</text></svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    window.S = window.S || {};
    S.settings = S.settings || {}; S.settings.branding = S.settings.branding || {};
    Object.assign(S.settings.branding, {
      company_name: 'FLOOD ROOFING', tagline: "Northland's Roofing Specialists",
      website: 'floodroofing.co.nz', phone: '021 277 5555', email: 'office@floodroofing.co.nz',
      address: 'Whangarei, Northland, NZ',
      team: [
        { role:'Owner / Project Lead', name:'Aron Flood', responsibilities:'Quoting, site supervision, sign-off' },
        { role:'Lead Roofer', name:'Sam Whittaker', responsibilities:'On-site lead, installation, QC' },
        { role:'Roofers (×2)', name:'Jase + Mason', responsibilities:'Strip-out + install crew' },
        { role:'Apprentice', name:'Tane Mahuta', responsibilities:'Materials handling, supervised work' },
      ],
      gallery_photos: [
        { src: tile('#3f3a32','Ironsand'), caption:'Ironsand Maxam — Tutukaka' },
        { src: tile('#1f2a23','Karaka'),   caption:'Karaka Maxam — Whangarei' },
        { src: tile('#3a4654','New Denim'),caption:'New Denim — Onerahi' },
        { src: tile('#a8a59e','Sandstone'),caption:'Sandstone — Kerikeri' },
      ],
    });

    // ── Draw the L-shape roof and run the real engine ──
    window.DRAW.gableEnds = null; window.DRAW.gableRidgeOffset = 0;
    window.DRAW.outline = j.outline; window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02; window.DRAW.calPitch = 22;
    window.DRAW.lines = []; window.DRAW.roofs = []; window.DRAW.activeRoofIdx = -1;
    window.autoGenerateRoof(j.roofType);
    try { window.redrawAll && window.redrawAll(); } catch(e){}
    try { window.syncToRoofData && window.syncToRoofData(); } catch(e){}

    // Roof stats for the quote scope page.
    S.roofData = Object.assign(S.roofData || {}, {
      roof_type: j.roofType === 'hip' ? 'Hip' : 'Gable',
      area_m2: 168.4, pitch: 22,
    });
    S.materials = S.materials || {};

    S.photos = [
      { src: tile('#1b1b1d','Site overview'), caption:'Site overview' },
      { src: tile('#5a4a3a','Ridge cap'),     caption:'Existing ridge cap — flat-bar fixings' },
    ];

    if (!S.quote) S.quote = window.defaultQuote();
    Object.assign(S.quote, {
      ref: j.ref, date: '2 July 2026', validUntil: '21 days',
      client: j.client, addr: j.addr, email: 'owner@example.co.nz',
      coverTitle: j.cover,
      aboutText: 'Flood Roofing is the well-trusted name in Northland — high-quality, efficient roofing since 2016 across Whangarei, Kerikeri and the Bay of Islands.\nAll lead roofers are trade-qualified LBPs; we fit genuine NZ-made Colorsteel® MAXAM as standard and back our workmanship with a written 10-year warranty.\n100% price guarantee — the price we quote is the price you pay, scaffolding included.',
      scope: '• Strip existing roof + dispose to landfill\n• New 70×45 H1 purlins + synthetic underlay\n• Install new Colorsteel MAXAM corrugate, all flashings\n• Re-flash penetrations + new spouting',
      conditionSummary: 'Existing roof is original Colorsteel corrugate with paint-film failure and surface rust at fixings on the exposed faces. We recommend a full strip-and-replace.',
      conditionObservations: [
        'Paint film failure on the weather faces (chalk + flake)',
        'Surface rust at fixing points',
        'Ridge cap lifted — flat-bar fixings outdated',
        'Underlay degraded (visible from ceiling space)',
        'Spouting undersized for the catchment',
        'No identified asbestos products',
      ],
      startDate: 'Mid-July 2026', gstRate: 15, terms: '',
      timeline: [
        { label:'Site setup + edge protection', days:1 },
        { label:'Strip existing roof + dispose', days:1 },
        { label:'Install underlay + MAXAM', days:3 },
        { label:'Flashings + new spouting', days:1 },
        { label:'Final clean + sign-off', days:1 },
      ],
      options: [{
        id:'optMain', title: j.roofLabel + ' — Colorsteel® MAXAM',
        description: 'Re-roof of the '+j.roofLabel+' in standard 0.40g Colorsteel® MAXAM, corrugated profile, 50-year warranty in Mild environments.',
        inclusions: [
          'Erect edge-protection scaffolding',
          'Supply & install new 70×45 H1 purlins',
          'Supply & install synthetic self-support underlay',
          'Supply & install new Colorsteel® MAXAM 0.40g corrugate',
          'Supply & install all associated flashings',
          'Leave site clean and tidy',
        ],
        lineItems: [
          { desc:'Colorsteel® MAXAM corrugate (0.40g)', qty:168, unit:78.50 },
          { desc:'MAXAM ridge, apron & barge flashings', qty:38, unit:42.00 },
          { desc:'70×45 H1 purlins + fixings', qty:1, unit:1680.00 },
          { desc:'Synthetic self-support underlay', qty:1, unit:1120.00 },
          { desc:'Penetrations + chimney flashing kit', qty:3, unit:285.00 },
          { desc:'Labour — strip, install, sign-off', qty:1, unit:8600.00 },
          { desc:'Skip hire + disposal', qty:1, unit:520.00 },
        ],
        upgrades: [
          { id:'u1', title:'Downgrade to Zinc-Aluminium (plain silver, 20-yr warranty)', description:'Commercial-grade Zincalume, lower cost.', lineItems:[{desc:'Zinc-Al credit',qty:1,unit:-1890.00}] },
          { id:'u2', title:'Upgrade to 0.55g Colorsteel® MAXAM', description:'Thicker sheet, same warranty.', lineItems:[{desc:'0.55g upgrade',qty:1,unit:1180.00}] },
          { id:'u3', title:'Replace gutters with Colorsteel® 125mm Box Gutter', description:'Higher flow capacity, matched to roof.', lineItems:[{desc:'Box gutter upgrade',qty:1,unit:3850.00}] },
        ],
      }],
      imageSlots: { maxam_1:{source:'stock',ref:0}, maxam_2:{source:'stock',ref:1}, maxam_3:{source:'stock',ref:2}, maxam_4:{source:'stock',ref:3} },
    });
  };
}

async function loadPdf(page) {
  return await page.pdf({ format: 'A4', printBackground: true, margin: { top:'0', right:'0', bottom:'0', left:'0' }, preferCSSPageSize: true });
}

async function runJob(browser, job) {
  const page = await (await browser.newContext({ viewport: { width: 1240, height: 1750 } })).newPage();
  page.on('pageerror', e => console.error('  PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(seedScript(job), { outline: L_OUTLINE, roofType: job.roofType, ref: job.ref, client: job.client, addr: job.addr, cover: job.cover, roofLabel: job.roofLabel });

  // ── Capture 1: Job Pack (materials tab, print-jobpack CSS) ──
  await page.evaluate((j) => {
    // The Job Pack header mirrors the #jobClient / #jobAddr inputs +
    // job number — populate them so the printed pack isn't blank.
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('jobClient', j.client); set('jobAddr', j.addr); set('matJobNumber', j.ref);
    const jd = document.getElementById('jobDate'); if (jd) jd.value = '2026-07-02';
    window.gotoTab('materials');
    try { window.renderRoofSheetPlan(); } catch(e){}
    try { window.renderMaterialsCutLists && window.renderMaterialsCutLists(); } catch(e){}
    try { window.renderMatRoofMap && window.renderMatRoofMap(); } catch(e){}
    try { window.renderJobPack && window.renderJobPack(); } catch(e){}
    document.documentElement.classList.add('print-jobpack');
  }, { client: job.client, addr: job.addr, ref: job.ref });
  await page.waitForTimeout(900);
  await page.emulateMedia({ media: 'print' });
  const jobPackPdf = await loadPdf(page);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.documentElement.classList.remove('print-jobpack'));

  // ── Capture 2: Quote (rp-page holder, same as proposal export) ──
  await page.evaluate(() => {
    window.gotoTab('quote');
    try { window.applyQuoteToInputs && window.applyQuoteToInputs(); } catch(e){}
    try { window.refreshQuoteProposal(); } catch(e){}
    const keep = document.getElementById('quoteProposal');
    const body = document.body;
    const holder = document.createElement('div');
    holder.id = '__pdfHolder';
    holder.style.cssText = 'background:#fff;width:794px;margin:0 auto;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    while (body.firstChild) body.removeChild(body.firstChild);
    const clone = keep.cloneNode(true);
    clone.style.border = 'none'; clone.style.borderRadius = '0'; clone.style.boxShadow = 'none';
    holder.appendChild(clone); body.appendChild(holder);
    const st = document.createElement('style');
    st.textContent =
      '@page { size: A4; margin: 0; }' +
      'html, body { margin:0; padding:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
      '#__pdfHolder .rp-page { page-break-inside: avoid; break-inside: avoid; page-break-after: always; break-after: page; }' +
      '#__pdfHolder .rp-page:last-of-type { page-break-after: auto; break-after: auto; }' +
      '#__pdfHolder img { max-width:100%; }';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(800);
  await page.emulateMedia({ media: 'print' });
  const quotePdf = await loadPdf(page);

  // ── Merge Job Pack + Quote into one file ──
  const out = await PDFDocument.create();
  for (const buf of [jobPackPdf, quotePdf]) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  fs.writeFileSync(job.file, await out.save());
  const jpN = (await PDFDocument.load(jobPackPdf)).getPageCount();
  const qN = (await PDFDocument.load(quotePdf)).getPageCount();
  console.log(`[${job.key}] Job Pack ${jpN}p + Quote ${qN}p → ${job.file} (${jpN+qN} pages)`);
  await page.context().close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  for (const job of JOBS) await runJob(browser, job);
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
