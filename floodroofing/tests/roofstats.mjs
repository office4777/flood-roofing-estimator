// The roof's figures — area, flashings, gutter.
//
// The owner, 2026-09-28: "a box called roof area … next to that a box called
// flashings, the combined linear meter of all flashings … another box called
// gutter … if there are multiple roofs a toggle to change the view."
// Then, 2026-09-29: "move the selected job and associated buttons to below
// the tab buttons, then move the Roof area, Flashings and Gutter off from
// below the canvas and into the left menu under the send feedback inside the
// selected job grey box, keep it basic and simple … if there are multiple
// roofs, have a small drop down button calling 'Viewing all' then drops the
// menu down with tick boxes to toggle the different roofs on or off which
// also changes the name of the button … if there is only one roof then no
// need to have that button at all."
//
// So this suite pins where the figures live, what each one counts (and that
// the gutter is in exactly one of them), the tick-box picker's label and
// filtering, and that picking roofs changes the FIGURES only — never which
// roof is being drawn, and never what is on the canvas.
//
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' }));
});
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });

// ── where it all sits ──────────────────────────────────────────────
const where = await pg.evaluate(() => {
  const nav = document.querySelector('.nav');
  const kids = [...nav.children];
  const box = document.getElementById('navJobBox');
  return {
    inTheJobBox: !!box && box.contains(document.getElementById('navRoofStats')),
    afterTheTabs: kids.indexOf(box) > kids.indexOf(document.getElementById('navFeedbackBtn')),
    aboveTheAccount: kids.indexOf(box) < kids.indexOf(document.getElementById('navAccount')),
    underCanvas: getComputedStyle(document.getElementById('roofStatsBar')).display,
    statsShown: getComputedStyle(document.getElementById('navRoofStats')).display !== 'none',
  };
});
check('the job box sits under the tab buttons, above the account', where.afterTheTabs && where.aboveTheAccount, JSON.stringify(where));
check('the figures are inside the job’s grey box', where.inTheJobBox);
check('nothing is left under the canvas', where.underCanvas === 'none', where.underCanvas);
check('with nothing drawn the figures are not shown at all', !where.statsShown);

// One roof: 600 × 300 image px at 0.02 m/px = 12 m × 6 m. Flat, so the area
// along the pitch is the plan area — 72 m² exactly, nothing to round.
await pg.evaluate(() => {
  clearAll(true);
  setTool('outline');
  DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]];
  finishCurrent();
  DRAW.scaleMetresPerPx = 0.02;
  DRAW.calPitch = 0.0001;              // flat: pitch factor 1
  autoGenerateRoof('gable');
  updateMeasTotals();
});
await pg.waitForTimeout(400);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }

const one = await pg.evaluate(() => {
  const host = document.getElementById('navRoofStats');
  const rows = [...host.querySelectorAll('.nrs-row')];
  const lines = DRAW.lines.filter(l => parseFloat(l.measM) > 0);
  const sum = (f) => lines.filter(f).reduce((s,l) => s + parseFloat(l.measM), 0);
  return {
    labels: rows.map(r => r.querySelector('span').textContent.trim()),
    vals:   rows.map(r => r.querySelector('b').textContent.replace(/\s+/g,'').trim()),
    flashWant:  sum(l => l.type !== 'gutter').toFixed(1),
    gutterWant: sum(l => l.type === 'gutter').toFixed(1),
    types: [...new Set(lines.map(l => l.type))].sort(),
    oldBox: !!document.getElementById('roofAreaBox'),
    viewBtn: !!host.querySelector('.nrs-btn'),
    shown: getComputedStyle(host).display !== 'none',
  };
});
check('the three figures are Roof area, Flashings and Gutter, in that order',
  one.labels.join('|') === 'Roof area|Flashings|Gutter', one.labels.join('|'));
