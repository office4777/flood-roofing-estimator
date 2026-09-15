// A plan arrives as a PDF, with the roof on page 4 of 11.
//
// Roofers are handed drawings far more often than aerials — council plans, an
// architect's set, the old quote — and before this the only way to draw on one
// was to screenshot it. So a PDF can be picked or dropped like a photo; the
// app asks WHICH page rather than guessing; that page goes under the drawing
// at a size worth tracing; and every page joins the job photos, which is how
// the rest of the set stays readable while the work happens.
//
// pdf.js is fetched from a CDN the first time somebody opens a PDF. This suite
// never touches the network: it installs a stand-in on window.pdfjsLib, which
// is exactly the seam _pdfjsLoad() checks first. The failure path — no signal,
// no reader — is driven by leaving the stand-in out.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(withPdfjs){
  const ctx = await b.newContext({ viewport:{ width:1400, height:1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
  // Nothing may reach the real CDN — if the app tries, the suite says so
  // rather than quietly passing on a live download.
  let cdnTried = false;
  await pg.route('https://cdnjs.cloudflare.com/**', r => { cdnTried = true; return r.abort(); });
  await pg.addInitScript((stub) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
    localStorage.removeItem('fr_settings');
    if (!stub) return;
    // A three-page document. Each page paints its number, so the test can
    // tell page 2 from page 3 by looking at the pixels.
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument(){
        return { promise: Promise.resolve({
          numPages: 3,
          getPage(n){
            return Promise.resolve({
              getViewport({ scale }){ return { width: 100 * scale, height: 140 * scale }; },
              render({ canvasContext, viewport }){
                canvasContext.fillStyle = ['#ff0000','#00ff00','#0000ff'][n-1] || '#000';
                canvasContext.fillRect(0, 0, viewport.width, viewport.height);
                window.__renderedScales = (window.__renderedScales || []).concat([[n, viewport.width / 100]]);
                return { promise: Promise.resolve() };
              },
            });
          },
        }) };
      },
    };
  }, withPdfjs);
  await pg.goto('file://' + _j(DIR, 'app.html'));
  await pg.waitForTimeout(2400);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  return { ctx, pg, cdn: () => cdnTried };
}
// A file the page can hand to the app exactly as a picker would.
const pickPdf = (pg, name='plans.pdf') => pg.evaluate((n) => {
  const f = new File([new Uint8Array([37,80,68,70])], n, { type: 'application/pdf' });
  return _roofPdfOpen(f);
}, name);

// ── the button is there, next to the others ───────────────────────
{
  const { ctx, pg } = await boot(true);
  await pg.evaluate(() => gotoTab('roof'));
  await pg.waitForTimeout(400);
  const v = await pg.evaluate(() => ({
    btn: [...document.querySelectorAll('#roofUZ button')].map(b => b.textContent.trim()),
    accepts: (document.getElementById('roofPdfFile') || {}).accept,
    sub: (document.querySelector('#roofUZ .uz-sub') || {}).textContent,
  }));
  check('the upload box offers PDF plans', v.btn.some(t => /PDF Plans/i.test(t)), JSON.stringify(v.btn));
  check('…and the picker only takes PDFs', /pdf/i.test(String(v.accepts)), String(v.accepts));
  check('…and the drop zone says a PDF is welcome too', /PDF/.test(String(v.sub)), String(v.sub));
  await ctx.close();
}

// ── which page? ───────────────────────────────────────────────────
{
  const { ctx, pg, cdn } = await boot(true);
  await pg.evaluate(() => gotoTab('roof'));
  await pg.waitForTimeout(300);
  pickPdf(pg);
  await pg.waitForTimeout(900);
  let v = await pg.evaluate(() => ({
    open: (document.getElementById('roofPdfModal') || {}).style?.display,
    head: (document.querySelector('#roofPdfModal .pg-head') || {}).textContent || '',
    thumbs: document.querySelectorAll('#roofPdfPages img').length,
  }));
  check('picking a PDF asks which page, rather than guessing',
    v.open === 'flex' && /Which page is the roof plan/i.test(v.head), v.head);
  check('…showing every page as a thumbnail', v.thumbs === 3, String(v.thumbs));
  check('…without reaching the CDN when the reader is already there', cdn() === false);

  // Page 2 — the green one.
  await pg.evaluate(() => _roofPdfUsePage(2));
  await pg.waitForTimeout(1200);
  v = await pg.evaluate(() => ({
    closed: (document.getElementById('roofPdfModal') || {}).style?.display,
    bg: !!(window.DRAW && DRAW.bgImg),
    prev: (document.getElementById('roofPrevImg') || {}).src ? true : false,
    scales: window.__renderedScales || [],
  }));
  check('choosing a page closes the chooser and puts it on the canvas',
    v.closed === 'none' && v.prev === true, JSON.stringify({ closed: v.closed, prev: v.prev }));
  // THE BUG: _roofPrevToCanvas handed an <img> the RAW base64 out of S.img64,
  // with no data: prefix, so the browser treated it as a relative URL and
  // every plan page ended on "Could not display that photo — try another."
  check('…and the background really loads, rather than 404ing as a relative URL',
    v.bg === true, 'DRAW.bgImg set: ' + v.bg);
  check('…rendered big enough to trace off, not at thumbnail size',
    v.scales.some(s => s[0] === 2 && s[1] >= 2), JSON.stringify(v.scales));
  await ctx.close();
}

