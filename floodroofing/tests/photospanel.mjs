// The photos pop-out on the Map Roof tab used to open at 40vw — the same
// default as the pricing and maps pop-outs. On a wide monitor that put half
// the screen of site photos next to a roof plan squeezed into a strip, which
// is backwards: the photos are the reference, the drawing is the work.
//
// So this one starts narrow (a quarter of the window, capped at 520px) while
// the other two keep the wide default they need. What must NOT change is the
// shared sizing: drag any edge and all three still match, because --sidepop-w
// overrides every panel's own fallback.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

async function boot(width, seedWidth){
  const ctx = await b.newContext({ viewport:{ width, height:1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript((w) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */
    localStorage.setItem('fr_settings','null');
    // A fresh account has never dragged the edge — that's the case under test.
    localStorage.removeItem('fr_sidepop_w');
    localStorage.removeItem('fr_fergus_panel_w');
    if (w) localStorage.setItem('fr_sidepop_w', w);
  }, seedWidth || '');
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2600);
  await pg.evaluate(() => { gotoTab('roof'); _fergusPanelOpen(true); });
  await pg.waitForTimeout(700);
  return { ctx, pg };
}
// The maps and pricing pop-outs live inside tabs that aren't showing, so a
// bounding rect reads 0 for them. The computed width is the honest number —
// vw units and clamp() are both resolved to px at computed-value time.
const widths = (pg) => pg.evaluate(() => {
  const w = id => { const e = document.getElementById(id); return e ? Math.round(parseFloat(getComputedStyle(e).width)) : -1; };
  return { photos:w('fergusRoofPanel'), maps:w('jpMapPanel'), pricing:w('quotePricingPanel'), vw:window.innerWidth };
});

// ── a wide desk monitor: the case that prompted this ──────────────────
let { ctx, pg } = await boot(2000);
let v = await widths(pg);
check('the photos pop-out no longer opens at 40% of a wide screen',
  v.photos < v.vw * 0.30, v.photos + 'px of ' + v.vw);
check('…it opens at a quarter of the window, capped at 520px',
  v.photos > 460 && v.photos <= 520, v.photos + 'px');
check('…leaving the roof plan the majority of the screen',
  v.vw - v.photos > v.vw * 0.7, (v.vw - v.photos) + 'px for the canvas');
check('…while the pricing pop-out keeps its wide default',
  v.pricing > v.vw * 0.35, v.pricing + 'px');
await pg.screenshot({ path: S+'/photospanel_2000.png' });
await ctx.close();

// ── a laptop: a quarter of 1440 is 360px, and the two capture buttons
//    still have to sit side by side without wrapping ──────────────────
({ ctx, pg } = await boot(1440));
v = await widths(pg);
check('on a laptop it scales down rather than sitting at a fixed width',
  v.photos > 320 && v.photos < 400, v.photos + 'px of ' + v.vw);
const btns = await pg.evaluate(() => {
  const s = document.getElementById('jobPhotosSec');
  // The capture buttons only — the section has since grown a files row with
  // its own button, which is not part of this check. Hidden ones are excluded
  // by offsetParent: Rapid photos drives the in-app camera and is site-only,
  // so in the office there is one capture button, not two.
  const bs = s ? [...s.querySelectorAll('button')]
    .filter(b => /Rapid photos|From gallery/.test(b.textContent))
    .filter(b => b.offsetParent !== null) : [];
  const r = bs.map(x => x.getBoundingClientRect());
  return { n: bs.length, labels: bs.map(x => x.textContent.trim()),
           sameRow: r.length < 2 || Math.abs(r[0].top - r[1].top) < 2,
           clipped: bs.some(x => x.scrollWidth > x.clientWidth + 1) };
});
check('…and the capture buttons stay on one row, untruncated',
  btns.n >= 1 && btns.sameRow && !btns.clipped, JSON.stringify(btns));
check('…with Rapid photos NOT offered in the office — there is no camera to point',
  btns.n === 1 && /gallery/i.test(btns.labels[0] || ''), btns.labels.join(' | '));
await ctx.close();

// ── a narrow window: the clamp floor stops it collapsing ─────────────
({ ctx, pg } = await boot(1100));
v = await widths(pg);
check('a narrow window hits the 320px floor instead of shrinking to nothing',
  v.photos === 320, v.photos + 'px of ' + v.vw);
await ctx.close();

// ── a sizing the user has already chosen still wins, for all three ────
({ ctx, pg } = await boot(2000, '700px'));
v = await widths(pg);
check('a width the user dragged still overrides the default',
  v.photos === 700, v.photos + 'px');
check('…and still applies to all three pop-outs together',
  v.photos === 700 && v.maps === 700 && v.pricing === 700, JSON.stringify(v));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
