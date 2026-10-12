// EVERY ROOF PRICES LIKE THE MAIN ROOF (2026-10-12, the owner: "the add
// custom material line or from price books has disapeared from the addition
// roofs, it's still there on the main roof thoughh, please check every other
// thing from the main roof is on the additional roofs too" — and, the same
// morning, "let me adjust my labour hourly rate seperately on the different
// roofs it's currently locked and says shared" and "put the total price less
// gst … on the right on the frozen roof map … Labour $x, Material $x then
// total $x +gst").
//
// Pinned: each pricing tab carries + Add custom line, 📖 Add from price book
// and + Add labourer; a line typed on an extra roof is THAT roof's (the main
// roof's total does not move) and is in that roof's optional price; an extra
// roof's lead/apprentice rates are its own and fall back to the shared ones;
// folding a roof in carries its lines onto the main tab; deleting a roof
// takes its lines with it; and the panel beside the frozen roof map adds up
// to the quote.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(); const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_site_mode','off');
  localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });

// Two roofs: a main one and an optional extra.
await pg.evaluate(async () => {
  const mk = (pts) => { setTool('outline'); DRAW.currentPts = pts; finishCurrent(); };
  clearAll(true);
  mk([[200,200],[800,200],[800,600],[200,600]]); DRAW.scaleMetresPerPx = 0.03;
  let m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable');
  _addAndSwitchToNewRoof();
  mk([[900,200],[1300,200],[1300,500],[900,500]]);
  await new Promise(r => setTimeout(r, 200));
  m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable');
  _setRoofMode(1, 'separate');
  gotoTab('scope');
});

// ── the same controls on every tab ────────────────────────────────
const ctrls = await pg.evaluate(() => {
  const btns = (id) => { const el = document.getElementById(id); return el ? Array.from(el.querySelectorAll('button')).map(b => (b.textContent||'').trim()) : []; };
  const snap = () => ({ mat: btns('materialPriceTableWrap'), lab: btns('labourTableWrap'), sc: btns('scaffoldWrap') });
  _setPricingRoof(0); calcLabour(); renderMaterialPriceTable();
  const main = snap();
  _setPricingRoof(1); calcLabour(); renderMaterialPriceTable();
  return { main, extra: snap() };
});
const has = (list, txt) => list.some(t => t.indexOf(txt) >= 0);
['mat','lab','sc'].forEach((k) => {
  const nm = { mat:'Roof materials', lab:'Roof labour', sc:'Scaffolding' }[k];
  check(nm + ' — the main roof offers a custom line and the price book', has(ctrls.main[k], '+ Add custom line') && has(ctrls.main[k], 'Add from price book'), ctrls.main[k].join(' | '));
  check(nm + ' — AND SO DOES THE EXTRA ROOF', has(ctrls.extra[k], '+ Add custom line') && has(ctrls.extra[k], 'Add from price book'), ctrls.extra[k].join(' | '));
});
check('+ Add labourer is on the main roof', has(ctrls.main.lab, '+ Add labourer'));
check('…and on the extra roof', has(ctrls.extra.lab, '+ Add labourer'), ctrls.extra.lab.join(' | '));

// ── a line typed on an extra roof is that roof's alone ────────────
const lines = await pg.evaluate(() => {
  const read = () => { const el = document.getElementById('matTotalShown'); return el ? el.textContent : ''; };
  _setPricingRoof(0); renderMaterialPriceTable(); const main0 = read();
  _setPricingRoof(1); renderMaterialPriceTable(); const extra0 = read();
  _qAddCustom(_qCustomArea('material', 1), { desc:'Asbestos disposal', qty:1, unit:800, uom:'', amount:800 });
  _setPricingRoof(1); renderMaterialPriceTable(); const extra1 = read();
  _setPricingRoof(0); renderMaterialPriceTable(); const main1 = read();
  return { main0, main1, extra0, extra1, keys: Object.keys(S.quote.customLines || {}),
           mainCustom: _qCustomTotal('material'), extraCustom: _qCustomTotal(_qCustomArea('material', 1)) };
});
check('it is stored against the roof it was typed on', lines.keys.indexOf('material#1') >= 0 && lines.mainCustom === 0 && lines.extraCustom === 800, JSON.stringify(lines.keys));
check('the extra roof\'s materials go up by the $800', (parseFloat(lines.extra1.replace(/[^0-9.]/g,'')) - parseFloat(lines.extra0.replace(/[^0-9.]/g,''))).toFixed(2) === '800.00', lines.extra0 + ' → ' + lines.extra1);
check('…and THE MAIN ROOF DOES NOT MOVE', lines.main0 === lines.main1, lines.main0 + ' → ' + lines.main1);

// ── it reaches that roof's optional price, and the quote ──────────
const price = await pg.evaluate(() => {
  refreshQuoteProposal();
  const er = (S.quote.extraRoofs || [])[0] || {};
  const prof = _profitFigures(1);
  return { mats: er.materials, price: er.price, profMat: prof.mat,
           bare: _materialsCostForRoofIdx(1) };
});
check('the optional roof is quoted with the line in it', Math.abs(price.mats - (price.bare + 800)) < 0.02 && Math.abs(price.profMat - (price.bare + 800)) < 0.02, JSON.stringify(price));

