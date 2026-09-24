// The owner, 2026-09-24, on the panel a roof button opens: "all very messy,
// tidy it up, remove the suggested roof type just have one row of buttons,
// change 'clear lines' to 'delete roof' and add a 'make main Roof' … move the
// rotate 90deg … the roof pitch in line with other buttons … remove the
// 'measure' button … also remove the 'calibrate' buttons, the user should
// just click on a measure to calibrate the scale … move the 'sheet' … into
// the roof button".
//
// Pinned: the panel is one row with the shape, Rotate 90°, Snap square, the
// pitch, the sheet, Make main roof and Delete roof, and no "Suggested" line;
// the toolbar has no Measure and — once there is a scale — no Calibrate
// (a Set scale shows only before there is one); Make main roof swaps the
// roof into first place and every setting kept by roof number goes with it;
// Delete roof takes its own settings with it and leaves the others on the
// roofs they belong to.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report41.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
const load = () => pg.evaluate((g) => {
  gotoTab('roof');
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map((r, i) => Object.assign({}, r, { name: i === 0 ? 'Main Roof' : 'Roof ' + (i + 1), lines: (r.lines || []).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); _renderRoofMenuBar(); _scaleStateShow(); } catch(e){}
  // The photos pop-out narrows the page and the row then wraps, as it should;
  // the one-row check is about a normal screen.
  try { _fergusPanelClose(); } catch(e){}
  if (!S.quote) S.quote = defaultQuote();
}, GEOM);
await load();
await pg.waitForTimeout(500);

// ── the panel: one row ──
const panel = await pg.evaluate(() => {
  _toggleRoofMenu(0);
  const p = document.getElementById('roofTypePanel');
  const row = p.querySelector('.rtp-row');
  const has = (sel) => !!row.querySelector(sel);
  const txt = p.textContent.replace(/\s+/g, ' ');
  const btns = [...row.querySelectorAll('button')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent.trim());
  const tops = new Set([...row.children].filter(x => getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().width > 0).map(x => { const r = x.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 12); }));
  return { shown: getComputedStyle(p).display !== 'none', type: has('#roofTypeDropBtn'), rotate: has('#roofRotateRow button'), snap: /Snap square/.test(txt),
    pitch: has('#roofPitchInput'), show: has('#roofPitchShowBtn'), sheet: has('#roofSheetType'), del: has('#roofDeleteBtn'), mk: has('#roofMakeMainBtn'),
    suggested: /Suggested/.test(txt), clearLines: /Clear lines/.test(txt), btns, rows: tops.size, heading: document.getElementById('roofTypeHeading').textContent,
    mainTag: getComputedStyle(document.getElementById('roofIsMainTag')).display !== 'none', mkShown: getComputedStyle(document.getElementById('roofMakeMainBtn')).display !== 'none' };
});
check('a roof button opens one row: shape, Rotate 90°, Snap square, pitch + Show on roof, sheet, Delete roof', panel.shown && panel.type && panel.rotate && panel.snap && panel.pitch && panel.show && panel.sheet && panel.del && panel.rows === 1, JSON.stringify(panel));
check('…with no "Suggested" line and no "Clear lines"', !panel.suggested && !panel.clearLines, JSON.stringify(panel.btns));
check('…headed with the roof’s name; on the main roof a "Main roof" tag stands where Make main roof would be', /Main Roof/.test(panel.heading) && panel.mainTag && !panel.mkShown, JSON.stringify(panel));
const other = await pg.evaluate(() => { _toggleRoofMenu(2); return { mk: getComputedStyle(document.getElementById('roofMakeMainBtn')).display !== 'none', tag: getComputedStyle(document.getElementById('roofIsMainTag')).display !== 'none', heading: document.getElementById('roofTypeHeading').textContent }; });
check('…and on another roof, Make main roof is offered', other.mk && !other.tag && /Roof 3/.test(other.heading), JSON.stringify(other));

