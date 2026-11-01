// FEEDBACK REPORT 81 (2026-11-02, the owner on job 3343): "clearlite added as
// full length on the lower roof, clearly too long as it showing as the main
// roof length instead of the clearlite length, also check that when a
// clearlite sheet it added, it makes one less steel sheet required, if there
// are multiple roofs and the app is confused at which roof, pop-up a small
// window asking which roof, when hovering the mouse over each option, it
// should change the canvas live so the user can easily see which option to
// use, make sure the sheet layout diagram shows the cearlite sheets too, make
// sure the clearlite changes the price and the job pack and everything".
// His job: the 15° hip & valley main roof and the 3° mono lean-to wrapped
// round it (roof 2), the clear put on roof 2 with the real mouse.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { writeFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const SHOTS = process.env.R81_SHOTS || '';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const MAIN = [[1045,595],[1452,595],[1452,710],[1404,710],[1404,792],[1238,792],[1238,773],[1045,773]];
const LOWER = [[1452,710],[1452,827],[1048,827],[1048,769],[1238,769],[1238,792],[1403,792],[1403,710]];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1600, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + _j(DIR, 'app.html'));
await pg.waitForTimeout(2600);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => {
  const e = document.getElementById(i); if (e) e.remove(); }); });
const shot = async (name) => { if (SHOTS) await pg.screenshot({ path: _j(SHOTS, name + '.png') }); };
const layoutShot = async (name, idx) => { if (!SHOTS) return;
  const url = await pg.evaluate((i) => _renderSheetPuzzleCanvas({ roofIdxs: [i] }).toDataURL('image/png'), idx);
  writeFileSync(_j(SHOTS, name + '.png'), Buffer.from(url.split(',')[1], 'base64')); };

await pg.evaluate(([MAIN, LOWER]) => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0558474619655514;
  DRAW.outline = MAIN.map(p => p.slice()); DRAW.outlineDone = true; DRAW.calPitch = 15;
  DRAW.roofs = [_newEmptyRoof('Main Roof')]; DRAW.activeRoofIdx = 0;
  autoGenerateRoof('hip'); _syncCurrentToRoof();
  _addAndSwitchToNewRoof();
  DRAW.outline = LOWER.map(p => p.slice()); DRAW.outlineDone = true; DRAW.calPitch = 3;
  autoGenerateRoof('mono'); autoGenerateRoof('mono', 180); _syncCurrentToRoof();
  S.jobPack = S.jobPack || {}; S.jobPack.roofSel = [0, 1];
  setTool('clearlite'); resetZoom(); redrawAll();
  ['shiftTip'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
  document.getElementById('roofCanvas').scrollIntoView({ block:'center' });
}, [MAIN, LOWER]);
await pg.waitForTimeout(300);
const at = (p) => pg.evaluate((p) => {
  const t = getImgTransform(), c = imgToCanvas(p, t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1] };
}, p);
const tally = (i) => pg.evaluate((i) => (_pzTallyOfRoof(i) || []).map(t => t.count + '×' + t.Lmm).join(' '), i);

const t1 = await tally(1);
// ── the clear on the lower roof, where he put it ──
let l = await at([1065, 800]);
await pg.mouse.click(l.x, l.y);
await pg.waitForTimeout(200);
let v = await pg.evaluate(() => document.getElementById('clearPopup').style.display + ' ' + !!document.getElementById('clearRoofChooser'));
check('a click on roof 2 alone asks only Full length / Short — no roof question', v === 'block false', v);
await pg.evaluate(() => confirmClearPopup());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const c = DRAW.clearlites[0]; return c ? { len: _clearLenM(c, 1), cx: Math.round(c.cx), y0: Math.round(c.cy + 29), y1: Math.round(c.cy - 29), roof: DRAW.activeRoofIdx } : null; });
check('REPORT 81: the full-length clear on roof 2 is roof 2\'s own run, 3.25 m — not the main roof\'s 5.15 m', v && v.len === 3.25, JSON.stringify(v));
check('…and it lies from roof 2\'s gutter up to its own top edge, not across the main roof', v && v.y0 >= 826 && v.y1 >= 768, JSON.stringify(v));
await shot('01-clear-on-roof-2');
const t1b = await tally(1);
check('…roof 2 orders one 3.25 m steel sheet fewer', /14×3250/.test(t1) && /13×3250/.test(t1b), t1 + ' → ' + t1b);
v = await pg.evaluate(() => { const pz = _sheetPuzzleBuild({ roofIdxs: [1] }); const p = pz.pieces.find(q => q.clear);
  return { clears: (pz.clearTally || []).map(t => t.count + '×' + t.Lmm).join(), label: p && p.label, blocks: pz.blocks.map(b => b.letter + b.count).join(' ') }; });
check('the sheet layout shows the clear on its strip, labelled CL, and keys it "1 × 3.25 m clearlite"', v.label === 'CL' && v.clears === '1×3250', JSON.stringify(v));
await layoutShot('02-sheet-layout-roof-2', 1);

// ── the price ──
v = await pg.evaluate(() => { const rows = _buildMaterialPriceRows(); const c = rows.find(r => r.key === 'clearlite'), s = rows.find(r => r.key === 'sheets');
  return { clear: c && c.autoQty, unit: c && c.autoUnit, v: c && c.variants.map(x => x.value).join(), sheets: s && s.note }; });
check('the pricing has a Clearlite sheets row: 3.25 lm, fibreglass or polycarbonate', v.clear === 3.25 && v.unit === 'lm' && v.v === 'fibreglass,polycarbonate', JSON.stringify(v));
check('…and the steel row is the layout\'s count, one 3.25 m sheet fewer', /13 × 3\.25m/.test(v.sheets || ''), v.sheets);

