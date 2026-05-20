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

  // --- Assign a SHEET ID to each strip (every piece of one physical
  //     sheet shares one id).  Then number sheets 1..N in reading order
  //     and label each strip with that number. ---
  // Canonical column starts (rounded to integer) so BS/BE pairings on
  // the SW side and BS/BE on the SE side line up exactly.
  const SW_BS_COLS = [100, 138, 176, 214, 252, 291, 329, 367, 405];  // col 1..9 SW-clipped
  const SE_BS_COLS = [672, 710, 748, 786, 824, 862, 900, 938, 976];  // SE-clipped east
  function sheetGroupKey(s) {
    // 1) Rainbow donors — _donorIdx identifies the physical donor sheet.
    if (s._donorIdx !== undefined) return `D${s._donorIdx}`;
    const PURPLE = '#a855f7';
    const BLUE   = '#2563eb';
    const ORANGE = '#f97316';
    const xs = s.poly.map(p => p[0]);
    const ys = s.poly.map(p => p[1]);
    const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const coverPx = 38.1;
    // 2) Purple wing — PR sheet and its PN offcut share yMax (PN's yMax+300).
    if (s.color === PURPLE) {
      if (yMax < 250 + 1) return `PR-${Math.round(yMax + 300)}`;
      if (xMid < 250) return `PL-${Math.round(yMax)}`;
      return `PR-${Math.round(yMax)}`;
    }
    // 3) Blue cascade:
    //   BS-SW (SW-hip-clipped donors x ∈ [100, 443]) pair with BN+BW
    //   offcuts size-matched ascending.
    //   BS-SE (SE-hip-clipped donors x ∈ [672, 1000]) pair with BE
    //   E hip-end UPPER offcuts size-matched ascending.
    if (s.color === BLUE) {
      // BN strip: wing NW, y ≤ 250, x starts at 100.
      if (yMax <= 251 && xMin <= 100.5) {
        const idx = Math.round((yMin - 100) / coverPx);   // 0..3
        return `BS-${SW_BS_COLS[8 - idx]}`;
      }
      // BW strip: main W hip-end UPPER, y in [550, 750], hip-end face.
      if (yMin >= 549 && yMax <= 751 && xMin <= 100.5 && s.faceType === 'hip-end') {
        const idx = Math.round((yMin - 550) / coverPx);   // 0..5 (5 = narrow)
        if (idx <= 4) return `BS-${SW_BS_COLS[4 - idx]}`;
        return `BW-narrow-${Math.round(yMin)}`;  // 6th BW (thin ridge slice) unpaired
      }
      // BE strip: main E hip-end UPPER, blue offcut, hip-end face, x reaches mx1.
      if (s.faceType === 'hip-end' && xMax >= 999 && yMin < 750) {
        const idx = Math.round((yMin - 400) / coverPx);   // 0..8
        if (idx >= 0 && idx <= 8) return `BS-${SE_BS_COLS[idx]}`;
        return `BE-straddle-${Math.round(yMin)}`;          // 10th BE (straddle band) unpaired
      }
      // BS donor on south long-side (any column).  Match against known
      // SW/SE column starts so the key collides with the right offcut.
      if (s.faceType === 'long-side' && yMax > 1099) {
        const swCol = SW_BS_COLS.find(x => Math.abs(x - xMin) < 2);
        if (swCol !== undefined) return `BS-${swCol}`;
        const seCol = SE_BS_COLS.find(x => Math.abs(x - xMin) < 2);
        if (seCol !== undefined) return `BS-${seCol}`;
        return `BS-${Math.round(xMin)}`;                    // full-length cols (no offcut pair)
      }
    }
    // 4) Orange cascade:
    //   ON donors (N long-side east of D10) pair with OE E hip-end LOWER
    //   offcuts.  Full-length ON donors (x ∈ [481, 672]) have no offcut.
    //   NE-clipped ON donors (x ∈ [672, 1000]) pair with OE offcuts
    //   size-matched ascending.
    if (s.color === ORANGE) {
      // OE strip: E hip-end LOWER, orange offcut, hip-end face, x reaches mx1, y > midY.
      if (s.faceType === 'hip-end' && xMax >= 999 && yMin >= 749) {
        const idx = Math.round((yMin - 781) / coverPx);   // 0..8 (i=0 closest to ridge)
        if (idx >= 0 && idx <= 8) {
          // Largest OE (closest to ridge) ↔ farthest ON (largest offcut).
          return `ON-${SE_BS_COLS[8 - idx]}`;
        }
        return `OE-${Math.round(yMin)}`;
      }
      // ON donor: N long-side, yMin = 400.  NE-clipped cols pair via SE_BS_COLS lookup.
      if (s.faceType === 'long-side' && yMin <= 401) {
        const seCol = SE_BS_COLS.find(x => Math.abs(x - xMin) < 2);
        if (seCol !== undefined) return `ON-${seCol}`;
        return `ON-${Math.round(xMin)}`;                    // full-length cols (no offcut pair)
      }
    }
    // 5) Anything else: each strip is its own physical sheet.
    return `${s.color}-${Math.round(s.centroid[0])}-${Math.round(s.centroid[1])}`;
  }

  const sheetKey = strips.map(sheetGroupKey);
  // Pick a representative strip per sheet to determine sort order
  // (prefer the primary / non-offcut piece).
  const reps = {};
  strips.forEach((s, i) => {
    const k = sheetKey[i];
    if (!reps[k]) { reps[k] = { idx: i, centroid: s.centroid.slice() }; return; }
    if (strips[reps[k].idx].isOffcut && !s.isOffcut) {
      reps[k] = { idx: i, centroid: s.centroid.slice() };
    }
  });

  // Sort sheets by reading order (top-to-bottom by y, then left-to-right by x).
  const sortedKeys = Object.keys(reps).sort((a, b) => {
    const A = reps[a].centroid, B = reps[b].centroid;
    return A[1] - B[1] || A[0] - B[0];
  });
  const numberByKey = {};
  sortedKeys.forEach((k, i) => { numberByKey[k] = i + 1; });

  const finalLabels = strips.map((s, i) => String(numberByKey[sheetKey[i]] || '?'));

  // --- Build SVG overlay ---
  const cw = tx.W, ch = tx.H;
  const labels = strips.map((s, i) => {
    const [cx, cy] = toC(s.centroid);
    return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" class="lbl">${finalLabels[i]}</text>`;
  }).join('');

  // Conservation summary: count distinct sheet numbers and how many
  // pieces each one has.
  const sheetsByNum = {};
  strips.forEach((s, i) => {
    const n = finalLabels[i];
    (sheetsByNum[n] = sheetsByNum[n] || []).push(s);
  });
  const totalSheets = Object.keys(sheetsByNum).length;
  const multiPieceSheets = Object.entries(sheetsByNum)
    .filter(([n, ps]) => ps.length > 1)
    .sort((a, b) => +a[0] - +b[0]);
  const donorRowHTML = multiPieceSheets.map(([n, ps]) => {
    const col = ps[0].color;
    return `<tr>
      <td><b>${n}</b></td>
      <td><span class="dot" style="background:${col}"></span></td>
      <td>${ps.length}</td>
      <td>${ps.map(p => p.isOffcut ? 'offcut' : 'primary').join(', ')}</td>
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
    <h1>Canonical Big-L cascade — numbered (image A)</h1>
    <div class="sub">Each physical sheet is numbered 1–${totalSheets}. Pieces of the same physical sheet share its number — taped back together, they equal one full donor sheet. The only sheets cut into multiple pieces are the 10 rainbow main-N donors (each cut into N + optional M + S) and the wing's PR sheets that get clipped by the valley (their east-of-valley offcuts land in the wing's N triangle).</div>
    <div class="frame">
      <img src="${canvasDataURL}" width="${cw}" height="${ch}"/>
      <svg viewBox="0 0 ${cw} ${ch}" preserveAspectRatio="none">${labels}</svg>
    </div>
    <div class="legend">
      <div class="key">
        <h3>Multi-piece sheets (one physical sheet → multiple offcut locations)</h3>
        <table>
          <thead><tr><th>Sheet&nbsp;#</th><th>Colour</th><th>#pieces</th><th>Roles</th></tr></thead>
          <tbody>${donorRowHTML}</tbody>
        </table>
        <p style="font-size:11.5px;color:#555;margin-top:10px;">Every other sheet is a single piece — those are the 1-piece sheets installed as-is.</p>
      </div>
      <div class="key">
        <h3>How to read the numbers</h3>
        <ul>
          <li>Find a number on the cascade. If it appears in 2 (or 3) places, those pieces all come from the same physical donor sheet.</li>
          <li><b>10 rainbow donor sheets</b> on the main's N long-side. Each is cut into a north piece (translated up to the wing's N hip-end, except D9/D10 which stay) + an optional middle piece (D5–D8) + a south piece (rotated 90° CCW into the main's SW hip-end).</li>
          <li><b>Wing's purple east-side sheets (PR)</b> that cross the valley have their east-of-valley offcut translated 300 px up into the wing's N triangle. PR sheet and PN offcut share a number.</li>
          <li><b>9 blue BS donor sheets</b> at the SW-hip-clipped columns (x = 100..443) pair with the 4 BN strips in the wing NW + 5 BW strips in the main W hip-end upper. Pairing is size-matched.</li>
          <li><b>9 blue BS donor sheets</b> at the SE-hip-clipped columns (x = 672..1000) pair with the 9 BE offcuts in the main E hip-end UPPER (above the ridge). Pairing is size-matched.</li>
          <li><b>9 orange ON donor sheets</b> at the NE-hip-clipped columns (x = 672..1000) pair with the 9 OE offcuts in the main E hip-end LOWER (below the ridge). Pairing is size-matched.</li>
          <li>All other strips (PL wing left, full-length BS/ON main middle, narrow ridge slices) are single-piece sheets, each with its own number.</li>
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
