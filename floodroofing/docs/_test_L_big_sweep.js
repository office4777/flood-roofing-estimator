// BIG L-SHAPE SWEEP — hip & valley L-shapes, straight-ridge L gables
// ("longer sheets make the corner"), hip+valley-corner gables (legacy
// skeleton builder), and gable ridge slide (DRAW.gableRidgeOffset).
//
// For every case the LIVE engine runs (autoGenerateRoof + the real
// sheet-plan renderer) and we assert:
//   · zero page JS errors
//   · strips produced
//   · per-colour seq numbering is 1..N contiguous
//   · raster coverage: gap% / overlap% (hip + hip-valley-gable cases;
//     straight gables measured too but reported informationally when
//     strip polys are column rects)
//   · ridge-slide cases: the two gable faces really get different
//     sheet lengths (long side vs short side)
//
// Output: per-case console lines + docs/sheetplan_test_L_big_sweep.pdf
// with one diagram per case for visual review.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 120, oy = 120;
const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
function orient(poly, k, mirror) {
  let xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]);
  const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
  let out = poly.map(([x,y]) => { let dx=x-cx, dy=y-cy; for (let i=0;i<((k%4)+4)%4;i++){const nx=-dy,ny=dx;dx=nx;dy=ny;} if(mirror)dx=-dx; return [cx+dx,cy+dy]; });
  xs = out.map(p=>p[0]); ys = out.map(p=>p[1]);
  const mnx = Math.min(...xs), mny = Math.min(...ys);
  return out.map(([x,y]) => [x-mnx+ox, y-mny+oy]);
}

const PROPS = [
  ['Square wing',    [300,300,900,700]],
  ['Wide wing',      [356,329,972,615]],
  ['Narrow tall',    [220,460,900,640]],
  ['Fat short',      [560,260,940,560]],
  ['Long thin main', [260,240,1080,420]],
  ['User job shape', [385,140,580,270]],
];
const ORI = ['N','E','S','W'];

const CASES = [];
// 1) HIP & VALLEY L-shapes — full orientation matrix.
PROPS.forEach(([name, p]) => ORI.forEach((o, k) =>
  CASES.push({ label: `HIP L ${name} ${o}`, mode: 'hip', outline: orient(L(...p), k, false), coverage: true,
               diagram: o === 'N' })));
// 2) STRAIGHT-RIDGE L GABLES (longer sheets make the corner).
PROPS.forEach(([name, p]) => ORI.forEach((o, k) =>
  CASES.push({ label: `GABLE-LONG L ${name} ${o}`, mode: 'gable', outline: orient(L(...p), k, false), coverage: true,
               diagram: o === 'N' })));
