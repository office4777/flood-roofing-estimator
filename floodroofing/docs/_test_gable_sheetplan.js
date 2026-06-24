// Render a set of straight-gable test roofs through the production
// sheet-plan engine and emit a single A4-landscape PDF with one diagram
// per case.  Gable coverage metrics aren't shown (each gable strip's
// polygon is reported as the full roof rectangle by design — the
// 100% raster reading would be a false flag), so we badge size/aspect
// and the sheet count only.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 120, oy = 120;
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];

const CASES = [
  { label: 'A — Standard gable',           subtitle: '900 × 600 (1.50:1)',       w: 900,  h: 600 },
  { label: 'B — Wide low gable',           subtitle: '1200 × 400 (3.00:1)',      w: 1200, h: 400 },
  { label: 'C — Long farm-shed gable',     subtitle: '1400 × 350 (4.00:1)',      w: 1400, h: 350 },
  { label: 'D — Square gable',             subtitle: '700 × 700 (1.00:1)',       w: 700,  h: 700 },
  { label: 'E — Tall narrow gable',        subtitle: '400 × 900 (1:2.25 portrait)', w: 400, h: 900 },
  { label: 'F — Big gable',                subtitle: '1200 × 800 (1.50:1)',      w: 1200, h: 800 },
  { label: 'G — Small compact gable',      subtitle: '500 × 350 (1.43:1)',       w: 500,  h: 350 },
  { label: 'H — Garage-style gable',       subtitle: '600 × 450 (1.33:1)',       w: 600,  h: 450 },
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
    const outline = RECT(c.w, c.h);
    await page.evaluate((outline) => {
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.DRAW.roofs = [];
      window.DRAW.activeRoofIdx = -1;
      window.autoGenerateRoof && window.autoGenerateRoof('gable');
    }, outline);
    await page.waitForTimeout(280);
    const res = await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      const cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || (window.__lastSheetPlan && window.__lastSheetPlan.strips) || [];
      const bySeq = {};
      all.forEach(s => { if (s.seq != null) (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      // Per-face strip + sheet-length summary for the caption
      const faces = {};
      all.forEach(s => {
        const t = (s.face && s.face.type) || 'face';
        if (!faces[t]) faces[t] = { strips: 0, sheets: new Set(), lens: new Set() };
        faces[t].strips++;
        if (s.seq != null) faces[t].sheets.add(s.seq);
        const sm = (s.face && s.face.sheetM) || (s.face && s.face.planSheetM);
        if (sm != null) faces[t].lens.add(Number(sm).toFixed(2));
      });
      const faceTags = Object.entries(faces).map(([t, f]) => `${t}: ${f.sheets.size}sh × ${f.strips/f.sheets.size}strip`).join(' · ');
      const lens = [...new Set(all.map(s => (s.face && (s.face.sheetM || s.face.planSheetM))).filter(x => x != null).map(x => Number(x).toFixed(2)))];
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: Object.keys(bySeq).length || all.length,
        strips: all.length,
        faceTags,
        sheetLensM: lens.join(' / '),
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    });
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    shots.push({ ...c, ...res, b64: res.dataURL.split(',')[1] });
    console.log(`[OK] ${c.label} :: sheets=${res.sheets} strips=${res.strips} faces=[${res.faceTags}] sheet length(s)=${res.sheetLensM}m`);
  }

  const cells = shots.map(s => `
    <figure class="cell">
      <figcaption>
        <div class="row1"><span class="lbl">${s.label}</span><span class="stat">${s.sheets} sheets · ${s.strips} strips · ${s.sheetLensM} m sheet</span></div>
        <div class="row2"><span class="sub">${s.subtitle}</span><span class="faces">${s.faceTags}</span></div>
      </figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; }
    *{box-sizing:border-box;}
    body{margin:0;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a1628;}
    h1{font-size:19px;margin:0 0 4px;}
    .sub{color:#5b6675;font-size:11.5px;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .cell{break-inside:avoid;border:1px solid #d9dee6;border-radius:8px;padding:10px;background:#fafbfc;margin:0;}
    figcaption{margin-bottom:7px;}
    .row1, .row2{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
    .row1{margin-bottom:2px;}
    .lbl{font-weight:700;font-size:12.5px;}
    .stat{color:#0c4a6e;background:#e0f2fe;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:auto;}
    .row2{font-size:11px;color:#5b6675;}
    .faces{margin-left:auto;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:5px;background:#fff;}
    .intro{color:#5b6675;font-size:12px;margin:0 0 14px;}
  </style></head><body>
    <h1>Flood Roofing — straight-gable sheet-layout test set</h1>
    <p class="intro">Eight gable shapes ranging from wide low (3:1) through square (1:1) to tall portrait (1:2.25). Each diagram is generated by the production engine (post c09ccd8 sheet-plan restoration). Each gable produces two equal-length face sheet sets running ridge → gutter, with ridge orientation chosen automatically along the long axis.</p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_gable_sheetplan.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/sheetplan_test_gables.pdf',
    format: 'A4', landscape: true, printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
  });
  fs.unlinkSync(tmp);
  console.log(`SUMMARY: ${shots.length} gable cases — wrote floodroofing/docs/sheetplan_test_gables.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
