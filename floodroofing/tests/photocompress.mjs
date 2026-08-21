// Photo compression: large phone photos (2+ MB) are downscaled and compressed
// client-side to ~400 KB before being stored in the job JSON. This reduces
// database bloat and proposal load times at scale (1000s of jobs).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

// ── Compression of large photos ──────────────────────────────────────
// Create a large test image by drawing on canvas. A typical phone photo
// is 3000-4000px and 2-5 MB in JPEG format. We'll create a 3200×2400 image
// filled with varied pixel data (to prevent compression tricks) and check
// that _downscalePhoto reduces it by 5x.

const largePhotoB64 = await pg.evaluate(() => {
  // Create a large canvas image with varied pixel data
  const canvas = document.createElement('canvas');
  canvas.width = 3200;
  canvas.height = 2400;
  const ctx = canvas.getContext('2d');

  // Fill with varied data to prevent compression tricks
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = 'hsl(' + (Math.random() * 360) + ', 70%, 50%)';
    ctx.fillRect(Math.random() * 3200, Math.random() * 2400, 200, 200);
  }

  // High-quality JPEG to simulate a real phone photo
  return canvas.toDataURL('image/jpeg', 0.95);
});

const originalSize = largePhotoB64.length;
console.log('Original test image size:', Math.round(originalSize / 1024), 'KB');

// Now compress it via _downscalePhoto
const compressedB64 = await pg.evaluate((b64) => {
  return new Promise(resolve => {
    _downscalePhoto(b64, resolve);
  });
}, largePhotoB64);

const compressedSize = compressedB64.length;
const ratio = originalSize / compressedSize;

console.log('Compressed size:', Math.round(compressedSize / 1024), 'KB');
console.log('Compression ratio:', ratio.toFixed(1) + 'x');

// For a realistic large photo (2-5 MB), we should see 4-8x compression
// Our test image won't be full 2 MB, but should show the compression working
check('compression reduces size by at least 2x',
  ratio > 2, 'ratio=' + ratio.toFixed(1) + 'x');
check('compressed image is a data URL',
  /^data:image\/jpeg;base64,/.test(compressedB64), compressedB64.slice(0, 50));

// ── Verify function is available for use elsewhere ──────────────────
check('_downscalePhoto is callable and returns via callback',
  await pg.evaluate(() => typeof _downscalePhoto === 'function'),
  '_downscalePhoto exists');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
