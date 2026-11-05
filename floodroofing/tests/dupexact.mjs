// A DUPLICATE IS THE QUOTE IT WAS MADE FROM, AND THE SCAFFOLD ROW IS THE ROOFS
// ON THE QUOTE (2026-11-06, the owner on job 3350: "the 'duplicate this
// version' still doesn't bring through the EXACT quote that i'm duplicating,
// the price should be EXACTLY the same, all the sections ... and the whole
// pricing tab including any custom added material should be EXACTLY THE
// SAME"; "the scaffolding shown in the quote summary is still wrong, it should
// only show the scaffold totals for the roofs selected"; "make all the buttons
// in the left job menu (inside the light blue tile) ... the blue colour from
// the 'review quote' button").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1500, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? '{"branding":{"company_name":"Flood Roofing"}}' : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); localStorage.setItem('fr_first_roof','never'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// A main roof and three roofs beside it, like job 3350.
await pg.evaluate(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  gotoTab('roof'); await W(300);
  DRAW.scaleMetresPerPx = 0.05; DRAW.calPitch = 15;
  DRAW.outline = [[300,300],[700,300],[700,560],[300,560]]; DRAW.outlineDone = true; DRAW.lines = [];
  autoGenerateRoof('gable'); try { autoCalcLineMeasurements(); } catch(e){}
  try { _syncCurrentToRoof(); } catch(e){}
  if (!Array.isArray(DRAW.roofs) || !DRAW.roofs.length) DRAW.roofs = [JSON.parse(JSON.stringify({ name:'Main Roof', outline: DRAW.outline, outlineDone:true, lines: DRAW.lines, calPitch:15 }))];
  const add = (name, o) => DRAW.roofs.push({ name, outline: o, outlineDone: true, lines: [], calPitch: 15, roofType: 'gable' });
  add('Lower Main Roof', [[300,100],[700,100],[700,260],[300,260]]);
  add('Storage Shed', [[800,100],[1000,100],[1000,220],[800,220]]);
  add('Curved Veranda', [[800,400],[860,400],[860,560],[800,560]]);
  for (let i = 1; i < DRAW.roofs.length; i++){ _loadRoofToCurrent(i); autoGenerateRoof('gable'); try { autoCalcLineMeasurements(); } catch(e){} _syncCurrentToRoof(); }
  _loadRoofToCurrent(0); DRAW.roofs[0].name = 'Main Roof'; redrawAll();
  gotoTab('quote'); await W(700);
  S.quote.client = 'Diana Winch'; S.quote.ref = '3350'; S.quote.style = 'modern';
  for (let i = 1; i < 4; i++) _setRoofMode(i, 'separate');
  S.quote.scaffoldCustom = true; S.quote.scaffold = Object.assign(S.quote.scaffold || {}, { type: 'platform', price: 5000, cost: 4500 });
  for (let i = 1; i < 4; i++){ const sc = _roofScaffold(i); sc.type = 'edge'; sc.price = 500; sc.cost = 500; }
  try { calcLabour(); renderMaterialPriceTable(); renderProfitability(); } catch(e){}
  try { _syncQuoteBaseLineItems(); recalcQuoteTotals(); } catch(e){}
  // the customer takes the Lower Main Roof
  const pos = (S.quote.extraRoofs || []).findIndex(r => r.name === 'Lower Main Roof');
  S.quote.proposalOptions = S.quote.proposalOptions || {}; S.quote.proposalOptions.extraRoofsSel = { [pos]: true };
  try { recalcQuoteTotals(); refreshQuoteProposal(); } catch(e){}
  await W(300);
});

