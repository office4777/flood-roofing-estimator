// Flashings are measured on the roof and typed into the Order tab — a
// desktop table with a type dropdown, a qty box and a row per face. That is
// fine at a desk and useless up a ladder, so onsite they got written on a
// scrap of timber and typed in that evening, or forgotten.
//
// Site mode now has the same list behind thumb-sized controls, reached from
// the Add-Roof-Lines sheet. Same data: S.order.flashings, which is what the
// material order and the supplier email read. This suite holds that it is
// the SAME list — not a parallel one that quietly never reaches the order.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
// A phone: site mode is what a narrow screen lands in.
const ctx = await b.newContext({ viewport:{width:390,height:840}, hasTouch:true, isMobile:true, deviceScaleFactor:2 });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_site_mode','on');
});
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

check('the phone lands in site mode',
  await pg.evaluate(() => document.documentElement.classList.contains('site-mode')));

// ── the way in ────────────────────────────────────────────────────
await pg.evaluate(() => { gotoTab('roof'); toggleRoofLinesMenu(); });
await pg.waitForTimeout(300);
let v = await pg.evaluate(() => {
  const el = document.getElementById('btn-siteflash');
  return { there: !!el, shown: el ? getComputedStyle(el).display !== 'none' : false };
});
check('the Add-Roof-Lines sheet offers Add flashing', v.there && v.shown,
  'present=' + v.there + ' shown=' + v.shown);

await pg.evaluate(() => _siteFlashSheet());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  open: !!document.getElementById('_flashSheet'),
  menuClosed: (document.getElementById('rlDropMenu')||{}).style.display !== 'block',
  types: document.querySelectorAll('#_fsType option').length,
  faces: document.querySelectorAll('#_fsFaces [data-face]').length,
}));
check('it opens a sheet and closes the menu behind it', v.open && v.menuClosed,
  'open=' + v.open + ' menuClosed=' + v.menuClosed);
check('the type list comes from the flashing catalogue, not a hard-coded list',
  v.types > 0 && v.types === (await pg.evaluate(() => _flashingTypeOptions().length)),
  v.types + ' types');
check('it starts on two faces — the commonest flashing is one bend', v.faces === 2, v.faces + ' faces');

// ── adding one ────────────────────────────────────────────────────
await pg.evaluate(() => {
  document.getElementById('_fsType').value = _flashingTypeOptions()[0];
  document.getElementById('_fsQty').value = '3';
  const f = document.querySelectorAll('#_fsFaces [data-face]');
  f[0].value = '150'; f[1].value = '100';
  document.getElementById('_fsAdd').click();
});
await pg.waitForTimeout(250);
v = await pg.evaluate(() => {
  const l = S.order.flashings;
  return { n: l.length, row: l[0], qtyBox: document.getElementById('_fsQty').value,
           faceVals: Array.from(document.querySelectorAll('#_fsFaces [data-face]')).map(i => i.value),
           stillOpen: !!document.getElementById('_flashSheet'),
           listed: document.querySelectorAll('#_fsList [data-rmflash]').length };
});
check('it lands on the order', v.n === 1, v.n + ' flashing(s)');
check('…with the quantity and both face lengths',
  v.row && +v.row.qty === 3 && v.row.faces.length === 2 &&
  v.row.faces[0].length === '150' && v.row.faces[1].length === '100',
  JSON.stringify(v.row && { qty:v.row.qty, faces:v.row.faces.map(f=>f.length) }));
check('the sheet stays up — an elevation is several flashings', v.stillOpen);
check('…with the form cleared for the next one',
  v.qtyBox === '1' && v.faceVals.join(',') === ',', 'qty=' + v.qtyBox + ' faces=[' + v.faceVals + ']');
check('…and the new one shown in the list on the sheet', v.listed === 1, v.listed + ' listed');

// ── a third face, and a second flashing ───────────────────────────
await pg.evaluate(() => {
  document.getElementById('_fsAddFace').click();
  const f = document.querySelectorAll('#_fsFaces [data-face]');
  f[0].value = '90'; f[1].value = '200'; f[2].value = '45';
  document.getElementById('_fsAdd').click();
});
await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ n: S.order.flashings.length,
  faces: S.order.flashings[1].faces.map(f => f.label + ':' + f.length).join(' ') }));
check('a three-bend flashing keeps all three faces, labelled A B C',
  v.n === 2 && v.faces === 'Face A:90 Face B:200 Face C:45', v.faces);

// ── it is the SAME list the Order tab writes ──────────────────────
await pg.evaluate(() => { const s = document.getElementById('_flashSheet'); if (s) s.remove(); });
await pg.evaluate(() => { gotoTab('order'); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => {
  const box = document.getElementById('flashingsList');
  return { rows: box ? box.querySelectorAll('select').length : -1,
           txt: box ? box.textContent.indexOf('No flashings yet') : -1 };
});
check('the Order tab shows the two added on the roof, not an empty card',
  v.rows === 2 && v.txt === -1, v.rows + ' rows on the Order tab');

// ── removing ──────────────────────────────────────────────────────
await pg.evaluate(() => { gotoTab('roof'); _siteFlashSheet(); });
await pg.waitForTimeout(300);
await pg.evaluate(() => document.querySelector('#_fsList [data-rmflash="0"]').click());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ n: S.order.flashings.length, first: S.order.flashings[0].faces[0].length }));
check('removing one takes the right one off the order', v.n === 1 && v.first === '90',
  v.n + ' left, first face ' + v.first);

// ── and it stays out of the way on a computer ─────────────────────
await pg.evaluate(() => {
  const s = document.getElementById('_flashSheet'); if (s) s.remove();
  localStorage.setItem('fr_site_mode','off'); _applyTabletMode();
});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const el = document.getElementById('btn-siteflash');
  return { site: document.documentElement.classList.contains('site-mode'),
           shown: el ? getComputedStyle(el).display !== 'none' : false };
});
check('in Office mode the entry is hidden — the Order tab has its own button',
  !v.site && !v.shown, 'siteMode=' + v.site + ' shown=' + v.shown);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
