// FEEDBACK REPORT 80 (2026-11-01, the owner): "2nd roof has a hip ... allow me
// (when i've clicked on a corner, to make that corner a hip, every corner when
// clicked should show a list of options it could change it too that sit in a
// list under the fine adjustments pop-up ... i could be able to change a
// mono-pitch corner to a hip, i should be able to change a hip corner to a
// gable or dutch gable end ... if its not sure which side to change ... then
// another small two button options should pop-up which when hovering the mouse
// over the button option it should live change the canvas drawing ... that
// window should say "Changing which face?" then the buttons should be either
// north, east, west or south".
// Driven with a real mouse on his own two roofs: the 3° mono that wraps the
// main roof (a hip end at its south-east corner) and the 15° hip & valley.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const SHOTS = process.env.R80_SHOTS || '';
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

// His job: the main roof (hip & valley at 15°) and roof 2 (a mono at 3°).
await pg.evaluate(([MAIN, LOWER]) => {
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.0558474619655514;
  DRAW.outline = MAIN.map(p => p.slice()); DRAW.outlineDone = true; DRAW.calPitch = 15;
  DRAW.roofs = [_newEmptyRoof('Main Roof')]; DRAW.activeRoofIdx = 0;
  autoGenerateRoof('hip'); _syncCurrentToRoof();
  _addAndSwitchToNewRoof();
  DRAW.outline = LOWER.map(p => p.slice()); DRAW.outlineDone = true; DRAW.calPitch = 3;
  autoGenerateRoof('mono'); autoGenerateRoof('mono', 180); _syncCurrentToRoof();
  setTool('select'); resetZoom(); redrawAll(); const t = document.getElementById('shiftTip'); if (t) t.remove();
  document.getElementById('roofCanvas').scrollIntoView({ block:'center' });
}, [MAIN, LOWER]);
await pg.waitForTimeout(300);

const at = (p) => pg.evaluate((p) => {
  const t = getImgTransform(), c = imgToCanvas(p, t), r = document.getElementById('roofCanvas').getBoundingClientRect();
  return { x: r.left + c[0], y: r.top + c[1] };
}, p);
const press = async (p) => { const l = await at(p); await pg.mouse.move(l.x, l.y); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(200); };
const S = () => pg.evaluate(() => DRAW.lines.map(l => l.type + (l.subtype ? '/' + l.subtype : '') + (l.slopeRun ? '*' : '') + ':' +
  l.pts.map(p => p.map(v => Math.round(v)).join(',')).join('>')).sort());
const row = () => pg.evaluate(() => { const r = document.getElementById('cornerEndRow');
  return r && r.style.display !== 'none' ? { text: r.innerText.replace(/\s+/g, ' ').trim(), on: [...r.querySelectorAll('.crn-bump.on')].map(x => x.dataset.endkind).join() } : null; });

// ── roof 2: the mono's south-east corner ──
const before = await S();
await press([1452, 827]);
let v = await row();
check('clicking roof 2\'s south-east corner lists "East end": Barge end | Hip end, under the arrows',
  v && /East end/i.test(v.text) && /Barge end/.test(v.text) && /Hip end/.test(v.text) && v.on === 'gable', JSON.stringify(v));
v = await pg.evaluate(() => { const p = document.getElementById('cornerRepoPopup'), r = document.getElementById('cornerEndRow');
  return p.style.display !== 'none' && p.contains(r) && r.getBoundingClientRect().top > p.querySelector('.crn-grid').getBoundingClientRect().bottom; });
check('…the list sits inside the fine-adjustment pad, below the arrows', v);
await shot('01-mono-corner-pad');

// hover = live, leave = back
await pg.hover('#cornerEndRow [data-endkind="hip"]');
await pg.waitForTimeout(150);
let hov = await S();
check('hovering "Hip end" draws the hip on the canvas straight away',
  hov.includes('hip:1452,827>1403,778') && hov.includes('gutter:1452,710>1452,827'), hov.join(' '));
await shot('02-mono-hover-hip');
await pg.mouse.move(5, 5); await pg.waitForTimeout(150);
check('…and moving off it puts the roof back exactly', JSON.stringify(await S()) === JSON.stringify(before));