// ── its own labour rates, falling back to the shared ones ─────────
const rates = await pg.evaluate(() => {
  const before = _roofLabourRates(1);
  _setRoofLabourRate(1, 'leadPrice', 70);
  const after = _roofLabourRates(1);
  const main = _roofLabourRates(0);
  const priced = _labourPriceForRoof(1);
  _setRoofLabourRate(1, 'leadPrice', '');          // the reset arrow
  const back = _roofLabourRates(1);
  _setRoofLabourRate(1, 'leadPrice', 70);
  return { beforeLead: before.leadPrice, beforeOwn: before.own.leadPrice || false,
           afterLead: after.leadPrice, afterOwn: !!after.own.leadPrice,
           mainLead: main.leadPrice, backLead: back.leadPrice, backOwn: !!back.own.leadPrice, priced };
});
check('an extra roof starts on the shared charge-out rate', rates.beforeLead === rates.mainLead && rates.beforeOwn === false, JSON.stringify(rates));
check('a rate typed on it is ITS OWN and the main roof keeps the shared one', rates.afterLead === 70 && rates.afterOwn && rates.mainLead !== 70, JSON.stringify(rates));
check('blanking it goes back to the shared rate', rates.backLead === rates.mainLead && !rates.backOwn, JSON.stringify(rates));

// ── a labourer taken on for that roof ─────────────────────────────
const crew = await pg.evaluate(() => {
  const h0 = _roofLabourHours(1), p0 = _labourPriceForRoof(1), c0 = _labourCostForRoof(1);
  _addLabourerTo(1);
  _updateLabourerOn(1, 0, 'hrs', 4);
  _updateLabourerOn(1, 0, 'price', 90);
  _updateLabourerOn(1, 0, 'cost', 25);
  const after = { h: _roofLabourHours(1), p: _labourPriceForRoof(1), c: _labourCostForRoof(1),
                  mainExtras: ((S.quote.labour || {}).extras || []).length,
                  roofExtras: _roofLabourExtras(1).length };
  return { h0, p0, c0, after };
});
check('a labourer added on the extra roof is that roof\'s, not the job\'s', crew.after.roofExtras === 1 && crew.after.mainExtras === 0, JSON.stringify(crew.after));
check('…and adds 4 hrs at $90 charge-out / $25 cost to that roof only',
  (crew.after.h - crew.h0) === 4 && Math.abs((crew.after.p - crew.p0) - 360) < 0.01 && Math.abs((crew.after.c - crew.c0) - 100) < 0.01, JSON.stringify(crew));

// ── the price panel beside the frozen roof map ────────────────────
const panel = await pg.evaluate(() => {
  const read = () => { const el = document.querySelector('#pricingRoofMap .pr-price'); return el ? el.textContent : ''; };
  refreshQuoteProposal();   // the labourer above only reaches extraRoofs on the next bake
  _setPricingRoof(0); calcLabour(); renderMaterialPriceTable();
  const main = { text: read(), parts: _pricingRoofParts(0), quoteSub: _quoteMoney().sub };
  _setPricingRoof(1); calcLabour(); renderMaterialPriceTable();
  const extra = { text: read(), parts: _pricingRoofParts(1), er: (S.quote.extraRoofs || [])[0] || {} };
  return { main, extra };
});
check('the roof map carries a price panel naming the roof being priced',
  /Main Roof/.test(panel.main.text) && /Labour/.test(panel.main.text) && /Material/.test(panel.main.text) && /Total/.test(panel.main.text) && /GST/.test(panel.main.text), panel.main.text);
check('…it switches with the roof', /Roof 2/.test(panel.extra.text) && !/Main Roof/.test(panel.extra.text), panel.extra.text);
check('THE MAIN ROOF\'S TOTAL IS THE QUOTE, to the cent', Math.abs(panel.main.parts.total - panel.main.quoteSub) < 0.02,
  panel.main.parts.total + ' vs ' + panel.main.quoteSub);
check('…and the extra roof\'s is what that roof is quoted at', Math.abs(panel.extra.parts.total - (+panel.extra.er.price || 0)) < 0.02,
  panel.extra.parts.total + ' vs ' + panel.extra.er.price);
check('the parts add up to the total', Math.abs((panel.extra.parts.labour + panel.extra.parts.material + panel.extra.parts.scaffold) - panel.extra.parts.total) < 0.01);

// ── folding the roof in carries its lines onto the main tab ───────
const fold = await pg.evaluate(() => {
  const before = { main: _qCustomTotal('material'), roof: _qCustomTotal(_qCustomArea('material', 1)) };
  _setRoofMode(1, 'folded');
  const after = { main: _qCustomTotal('material'), keys: Object.keys(S.quote.customLines || {}) };
  _syncQuoteBaseLineItems();
  after.onQuote = (S.quote.lineItems || []).some(function(x){ return x && x._custom && x.desc === 'Asbestos disposal'; });
  _setRoofMode(1, 'separate');
  return { before, after };
});
check('folding a roof in moves its typed lines onto the main roof\'s tab', fold.before.main === 0 && fold.before.roof === 800 && fold.after.main === 800 && fold.after.keys.indexOf('material#1') < 0, JSON.stringify(fold));
check('…so they are still charged, as a line on the quote', fold.after.onQuote);

// ── and deleting a roof takes its lines with it ───────────────────
const gone = await pg.evaluate(() => {
  _qAddCustom(_qCustomArea('scaffold', 1), { desc:'Crane hire', qty:1, unit:400, uom:'', amount:400 });
  const before = Object.keys(S.quote.customLines || {});
  _qCustomRemap(function(n){ return n === 1 ? -1 : (n > 1 ? n - 1 : n); });
  return { before, after: Object.keys(S.quote.customLines || {}) };
});
check('deleting a roof takes its own lines with it and leaves the main roof\'s',
  gone.before.indexOf('scaffold#1') >= 0 && gone.after.indexOf('scaffold#1') < 0 && gone.after.indexOf('material') >= 0, JSON.stringify(gone));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
