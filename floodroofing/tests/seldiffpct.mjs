// "On the selections page, show the price difference % to the default
//  selection on the selectable options (the default difference % is set in
//  the settings), and let the user increase / decrease the selection
//  difference $ or %, which then gets carried through to the customer quote."
//
// Every card already said what it does to the total in dollars. The
// percentage is the number that travels: "the ColorZen is about six percent
// less" is what gets said on the phone and remembered afterwards, and it is
// comparable between a small job and a big one in a way a dollar figure is
// not.
//
// The half that has to be right is "carried through". A dial the office turns
// that moves the card but not the running total, or moves the office copy but
// not the quote the customer opens, is worse than no dial at all — it quietly
// under-quotes. So the adjustment is gated inside the delta functions, above
// every caller, and this suite holds the card, the totals engine, the
// acceptance breakdown and the priced block frozen at send to one number.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFile } from 'node:fs/promises';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r2 = v => Math.round(v * 100) / 100;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);
const demo = JSON.parse(await readFile(_j(DIR, 'demo-job.json'), 'utf8'));

// Same shape of fixture pricegold uses — a real priced quote, so the
// percentages have a base to be a percentage OF.
await pg.evaluate((job) => {
  S.settings = S.settings || {};
  S.settings.price_book = {
    list_prices:false,
    sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
    ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24,
    screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
    underlay:{'50':150,'75':210,'100':270},
    gutter:{ box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40,
             ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 },
    extras:[]
  };
  try { restoreFromJob(job); } catch(e){}
  S.quote = S.quote || {};
  S.quote.gstRate = 15;
  S.quote.scaffoldBase = 4200;
  S.quote.materialBase = 9600;
  S.quote.baseGrade = 'maxam';
  S.quote.gutterLm = 42;
  S.quote.gutterLines = 3;
  S.quote.lineItems = [{ desc:'Main scope', qty:1, unit: 28500 }];
  S.quote.share = S.quote.share || {}; S.quote.share.priced = null;
  S.quote.selAdj = {};
  S.quote.proposalOptions = { steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                              gutterType:'none', gutterBracket:'internal' };
}, demo);
await pg.waitForTimeout(500);

// ── the percentage is derived, and it is a percentage of the standard ──
const derived = await pg.evaluate(() => {
  const base = _qpBaseSub();
  const raw = _selGradeDelta('zincalume');
  return { base, raw, pct: _selPctOfBase(raw),
           expect: raw / base * 100, adj: _selAdjPct('grade:zincalume') };
});
check('a quote with line items has a base for the percentages to measure against',
  derived.base > 0, '$' + derived.base);
check('an option that is priced by the settings has a real difference',
  Math.abs(derived.raw) > 1, '$' + r2(derived.raw));
check('…shown as a percentage of the standard quote, not of the material cost',
  Math.abs(derived.pct - derived.expect) < 1e-9,
  r2(derived.pct) + '% of $' + r2(derived.base));
check('…with nothing overridden until the office touches it', derived.adj === null);

// ── the card shows it ──────────────────────────────────────────────
await pg.evaluate(() => { gotoTab('quote'); });
await pg.waitForTimeout(1400);
await pg.evaluate(() => { try { refreshQuoteProposal(); } catch(e){} });
await pg.waitForTimeout(900);

const card = await pg.evaluate(() => {
  const el = document.querySelector('.qp-opt-pick[data-group="steelGrade"][data-value="zincalume"]');
  if (!el) return { found: false };
  const txt = el.innerText.replace(/\s+/g, ' ');
  return { found: true, txt,
           hasPct: /%\s*on the standard/i.test(txt),
           hasMoney: /[+−-]\s*\$/.test(txt),
           adjRow: !!el.querySelector('[onchange*="_selAdjSetPct"]') };
});
check('the option card is on the selections page', card.found, card.txt || '');
check('…showing what it does to the total in dollars', card.hasMoney, card.txt);
check('…and the same difference as a percentage of the standard', card.hasPct, card.txt);
check('…with the office’s own dial to move it', card.adjRow);

