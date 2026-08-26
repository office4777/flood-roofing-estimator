// "I want to snap heaps of photos without waiting to tap OK."
//
// A file input with capture="environment" hands the job to the phone's own
// camera app, and that app insists on Use Photo / Retake after every shot.
// No flag turns that off — it is the OS. So the shutter here runs the camera
// inside the app: tap, the frame is written to the job, and the shutter is
// live again immediately. No confirm step exists to wait on.
//
// Chromium's fake device stands in for the camera.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch({ args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
                                 permissions:['camera'] });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_site_mode','on');
});
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2400);

await pg.evaluate(() => { gotoTab('roof'); S.photos = []; toggleRoofLinesMenu(); });
await pg.waitForTimeout(250);
let v = await pg.evaluate(() => {
  const el = document.getElementById('btn-rapidcam');
  return { there: !!el, shown: el ? getComputedStyle(el).display !== 'none' : false };
});
check('the site sheet offers rapid photos', v.there && v.shown);

await pg.evaluate(() => openRapidCamera());
await pg.waitForTimeout(1800);
v = await pg.evaluate(() => ({
  open: !!document.getElementById('rapidCam'),
  live: !!(CAM.stream && CAM.video && CAM.video.videoWidth > 0),
  shutter: !!document.getElementById('camShoot'),
  flip: !!document.getElementById('camFlip'),
}));
check('a live preview opens with a shutter', v.open && v.live && v.shutter,
  'stream=' + v.live);
check('…and a way to swap to the front camera', v.flip);

// ── the point of the whole thing: tap, tap, tap ───────────────────
for (let i = 0; i < 5; i++){
  await pg.evaluate(() => document.getElementById('camShoot').click());
  await pg.waitForTimeout(180);
}
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({ shots: CAM.shots, photos: (S.photos||[]).length,
                               stillOpen: !!document.getElementById('rapidCam'),
                               anyConfirm: !!document.querySelector('#rapidCam button[id*="confirm" i]') }));
check('five taps put five photos on the job', v.shots === 5 && v.photos === 5,
  v.shots + ' shots, ' + v.photos + ' photos');
check('…with no confirm step anywhere in the way', !v.anyConfirm && v.stillOpen);

v = await pg.evaluate(() => {
  const p = (S.photos||[])[0];
  return { isImg: /^data:image\//.test(p.src || ''), len: (p.src||'').length, cap: p.caption };
});
check('each one is a real image on the job', v.isImg && v.len > 500, v.len + ' bytes');
check('…with a caption field ready, like every other photo', v.cap === '');

v = await pg.evaluate(() => document.querySelectorAll('#camStrip img').length);
check('the last few show as thumbnails so you can see what you got', v > 0, v + ' thumbnails');

// ── done ──────────────────────────────────────────────────────────
await pg.evaluate(() => document.getElementById('camDone').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  gone: !document.getElementById('rapidCam'),
  stopped: !CAM.stream,
  photos: (S.photos||[]).length,
}));
check('Done closes the camera and releases it', v.gone && v.stopped,
  'closed=' + v.gone + ' released=' + v.stopped);
check('…and every photo stays on the job', v.photos === 5, v.photos + ' photos');

// ── a second session adds to the job, it does not replace it ──────
await pg.evaluate(() => openRapidCamera());
await pg.waitForTimeout(1500);
await pg.evaluate(() => document.getElementById('camShoot').click());
await pg.waitForTimeout(600);
await pg.evaluate(() => document.getElementById('camDone').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => (S.photos||[]).length);
check('a second session adds to what was already there', v === 6, v + ' photos');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
// ── and it is offered ONLY here ───────────────────────────────────
// Rapid photos drives the in-app camera: a phone or tablet held up at the
// roof. An office desktop has none worth pointing at anything, so the button
// used to offer something that could not work.
check('site mode offers Rapid photos', await pg.evaluate(() =>
  [...document.querySelectorAll('.rapidcam-btn')].some(b => b.offsetParent !== null)));
check('…and the office does not', await pg.evaluate(() => {
  document.documentElement.classList.remove('site-mode');
  const any = [...document.querySelectorAll('.rapidcam-btn')].some(b => b.offsetParent !== null);
  document.documentElement.classList.add('site-mode');
  return !any;
}));

await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
