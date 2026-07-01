// Complex multi-reflex roof shapes (staircase / U / Z / T / plus / H /
// double-step) run through the production hip engine + sheet-plan, all
// composed into one A4 PDF.  Mirrors the stepped-L "staircase" roof the
// user is testing on the older preview, plus a spread of other awkward
// footprints to stress face detection and the donor cascade.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Each outline is a simple (non-self-intersecting) polygon in px.
const CASES = [
  {
    label: 'A — Staircase-L (2 step)',
    subtitle: 'Stepped down-right then in-left — the attached footprint.',
    outline: [[100,100],[1000,100],[1000,750],[750,750],[750,1050],[400,1050],[400,650],[100,650]],
  },
  {
    label: 'B — U-shape / courtyard',
    subtitle: 'Rectangle with a notch cut up from the bottom edge.',
    outline: [[100,100],[1000,100],[1000,900],[720,900],[720,450],[380,450],[380,900],[100,900]],
  },
  {
    label: 'C — Z-shape (offset wings)',
    subtitle: 'Two rectangles offset diagonally, joined at the middle.',
    outline: [[100,100],[650,100],[650,450],[1050,450],[1050,950],[500,950],[500,600],[100,600]],
  },
  {
    label: 'D — T-shape (cap + stem)',
    subtitle: 'Wide cap across the top, central stem hanging down.',
    outline: [[100,100],[1000,100],[1000,380],[690,380],[690,950],[410,950],[410,380],[100,380]],
  },
  {
    label: 'E — Plus / cross plan',
    subtitle: 'Four arms off a central body — four hip ends, four valleys.',
    outline: [[420,130],[680,130],[680,420],[970,420],[970,680],[680,680],[680,970],[420,970],[420,680],[130,680],[130,420],[420,420]],
  },
  {
    label: 'F — Triple staircase (3 step)',
    subtitle: 'Cascades down-right in three steps — worst-case for face walk.',
    outline: [[100,100],[400,100],[400,350],[700,350],[700,600],[1000,600],[1000,1000],[100,1000]],
  },
  {
    label: 'G — H-shape',
    subtitle: 'Two vertical bars joined by a central spine — 12 corners.',
    outline: [[100,100],[350,100],[350,450],[750,450],[750,100],[1000,100],[1000,900],[750,900],[750,600],[350,600],[350,900],[100,900]],
  },
  {
    label: 'H — Complex asymmetric (bump + steps)',
    subtitle: 'Right-side bump-out plus a lower-left step — 10 corners.',
    outline: [[100,100],[900,100],[900,400],[1100,400],[1100,850],[600,850],[600,1100],[300,1100],[300,600],[100,600]],
  },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    const ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'none';
  });

  const shots = [];
  for (const c of CASES) {
    await page.evaluate((outline) => {
      window.DRAW.gableRidgeOffset = 0;
      window.DRAW.gableEnds = null;
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.DRAW.roofs = [];
      window.DRAW.activeRoofIdx = -1;
      window.autoGenerateRoof && window.autoGenerateRoof('hip');
    }, c.outline);
    await page.waitForTimeout(320);
    const res = await page.evaluate((outline) => {
      window.gotoTab && window.gotoTab('materials');
      const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      const cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || [];
      // Unique sheets (by seq) + their representative length (m).
      const seqLen = {};
      all.forEach(s => {
        if (s.seq == null) return;
        const m = s.face && (s.face.sheetM || s.face.planSheetM);
        if (m != null && (seqLen[s.seq] == null || m > seqLen[s.seq])) seqLen[s.seq] = m;
      });
      const seqs = Object.keys(seqLen);
      // "Sheets to order": bucket unique sheets by rounded length.
      const buckets = {};
      seqs.forEach(q => {
        const mm = Math.round(seqLen[q] * 1000);
        buckets[mm] = (buckets[mm] || 0) + 1;
      });
      const order = Object.keys(buckets).map(Number).sort((a, b) => b - a)
        .map(mm => ({ count: buckets[mm], mm, m: (mm / 1000).toFixed(2) }));
      // Coverage stat (5px raster).
      const inPoly = (x,y,p)=>{let ins=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))ins=!ins;}return ins;};
      const strips = all.map(s => s.poly).filter(Boolean);
      const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      let tot=0,gap=0,over=0;
      for(let y=y0;y<=y1;y+=5)for(let x=x0;x<=x1;x+=5){if(!inPoly(x,y,outline))continue;tot++;let cc=0;for(let k=0;k<strips.length;k++){if(inPoly(x,y,strips[k])){cc++;if(cc>1)break;}}if(cc===0)gap++;else if(cc>1)over++;}
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: seqs.length || all.length,
        strips: all.length,
        order,
        gap: (100*gap/tot).toFixed(1),
        over: (100*over/tot).toFixed(1),
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    }, c.outline);
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    const clean = parseFloat(res.gap) < 2.0 && parseFloat(res.over) < 2.0;
    shots.push({ ...c, ...res, clean, b64: res.dataURL.split(',')[1] });
    console.log(`[${clean?'CLEAN':'CHECK'}] ${c.label} :: sheets=${res.sheets} strips=${res.strips} gap%=${res.gap} over%=${res.over} order=${res.order.map(o=>o.count+'x'+o.m).join(', ')}`);
  }

  const cells = shots.map(s => {
    const legend = s.order.map(o => `<li><span class="sw"></span>${o.count} × @ ${o.mm}mm <span class="m">(${o.m}m)</span></li>`).join('');
    return `
    <figure class="cell">
      <figcaption>
        <div class="row1"><span class="lbl">${s.label}</span>
          <span class="badge ${s.clean?'ok':'warn'}">${s.clean?'CLEAN':'CHECK'}</span>
          <span class="stat">${s.sheets} sheets · ${s.strips} strips</span></div>
        <div class="row2">${s.subtitle} &nbsp;·&nbsp; gap ${s.gap}% / overlap ${s.over}%</div>
      </figcaption>
      <div class="body">
        <img src="data:image/png;base64,${s.b64}"/>
        <ul class="legend"><li class="hd">SHEETS TO ORDER</li>${legend}</ul>
      </div>
    </figure>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 10mm; }
    *{box-sizing:border-box;}
    body{margin:0;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a1628;}
    h1{font-size:18px;margin:0 0 3px;}
    .intro{color:#5b6675;font-size:11.5px;margin:0 0 12px;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .cell{break-inside:avoid;border:1px solid #d9dee6;border-radius:8px;padding:9px;background:#fafbfc;}
    figcaption{margin-bottom:6px;}
    .row1{display:flex;align-items:center;gap:7px;margin-bottom:2px;}
    .lbl{font-weight:700;font-size:12px;}
    .badge{font-size:9px;font-weight:800;letter-spacing:.05em;padding:1px 6px;border-radius:9px;color:#fff;}
    .badge.ok{background:#137333;} .badge.warn{background:#b3261e;}
    .stat{color:#0c4a6e;background:#e0f2fe;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:600;margin-left:auto;}
    .row2{font-size:10px;color:#5b6675;}
    .body{display:grid;grid-template-columns:1fr 130px;gap:8px;align-items:start;}
    .body img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:5px;background:#fff;}
    .legend{list-style:none;margin:0;padding:0;font-size:9.5px;}
    .legend .hd{font-weight:800;letter-spacing:.05em;color:#0a1628;margin-bottom:4px;font-size:9px;}
    .legend li{display:flex;align-items:center;gap:4px;margin-bottom:2px;color:#334155;}
    .legend .sw{width:10px;height:10px;border-radius:2px;background:#c8763a;flex-shrink:0;}
    .legend .m{color:#94a3b8;}
  </style></head><body>
    <h1>Flood Roofing — complex-footprint sheet-layout test set</h1>
    <p class="intro">Eight multi-reflex outlines (staircase, U, Z, T, plus, triple-step, H, complex asymmetric) through the current production hip engine. Coverage stats from a 5px raster; CLEAN = gap and overlap both under 2%. "Sheets to order" buckets the unique sheets by cut length, same as the app legend.</p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_complex_shapes.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/sheetplan_test_complex_shapes.pdf',
    format: 'A4', landscape: true, printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
  });
  fs.unlinkSync(tmp);
  const n = shots.filter(s => s.clean).length;
  console.log(`SUMMARY: ${n}/${shots.length} CLEAN — wrote floodroofing/docs/sheetplan_test_complex_shapes.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
