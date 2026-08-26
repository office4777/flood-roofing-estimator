// Renders tools/og-card.html to frontend/brand/og-card.png at exactly
// 1200×630 — the size Facebook, LinkedIn, Slack and X all want for a large
// link preview.
//
// The PNG is committed, so nothing about the deploy depends on this script.
// It exists so the card can be regenerated from source when the wording
// changes, rather than being a binary nobody can edit.
//
//   node floodroofing/tools/build-og-card.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'og-card.html');
const OUT = join(HERE, '..', 'frontend', 'brand', 'og-card.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,          // 1200×630 exactly — not a 2× image scaled down
});
await page.goto('file://' + SRC);
// Let the background photo and the icon decode before the shutter.
await page.waitForFunction(() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0));
await page.waitForTimeout(250);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();

// Squeeze it. The design is flat navy, one accent and white text over a
// darkened photo, so a 256-colour palette holds it with no visible banding
// and takes the file from ~426 KB to ~260 KB. Worth doing: the card is
// fetched by every scraper that sees a shared link, and by every person who
// sees the preview.
const { execFileSync } = await import('node:child_process');
const before = (await import('node:fs')).statSync(OUT).size;
try {
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(OUT)}).convert('RGB')
im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(${JSON.stringify(OUT)}, optimize=True)
`]);
  const after = (await import('node:fs')).statSync(OUT).size;
  console.log('wrote', OUT, `${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`);
} catch (e) {
  // Pillow missing is not a reason to fail — the uncompressed card is still
  // a correct 1200×630 PNG, just fatter.
  console.log('wrote', OUT, `${Math.round(before / 1024)} KB (not compressed — Pillow unavailable)`);
}
