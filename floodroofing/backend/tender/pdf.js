// AI Tendering — reading a plan set in Node.
//
// pdfjs-dist (the same library the app uses in the browser for the WebShed
// import) extracts every text run WITH its position, and @napi-rs/canvas
// rasterises a page so a sheet that is nothing but vectors — or a scan —
// can still be shown to the classifier. Nothing in here knows about
// tenders, storage or the database: a buffer in, pages out.
'use strict';

let _pdfjs = null;
async function _lib(){
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}
function _canvas(){ return require('@napi-rs/canvas'); }

// Open a PDF from a Buffer. Returns the pdfjs document (numPages, getPage).
async function open(buf){
  const pdfjs = await _lib();
  // A COPY: pdf.js takes the bytes it is handed and detaches them, which
  // left the caller's buffer empty for the reading threads (2026-11-06).
  const data = new Uint8Array(buf);
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0, isEvalSupported: false });
  return task.promise;
}

async function meta(doc){
  try { const m = await doc.getMetadata(); return (m && m.info) || {}; } catch (e) { return {}; }
}

// Every text run on a page with its box in PDF points, y measured DOWN from
// the top-left (the way a picture is read), rotation already applied by the
// viewport. `fullText` is the runs in reading order (top to bottom, left to
// right) joined with spaces and newlines where the baseline moves.
async function extract(doc, pageNo, keep){
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent({ includeMarkedContent: false });
  const words = [];
  for (const it of tc.items) {
    if (!it || typeof it.str !== 'string') continue;
    const s = it.str;
    if (!s.trim()) continue;
    // transform = [a b c d e f]; (e,f) is the baseline origin in PDF space.
    const [a, b, c, d, e, f] = it.transform;
    const h = it.height || Math.hypot(c, d) || 0;
    const w = it.width || 0;
    // viewport.convertToViewportPoint handles the page rotation.
    const p = vp.convertToViewportPoint(e, f);
    const rot = Math.abs(Math.atan2(b, a) * 180 / Math.PI);
    const vertical = rot > 45 && rot < 135;
    words.push({
      s,
      x: +(vertical ? p[0] - h : p[0]).toFixed(1),
      y: +(vertical ? p[1] - w : p[1] - h).toFixed(1),
      w: +(vertical ? h : w).toFixed(1),
      h: +(vertical ? w : h).toFixed(1),
      r: vertical ? 90 : 0,
    });
  }
  const lines = _lines(words);
  const fullText = lines.map(l => l.map(w => w.s).join(' ')).join('\n');
  const out = {
    pageNo, width: +vp.width.toFixed(1), height: +vp.height.toFixed(1), rotation: page.rotate || 0,
    words, lines: lines.map(l => ({ y: l[0].y, x: l[0].x, s: l.map(w => w.s).join(' ') })), fullText,
  };
  if (!keep) { try { page.cleanup(); } catch (e) {} }
  return out;
}

// Group runs into lines by baseline (within half the run's height), then
// order left to right. Vertical runs (a title block down the right edge) are
// kept as their own lines.
function _lines(words){
  const horiz = words.filter(w => !w.r).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  for (const w of horiz) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - w.y) <= Math.max(2, Math.min(last[0].h, w.h) * 0.55)) last.push(w);
    else lines.push([w]);
  }
  lines.forEach(l => l.sort((a, b) => a.x - b.x));
  const vert = words.filter(w => w.r).slice().sort((a, b) => (a.x - b.x) || (b.y - a.y));
  for (const w of vert) lines.push([w]);
  return lines;
}

// Render a page (or a region of it, in PDF points from the top-left) to a
// JPEG at the DPI asked for. `maxPx` caps the longest side so a 1.2 m-wide
// A0 sheet at 150 DPI does not become a 7000 px picture nobody can send.
async function render(doc, pageNo, opts){
  opts = opts || {};
  const page = await doc.getPage(pageNo);
  const cv = await _draw(page, opts);
  const quality = opts.quality || 82;
  const buf = cv.toBuffer('image/jpeg', quality);
  if (!opts.keep) { try { page.cleanup(); } catch (e) {} }
  return { buf, width: cv.width, height: cv.height, scale: cv._scale, mime: 'image/jpeg' };
}
async function _draw(page, opts){
  const dpi = opts.dpi || 150;
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  const region = opts.region || null;   // {x,y,w,h} in points, top-left origin
  const rw = region ? region.w : base.width, rh = region ? region.h : base.height;
  const maxPx = opts.maxPx || 4000;
  if (Math.max(rw, rh) * scale > maxPx) scale = maxPx / Math.max(rw, rh);
  const vp = page.getViewport({ scale, offsetX: region ? -region.x * scale : 0, offsetY: region ? -region.y * scale : 0 });
  const W = Math.max(1, Math.ceil(rw * scale)), H = Math.max(1, Math.ceil(rh * scale));
  const { createCanvas } = _canvas();
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, viewport: vp, background: 'rgba(255,255,255,1)' }).promise;
  cv._scale = scale;
  return cv;
}

// Everything a tender needs from one page, off ONE page object (2026-11-06,
// "speed up the pdf reader"): its words, the page picture, a thumbnail
// shrunk from that picture (it used to be a whole second render) and the
// title-block tile. pdf.js parses a page's drawing once per page object and
// cleanup() throws that away, so three renders that each fetched and
// cleaned the page parsed it three times — 0.8 s each on an A1 sheet.
// A render that fails costs the pictures, never the words.
async function pageAssets(doc, pageNo, o){
  const page = await doc.getPage(pageNo);
  try {
    const ex = await extract(doc, pageNo, true);
    const out = { ex, img: null, thumb: null, tile: null, renderError: '' };
    try {
      const cv = await _draw(page, { dpi: o.pageDpi, maxPx: o.pageMaxPx });
      out.img = { buf: cv.toBuffer('image/jpeg', 82), width: cv.width, height: cv.height };
      const k = Math.min(1, o.thumbPx / Math.max(cv.width, cv.height));
      const { createCanvas } = _canvas();
      const tc = createCanvas(Math.max(1, Math.round(cv.width * k)), Math.max(1, Math.round(cv.height * k)));
      tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
      out.thumb = { buf: tc.toBuffer('image/jpeg', 70), width: tc.width, height: tc.height };
      const tv = await _draw(page, { dpi: o.tbDpi, maxPx: o.tbMaxPx, region: titleBlockRegion(ex.width, ex.height) });
      out.tile = { buf: tv.toBuffer('image/jpeg', 82), width: tv.width, height: tv.height };
    } catch (e) { out.renderError = String(e && e.message || e); }
    return out;
  } finally { try { page.cleanup(); } catch (e) {} }
}

// Shrink a rendered page to a thumbnail (longest side `px`).
async function thumbnail(doc, pageNo, px){
  const base = (await doc.getPage(pageNo)).getViewport({ scale: 1 });
  const dpi = 72 * (px || 360) / Math.max(base.width, base.height);
  return render(doc, pageNo, { dpi, quality: 70, maxPx: px || 360 });
}

// The title block is almost always the bottom-right corner (or the right
// edge) of a landscape sheet; this is the region handed to the title-block
// render and to the parser's "where on the sheet" scoring.
function titleBlockRegion(width, height){
  return { x: width * 0.6, y: height * 0.55, w: width * 0.4, h: height * 0.45 };
}

module.exports = { open, meta, extract, render, thumbnail, titleBlockRegion, pageAssets };
