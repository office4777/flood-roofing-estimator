// Render the sheet plan for (1) a simple 4-hip rectangle and
// (2) an L-shape 5-hip. Snapshot each so we have a baseline before
// rewriting the layout logic per the SOP.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  async function renderCase(label, setup) {
    await page.evaluate(setup);
    await page.waitForTimeout(300);
    // Switch to Materials & Sheet Layout tab and refresh.
    await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
    });
    await page.waitForTimeout(600);
    const out = `floodroofing/docs/sheet_plan_${label}.png`;
    // Try to scroll the sheet plan into view first.
    await page.evaluate(() => {
      const el = document.querySelector('#tab-materials .canvas-wrap, #roofSheetPlanOut');
      el && el.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: out, fullPage: false });
    console.log('wrote', out);
  }

  // CASE 1 — 4-hip rectangle (8 m wide × 5 m deep at 0.02 m/px scale).
  // Outline ABCD clockwise. Auto-generate hip & valley first.
  await renderCase('4hip', () => {
    window.DRAW.outline = [[200,150],[700,150],[700,450],[200,450]];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  // CASE 2 — L-shape (upper arm at top-right, lower arm at bottom-left).
  // Going clockwise from the top-left of the upper arm.
  await renderCase('Lshape', () => {
    window.DRAW.outline = [
      [350,120], [780,120], [780,420], [560,420],
      [560,520], [180,520], [180,320], [350,320]
    ];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
