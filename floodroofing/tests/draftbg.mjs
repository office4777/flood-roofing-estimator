// Report #25: "when I re-enter a saved draft, the canvas and quote background
// image disappears."  Two faults with one victim:
//
//   1. the photo under the drawing was NEVER saved — the job snapshot carried
//      every line and label and left the picture they were traced over behind;
//   2. on re-entry, the first proposal render re-stashed the quote's map
//      geometry from a canvas with no photo, overwriting the aerial the quote
//      HAD saved with nothing.
//
// And report #26, same family: importing a photo left the canvas its old
// shape, so a wide photo letterboxed into the top of it and the space below
// was dead — the usable drawing area shrank.
//
// The drawing is stored in image-pixel coordinates, so what gets saved must
// keep the photo's original pixel dimensions — a downscaled copy would
// mis-align every roof on reload. That is asserted here, not assumed.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const mkPage = async () => {
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2600);
  return pg;
};
const errs = [];
const pg = await mkPage();

// A wide photo, like the Mapbox screenshot in the report (1328×802) — built in
// the page so the bytes are a real JPEG.
const jpegB64 = await pg.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1330; c.height = 800;
  const x = c.getContext('2d');
  x.fillStyle = '#67775a'; x.fillRect(0, 0, 1330, 800);
  x.fillStyle = '#3a4750'; x.fillRect(400, 200, 500, 350);   // a roof to look at
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
});

// ── report #26: importing the photo takes the canvas to its shape ──
await pg.evaluate(() => gotoTab('roof'));
await pg.waitForTimeout(300);
await pg.setInputFiles('#roofFile', { name:'site.jpg', mimeType:'image/jpeg',
  buffer: Buffer.from(jpegB64, 'base64') });
await pg.waitForTimeout(900);
let cv = await pg.evaluate(() => {
  const c = document.getElementById('roofCanvas');
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height),
           img: !!(DRAW.bgImg && DRAW.bgImg.naturalWidth), iw: DRAW.bgImg && DRAW.bgImg.naturalWidth };
});
check('uploading a photo puts it on the canvas', cv.img, JSON.stringify(cv));
check('…and the canvas takes the photo’s shape — no dead space below a wide photo',
  Math.abs(cv.h / cv.w - 800 / 1330) < 0.02, cv.w + '×' + cv.h + ' (photo is 1330×800)');

// ── a drawn, calibrated, panned-and-turned job ─────────────────────
await pg.evaluate(() => {
  DRAW.outline = [[300,200],[900,200],[900,600],[300,600]];
  DRAW.outlineDone = true;
  DRAW.lines = [{type:'ridge', pts:[[300,400],[900,400]], label:'', lengthM:'', measM:24, sheetLengthM:null}];
  DRAW.scaleMetresPerPx = 0.04; DRAW.calPitch = 20;
  DRAW.roofs = []; syncToRoofData && syncToRoofData();
  DRAW.zoom = 1.4; IMG_OFFSET = { x: 55, y: -32 };
  _setFineRotate(2.5);
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  S.currentJobId = 'job-bg-1';
  redrawAll();
  _qpStashRoofGeom(true);       // the quote publishes its map, aerial included
});
const snap = await pg.evaluate(() => {
  const s = snapshotCurrentJob();
  return {
    hasBg: !!(s.draw && s.draw.bg && /^data:image\/jpeg/.test(s.draw.bg)),
    bgW: s.draw.bgW, bgH: s.draw.bgH,
    view: s.draw.imgView,
    lkgHasPhoto: (localStorage.getItem('fr_lkg_job-bg-1') || '').indexOf('data:image') >= 0,
    quoteHasAerial: !!(S.quote.roofMapGeom && S.quote.roofMapGeom.bg),
    snap: s,
  };
});
check('the job snapshot now carries the photo', snap.hasBg);
check('…at its ORIGINAL pixel dimensions — the drawing is in image pixels',
  snap.bgW === 1330 && snap.bgH === 800, snap.bgW + '×' + snap.bgH);
check('…with the exact view the office left: zoom, pan and rotation',
  snap.view && snap.view.zoom === 1.4 && snap.view.offX === 55 && snap.view.offY === -32 && snap.view.rot === 2.5,
  JSON.stringify(snap.view));
check('the roof-map safety net in localStorage stays geometry-only',
  !snap.lkgHasPhoto, 'a photo per job would blow the LKG quota');