check('Roof area is the area along the pitch, in m²', one.shown && one.vals[0] === '72.0m²', one.vals[0]);
check('Flashings is every measured line except the gutter, in lineal metres',
  one.vals[1] === one.flashWant + 'm' && parseFloat(one.flashWant) > 0, one.vals[1] + ' want ' + one.flashWant);
check('Gutter is the gutter runs on their own',
  one.vals[2] === one.gutterWant + 'm' && parseFloat(one.gutterWant) > 0, one.vals[2] + ' want ' + one.gutterWant);
check('…so the gutter is counted in exactly one of them',
  parseFloat(one.vals[1]) !== parseFloat(one.flashWant) + parseFloat(one.gutterWant), JSON.stringify(one.vals));
check('a gable really did draw both kinds of line', one.types.includes('gutter') && one.types.length > 1, one.types.join(','));
check('the roof area no longer sits in the Roof plan card head', !one.oldBox);
check('ONE roof shows no Viewing button at all', !one.viewBtn);

// ── two roofs: the tick-box picker ─────────────────────────────────
await pg.evaluate(() => {
  _addAndSwitchToNewRoof();
  setTool('outline');
  DRAW.currentPts = [[900,300],[1200,300],[1200,500],[900,500]];
  finishCurrent();
  DRAW.calPitch = 0.0001;
  autoGenerateRoof('gable');
  DRAW.roofs[1].name = 'Garage';
  updateMeasTotals();
});
await pg.waitForTimeout(400);
const two = await pg.evaluate(() => {
  const host = document.getElementById('navRoofStats');
  const roofs = _matBasicCollectRoofs();
  return {
    roofs: roofs.length,
    btn: host.querySelector('.nrs-btn') ? host.querySelector('.nrs-btn').textContent.replace(/[▾▴]/g,'').trim() : null,
    menuClosed: !host.querySelector('.nrs-menu'),
    area: host.querySelector('.nrs-row b').textContent.replace(/\s+/g,''),
    areaWant: roofs.reduce((s,r) => s + r.areaM2, 0).toFixed(1),
    firstArea: roofs[0].areaM2.toFixed(1),
    names: roofs.map(r => r.name),
    activeBefore: DRAW.activeRoofIdx,
  };
});
check('a second roof brings a small Viewing button, reading "Viewing all"', two.roofs === 2 && two.btn === 'Viewing all', two.btn);
check('…with its menu closed until it is asked for', two.menuClosed);
check('…and the figures add every roof up', two.area === two.areaWant + 'm²', two.area + ' want ' + two.areaWant);

// open it: a tick box per roof, all ticked
await pg.evaluate(() => document.querySelector('#navRoofStats .nrs-btn').click());
await pg.waitForTimeout(150);
const menu = await pg.evaluate(() => {
  const boxes = [...document.querySelectorAll('#navRoofStats .nrs-menu label')];
  return { n: boxes.length, ticked: boxes.filter(l => l.querySelector('input').checked).length,
           names: boxes.map(l => l.textContent.trim()) };
});
check('the button drops a tick box per roof, every one ticked',
  menu.n === 2 && menu.ticked === 2 && menu.names.join('|') === two.names.join('|'), JSON.stringify(menu));

// untick the garage
await pg.evaluate(() => {
  const boxes = [...document.querySelectorAll('#navRoofStats .nrs-menu label input')];
  boxes[1].click();
});
await pg.waitForTimeout(200);
const picked = await pg.evaluate(() => {
  const host = document.getElementById('navRoofStats');
  return {
    btn: host.querySelector('.nrs-btn').textContent.replace(/[▾▴]/g,'').trim(),
    area: host.querySelector('.nrs-row b').textContent.replace(/\s+/g,''),
    active: DRAW.activeRoofIdx,
    roofsOnCanvas: (DRAW.roofs || []).length,
  };
});
check('unticking a roof names the ones left on the button', picked.btn === 'Viewing Main Roof', picked.btn);
check('…and the figures drop to that roof alone', picked.area === two.firstArea + 'm²', picked.area + ' want ' + two.firstArea);
check('…while the drawing is untouched: same roof active, both roofs still on the canvas',
  picked.active === two.activeBefore && picked.roofsOnCanvas === 2, JSON.stringify(picked));

