// Diagnostic test set for "odd-shape gables" — runs the production
// gable engine against non-rectangular outlines and emits an A4 PDF
// of what the engine produces today.  Cases cover the shapes the
// user described: L-shape, T-shape, rectangle-with-wing, plus-shape,
// and a tall L oriented differently.
//
// Aim: see where the auto-centred ridge + auto-rake-classification
// rules break (notably anywhere the user wants a hip+valley junction
// instead of two opposing rake ends), so the next pass can add the
// missing gable-end selection + ridge-position slider.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 120, oy = 120;
// Outline helpers — same conventions as the L-cascade harness.
const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
const T = (capW, capH, stemW, stemH) => {
  const sx = ox + (capW - stemW) / 2;
  return [[ox,oy],[ox+capW,oy],[ox+capW,oy+capH],[sx+stemW,oy+capH],[sx+stemW,oy+capH+stemH],[sx,oy+capH+stemH],[sx,oy+capH],[ox,oy+capH]];
};
// Rectangle with a small wing protruding from the right edge.
const RECT_WING = (mainW, mainH, wingW, wingH, wingOffsetY) => {
  const wy = oy + wingOffsetY;
  return [[ox,oy],[ox+mainW,oy],[ox+mainW,wy],[ox+mainW+wingW,wy],[ox+mainW+wingW,wy+wingH],[ox+mainW,wy+wingH],[ox+mainW,oy+mainH],[ox,oy+mainH]];
};
// Plus / cross outline — body with arms on all four sides.
const PLUS = (cx, cy, armW, armL) => {
  // 12-vertex plus: arms top, right, bottom, left.
  const x0 = ox + cx - armW/2, x1 = ox + cx + armW/2;
  const y0 = oy + cy - armW/2, y1 = oy + cy + armW/2;
  const t0 = oy + cy - armL, t1 = oy + cy + armL;
  const r0 = ox + cx + armL, l0 = ox + cx - armL;
  return [
    [x0, t0], [x1, t0],
    [x1, y0], [r0, y0], [r0, y1], [x1, y1],
    [x1, t1], [x0, t1],
    [x0, y1], [l0, y1], [l0, y0], [x0, y0],
  ];
};

const CASES = [
  { label: 'A — L-shape (canonical Big-L)',          subtitle: 'wing 300×300 / main 900×700  —  auto ridge along long axis', outline: L(300,300,900,700) },
  { label: 'B — L-shape (wide-wing variant)',        subtitle: 'wing 356×329 / main 972×615  —  same engine, different proportions', outline: L(356,329,972,615) },
  { label: 'C — T-shape',                            subtitle: 'cap 900×260 / stem 300×460  —  central T, ridges along long axes', outline: T(900,260,300,460) },
  { label: 'D — Rectangle with small wing',          subtitle: 'main 1000×600  +  wing 300×260 protruding right at y=170', outline: RECT_WING(1000,600,300,260,170) },
  { label: 'E — Plus / cross plan',                  subtitle: 'central body 250×250 with 200×125 arms each side', outline: PLUS(500, 500, 250, 350) },
  { label: 'F — L-shape rotated (gables N+S)',       subtitle: 'wing 300×520 / main 800×360  —  ridge orientation should flip', outline: L(300,520,800,360) },
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
    await page.evaluate((outline) => {
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.DRAW.roofs = [];
      window.DRAW.activeRoofIdx = -1;
      window.autoGenerateRoof && window.autoGenerateRoof('gable');
    }, c.outline);
    await page.waitForTimeout(280);
    const res = await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      const cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || [];
      const bySeq = {}; all.forEach(s => { if (s.seq != null) (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      // Inventory of generated roof lines (ridge/barge/hip/valley)
      const lineSummary = {};
      (window.DRAW.lines || []).forEach(l => {
        const k = l.type + (l.subtype ? ':' + l.subtype : '');
        lineSummary[k] = (lineSummary[k] || 0) + 1;
      });
      const linesTag = Object.entries(lineSummary).map(([k,v]) => v > 1 ? `${v}×${k}` : k).join(' · ');
      const faceTypes = [...new Set(all.map(s => (s.face && s.face.type) || 'face'))].join(', ');
      const sheetLens = [...new Set(all.map(s => s.face && (s.face.sheetM || s.face.planSheetM)).filter(x=>x!=null).map(x => Number(x).toFixed(2)))];
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: Object.keys(bySeq).length || all.length,
        strips: all.length,
        lines: linesTag,
        faceTypes,
        sheetLensM: sheetLens.join(' / '),
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    });
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    shots.push({ ...c, ...res, b64: res.dataURL.split(',')[1] });
    console.log(`[${c.label}] sheets=${res.sheets} strips=${res.strips} lines=[${res.lines}] faces=[${res.faceTypes}] sheetLen=${res.sheetLensM}m`);
  }

  const cells = shots.map(s => `
    <figure class="cell">
      <figcaption>
        <div class="row1"><span class="lbl">${s.label}</span><span class="stat">${s.sheets} sheets · ${s.strips} strips</span></div>
        <div class="row2"><span class="sub">${s.subtitle}</span></div>
        <div class="row3"><span class="hd">Lines:</span><span>${s.lines || '—'}</span></div>
        <div class="row3"><span class="hd">Faces:</span><span>${s.faceTypes || '—'}</span><span class="ml">Sheet length(s): ${s.sheetLensM || '—'} m</span></div>
      </figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; }
    *{box-sizing:border-box;}
    body{margin:0;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a1628;}
    h1{font-size:19px;margin:0 0 4px;}
    .intro{color:#5b6675;font-size:12px;margin:0 0 14px;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .cell{break-inside:avoid;border:1px solid #d9dee6;border-radius:8px;padding:10px;background:#fafbfc;margin:0;}
    figcaption{margin-bottom:7px;}
    .row1{display:flex;align-items:baseline;gap:8px;margin-bottom:3px;}
    .lbl{font-weight:700;font-size:12.5px;}
    .stat{color:#0c4a6e;background:#e0f2fe;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:auto;}
    .row2{font-size:11px;color:#5b6675;margin-bottom:3px;}
    .row3{display:flex;align-items:baseline;gap:6px;font-size:10.5px;color:#475569;}
    .hd{font-weight:600;color:#0a1628;min-width:48px;}
    .ml{margin-left:auto;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:5px;background:#fff;}
  </style></head><body>
    <h1>Flood Roofing — odd-shape gable diagnostic (current engine, before sliders / end-picking)</h1>
    <p class="intro">Six non-rectangular outlines run through <code>autoGenerateRoof('gable')</code> as-is. Captions show what lines + strips the engine emitted. Use these to spot where the auto rules (ridge at bbox midline, every perpendicular edge = rake) break — e.g. an L-shape where you actually want the inner corner to read as a hip + valley junction, not two rake ends staring across the notch.</p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_odd_gable.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/sheetplan_test_gables_odd.pdf',
    format: 'A4', landscape: true, printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
  });
  fs.unlinkSync(tmp);
  console.log(`SUMMARY: ${shots.length} odd-shape gable cases — wrote floodroofing/docs/sheetplan_test_gables_odd.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
