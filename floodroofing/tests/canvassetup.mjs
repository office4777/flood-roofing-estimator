// "As soon as a roof outline is completed, can a pop-up appear and make the
//  user input the roof type so it auto-generates, and the roof's main material
//  (explain very shortly that clearlites can be added as a 'roof item'). Then
//  hide the roof type buttons into one button called 'Change roof type'. Also
//  change 'Add Roof Lines or Details' to 'Add items/details'. And I don't need
//  to select different roofs in the canvas — remove those buttons and always
//  be viewing all. There's a lot of buttons currently, I want it simplified."
//
// The toolbar had grown to seven coloured roof-type buttons, a roof-picker row
// carrying two controls per roof, and a sheet-material select on the far side
// of the bar — all competing with the drawing for attention, and all of it
// optional, so a roof could easily end up generated as the wrong shape or
// ordered in the wrong steel without anyone being asked.
//
// One question when the outline closes; one button afterwards to change your
// mind; no roof picker at all.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2700);

const draw = pts => pg.evaluate((p) => {
  setTool('outline'); DRAW.currentPts = p; finishCurrent();
}, pts);

// ── the popup, on the outline closing ──────────────────────────────
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); DRAW.scaleMetresPerPx = 0.02; });
await draw([[200,150],[560,150],[560,430],[200,430]]);
await pg.waitForTimeout(800);
let v = await pg.evaluate(() => {
  const m = document.getElementById('_rsModal');
  if (!m) return { popup:false };
  const t = m.innerText || '';
  return { popup:true, title:t.split('\n')[0],
           types:[...m.querySelectorAll('[data-rstype]')].map(x => x.getAttribute('data-rstype')),
           sheets:[...m.querySelectorAll('[data-rssheet]')].map(x => x.getAttribute('data-rssheet')),
           suggested:/SUGGESTED/.test(t),
           clearliteNote:/Clearlite sheet/.test(t) && /Add items\/details/.test(t),
           canSkip:!!m.querySelector('#_rsSkip') };
});
check('closing an outline asks what the roof is', v.popup, v.title || 'no popup');
check('…offering every roof shape the generator can build',
  v.types && v.types.join() === 'hip,gable,gable-hv,dutch,mono', (v.types||[]).join());
check('…and every sheet material',
  v.sheets && v.sheets.join() === 'steel-corrugate,steel-5rib,clearlite-5rib,clearlite-corrugate',
  (v.sheets||[]).join());
check('…with the footprint’s own suggestion already picked', v.suggested);
check('…saying briefly that a few clear sheets are added as an item instead',
  v.clearliteNote);
check('…and a way past it, since a popup you cannot dismiss is a trap', v.canSkip);

// Confirming draws the roof and sets the material.
await pg.evaluate(() => {
  document.querySelector('[data-rstype="gable"]').click();
  document.querySelector('[data-rssheet="steel-5rib"]').click();
  document.querySelector('#_rsOk').click();
});
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ type:DRAW.roofType, sheet:DRAW.sheetType,
  lines:(DRAW.lines||[]).length, gone:!document.getElementById('_rsModal') }));
check('answering it generates the roof lines', v.lines > 0 && v.type === 'gable',
  v.type + ', ' + v.lines + ' lines');
check('…and sets the sheet material for the roof', v.sheet === 'steel-5rib', v.sheet);
check('…and closes', v.gone);

// Skip leaves the roof alone rather than guessing.
await pg.evaluate(() => { _addAndSwitchToNewRoof(); });
await draw([[620,200],[820,200],[820,380],[620,380]]);
await pg.waitForTimeout(800);
await pg.evaluate(() => { const s = document.querySelector('#_rsSkip'); if (s) s.click(); });
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({ type:DRAW.roofType || '', gone:!document.getElementById('_rsModal') }));
check('skipping leaves the roof type unset rather than guessing',
  v.type === '' && v.gone, JSON.stringify(v));

// ── one button, not seven ──────────────────────────────────────────
v = await pg.evaluate(() => {
  const panel = document.getElementById('roofTypePanel');
  const html = panel ? panel.innerHTML : '';
  return { loose:(html.match(/onclick="autoGenerateRoof\('/g)||[]).length,
           dropBtn:!!document.getElementById('roofTypeDropBtn'),
           buttons:panel ? panel.querySelectorAll('button').length : -1,
           label:(document.getElementById('roofTypeDropLabel')||{}).textContent };
});
check('the five coloured roof-type buttons are gone from the toolbar',
  v.loose === 0, v.loose + ' still loose');
check('…replaced by one "Change roof type" button', v.dropBtn);
check('…so the roof panel is down to a handful of controls',
  v.buttons > 0 && v.buttons <= 6, v.buttons + ' buttons');

const menu = await pg.evaluate(() => {
  toggleRoofTypeMenu();
  const m = document.getElementById('roofTypeDropMenu');
  return { open:m.style.display === 'block',
           types:(m.innerHTML.match(/_pickRoofType/g)||[]).length,
           sheets:(m.innerHTML.match(/_pickRoofSheet/g)||[]).length };
});
check('…that opens a menu with every shape', menu.open && menu.types === 5,
  JSON.stringify(menu));
check('…and the sheet materials too, so the spec is in one place',
  menu.sheets === 4, String(menu.sheets));

const picked = await pg.evaluate(() => {
  _pickRoofType('mono');
  return { type:DRAW.roofType, label:(document.getElementById('roofTypeDropLabel')||{}).textContent,
           closed:document.getElementById('roofTypeDropMenu').style.display === 'none' };
});
check('picking from it changes the roof', picked.type === 'mono', picked.type);
check('…and the button then says what the roof IS',
  /Mono/.test(picked.label), picked.label);
check('…with the menu closed behind you', picked.closed);

// ── the toolbar reads plainly ──────────────────────────────────────
v = await pg.evaluate(() => ({
  label:(document.querySelector('.rl-drop-label')||{}).textContent,
  old:/Add Roof Lines or Details/.test(document.body.innerHTML),
}));
check('the details menu is called "Add items/details"',
  v.label === 'Add items/details', v.label);
check('…and the old wording is nowhere left', !v.old);

// ── no roof picker; always viewing all ─────────────────────────────
v = await pg.evaluate(() => {
  renderRoofSwitcher();
  const el = document.getElementById('roofSwitcher');
  return { display:el.style.display, html:el.innerHTML.length,
           showAll:DRAW.showAllRoofs, roofs:DRAW.roofs.length };
});
check('the canvas roof-picker row is gone', v.display === 'none' && v.html === 0,
  JSON.stringify(v));
check('…on a job with more than one roof', v.roofs >= 2, v.roofs + ' roofs');
check('…and the canvas is viewing them all', v.showAll === true);

// Clicking into a roof still decides where new lines land, without hiding the rest.
const sw = await pg.evaluate(() => {
  switchToRoof(0);
  return { active:DRAW.activeRoofIdx, showAll:DRAW.showAllRoofs };
});
check('picking a roof still sets where new lines attach', sw.active === 0, String(sw.active));
check('…without hiding every other roof, the way it used to', sw.showAll === true);

const toggled = await pg.evaluate(() => { toggleShowAllRoofs(); return DRAW.showAllRoofs; });
check('and nothing can put the canvas back into single-roof mode', toggled === true);

check('none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