// ── the job pack ──
v = await pg.evaluate(() => { const r = _clearOrderRows(); return r.rows.map(x => x.qty + '@' + x.len).join(); });
check('the Job Pack orders the clear at 3.25 m', v === '1@3.25', v);

// ── where two roofs meet: ask, and show each ──
l = await at([1100, 771]);
await pg.mouse.click(l.x, l.y);
await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const c = document.getElementById('clearRoofChooser'); if (!c) return null;
  const r = c.getBoundingClientRect(), cv = document.getElementById('roofCanvas').getBoundingClientRect();
  return { text: c.innerText.replace(/\s+/g, ' ').trim(), roofs: [...c.querySelectorAll('.efc-btn')].map(x => x.textContent).join(),
           over: !(r.right <= cv.left || r.left >= cv.right || r.bottom <= cv.top || r.top >= cv.bottom),
           popup: document.getElementById('clearPopup').style.display }; });
check('a click where the main roof and roof 2 overlap asks "Which roof is this clearlite on?"', v && /Which roof is this clearlite on\?/.test(v.text) && v.roofs === 'Main Roof,Roof 2', JSON.stringify(v));
check('…in a small window off the canvas, before the length question', v && !v.over && v.popup === 'none', JSON.stringify(v));
await pg.hover('#clearRoofChooser .efc-btn[data-roof="0"]'); await pg.waitForTimeout(150);
v = await pg.evaluate(() => _CLEAR_PREVIEW && { r: _CLEAR_PREVIEW.roofIdx, len: _clearLenM(_CLEAR_PREVIEW.c, 0) });
check('hovering "Main Roof" draws the clear on the main roof', v && v.r === 0 && v.len > 3, JSON.stringify(v));
await shot('03-which-roof-hover-main');
await pg.hover('#clearRoofChooser .efc-btn[data-roof="1"]'); await pg.waitForTimeout(150);
v = await pg.evaluate(() => _CLEAR_PREVIEW && { r: _CLEAR_PREVIEW.roofIdx, len: _clearLenM(_CLEAR_PREVIEW.c, 1) });
check('hovering "Roof 2" draws it on roof 2 instead, at roof 2\'s length', v && v.r === 1 && v.len === 3.25, JSON.stringify(v));
await shot('04-which-roof-hover-roof2');
await pg.mouse.move(5, 5); await pg.waitForTimeout(100);
check('…and off the buttons nothing extra is drawn', await pg.evaluate(() => _CLEAR_PREVIEW === null));
await pg.click('#clearRoofChooser .efc-btn[data-roof="0"]'); await pg.waitForTimeout(150);
v = await pg.evaluate(() => document.getElementById('clearPopup').style.display);
check('picking a roof goes on to Full length / Short', v === 'block', v);
await pg.evaluate(() => confirmClearPopup()); await pg.waitForTimeout(150);
v = await pg.evaluate(() => ({ main: (DRAW.roofs[0].clearlites || []).length, r2: DRAW.clearlites.length, active: DRAW.activeRoofIdx }));
check('…and the clear lands on the main roof, while roof 2 stays the roof being edited', v.main === 1 && v.r2 === 1 && v.active === 1, JSON.stringify(v));
await shot('05-both-clears');

// ── a clear in the middle of the main roof's north slope saves a 5.15 m sheet ──
const t0 = await tally(0);
await pg.evaluate(() => { _pendingClearRoof = 0; _pendingClearX = 1250; _pendingClearY = 620; _clearPopupMode = 'full'; confirmClearPopup(); });
v = await pg.evaluate(() => { const cs = DRAW.roofs[0].clearlites; return _clearLenM(cs[cs.length - 1], 0); });
const t0b = await tally(0);
check('a full clear mid-slope on the main roof is that slope\'s 5.15 m, and takes one 5.15 m sheet off', v === 5.15 && /54×5150/.test(t0) && /53×5150/.test(t0b), v + ' ' + t0 + ' → ' + t0b);
await layoutShot('06-sheet-layout-main', 0);

// ── undo, save ──
v = await pg.evaluate(() => { undoLast(); const a = (DRAW.roofs[0].clearlites || []).length; redoLast(); return a + ' ' + (DRAW.roofs[0].clearlites || []).length; });
check('Undo takes the last clear off, Redo puts it back', v === '1 2', v);
v = await pg.evaluate(() => {
  const snap = JSON.parse(JSON.stringify(snapshotCurrentJob()));
  restoreFromJob({ id: 'r81', client_name: 'X', site_address: 'Y', draw_state: snap });
  S.jobLocked = false;
  return DRAW.roofs.map((r, i) => (i === DRAW.activeRoofIdx ? DRAW.clearlites : r.clearlites).length).join();
});
check('the clears on both roofs are saved with the job', v === '2,1', v);

// ── a short clear is an infill: no steel saved ──
v = await pg.evaluate(() => {
  const before = (_pzTallyOfRoof(1) || []).map(t => t.count + '×' + t.Lmm).join(' ');
  _pendingClearRoof = 1; _pendingClearX = 1300; _pendingClearY = 815; _clearPopupMode = 'short';
  document.getElementById('clearLenInput').value = '1.2'; confirmClearPopup();
  const after = (_pzTallyOfRoof(1) || []).map(t => t.count + '×' + t.Lmm).join(' ');
  return before === after;
});
check('a short clear takes no steel off', v);

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
