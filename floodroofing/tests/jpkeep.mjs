// THE JOB PACK KEEPS WHAT THE OFFICE TYPED (2026-11-08, the owner: "I'm
// making some changes in the job pack, changes from the quantities that were
// auto-calculated, and after I've made those custom edits and then go back to
// the roof map ... and then back into the job pack, my custom edits have
// disappeared ... even if I click back into the job pack and move a corner or
// adjust anything ... my custom saved edits should still be there").
//
// Two faults, both on the flashing cards:
//   1. A row grouping several lines of one length carries NO letter (four
//      hips at 6.90 m on one row), and _matInlineMatchesFor demanded the
//      row's blank letter equal each line's own ("A", "B" …) — so it found no
//      line, the typed length was written nowhere, and the next render put
//      the calculated figure back. The box showed the edit until then.
//   2. An override is keyed by the line's end points, so moving a corner left
//      it on a key no line has. Each line with no override of its own now
//      takes the nearest orphan of its own type.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1600, height:1100 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route(/^https?:\/\//, r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// An 18 × 10.5 m plain hip at 0.03 m a pixel: four hips on one row.
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[200,150],[800,150],[800,500],[200,500]]; finishCurrent();
  document.querySelectorAll('#_rsModal,.rs-drop').forEach(e => e.remove());
  DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); setTool('select');
});
const toPack = async () => { await pg.evaluate(() => gotoTab('materials')); await pg.waitForTimeout(1800); };
const toRoof = async () => { await pg.evaluate(() => gotoTab('roof')); await pg.waitForTimeout(900); };
const hipRows = () => pg.evaluate(() => [...document.querySelectorAll('#tab-materials input[onchange^="_matInlineSetLength"]')]
  .filter(i => i.offsetParent && /^ridgehip::/.test(i.getAttribute('data-cl-row') || ''))
  .map(i => ({ row: i.getAttribute('data-cl-row'), v: +i.value })));
await toPack();

const before = await hipRows();
const hipRow = before.find(r => r.row.split('::')[1] === '');
check('the hips sit on one row with no letter', !!hipRow, JSON.stringify(before));
check('THE FAULT: that row finds its lines', hipRow && await pg.evaluate(k => _matInlineMatchesFor(k).length, hipRow.row) >= 4,
  hipRow && String(await pg.evaluate(k => _matInlineMatchesFor(k).length, hipRow.row)));

// Type 7.75 m over the calculated figure.
await pg.evaluate(k => { const i = [...document.querySelectorAll('#tab-materials input[onchange^="_matInlineSetLength"]')]
  .find(x => x.offsetParent && x.getAttribute('data-cl-row') === k); i.value = '7.75'; i.dispatchEvent(new Event('change', { bubbles:true })); }, hipRow && hipRow.row);
await pg.waitForTimeout(900);
const ovs1 = await pg.evaluate(() => Object.values(DRAW.flashLayoutOverrides || {}).filter(o => o.lengthM === 7.75).length);
check('the typed length is stored on every hip of the row', ovs1 === 4, ovs1 + ' overrides at 7.75');

const has925 = async () => (await hipRows()).some(r => Math.abs(r.v - 7.75) < 1e-6);
await toRoof(); await toPack();
check('THE REPORT: to Roof Map and back, the 7.75 is still there', await has925(), JSON.stringify(await hipRows()));
await toRoof(); await toPack();
check('…and again with no change in between', await has925(), JSON.stringify(await hipRows()));

// Move a corner: the hips are rebuilt on new end points.
await toRoof();
await pg.evaluate(() => { DRAW.outline[2] = [830, 520]; regenerateAutoRoofLines('hip'); });
await toPack();
const keysNow = await pg.evaluate(() => (DRAW.lines || []).filter(l => l.type === 'hip').map(l => _flashLineKey(l)));
const ovKeys = await pg.evaluate(() => Object.keys(DRAW.flashLayoutOverrides || {}));
check('the corner really moved a hip', ovKeys.length === 4 && keysNow.some(k => !ovKeys.includes(k)) || keysNow.some(k => k.includes('830,520')),
  keysNow.join(' '));
check('THE REPORT: after moving a corner the 7.75 is still on the hips', await has925(), JSON.stringify(await hipRows()));
check('…its overrides now sit on the lines that are there', ovKeys.every(k => keysNow.includes(k)),
  JSON.stringify(ovKeys));

// A save and reopen keeps it too.
await pg.evaluate(() => { const snap = snapshotCurrentJob(); restoreFromJob(JSON.parse(JSON.stringify(snap))); });
await pg.waitForTimeout(600); await toRoof(); await toPack();
check('…and a save and reopen keeps it', await has925(), JSON.stringify(await hipRows()));

// A typed sheet quantity survives the same round trips (it always did; pinned beside it).
const sheetQ = await pg.evaluate(() => {
  const i = [...document.querySelectorAll('#tab-materials input')].find(x => x.offsetParent && /^_jpSheetSetQty/.test(x.getAttribute('onchange') || ''));
  if (!i) return null; i.value = '61'; i.dispatchEvent(new Event('change', { bubbles:true })); return i.getAttribute('onchange').slice(0, 60);
});
await pg.waitForTimeout(700); await toRoof(); await toPack();
const sheet61 = await pg.evaluate(() => [...document.querySelectorAll('#tab-materials input')].some(x => x.offsetParent && x.value === '61'));
check('a typed sheet quantity survives the round trip', sheetQ != null && sheet61, String(sheetQ));
await toRoof();
await pg.evaluate(() => { DRAW.outline[1] = [812, 140]; regenerateAutoRoofLines('hip'); });
await toPack();
const sheetAfter = await pg.evaluate(() => [...document.querySelectorAll('#tab-materials input')].filter(x => x.offsetParent && /^_jpSheetSetQty/.test(x.getAttribute('onchange') || '')).map(x => x.value));
check('…and after moving another corner', sheetAfter.includes('61'), JSON.stringify(sheetAfter));
check('…with the hips still at 7.75', await has925(), JSON.stringify(await hipRows()));

check('none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
