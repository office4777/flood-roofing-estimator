// Dump live cascade strip data for canonical Big-L so we can verify
// donor identity and offcut grouping piece-by-piece.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });
  await page.evaluate(() => {
    window.DRAW.outline = [[100,100],[400,100],[400,400],[1000,400],[1000,1100],[100,1100]];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.gotoTab && window.gotoTab('materials');
    window.renderRoofSheetPlan && window.renderRoofSheetPlan();
  });
  await page.waitForTimeout(700);
  const data = await page.evaluate(() => {
    if (!window.__lastAllStrips) return null;
    return window.__lastAllStrips.map(function(s){
      return {
        color: s.color, seq: s.seq, isOffcut: !!s.isOffcut, isPhantom: !!s.isPhantom,
        faceType: s.face && s.face.type, faceColor: s.face && s.face.color,
        orderedLengthMm: s.orderedLengthMm,
        pieceM: s.pieceM,
        centroid: s.centroid.map(function(n){return Math.round(n*10)/10;}),
        poly: s.poly.map(function(p){return [Math.round(p[0]*10)/10, Math.round(p[1]*10)/10];}),
        _donorIdx: s._donorIdx
      };
    });
  });
  fs.writeFileSync('floodroofing/docs/_bigL_strips_dump.json', JSON.stringify(data, null, 2));
  console.log('wrote dump with', data.length, 'strips');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
