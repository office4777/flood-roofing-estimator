// Test all L-shape orientations + a couple of new Big-L proportions to
// verify the sheet-identity numbering and orange donor rendering work
// for canonical and rotated cases.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  const cases = [
    // ─── First 6: previously verified ───
    {
      label: 'A: canonical 300x300 wing + 900x700 main (orient 0, wing top-left)',
      outline: [[100,100],[400,100],[400,400],[1000,400],[1000,1100],[100,1100]],
    },
    {
      label: 'B: 300x300 wing + 900x700 main (orient 3, wing top-right)',
      outline: [[1050,150],[1050,450],[750,450],[750,1050],[50,1050],[50,150]],
    },
    {
      label: 'C: 300x300 wing + 900x700 main (orient 2, wing bottom-right)',
      outline: [[1000,1100],[700,1100],[700,800],[100,800],[100,100],[1000,100]],
    },
    {
      label: 'D: 200x200 wing + 700x500 main (orient 0, wing top-left)',
      outline: [[100,100],[300,100],[300,300],[800,300],[800,800],[100,800]],
    },
    {
      label: 'E: 150x150 wing + 900x700 main (orient 0, tiny wing)',
      outline: [[100,100],[250,100],[250,250],[1000,250],[1000,950],[100,950]],
    },
    {
      label: 'F: 350x350 wing + 1000x800 main (orient 0, wing near max)',
      outline: [[100,100],[450,100],[450,450],[1100,450],[1100,1250],[100,1250]],
    },
    // ─── 4 NEW: more even wing/main ratios + wing at bottom ───
    {
      label: 'G: 400x400 wing + 900x800 main (orient 0, even ratio)',
      outline: [[100,100],[500,100],[500,500],[1000,500],[1000,1300],[100,1300]],
    },
    {
      label: 'H: 450x450 wing + 1000x900 main (orient 0, bigger even ratio)',
      outline: [[100,100],[550,100],[550,550],[1100,550],[1100,1450],[100,1450]],
    },
    {
      label: 'I: 400x400 wing + 900x800 main (orient 2, wing BOTTOM-right, even ratio)',
      outline: [[1000,1300],[600,1300],[600,900],[100,900],[100,100],[1000,100]],
    },
    {
      label: 'J: 350x350 wing + 850x750 main (orient 2, wing BOTTOM-right)',
      outline: [[950,1200],[600,1200],[600,850],[100,850],[100,100],[950,100]],
    },
  ];

  const captures = [];
  for (const c of cases) {
    await page.evaluate((outline) => {
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.autoGenerateRoof && window.autoGenerateRoof('hip');
    }, c.outline);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
    });
    await page.waitForTimeout(700);
    const result = await page.evaluate(() => {
      const cvs = document.querySelector('#roofSheetPlanOut canvas');
      const all = window.__lastAllStrips || [];
      const bySeq = {};
      all.forEach(s => { (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      const multi = Object.entries(bySeq).filter(([n, ps]) => ps.length >= 2);
      return {
        canvasDataURL: cvs ? cvs.toDataURL('image/png') : null,
        totalSheets: Object.keys(bySeq).length,
        multiPieceCount: multi.length,
        rainbowOrange: all.filter(s => s._donorIdx !== undefined).every(s => s.color === '#f97316'),
      };
    });
    captures.push({ ...c, ...result });
    console.log(`captured ${c.label}: ${result.totalSheets} sheets, ${result.multiPieceCount} multi-piece, rainbowOrange=${result.rainbowOrange}`);
  }

  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;}
    body{margin:0;padding:24px;background:#fff;font:13px/1.4 -apple-system,Inter,sans-serif;color:#111;}
    h1{font-size:18px;margin:0 0 16px;}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;}
    .cell{border:1px solid #ddd;border-radius:8px;padding:12px;background:#fafafa;}
    .ttl{font-weight:600;font-size:12.5px;margin-bottom:6px;}
    .stat{font-size:11.5px;color:#555;margin-bottom:8px;}
    img{display:block;width:100%;height:auto;border:1px solid #eee;background:#fff;}
  </style></head><body>
  <h1>L-shape Big-L cascade — sheet-identity numbering verification</h1>
  <div class="grid">
  ${captures.map(c => `
    <div class="cell">
      <div class="ttl">${c.label}</div>
      <div class="stat">${c.totalSheets} sheets • ${c.multiPieceCount} multi-piece • rainbow-orange: <b>${c.rainbowOrange ? 'OK' : 'FAIL'}</b></div>
      <img src="${c.canvasDataURL}"/>
    </div>
  `).join('')}
  </div></body></html>`;

  const tmp = path.resolve('floodroofing/docs/_bigL_orientations_grid.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w + 24, 2400), height: Math.min(dim.h + 24, 4200) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/bigL_orientations_grid.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);
  fs.unlinkSync(tmp);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
