// Feedback report 5 — "did not order backtray".
//
// A hip roof with one 50mm flue standing on the hipped part of a face. The
// app showed the back-tray; the PDF that went to the merchant carried its
// name with a dash where the length should be, so nothing was ordered.
//
// Cause: _penSheetGeom looks for the face's high edge among the ridge lines
// and required the pipe to sit within that ridge's own ends. On a hip roof
// the ridge is SHORTER than the face under it — the rest of the top is the
// two hips — so a flue past the ridge's end had no top edge, no geometry and
// no length. The order also ignored everything the office had typed on the
// tray (struck off, retyped quantity or length, hand-added rows) and
// re-derived it from the drawing, which is the same fault the cut list had
// three reports running.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Report 5's roof, verbatim from the feedback PDF's geometry block.
const G = {"scaleMetresPerPx":0.013123790150595492,"calPitch":15,
 "outline":[[93,78],[93,686],[306,686],[306,898],[573,898],[573,176],[642,176],[642,-14],[306,-14],[306,78]],
 "lines":[{"type":"hip","pts":[[575,-14],[440,120]]},{"type":"valley","pts":[[306,78],[440,212]]},
  {"type":"hip","pts":[[306,-14],[440,119]]},{"type":"hip","pts":[[573,898],[440,765]]},
  {"type":"hip","pts":[[306,898],[440,765]]},{"type":"valley","pts":[[306,686],[440,552]]},
  {"type":"hip","pts":[[93,686],[333,446]]},{"type":"hip","pts":[[93,78],[333,318]]},
  {"type":"ridge","pts":[[440,119],[440,212]]},{"type":"ridge","pts":[[440,765],[440,552]]},
  {"type":"hip","pts":[[440,212],[333,318]]},{"type":"hip","pts":[[440,552],[333,446]]},
  {"type":"ridge","pts":[[333,318],[333,446]]},
  {"type":"gutter","pts":[[93,78],[93,686]]},{"type":"gutter","pts":[[93,686],[306,686]]},
  {"type":"gutter","pts":[[306,686],[306,898]]},{"type":"gutter","pts":[[306,898],[573,898]]},
  {"type":"gutter","pts":[[573,898],[573,176]]},{"type":"gutter","pts":[[573,176],[642,176]]},
  {"type":"gutter","pts":[[642,176],[642,-14]]},{"type":"gutter","pts":[[642,-14],[306,-14]]},
  {"type":"gutter","pts":[[306,-14],[306,78]]},{"type":"gutter","pts":[[306,78],[93,78]]}],
 // The flue: west face, below the end of that face's short ridge.
 "penetrations":[{"cx":243,"cy":479,"sizeLabel":"50","kind":""}]};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'e@floodroofing.co.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood', plan:'business', limits:{} }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2300);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display='none'; document.getElementById('selectJobModal').style.display='none'; } catch(e){}
});
const load = () => pg.evaluate(g => {
  Object.assign(DRAW, JSON.parse(JSON.stringify(g)));
  DRAW.outlineDone = true;
  DRAW.roofs = [Object.assign({ name:'Main Roof' }, JSON.parse(JSON.stringify(g)))];
  DRAW.activeRoofIdx = 0;
  DRAW.matBackTrayOff = {}; DRAW.matBackTrayQty = {}; DRAW.matBackTrayLen = {}; DRAW.matBackTrayExtras = [];
  try { redrawAll(); } catch(e){}
}, G);
await load();
await pg.evaluate(() => { try { gotoTab('materials'); } catch(e){} });
await pg.waitForTimeout(900);

// ── the tray the drawing knows about ─────────────────────────────
let v = await pg.evaluate(() => ({
  name: _penBackTrayName(DRAW.penetrations[0]),
  pen: _backTrayPenList().map(d => ({ name:d.name, len:d.lengthM, hasGeom:d.hasGeom })),
  order: _backTrayOrderList(),
}));
check('a 50mm flue on a Corrugate roof picks the 270mm back-tray',
  v.name === '270mm Corrugate back-tray', String(v.name));
check('…and it is SIZED, even though it stands past the end of that face\'s ridge',
  v.pen.length === 1 && v.pen[0].hasGeom === true && v.pen[0].len > 1, JSON.stringify(v.pen));
check('…so the order carries a quantity and a length, not a dash',
  v.order.length === 1 && v.order[0].qty === 1 && v.order[0].lengthM > 1 && v.order[0].lengthLabel !== '',
  JSON.stringify(v.order));
const autoLen = v.order[0].lengthM;

// ── the office's edits are the order ─────────────────────────────
v = await pg.evaluate(() => {
  const bt = _backTrayPenList()[0], k = _btKey(bt);
  _btSet('Qty', k, 3); _btSet('Len', k, 4.8);
  return _backTrayOrderList();
});
check('a retyped quantity reaches the merchant', v.length === 1 && v[0].qty === 3, JSON.stringify(v));
check('…and a retyped length does too', v[0].lengthM === 4.8 && v[0].lengthLabel === '4.8m', JSON.stringify(v));

v = await pg.evaluate(() => {
  const bt = _backTrayPenList()[0], k = _btKey(bt);
  _btSet('Qty', k, ''); _btSet('Len', k, '');
  _btSetOff(k, true);
  return { off: _backTrayOrderList(), auto: (function(){ _btSetOff(k, false); return _backTrayOrderList(); })() };
});
check('a tray struck off in the Job Pack is not ordered', v.off.length === 0, JSON.stringify(v.off));
check('…and putting it back restores the drawing\'s own length',
  v.auto.length === 1 && Math.abs(v.auto[0].lengthM - autoLen) < 0.001, JSON.stringify(v.auto));

v = await pg.evaluate(() => {
  _btExtraAdd();
  const a = _btExtras(); a[0].name = '340mm Corrugate back-tray'; a[0].qty = 2; a[0].len = 5.5;
  return _backTrayOrderList();
});
check('a tray added by hand reaches the merchant too',
  v.length === 2 && v.some(r => r.name === '340mm Corrugate back-tray' && r.qty === 2 && r.lengthM === 5.5),
  JSON.stringify(v));

// ── and it is actually ON the printed page ───────────────────────
const page = await pg.evaluate(() => {
  DRAW.matBackTrayExtras = [];
  try { _matBuildPrintPages(); } catch(e){ return { err: String(e && e.message || e) }; }
  const el = document.getElementById('matPrintPage2');
  el.classList.add('mp-capturing');
  const txt = el.innerText || '';
  // What the merchant would actually see photographed onto the sheet.
  const btn = [...el.querySelectorAll('.pdf-hide, .no-print')]
    .filter(n => getComputedStyle(n).display !== 'none').length;
  el.classList.remove('mp-capturing');
  return { txt: txt, btn: btn };
});
check('the printed order page carries the tray with a real length',
  /270mm Corrugate back-tray/.test(page.txt) && /1 @ \d+\.\d+m/.test(page.txt),
  (page.txt.match(/BACK-TRAYS[\s\S]{0,120}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 110));
check('…and never a bare dash where the length belongs',
  !/270mm Corrugate back-tray\s*\n\s*—/.test(page.txt));
// The order PDF is a photograph of this page, and .pdf-hide was only honoured
// under html.pdf-rendering — so the Full / Short toggles were printed onto
// the sheet the merchant reads.
check('…with no app buttons photographed onto the supplier\'s sheet', page.btn === 0, String(page.btn));

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