await pg.click('#cornerEndRow [data-endkind="hip"]');
await pg.waitForTimeout(200);
const monoHip = await S();
check('clicking "Hip end": a 45° hip from the corner to the main roof\'s wall at (1403, 778)', monoHip.includes('hip:1452,827>1403,778'), monoHip.join(' '));
check('…the east barge becomes a gutter', monoHip.includes('gutter:1452,710>1452,827') && !monoHip.some(s => s.startsWith('barge') && s.includes('1452,710>1452,827')));
check('…the wall above the hip is level on the new face (a head barge), below it stays a barge',
  monoHip.includes('barge/head:1403,778>1403,710') && monoHip.includes('barge:1403,792>1403,778'), monoHip.join(' '));
check('…the short apron along the main roof runs up the new face\'s slope', monoHip.includes('apron*:1403,710>1452,710'));
v = await pg.evaluate(() => { const h = DRAW.lines.find(l => l.type === 'hip'); return h && h.measM; });
check('…the hip is measured as a hip (√2 the plan run, 3° pitch)', v > 3.8 && v < 4.0, String(v));
v = await row();
check('…and the pad now ticks "Hip end"', v && v.on === 'hip', JSON.stringify(v));
await shot('03-mono-hip-done');
v = await pg.evaluate(() => { undoLast(); const a = DRAW.lines.filter(l => l.type === 'hip').length; redoLast(); return a + ' ' + DRAW.lines.filter(l => l.type === 'hip').length; });
check('Undo takes the hip away again, Redo puts it back', v === '0 1', v);

// it lasts
v = await pg.evaluate(() => { _cornerRepoNudge(0, -1); _cornerRepoNudge(0, 1); return DRAW.lines.filter(l => l.type === 'hip').length; });
check('nudging a corner rebuilds the roof with the hip still on it', v === 1, String(v));
v = await pg.evaluate(() => { switchToRoof(0); switchToRoof(1); return DRAW.lines.filter(l => l.type === 'hip').length + ' ' + JSON.stringify(DRAW.endKinds); });
check('switching roofs and back keeps it', v === '1 {"m:1":"hip"}', v);
v = await pg.evaluate(() => {
  const snap = JSON.parse(JSON.stringify(snapshotCurrentJob()));
  DRAW.endKinds = null;
  restoreFromJob({ id: 'r80', client_name: 'X', site_address: 'Y', draw_state: snap });
  S.jobLocked = false; try { _jobLockRender(); } catch(e){}
  return JSON.stringify(DRAW.endKinds) + ' ' + DRAW.lines.filter(l => l.type === 'hip').length;
});
check('it is saved with the job', v === '{"m:1":"hip"} 1', v);

v = await pg.evaluate(() => { _closeCornerRepo(); _cornerRepoOpen(0); const r = document.getElementById('cornerEndRow'); return r.style.display; });
check('a corner on the mono\'s high side offers nothing', v === 'none', v);

// ── the main roof: its east hip end ──
await pg.evaluate(() => { _closeCornerRepo(); switchToRoof(0); setTool('select'); resetZoom(); redrawAll(); const t = document.getElementById('shiftTip'); if (t) t.remove(); });
await press([1452, 595]);
v = await row();
check('the main roof\'s north-east corner lists "East end": Gable | Hip (ticked) | Dutch gable',
  v && /East end/i.test(v.text) && /Gable end/.test(v.text) && /Dutch gable end/.test(v.text) && v.on === 'hip', JSON.stringify(v));
const mainBefore = await S();
await pg.hover('#cornerEndRow [data-endkind="dutch"]'); await pg.waitForTimeout(150);
await shot('04-main-hover-dutch');
await pg.mouse.move(5, 5); await pg.waitForTimeout(100);
await pg.click('#cornerEndRow [data-endkind="gable"]'); await pg.waitForTimeout(200);
v = await S();
check('"Gable end": the two east hips go, the ridge runs to the wall, the wall is two barges',
  !v.includes('hip:1452,595>1395,653') && v.some(s => /^ridge:1452,653>/.test(s) || /^ridge:.*>1452,653$/.test(s)) &&
  v.some(s => s === 'barge:1452,653>1452,595') && v.some(s => s === 'barge:1452,653>1452,710'), v.join(' '));
