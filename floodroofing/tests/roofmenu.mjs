// Decluttering the Map Roof tab.
//
// Two things took up the top third of the screen on a phone and earned none
// of it. The "Auto-generate roof lines from outline" panel sat open the whole
// time to show controls you touch once per roof — roof type, rotate, clear
// lines — and the dark "Select & edit" banner sat under it restating what
// clicking a line does, permanently, because Select is the tool you are in
// whenever you are not doing something else. It also promised a drag that
// never shipped.
//
// The panel is now what a roof's own button drops down, one button per roof.
// What this must NOT become is the roof picker that was taken off this canvas
// once before (see the note by _nthName): six chips crowded the toolbar and
// picking one HID the other five, which is useless while you are measuring a
// building. So the hard assertion here is that every roof stays drawn.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { outline:(r.outline||[]).map(p => p.slice()), lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = 0;
  try { redrawAll(); } catch(e){}
  gotoTab('roof');
  setTool('select');
  renderRoofSwitcher();
}, GEOM);
await pg.waitForTimeout(900);

const look = () => pg.evaluate(() => {
  const bar = document.getElementById('roofMenuBar');
  const panel = document.getElementById('roofTypePanel');
  const step = document.getElementById('stepIndicator');
  const btns = bar ? [...bar.querySelectorAll('button')] : [];
  const shown = e => !!(e && e.offsetParent !== null);
  return {
    barShown: shown(bar), buttons: btns.length,
    labels: btns.map(x => x.textContent.replace(/[▴▾]/g,'').trim()),
    panelShown: shown(panel),
    stepShown: shown(step),
    stepText: step ? step.textContent.replace(/\s+/g,' ').trim() : '',
    active: DRAW.activeRoofIdx,
    showAll: DRAW.showAllRoofs,
  };
});

// ── the banner is gone in the tool you sit in ─────────────────────
let v = await look();
check('the Select & edit banner is gone on the default tool',
  !v.stepShown, v.stepShown ? v.stepText.slice(0,70) : 'hidden');
check('…and it took its stale "drag to move (coming soon)" with it',
  !/coming soon/i.test(v.stepText), v.stepText.slice(0,60) || 'no banner');

// …but real step guidance still appears when you are mid-task.
await pg.evaluate(() => setTool('outline'));
await pg.waitForTimeout(300);
v = await look();
check('drawing an outline still tells you what to do',
  v.stepShown && /clockwise/i.test(v.stepText), v.stepText.slice(0,72));
await pg.evaluate(() => setTool('select'));
await pg.waitForTimeout(300);
v = await look();
check('…and the banner goes away again the moment you stop', !v.stepShown);

// ── one button per roof, panel shut ───────────────────────────────
check('there is a button for every roof', v.buttons === 6, v.buttons + ' buttons');
check('…named after the roofs', /Roof|Main/i.test(v.labels[0] || ''), v.labels.join(' | '));
check('the auto-generate panel is shut until asked for', !v.panelShown);

// ── a roof button opens that roof's menu ──────────────────────────
await pg.evaluate(() => _toggleRoofMenu(2));
await pg.waitForTimeout(400);
v = await look();
check('tapping a roof opens its menu', v.panelShown);
check('…and that roof is the one a new line would join', v.active === 2, 'active=' + v.active);
// The whole reason the old picker was removed.
check('…while every roof stays on the canvas', v.showAll === true, 'showAllRoofs=' + v.showAll);

// ── tapping the open one closes it ────────────────────────────────
await pg.evaluate(() => _toggleRoofMenu(2));
await pg.waitForTimeout(300);
v = await look();
check('tapping the same roof again puts the menu away', !v.panelShown);
check('…and does not change which roof you are on', v.active === 2, 'active=' + v.active);

// ── moving between roofs re-points the menu, not closes it ────────
await pg.evaluate(() => { _toggleRoofMenu(1); });
await pg.waitForTimeout(300);
await pg.evaluate(() => { _toggleRoofMenu(4); });
await pg.waitForTimeout(400);
v = await look();
check('moving to another roof keeps the menu up, pointed at the new one',
  v.panelShown && v.active === 4, 'shown=' + v.panelShown + ' active=' + v.active);

