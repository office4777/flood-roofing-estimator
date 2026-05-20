// Annotated reference render of the canonical Big-L cascade (Image A).
// Shows the sheet-plan canvas at high resolution, with a colour-keyed
// donor→offcut mapping table beside it so the user can verify the
// cascade logic piece-by-piece.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  // Set up canonical Big-L.
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

  // Capture canvas as PNG dataURL at native resolution.
  const canvasDataURL = await page.evaluate(() => {
    const cvs = document.querySelector('#roofSheetPlanOut canvas');
    return cvs ? cvs.toDataURL('image/png') : null;
  });
  if (!canvasDataURL) { console.error('no canvas'); process.exit(1); }

  // Extract strip metadata for the cascade.  We expose allStrips via a
  // window hook by re-running the layout function inline (it's not
  // currently exposed globally).  Easier path: ask the page to find
  // each colored strip from the canvas via the legend data + replicate
  // the cascade math here in node.
  //
  // The canonical Big-L cascade we just rendered uses these parameters:
  //   coverPx     — sheet effective width in pixels
  //   donor span  — 10 donors at x in [mx0 + i*coverPx, mx0 + (i+1)*coverPx]
  //   mx0=100, my0=400, my1=1100, mainH=700, midY=750, wApex=450, eApex=650
  //   wing wx0=100, wy0=100, wx1=400, wy1=400, refY=400
  //
  // For each donor D_i (i=1..10) we report:
  //   - color (DONOR_COLORS[i-1])
  //   - north piece destination
  //   - middle piece (if hasValley)
  //   - south piece (if x1 <= wApex or straddles)
  const meta = await page.evaluate(() => {
    // coverPx comes from sheet effective width (mm) / scale (m/px) / 1000.
    const sheetWmm = parseFloat(document.getElementById('sheetWidth').value || 762);
    const scale = window.DRAW.scaleMetresPerPx;
    const coverPx = sheetWmm / 1000 / scale;
    return { sheetWmm, scale, coverPx };
  });

  const mx0 = 100, my0 = 400, my1 = 1100, midY = 750, wApex = 450, refY = 400;
  const wx0 = 100, wx1 = 400, wy0 = 100;
  const valleyEndX = 250;  // (wx0+wx1)/2
  const DONOR_COLORS = ['#ef4444','#f59e0b','#eab308','#84cc16','#10b981',
                        '#06b6d4','#3b82f6','#8b5cf6','#ec4899','#a3a3a3'];
  const DONOR_NAMES  = ['red','orange','yellow','lime','emerald',
                        'cyan','blue','purple','pink','gray'];
  const cp = meta.coverPx;

  const donorRows = [];
  for (let i = 0; i < 10; i++) {
    const x0 = mx0 + cp * i;
    const x1 = mx0 + cp * (i + 1);
    const xMid = (x0 + x1) / 2;
    const hasValley = (xMid >= valleyEndX && xMid <= wx1);
    const fitsWing = (xMid < wx1);
    const pieces = [];

    // North piece destination.
    let northDest;
    if (fitsWing) {
      northDest = `wing N hip-end (translated −300px up): y ≈ ${(wy0).toFixed(0)}..${(wy0 + (refY - x0 - 300 + 600)).toFixed(0)}`;
      northDest = 'wing N hip-end (translated −300 px up)';
    } else {
      if (x1 <= wApex)                     northDest = 'main NW chunk (no translation; bounded by phantom NW hip)';
      else if (x0 < wApex && x1 > wApex)   northDest = 'main NW chunk (straddles W-apex; bounded by hip + ridge)';
      else                                 northDest = 'main N long-side (no translation)';
    }
    pieces.push(`north → ${northDest}`);

    if (hasValley) {
      pieces.push('middle → main W hip-end upper (between valley & phantom NW hip)');
    }

    // South piece destination.
    if (x1 <= wApex) {
      pieces.push('south → main SW hip-end (rotated 90° CCW around (mx0, midY))');
    } else if (x0 < wApex && x1 > wApex) {
      pieces.push('south → main SW hip-end as triangle (rotated 90° CCW)');
    }

    donorRows.push({
      donor: `D${i+1}`,
      color: DONOR_COLORS[i],
      name: DONOR_NAMES[i],
      xRange: `[${x0.toFixed(1)}, ${x1.toFixed(1)}]`,
      xMid: xMid.toFixed(1),
      hasValley,
      fitsWing,
      pieces,
    });
  }

  // Compose annotated HTML page.
  const rowHTML = donorRows.map(r => `
    <tr>
      <td><span class="dot" style="background:${r.color}"></span>${r.donor}</td>
      <td>${r.name}</td>
      <td>${r.xRange}</td>
      <td>${r.hasValley ? 'yes' : 'no'}</td>
      <td>${r.fitsWing ? 'yes' : 'no'}</td>
      <td>${r.pieces.map(p => `<div>${p}</div>`).join('')}</td>
    </tr>
  `).join('');

  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;}
    body{margin:0;padding:24px;background:#fff;font:14px/1.45 -apple-system,Inter,sans-serif;color:#111;}
    h1{font-size:20px;margin:0 0 6px;}
    .sub{font-size:13px;color:#555;margin-bottom:18px;}
    .cascade{background:#f8f9fb;border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:22px;}
    .cascade img{display:block;width:100%;height:auto;border:1px solid #ccd;background:#fff;border-radius:6px;image-rendering:-webkit-optimize-contrast;}
    .cascade .note{font-size:12px;color:#555;margin-top:10px;line-height:1.55;}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:left;}
    th{background:#f3f4f6;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#374151;}
    .dot{display:inline-block;width:13px;height:13px;border-radius:2px;margin-right:6px;vertical-align:middle;border:1px solid rgba(0,0,0,.2);}
    .legend{margin-top:16px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 12px;font-size:12.5px;line-height:1.6;}
    .legend code{background:#fff;border:1px solid #fcd34d;padding:0 4px;border-radius:3px;font-size:12px;}
    .seqNote{margin-top:12px;font-size:12px;color:#444;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:9px 12px;}
  </style></head><body>
    <h1>Canonical Big-L cascade — donor → offcut reference</h1>
    <div class="sub">Outline: wing 300×300 (top-left), main 900×700 (bottom-right). 10 donor sheets D1–D10 across the main's N long-side at x ∈ [100, 100+10×coverPx]. coverPx ≈ ${cp.toFixed(2)} px (sheetW=${meta.sheetWmm}mm, scale=${meta.scale}m/px).</div>
    <div class="cascade">
      <img src="${canvasDataURL}"/>
      <div class="note">Small yellow numerals at each strip's centroid = <code>s.seq</code> within that strip's (colour, ordered-length) group. Each donor colour is its own group, so D1 (red) pieces are 1, 2, …; D2 (orange) pieces are 1, 2, …; etc.</div>
      <div class="seqNote"><b>Seq ordering within a colour group:</b> strips are sorted by centroid x, then y, then numbered 1..N. So the leftmost / topmost piece of a donor is "1", the next is "2", etc.</div>
    </div>
    <table>
      <thead><tr>
        <th>Donor</th><th>Colour</th><th>x-range (px)</th><th>has valley?</th><th>fits wing?</th><th>Pieces and destinations</th>
      </tr></thead>
      <tbody>${rowHTML}</tbody>
    </table>
    <div class="legend">
      <b>Cascade rules:</b><br>
      • <b>fitsWing</b> (xMid &lt; wx1=400): the donor's NORTH piece is translated <code>−300 px</code> up into the wing's N hip-end. Otherwise it stays in place on the main.<br>
      • <b>hasValley</b> (xMid ∈ [250, 400]): the donor produces a MIDDLE piece in the main's NW chunk between the valley line (y=800−x) and the phantom NW hip (y=x+300).<br>
      • <b>south piece</b> (x1 ≤ wApex=450 or straddle): the SOUTH portion of the donor strip below the phantom NW hip is rotated 90° CCW around <code>(mx0, midY)</code> and clipped into the main's SW hip-end triangle.<br>
      • <b>Main N strips east of D10</b> (orange): standard 4-hip strips on the main's N long-side, no cascade involvement.<br>
      • <b>Main S long-side</b> (blue): standard strips, full width, bounded by SW hip / ridge / SE hip.
    </div>
  </body></html>`;

  const tmpHTML = path.resolve('floodroofing/docs/_bigL_annotated.html');
  fs.writeFileSync(tmpHTML, html);
  await page.goto('file://' + tmpHTML, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w, 2400), height: Math.min(dim.h, 4000) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/bigL_canonical_annotated.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);

  fs.unlinkSync(tmpHTML);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
