// EVERY CORNER, JUNCTION AND APEX CARRIES ITS LIST (2026-11-06, the owner:
// "when I've done the outline of a roof and I click on the corner, any corner
// should list the possibilities ... the same for where two hips meet a ridge,
// because I done some sort of a Z-shaped Dutch gable, but at the corner it
// defaulted to hips right to the corner instead of a Dutch gable sort of end
// ... if it's a gable roof, there should be a little circle button where the
// two barges meet the ridge ... just type hip and valley, Dutch gable, etc.").
// Driven with a real mouse.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const SHOTS = process.env.EP_SHOTS || '';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

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
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });
const shot = async (name) => { if (SHOTS) await pg.screenshot({ path: _j(SHOTS, name + '.png') }); };

const build = (outline, type) => pg.evaluate(([o, t]) => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 25;
  DRAW.outline = o.map(p => p.slice()); DRAW.outlineDone = true;
  DRAW.roofs = [_newEmptyRoof('Main Roof')]; DRAW.activeRoofIdx = 0;
  autoGenerateRoof(t); _syncCurrentToRoof();
  const m = document.getElementById('_rsModal'); if (m) m.remove();
  setTool('select'); resetZoom(); redrawAll(); const s = document.getElementById('shiftTip'); if (s) s.remove();
  document.getElementById('roofCanvas').scrollIntoView({ block:'center' });
  try { _closeCornerRepo(); _closeJunctRepo(); } catch(e){}
}, [outline, type]).then(() => pg.waitForTimeout(1400)).then(() => pg.evaluate(() => {
  // the roof's own window drops in a second after a roof is built
  document.querySelectorAll('#_rsModal,.rs-drop,#_rsModalClosing').forEach(e => e.remove());
}));
const at = (p) => pg.evaluate((p) => {
  const t = getImgTransform(), c = imgToCanvas(p, t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1] };
}, p);
const press = async (p) => { const l = await at(p); await pg.mouse.move(l.x, l.y); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(250); };
const pad = (id) => pg.evaluate((id) => {
  const el = document.getElementById(id);
  return { shown: !!el && el.style.display !== 'none', title: el && (el.querySelector('.crn-title') || {}).textContent,
           head: [...el.querySelectorAll('.crn-bump-hd')].map(x => x.textContent),
           btns: [...el.querySelectorAll('.crn-bump')].map(x => x.textContent.trim()),
           arrows: !!el && getComputedStyle(el.querySelector('.crn-grid')).display !== 'none' };
}, id);
const lines = () => pg.evaluate(() => DRAW.lines.map(l => ({ t: l.type, a: l.pts[0], b: l.pts[1] })));

// ── A gable rectangle: a circle where the barges meet the ridge ──
await build([[300,250],[900,250],[900,610],[300,610]], 'gable');
const apx = await pg.evaluate(() => _roofApexes().map(a => a.pt));
check('a gable roof has a circle at each end where the barges meet the ridge', apx.length === 2, JSON.stringify(apx));
await press(apx[0]);
let p = await pad('junctRepoPopup');
check('…pressing it opens a list with no arrows: Gable, Hip, Dutch gable — short names only',
  p.shown && !p.arrows && p.title === 'Roof end' && JSON.stringify(p.btns) === JSON.stringify(['✓ Gable','Hip','Dutch gable']) && /end$/i.test(p.head[0]),
  JSON.stringify(p));
await shot('ep-1-gable-apex');
await pg.evaluate(() => { const b = [...document.querySelectorAll('#junctEndRow .crn-bump')].find(x => x.textContent.trim() === 'Hip'); b.click(); });
await pg.waitForTimeout(250);
let L = await lines();
p = await pad('junctRepoPopup');
check('…Hip makes that end a hip end, the other end still a gable, and the list says so',
  L.filter(l => l.t === 'hip').length === 2 && L.filter(l => l.t === 'barge').length === 2 && p.btns.includes('✓ Hip'), JSON.stringify({ t: L.map(l => l.t), btns: p.btns }));
await pg.evaluate(() => _closeJunctRepo());

// ── that hip end's junction carries the list under its arrows ──
const jn = await pg.evaluate(() => _roofJunctions().filter(j => _junctAxis(j)).map(j => j.pt));
await press(jn[0]);
p = await pad('junctRepoPopup');
check('where two hips meet the ridge: the arrows AND the list under them', p.shown && p.arrows && p.title === 'Move junction' &&
  p.btns.includes('✓ Hip') && p.btns.includes('Gable') && p.btns.includes('Dutch gable'), JSON.stringify(p));
await pg.evaluate(() => { const b = [...document.querySelectorAll('#junctEndRow .crn-bump')].find(x => x.textContent.trim() === 'Dutch gable'); b.click(); });
await pg.waitForTimeout(250);
L = await lines();
check('…Dutch gable from the junction makes a gablet there', L.some(l => l.t === 'apron') && L.filter(l => l.t === 'hip').length === 2,
  JSON.stringify(L.map(l => l.t)));
await pg.evaluate(() => _closeJunctRepo());