// The standard pick has nothing to be a difference FROM, so it gets neither.
const std = await pg.evaluate(() => {
  const el = document.querySelector('.qp-opt-pick[data-group="steelGrade"][data-value="maxam"]');
  if (!el) return { found: false };
  return { found: true, txt: el.innerText.replace(/\s+/g,' '),
           adjRow: !!el.querySelector('[onchange*="_selAdjSetPct"]') };
});
check('the standard pick reads as the standard, with no percentage and no dial',
  std.found && /standard/i.test(std.txt) && !std.adjRow, std.txt || '');

// ── turning the dial moves the money, everywhere ───────────────────
const before = await pg.evaluate(() => {
  S.quote.proposalOptions.steelGrade = 'zincalume';
  return { delta: _selGradeDelta('zincalume'), tot: _quoteMoney().tot,
           accept: (_qpSelectionChanges().find(c => /steel/i.test(c.label)) || {}).delta };
});
await pg.evaluate(() => _selAdjSetPct('grade:zincalume', -12));
await pg.waitForTimeout(600);
const after = await pg.evaluate(() => ({
  delta: _selGradeDelta('zincalume'), tot: _quoteMoney().tot,
  accept: (_qpSelectionChanges().find(c => /steel/i.test(c.label)) || {}).delta,
  base: _qpBaseSub(), stored: _selAdjPct('grade:zincalume'),
}));
check('setting a difference of −12% prices the option at −12% of the standard',
  Math.abs(after.delta - (after.base * -0.12)) < 0.01,
  '$' + r2(after.delta) + ' vs $' + r2(after.base * -0.12));
check('…and the running total the customer sees moves by exactly that much',
  Math.abs((after.tot - before.tot) - (after.delta - before.delta) * 1.15) < 0.02,
  'total moved ' + r2(after.tot - before.tot));
check('…and the acceptance-page breakdown agrees, to the cent',
  Math.abs(after.accept - after.delta) < 1e-9,
  r2(after.accept) + ' vs ' + r2(after.delta));

// ── the same decision, typed in dollars ────────────────────────────
const byAmt = await pg.evaluate(() => {
  const rate = (S.quote.gstRate || 0) / 100;
  const baseBefore = _qpBaseSub();
  _selAdjSetAmt('grade:zincalume', -2300, rate);
  const base = _qpBaseSub();
  const ex = _selGradeDelta('zincalume');
  return { incl: ex * (1 + rate), pct: _selAdjPct('grade:zincalume'), base, baseBefore };
});
check('typing a dollar figure lands on that dollar figure',
  Math.abs(byAmt.baseBefore * (byAmt.pct/100) * 1.15 - (-2300)) < 3,
  '$' + r2(byAmt.baseBefore * (byAmt.pct/100) * 1.15) + ' on the base it was typed against');
check('…and the percentage the card then shows is the one that was stored',
  Math.abs((byAmt.incl / (1 + 0.15)) / byAmt.base * 100 - byAmt.pct) < 0.06,
  r2((byAmt.incl / 1.15) / byAmt.base * 100) + '% vs stored ' + byAmt.pct + '%');
check('…and is stored as a percentage, so it survives a re-price',
  typeof byAmt.pct === 'number' && byAmt.pct < 0, byAmt.pct + '%');

// A re-price is the reason it is stored that way: double the job and the
// option stays the same proportion of it.
const reprice = await pg.evaluate(() => {
  const wasPct = _selAdjPct('grade:zincalume');
  S.quote.lineItems = [{ desc:'Main scope', qty:1, unit: 57000 }];
  const d = _selGradeDelta('zincalume');
  const base = _qpBaseSub();
  S.quote.lineItems = [{ desc:'Main scope', qty:1, unit: 28500 }];
  return { pct: d / base * 100, wasPct };
});
check('doubling the job keeps the option at the same percentage of it',
  Math.abs(reprice.pct - reprice.wasPct) < 1e-6,
  r2(reprice.pct) + '% vs ' + r2(reprice.wasPct) + '%');

// ── nudging starts from the derived figure, not from zero ──────────
const nudge = await pg.evaluate(() => {
  _selAdjReset('gutter:box125');
  const rawPct = _selPctOfBase(_selGutterDelta('box125'));
  _selAdjNudge('gutter:box125', _selGutterDelta('box125'), 0.5);
  return { rawPct, after: _selAdjPct('gutter:box125') };
});
check('the first nudge starts from the price the settings work out, not from zero',
  nudge.rawPct != null && Math.abs(nudge.after - (Math.round((nudge.rawPct + 0.5) * 10) / 10)) < 1e-9,
  'was ' + r2(nudge.rawPct) + '% → ' + nudge.after + '%');