// 3) Gable RIDGE SLIDE on L-shapes + a plain rect (asymmetric faces).
[-0.4, 0.4].forEach(off => {
  CASES.push({ label: `GABLE-SLIDE rect ${off>0?'+':''}${off}`, mode: 'gable', ridgeOff: off,
               outline: [[ox,oy],[ox+900,oy],[ox+900,oy+600],[ox,oy+600]], coverage: true, slideCheck: true, diagram: true });
  CASES.push({ label: `GABLE-SLIDE L Square wing ${off>0?'+':''}${off}`, mode: 'gable', ridgeOff: off,
               outline: L(300,300,900,700), coverage: true, slideCheck: true, diagram: true });
  CASES.push({ label: `GABLE-SLIDE L User job ${off>0?'+':''}${off}`, mode: 'gable', ridgeOff: off,
               outline: L(385,140,580,270), coverage: true, slideCheck: true, diagram: true });
});
// 4) HIP+VALLEY-CORNER GABLES (legacy skeleton builder, invoked directly).
PROPS.forEach(([name, p]) => ['N','E'].forEach((o, k) =>
  CASES.push({ label: `GABLE-HV L ${name} ${o}`, mode: 'gable-hv', outline: orient(L(...p), k, false), coverage: true,
               diagram: o === 'N' })));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1300 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    const ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'none';
    window.gotoTab && window.gotoTab('materials');
    const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
  });

  const shots = [];
  let fails = 0;
  for (const c of CASES) {
    const errBefore = errs.length;
    const res = await page.evaluate((c) => {
      window.DRAW.sheetPlanDeletedIds = [];
      window.DRAW.outline = c.outline; window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02; window.DRAW.calPitch = 22;
      window.DRAW.lines = []; window.DRAW.roofs = []; window.DRAW.activeRoofIdx = -1;
      window.DRAW.gableRidgeOffset = c.ridgeOff || 0;
      window.DRAW.gableEnds = null;
      // 'gable-hv' is a first-class generator type now (hip+valley
      // corner + rake gable ends) — exercised through the same entry
      // the UI button uses.
      window.autoGenerateRoof(c.mode);
      window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || [];
      // numbering contiguity per colour
      const seqByCol = {};
      all.forEach(s => { if (s.seq != null) (seqByCol[s.color] = seqByCol[s.color] || new Set()).add(s.seq); });
      let numOk = true;
      Object.values(seqByCol).forEach(set => {
        const a = [...set].sort((p,q)=>p-q);
        if (!a.length || a[0] !== 1 || a[a.length-1] !== a.length) numOk = false;
      });
      // raster coverage
      const inPoly = (x,y,p)=>{let s=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))s=!s;}return s;};
      const polys = all.map(s=>s.poly).filter(Boolean);
      const xs=c.outline.map(p=>p[0]),ys=c.outline.map(p=>p[1]);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      let tot=0,gap=0,over=0;
      for(let y=y0;y<=y1;y+=5)for(let x=x0;x<=x1;x+=5){
        if(!inPoly(x,y,c.outline))continue;tot++;let cc=0;
        for(let k2=0;k2<polys.length;k2++){if(inPoly(x,y,polys[k2])){cc++;if(cc>1)break;}}
        if(cc===0)gap++;else if(cc>1)over++;
      }
      // distinct face sheet lengths (for ridge-slide verification)
      const faceLens = [...new Set(all.map(s => s.face && s.face.sheetM).filter(x => x != null).map(x => +(+x).toFixed(2)))].sort((a,b)=>a-b);
      const sheets = new Set(all.filter(s=>s.seq!=null).map(s=>s.color+'#'+s.seq)).size;
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return { strips: all.length, sheets, numOk,
               gapPct: tot? +(100*gap/tot).toFixed(1):0, overPct: tot? +(100*over/tot).toFixed(1):0,
               faceLens, dataURL: (c.diagram && cv) ? cv.toDataURL('image/png') : null };
    }, c).catch(e => ({ crashed: e.message.slice(0, 120) }));
    await page.waitForTimeout(60);

    const newErrs = errs.slice(errBefore);
    const problems = [];
    if (res.crashed) problems.push('CRASH ' + res.crashed);
    else {
      if (newErrs.length) problems.push('JSERR ' + newErrs[0].slice(0, 80));
      if (!res.strips) problems.push('no strips');
      if (!res.numOk) problems.push('numbering not 1..N');
      if (c.coverage && res.gapPct > 2) problems.push('gap ' + res.gapPct + '%');
      if (c.coverage && res.overPct > 2) problems.push('overlap ' + res.overPct + '%');
      if (c.slideCheck && res.faceLens.length < 2) problems.push('ridge slide gave equal faces (' + res.faceLens.join('/') + ')');
    }
    const ok = !problems.length;
    if (!ok) fails++;
    console.log((ok ? 'ok    ' : 'FAIL  ') + c.label +
      (res.crashed ? ' — ' + problems.join(', ')
       : `  (${res.sheets} sheets, gap ${res.gapPct}% / over ${res.overPct}%` +
         (res.faceLens && res.faceLens.length ? `, lens ${res.faceLens.join('/')}m` : '') + ')' +
         (ok ? '' : '  << ' + problems.join(', '))));
    if (res.dataURL) shots.push({ label: c.label, note: `${res.sheets} sheets · gap ${res.gapPct}% · over ${res.overPct}%` + (res.faceLens?.length ? ` · sheets ${res.faceLens.join(' / ')}m` : ''), ok, b64: res.dataURL.split(',')[1] });
  }

  // PDF of diagrams
  const cells = shots.map(s => `
    <figure class="cell ${s.ok?'':'bad'}">
      <figcaption><span class="lbl">${s.label}</span><span class="stat">${s.note}</span></figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 10mm; }
    *{box-sizing:border-box} body{margin:0;font:12px/1.4 -apple-system,'Segoe UI',sans-serif;color:#0a1628}
    h1{font-size:17px;margin:0 0 8px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .cell{margin:0;border:1px solid #d1d5db;border-radius:6px;padding:6px;break-inside:avoid}
    .cell.bad{border-color:#dc2626;border-width:2px}
    figcaption{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;margin-bottom:4px}
    .lbl{font-weight:700} .stat{color:#5b6675}
    img{width:100%;height:auto;display:block}
  </style></head><body>
    <h1>L-shape big sweep — hip &amp; valley / straight-ridge gable / hip+valley-corner gable / ridge slide</h1>
    <div class="grid">${cells}</div>
  </body></html>`;
  const tmp = path.resolve('floodroofing/docs/_L_big_sweep_tmp.html');
  fs.writeFileSync(tmp, html);
  const p2 = await ctx.newPage();
  await p2.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await p2.pdf({ path: 'floodroofing/docs/sheetplan_test_L_big_sweep.pdf', format: 'A4', landscape: true, printBackground: true });
  fs.unlinkSync(tmp);

  console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'}: ${CASES.length - fails}/${CASES.length} cases clean — PDF: docs/sheetplan_test_L_big_sweep.pdf`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('runner error:', e); process.exit(2); });
