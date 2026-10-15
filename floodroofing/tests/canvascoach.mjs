// THE CANVAS COACH (2026-10-12, the owner): after a satellite image or an
// uploaded picture lands on the canvas, the first action is not the outline —
// it is centring the picture. "a big pop-up should appear saying 'drag the
// roof to centre it', that window should disapear when the user clicks the
// image to start the drag, then when the user releases the drag, wait 1 sec
// then appear another that points to the zoom + button ... then wait 1 sec
// after the final click on either of the zoom buttons (restart timer every
// click) then pop-up window pointing at the rotate image slider bar to square
// the building then change the wording as soon as they click the slider bar
// ... which that box disapears after 2second after releasing the click button,
// then only once that is done, appear another window pointing at the building
// outline (only if there isn't any outlines drawn yet) that say 'now outline
// your Roof'. these should appear all the time except when in any tutorial or
// guide or onboarding mode".
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(); const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_site_mode','off');
  localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });

// A picture lands on the canvas, exactly as a satellite capture or an upload
// does — through the one function that puts a picture under the drawing.
const PIC = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#8aa"/></svg>').toString('base64');
const place = async () => pg.evaluate(async (src) => {
  clearAll(true);
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
  _applyCanvasBg(img);                 // no stored view = a fresh import
}, PIC);
const card = async () => pg.evaluate(() => {
  const w = document.getElementById('ccWrap');
  if (!w) return { on: false };
  const vis = w.style.display !== 'none';
  const ring = w.querySelector('#ccRing');
  const r = (ring && ring.style.display !== 'none') ? ring.getBoundingClientRect() : null;
  const near = (sel) => { const e = document.querySelector(sel); if (!e || !r) return false;
    const b = e.getBoundingClientRect(); return Math.abs(b.left - r.left) < 20 && Math.abs(b.top - r.top) < 20; };
  return { on: true, vis, step: CC.step, big: w.querySelector('#ccCard').classList.contains('cc-big'),
           title: w.querySelector('.cc-title').textContent,
           onZoom: near('#zoomInBtn'), onRot: near('#fineRotateSlider'), onOutline: near('#btn-outline'),
           onFine: near('#rotImgFine'),
           tool: DRAW.tool };
});

await place();
await pg.waitForTimeout(450);
const s1 = await card();
check('a fresh picture opens with the big "drag the roof to centre it" card',
  s1.on && s1.vis && s1.step === 'move' && s1.big && /centre it/i.test(s1.title), JSON.stringify(s1));
check('…and the Move tool is picked, because a drag only pans in Move', s1.tool === 'select', s1.tool);

// the drag: pressing hides it, releasing starts the one-second wait
// a point on the canvas that is actually in the window (the canvas is taller
// than the viewport) and clear of the card
const cvBox = await pg.evaluate(() => {
  const c = document.getElementById('roofCanvas').getBoundingClientRect();
  const card = document.getElementById('ccCard').getBoundingClientRect();
  const y = Math.min(Math.max(c.top + 30, card.bottom + 30), window.innerHeight - 30);
  return { x: Math.min(c.left + 120, window.innerWidth - 40), y: y };
});
await pg.mouse.move(cvBox.x, cvBox.y);
await pg.mouse.down();
await pg.waitForTimeout(80);
const s2 = await card();
check('pressing on the picture to drag takes the card away', s2.on && !s2.vis, JSON.stringify(s2));
await pg.mouse.move(cvBox.x + 70, cvBox.y + 40, { steps: 6 });
await pg.mouse.up();
await pg.waitForTimeout(300);
const s2b = await card();
check('…and it stays away while the second is still a second off', !s2b.vis, JSON.stringify(s2b));
await pg.waitForTimeout(950);
const s3 = await card();
check('A SECOND AFTER THE DRAG, the zoom card points at the + button',
  s3.vis && s3.step === 'zoom' && s3.onZoom && /zoom in/i.test(s3.title), JSON.stringify(s3));

// zooming: each click restarts the wait
await pg.click('#zoomInBtn');
await pg.waitForTimeout(120);
const s4 = await card();
check('one click on zoom takes it away', !s4.vis, JSON.stringify(s4));
await pg.waitForTimeout(700);
await pg.click('#zoomInBtn');                     // a second click restarts the timer
await pg.waitForTimeout(700);
const s5 = await card();
check('…and a second click restarts the wait rather than letting the next one in', !s5.vis, JSON.stringify(s5));
await pg.waitForTimeout(600);
const s6 = await card();
check('A SECOND AFTER THE LAST ZOOM, the rotate card points at the slider',
  s6.vis && s6.step === 'rotate' && s6.onRot && /square/i.test(s6.title), JSON.stringify(s6));

// the slider: the wording changes the moment it is touched
await pg.evaluate(() => { _ccOn('rotdown'); });
await pg.waitForTimeout(80);
const s7 = await card();
check('touching the slider changes the wording to "outlines work best when building is square"',
  /work best when building is square/i.test(s7.title), s7.title);
await pg.evaluate(() => { _rotImgOpen(); _setFineRotate(6); _ccOn('rotup'); });
await pg.waitForTimeout(500);
const s8 = await card();
check('…and it is still there half a second after letting go (it waits one)', s8.vis && s8.step === 'rotate', JSON.stringify(s8));
// A STEP BETWEEN THE SLIDER AND THE OUTLINE (2026-10-13, the owner: "after
// the user slides the rotate bar across ... have a 1 second delay then add a
// step to click the fine rotate adjustments, 2 seconds after the final
// adjustment (timer restarts on every click) then do step 4").
await pg.waitForTimeout(800);
const s8b = await card();
check('A SECOND AFTER LETTING THE SLIDER GO, the card points at the fine adjustments',
  s8b.vis && s8b.step === 'fine' && s8b.onFine && /nudge it exactly square/i.test(s8b.title), JSON.stringify(s8b));
