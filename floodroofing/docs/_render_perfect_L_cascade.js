// Render the perfect L-shape with the sheet cascade applied and every
// strip labelled with its number, so the user can point at specific
// sheets to explain the desired layout.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1300 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
  });

  // Perfect L: 400-wide arms, 1000 long, meeting at corner.
  const outline = [[100,100],[500,100],[500,700],[1100,700],[1100,1100],[100,1100]];
  await page.evaluate((outline) => {
    window.DRAW.outline = outline;
    window.DRAW.outlineDone = true;
    window.DRAW.scaleMetresPerPx = 0.02;
    window.DRAW.calPitch = 22;
    window.DRAW.lines = [];
    window.autoGenerateRoof && window.autoGenerateRoof('hip');
  }, outline);
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
        color: s.color, seq: s.seq, isOffcut: !!s.isOffcut,
        faceType: s.face && s.face.type,
        centroid: s.centroid.slice(),
        poly: s.poly.map(p => p.slice()),
      })),
    };
  });
  if (!canvasDataURL || !tx) { console.error('missing canvas/transform'); process.exit(1); }

  // Outline-space → canvas-space.
  const toC = (p) => [(p[0]-tx.minX)*tx.sc + tx.padX, (p[1]-tx.minY)*tx.sc + tx.padY];

  // Each strip gets a globally-unique sheet number — sort by reading
  // order (top-to-bottom, then left-to-right) and assign 1..N so the
  // user can point at any sheet by number.
  const sorted = strips.slice().sort((a, b) => a.centroid[1] - b.centroid[1] || a.centroid[0] - b.centroid[0]);
  const numByIdx = new Map();
  sorted.forEach((s, i) => numByIdx.set(s, i + 1));

  const labels = strips.map(s => {
    const [cx, cy] = toC(s.centroid);
    const n = numByIdx.get(s);
    return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" class="lbl">${n}</text>`;
  }).join('');

  const cw = tx.W, ch = tx.H;
  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;}
    body{margin:0;padding:24px;background:#fff;font:14px/1.45 -apple-system,Inter,sans-serif;color:#111;}
    h1{font-size:20px;margin:0 0 6px;}
    .sub{font-size:13px;color:#555;margin-bottom:18px;}
    .frame{position:relative;background:#fff;border:1px solid #ccd;border-radius:6px;display:inline-block;}
    .frame img{display:block;}
    .frame svg{position:absolute;inset:0;width:100%;height:100%;}
    .lbl{font-family:Inter,sans-serif;font-size:10px;font-weight:700;fill:#111;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:rgba(255,255,255,0.92);stroke-width:2.5px;stroke-linejoin:round;}
    .info{margin-top:14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 14px;font-size:12.5px;line-height:1.55;max-width:${cw}px;}
  </style></head><body>
    <h1>Perfect L-shape cascade — numbered for mark-up</h1>
    <div class="sub">400-wide arms × 1000 long, both arms equal. ${strips.length} sheets total, numbered 1–${strips.length} in reading order (top-to-bottom, then left-to-right).</div>
    <div class="frame">
      <img src="${canvasDataURL}" width="${cw}" height="${ch}"/>
      <svg viewBox="0 0 ${cw} ${ch}" preserveAspectRatio="none">${labels}</svg>
    </div>
    <div class="info">
      <b>How this currently renders:</b> Since equal-arm L-shapes can't use the Big-L cascade (the proportions gate requires wing_w &le; main_h/2, but here wing_w == main_h), this falls back to the 6-face cascade. No donor pairing is applied — every sheet currently shows as its own primary piece. Tell me which sheets should pair with which, and which colours they should take.
    </div>
  </body></html>`;

  const tmp = path.resolve('floodroofing/docs/_perfect_L_cascade.html');
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.setViewportSize({ width: Math.min(dim.w + 24, 2400), height: Math.min(dim.h + 24, 3000) });
  await page.waitForTimeout(200);
  const outPng = 'floodroofing/docs/perfect_L_cascade_numbered.png';
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('wrote', outPng);
  fs.unlinkSync(tmp);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