const reset = await pg.evaluate(() => {
  const adjusted = _selGutterDelta('box125');
  _selAdjReset('gutter:box125');
  return { adjusted, back: _selGutterDelta('box125'), stored: _selAdjPct('gutter:box125') };
});
check('reset hands the card back to the price book', reset.stored === null &&
  Math.abs(reset.back - reset.adjusted) > 0.005, '$' + r2(reset.back));

// ── it has to reach the customer, not just the office ──────────────
// A sent quote carries frozen sell prices; the customer's browser adds those
// up and never recomputes from cost. If the adjustment did not make it into
// that block, the office would see one price and the customer another.
const sent = await pg.evaluate(() => {
  _selAdjSetPct('grade:colorzen', 4.5);
  const P = _qpBuildPriced();
  const base = _qpBaseSub();
  return { frozen: P.grade.colorzen, expect: base * 0.045, base };
});
check('the price frozen into a sent quote carries the office’s adjustment',
  Math.abs(sent.frozen - sent.expect) < 0.01,
  '$' + r2(sent.frozen) + ' vs $' + r2(sent.expect));

const customer = await pg.evaluate(() => {
  S.quote.proposalOptions.steelGrade = 'colorzen';
  const live = (_qpSelectionChanges().find(c => /colorzen/i.test(c.label)) || {}).delta;
  S.quote.share = S.quote.share || {};
  S.quote.share.priced = _qpBuildPriced();
  const asCustomer = (_qpSelectionChanges().find(c => /colorzen/i.test(c.label)) || {}).delta;
  S.quote.share.priced = null;
  return { live, asCustomer };
});
check('…so the customer’s copy prices it identically to the office’s',
  Math.abs(customer.live - customer.asCustomer) < 1e-9,
  r2(customer.live) + ' vs ' + r2(customer.asCustomer));

// The adjustment lives on the quote, so it saves and re-opens with it.
const saved = await pg.evaluate(() => {
  const snap = snapshotCurrentJob();
  return (snap.state && snap.state.quote && snap.state.quote.selAdj) || null;
});
check('the adjustments save with the job', saved && saved['grade:colorzen'] === 4.5,
  JSON.stringify(saved));

// ── the dial is the office’s, not the customer’s ───────────────────
// Back to Maxam as the standard first: re-pricing a job at a chosen grade
// makes that grade the new standard, and the standard card carries neither a
// percentage nor a dial by design.
await pg.evaluate(() => {
  S.quote.baseGrade = 'maxam';
  S.quote.proposalOptions.steelGrade = 'maxam';
  _selAdjSetPct('grade:zincalume', -9);
  try { refreshQuoteProposal(); } catch(e){}
});
await pg.waitForTimeout(800);
const hidden = await pg.evaluate(() => {
  const el = document.querySelector('.qp-opt-pick[data-group="steelGrade"][data-value="zincalume"]');
  if (!el) return { missing: true };
  const row = el.querySelector('[onchange*="_selAdjSetPct"]');
  const wrap = row && row.closest('.no-print');
  const officeVisible = !!(wrap && wrap.getClientRects().length);
  document.documentElement.classList.add('customer-view');
  const customerVisible = !!(wrap && wrap.getClientRects().length);
  // The percentage itself must survive — that is the whole point.
  const pctStillThere = /%\s*on the standard/i.test(el.innerText);
  const shows9 = /−9\.0%|-9\.0%/.test(el.innerText);
  document.documentElement.classList.remove('customer-view');
  return { officeVisible, customerVisible, pctStillThere, shows9,
           txt: el.innerText.replace(/\s+/g,' ').slice(0,120) };
});
check('the office can see the dial', hidden.officeVisible, JSON.stringify(hidden));
check('…and the customer cannot', !hidden.customerVisible, JSON.stringify(hidden));
check('…but the customer still sees the percentage it produced',
  hidden.pctStillThere, hidden.txt);
check('…and it is the percentage the office dialled in, not the price book’s',
  hidden.shows9, hidden.txt);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
