// THE ROOF AND POLE SHED JOB TYPES DO NOT MOVE (AI Tendering Phase 0,
// 2026-10-23). The build brief's first hard rule: "Do not change the
// behaviour of the Roof or Pole Shed job types. Before you start, capture
// snapshot or regression tests of their current outputs: sheet layouts, cut
// lists, material lists, quote totals and quote PDFs. Those tests must pass
// unchanged at every phase."
//
// This is that snapshot. For three ROOF jobs (the demo job, the five-roof job
// behind reports 51/52, the hip-and-valley tee the owner counted by hand) and
// one POLE SHED it captures, under one fixed price book:
//   - the sheets to order (count x length) and the engine's sections
//   - the Job Pack cut list rows per roof
//   - every material row (label, quantity, unit, $/unit) and the materials total
//   - the labour figures, the scaffold, the quote line items
//   - quoteSubtotal, _quoteMoney (sub / GST / total), the customer's total and
//     summary rows, the profitability figures
//   - the quote's section keys (computer and phone layouts) and the rendered
//     text of the computer layout, which is what the modern PDF captures
// and holds them to the cent against tests/typesnap.json.
//
// The PDF itself is not built here: jsPDF and html2canvas come off a CDN the
// test environment cannot reach (tests/quotepdf.mjs pins the slicer with a
// stand-in). The rendered text of the layout the PDF captures is the proxy.
// The sheet PUZZLE picture is deliberately NOT captured: it belongs to the
// sheet-layout session and is changing on its own branch. The counting pass
// (sheets to order, sections, cut list) is what the Job Pack orders from.
//
// Regenerate ONLY with REGEN=1 and a reason in the commit message. A diff you
// did not intend is the whole point of the file.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const DIR = _j(_ROOT, 'frontend');
const GOLD = _j(_ROOT, 'tests', 'typesnap.json');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const fx = async name => JSON.parse(await readFile(_j(_ROOT, 'tests', 'fixtures-' + name + '.json'), 'utf8'));

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1',
    branding: { company_name:'Flood Roofing', phone:'09 123 4567', email:'office@example.co.nz', poleshed_enabled: true },
    quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null'); sessionStorage.setItem('fr_setup_later','1');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@example.co.nz', name:'Sam Tui' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing', role:'owner' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });

const demo = JSON.parse(await readFile(_j(DIR, 'demo-job.json'), 'utf8'));
const r41 = await fx('report41');
const tee = await fx('tee');