// the last one left cannot be taken off
await pg.evaluate(() => {
  const boxes = [...document.querySelectorAll('#navRoofStats .nrs-menu label input')];
  boxes[0].click();
});
await pg.waitForTimeout(200);
const last = await pg.evaluate(() => ({
  btn: document.querySelector('#navRoofStats .nrs-btn').textContent.replace(/[▾▴]/g,'').trim(),
  area: document.querySelector('#navRoofStats .nrs-row b').textContent.replace(/\s+/g,''),
}));
check('the last roof left cannot be unticked — the figures never go blank',
  last.btn === 'Viewing Main Roof' && last.area === two.firstArea + 'm²', JSON.stringify(last));

// ticking it back reads "Viewing all" again
await pg.evaluate(() => {
  const boxes = [...document.querySelectorAll('#navRoofStats .nrs-menu label input')];
  boxes[1].click();
});
await pg.waitForTimeout(200);
check('ticking them all back reads Viewing all',
  await pg.evaluate(() => document.querySelector('#navRoofStats .nrs-btn').textContent.replace(/[▾▴]/g,'').trim()) === 'Viewing all');

// clicking away closes the menu
await pg.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles:true })));
await pg.waitForTimeout(150);
check('a click anywhere else closes the menu',
  await pg.evaluate(() => !document.querySelector('#navRoofStats .nrs-menu')));

// ── a plain wheel over the canvas never zooms (2026-09-29) ─────────
const wheel = await pg.evaluate(() => {
  const cv = document.getElementById('roofCanvas');
  const r = cv.getBoundingClientRect();
  const at = { clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles:true, cancelable:true };
  const out = {};
  const fake = document.createElement('canvas'); fake.width = 40; fake.height = 30;
  for (const bg of [true, false]){
    DRAW.bgImg = bg ? fake : null;
    for (const tool of ['select', 'outline']){
      setTool(tool);
      DRAW.zoom = 1;
      const plain = new WheelEvent('wheel', { ...at, deltaY: -120 });
      cv.dispatchEvent(plain);
      out[(bg ? 'bg' : 'nobg') + '-' + tool] = { zoom: DRAW.zoom, stopped: plain.defaultPrevented };
    }
  }
  setTool('select');
  DRAW.zoom = 1;
  const ctrl = new WheelEvent('wheel', { ...at, deltaY: -120, ctrlKey: true });
  document.getElementById('roofCanvas').dispatchEvent(ctrl);
  out.ctrl = { zoom: DRAW.zoom, stopped: ctrl.defaultPrevented };
  return out;
});
check('a plain wheel over the canvas leaves the zoom alone and lets the page scroll',
  Object.keys(wheel).filter(k => k !== 'ctrl').every(k => wheel[k].zoom === 1 && !wheel[k].stopped),
  JSON.stringify(wheel));
check('…including a sketch with no aerial behind it, which used to zoom',
  wheel['nobg-select'].zoom === 1 && wheel['nobg-outline'].zoom === 1, JSON.stringify(wheel));
check('Ctrl + wheel still zooms the drawing, and keeps the browser out of it',
  wheel.ctrl.zoom > 1 && wheel.ctrl.stopped, JSON.stringify(wheel.ctrl));

// ── clearing the job takes the figures away again ──────────────────
await pg.evaluate(() => { clearAll(true); updateMeasTotals(); });
await pg.waitForTimeout(250);
check('clearing the drawing hides the figures',
  await pg.evaluate(() => getComputedStyle(document.getElementById('navRoofStats')).display) === 'none');

check('nothing threw along the way', errs.length === 0, errs.join(' | '));

await b.close();
const bad = results.filter(r => !r).length;
console.log(bad ? ('FAILED ' + bad + '/' + results.length) : ('All ' + results.length + ' passed'));
process.exit(bad ? 1 : 0);