// ── the toolbar ──
const bar = await pg.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
  const out = { measure: vis('btn-select'), cal: vis('btn-calibrate'), sheetOnBar: !!document.querySelector('#roofToolRow #roofSheetType'), state: document.getElementById('scaleState').textContent };
  const keep = DRAW.scaleMetresPerPx; DRAW.scaleMetresPerPx = 0; _scaleStateShow();
  out.noScaleCal = vis('btn-calibrate'); out.noScaleLabel = document.getElementById('btn-calibrate').textContent;
  DRAW.scaleMetresPerPx = keep; _scaleStateShow();
  return out;
});
check('the toolbar has no Measure button and, with a scale, no Calibrate; the Sheet picker has left it', !bar.measure && !bar.cal && !bar.sheetOnBar, JSON.stringify(bar));
check('…the scale line says a click on any measurement corrects it', /click any measurement/.test(bar.state), bar.state);
check('…and only while there is NO scale does a "Set scale" button show', bar.noScaleCal && /Set scale/.test(bar.noScaleLabel), JSON.stringify(bar));

// ── Make main roof: the roof and everything kept by its number go together ──
const mk = await pg.evaluate(() => {
  const q = S.quote;
  // Roof 3 (index 2): its own scaffold, hours, buffer, a separate optional roof the customer took.
  q.scaffold = { type: 'edge', price: 1111, cost: 900 }; q.scaffoldCustom = true;   // typed by hand, so Settings does not re-price it
  q.roofScaffold = { 2: { type: 'platform', price: 3333, cost: 2800 } };
  q.labour = Object.assign(q.labour || {}, { leadHrs: 10, appHrs: 10 });
  q.roofLabour = { 2: { leadHrs: 30, appHrs: 30 } };
  q.labourHrsManual = { 2: true };
  q.roofSeparate = { 1: false, 2: true, 3: true, 4: false }; q.roofExcluded = { 4: true };
  q.proposalOptions = Object.assign(q.proposalOptions || {}, { extraRoofsSel: { 0: true } });   // roofs 2,3 are optional; the customer took roof index 2
  const o2 = JSON.stringify(DRAW.roofs[2].outline), o0 = JSON.stringify(DRAW.roofs[0].outline);
  makeMainRoof(2);
  return { r0: JSON.stringify(DRAW.roofs[0].outline) === o2, r2: JSON.stringify(DRAW.roofs[2].outline) === o0,
    names: DRAW.roofs.map(r => r.name), scaffold: q.scaffold.price, oldMainScaffold: (q.roofScaffold[2] || {}).price,
    hours: q.labour.leadHrs, manualMain: !!q.labourHrsManual[0], modes: DRAW.roofs.map((r, i) => _roofQuoteMode(i)),
    extraSel: JSON.stringify(q.proposalOptions.extraRoofsSel), sep: _roofSepIdxs() };
});
check('Make main roof puts that roof first and the old main roof in its place', mk.r0 && mk.r2 && mk.names[0] === 'Main Roof' && mk.names[2] === 'Roof 3', JSON.stringify(mk.names));
check('…its scaffold, labour hours and manual-hours flag come with it', mk.scaffold === 3333 && mk.oldMainScaffold === 1111 && mk.hours === 30 && mk.manualMain, JSON.stringify(mk));
check('…the old main roof takes its quote mode (an optional extra), the rest keep theirs', mk.modes[0] === 'main' && mk.modes[2] === 'separate' && mk.modes[4] === 'excluded' && mk.modes[1] === 'folded', JSON.stringify(mk.modes));
check('…and a customer pick stays on the roof it was made for (the old main roof is now the first optional one, roof 4 the second)', JSON.stringify(mk.sep) === '[2,3]' && mk.extraSel === '{}', JSON.stringify({ sep: mk.sep, sel: mk.extraSel }));

