// EXTRAS — INCLUDED ITEMS ON EVERY QUOTE (the owner, 2026-10-30):
//   "add another optional add in section into the quotes in all job types
//    (roofing/pole sheds & gutter) have the same functionality as the custom
//    extra/option section, but each line is an included item, for instance the
//    customer want customer coloured downpipes and leaf diverters ... both show
//    as included as show the price, so have button on the side to add in the
//    "Extra's" section, make sure i can add the item name and the price, make
//    sure the price effects the overall quote price and make sure they show in
//    the quote summary"
// Pinned on the modern quote's computer layout, for a roofing quote, a pole
// shed and a gutters-only quote: "+ Insert Extras" (office only); an extra made
// in the window lands on S.quote.inclExtras, its section shows it Included with
// its price, the total moves by exactly its price (+GST), the summary rows and
// the picks carry it; edit and delete; the customer's copy reads the price
// stamped at send (share.priced.inclx) and sees no controls; an accepted
// quote cannot be edited.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_first_roof','never'); });
await pg.goto('file://' + DIR + '/app.html');
await sleep(2600);

const setup = (kind) => pg.evaluate(async (kind) => {
  window.saveSettings = async function(){};
  S.settings = S.settings || {};
  S.settings.selectables = _defaultSelectables();
  S.quote = defaultQuote();
  S.quote.style = 'modern'; S.quote.gstRate = 15; S.quote.selectablesSnapshot = null; S.quote.share = null;
  S.quote.proposalOptions = { steelGrade:'maxam', gutterType: kind === 'gutters' ? 'box125' : 'none' };
  S.quote.lineItems = [{ desc:'Re-screw', qty:1, price:2000 }];
  if (kind === 'poleshed'){ S.quote.quoteKind = 'poleshed'; S.quote.psSubtotal = 40000; S.quote.psSubtotalManual = true; }
  if (kind === 'gutters'){ S.quote.quoteKind = 'gutters'; try { _gutterJobSync(); } catch(e){} }
  try { recalcQuoteTotals(); } catch(e){}
  gotoTab('quote'); await new Promise(r => setTimeout(r, 500));
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 800));
}, kind);
const state = () => pg.evaluate(() => ({
  secs: [...document.querySelectorAll('#qpRoot .qd-main > section')].map(s => s.getAttribute('data-qd-sec') || (s.hasAttribute('data-qd-addopt') ? (s.querySelector('.ix-insert') ? 'ADDX' : 'ADD') : 'parked')),
  total: Math.round(_custBarTotalValue() * 100) / 100,
  rows: _custBarRows().map(r => r.label + ' ' + r.value),
  picks: _qbPicks().map(r => r[0] + ': ' + r[1]),
  ixRows: [...document.querySelectorAll('#qpRoot .ix-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
  railIns: !!document.querySelector('.ix-insert'),
}));
const addExtra = (name, price) => pg.evaluate(async ([name, price]) => {
  const btn = document.querySelector('#qpRoot .ix-add') || document.querySelector('.ix-insert');
  btn.click(); await new Promise(r => setTimeout(r, 150));
  document.getElementById('ixName').value = name;
  document.getElementById('ixPrice').value = String(price);
  document.getElementById('ixSave').click(); await new Promise(r => setTimeout(r, 500));
}, [name, price]);

for (const kind of ['roofing', 'poleshed', 'gutters']){
  await setup(kind);
  let v = await state();
  const base = v.total;
  check(kind + ': "+ Insert Extras" is offered on the office preview, and no Extras section yet', v.secs.includes('ADDX') && !v.secs.includes('inclx'), JSON.stringify(v.secs));
  await addExtra('Coloured downpipes', 320);
  await addExtra('Leaf diverters', 180);
  v = await state();
  const li = v.secs.indexOf('inclx'), last = v.secs.filter(s => !/^(ADD|ADDX|parked)$/.test(s)).pop();
  check(kind + ': the Extras section appears ahead of the total, and the Insert button goes', li > 0 && v.secs.indexOf(last) > li && !v.secs.includes('ADDX'), JSON.stringify(v.secs));
  check(kind + ': each extra shows as included, with its price incl. GST', v.ixRows.length === 2 && /Coloured downpipes/.test(v.ixRows[0]) && /\$368\.00/.test(v.ixRows[0]) && /Leaf diverters/.test(v.ixRows[1]) && /\$207\.00/.test(v.ixRows[1]), JSON.stringify(v.ixRows));
  check(kind + ': the total moves by exactly their price + GST ($575.00)', Math.abs(v.total - base - 575) < 0.01, base + ' -> ' + v.total);
  check(kind + ': the summary lists each extra with its price', v.rows.some(r => /Extras — Coloured downpipes \+\$368\.00/.test(r)) && v.rows.some(r => /Extras — Leaf diverters \+\$207\.00/.test(r)), JSON.stringify(v.rows));
  check(kind + ': and What you chose names them Included', v.picks.includes('Coloured downpipes: Included') && v.picks.includes('Leaf diverters: Included'), JSON.stringify(v.picks));
  // edit and delete
  await pg.evaluate(async () => {
    const id = S.quote.inclExtras[1].id; _ixEdit(id); await new Promise(r => setTimeout(r, 120));
    document.getElementById('ixPrice').value = '250'; document.getElementById('ixSave').click();
    await new Promise(r => setTimeout(r, 300));
  });
  v = await state();
  check(kind + ': editing an extra\'s price moves the total', Math.abs(v.total - base - (320 + 250) * 1.15) < 0.01, String(v.total - base));
  await pg.evaluate(async () => { _ixDelete(S.quote.inclExtras[0].id); await new Promise(r => setTimeout(r, 300)); });
  v = await state();
  check(kind + ': deleting one takes it off the quote and its price off the total', v.ixRows.length === 1 && Math.abs(v.total - base - 250 * 1.15) < 0.01, JSON.stringify(v.ixRows) + ' ' + (v.total - base));
}

// ── the customer's copy reads the stamped price, with no controls ────
await setup('roofing');
await addExtra('Leaf diverters', 180);
let c = await pg.evaluate(async () => {
  S.quote.share = { token:'t1', priced: _qpBuildPriced() };
  S.quote.share.priced.v = 1;
  const office = Math.round(_custBarTotalValue() * 100) / 100;
  const stamped = JSON.stringify(S.quote.share.priced.inclx);
  window.__CUSTOMER_MODE = true;
  // a later office edit to the live list must not reach a customer holding the sent figures
  S.quote.inclExtras[0].price = 999;
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 400));
  const cust = Math.round(_custBarTotalValue() * 100) / 100;
  const tools = document.querySelectorAll('#qpRoot .ix-add, #qpRoot .ps-ao-tools, .ix-insert').length;
  const shown = [...document.querySelectorAll('#qpRoot .ix-row')].map(r => r.textContent.replace(/\s+/g,' ').trim());
  window.__CUSTOMER_MODE = false; S.quote.inclExtras[0].price = 180;
  return { office, cust, stamped, tools, shown };
});
check('the send stamps the extras into the priced block', /Leaf diverters/.test(c.stamped) && /180/.test(c.stamped), c.stamped);
check('the customer\'s total is the office\'s total, from the stamped price', c.cust === c.office, c.office + ' / ' + c.cust);
check('the customer sees the extra at the price they were sent, and no controls', c.shown.length === 1 && /\$207\.00/.test(c.shown[0]) && c.tools === 0, JSON.stringify(c));

// ── an accepted quote cannot be edited ───────────────────────────
c = await pg.evaluate(async () => {
  S.quote.share = null; S.quote.accepted = { name:'A', at:new Date().toISOString(), total:1 };
  const n0 = S.quote.inclExtras.length;
  _ixEdit(null); const opened = !!document.getElementById('ixName');
  S.quote.inclExtras.forEach(x => _ixDelete(x.id));
  const n1 = S.quote.inclExtras.length;
  delete S.quote.accepted;
  return { opened, n0, n1 };
});
check('an accepted quote opens no editor and loses no extra', !c.opened && c.n0 === c.n1, JSON.stringify(c));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