check('…the rest of the main roof is untouched', mainBefore.filter(s => !/1452,(595|653|710)/.test(s) && !/^ridge:1395,653/.test(s) && !/^ridge:.*1395,653$/.test(s))
  .every(s => v.includes(s)), mainBefore.filter(s => !v.includes(s)).join(' '));
await shot('05-main-east-gable');
await pg.click('#cornerEndRow [data-endkind="dutch"]'); await pg.waitForTimeout(200);
v = await S();
check('"Dutch gable end": hips part-way, a ridge to the gablet, its barges and head apron, a gutter under it',
  v.filter(s => s.startsWith('hip:1452,')).length === 2 && v.some(s => s.startsWith('apron/head:')) && v.includes('gutter:1452,595>1452,710'), v.join(' '));
await pg.click('#cornerEndRow [data-endkind="hip"]'); await pg.waitForTimeout(200);
check('"Hip end" puts it back as it was built', JSON.stringify(await S()) === JSON.stringify(mainBefore));

// ── a gable: either end, any of the three ──
await pg.evaluate(() => { _closeCornerRepo(); clearAll(true); DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 20;
  DRAW.outline = [[300,200],[900,200],[900,500],[300,500]]; DRAW.outlineDone = true; autoGenerateRoof('gable'); setTool('select'); resetZoom(); redrawAll(); const t = document.getElementById('shiftTip'); if (t) t.remove(); });
await press([900, 500]);
v = await row();
check('a gable\'s corner lists its end with Gable end ticked', v && /East end/i.test(v.text) && v.on === 'gable', JSON.stringify(v));
await pg.click('#cornerEndRow [data-endkind="hip"]'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => DRAW.roofType + ' ' + JSON.stringify(DRAW.hipEnds) + ' ' + DRAW.lines.filter(l => l.type === 'hip').length);
check('…"Hip end" hips just that end', v === 'gable {"finish":"hip"} 2', v);
await press([300, 200]);
await pg.click('#cornerEndRow [data-endkind="hip"]'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => DRAW.roofType + ' ' + JSON.stringify(DRAW.hipEnds) + ' ' + DRAW.lines.filter(l => l.type === 'hip').length);
check('…and both ends hipped IS a hip roof', v === 'hip null 4', v);
await press([300, 200]);
await pg.click('#cornerEndRow [data-endkind="dutch"]'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => DRAW.roofType + ' ' + JSON.stringify(DRAW.hipEnds) + ' ' + DRAW.lines.filter(l => l.type === 'apron' && l.subtype === 'head').length);
check('…a hip roof\'s end made dutch: one dutch, one hip', /^gable \{"(starter|finish)":"hip","(starter|finish)":"dutch"\} 1$/.test(v), v);
await shot('06-rect-dutch-and-hip');

// ── not sure which wall: "Changing which face?" ──
await pg.evaluate(() => { _closeCornerRepo(); clearAll(true); DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 20;
  DRAW.outline = [[400,150],[800,150],[800,550],[400,550]]; DRAW.outlineDone = true; autoGenerateRoof('hip'); setTool('select'); resetZoom(); redrawAll(); const t = document.getElementById('shiftTip'); if (t) t.remove(); });
await press([800, 150]);
v = await row();
check('a square hip roof\'s corner asks what to change it to first', v && /Change an end to/i.test(v.text) && /Gable end/.test(v.text), JSON.stringify(v));
const sqBefore = await S();
await pg.click('#cornerEndRow [data-endkind="gable"]'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const c = document.getElementById('endFaceChooser'); if (!c) return null;
  const r = c.getBoundingClientRect(), cv = document.getElementById('roofCanvas').getBoundingClientRect();
  const over = !(r.right <= cv.left || r.left >= cv.right || r.bottom <= cv.top || r.top >= cv.bottom);
  return { text: c.innerText.replace(/\s+/g, ' ').trim(), faces: [...c.querySelectorAll('.efc-btn')].map(x => x.dataset.face).join(), over }; });