const money = s => +String(s || '').replace(/[^0-9.\-]/g, '');
const summary = () => pg.evaluate(() => {
  try { calcLabour(); renderProfitability(); _syncQuoteBaseLineItems(); recalcQuoteTotals(); } catch(e){}
  const rows = _custBarRows();
  const get = k => rows.filter(r => r.kind === k);
  const lower = (S.quote.extraRoofs || []).find(r => r.name === 'Lower Main Roof') || {};
  return { rows: rows.map(r => r.kind + '|' + r.label + '|' + r.value), tot: Math.round(_custBarTotalValue() * 100) / 100,
    sc: get('scaffold').map(r => r.value), lowerPrice: lower.price, lowerSc: lower.scaffold, gst: (S.quote.gstRate || 15) / 100,
    lines: (S.quote.lineItems || []).map(l => String(l.desc) + ':' + l.unit + (l._base ? '[' + l._base + ']' : '')),
    modes: [1,2,3].map(i => _roofQuoteMode(i)), sub: Math.round(quoteSubtotal() * 100) / 100 };
});

// ── the stale "Scaffolding (platform)" line ──
let v = await pg.evaluate(() => {
  S.quote.lineItems.push({ desc: 'Scaffolding (platform)', qty: 1, unit: 5500 });
  _syncQuoteBaseLineItems();
  return S.quote.lineItems.filter(l => /scaffold/i.test(l.desc || '')).map(l => l.desc + ':' + l.unit + (l._base ? '[k]' : ''));
});
check('a stale "Scaffolding (platform)" line beside the keyed scaffold is cleared — the scaffold is charged once', v.length === 1 && v[0] === 'Scaffolding:5000[k]', JSON.stringify(v));
v = await pg.evaluate(() => { const li = defaultQuoteLineItems(); return li.map(l => l.desc + ':' + (l._base || '')); });
check('…and a new quote\'s own lines are keyed and named as the sync names them', v.every(x => /:(labour|materials|scaffold)$/.test(x)) && !v.some(x => /platform/.test(x)), JSON.stringify(v));

// ── the scaffold row: the main roof and the roofs selected ──
let s0 = await summary();
const scRow = money(s0.sc[0]);
const expectSc = Math.round((5000 + s0.lowerSc) * (1 + s0.gst) * 100) / 100;
check('the summary\'s scaffold is the main roof\'s plus the selected roof\'s — $5,000 + $500 + GST', Math.abs(scRow - expectSc) < 0.01 && s0.lowerSc === 500, JSON.stringify({ sc: s0.sc, expectSc, lowerSc: s0.lowerSc }));
const lowerRow = s0.rows.find(r => /Lower Main Roof/.test(r));
check('…and the selected roof\'s line is its price less the scaffold that moved', lowerRow && Math.abs(money(lowerRow.split('|')[2]) - Math.round((s0.lowerPrice - 500) * (1 + s0.gst) * 100) / 100) < 0.01, lowerRow);
check('…with the total exactly what it was (the money only moves between rows)', Math.abs(s0.rows.filter(r => !/^total/.test(r)).reduce((t, r) => t + (r.startsWith('change') ? money(r.split('|')[2]) : money(r.split('|')[2])), 0) - s0.tot) < 0.05, JSON.stringify(s0.rows));
v = await pg.evaluate(() => { S.quote.proposalOptions.extraRoofsSel = {}; recalcQuoteTotals(); return _custBarRows().filter(r => r.kind === 'scaffold').map(r => r.value); });
check('no roof selected: the scaffold row is the main roof\'s alone', Math.abs(money(v[0]) - 5750) < 0.01, JSON.stringify(v));
await pg.evaluate(() => { const pos = (S.quote.extraRoofs || []).findIndex(r => r.name === 'Lower Main Roof'); S.quote.proposalOptions.extraRoofsSel = { [pos]: true }; recalcQuoteTotals(); });