// ── Delete roof: its settings go with it; the others stay on their roofs ──
await load();
const del = await pg.evaluate(() => {
  const q = S.quote;
  q.roofScaffold = { 1: { price: 111 }, 2: { price: 222 }, 3: { price: 333 } };
  q.roofLabour = { 1: { leadHrs: 1, appHrs: 1 }, 2: { leadHrs: 2, appHrs: 2 }, 3: { leadHrs: 3, appHrs: 3 } };
  q.labourHrsManual = { 1: true, 2: true, 3: true };   // typed hours — hours worked out from the drawing are recalculated anyway
  q.roofSeparate = { 1: true, 2: true, 3: false }; q.roofExcluded = { 4: true };
  DRAW.matSheetByRoof = { 1: 'one', 2: 'two', 3: 'three' };
  DRAW.matBackTrayLen = { '1:0': 1.1, '2:0': 2.2, '3:0': 3.3 };
  S.jobPack = { roofSel: [0, 2, 3] };
  const o3 = JSON.stringify(DRAW.roofs[3].outline);
  deleteRoof(1);
  const price = (o) => JSON.stringify(Object.keys(o || {}).sort().reduce((a, k) => (a[k] = o[k].price, a), {}));
  return { n: DRAW.roofs.length, moved: JSON.stringify(DRAW.roofs[2].outline) === o3, scaf: price(q.roofScaffold),
    lab: JSON.stringify([q.roofLabour[1] && q.roofLabour[1].leadHrs, q.roofLabour[2] && q.roofLabour[2].leadHrs]), manual: JSON.stringify(q.labourHrsManual),
    modes: DRAW.roofs.map((r, i) => _roofQuoteMode(i)), freeze: JSON.stringify(DRAW.matSheetByRoof), bt: JSON.stringify(DRAW.matBackTrayLen), sel: JSON.stringify(S.jobPack.roofSel) };
});
check('Delete roof removes that roof, and the roofs after it move up one', del.n === 4 && del.moved, JSON.stringify(del));
check('…taking its own scaffold, hours, cut-list freeze and back-tray edits with it — the others stay on their roofs',
  del.scaf === '{"1":222,"2":333}' && del.lab === '[2,3]' && del.manual === '{"1":true,"2":true}' && del.freeze === '{"1":"two","2":"three"}' && del.bt === '{"1:0":2.2,"2:0":3.3}',
  JSON.stringify(del));
check('…and the quote modes and the job pack’s roof pick follow their roofs', JSON.stringify(del.modes) === '["main","separate","folded","excluded"]' && del.sel === '[0,1,2]', JSON.stringify({ modes: del.modes, sel: del.sel }));

// ── an interior line's measurement (a ridge, hip or valley) corrects the scale too ──
await load();
const hip = await pg.evaluate(() => {
  // An interior line — one not lying on an outline wall — opens the line popup.
  const li = DRAW.lines.findIndex(l => l && l.pts && l.pts.length === 2 && !_outlineEdgeForSegment(l.pts[0], l.pts[1]) && l.measM > 0);
  if (li < 0) return { none: true };
  const l = DRAW.lines[li];
  const before = { outline: JSON.stringify(DRAW.outline), pts: JSON.stringify(DRAW.lines.map(x => x.pts)), scale: DRAW.scaleMetresPerPx, m: l.measM };
  DRAW.editMode = 'scaled';
  // Unchanged number (the popup pre-fills it): nothing happens to the scale.
  promptLineMeasurement(li); document.getElementById('lineMeasInput').value = String(l.measM); confirmLineMeas();
  const same = DRAW.scaleMetresPerPx === before.scale;
  promptLineMeasurement(li); document.getElementById('lineMeasInput').value = '7.25'; confirmLineMeas();
  return { same, moved: JSON.stringify(DRAW.outline) !== before.outline || JSON.stringify(DRAW.lines.map(x => x.pts)) !== before.pts,
    scaled: DRAW.scaleMetresPerPx !== before.scale, reads: DRAW.lines[li].measM };
});
check('typing an interior line’s real length (ridge, hip, valley) corrects the scale — the hip reads it and no point of the drawing moves', !hip.none && hip.scaled && !hip.moved && Math.abs(hip.reads - 7.25) < 0.011, JSON.stringify(hip));
check('…while confirming the number it already reads leaves the scale alone', hip.same, JSON.stringify(hip));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
