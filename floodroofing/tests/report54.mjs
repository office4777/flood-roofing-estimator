// Feedback report 54: "job pack doesn't reflect the 5-Rib 2nd roof and
// Corrugate main roof" — a 15° corrugate main roof, a 3° 5-Rib lean-to and a
// clear roof, and the job pack listed them as ONE sheet list. With only
// Roof 2 picked it showed 1 @ 5.50, 1 @ 4.76, 1 @ 3.69: the main roof's map
// labels were treated as bump-outs on Roof 2 and peeled its nine sheets
// down to one, the main roof was still on the map, and Roof 3's clearlite
// was still on the list.
//
// Pinned here: one sheet section per roof the pack covers, named after the
// roof; the pack follows the quote (main + folded + an optional roof once the
// customer adds it) until picked by hand, and the pick is saved with the
// job; the map, the clearlite and the sheets follow the pick; a quantity
// typed on one roof's list stays on that roof; and all of it survives a
// save + reopen — the cut-list edits never used to.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The geometry from the report, verbatim.
const GEOM = {"v":1,"scaleMetresPerPx":0.0639223435261572,"scaleAuto":false,"geoScale":null,"calPitch":3,
"profile":"5-Rib","outline":[[1168,664],[1168,741],[1191,741],[1191,664]],
"lines":[{"type":"apron","pts":[[1191,741],[1191,664]],"measM":4.9},{"type":"barge",
"pts":[[1191,664],[1168,664]],"measM":1.49},{"type":"gutter","pts":[[1168,664],[1168,741]],
"measM":4.9},{"type":"barge","pts":[[1168,741],[1191,741]],"measM":1.49}],"penetrations":[],
"roofs":[{"name":"Main Roof","outline":[[1212,548],[1212,648],[1191,648],[1191,759],[1356,759],
[1356,548]],"lines":[{"type":"hip","pts":[[1356,548],[1284,620]],"measM":6.62},{"type":"hip",
"pts":[[1356,759],[1284,687]],"measM":6.62},{"type":"hip","pts":[[1191,759],[1247,703]],
"measM":5.13},{"type":"hip","pts":[[1191,648],[1247,703]],"measM":5.13},{"type":"valley",
"pts":[[1212,648],[1267,703]],"measM":5.13},{"type":"hip","pts":[[1212,548],[1284,620]],
"measM":6.62},{"type":"ridge","pts":[[1247,703],[1267,703]],"measM":1.34},{"type":"hip",
"pts":[[1267,703],[1284,687]],"measM":1.5},{"type":"ridge","pts":[[1284,620],[1284,687]],
"measM":4.3},{"type":"gutter","pts":[[1212,548],[1212,648]],"measM":6.38},{"type":"gutter",
"pts":[[1191,648],[1191,759]],"measM":7.12},{"type":"gutter","pts":[[1191,759],[1356,759]],
"measM":10.54},{"type":"gutter","pts":[[1356,759],[1356,548]],"measM":13.5},{"type":"gutter",
"pts":[[1356,548],[1212,548]],"measM":9.2}],"calPitch":15},{"name":"Roof 2","outline":[[1031,
601],[1031,687],[1131,687],[1131,601]],"lines":[{"type":"apron","pts":[[1031,687],[1131,687]],
"measM":6.38},{"type":"barge","pts":[[1131,687],[1131,601]],"measM":5.5},{"type":"gutter",
"pts":[[1131,601],[1031,601]],"measM":6.38},{"type":"barge","pts":[[1031,601],[1031,687]],
"measM":5.5}],"calPitch":3},{"name":"Roof 3","outline":[[1168,664],[1168,741],[1191,741],[1191,
664]],"lines":[{"type":"apron","pts":[[1191,741],[1191,664]],"measM":4.9},{"type":"barge",
"pts":[[1191,664],[1168,664]],"measM":1.49},{"type":"gutter","pts":[[1168,664],[1168,741]],
"measM":4.9},{"type":"barge","pts":[[1168,741],[1191,741]],"measM":1.49}],"calPitch":3}],
"activeRoofIdx":2};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_jp_gutter_include','1');
  // The old per-computer store, left over from another job: it must not decide anything now.
  localStorage.setItem('fr_mat_selected_roofs', '[2]'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { outlineDone: true, lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.roofs[0].sheetType = 'steel-corrugate';
  DRAW.roofs[1].sheetType = 'steel-5rib';
  DRAW.roofs[2].sheetType = 'clearlite-corrugate';     // roof 3 is the clear one
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.sheetType = 'clearlite-corrugate'; DRAW.showAllRoofs = true;
  S.currentJobId = 'job-54';
  // The quote as the office built it: Roof 2 and Roof 3 are optional extras
  // the customer has not (yet) added.
  if (!S.quote) S.quote = {};
  S.quote.roofSeparate = { 1: true, 2: true }; S.quote.roofExcluded = {};
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions || {}, { extraRoofsSel: {} });
  S.quote.roofMapGeom = { roofs: [ { idx:0, mode:'main', extraPos:null }, { idx:1, mode:'separate', extraPos:0 }, { idx:2, mode:'separate', extraPos:1 } ] };
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(2500);
await pg.evaluate(() => _jpAfterRoofSelChange());
await pg.waitForTimeout(1200);

const read = () => pg.evaluate(() => {
  const secs = [...document.querySelectorAll('#jpPages .mat-section')].map(sec => {
    const h = sec.querySelector('h3');
    const rows = [...sec.querySelectorAll('.mat-list-row')].map(r => {
      const q = r.querySelector('.mat-list-qty input'), l = r.querySelector('.mat-list-len input');
      return { qty: q ? +q.value : null, len: l ? +l.value : null };
    });
    return { title: h ? h.textContent.trim() : '(none)', meta: (sec.querySelector('.meta') || {}).textContent || '', rows };
  });
  const note = (document.getElementById('jpRoofSelNote') || {}).textContent || '';
  return { sel: _matSelectedRoofIndices(), note, secs, sheetSecs: secs.filter(s => / sheets$/i.test(s.title) && !/clearlite/i.test(s.title)),
           clear: secs.filter(s => /clearlite/i.test(s.title)).map(s => s.meta) };
});

// ── following the quote: only the main roof is sold, so only it is packed ──
let v = await read();
check('with the extras not yet added, the pack follows the quote and covers the main roof only',
  JSON.stringify(v.sel) === '[0]', JSON.stringify(v.sel));
check('…the old per-computer roof pick is ignored', JSON.stringify(v.sel) !== '[2]');
check('…and says so under the pills', /Following the quote/.test(v.note), v.note.slice(0, 80));
check('one sheet section, named after the roof, at its own profile and pitch',
  v.sheetSecs.length === 1 && v.sheetSecs[0].title === 'Main Roof sheets' && /Corrugate/.test(v.sheetSecs[0].meta) && /15°/.test(v.sheetSecs[0].meta),
  JSON.stringify(v.sheetSecs.map(s => [s.title, s.meta])));
check('…with no Roof 2 length on it', !v.sheetSecs[0].rows.some(r => Math.abs(r.len - 5.5) < 0.03), JSON.stringify(v.sheetSecs[0].rows));
check('the clear roof the customer has not added is not on the list', v.clear.length === 0, JSON.stringify(v.clear));

// ── the customer adds Roof 2 ──────────────────────────────────────
await pg.evaluate(() => { S.quote.proposalOptions.extraRoofsSel = { 0: true }; _jpAfterRoofSelChange(); });
await pg.waitForTimeout(1200);
v = await read();
check('the customer adds Roof 2 and the pack follows', JSON.stringify(v.sel) === '[0,1]', JSON.stringify(v.sel));
check('two sections now — Main Roof sheets and Roof 2 sheets',
  v.sheetSecs.map(s => s.title).join('|') === 'Main Roof sheets|Roof 2 sheets', v.sheetSecs.map(s => s.title).join('|'));
const r2 = v.sheetSecs[1] || { rows: [] };
check('Roof 2 is 5-Rib at 3°', /5-Rib/.test(r2.meta) && /3°/.test(r2.meta), r2.meta);
check('…and lists its own nine sheets at 5.50 m and nothing of the main roof (was 1 @ 5.50, 1 @ 4.76, 1 @ 3.69)',
  r2.rows.length === 1 && Math.abs(r2.rows[0].len - 5.5) < 0.03 && r2.rows[0].qty === 9, JSON.stringify(r2.rows));
const r1 = v.sheetSecs[0];
check('the main roof keeps its own rows', r1.rows.length >= 2 && !r1.rows.some(r => Math.abs(r.len - 5.5) < 0.03), JSON.stringify(r1.rows));

// ── picked by hand: Roof 2 only ───────────────────────────────────
await pg.evaluate(() => _jpToggleRoof(0));
await pg.waitForTimeout(1200);
v = await read();
check('unticking the main roof leaves Roof 2 alone', JSON.stringify(v.sel) === '[1]', JSON.stringify(v.sel));
check('…and is saved on the job, with a way back to the quote', /Picked by hand/.test(v.note) && /Follow the quote/.test(v.note), v.note.slice(0, 60));
check('…one section: Roof 2 sheets, nine at 5.50', v.sheetSecs.length === 1 && v.sheetSecs[0].title === 'Roof 2 sheets' &&
  v.sheetSecs[0].rows.length === 1 && v.sheetSecs[0].rows[0].qty === 9, JSON.stringify(v.sheetSecs.map(s => [s.title, s.rows])));
const map = await pg.evaluate(() => {
  const filt = _jpMapRoofFilter();
  // The header page's map pictures narrow the drawing to the pack's roofs.
  const narrowed = _jpWithRoofsNarrowed(filt, () => _matBasicCollectRoofs().map(r => r.name));
  const all = _matBasicCollectRoofs().map(r => r.name);
  return { filt, narrowed, all };
});
check('the job pack map shows Roof 2 only (the main roof used to stay on it)',
  JSON.stringify(map.filt) === '[1]' && JSON.stringify(map.narrowed) === '["Roof 2"]' && map.all.length === 3, JSON.stringify(map));

// ── all roofs: the clear roof comes back, under Clearlite ─────────
await pg.evaluate(() => _jpSelectAllRoofs());
await pg.waitForTimeout(1200);
v = await read();
check('all roofs: a steel section per steel roof, the clear roof under Clearlite sheets',
  v.sheetSecs.map(s => s.title).join('|') === 'Main Roof sheets|Roof 2 sheets' && v.clear.length === 1 && /Roof 3/.test(v.clear[0]),
  v.sheetSecs.map(s => s.title).join('|') + ' / ' + JSON.stringify(v.clear));
check('…and no map filter when every roof is in', await pg.evaluate(() => _jpMapRoofFilter() === null));

// ── a quantity typed on one roof's list stays on that roof ─────────
const edit = await pg.evaluate(() => {
  const r2 = _jpSheetScope(1, () => _jpBuildSheetRows(window._lastSheetCountsByRoof[1]))[0];
  _jpSheetScoped(1, '_jpSheetSetQty', r2.origLen, '4');
  return { orig: r2.origLen, byRoof: DRAW.matSheetByRoof[1].sheetGroupQtyOverrides, jobLevel: DRAW.sheetGroupQtyOverrides, frozen: !!DRAW.matSheetByRoof[1].matSheetFrozen };
});
await pg.waitForTimeout(600);
v = await read();
check('typing 4 on Roof 2 changes Roof 2', v.sheetSecs[1].rows[0].qty === 4, JSON.stringify(v.sheetSecs[1].rows));
check('…not the main roof', JSON.stringify(v.sheetSecs[0].rows) === JSON.stringify(r1.rows), JSON.stringify(v.sheetSecs[0].rows));
check('…and lives in Roof 2’s own store, frozen there', edit.byRoof[edit.orig] === 4 && !Object.keys(edit.jobLevel || {}).length && edit.frozen, JSON.stringify(edit));

// ── the order confirmation and the supplier order read the same sections ──
const oc = await pg.evaluate(() => _ocCutSummary());
check('the order confirmation lists the sheets a roof at a time', /Main Roof sheets/.test(oc) && /Roof 2 sheets/.test(oc) && /4 ×/.test(oc), oc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
const fb = await pg.evaluate(() => { const p = _roofGeometryPayload(); return p.cutList; });
check('the feedback report carries the per-roof lists and the roof pick', Array.isArray(fb.byRoof) && fb.byRoof.length === 2 && fb.byRoof[1].title === 'Roof 2 sheets' && JSON.stringify(fb.roofSel) === '[0,1,2]', JSON.stringify(fb.byRoof));

// ── save + reopen: the pick and the typed quantity come back ──────
const rt = await pg.evaluate(() => {
  _jpToggleRoof(2);                                  // hand pick: main + Roof 2
  _lkgGuard._readOnly = true; const snap = JSON.parse(JSON.stringify(snapshotCurrentJob())); _lkgGuard._readOnly = false;
  // Wipe what the reload would lose, then bring the job back.
  DRAW.matSheetByRoof = {}; DRAW.sheetGroupQtyOverrides = { 999: 1 }; S.jobPack = null;
  restoreFromJob({ id: 'job-54', draw_state: snap });
  _jpAfterRoofSelChange();
  return { saved: snap.state.jobPack && snap.state.jobPack.roofSel, savedByRoof: !!(snap.draw.matSheetByRoof && snap.draw.matSheetByRoof[1]),
           savedKeys: ['sheetGroupQtyOverrides','matSheetFrozen','matSheetExtras','matSheetRowHidden','manualSheetMeasures','sheetOverrides'].filter(k => k in snap.draw),
           sel: _matSelectedRoofIndices(), jobLevel: DRAW.sheetGroupQtyOverrides, byRoof: DRAW.matSheetByRoof[1] && DRAW.matSheetByRoof[1].sheetGroupQtyOverrides };
});
await pg.waitForTimeout(1200);
v = await read();
check('the roof pick is saved with the job and comes back', JSON.stringify(rt.saved) === '[0,1]' && JSON.stringify(rt.sel) === '[0,1]', JSON.stringify([rt.saved, rt.sel]));
check('the cut-list edits are saved with the job (they never were)', rt.savedKeys.length === 6 && rt.savedByRoof, JSON.stringify(rt.savedKeys));
check('…and the typed quantity is back on Roof 2 after the reopen', v.sheetSecs.length === 2 && v.sheetSecs[1].rows[0].qty === 4 && !rt.jobLevel[999], JSON.stringify(v.sheetSecs.map(s => s.rows)));

// ── a single-roof job is exactly as it was ─────────────────────────
const single = await pg.evaluate(() => {
  DRAW.roofs = [DRAW.roofs[0]]; DRAW.activeRoofIdx = 0; _loadRoofToCurrent(0); DRAW.matSheetByRoof = {}; S.jobPack = null;
  try { redrawAll(); } catch(e){}
  _jpAfterRoofSelChange();
  const secs = [...document.querySelectorAll('#jpPages .mat-section h3')].map(h => h.textContent.trim());
  return { secs, list: _jpSheetRoofList(), picker: !!document.querySelector('.jp-roof-picker') };
});
check('a single-roof job still says "Roof sheets", with no pills', single.secs[0] === 'Roof sheets' && single.list.length === 0 && !single.picker, JSON.stringify(single));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