// ── clicking a roof on the CANVAS must not fling the menu open ────
await pg.evaluate(() => { _toggleRoofMenu(4); });          // shut it
await pg.waitForTimeout(250);
await pg.evaluate(() => switchToRoof(0));
await pg.waitForTimeout(400);
v = await look();
check('choosing a roof on the canvas leaves the menu shut',
  !v.panelShown && v.active === 0, 'shown=' + v.panelShown + ' active=' + v.active);

// ── the bar must survive switching to a roof saved without outlineDone ──
// It used to be gated on DRAW.outlineDone, which _loadRoofToCurrent overwrites
// per roof — so landing on such a roof took away the very buttons you would
// use to get back off it.
await pg.evaluate(() => { DRAW.roofs.forEach(r => { delete r.outlineDone; }); });
await pg.evaluate(() => _toggleRoofMenu(3));
await pg.waitForTimeout(400);
v = await look();
check('the roof bar survives a roof saved without the outline flag',
  v.barShown && v.buttons === 6, 'shown=' + v.barShown + ' buttons=' + v.buttons);

// ── nothing drawn yet: no bar to show ─────────────────────────────
await pg.evaluate(() => { DRAW.roofs = []; DRAW.outline = []; DRAW.outlineDone = false;
  renderRoofSwitcher(); updateStepUI(); });
await pg.waitForTimeout(300);
v = await look();
check('with nothing drawn there is no roof bar at all', !v.barShown);

// ── THE ROOF'S SETTINGS COME TO YOU (2026-10-12) ──────────────────
// The owner on roof 7 of a real job: "i need to rotate the roof 90deg,
// however i don't think it easy to tell how to do this". The panel was a
// dropdown behind a 9px arrow on a roof button, and opening it shoved the
// toolbars and the canvas down the page. It is now an overlay that slides
// down by itself a second after the roof is drawn -- when Rotate 90° is
// exactly what a roofer reaches for next -- with a full-width way out.
const reveal = await pg.evaluate(async () => {
  const out = {}, rtp = () => document.getElementById('roofTypePanel');
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[300,300],[700,300],[700,560],[300,560]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.03;
  out.position = getComputedStyle(rtp()).position;
  await new Promise(r => setTimeout(r, 200));
  rtp().style.display = 'none';
  const ok = document.querySelector('#_rsModal #_rsOk');
  out.hadPopup = !!ok;
  if (ok) ok.click();
  out.straightAfter = rtp().style.display;
  await new Promise(r => setTimeout(r, 1300));
  out.afterDelay = rtp().style.display;
  out.slid = /rtp-anim/.test(rtp().className);
  const close = rtp().querySelector('.rtp-close');
  out.closeTxt = close ? close.textContent.replace(/\s+/g, ' ').trim() : '';
  const span = (document.querySelector('#roofMenuBar button') || {}).querySelector
    ? document.querySelector('#roofMenuBar button').querySelector('span') : null;
  out.arrow = span ? span.textContent : '';
  out.arrowPx = span ? parseFloat(getComputedStyle(span).fontSize) : 0;
  if (close) close.click();
  out.afterClose = rtp().style.display;
  // Never over a walkthrough — the tour, the first-roof steps and the coach
  // all run through the same engine, so TOUR.open covers all three.
  TOUR.open = true; _roofPanelReveal();
  out.duringTour = rtp().style.display;
  TOUR.open = false; _roofPanelReveal();
  out.afterTour = rtp().style.display;
  // NARROWER THAN THE PAGE (2026-10-14, the owner: "it doesn't need to be the
  // full width it is"). Anchored left and sized to its own row.
  out.panelW = Math.round(rtp().getBoundingClientRect().width);
  out.viewW = window.innerWidth;
  out.openDur = getComputedStyle(rtp()).animationDuration;
  return out;
});
check('the roof settings panel OVERLAYS the page instead of shoving it down',
  reveal.position === 'absolute', reveal.position);
check('…and is only as wide as its own row, not the whole page',
  reveal.panelW > 0 && reveal.panelW <= 1100 && reveal.panelW < reveal.viewW - 100,
  JSON.stringify({ panel: reveal.panelW, view: reveal.viewW }));
check('…opening over half a second, so it reads as a panel arriving',
  reveal.openDur === '0.5s', reveal.openDur);