// ── a Z-shaped dutch gable: every end can be told what it is ──
const Z = [[200,200],[620,200],[620,330],[820,330],[820,560],[400,560],[400,430],[200,430]];
await build(Z, 'dutch');
const za = await pg.evaluate(() => _roofApexes().map(a => a.pt));
check('a Z dutch: a circle at the top of each gablet', za.length === 2, JSON.stringify(za));
await press(za[0]);
p = await pad('junctRepoPopup');
check('…a gablet’s top opens its list (✓ Dutch gable)', p.shown && JSON.stringify(p.btns) === JSON.stringify(['Gable','Hip','✓ Dutch gable']), JSON.stringify(p));
await shot('ep-2-z-dutch');
await pg.evaluate(() => { const b = [...document.querySelectorAll('#junctEndRow .crn-bump')].find(x => x.textContent.trim() === 'Hip'); b.click(); });
await pg.waitForTimeout(300);
let aprons = (await lines()).filter(l => l.t === 'apron').length;
p = await pad('junctRepoPopup');
check('…Hip turns that end to hips right to the corners (the shape he was left with)', aprons === 1 && p.btns.includes('✓ Hip'), aprons + ' ' + JSON.stringify(p.btns));
await pg.evaluate(() => _closeJunctRepo());
// now the hip end's junction: two hips and the ridge
const hj = await pg.evaluate(() => _roofJunctions().filter(j => _junctAxis(j) && j.ends.length === 3 && j.ends.filter(x => x.type === 'hip').length === 2)
  .map(j => ({ pt: j.pt, cs: _endCornersFrom(j.pt) })).filter(j => j.cs.length === 2).map(j => j.pt));
check('…and that hip end has a junction to press', hj.length === 1, JSON.stringify(hj));
await press(hj[0]);
p = await pad('junctRepoPopup');
check('…whose list under the arrows offers Dutch gable', p.arrows && p.btns.includes('✓ Hip') && p.btns.includes('Dutch gable'), JSON.stringify(p));
await pg.evaluate(() => { const b = [...document.querySelectorAll('#junctEndRow .crn-bump')].find(x => x.textContent.trim() === 'Dutch gable'); b.click(); });
await pg.waitForTimeout(300);
aprons = (await lines()).filter(l => l.t === 'apron').length;
check('…and Dutch gable there puts the gablet back', aprons === 2, String(aprons));
const ov = await pg.evaluate(() => { const o = document.getElementById('lineMeasOverlay'); return !!o && getComputedStyle(o).display !== 'none'; });
check('pressing a junction opens its pad and nothing else (no line popup on top)', !ov, String(ov));
await pg.evaluate(() => _closeJunctRepo());
// the step where the two wings meet is not an end: it still lists the roof's shapes
const sj = await pg.evaluate(() => _roofJunctions().filter(j => _junctAxis(j) && _endCornersFrom(j.pt).length === 1).map(j => j.pt));
if (sj.length){
  await press(sj[0]);
  p = await pad('junctRepoPopup');
  check('…where the Z’s wings meet (one hip and a valley) the junction still lists something', p.btns.length > 0, JSON.stringify(p));
  await pg.evaluate(() => _closeJunctRepo());
}

// ── every corner lists something ──
await build([[400,330],[1000,330],[1000,530],[750,530],[750,720],[400,720]], 'hip');
const cornerLists = [];
for (let i = 0; i < 6; i++){
  const pt = await pg.evaluate((i) => DRAW.outline[i].slice(), i);
  await press(pt);
  const c = await pad('cornerRepoPopup');
  cornerLists.push(c.btns.length);
  await pg.evaluate(() => _closeCornerRepo());
}
check('on an L hip roof every one of its six corners lists something under the arrows', cornerLists.every(n => n > 0), JSON.stringify(cornerLists));
const reflex = await pg.evaluate(() => DRAW.outline[3].slice());
await press(reflex);
p = await pad('cornerRepoPopup');
check('…the inside corner, which has no end of its own, lists the roof’s shapes by short name',
  p.head[0] === 'Roof' && p.btns.includes('✓ Hip & valley') && p.btns.includes('Gable') && p.btns.includes('Mono pitch') && p.btns.every(t => t.length < 26), JSON.stringify(p));
await shot('ep-3-corner-roof');
await pg.evaluate(() => { const b = [...document.querySelectorAll('#cornerEndRow .crn-bump')].find(x => x.textContent.trim() === 'Gable'); b.click(); });
await pg.waitForTimeout(400);
const rt = await pg.evaluate(() => DRAW.roofType);
check('…and a shape picked there rebuilds the roof', rt === 'gable', rt);
await pg.evaluate(() => _closeCornerRepo());

// ── a bump on a dutch roof offers Hip & valley / Mono extension ──
await build([[300,250],[900,250],[900,600],[680,600],[680,650],[520,650],[520,600],[300,600]], 'dutch');
const bc = await pg.evaluate(() => { const bs = _outlineBumps(DRAW.outline); return bs.length ? DRAW.outline[bs[0].b].slice() : null; });
if (bc){
  await press(bc);
  p = await pad('cornerRepoPopup');
  check('a bump on a dutch gable lists Hip & valley and Mono extension', p.btns.some(t => /Hip & valley/.test(t)) && p.btns.some(t => /Mono extension/.test(t)), JSON.stringify(p));
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#cornerBumpRow .crn-bump')].find(x => /Hip & valley/.test(x.textContent)); b.click(); });
  await pg.waitForTimeout(300);
  const hv = await pg.evaluate(() => { const b = _outlineBumps(DRAW.outline)[0]; return _bumpShownMode(b); });
  check('…and Hip & valley gives the bump its own hip end on the dutch roof', hv === 'hv', hv);
  await pg.evaluate(() => _closeCornerRepo());
} else check('a bump on a dutch gable lists Hip & valley and Mono extension', false, 'no bump found');

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
