// Test PDF for the new gable engine fields:
//   • DRAW.gableRidgeOffset  — slide the ridge along the barge.
//   • DRAW.gableEnds         — manual gable-end edge picker.
// Plus a hard regression on the L-shape (autoGenerateRoof('gable')
// with a notched outline) to confirm the existing hybrid hip+gable
// face-build still works after the half-barge split.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ox = 120, oy = 120;
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
const L    = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
// Rectangle with a small wing to the east.
const RECT_WING = (mainW, mainH, wingW, wingH, wingOffsetY) => {
  const wy = oy + wingOffsetY;
  return [[ox,oy],[ox+mainW,oy],[ox+mainW,wy],[ox+mainW+wingW,wy],[ox+mainW+wingW,wy+wingH],[ox+mainW,wy+wingH],[ox+mainW,oy+mainH],[ox,oy+mainH]];
};

const CASES = [
  // ── Ridge-offset slider on a plain 900×600 ────────────────────────
  {
    label: 'A — Ridge centred (offset 0)',
    subtitle: '900 × 600 rectangle, ridge at midline — baseline gable.',
    outline: RECT(900, 600), ridgeOffset: 0, gableEnds: null,
  },
  {
    label: 'B — Ridge slid +0.3 (toward south gutter)',
    subtitle: 'Same 900×600. Ridge offset = +0.3 → north face gets longer sheets, south face shorter.',
    outline: RECT(900, 600), ridgeOffset: 0.3, gableEnds: null,
  },
  {
    label: 'C — Ridge slid −0.4 (toward north gutter)',
    subtitle: 'Same 900×600. Ridge offset = −0.4 → flipped: north shorter, south longer.',
    outline: RECT(900, 600), ridgeOffset: -0.4, gableEnds: null,
  },
  {
    label: 'D — Aggressive +0.6 slide',
    subtitle: 'Same 900×600. Ridge offset = +0.6 → very asymmetric gable, one face dominant.',
    outline: RECT(900, 600), ridgeOffset: 0.6, gableEnds: null,
  },
  // ── L-shape, ridge offset off, default gable-end auto-pick ───────
  {
    label: 'E — L-shape (canonical), auto ends',
    subtitle: 'Wing 300×300 / main 900×700. Engine auto-classifies the L into long-side + hip-end faces.',
    outline: L(300, 300, 900, 700), ridgeOffset: 0, gableEnds: null,
  },
  // ── L-shape with gableEnds override: ONLY edge 0 (wing top) ─────
  {
    label: 'F — L-shape, gable end on edge 0 only',
    subtitle: 'DRAW.gableEnds=[0] — only the wing-top rake becomes a barge; perpendicular edges 1,3,5 fall through to hip-end treatment (no barge stamp).',
    outline: L(300, 300, 900, 700), ridgeOffset: 0, gableEnds: [0],
  },
  // ── Rectangle with wing — extend ridge into the wing ────────────
  {
    label: 'G — Rectangle with east wing, auto',
    subtitle: 'Main 1000×600 + wing 300×260 at y=170. Auto engine picks ridge along long axis.',
    outline: RECT_WING(1000, 600, 300, 260, 170), ridgeOffset: 0, gableEnds: null,
  },
  // ── Rectangle with wing + slid ridge ─────────────────────────────
  {
    label: 'H — Rectangle with wing + ridge slid +0.25',
    subtitle: 'Same main+wing outline; ridge slid toward south gutter. Main face sheets become non-symmetric.',
    outline: RECT_WING(1000, 600, 300, 260, 170), ridgeOffset: 0.25, gableEnds: null,
  },
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
    await page.evaluate(({ outline, ridgeOffset, gableEnds }) => {
      window.DRAW.gableRidgeOffset = ridgeOffset || 0;
      window.DRAW.gableEnds = gableEnds || null;
      window.DRAW.outline = outline;
      window.DRAW.outlineDone = true;
      window.DRAW.scaleMetresPerPx = 0.02;
      window.DRAW.calPitch = 22;
      window.DRAW.lines = [];
      window.DRAW.roofs = [];
      window.DRAW.activeRoofIdx = -1;
      window.autoGenerateRoof && window.autoGenerateRoof('gable');
    }, c);
    await page.waitForTimeout(280);
    const res = await page.evaluate(() => {
      window.gotoTab && window.gotoTab('materials');
      const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
      const cb = document.getElementById('matShowSheetPlan'); if (cb && !cb.checked) cb.checked = true;
      window.renderRoofSheetPlan && window.renderRoofSheetPlan();
      const all = window.__lastAllStrips || [];
      const bySeq = {}; all.forEach(s => { if (s.seq != null) (bySeq[s.seq] = bySeq[s.seq] || []).push(s); });
      // Per-face summary
      const facesByKey = {};
      all.forEach(s => {
        if (!s.face) return;
        const k = s.face.gutter && JSON.stringify(s.face.gutter.pts);
        if (!facesByKey[k]) facesByKey[k] = {
          type: s.face.type,
          gutterAt: s.face.gutter && s.face.gutter.pts,
          sheetM: Number(s.face.sheetM).toFixed(2),
          strips: 0,
          sheets: new Set(),
        };
        facesByKey[k].strips++;
        if (s.seq != null) facesByKey[k].sheets.add(s.seq);
      });
      const faces = Object.values(facesByKey).map(f => ({
        type: f.type,
        sheetM: f.sheetM,
        strips: f.strips,
        sheets: f.sheets.size,
      }));
      const lineSummary = {};
      (window.DRAW.lines || []).forEach(l => {
        const k = l.type + (l.subtype ? ':' + l.subtype : '');
        lineSummary[k] = (lineSummary[k] || 0) + 1;
      });
      const linesTag = Object.entries(lineSummary).map(([k, v]) => v > 1 ? `${v}×${k}` : k).join(' · ');
      const out = document.getElementById('roofSheetPlanOut');
      const cv = out && out.querySelector('canvas');
      return {
        sheets: Object.keys(bySeq).length || all.length,
        strips: all.length,
        faces, linesTag,
        dataURL: cv ? cv.toDataURL('image/png') : null,
      };
    });
    if (!res.dataURL) { console.error('no canvas for', c.label); continue; }
    shots.push({ ...c, ...res, b64: res.dataURL.split(',')[1] });
    console.log(`[${c.label}] sheets=${res.sheets} strips=${res.strips} lines=[${res.linesTag}] faces=${JSON.stringify(res.faces)}`);
  }

  const cells = shots.map(s => {
    const facesHtml = s.faces.map(f => `<span class="face">${f.type}: ${f.sheets} sheets × ${f.sheetM}m</span>`).join('');
    return `
    <figure class="cell">
      <figcaption>
        <div class="row1"><span class="lbl">${s.label}</span><span class="stat">${s.sheets} sheets · ${s.strips} strips</span></div>
        <div class="row2"><span class="sub">${s.subtitle}</span></div>
        <div class="row3"><span class="hd">Lines:</span><span>${s.linesTag || '—'}</span></div>
        <div class="row3"><span class="hd">Faces:</span><span class="ml">${facesHtml || '—'}</span></div>
      </figcaption>
      <img src="data:image/png;base64,${s.b64}"/>
    </figure>`;
  }).join('');

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
    .row3{display:flex;align-items:baseline;gap:6px;font-size:10.5px;color:#475569;margin-top:1px;}
    .hd{font-weight:600;color:#0a1628;min-width:48px;}
    .ml{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
    .face{background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:8px;font-weight:600;}
    .cell img{display:block;width:100%;height:auto;border:1px solid #eef1f5;border-radius:5px;background:#fff;}
  </style></head><body>
    <h1>Flood Roofing — gable engine: ridge-offset slider + gable-end picker</h1>
    <p class="intro">Eight cases exercising the two new engine fields:
      <code>DRAW.gableRidgeOffset</code> (signed −1..+1, slides the ridge along the perpendicular axis)
      and <code>DRAW.gableEnds</code> (array of outline edge indices to keep as rake barges; remainder become hip-ends).
      Per-cell caption shows the lines emitted + the per-face sheet length the strip engine derived from them.
      Cases A–D show the ridge slider on a plain rectangle (notice the per-face sheet length splits as soon as offset ≠ 0).
      E–F compare auto vs manual gable-end picking on an L-shape. G–H apply the slider to a rectangle-with-wing outline.
    </p>
    <div class="grid">${cells}</div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_gable_features.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: 'floodroofing/docs/sheetplan_test_gables_features.pdf',
    format: 'A4', landscape: true, printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
  });
  fs.unlinkSync(tmp);
  console.log(`SUMMARY: ${shots.length} cases — wrote floodroofing/docs/sheetplan_test_gables_features.pdf`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