check('the quote stashed the aerial before "saving"', snap.quoteHasAerial);

// ── re-entry: a fresh page, the saved draft restored ───────────────
const pg2 = await mkPage();
await pg2.evaluate((s) => { gotoTab('roof'); restoreFromJob({ id: 'job-bg-1', draw_state: s }); }, snap.snap);
await pg2.waitForTimeout(1000);
const back = await pg2.evaluate(() => {
  const c = document.getElementById('roofCanvas');
  const r = c.getBoundingClientRect();
  return {
    img: !!(DRAW.bgImg && DRAW.bgImg.naturalWidth),
    iw: DRAW.bgImg && DRAW.bgImg.naturalWidth, ih: DRAW.bgImg && DRAW.bgImg.naturalHeight,
    zoom: DRAW.zoom, off: IMG_OFFSET, rot: window.IMG_FINE_ROTATION,
    canvasAspect: r.height / r.width,
    outline: DRAW.outline.length, quoteAerial: !!(S.quote.roofMapGeom && S.quote.roofMapGeom.bg),
  };
});
check('re-entering the draft brings the canvas photo back', back.img, JSON.stringify(back));
check('…full size, so every roof lands where it was drawn',
  back.iw === 1330 && back.ih === 800, back.iw + '×' + back.ih);
check('…with the same zoom', back.zoom === 1.4, String(back.zoom));
check('…the same pan', back.off && back.off.x === 55 && back.off.y === -32, JSON.stringify(back.off));
check('…and the same rotation, slider included', back.rot === 2.5, String(back.rot));
check('…and the canvas is shaped for the photo again',
  Math.abs(back.canvasAspect - 800 / 1330) < 0.02, String(back.canvasAspect));
check('the drawing itself came through untouched', back.outline === 4);
check('the quote’s aerial came back with the job', back.quoteAerial);

// ── the second half: a re-render must not wipe the quote aerial ────
// This is what killed it even when the quote HAD the aerial saved: the
// pricing map re-stashes with the background off, and a freshly reloaded
// canvas has no photo yet.
const wiped = await pg2.evaluate(() => {
  const before = S.quote.roofMapGeom.bg.length;
  const savedView = JSON.stringify(S.quote.roofMapGeom.view);
  const img = DRAW.bgImg;
  DRAW.bgImg = null;                       // the photo is still decoding…
  _qpStashRoofGeom(false);                 // …and the pricing map re-stashes
  const g1 = S.quote.roofMapGeom;
  _qpStashRoofGeom(true);                  // and again with the background wanted
  const g2 = S.quote.roofMapGeom;
  DRAW.bgImg = img;
  return {
    stillThere: !!(g1.bg && g2.bg),
    sameBytes: g2.bg && g2.bg.length === before,
    viewKept: JSON.stringify(g2.view) === savedView,
  };
});
check('a re-render with no live photo carries the stashed aerial forward',
  wiped.stillThere, 'the first proposal render after reload used to wipe it');
check('…byte-for-byte', wiped.sameBytes);
check('…framing included', wiped.viewKept);

// ── no leak the other way ──────────────────────────────────────────
const leak = await pg2.evaluate(() => {
  restoreFromJob({ id: 'job-empty', draw_state: { draw: { outline: [], lines: [], roofs: [] }, state: {} } });
  return { img: !!DRAW.bgImg, zoom: DRAW.zoom, rot: window.IMG_FINE_ROTATION };
});
check('opening a job with no photo clears the previous job’s photo',
  !leak.img && leak.zoom === 1 && leak.rot === 0, JSON.stringify(leak));

// ── "Use on canvas" from the job photos panel ──────────────────────
// It stored the photo and set the little preview — and never touched the
// canvas. Same family as #26, caught while fixing it.
const useOn = await pg2.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 700;
  c.getContext('2d').fillStyle = '#888'; c.getContext('2d').fillRect(0,0,1000,700);
  S.photos = [{ src: c.toDataURL('image/jpeg', 0.8) }];
  _jobPhotoUseAsBg(0);
  await new Promise(r => setTimeout(r, 600));
  return { img: !!(DRAW.bgImg && DRAW.bgImg.naturalWidth === 1000) };
});
check('"Use on canvas" actually puts the photo on the canvas', useOn.img);

check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
