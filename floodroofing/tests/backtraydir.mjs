// THE BACK-TRAY IS DRAWN WHERE IT GOES (2026-11-13, the owner: "I added an
// 80mm penetration on a roof face, but it's pointing the 340mm corrugate back
// tray to the right. Which would make it run parallel to the roof face I put it
// on. It should rather be perpendicular to that gutter line so the full length
// of that back tray should be 3.97 meters"). The label read "→ 340mm Corrugate
// back-tray"; the arrow meant "calls up" and read as a direction. The tray is
// now drawn as a band square to the face's gutter, up to the top of the sheet.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);
const r = await pg.evaluate(() => {
  ['setupWizard', '_rsModal', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0885445205014095; DRAW.calPitch = 15;
  // His job 3351: an 80mm pipe on the west wing's south face (gutter along the bottom).
  DRAW.outline = [[1072,541],[1072,628],[1177,628],[1177,778],[1269,778],[1269,628],[1300,628],[1300,467],[1188,467],[1188,541]]; DRAW.outlineDone = true;
  autoGenerateRoof('hip'); setTool('select');
  DRAW.penetrations = [{ cx:1166, cy:614.3, sizeLabel:'80' }, { cx:1250, cy:700, sizeLabel:'110' }, { cx:1110, cy:560, sizeLabel:'80', backTrayMode:'short' }];
  window.__penTrayDrawn = {}; fitDrawingToCanvas(); redrawAll();
  const t = getImgTransform(), m = (px) => px / t.s * DRAW.scaleMetresPerPx / Math.cos(15 * Math.PI / 180);
  const out = {};
  Object.keys(window.__penTrayDrawn).forEach(k => { const d = window.__penTrayDrawn[k]; out[k] = { up: d.up, lenM: m(Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1])), det: _penBackTrayDetail(DRAW.penetrations[+k], +k) }; });
  return out;
});
check('the 80mm pipe on the south face: its tray runs UP the slope, square to the gutter (not along it)', r[0] && r[0].up[0] === 0 && r[0].up[1] === -1, JSON.stringify(r[0]));
check('…drawn the full length of the sheet, gutter to ridge (~3.97 m)', r[0] && Math.abs(r[0].lenM - 3.97) < 0.1, r[0] && r[0].lenM.toFixed(2));
check('…ordered as a 340mm Corrugate back-tray, full, 4.1 m (the sheet + 100 mm)', r[0] && r[0].det.name === '340mm Corrugate back-tray' && r[0].det.mode === 'full' && r[0].det.lengthM === 4.1, JSON.stringify(r[0] && r[0].det));
check('a pipe on the stem\'s east face: its tray runs west, up to the stem\'s ridge', r[1] && r[1].up[0] === -1 && r[1].up[1] === 0, JSON.stringify(r[1]));
check('a short tray on the north face: up the slope, from a metre below the pipe to the ridge', r[2] && r[2].up[1] === 1 && r[2].det.mode === 'short' && Math.abs(r[2].lenM - r[2].det.lengthM) < 0.15, JSON.stringify(r[2]));
check('nothing threw', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