check('it stays shut as the roof is drawn…',
  reveal.hadPopup && reveal.straightAfter === 'none', JSON.stringify(reveal));
check('…then slides down by itself a second later',
  reveal.afterDelay === 'block' && reveal.slid === true,
  JSON.stringify({ shown: reveal.afterDelay, slid: reveal.slid }));
check('…with a full-width way out carrying an up arrow',
  /\u25B4/.test(reveal.closeTxt) && /close roof settings/i.test(reveal.closeTxt),
  reveal.closeTxt);
check('…which shuts it', reveal.afterClose === 'none', reveal.afterClose);
check('the arrow on a roof button is big enough to read — it was 9px',
  reveal.arrowPx >= 12, reveal.arrowPx + 'px ' + reveal.arrow);
check('and it NEVER slides over a walkthrough',
  reveal.duringTour === 'none' && reveal.afterTour === 'block',
  JSON.stringify({ during: reveal.duringTour, after: reveal.afterTour }));

// AND IT PUTS ITSELF AWAY TWO SECONDS AFTER THE LAST PRESS (2026-10-18, the
// owner: "now make it auto close 2 seconds after the final click on any of the
// buttons inside that box (timer restarts on each click)"). The reveal's three
// seconds are for reading the row; once Rotate 90° has been pressed the roofer
// is done with the panel and it is over the drawing again.
const bump = await pg.evaluate(async () => {
  const out = {}, rtp = () => document.getElementById('roofTypePanel');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const press = () => {
    const b = [...rtp().querySelectorAll('button')]
      .find(x => /Rotate 90/.test(x.textContent) && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  };
  // A fresh automatic reveal, then the pointer arrives — which drops the
  // three seconds, as it always has (a panel must not shut while you reach).
  rtp().style.display = 'none';
  _roofPanelReveal();
  rtp().dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  await sleep(1400);
  out.heldByPointer = rtp().style.display;

  out.pressed = press();
  await sleep(1100);
  out.at1_1s = rtp().style.display;          // 2s has not run out yet
  await sleep(1900);
  out.at3_0s = rtp().style.display;          // 2s + the half-second fold

  // EVERY PRESS RESTARTS IT: two presses 1.4 s apart leave it open past the
  // moment one press alone would have folded it.
  rtp().style.display = 'none';
  _roofPanelReveal();
  rtp().dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  press(); await sleep(1400);
  press(); await sleep(1400);
  out.restarted = rtp().style.display;
  await sleep(1400);
  out.afterRestart = rtp().style.display;

  // A FIELD BEING TYPED IN KEEPS IT OPEN. Two seconds between keystrokes is
  // an ordinary pause when you are reading a pitch off a plan.
  rtp().style.display = 'none';
  _roofPanelReveal();
  const pitch = document.getElementById('calPitchInput') ||
                rtp().querySelector('input[type="number"], input[type="text"]');
  out.hadField = !!pitch;
  if (pitch) pitch.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await sleep(2800);
  out.whileTyping = rtp().style.display;

  // OPENED BY HAND, IT STAYS. A press inside a panel the roofer opened does
  // not start the two seconds — that one is theirs until they close it.
  rtp().style.display = 'none';
  _toggleRoofMenu(DRAW.activeRoofIdx);
  out.handOpened = rtp().style.display;
  press();
  await sleep(2900);
  out.handStill = rtp().style.display;
  return out;
});
check('the pointer arriving still drops the reveal’s three seconds',
  bump.heldByPointer === 'block', JSON.stringify(bump));
check('a press on a button inside starts a TWO second put-away…',
  bump.pressed && bump.at1_1s === 'block', JSON.stringify(bump));
check('…and it has folded itself away by then',
  bump.at3_0s === 'none', JSON.stringify(bump));
check('every press restarts the two seconds, so a run of them is never cut short',
  bump.restarted === 'block' && bump.afterRestart === 'none',
  JSON.stringify({ at2_8s: bump.restarted, after: bump.afterRestart }));
check('a field being typed in keeps the panel open',
  bump.hadField && bump.whileTyping === 'block', JSON.stringify(bump));
check('a panel opened BY HAND is never closed by a press inside it',
  bump.handOpened === 'block' && bump.handStill === 'block', JSON.stringify(bump));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
