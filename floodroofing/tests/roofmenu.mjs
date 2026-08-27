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

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
