// "can you clear the background image on the canvas along with the lines when
//  i click the clear button. also when I'm in an existing job then i click to
//  change jobs or start a new job it carrys through the back ground image
//  into the new job"
//
// One cause for both. Clear wiped the drawing and left the aerial sitting
// there — which is not what "clear everything" means — and because every
// start-a-new-job path goes through clearAll(), the previous job's aerial was
// still on the canvas of the new one. Those paths already cleared S.img64,
// the saved preview; nothing cleared DRAW.bgImg, which is the picture
// actually being drawn.
//
// The view matters as much as the picture: a pan, a zoom or a rotation left
// over from the last photo puts the next one on at the wrong angle, and the
// scale has been broken twice by less.
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
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/settings/.test(r.request().url())) return j({ user_id:'u1',
    branding:{ company_name:'Flood Roofing LTD' }, quote_defaults:{}, jms_keys:{} });
  // GET /jobs is the LIST — answering it with an object throws inside the
  // app and that error is the suite's own fault, not the app's.
  if (/\/jobs/.test(r.request().url()))
    return j(r.request().method() === 'GET' ? [] : { id:'j-new' });
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// A job with an aerial on it, panned, zoomed and rotated the way a roofer
// leaves one after lining a photo up.
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function loadPhoto(){
  return pg.evaluate((src) => new Promise((ok) => {
    const im = new Image();
    im.onload = function(){
      DRAW.bgImg = im; S.img64 = src;
      DRAW.zoom = 3.4; IMG_OFFSET = { x: 120, y: -40 }; IMG_ROTATION = 90;
      DRAW.outline = [[10,10],[90,10],[90,70],[10,70]];
      DRAW.outlineDone = true;
      DRAW.lines = [{ type:'ridge', a:[10,10], b:[90,10] }];
      window._aerialLoadedAddr = '3687 State Highway 12';
      try { redrawAll(); } catch(e){}
      ok(true);
    };
    im.src = src;
  }), PIX);
}
const state = () => pg.evaluate(() => ({
  bg: !!DRAW.bgImg, img64: !!(window.S && S.img64), zoom: DRAW.zoom,
  off: IMG_OFFSET, rot: IMG_ROTATION, fine: (typeof IMG_FINE_ROTATION === 'number' ? IMG_FINE_ROTATION : 0),
  outline: DRAW.outline.length, lines: DRAW.lines.length,
  addr: window._aerialLoadedAddr || null,
}));

await loadPhoto();
let v = await state();
check('the job starts with an aerial on it, panned and turned',
  v.bg && v.zoom === 3.4 && v.rot === 90 && v.outline === 4, JSON.stringify(v));

// ── the Clear button ──
await pg.evaluate(() => clearAll());
await pg.waitForTimeout(200);
v = await state();
check('Clear takes the background image off with the lines', !v.bg, JSON.stringify(v));
check('…and the outline and lines with it', v.outline === 0 && v.lines === 0, JSON.stringify(v));
check('…and forgets the saved preview too, so it cannot come back on a save',
  !v.img64, JSON.stringify(v));
check('…and puts the view back square — no pan, zoom or rotation left over',
  v.zoom === 1 && v.off.x === 0 && v.off.y === 0 && v.rot === 0 && v.fine === 0, JSON.stringify(v));
check('…and forgets which address the aerial was for', v.addr == null, String(v.addr));

// ── starting a new job ──
await loadPhoto();
check('the aerial is back for the next part', (await state()).bg);
await pg.evaluate(() => startNewJob());
await pg.waitForTimeout(600);
v = await state();
check('starting a new job does not carry the last job\'s aerial into it',
  !v.bg && !v.img64, JSON.stringify(v));
check('…and starts on a clean canvas', v.outline === 0 && v.lines === 0, JSON.stringify(v));
check('…at a square view', v.zoom === 1 && v.rot === 0, JSON.stringify(v));

// ── and the other new-job path ──
await pg.evaluate(() => { const m = document.getElementById('jobDetailsModal'); if (m) m.style.display = 'none'; });
await loadPhoto();
await pg.evaluate(() => newJob());
await pg.waitForTimeout(600);
v = await state();
check('the same on the other way in to a new job', !v.bg && !v.img64, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
