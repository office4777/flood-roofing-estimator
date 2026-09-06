// Records tools/demo/slideshow.html to a video by playing it through once in
// Playwright, which writes WebM with its own bundled ffmpeg.
//
//   node floodroofing/tools/demo-shots.mjs
//   node floodroofing/tools/demo-slideshow.mjs
//   node floodroofing/tools/demo-record.mjs
//
// WebM, not MP4, and not by choice: the bundled ffmpeg is built
// --disable-everything with a short allow-list (muxers webm + image2,
// encoders libvpx_vp8 + png, filters pad/crop/scale). No H.264, no fade, no
// drawtext, no concat — so the transitions and captions are done by the
// browser and the encode is left to Playwright. Anyone who needs MP4 for a
// website or social converts it locally.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { readdir, rename, rm, mkdir, stat } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'demo', 'slideshow.html');
const DIR = join(HERE, 'demo', 'video');
const OUT = join(HERE, 'demo', 'roofmap-demo.webm');

await rm(DIR, { recursive: true, force: true });
await mkdir(DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: DIR, size: { width: 1920, height: 1080 } },
});
const pg = await ctx.newPage();
await pg.goto('file://' + SRC);

// Read the run time out of the deck itself rather than hard-coding it, so
// re-timing the captions re-times the recording.
const secs = await pg.evaluate(() => Array.from(document.querySelectorAll('.slide'))
  .reduce((a, s) => a + (+s.dataset.secs || 6), 0));
console.log('playing ' + secs + 's…');
// Every image is inline base64, so this is decode time, not network.
await pg.waitForFunction(() => Array.from(document.images).every(i => i.complete), null, { timeout: 30000 })
  .catch(() => {});
await pg.waitForTimeout((secs + 2) * 1000);

await ctx.close();                 // the video is only flushed on close
await browser.close();

const files = (await readdir(DIR)).filter(f => f.endsWith('.webm'));
if (!files.length) { console.error('no video was written'); process.exit(1); }
await rename(join(DIR, files[0]), OUT);
await rm(DIR, { recursive: true, force: true });
const mb = ((await stat(OUT)).size / 1048576).toFixed(1);
console.log('wrote ' + OUT + '  ' + mb + ' MB, about ' + secs + 's');