check('…then a small window "Changing which face?" with North and East', v && /Changing which face\?/.test(v.text) && v.faces === 'East,North', JSON.stringify(v));
check('…sitting off the canvas', v && !v.over, JSON.stringify(v));
await pg.hover('#endFaceChooser .efc-btn[data-face="East"]'); await pg.waitForTimeout(150);
const hE = await S();
check('hovering "East" draws the east end as a gable', hE.some(s => /^barge(\/\w+)?:(800,150>800,350|800,350>800,150)$/.test(s)) && hE.filter(s => s.startsWith('hip')).length === 2, hE.join(' '));
await shot('07-chooser-hover-east');
await pg.hover('#endFaceChooser .efc-btn[data-face="North"]'); await pg.waitForTimeout(150);
const hN = await S();
check('hovering "North" draws the north end as a gable instead', hN.some(s => /^barge(\/\w+)?:(600,150>800,150|800,150>600,150)$/.test(s)) && hN.filter(s => s.startsWith('hip')).length === 2, hN.join(' '));
await shot('08-chooser-hover-north');
await pg.mouse.move(5, 5); await pg.waitForTimeout(120);
check('…moving off puts it back', JSON.stringify(await S()) === JSON.stringify(sqBefore));
// the canvas still drags with the window open
v = await pg.evaluate(() => [IMG_OFFSET.x, IMG_OFFSET.y].join());
const cvr = await pg.evaluate(() => { const r = document.getElementById('roofCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.8 }; });
await pg.mouse.move(cvr.x, cvr.y); await pg.mouse.down(); await pg.mouse.move(cvr.x - 60, cvr.y - 30, { steps: 6 }); await pg.mouse.up();
await pg.waitForTimeout(150);
const v2 = await pg.evaluate(() => [IMG_OFFSET.x, IMG_OFFSET.y].join() + ' ' + !!document.getElementById('endFaceChooser'));
check('the canvas still drags while it is open, and it stays open', v2.split(' ')[0] !== v && v2.endsWith('true'), v + ' → ' + v2);
await pg.click('#endFaceChooser .efc-btn[data-face="North"]'); await pg.waitForTimeout(200);
v = await pg.evaluate(() => DRAW.roofType + ' ' + DRAW.lines.filter(l => l.type === 'barge').length + ' ' + !!document.getElementById('endFaceChooser'));
check('clicking "North" makes the north end a gable and closes the window', v === 'gable 2 false', v);
await shot('09-square-north-gable');

// ── an L hip & valley: an end at a time ──
v = await pg.evaluate(() => { clearAll(true); DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 20;
  DRAW.outline = [[300,150],[700,150],[700,350],[500,350],[500,550],[300,550]]; DRAW.outlineDone = true; autoGenerateRoof('hip');
  const c = _cornerEndCands(4); c[0].apply('dutch'); return c[0].face + ' ' + JSON.stringify(DRAW.endKinds) + ' ' + DRAW.lines.filter(l => l.type === 'apron').length; });
check('an L\'s wing end (south) can be made dutch on its own', v === 'South {"e:4-5":"dutch"} 1', v);

// ── a plain roof is drawn exactly as before ──
v = await pg.evaluate(() => {
  const ol = [[300,150],[700,150],[700,350],[500,350],[500,550],[300,550]];
  DRAW.endKinds = null;
  return JSON.stringify(_hipLinesWithEnds(ol.map(p => p.slice()))) === JSON.stringify(_hipLinesWithBumps(ol.map(p => p.slice()))) &&
         JSON.stringify(_dutchLinesWithEnds(ol.map(p => p.slice()))) === JSON.stringify(buildDutchGableRoofLines(ol.map(p => p.slice()))) &&
         JSON.stringify(_monoLinesWithEnds(ol.map(p => p.slice()), 0)) === JSON.stringify(buildMonoPitchRoofLines(ol.map(p => p.slice()), 0));
});
check('with no end changed, hip, dutch and mono roofs are built exactly as before', v);

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