// ── fold the lower roof in, type a material price, send ──
const sent = await pg.evaluate(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  _setRoofMode(1, 'folded'); await W(200);
  // a price typed on the main roof's material table
  const rows = _buildMaterialPriceRows() || []; const r0 = rows.find(r => r.variants && r.variants.length) || rows[0];
  const key = _matOvKey(r0.key, 0); MATERIAL_OVERRIDES[key] = Object.assign({}, MATERIAL_OVERRIDES[key] || {}, { price: 99.5 });
  window.__dupKey = key;
  try { calcLabour(); renderMaterialPriceTable(); renderProfitability(); _syncQuoteBaseLineItems(); recalcQuoteTotals(); refreshQuoteProposal(); } catch(e){}
  await W(300);
  S.quote.share = S.quote.share || {}; S.quote.share.sentAt = new Date().toISOString(); S.quote.share.token = 'tok-dup';
  _qvMarkSent(); await W(200);
  return { total: S.quote.versions.sent.total, modes: [1,2,3].map(i => _roofQuoteMode(i)), hasPricing: !!S.quote.versions.sent.pricing };
});
check('the send keeps the material table\'s typed prices with the sent copy', sent.hasPricing, JSON.stringify(sent));

// ── after the send: the roofs are renumbered and the typed price changes ──
await pg.evaluate(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  // swap the Storage Shed and the Lower Main Roof places (as a delete / re-add would)
  const map = i => i === 1 ? 2 : (i === 2 ? 1 : i);
  _syncCurrentToRoof();
  const t = DRAW.roofs[1]; DRAW.roofs[1] = DRAW.roofs[2]; DRAW.roofs[2] = t;
  _roofRemap(map); _roofAfterRenumber(); await W(200);
  MATERIAL_OVERRIDES[_matOvKey(window.__dupKey.split(':').slice(1).join(':'), 0)].price = 140;
  try { calcLabour(); renderMaterialPriceTable(); renderProfitability(); _syncQuoteBaseLineItems(); recalcQuoteTotals(); } catch(e){}
});
v = await pg.evaluate(() => ({ lowerAt: DRAW.roofs.findIndex(r => r.name === 'Lower Main Roof'), modeLower: _roofQuoteMode(DRAW.roofs.findIndex(r => r.name === 'Lower Main Roof')) }));
check('renumbering the roofs carries the live quote\'s modes with them', v.lowerAt === 2 && v.modeLower === 'folded', JSON.stringify(v));

// ── duplicate the sent quote ──
v = await pg.evaluate(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  _qvView('sent', S.quote.versions.sent.id); await W(400);
  _qvNewDraft(); await W(1200);
  try { calcLabour(); renderMaterialPriceTable(); renderProfitability(); _syncQuoteBaseLineItems(); recalcQuoteTotals(); } catch(e){}
  await W(200);
  const lowerAt = DRAW.roofs.findIndex(r => r.name === 'Lower Main Roof');
  return { tot: Math.round(_custBarTotalValue() * 100) / 100, sentTot: S.quote.versions.sent.total, viewing: !!S._qvViewing,
    lowerMode: _roofQuoteMode(lowerAt), storeMode: _roofQuoteMode(DRAW.roofs.findIndex(r => r.name === 'Storage Shed')),
    typed: (MATERIAL_OVERRIDES[window.__dupKey] || {}).price };
});
check('"Duplicate this quote" gives a draft at EXACTLY the sent total, after the roofs were renumbered', !v.viewing && Math.abs(v.tot - v.sentTot) < 0.01, JSON.stringify(v));
check('…each roof keeps the mode it was sent with (Lower Main Roof part of main, Storage Shed separate)', v.lowerMode === 'folded' && v.storeMode === 'separate', JSON.stringify(v));
check('…and the material table\'s typed price is the one it was sent with, not today\'s', v.typed === 99.5, JSON.stringify(v));

// ── the job tile's buttons ──
v = await pg.evaluate(() => {
  const ids = ['navJobSaveBtn', 'navJobChangeBtn', 'navJobHistBtn', 'navJobFilesBtn', 'navJobLockSide'];
  return ids.map(id => { const e = document.getElementById(id); return e ? getComputedStyle(e).backgroundColor + '/' + getComputedStyle(e).color : 'none'; });
});
check('every button in the left job tile is Review-quote blue with white words', v.every(x => x === 'rgb(0, 153, 224)/rgb(255, 255, 255)'), JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
