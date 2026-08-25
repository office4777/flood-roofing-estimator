// "I still can't edit any of the line items in the job pack. I need to be
//  able to edit or delete every possible item, and add rows in each section."
//
// Reported three times. Two separate causes, and the second one is why the
// first two fixes never landed:
//
//   1. Real gaps. Underlay and Screws could only delete lines after the
//      first; Rivets, Droppers and Brackets could be re-quantified but never
//      taken off (typing 0 is not the same — a 0 still prints as a line the
//      merchant reads past); the clearlite auto rows were plain text; and the
//      back-tray cards had no quantity, no length and no delete at all.
//
//   2. A mode you could be stranded in. Preview made every input on the page
//      pointer-events:none, and the preference was saved for good — so a
//      roofer who switched to it once opened the job pack ever after, tapped
//      a quantity, nothing happened, and concluded it could not be edited.
//      Preview is gone: the printed treatment is applied automatically, for
//      the length of the capture, by Save as PDF / Print / Fergus / Order.
//
// …and one more that would have kept it invisible on site: the row deletes
// were opacity:0 until hover, and a tablet has no hover.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
// The state the complaint came from: a browser that has Preview saved.
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_jp_preview','1');
  localStorage.setItem('fr_jp_gutter_include','1');
  localStorage.removeItem('fr_underlay_lines'); localStorage.removeItem('fr_screw_lines'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.penetrations = [{ type:'penetration', penType:'pipe', cx:960, cy:360, sizeLabel:'100', backTrayMode:'full' }];
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  DRAW.clearlites = [{ cx:960, cy:340, mode:'short', lenM:2.4 }];
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(3200);

// ── the mode is gone ───────────────────────────────────────────────
const mode = await pg.evaluate(() => ({
  cls: document.documentElement.classList.contains('jp-preview'),
  pref: localStorage.getItem('fr_jp_preview'),
  btn: !!document.getElementById('jpPreviewBtn'),
  // Nothing left on the toolbar that talks about preview at all.
  toolbar: (document.getElementById('jpToolbar')||{}).innerText || '',
}));
check('a browser with Preview saved no longer opens locked', !mode.cls, 'jp-preview=' + mode.cls);
check('…and the stale preference is cleared rather than honoured',
  mode.pref === null, 'stored=' + mode.pref);
check('…and there is no Preview / Edit button to get stranded on', !mode.btn);
check('…nor any mention of it on the toolbar', !/preview/i.test(mode.toolbar), mode.toolbar.slice(0,120));

// ── every section: edit, delete, add ───────────────────────────────
const sections = await pg.evaluate(() => {
  return [...document.querySelectorAll('#jpPages .mat-section')].map(sec => {
    const h = sec.querySelector('h3');
    const inputs = [...sec.querySelectorAll('input[type=number], input[type=text]')];
    return {
      title: (h ? h.textContent.trim() : '(none)'),
      inputs: inputs.length,
      // An input the page has deliberately frozen is not an editable input.
      live: inputs.filter(i => getComputedStyle(i).pointerEvents !== 'none').length,
      dels: sec.querySelectorAll('[onclick*="Delete"],[onclick*="Remove"],[onclick*="Hide"],[onclick*="SetOff"],[title*="Delete"],[title*="Remove"]').length,
      adds: sec.querySelectorAll('.mat-add-btn').length,
    };
  });
});
const want = ['Roof sheets','Clearlite sheets','Ridging','Gutters','Underlay','Screws & Rivets','Dektites','Flashings','Back-trays'];
want.forEach(name => {
  const s = sections.find(x => x.title.startsWith(name));
  check('  ' + name + ' — every value can be typed into',
    !!s && s.inputs > 0 && s.live === s.inputs,
    s ? (s.live + ' of ' + s.inputs + ' live') : 'section missing');
  check('    …something in it can be deleted', !!s && s.dels > 0, s ? (s.dels + ' deletes') : '—');
  check('    …and a row can be added', !!s && s.adds > 0, s ? (s.adds + ' add buttons') : '—');
});

// ── the deletes are visible without a mouse ────────────────────────
const vis = await pg.evaluate(() => {
  const d = document.querySelector('#jpPages .mat-list-del');
  return d ? parseFloat(getComputedStyle(d).opacity) : -1;
});
check('a row delete is visible at rest — a tablet has no hover to reveal it',
  vis > 0.2, 'opacity ' + vis);

// ── the gaps that were reported, one at a time ─────────────────────
const first = await pg.evaluate(() => {
  const before = _matUnderlayLinesGet().length;
  _matTypedLineRemove('fr_underlay_lines', _matUnderlayLinesGet, 0);
  const after = _matUnderlayLinesGet().length;
  _matTypedLineAdd('fr_underlay_lines', _matUnderlayLinesGet, UNDERLAY_TYPES[0].name, 1);
  return { before, after, back: _matUnderlayLinesGet().length };
});
check('the FIRST underlay line can be deleted, not just the ones after it',
  first.before === 1 && first.after === 0, JSON.stringify(first));
check('…and the list is allowed to stay empty rather than re-seeding itself',
  first.after === 0 && first.back === 1, JSON.stringify(first));

const fixed = await pg.evaluate(() => {
  const out = {};
  ['rivets','gutterDroppers','gutterBrackets'].forEach(id => {
    _matRowSetOff(id, true);
    out[id] = { off: _matRowOff(id),
                gone: !document.querySelector('#jpPages [onclick*="_matRowSetOff(\''+id+'\',true)"]'),
                restore: !!document.querySelector('#jpPages [onclick*="_matRowSetOff(\''+id+'\',false)"]') };
    _matRowSetOff(id, false);
    out[id].back = !!document.querySelector('#jpPages [onclick*="_matRowSetOff(\''+id+'\',true)"]');
  });
  return out;
});
['rivets','gutterDroppers','gutterBrackets'].forEach(id => {
  const r = fixed[id];
  check('  ' + id + ' can be taken off the job pack entirely, not just zeroed',
    r.off && r.gone, JSON.stringify(r));
  check('    …with a restore, so it is never a one-way door', r.restore && r.back, JSON.stringify(r));
});

const clr = await pg.evaluate(() => {
  const rows = _clearOrderRows().rows;
  if (!rows.length) return { skip: true };
  const k = rows[0].origKey;
  _clearRowSet('Qty', k, 7);
  const q = _clearOrderRows().rows.find(r => r.origKey === k);
  _clearRowSet('Len', k, 3.3);
  const l = _clearOrderRows().rows.find(r => r.origKey === k);
  _clearRowHide(k);
  const gone = !_clearOrderRows().rows.some(r => r.origKey === k);
  const restore = !!document.querySelector('#jpPages [onclick*="_clearRowShow"]');
  _clearRowShow(k);
  return { qty: q && q.qty, len: l && l.len, gone, restore,
           back: _clearOrderRows().rows.some(r => r.origKey === k) };
});
check('a clearlite row can be re-quantified', clr.skip || clr.qty === 7, JSON.stringify(clr));
check('…re-lengthed', clr.skip || Math.abs(clr.len - 3.3) < 1e-9, JSON.stringify(clr));
check('…deleted, and put back', clr.skip || (clr.gone && clr.restore && clr.back), JSON.stringify(clr));

const bt = await pg.evaluate(() => {
  const list = _backTrayPenList();
  if (!list.length) return { skip: true };
  const k = _btKey(list[0]);
  _btSet('Qty', k, 3); _btSet('Len', k, 1.8);
  const q = _btQtyOf(list[0]), l = _btLenOf(list[0]);
  _btSetOff(k, true);
  const gone = _btOff(list[0]);
  const restore = !!document.querySelector('#jpPages [onclick*="_btSetOff"][onclick*="false"]');
  _btSetOff(k, false);
  _btExtraAdd();
  const extras = _btExtras().length;
  _btExtraDelete(0);
  return { q, l, gone, restore, extras, afterDel: _btExtras().length };
});
check('a back-tray can be re-quantified and re-lengthed',
  bt.skip || (bt.q === 3 && Math.abs(bt.l - 1.8) < 1e-9), JSON.stringify(bt));
check('…taken off the job, with a restore', bt.skip || (bt.gone && bt.restore), JSON.stringify(bt));
check('…and one can be added by hand and deleted again',
  bt.skip || (bt.extras === 1 && bt.afterDel === 0), JSON.stringify(bt));

// ── all of it saves with the job ───────────────────────────────────
const saved = await pg.evaluate(() => {
  _matRowSetOff('rivets', true);
  _btExtraAdd();
  const snap = snapshotCurrentJob();
  const d = snap.draw || {};
  return { rowOff: !!(d.matRowOff && d.matRowOff.rivets),
           btExtras: (d.matBackTrayExtras || []).length,
           btQty: !!d.matBackTrayQty, clearRows: !!d.matClearRowQty };
});
check('the removals and hand-typed rows all save with the job',
  saved.rowOff && saved.btExtras === 1 && saved.btQty && saved.clearRows,
  JSON.stringify(saved));

// ── and the printed version still comes out printed ────────────────
// This is the half that could quietly break: the editing furniture used to be
// stripped because Preview was on when you hit Save as PDF. With Preview gone
// the capture has to do it itself.
await pg.emulateMedia({ media: 'print' });
const paper = await pg.evaluate(() => {
  // Give it a genuinely empty section to collapse: strike the only back-tray
  // off and clear the hand-typed ones, so the band has a heading and nothing
  // under it. That is the case that used to print as an orange bullet over
  // white space.
  const list = _backTrayPenList();
  list.forEach(x => _btSetOff(_btKey(x), true));
  while (_btExtras().length) _btExtraDelete(0);
  const el = document.documentElement;
  el.classList.add('print-jobpack'); el.classList.add('pdf-rendering');
  try { _jpMarkEmptySections(true); } catch(e){}
  const vis = s => [...document.querySelectorAll('#jpPages ' + s)]
    .filter(e => e.getClientRects().length > 0).length;
  const out = {
    adds: vis('.mat-add-btn'),
    dels: vis('.mat-list-del'),
    restores: vis('[onclick*="_matRowSetOff"][onclick*="false"]'),
    // …and an empty section still collapses rather than printing a bare
    // heading over white space.
    emptyFlagged: document.querySelectorAll('#jpPages .mat-section.is-empty-section').length,
    rows: vis('.mat-list-row'),
  };
  el.classList.remove('print-jobpack'); el.classList.remove('pdf-rendering');
  try { _jpMarkEmptySections(false); } catch(e){}
  return out;
});
await pg.emulateMedia({ media: 'screen' });
check('the PDF still drops every add / delete / restore control',
  paper.adds === 0 && paper.dels === 0 && paper.restores === 0, JSON.stringify(paper));
check('…still carries the actual order rows', paper.rows > 0, paper.rows + ' rows');
check('…and still collapses empty sections without Preview to do it',
  paper.emptyFlagged > 0, paper.emptyFlagged + ' flagged');
// Put it back so the last check sees the ordinary page.
await pg.evaluate(() => { _backTrayPenList().forEach(x => _btSetOff(_btKey(x), false)); });
await pg.waitForTimeout(300);

// Back on screen, everything is editable again — the capture must not leave
// the page in the printed state.
const after = await pg.evaluate(() => {
  const inputs = [...document.querySelectorAll('#jpPages input[type=number]')];
  return { n: inputs.length,
           live: inputs.filter(i => getComputedStyle(i).pointerEvents !== 'none').length,
           flagged: document.querySelectorAll('#jpPages .mat-section.is-empty-section').length };
});
check('and the page is fully editable again the moment the capture is done',
  after.n > 0 && after.live === after.n && after.flagged === 0, JSON.stringify(after));

check('none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
