// Regression grid: lay the sheet cascade across 6 L-shape + 6 T-shape roofs
// and report gap% / overlap% (coverage raster) per case. Writes a visual grid.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ox = 100, oy = 100;

// L: top-left wing (ww x wh) over a main body (mw x mh) below.
const lOutline = c => [
  [ox, oy], [ox + c.ww, oy], [ox + c.ww, oy + c.wh],
  [ox + c.mw, oy + c.wh], [ox + c.mw, oy + c.wh + c.mh], [ox, oy + c.wh + c.mh]
];
// T: full-width cap (cw x ch) on top, centred stem (sw x sh) hanging below.
const tOutline = c => {
  const l = ox + (c.cw - c.sw) / 2, r = ox + (c.cw + c.sw) / 2;
  return [
    [ox, oy], [ox + c.cw, oy], [ox + c.cw, oy + c.ch],
    [r, oy + c.ch], [r, oy + c.ch + c.sh],
    [l, oy + c.ch + c.sh], [l, oy + c.ch], [ox, oy + c.ch]
  ];
};

const CASES = [
  { type:'L', label:'L · canonical wing 300×300 / 900×700', outline:lOutline({ww:300,wh:300,mw:900,mh:700}) },
  { type:'L', label:'L · tall narrow wing 250×450 / 900×700', outline:lOutline({ww:250,wh:450,mw:900,mh:700}) },
  { type:'L', label:'L · wide wing 356×329 / 972×615', outline:lOutline({ww:356,wh:329,mw:972,mh:615}) },
  { type:'L', label:'L · fat wing 520×300 / 900×600', outline:lOutline({ww:520,wh:300,mw:900,mh:600}) },
  { type:'L', label:'L · tall wing/short main 300×520 / 800×360', outline:lOutline({ww:300,wh:520,mw:800,mh:360}) },
  { type:'L', label:'L · big wing/small main 450×400 / 700×500', outline:lOutline({ww:450,wh:400,mw:700,mh:500}) },
  { type:'T', label:'T · classic cap 900×250 / stem 300×450', outline:tOutline({cw:900,ch:250,sw:300,sh:450}) },
  { type:'T', label:'T · wide thin cap 1000×200 / stem 260×500', outline:tOutline({cw:1000,ch:200,sw:260,sh:500}) },
  { type:'T', label:'T · thick cap short stem 800×400 / 300×300', outline:tOutline({cw:800,ch:400,sw:300,sh:300}) },
  { type:'T', label:'T · narrow cap fat stem 700×250 / 450×450', outline:tOutline({cw:700,ch:250,sw:450,sh:450}) },
  { type:'T', label:'T · tall stem 900×220 / stem 300×600', outline:tOutline({cw:900,ch:220,sw:300,sh:600}) },
  { type:'T', label:'T · squat 1000×300 / stem 360×300', outline:tOutline({cw:1000,ch:300,sw:360,sh:300}) },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.querySelector('.app').style.display=''; document.getElementById('login-screen').style.display='none'; });
  const captures = [];
  for (const c of CASES) {
    const outline = c.outline;
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
  const nL = captures.filter(c=>c.type==='L').length, nLpass = captures.filter(c=>c.type==='L'&&parseFloat(c.gapPct)<1.5&&parseFloat(c.overPct)<1.5).length;
  const nT = captures.filter(c=>c.type==='T').length, nTpass = captures.filter(c=>c.type==='T'&&parseFloat(c.gapPct)<1.5&&parseFloat(c.overPct)<1.5).length;
  console.log(`SUMMARY: ${nPass}/${captures.length} clean (L ${nLpass}/${nL}, T ${nTpass}/${nT})`);
  const cols=6;
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
    .grid{display:grid;grid-template-columns:repeat(${cols},360px);gap:14px;justify-content:center;}
    .cell{border:1px solid #ddd;border-radius:8px;padding:8px;background:#fafafa;}
    .ttl{font-weight:600;font-size:12px;margin-bottom:4px;text-align:center;min-height:30px;}
    .stat{font-size:11px;color:#555;margin-bottom:5px;text-align:center;}
    img{display:block;width:100%;height:auto;border:1px solid #eee;background:#fff;}
  </style></head><body><h1>Sheet cascade — L (${nLpass}/${nL}) + T (${nTpass}/${nT}) — ${nPass}/${captures.length} clean</h1><div class="grid">${cells}</div></body></html>`;
  const tmp = path.resolve('docs/_LT_variants.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
  const dim = await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));
  await page.setViewportSize({ width: Math.min(dim.w+24,2600), height: Math.min(dim.h+24,3400) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/LT_variants_grid.png', fullPage: true });
  fs.unlinkSync(tmp);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
