// A whole heap of L-shapes — parametric sweep across proportions and
// all four orientations (+ a couple of mirrors), each run through the
// production hip engine + sheet plan, composed into a multi-page A4
// PDF with per-case coverage (gap%/overlap%) and sheet count.
//
// Purpose: exhaustively exercise the single-reflex L-cascade so any
// proportion / orientation that gaps or overlaps shows up in one doc.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 140, oy = 140;

// Canonical L: wing (ww x wh) top-left, main (mw wide x mh tall) below.
// Reflex corner at (ox+ww, oy+wh).
function canonicalL(ww, wh, mw, mh) {
  return [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
}
// Rotate a polygon k*90deg CW about its own bbox centre, and optionally
// mirror horizontally.  Returns a fresh polygon translated back to the
// (ox,oy) origin so every case sits in the same drawing area.
function orient(poly, k, mirror) {
  let xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]);
  const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
  let out = poly.map(([x,y]) => {
    let dx = x-cx, dy = y-cy;
    for (let i=0;i<((k%4)+4)%4;i++){ const nx=-dy, ny=dx; dx=nx; dy=ny; }
    if (mirror) dx = -dx;
    return [cx+dx, cy+dy];
  });
  // Re-normalise to origin.
  xs = out.map(p=>p[0]); ys = out.map(p=>p[1]);
  const mnx = Math.min(...xs), mny = Math.min(...ys);
  return out.map(([x,y]) => [x-mnx+ox, y-mny+oy]);
}

const ORIENT_TAG = ['N (wing top-left)','E (rot 90cw)','S (rot 180)','W (rot 270cw)'];

// Base proportions to sweep.  [wingW, wingH, mainW, mainH]
const PROPS = [
  { name: 'Square wing (canonical)',  p: [300,300,900,700] },
  { name: 'Wide-wing',                p: [356,329,972,615] },
  { name: 'Narrow tall wing',         p: [220,460,900,640] },
  { name: 'Fat short wing',           p: [560,260,940,560] },
  { name: 'Small wing / big main',    p: [200,200,1000,820] },
  { name: 'Big wing / small main',    p: [460,420,720,520] },
  { name: 'Near-square whole',        p: [340,340,760,760] },
  { name: 'Long thin main',           p: [260,240,1080,420] },
];

// Build the case list: every proportion in all 4 orientations, plus a
// mirror of the first two proportions (to catch handedness bugs).
const CASES = [];
PROPS.forEach((pr, pi) => {
  for (let k=0;k<4;k++) {
    CASES.push({
      label: `${String.fromCharCode(65+pi)}${k+1} — ${pr.name}`,
      subtitle: `${pr.p[0]}×${pr.p[1]} wing / ${pr.p[2]}×${pr.p[3]} main · ${ORIENT_TAG[k]}`,
      outline: orient(canonicalL(...pr.p), k, false),
    });
  }
});
// Two mirrored handedness checks.
[0,1].forEach(pi => {
  CASES.push({
    label: `M${pi+1} — ${PROPS[pi].name} (mirrored)`,
    subtitle: `${PROPS[pi].p.join('×')} · horizontal mirror (notch top-right)`,
    outline: orient(canonicalL(...PROPS[pi].p), 0, true),
  });
});

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
    await page.waitForTimeout(240);
    const res = await page.evaluate((outline) => {
      window.gotoTab && window.gotoTab('materials');
      const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      const cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || [];
      const bySeq = {}; all.forEach(s => { if (s.seq != null) (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      const strips = all.map(s => s.poly).filter(Boolean);
      const inPoly = (x,y,p)=>{let ins=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))ins=!ins;}return ins;};
      const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      let tot=0,gap=0,over=0;
      for(let y=y0;y<=y1;y+=4)for(let x=x0;x<=x1;x+=4){if(!inPoly(x,y,outline))continue;tot++;let cc=0;for(let k=0;k<strips.length;k++){if(inPoly(x,y,strips[k])){cc++;if(cc>1)break;}}if(cc===0)gap++;else if(cc>1)over++;}
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: Object.keys(bySeq).length || all.length,
        strips: all.length,
        gap: (100*gap/tot).toFixed(1),
        over: (100*over/tot).toFixed(1),
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    }, c.outline);
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    const clean = parseFloat(res.gap) < 1.5 && parseFloat(res.over) < 1.5;
    shots.push({ ...c, ...res, clean, b64: res.dataURL.split(',')[1] });
    console.log(`[${clean?'CLEAN':'CHECK'}] ${c.label} :: sheets=${res.sheets} gap%=${res.gap} over%=${res.over}`);
  }

  const nClean = shots.filter(s=>s.clean).length;
  const cells = shots.map(s => `
    <figure class="cell">
      <figcaption>
        <div class="row1"><span class="lbl">${s.label}</span>
          <span class="badge ${s.clean?'ok':'warn'}">${s.clean?'CLEAN':'CHECK'}</span></div>
        <div class="row2">${s.subtitle}</div>
        <div class="row3">${s.sheets} sheets · gap ${s.gap}% · overlap ${s.over}%</div>
      </figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 9mm; }
    *{box-sizing:border-box;}
    body{margin:0;font:11px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a1628;}
    h1{font-size:17px;margin:0 0 2px;}
    .intro{color:#5b6675;font-size:11px;margin:0 0 10px;}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
    .cell{break-inside:avoid;border:1px solid #d9dee6;border-radius:7px;padding:7px;background:#fafbfc;}
    figcaption{margin-bottom:5px;}
    .row1{display:flex;align-items:center;gap:6px;margin-bottom:1px;}
    .lbl{font-weight:700;font-size:11px;}
    .badge{font-size:8.5px;font-weight:800;padding:1px 6px;border-radius:8px;color:#fff;margin-left:auto;}
    .badge.ok{background:#137333;} .badge.warn{background:#b3261e;}
    .row2{font-size:9.5px;color:#5b6675;}
    .row3{font-size:9.5px;color:#0c4a6e;font-weight:600;margin-top:1px;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:4px;background:#fff;margin-top:4px;}
  </style></head><body>
    <h1>Flood Roofing — L-shape sweep (${nClean}/${shots.length} CLEAN)</h1>
    <p class="intro">Eight L proportions × four orientations (N/E/S/W) plus two mirrored handedness checks — ${shots.length} cases through the production hip engine. CLEAN = gap and overlap both under 1.5% (4px raster).</p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_lshape_heap.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/sheetplan_test_lshapes_heap.pdf',
    format: 'A4', landscape: true, printBackground: true,
    margin: { top: '9mm', right: '9mm', bottom: '9mm', left: '9mm' }
  });
  fs.unlinkSync(tmp);
  console.log(`SUMMARY: ${nClean}/${shots.length} CLEAN — wrote floodroofing/docs/sheetplan_test_lshapes_heap.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
