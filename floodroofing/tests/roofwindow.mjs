// THE ROOF BUTTON OPENS THE ROOF'S WINDOW (2026-10-29, the owner: "add a
// rotate 90deg inside the pop-up roof type selector, also change the 'Roof
// settings' window to be the pop-up selector as it pretty much works the same
// way but looks better, just add the make main roof and delete roof buttons in
// it too, also when that window opens and i click the different roofs, change
// them live in the canvas as i change the selected roof type in that window").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1440, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => { ['setupWizard','tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });

// ── a new outline: the window it closes into ──
let v = await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 20;
  DRAW.currentPts = [[300,300],[900,300],[900,650],[300,650]]; finishCurrent();
  return null;
});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const m = document.getElementById('_rsModal');
  return { open: !!m, mode: m && m.getAttribute('data-mode'), rotate: !!document.querySelector('#_rsModal #_rsRotate'),
           pics: document.querySelectorAll('#_rsModal [data-rstype] svg').length, lines: DRAW.lines.filter(l => l.type === 'ridge').length };
});
check('closing an outline opens the shape window, with Rotate 90° in it', v.open && v.mode === 'new' && v.rotate && v.pics === 6, JSON.stringify(v));
await pg.click('#_rsModal [data-rstype="gable"]'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ open: !!document.getElementById('_rsModal'), type: DRAW.roofType, ridges: DRAW.lines.filter(l => l.type === 'ridge').length }));
check('a click on a shape builds it on the canvas there and then, the window still open', v.open && v.type === 'gable' && v.ridges === 1, JSON.stringify(v));
const ridgeDir = () => pg.evaluate(() => { const r = DRAW.lines.find(l => l.type === 'ridge'); return r ? (Math.abs(r.pts[1][0]-r.pts[0][0]) > Math.abs(r.pts[1][1]-r.pts[0][1]) ? 'h' : 'v') : ''; });
const d0 = await ridgeDir();
await pg.click('#_rsRotate'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ rot: DRAW.rotation, open: !!document.getElementById('_rsModal') }));
const d1 = await ridgeDir();
check('Rotate 90° in the window turns the roof on the canvas', v.rot === 90 && d0 && d1 && d0 !== d1 && v.open, JSON.stringify(v) + ' ' + d0 + '→' + d1);
await pg.click('#_rsSkip'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ open: !!document.getElementById('_rsModal'), type: DRAW.roofType || '', ridges: DRAW.lines.filter(l => l.type === 'ridge').length, outline: DRAW.outline.length }));
check('Skip for now takes back what was tried, and leaves the outline', !v.open && v.ridges === 0 && v.outline === 4, JSON.stringify(v));

// ── the roof button: the same window, its settings mode ──
v = await pg.evaluate(() => {
  autoGenerateRoof('hip');
  // a second roof beside it
  _addAndSwitchToNewRoof();
  DRAW.outline = [[1000,300],[1300,300],[1300,500],[1000,500]]; DRAW.outlineDone = true; DRAW.calPitch = 15;
  autoGenerateRoof('gable');
  _syncCurrentToRoof(); renderRoofSwitcher(); setTool('select');
  return { n: DRAW.roofs.length, act: DRAW.activeRoofIdx };
});
check('two roofs on the bar', v.n === 2 && v.act === 1, JSON.stringify(v));
await pg.click('#roofMenuBar button:nth-child(2)'); await pg.waitForTimeout(300);
v = await pg.evaluate(() => {
  const m = document.getElementById('_rsModal'), p = document.getElementById('roofTypePanel');
  return { open: !!m, mode: m && m.getAttribute('data-mode'), title: (document.getElementById('_rsTitle') || {}).textContent,
           panel: p ? p.style.display : 'x', make: !!document.getElementById('_rsMakeMain'), del: !!document.getElementById('_rsDelete'),
           snap: !!document.getElementById('_rsSnap'), pitchIn: !!document.querySelector('#_rsModal #roofPitchInput'),
           arrow: (document.querySelector('#roofMenuBar button:nth-child(2) span') || {}).textContent,
           ok: (document.getElementById('_rsOk') || {}).textContent, ringed: (document.querySelector('#_rsModal [data-rstype][style*="#0099cc"]') || {}).getAttribute && document.querySelector('#_rsModal [data-rstype][style*="#0099cc"]').getAttribute('data-rstype') };
});
check('the roof button opens the roof window — not the drop-down panel', v.open && v.mode === 'settings' && v.panel === 'none', JSON.stringify(v));
check('…titled for that roof, the shape it is ringed', /Roof 2 — roof settings/.test(v.title) && v.ringed === 'gable', v.title + ' / ' + v.ringed);
check('…with Make main roof, Delete roof, Snap square, the pitch and Done', v.make && v.del && v.snap && v.pitchIn && v.ok === 'Done', JSON.stringify(v));
check('…and the roof button’s arrow says it is open', v.arrow === '▴', v.arrow);
await pg.click('#_rsModal [data-rstype="mono"]'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ type: DRAW.roofType, open: !!document.getElementById('_rsModal'), main: DRAW.roofs[0].roofType }));
check('a shape clicked in it changes THAT roof live, and only that roof', v.type === 'mono' && v.open && v.main === 'hip', JSON.stringify(v));
await pg.fill('#_rsModal #roofPitchInput', '25'); await pg.waitForTimeout(150);
v = await pg.evaluate(() => DRAW.calPitch);
check('the pitch typed in it is the roof’s pitch', v === 25, String(v));
await pg.click('#_rsOk'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ open: !!document.getElementById('_rsModal'), home: !!document.querySelector('#roofTypePanel #roofPitchInput'), arrow: (document.querySelector('#roofMenuBar button:nth-child(2) span') || {}).textContent }));
check('Done closes it and the borrowed pitch row goes back to the roof panel', !v.open && v.home && v.arrow === '▾', JSON.stringify(v));
await pg.evaluate(() => _toggleRoofMenu(1)); await pg.waitForTimeout(250);
await pg.evaluate(() => _toggleRoofMenu(1)); await pg.waitForTimeout(200);
v = await pg.evaluate(() => !!document.getElementById('_rsModal'));
check('tapping the same roof again puts it away', v === false, String(v));
await pg.evaluate(() => _toggleRoofMenu(1)); await pg.waitForTimeout(250);
await pg.click('#_rsMakeMain'); await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ act: DRAW.activeRoofIdx, t0: DRAW.roofs[0].roofType, title: (document.getElementById('_rsTitle') || {}).textContent, tag: !!document.getElementById('_rsIsMain') }));
check('Make main roof in it makes it the main roof, and the window says so', v.act === 0 && v.t0 === 'mono' && v.tag && /Main Roof/.test(v.title), JSON.stringify(v));
await pg.click('#_rsDelete'); await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ n: DRAW.roofs.length, open: !!document.getElementById('_rsModal') }));
check('Delete roof in it deletes that roof and closes the window', v.n === 1 && !v.open, JSON.stringify(v));
check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