// ── and the whole set lands in the photos ─────────────────────────
{
  const { ctx, pg } = await boot(true);
  await pg.evaluate(() => gotoTab('roof'));
  await pg.waitForTimeout(300);
  pickPdf(pg);
  await pg.waitForTimeout(900);
  await pg.evaluate(() => _roofPdfUsePage(1));
  await pg.waitForTimeout(2500);
  const v = await pg.evaluate(() => ({
    n: (window.S && S.photos || []).length,
    caps: (window.S && S.photos || []).map(p => p.caption),
    src: (window.S && S.photos || []).every(p => /^data:image\//.test(p.src || '')),
  }));
  check('every page of the plan joins the job photos', v.n === 3, String(v.n));
  check('…named by page, so page 4 of 11 is findable',
    v.caps.join('|') === 'Plan — page 1|Plan — page 2|Plan — page 3', JSON.stringify(v.caps));
  check('…as ordinary images, so they save with the job like any photo', v.src === true);

  // Looking through them is the point: the viewer pages.
  await pg.evaluate(() => _jobPhotoView(0));
  await pg.waitForTimeout(250);
  let cap = await pg.evaluate(() => (document.getElementById('jobPhotoViewerCap') || {}).textContent || '');
  check('the viewer says where you are in the set', /page 1 · 1 of 3/.test(cap), cap);

  // A plan page on a phone is unreadable at fit-to-screen. Zoom and drag are
  // the feature, not the trimming.
  let zv = await pg.evaluate(() => ({
    hasIn: !!document.getElementById('jobPhotoZoomIn'),
    hasOut: !!document.getElementById('jobPhotoZoomOut'),
    hasFit: !!document.getElementById('jobPhotoZoomReset'),
    t: (document.getElementById('jobPhotoViewerImg') || {}).style?.transform || '',
  }));
  check('…and it can be zoomed', zv.hasIn && zv.hasOut && zv.hasFit, JSON.stringify(zv));
  check('…starting at fit', /scale\(1\)/.test(zv.t), zv.t);
  await pg.click('#jobPhotoZoomIn');
  await pg.waitForTimeout(150);
  zv = await pg.evaluate(() => ({
    t: (document.getElementById('jobPhotoViewerImg') || {}).style?.transform || '',
    lbl: (document.getElementById('jobPhotoZoomOut2') || {}).textContent || '',
  }));
  check('…zooming in really scales the picture', /scale\(1\.5\)/.test(zv.t) && /150%/.test(zv.lbl), JSON.stringify(zv));
  // Dragging moves it once it is bigger than the window.
  await pg.mouse.move(700, 500); await pg.mouse.down();
  await pg.mouse.move(760, 540, { steps: 4 }); await pg.mouse.up();
  await pg.waitForTimeout(150);
  zv = await pg.evaluate(() => ({
    t: (document.getElementById('jobPhotoViewerImg') || {}).style?.transform || '',
    open: !!document.getElementById('jobPhotoViewer'),
  }));
  check('…dragging a zoomed page moves it', /translate\((?!0px,\s*0px)/.test(zv.t), zv.t);
  check('…and dragging does NOT close the viewer', zv.open === true);
  await pg.click('#jobPhotoZoomReset');
  await pg.waitForTimeout(150);
  zv = await pg.evaluate(() => (document.getElementById('jobPhotoViewerImg') || {}).style?.transform || '');
  check('…and Fit puts it back', /scale\(1\)/.test(zv) && /translate\(0px, 0px\)/.test(zv), zv);
  await pg.click('#jobPhotoNext');
  await pg.waitForTimeout(200);
  cap = await pg.evaluate(() => (document.getElementById('jobPhotoViewerCap') || {}).textContent || '');
  check('…and pages forward', /page 2 · 2 of 3/.test(cap), cap);
  await pg.keyboard.press('ArrowLeft');
  await pg.waitForTimeout(200);
  cap = await pg.evaluate(() => (document.getElementById('jobPhotoViewerCap') || {}).textContent || '');
  check('…and back, on the keyboard', /page 1 · 1 of 3/.test(cap), cap);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(200);
  check('…and closes', await pg.evaluate(() => !document.getElementById('jobPhotoViewer')));
  await ctx.close();
}

// ── no signal: say so, don't sit there ────────────────────────────
{
  const { ctx, pg } = await boot(false);
  await pg.evaluate(() => gotoTab('roof'));
  await pg.waitForTimeout(300);
  pickPdf(pg);
  await pg.waitForTimeout(1500);
  const v = await pg.evaluate(() => ({
    head: (document.querySelector('#roofPdfModal .pg-head') || {}).textContent || '',
    sub: (document.querySelector('#roofPdfModal .pg-sub') || {}).textContent || '',
  }));
  check('with the reader unreachable it says so plainly', /Couldn.t open the PDF/i.test(v.head), v.head);
  check('…and offers the way round it', /screenshot/i.test(v.sub) && /Upload from PC/i.test(v.sub), v.sub.slice(0, 140));
  await ctx.close();
}

// ── the View menu is now about what it is about ───────────────────
{
  const { ctx, pg } = await boot(true);
  await pg.evaluate(() => gotoTab('roof'));
  await pg.waitForTimeout(300);
  const v = await pg.evaluate(() => ({
    label: (document.getElementById('viewMenuBtn') || {}).textContent || '',
    menu: (document.getElementById('viewMenu') || {}).textContent || '',
  }));
  check('the menu is named for what it does', /Edit font size \/ rotate image/.test(v.label), v.label.trim());
  check('…the bug-report copy is gone from it', !/Copy roof geometry/.test(v.menu));
  check('…and so is Switch to Site mode', !/Switch to Site mode/.test(v.menu));
  check('…while the font sizes and the rotation stay',
    /Sheet text/.test(v.menu) && /Outline text/.test(v.menu) && /Rotate photo/i.test(v.menu));
  await ctx.close();
}

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
