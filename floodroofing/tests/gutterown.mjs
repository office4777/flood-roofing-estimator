// A GUTTER THE OFFICE ADDS IS PRICED, AND SETTINGS SHOWS THE PRICE USED
// (2026-11-05, the owner: "I just added 175 box gutter to the quotes product
// options. Then in the default items ... I added the cost ... but then the
// quote, it doesn't show the cost, it just says included ... Marley Typhoon
// doesn't have any prices [in Settings]. But then in the quotes pricing tab,
// they show all the prices ... make sure the setting shows exactly what
// they're priced at").
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
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

let v = await pg.evaluate(async () => {
  await loadSettings();
  _resetQuoteForFreshJob({ client:'Diana', addr:'1 Road' });
  const sel = S.settings.selectables || (S.settings.selectables = {});
  if (!sel.gutters) sel.gutters = JSON.parse(JSON.stringify(_selGutters()));
  sel.gutters.push({ id:'g175', name:'175mm Colorsteel Box Gutter', bracketSpacingMm:800, bracketExtLm:8 });
  S.settings.price_book = S.settings.price_book || {};
  S.settings.price_book.gutter = Object.assign({}, S.settings.price_book.gutter || {}, { g175_lm: 40 });
  window._selGutterLm = () => 50; window._selGutterLineCount = () => 2;
  const d175 = _selGutterDelta('g175'), mat = _gutterMaterialCharge('g175', 50, 2, 0);
  S.quote.proposalOptions.gutterType = 'g175';
  try { calcLabour(); refreshQuoteProposal(); } catch(e){}
  return { d175, mat, card: _qpCardDeltas().gutter.g175, box: _selGutterDelta('box125') };
});
check('a gutter the office added is priced: 50 m at $40/lm and its droppers, plus the gutter labour', v.mat > 2000 && v.d175 > v.mat, JSON.stringify(v));
check('…so its card on the quote carries that price, not "Included"', v.card >= v.d175 && v.card > 0, JSON.stringify(v));
check('…and the shipped gutters are priced as before', v.box > 0, JSON.stringify(v));

v = await pg.evaluate(async () => {
  const pb = S.settings.price_book;
  pb.gutter = Object.assign({}, pb.gutter, { typhoon_spouting_lm: 0, typhoon_bracket_ea: 0, typhoon_outlet_ea: 0, classic_spouting_lm: 22.5 });
  gotoTab('settings'); try { showSettingsSub('set-defaultpricing'); } catch(e){}
  await new Promise(r => setTimeout(r, 300));
  renderPriceBookUI();
  const val = id => (document.getElementById(id) || {}).value;
  const inv = _gutterTyphoonInv();
  return { sp: val('pbGutTyphoonSpouting'), br: val('pbGutTyphoonBracket'), cls: val('pbGutClassicSpouting'),
    usedSp: inv.gutter, usedBr: inv.bracket };
});
check('Settings shows the Typhoon prices the quote actually uses when none were typed (was 0.00)', +v.sp === v.usedSp && +v.br === v.usedBr && v.usedSp === 19.27, JSON.stringify(v));
check('…and a price the office typed is shown as typed', +v.cls === 22.5, JSON.stringify(v));
v = await pg.evaluate(() => { const pb = collectPriceBookFromUI ? (collectPriceBookFromUI(), S.settings.price_book) : S.settings.price_book; return { sp: pb.gutter.typhoon_spouting_lm, cls: pb.gutter.classic_spouting_lm }; });
check('…and saving keeps those same figures', v.sp === 19.27 && v.cls === 22.5, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
