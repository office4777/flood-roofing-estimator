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
    const out = `floodroofing/docs/${label}.png`;
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
  await renderCase('01_4hip_EW', () => {
    window.DRAW.outline = [[200,150],[700,150],[700,450],[200,450]];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  // CASE 1b — same 4-hip rotated 90° so the LONG axis runs N–S.
  // East/west are the long-sides; north/south are the hip-ends.
  // Exercises the cascade in the opposite orientation to verify the
  // logic isn't hard-coded to a horizontal long axis.
  await renderCase('02_4hip_NS', () => {
    window.DRAW.outline = [[200,150],[500,150],[500,650],[200,650]];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  // CASE 2 — SOP-style L-shape: a long horizontal main body with a
  // wing extending DOWN from the right portion. The blue (bottom)
  // long-side is the one truncated by the wing.
  //
  //   +--------------------+   ← top of main
  //   |     main body      |
  //   +--------+----+------+   ← bottom of main meets wing on the right
  //            |    |          ← wing extends DOWN
  //            +----+
  await renderCase('04_Lshape_SOP', () => {
    window.DRAW.outline = [
      [200, 150], [780, 150], [780, 480], [560, 480],
      [560, 320], [200, 320]
    ];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  // CASE 3 — bigger SOP L-shape: wing on the TOP-LEFT, main on the
  // bottom-right. 900×700 main + 300×300 wing.  This time the orange
  // (top) long-side is the truncated one — its phantom extension
  // crosses x=100..400 over the wing footprint.
  //
  //   +-----+
  //   | wing|
  //   |     |
  //   +-----+--------------+   ← top of main starts at C=(400,400)
  //   |                    |
  //   |     main body      |
  //   |                    |
  //   +--------------------+
  await renderCase('05_Lshape_Big', () => {
    window.DRAW.outline = [
      [100, 100], [400, 100], [400, 400], [1000, 400],
      [1000, 1100], [100, 1100]
    ];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
