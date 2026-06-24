// Render a spread of representative test roofs through the app's
// sheet-layout engine and emit a single multi-page A4 PDF — one roof
// per cell, with sheet count + gap%/overlap% coverage stats beneath
// each diagram.  Used to showcase / verify the perfected sheet-plan
// logic across roof types and L-shape proportions in one document.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 120, oy = 120;
// L outline: wing (ww×wh) top-left, main (mw wide × mh tall) below.
const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
// Rectangle outline.
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
// T outline: stem centred under a wide cap.
const T = (capW, capH, stemW, stemH) => {
  const sx = ox + (capW - stemW) / 2;
  return [[ox,oy],[ox+capW,oy],[ox+capW,oy+capH],[sx+stemW,oy+capH],[sx+stemW,oy+capH+stemH],[sx,oy+capH+stemH],[sx,oy+capH],[ox,oy+capH]];
};

const CASES = [
  { label: 'Simple hip — 900×600 rectangle',          type:'hip',   outline: RECT(900,600) },
  { label: 'Straight gable — 900×600 rectangle',      type:'gable', outline: RECT(900,600) },
  { label: 'Dutch gable — 900×600 rectangle',         type:'dutch', outline: RECT(900,600) },
  { label: 'Mono pitch — 900×600 rectangle',          type:'mono',  outline: RECT(900,600) },
  { label: 'Canonical Big-L — wing 300×300 / main 900×700', type:'hip', outline: L(300,300,900,700) },
  { label: 'Small Big-L — wing 200×200 / main 700×500',     type:'hip', outline: L(200,200,700,500) },
  { label: 'Wide-wing L — 356×329 / 972×615',         type:'hip',   outline: L(356,329,972,615) },
  { label: 'Tall-wing L — 300×520 / main 800×360',    type:'hip',   outline: L(300,520,800,360) },
  { label: 'Fat-wing L — 520×300 / main 900×600',     type:'hip',   outline: L(520,300,900,600) },
  { label: 'T-shape — cap 900×260 / stem 300×460',    type:'hip',   outline: T(900,260,300,460) },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1300 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    const ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'none';
  });

  const shots = [];
  for (const c of CASES) {
    await page.evaluate(({ outline, type }) => {
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.DRAW.roofs = [];
      window.DRAW.activeRoofIdx = -1;
      window.autoGenerateRoof && window.autoGenerateRoof(type);
    }, c);
    await page.waitForTimeout(260);
    const res = await page.evaluate((outline) => {
      window.gotoTab && window.gotoTab('materials');
      var card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      var cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || (window.__lastSheetPlan && window.__lastSheetPlan.strips) || [];
      const bySeq = {}; all.forEach(s => { if (s.seq != null) (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      const strips = all.map(s => s.poly).filter(Boolean);
      const inPoly = (x,y,p)=>{let ins=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))ins=!ins;}return ins;};
      const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      let tot=0,gap=0,over=0;
      for(let y=y0;y<=y1;y+=5)for(let x=x0;x<=x1;x+=5){if(!inPoly(x,y,outline))continue;tot++;let cc=0;for(let k=0;k<strips.length;k++){if(inPoly(x,y,strips[k])){cc++;if(cc>1)break;}}if(cc===0)gap++;else if(cc>1)over++;}
      // Capture the rendered sheet-plan canvas directly (works even
      // while the card is display:none).
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: Object.keys(bySeq).length || all.length,
        gap:(100*gap/tot).toFixed(1), over:(100*over/tot).toFixed(1),
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    }, c.outline);
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    const clean = parseFloat(res.gap) < 1.5 && parseFloat(res.over) < 1.5;
    shots.push({ ...c, sheets: res.sheets, gap: res.gap, over: res.over, clean, b64: res.dataURL.split(',')[1] });
    console.log(`[${clean?'CLEAN':'CHECK'}] ${c.label} :: sheets=${res.sheets} gap%=${res.gap} over%=${res.over}`);
  }

  // Compose an A4 multi-page doc: 2 roofs per row, 3 rows per page.
  // The gap/overlap raster is only meaningful for hip / L / T roofs
  // (closed, single-layer face coverage).  Gable / dutch / mono use
  // full-span strips the probe can't model, so we badge only hip-type
  // cases and show a plain sheet count for the rest.
  const cells = shots.map(s => {
    const metricValid = s.type === 'hip';
    const badge = metricValid
      ? `<span class="badge ${s.clean?'ok':'warn'}">${s.clean?'CLEAN':'CHECK'}</span>`
      : '';
    const stat = metricValid
      ? `${s.sheets} sheets · gap ${s.gap}% · overlap ${s.over}%`
      : `${s.sheets} sheets`;
    return `
    <figure class="cell">
      <figcaption>${badge}<span class="lbl">${s.label}</span><span class="stat">${stat}</span></figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; }
    *{box-sizing:border-box;}
    body{margin:0;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a1628;}
    h1{font-size:19px;margin:0 0 4px;}
    .sub{color:#5b6675;font-size:12px;margin:0 0 14px;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .cell{break-inside:avoid;border:1px solid #d9dee6;border-radius:8px;padding:10px;background:#fafbfc;margin:0;}
    figcaption{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;}
    .badge{font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:10px;color:#fff;}
    .badge.ok{background:#137333;} .badge.warn{background:#b3261e;}
    .lbl{font-weight:700;font-size:12.5px;}
    .stat{color:#5b6675;font-size:11px;margin-left:auto;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:5px;background:#fff;}
  </style></head><body>
    <h1>Flood Roofing — sheet-layout diagram across test roofs</h1>
    <p class="sub">Each diagram is generated by the production sheet-plan engine. Coverage stats (gap% / overlap%) computed by a 5px raster over the roof polygon; CLEAN = both under 1.5%.</p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_multiroof_sheetplan.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: 'floodroofing/docs/sheetplan_test_roofs.pdf', format: 'A4', landscape: true, printBackground: true, margin: { top:'12mm', right:'12mm', bottom:'12mm', left:'12mm' } });
  fs.unlinkSync(tmp);
  const n = shots.filter(s => s.clean).length;
  console.log(`SUMMARY: ${n}/${shots.length} CLEAN — wrote floodroofing/docs/sheetplan_test_roofs.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