// One price book for every case, so the snapshot is about the ENGINES, not
// about whatever default a future build ships.
await pg.evaluate(() => {
  window.__snapPriceBook = function(){
    S.settings = S.settings || {};
    S.settings.price_book = {
      list_prices:false,
      sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
      ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24,
      ridge_wide_lm:30,
      screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
      underlay:{'50':150,'75':210,'100':270},
      gutter:{ typhoon_spouting_lm:19.27, typhoon_bracket_ea:5.56, typhoon_outlet_ea:24.21,
        typhoon_joiner_ea:3.82, typhoon_corner_ea:19.74, typhoon_stopend_ea:5.16,
        typhoon_expjoiner_ea:21.92, typhoon_weldsolvent_ea:20.87,
        box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40, bracket_ea:4.2, dropper_ea:16.5 },
      extras:[]
    };
    S.settings.labour_pricing = S.settings.labour_pricing || {};
  };
  // Round every number to the cent, drop functions, sort nothing (order is
  // part of what is pinned).
  window.__snapClean = function clean(v){
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function(k){ if (typeof v[k] !== 'function') o[k] = clean(v[k]); }); return o; }
    return v === undefined ? null : v;
  };
  window.__snapCapture = function(){
    var out = {};
    // Pricing drawer: every figure the cards read.
    gotoTab('scope');
    calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
    try { renderGutterDownpipePricing(); } catch(e){}
    try { renderProfitability(); } catch(e){}
    var rows = _buildMaterialPriceRows();
    out.materialRows = rows.map(function(r){ return { key:r.key, label:r.label, qty:r.autoQty, unit:r.autoUnit,
      price: (r.variants && r.variants[0]) ? r.variants[0].price : null, variants: (r.variants||[]).length, decimalQty: !!r.decimalQty }; });
    out.materialsTotal = _materialsTotalFromRows(rows);
    out.labour = { S_labour: S.labour, S_materials: S.materials, q: S.quote.labour };
    out.scaffold = S.quote.scaffold;
    out.lineItems = (S.quote.lineItems || []).map(function(l){ return { desc:l.desc, qty:l.qty, unit:l.unit, amount:l.amount, _base:l._base || null }; });
    out.quoteSubtotal = quoteSubtotal();
    out.money = _quoteMoney();
    out.customerTotal = _custBarTotalValue();
    out.customerRows = _custBarRows().map(function(r){ return { k:r.k || r.key || null, label:r.label, short:r.short || null, value:r.value }; });
    try { out.profit = (function(p){ return { revenue:p.revenue, cost:p.cost, hrs:p.hrs, hrsAll:p.hrsAll, area:p.area, items:(p.items||[]).map(function(i){ return { label:i.label, revenue:i.revenue, cost:i.cost }; }) }; })(_profitFigures('total')); } catch(e){ out.profit = 'ERR ' + e.message; }
    try { out.priced = (function(P){ return { base:P.base, keys:Object.keys(P).sort() }; })(_qpBuildPriced()); } catch(e){ out.priced = 'ERR ' + e.message; }
    // Job Pack: sheets to order, sections, cut list.
    gotoTab('materials');
    try { _jpSelectAllRoofs(); } catch(e){}
    // A case shows only what IT rendered: the engine's globals outlive clearAll.
    window._lastSheetCounts = null; window._lastSheetSections = []; window._lastSheetCountsByRoof = {};
    try { renderRoofSheetPlan(); } catch(e){ out.sheetErr = e.message; }
    var sc = window._lastSheetCounts || {};
    out.sheets = { total: (sc.groups||[]).reduce(function(a,x){ return a + x.count; }, 0),
      groups: (sc.groups||[]).map(function(g){ return g.count + 'x' + (g.orderedMm/1000).toFixed(2); }) };
    out.sections = (window._lastSheetSections||[]).map(function(x){ return (x.isPrimary?'MAIN ':'wing ') + x.perSide + '/side@' + (x.orderedMm/1000).toFixed(2) + (x.valleyExtra ? '+' + x.valleyExtra : ''); });
    try { out.cutList = _jpSheetRowsAll(); } catch(e){ out.cutList = 'ERR ' + e.message; }
    // Quote: the sections and what the computer layout says.
    gotoTab('quote');
    try { _setQuotePreviewMode('desk', true); } catch(e){}
    refreshQuoteProposal();
    out.deskSections = _qdSectionsRaw().map(function(s){ return s.key; });
    out.bookPages = _qbPages().map(function(s){ return s.key; });
    try { _qdRender(); } catch(e){ out.deskErr = e.message; }
    var root = document.getElementById('qpRoot');
    out.deskText = (root ? root.innerText : '').replace(/\s+/g, ' ').trim();
    return window.__snapClean(out);
  };
});

