// Regression harness: lay the sheet cascade across many L proportions and
// report gap% / overlap% (coverage raster) per case. Writes a visual grid.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ox=100, oy=100;
const CASES = [
  { label:'Canonical 300×300 / 900×700', ww:300, wh:300, mw:900, mh:700 },
  { label:'Tall narrow wing 250×450 / 900×700', ww:250, wh:450, mw:900, mh:700 },
  { label:'Square-edge wing 350×350 / 900×700', ww:350, wh:350, mw:900, mh:700 },
  { label:'Small wing 200×200 / 1000×800', ww:200, wh:200, mw:1000, mh:800 },
  { label:'WIDE wing 356×329 / 972×615 (your roof)', ww:356, wh:329, mw:972, mh:615 },
  { label:'Fat wing 520×300 / 900×600', ww:520, wh:300, mw:900, mh:600 },
  { label:'Tall wing/short main 300×520 / 800×360', ww:300, wh:520, mw:800, mh:360 },
  { label:'Big wing/small main 450×400 / 700×500', ww:450, wh:400, mw:700, mh:500 },
];
const outlineFor=c=>[[ox,oy],[ox+c.ww,oy],[ox+c.ww,oy+c.wh],[ox+c.mw,oy+c.wh],[ox+c.mw,oy+c.wh+c.mh],[ox,oy+c.wh+c.mh]];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.querySelector('.app').style.display=''; document.getElementById('login-screen').style.display='none'; });
  const captures = [];
  for (const c of CASES) {
    const outline = outlineFor(c);
    await page.evaluate((outline) => {
      window.DRAW.outline = outline; window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02; window.DRAW.calPitch = 22; window.DRAW.lines = []; window.DRAW.roofs=[]; window.DRAW.activeRoofIdx=-1;
      window.autoGenerateRoof && window.autoGenerateRoof('hip');
    }, outline);
    await page.waitForTimeout(220);
    await page.evaluate(() => { window.gotoTab && window.gotoTab('materials'); window.renderRoofSheetPlan && window.renderRoofSheetPlan(); });
    await page.waitForTimeout(450);
    const result = await page.evaluate((outline) => {
      const cvs = document.querySelector('#roofSheetPlanOut canvas');
      const all = window.__lastAllStrips || (window.__lastSheetPlan && window.__lastSheetPlan.strips) || [];
      const bySeq = {}; all.forEach(s => { if(s.seq!=null)(bySeq[s.seq]=bySeq[s.seq]||[]).push(s); });
      const strips = all.map(s=>s.poly).filter(Boolean);
      function inPoly(x,y,p){var ins=false;for(var i=0,j=p.length-1;i<p.length;j=i++){var xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))ins=!ins;}return ins;}
      var xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]); var x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      var step=5, tot=0, gap=0, over=0;
      for(var y=y0;y<=y1;y+=step)for(var x=x0;x<=x1;x+=step){ if(!inPoly(x,y,outline))continue; tot++; var k,c2=0; for(k=0;k<strips.length;k++){if(inPoly(x,y,strips[k])){c2++;if(c2>1)break;}} if(c2===0)gap++; else if(c2>1)over++; }
      return { canvasDataURL: cvs?cvs.toDataURL('image/png'):null, totalSheets: Object.keys(bySeq).length||all.length, gapPct:(100*gap/tot).toFixed(1), overPct:(100*over/tot).toFixed(1) };
    }, outline);
    captures.push({ ...c, ...result });
    const clean = parseFloat(result.gapPct)<1.5 && parseFloat(result.overPct)<1.5;
    console.log(`[${clean?'PASS':'FAIL'}] ${c.label} :: sheets=${result.totalSheets} gap%=${result.gapPct} over%=${result.overPct}`);
  }
  const nPass = captures.filter(c=>parseFloat(c.gapPct)<1.5&&parseFloat(c.overPct)<1.5).length;
  console.log(`SUMMARY: ${nPass}/${captures.length} clean`);
  const cols=4;
  const cells = captures.map(c=>{
    const clean = parseFloat(c.gapPct)<1.5 && parseFloat(c.overPct)<1.5;
    const badge = clean ? '<span style="color:#137333;font-weight:700">CLEAN</span>' : '<span style="color:#b3261e;font-weight:700">ISSUES</span>';
    return `<div class="cell"><div class="ttl">${c.label}</div>
      <div class="stat">${badge} &nbsp;|&nbsp; ${c.totalSheets} sheets &nbsp;|&nbsp; gap ${c.gapPct}% &nbsp;|&nbsp; overlap ${c.overPct}%</div>
      <img src="${c.canvasDataURL}"/></div>`;
  }).join('');
  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;} body{margin:0;padding:20px;background:#fff;font:12px/1.4 sans-serif;color:#111;}
    h1{font-size:17px;margin:0 0 12px;text-align:center;}
    .grid{display:grid;grid-template-columns:repeat(${cols},380px);gap:16px;justify-content:center;}
    .cell{border:1px solid #ddd;border-radius:8px;padding:8px;background:#fafafa;}
    .ttl{font-weight:600;font-size:12px;margin-bottom:4px;text-align:center;min-height:30px;}
    .stat{font-size:11px;color:#555;margin-bottom:5px;text-align:center;}
    img{display:block;width:100%;height:auto;border:1px solid #eee;background:#fff;}
  </style></head><body><h1>L-shape sheet-cascade — ${nPass}/${captures.length} clean</h1><div class="grid">${cells}</div></body></html>`;
  const tmp = path.resolve('docs/_L_variants.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
  const dim = await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));
  await page.setViewportSize({ width: Math.min(dim.w+24,2600), height: Math.min(dim.h+24,3400) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/L_variants_grid.png', fullPage: true });
  fs.unlinkSync(tmp);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
