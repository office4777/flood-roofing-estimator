// Annotated reference render of the canonical Big-L cascade.
// Overlays a semantic label on every strip (donor identity + piece role)
// so the donor → offcut relationships are visible at a glance.
//
// Labels:
//   D1..D10 = the 10 rainbow donor sheets on the main's N long-side.
//             Each suffix encodes the piece role:
//               .N  = north piece (translated to wing N hip-end, or
//                     stays in main NW for D9/D10)
//               .M  = middle piece (main NW chunk, only D5..D8)
//               .S  = south piece (rotated 90° CCW into main SW corner)
//   PL1..PL8 = purple LEFT wing W-side full sheets (count as order)
//   PR1..PR8 = purple RIGHT wing E-side full sheets (PR5..PR8 cut at valley)
//   PN1..PN4 = purple WING-N TRIANGLE offcuts (translated from PR5..PR8
//              valley-cut east-of-valley pieces)
//   BW1..BWn = blue donor sheets in main's W hip-end UPPER (y=550..750)
//   BN1..BN4 = blue offcuts in wing's NW (moved from y=400..550 → y=100..250)
//   ON1..ONn = orange main N long-side strips east of D10
//   BS1..BSn = blue main S long-side strips
//   BE1..BEn = blue main E hip-end UPPER strips
//   OE1..OEn = orange main E hip-end LOWER strips

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });
  await page.evaluate(() => {
    window.DRAW.outline = [[100,100],[400,100],[400,400],[1000,400],[1000,1100],[100,1100]];
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.gotoTab && window.gotoTab('materials');
    window.renderRoofSheetPlan && window.renderRoofSheetPlan();
  });
  await page.waitForTimeout(700);

  const { canvasDataURL, strips, tx } = await page.evaluate(() => {
    const cvs = document.querySelector('#roofSheetPlanOut canvas');
    const url = cvs ? cvs.toDataURL('image/png') : null;
    const all = window.__lastAllStrips || [];
    return {
      canvasDataURL: url,
      tx: window.__lastSheetTransform,
      strips: all.map(s => ({
        color: s.color, isOffcut: !!s.isOffcut,
        faceType: s.face && s.face.type,
        centroid: s.centroid.slice(),
        poly: s.poly.map(p => p.slice()),
        pieceM: s.pieceM, orderedLengthMm: s.orderedLengthMm,
        _donorIdx: s._donorIdx
      })),
    };
  });
  if (!canvasDataURL || !tx) { console.error('missing canvas / transform'); process.exit(1); }

  // Outline-space → canvas-space.
  const toC = (p) => [(p[0]-tx.minX)*tx.sc + tx.padX, (p[1]-tx.minY)*tx.sc + tx.padY];

  // --- Constants for the canonical Big-L ---
  const mx0 = 100, my0 = 400, my1 = 1100, midY = 750, wApex = 450, eApex = 650, refY = 400;
  const wx0 = 100, wy0 = 100, wx1 = 400, wy1 = 400;

  // --- Assign a semantic label to each strip ---
  function labelFor(s) {
    // 1) Rainbow donor strips: D1..D10 with piece tag derived from polygon position.
    if (s._donorIdx !== undefined) {
      const d = `D${s._donorIdx + 1}`;
      // Determine piece role by polygon Y range:
      //   N piece in wing  → all y < refY (~400)
      //   M piece in chunk → y in [refY, midY] AND x in [wx0, wx1]  (between valley & phantom NW hip)
      //   N piece stays    → y in [refY, midY] AND x in main NW (D9, D10)
      //   S piece (rotated)→ y > midY in main SW corner
      const ys = s.poly.map(p => p[1]);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      const xs = s.poly.map(p => p[0]);
      const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
      if (yMax < refY + 1) return `${d}.N`;                   // translated north (wing)
      if (yMin > midY - 1) return `${d}.S`;                   // rotated south (SW corner)
      // y in main NW area between gutter and ridge:
      if (s._donorIdx < 4 || s._donorIdx >= 8) {
        // D1..D4 don't have middle pieces; D9..D10 don't either
        // → this must be a non-translated north piece
        return `${d}.N`;
      }
      // D5..D8: distinguish middle (between valley line y=800-x and phantom NW hip y=x+300)
      //                     vs north (above valley)  — but D5..D8 north pieces are
      //                     translated; if we got here, it's the middle.
      return `${d}.M`;
    }
    // 2) Purple wing strips.
    const PURPLE = '#a855f7';
    if (s.color === PURPLE) {
      // Wing W LEFT: x range entirely in [wx0, ~250] (wingApex x = (wx0+wx1)/2 = 250)
      // Wing E RIGHT: x range entirely in [~250, wx1]
      // Wing N triangle offcut: y range entirely in [wy0, ~250]
      const xs = s.poly.map(p => p[0]);
      const ys = s.poly.map(p => p[1]);
      const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (yMid < (wy0 + (wx1-wx0)/2)) {
        // y < 250 → in wing N triangle (translated offcut from PR5..PR8)
        return 'PN';
      }
      if (xMid < (wx0 + wx1) / 2) return 'PL';   // left side
      return 'PR';                                // right side
    }
    // 3) Blue strips.
    const BLUE = '#2563eb';
    if (s.color === BLUE) {
      const xs = s.poly.map(p => p[0]);
      const ys = s.poly.map(p => p[1]);
      const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Wing NW moved-offcut: x in [wx0, ~250], y in [wy0, 250]
      if (yMid < wy0 + (wx1-wx0)/2 + 1 && xMid < (wx0+wx1)/2 + 1) return 'BN';
      // Main W hip-end UPPER donors: y in [valleyEnd.y, midY] = [550, 750], x near mx0
      if (yMid >= 550 - 1 && yMid <= midY + 1 && xMid < wApex && s.faceType === 'hip-end') return 'BW';
      // Main E hip-end UPPER: x near mx1, y < midY
      if (xMid > eApex && yMid < midY) return 'BE';
      // Otherwise main S long-side
      return 'BS';
    }
    // 4) Orange (non-donor) strips.
    const ORANGE = '#f97316';
    if (s.color === ORANGE) {
      const xs = s.poly.map(p => p[0]);
      const ys = s.poly.map(p => p[1]);
      const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Main E hip-end LOWER: x near mx1, y > midY
      if (xMid > eApex && yMid > midY) return 'OE';
      // Main N long-side east of D10
      return 'ON';
    }
    return '?';
  }

  // Group strips by their label prefix and assign sequence numbers.
  const labelPrefix = strips.map(labelFor);
  const idxByPrefix = {};
  const finalLabels = strips.map((s, i) => {
    const lbl = labelPrefix[i];
    // For rainbow donor labels like "D5.N", "D5.M", "D5.S" we keep as-is
    // (donor identity is in the colour + the index, and the suffix is the
    // semantic piece role).
    if (lbl.startsWith('D')) return lbl;
    if (lbl === '?') return '?';
    // For PL/PR/PN/BS/BW/BN/BE/ON/OE: number them within their group in
    // a natural reading order (top-to-bottom for vertical groups,
    // left-to-right for horizontal groups).
    idxByPrefix[lbl] = (idxByPrefix[lbl] || 0) + 1;
    return `${lbl}${idxByPrefix[lbl]}`;
  });

  // Sort within each prefix by a natural axis BEFORE numbering — recompute.
  function naturalSortKey(prefix, s) {
    // Vertical groups (running top-to-bottom): PL (wing W), PR (wing E),
    //   BS / BW / BE — sort by centroid y, then x.
    // Horizontal groups (running left-to-right): BN, PN — sort by x.
    if (['BN', 'PN'].includes(prefix)) return s.centroid[0]*1000 + s.centroid[1];
    return s.centroid[1]*1000 + s.centroid[0];
  }
  const grouped = {};
  strips.forEach((s, i) => {
    const p = labelPrefix[i];
    if (p.startsWith('D') || p === '?') return;
    (grouped[p] = grouped[p] || []).push({ s, i });
  });
  Object.keys(grouped).forEach(p => {
    grouped[p].sort((a, b) => naturalSortKey(p, a.s) - naturalSortKey(p, b.s));
    grouped[p].forEach((entry, k) => { finalLabels[entry.i] = `${p}${k+1}`; });
  });

  // --- Build SVG overlay ---
  const cw = tx.W, ch = tx.H;
  const labels = strips.map((s, i) => {
    const [cx, cy] = toC(s.centroid);
    return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" class="lbl">${finalLabels[i]}</text>`;
  }).join('');

  // Conservation summary per donor.
  const donorSummary = {};
  strips.forEach((s, i) => {
    if (s._donorIdx === undefined) return;
    const d = `D${s._donorIdx + 1}`;
    (donorSummary[d] = donorSummary[d] || []).push({ label: finalLabels[i], color: s.color, pieceM: s.pieceM });
  });

  const dColorName = {
    '#ef4444': 'red', '#f59e0b': 'orange', '#eab308': 'yellow', '#84cc16': 'lime',
    '#10b981': 'emerald', '#06b6d4': 'cyan', '#3b82f6': 'blue', '#8b5cf6': 'purple',
    '#ec4899': 'pink', '#a3a3a3': 'gray'
  };
  const donorRowHTML = Object.keys(donorSummary).sort((a,b) => +a.slice(1) - +b.slice(1)).map(d => {
    const ps = donorSummary[d];
    const col = ps[0].color;
    const tags = ps.map(p => p.label).sort().join(', ');
    return `<tr>
      <td><span class="dot" style="background:${col}"></span>${d}</td>
      <td>${dColorName[col] || col}</td>
      <td>${ps.length}</td>
      <td>${tags}</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;}
    body{margin:0;padding:24px;background:#fff;font:14px/1.45 -apple-system,Inter,sans-serif;color:#111;}
    h1{font-size:20px;margin:0 0 6px;}
    .sub{font-size:13px;color:#555;margin-bottom:18px;}
    .frame{position:relative;background:#fff;border:1px solid #ccd;border-radius:6px;display:inline-block;}
    .frame img{display:block;}
    .frame svg{position:absolute;inset:0;width:100%;height:100%;}
    .lbl{font-family:Inter,sans-serif;font-size:9px;font-weight:700;fill:#111;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:rgba(255,255,255,0.92);stroke-width:2.5px;stroke-linejoin:round;}
    .legend{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px;}
    .key{background:#fafafa;border:1px solid #ddd;border-radius:8px;padding:12px 14px;font-size:12.5px;line-height:1.55;}
    .key h3{font-size:13px;margin:0 0 8px;}
    .key ul{margin:0;padding-left:18px;}
    .key code{background:#fff;border:1px solid #ddd;padding:0 4px;border-radius:3px;font-size:11.5px;}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px;}
    th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:left;}
    th{background:#f3f4f6;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:#374151;}
    .dot{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:middle;border:1px solid rgba(0,0,0,.2);}
  </style></head><body>
    <h1>Canonical Big-L cascade — annotated reference (image A)</h1>
    <div class="sub">Each strip is labelled with its donor identity + piece role. Conservation: every "D<i>n</i>" group's pieces, taped back together, equal exactly one full main-N donor sheet. Exception: the wing's purple PN1–PN4 offcuts in the N triangle come from valley cuts on PR5–PR8 (wing E sheets), not from the rainbow donors.</div>
    <div class="frame">
      <img src="${canvasDataURL}" width="${cw}" height="${ch}"/>
      <svg viewBox="0 0 ${cw} ${ch}" preserveAspectRatio="none">${labels}</svg>
    </div>
    <div class="legend">
      <div class="key">
        <h3>Rainbow donors (10 main-N donor sheets, D1–D10)</h3>
        <ul>
          <li><b>.N</b> — north piece. For D1–D8 it's translated −300 px up into the wing's N hip-end. For D9, D10 it stays in the main's NW area (between gutter and phantom NW hip).</li>
          <li><b>.M</b> — middle piece (only D5–D8). Stays in the main NW chunk between the valley line (y=800−x) and the phantom NW hip (y=x+300).</li>
          <li><b>.S</b> — south piece. Rotated 90° CCW around (mx0, midY) into the main's SW hip-end. D1–D9 produce full bands; D10 is a tiny triangle.</li>
        </ul>
        <table>
          <thead><tr><th>Donor</th><th>Colour</th><th>#pieces</th><th>Tags</th></tr></thead>
          <tbody>${donorRowHTML}</tbody>
        </table>
      </div>
      <div class="key">
        <h3>Other groups (numbered top-to-bottom or left-to-right within group)</h3>
        <ul>
          <li><b>PL1–PL8</b> — purple wing W-side full sheets (count as order).</li>
          <li><b>PR1–PR8</b> — purple wing E-side full sheets. PR5–PR8 are cut at the valley.</li>
          <li><b>PN1–PN4</b> — purple wing-N triangle offcuts: the east-of-valley pieces from PR5–PR8, translated 300 px up. <em>This is the exception</em>: PN's parent sheets are PR5–PR8, not the rainbow donors.</li>
          <li><b>BW</b> — blue donors in main W hip-end UPPER (y=550–750, longer horizontal strips).</li>
          <li><b>BN1–BN4</b> — blue offcuts in wing NW (moved from y=400–550 → y=100–250). Sourced from BW donors.</li>
          <li><b>ON</b> — orange main N long-side strips east of D10.</li>
          <li><b>BS</b> — blue main S long-side strips.</li>
          <li><b>BE</b> — blue main E hip-end UPPER strips.</li>
          <li><b>OE</b> — orange main E hip-end LOWER strips.</li>
        </ul>
      </div>
    </div>
  </body></html>`;

  const tmpHTML = path.resolve('floodroofing/docs/_bigL_annot_v2.html');
  fs.writeFileSync(tmpHTML, html);
  await page.goto('file://' + tmpHTML, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w + 24, 2400), height: Math.min(dim.h + 24, 4000) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/bigL_canonical_annotated.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);
  fs.unlinkSync(tmpHTML);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