async function roofCase(name, apply){
  await pg.evaluate(() => { gotoTab('roof'); clearAll(true); });
  await pg.evaluate(apply.fn, apply.arg);
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { window.__snapPriceBook(); S.quote.date = '1/10/2026'; S.quote.ref = S.quote.ref || '00001'; S.quote.style = 'modern';
    try { setMainScope('reroof'); } catch(e){} });
  await pg.waitForTimeout(600);
  const snap = await pg.evaluate(() => window.__snapCapture());
  await pg.waitForTimeout(300);
  return snap;
}
// A fixture in the _roofGeometryPayload shape, laid out the way sheet-shots does.
const applyFixture = (g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = (g.lines || []).map(l => Object.assign({}, l));
  DRAW.roofs = (g.roofs || []).map(r => Object.assign({}, r, { lines: (r.lines || []).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx || 0; DRAW.showAllRoofs = true;
  if (g.autoType && !(g.lines || []).length) { DRAW.activeRoofIdx = -1; try { autoGenerateRoof(g.autoType); } catch (e) {} }
  if (DRAW.roofs.length && DRAW.roofs.some(r => r.autoType && !(r.lines || []).length)) {
    DRAW.roofs.forEach((r, i) => {
      if (!r.autoType || (r.lines || []).length) return;
      _loadRoofToCurrent(i); DRAW.roofType = r.autoType;
      try { autoGenerateRoof(r.autoType); } catch (e) {}
      _syncCurrentToRoof();
    });
  }
  if (!DRAW.roofs.length) { try { _syncCurrentToRoof(); } catch(e){} }
  try { autoCalcLineMeasurements(); } catch(e){}
  try { redrawAll(); } catch(e){}
  S.quote = defaultQuote(); S.quote.quoteKind = 'roofing';
};

const snaps = {};
snaps.roof_demo = await roofCase('demo', { fn: (job) => { restoreFromJob(job); S.quote.quoteKind = 'roofing'; }, arg: demo });
snaps.roof_report41 = await roofCase('report41', { fn: applyFixture, arg: r41 });
snaps.roof_tee = await roofCase('tee', { fn: applyFixture, arg: tee });
// The pole shed: no roof drawn, the estimator is the take-off.
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); });
await pg.evaluate(() => {
  window.__snapPriceBook();
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  S.quote.date = '1/10/2026'; S.quote.ref = '00002';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  S.quote.psDoors = '2x Roller Door, 1x P.A. Door';
});
await pg.waitForTimeout(400);
snaps.poleshed = await pg.evaluate(() => window.__snapCapture());

// Volatile things the text must not carry: nothing today, but strip any
// "Updated h:mm d/m" build line should it ever land inside #qpRoot.
Object.values(snaps).forEach(s => { s.deskText = String(s.deskText || '').replace(/Updated \d{1,2}:\d\d ?[ap]m \d{1,2}\/\d{1,2}/g, 'Updated <build>'); });

check('no page errors while capturing', errs.length === 0, errs.join(' | ').slice(0, 400));
Object.keys(snaps).forEach(k => {
  const s = snaps[k];
  check(k + ': captured without engine errors', !s.sheetErr && !s.deskErr && typeof s.profit !== 'string' && typeof s.priced !== 'string' && typeof s.cutList !== 'string',
    [s.sheetErr, s.deskErr, s.profit, s.priced, s.cutList].filter(x => typeof x === 'string').join(' | '));
  check(k + ': has material rows and a total', s.materialRows.length > 0 && s.quoteSubtotal > 0, s.materialRows.length + ' rows, sub ' + s.quoteSubtotal);
  if (/^roof_/.test(k)) check(k + ': the engine ordered sheets', s.sheets.total > 0, JSON.stringify(s.sheets));
});

if (process.env.REGEN) {
  await writeFile(GOLD, JSON.stringify(snaps, null, 1));
  console.log('REGENERATED ' + GOLD);
} else {
  const gold = JSON.parse(await readFile(GOLD, 'utf8'));
  const diff = (a, b, path, acc) => {
    if (acc.length > 40) return acc;
    if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === 'object') || (b && typeof b === 'object')) {
      if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a === null || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(path + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b)); return acc; }
      const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
      keys.forEach(k => diff(a[k], b[k], path + '.' + k, acc));
      return acc;
    }
    if (typeof a === 'string' && typeof b === 'string' && a !== b && a.length > 200) {
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      acc.push(path + ': text differs from char ' + i + ': "' + a.slice(Math.max(0, i - 40), i + 80) + '" -> "' + b.slice(Math.max(0, i - 40), i + 80) + '"');
      return acc;
    }
    if (a !== b) acc.push(path + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b));
    return acc;
  };
  Object.keys(gold).forEach(k => {
    const d = diff(gold[k], snaps[k], k, []);
    check(k + ': matches typesnap.json to the cent', d.length === 0, d.slice(0, 12).join('\n       '));
  });
  check('no case missing from the baseline', Object.keys(snaps).every(k => gold[k]), Object.keys(snaps).filter(k => !gold[k]).join(','));
}

await b.close();
const failed = results.filter(x => !x).length;
console.log(failed ? ('FAILED ' + failed + ' of ' + results.length) : ('ALL ' + results.length + ' PASSED'));
process.exit(failed ? 1 : 0);
