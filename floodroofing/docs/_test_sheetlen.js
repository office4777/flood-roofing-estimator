// Verify: sheet length + gutter arrow shows on a section after
// scaleMetresPerPx is set. Headless seeds an outline + gutter lines +
// one section + calibration, then redraws.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    // Rectangular outline + one section sitting on its bottom edge,
    // with a co-located gutter line. scaleMetresPerPx set so the
    // label can compute.
    const A=[180,150], B=[620,150], C=[620,460], D=[180,460];
    window.DRAW.outline = [A,B,C,D];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.014;  // ~1px = 14mm
    // Gutter at the bottom edge of the building
    window.DRAW.lines.push({type:'gutter', pts:[D, C], label:'', measM:null, lengthM:'', sheetLengthM:null});
    // Section covering the lower half — gutter is the bottom edge.
    window.DRAW.sections.push({
      name:'South face', poly:[ [180,300], [620,300], [620,460], [180,460] ],
      color:'#dbeafe', border:'#2563eb', slope:'', slopeUnit:'mm',
      width:'', widthUnit:'m', pitch:'18', dir:'S', area:''
    });
    window.setTool && window.setTool('select');
    window.redrawAll && window.redrawAll();
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v13_sheetlen.png', fullPage: false });
  console.log('wrote redesign_v13_sheetlen.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