// The timer restarts on EVERY nudge, so a run of clicks is not cut short.
await pg.evaluate(() => _nudgeFineRotate(0.1));
await pg.waitForTimeout(1300);
const s8c = await card();
check('…and a nudge holds it: 1.3s after the first click it is still the fine card', s8c.vis && s8c.step === 'fine', JSON.stringify(s8c));
await pg.evaluate(() => _nudgeFineRotate(0.1));
await pg.waitForTimeout(1300);
const s8d = await card();
check('…a second nudge restarts the two seconds rather than letting it run out', s8d.vis && s8d.step === 'fine', JSON.stringify(s8d));
await pg.waitForTimeout(1100);
const s9 = await card();
check('TWO SECONDS AFTER THE LAST NUDGE, the last card points at Building outline',
  s9.vis && s9.step === 'outline' && s9.onOutline && /outline your roof/i.test(s9.title), JSON.stringify(s9));
// "only show that build outline box for 4 second then make it disappear" —
// it asks for a click on a button that stays lit, so it says its piece and goes.
await pg.waitForTimeout(2000);
const s9b = await card();
check('…and it is still up two seconds later', s9b.vis && s9b.step === 'outline', JSON.stringify(s9b));
await pg.waitForTimeout(2600);
const s9c = await card();
check('FOUR SECONDS ON, the outline card takes itself away', !s9c.vis && !s9c.step, JSON.stringify(s9c));

// clicking the tool ends it
await place();
await pg.waitForTimeout(400);
await pg.click('#btn-outline');
await pg.waitForTimeout(150);
const s10 = await card();
check('picking Building outline is the end of it', !s10.on, JSON.stringify(s10));

// ── it comes back with the NEXT picture — every time, nothing remembered ──
await place();
await pg.waitForTimeout(450);
const again = await card();
check('THE TIPS COME BACK WITH THE NEXT PICTURE', again.on && again.vis && again.step === 'move', JSON.stringify(again));
// …but not over a picture that already has a roof drawn on it
await pg.evaluate(() => { _ccStop(); setTool('outline'); DRAW.currentPts = [[100,100],[400,100],[400,300],[100,300]]; finishCurrent(); });
await pg.waitForTimeout(300);
await pg.evaluate(() => { const m = document.getElementById('_rsModal'); if (m) m.remove(); });
const drawn = await pg.evaluate(() => { _ccStart(); return !!document.getElementById('ccWrap'); });
check('…and never over a picture that is already outlined', drawn === false);

// ── THE SATELLITE CAPTURE IS THE PATH HE WAS ON ──────────────────
// placeBlob sets DRAW.bgImg itself to skip a canvas conversion, so it never
// reaches _applyCanvasBg — the coach has to be started from the aerial's own
// hook or it misses the one case the owner actually described.
const aerial = await pg.evaluate(async (src) => {
  _ccStop();
  clearAll(true);
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
  DRAW.bgImg = img;                       // what placeBlob does
  DRAW.scaleMetresPerPx = 0.05;
  _afterAerialPlaced();                   // …and the hook it calls after it
  await new Promise(r => setTimeout(r, 1300));
  const w = document.getElementById('ccWrap');
  return { on: !!w, step: CC.step, tool: DRAW.tool,
           title: w ? w.querySelector('.cc-title').textContent : '' };
}, PIC);
check('A SATELLITE CAPTURE STARTS THE TIPS TOO', aerial.on && aerial.step === 'move' && /centre it/i.test(aerial.title), JSON.stringify(aerial));
check('…on the Move tool, so the drag it asks for actually pans', aerial.tool === 'select', aerial.tool);

// ── AND NOTHING ELSE DROPS OPEN OVER THE FIRST CARD ──────────────
// _afterAerialPlaced used to open the CANVAS VIEW menu by itself 350ms after
// a capture, from the days when the rotate control lived inside it. It landed
// straight over "Drag the roof to centre it" (the owner, 2026-10-15). The menu
// still opens on its own button, and only there.
const vm = await pg.evaluate(() => {
  const m = document.getElementById('viewMenu');
  const shut = !m || m.style.display !== 'block';
  toggleViewMenu(null);
  return { shut, byHand: m && m.style.display === 'block' };
});
check('the CANVAS VIEW menu stays shut after a capture', vm.shut === true, JSON.stringify(vm));
check('…and still opens when the button is pressed', vm.byHand === true, JSON.stringify(vm));
await pg.evaluate(() => closeViewMenu());

// ── and never on top of a tutorial, guide or walkthrough ─────────
const quiet = await pg.evaluate(() => {
  clearAll(true);
  const out = {};
  window.ONB = window.ONB || {}; ONB.active = 'tour';
  _ccStart(); out.onb = !!document.getElementById('ccWrap');
  ONB.active = null;
  window.TOUR = window.TOUR || {}; TOUR.open = true;
  _ccStart(); out.tour = !!document.getElementById('ccWrap');
  TOUR.open = false;
  return out;
});
check('nothing shows while a walkthrough holds the onboarding arbiter', quiet.onb === false, JSON.stringify(quiet));
check('…nor while the tutorial or a guide is open', quiet.tour === false, JSON.stringify(quiet));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
