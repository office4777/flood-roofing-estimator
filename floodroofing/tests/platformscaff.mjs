// "When I select Platform Scaff as the scaffolding option, it should no longer
//  add 25% cost if the customer chooses to include the Gutters because the
//  platform scaffolding is already there ... Also if platform is selected don't
//  add an extra 25% to the scaffolding price because the cost and price the
//  user puts into the pricing tab will already be the price of the platform."
//
// Two faults with one cause: the code treated the entered scaffold figures as
// base Edge-Protection numbers whatever the dropdown said. So Platform jobs
// were charged 25% on top of a price that was already the platform price, and
// a customer adding gutters paid to "upgrade" to a platform that was already
// on site.
//
// The rule now: the entered cost/price are charged as entered, always. The
// scaffold TYPE decides one thing only — whether a customer taking guttering
// up pays the edge-protection → platform upgrade (+25% of the scaffold price).
// Edge: yes. Platform: no, it's already there.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// The job in the report: scaffold cost 2000 / price 2500, a gutter on offer.
await pg.evaluate(() => {
  S.quote = Object.assign(defaultQuote(), {
    gstRate: 15, gutterLm: 42.5, gutterLines: 2,
    proposalOptions: {}, gutterChoice: 'none', options: [], lineItems: []
  });
  S.quote.scaffold = { cost: 2000, price: 2500, type: 'edge' };
  S.quote.scaffoldCustom = true;
  gotoTab('quote');
});
await pg.waitForTimeout(400);

const state = () => pg.evaluate(() => ({
  eff: _scaffoldEff(S.quote.scaffold),
  base: _selScaffoldBasePrice(),
  upLines: _qpSelectionChanges().filter(c => /scaffolding upgrade/i.test(c.label))
             .map(c => c.delta),
  pricedUp: _qpBuildPriced().scaffoldUplift,
}));

// ── edge protection: everything the customer already had ──────────
let s = await state();
check('an edge-protection job charges the scaffold as entered',
  s.eff.price === 2500 && s.eff.cost === 2000, JSON.stringify(s.eff));
check('…and its price is the base a gutter upgrade is charged on',
  s.base === 2500, String(s.base));

await pg.evaluate(() => { _setProposalOption('gutterType', 'box125'); });
await pg.waitForTimeout(300);
s = await state();
check('a customer adding gutters on an edge job pays the platform upgrade',
  s.upLines.length === 1 && s.upLines[0] === 625, JSON.stringify(s.upLines) + ' (25% of 2500)');
check('…and the priced snapshot the share link reads carries the same 625',
  s.pricedUp === 625, String(s.pricedUp));

// ── switch to platform: the price is already the platform price ───
await pg.evaluate(() => { updateScaffoldType('platform'); });
await pg.waitForTimeout(400);
s = await state();
check('a platform job charges the scaffold as entered — no +25% on 2500',
  s.eff.price === 2500 && s.eff.cost === 2000, JSON.stringify(s.eff) + ' (old code charged 3125)');
check('the gutter the customer chose no longer adds a scaffolding upgrade',
  s.upLines.length === 0, JSON.stringify(s.upLines));
check('…the upgrade base is nothing — there is nothing to upgrade to',
  s.base === 0, String(s.base));
check('…and the priced snapshot agrees', s.pricedUp === 0, String(s.pricedUp));

// The customer's total moves by exactly the upgrade when the type flips.
const totals = await pg.evaluate(() => {
  updateScaffoldType('edge');
  var e = _qpSelectionDeltaSum();
  updateScaffoldType('platform');
  var p = _qpSelectionDeltaSum();
  return { e, p };
});
check('flipping edge → platform takes exactly the 625 off the options total',
  Math.abs((totals.e - totals.p) - 625) < 0.01, JSON.stringify(totals));

// ── what each side sees ────────────────────────────────────────────
// The pricing tile: no "(+25%)" promise on the dropdown, and the note says
// gutters carry no upcharge on a platform job.
await pg.evaluate(() => { gotoTab('quote'); calcLabour(); });
await pg.waitForTimeout(300);
let tile = await pg.evaluate(() => {
  const w = document.getElementById('scaffoldWrap');
  return { txt: (w.textContent || '').replace(/\s+/g,' '),
           opts: Array.from(w.querySelectorAll('option')).map(o => o.textContent) };
});
check('the dropdown no longer claims Platform adds 25%',
  tile.opts.some(o => /Platform Scaffolding$/.test(o.trim())), JSON.stringify(tile.opts));
check('the tile says a platform job has no gutter upcharge',
  /no scaffolding upcharge/i.test(tile.txt), tile.txt.slice(0, 160));
check('…and no "charged $3125" line survives anywhere',
  tile.txt.indexOf('3125') < 0 && !/Platform \+\d+%/.test(tile.txt), tile.txt.slice(0, 160));

await pg.evaluate(() => { updateScaffoldType('edge'); calcLabour(); });
await pg.waitForTimeout(300);
tile = await pg.evaluate(() => (document.getElementById('scaffoldWrap').textContent || '').replace(/\s+/g,' '));
check('on an edge job the tile warns the office the gutter option adds +25%',
  /\+25%/.test(tile) && /platform upgrade/i.test(tile), tile.slice(0, 200));

// The customer's Selections page: the "adds 25%" note follows the same rule.
const notes = await pg.evaluate(() => {
  const grab = () => {
    refreshQuoteProposal();
    const r = document.getElementById('qpRoot');
    return /adds 25% to the standard scaffolding price/i.test(r ? r.textContent : '');
  };
  updateScaffoldType('edge');   const e = grab();
  updateScaffoldType('platform'); const p = grab();
  return { e, p };
});
check('the customer is told about the 25% only on an edge job', notes.e === true, String(notes.e));
check('…and never on a platform job', notes.p === false, String(notes.p));

// ── the share link can't be handed a stale base ────────────────────
const stash = await pg.evaluate(() => {
  updateScaffoldType('edge');
  refreshQuoteProposal();                 // publish path runs the stash
  const edgeBase = S.quote.scaffoldBase;
  updateScaffoldType('platform');
  refreshQuoteProposal();
  const platBase = S.quote.scaffoldBase;
  return { edgeBase, platBase };
});
check('publishing an edge job stashes the real base for the share link',
  stash.edgeBase === 2500, String(stash.edgeBase));
check('publishing a platform job stashes 0 — overwriting, not keeping, the old base',
  stash.platBase === 0, String(stash.platBase));

// ── legacy quotes ──────────────────────────────────────────────────
// A quote saved before the type existed has no type at all. It was priced as
// edge protection, and must keep charging the upgrade.
const legacy = await pg.evaluate(() => {
  delete S.quote.scaffold.type;
  S.quote.scaffoldBase = 2500;
  return { base: _selScaffoldBasePrice(), eff: _scaffoldEff(S.quote.scaffold).price };
});
check('a legacy quote with no scaffold type still charges the gutter upgrade',
  legacy.base === 2500 && legacy.eff === 2500, JSON.stringify(legacy));

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
