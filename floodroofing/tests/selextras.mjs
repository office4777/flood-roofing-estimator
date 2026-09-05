// "add in custom rows, so that the company can advertise their particular
//  items/options"
//
// The seven groups on the Selections page are the ones RoofMap knows how to
// price. A roofing company sells things RoofMap has never heard of — gutter
// guard, ridge vents, a wash-down — and had nowhere to put them.
//
// An option group is a title and a list of choices, each with a price the
// roofer types. The first choice is what the quote already includes; every
// other one adds its price. There is no engine behind these — the number
// typed IS the number — which is exactly what makes them safe to invent,
// unlike the gauge or the grade.
//
// The things that would hurt to get wrong, and are pinned here: the total
// actually moves, the price the customer was SENT is the price they keep
// when the office reprices, and a payload naming a group that is not on this
// quote cannot talk one onto it.
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

const GUARD = {
  id:'gutterguard', title:'Gutter guard',
  rows:[
    { id:'no',   name:'Not included', desc:'No gutter guard on this job.', price:0 },
    { id:'mesh', name:'Aluminium mesh guard', desc:'Keeps the leaves out of the new spouting.', price:1450 },
    { id:'full', name:'Full leaf guard system', desc:'Heavier profile, whole roof.', price:2600 },
  ],
};
async function setUp(){
  return pg.evaluate((g) => {
    S.settings = S.settings || {};
    S.settings.selectables = _defaultSelectables();
    S.settings.selectables.extras = [JSON.parse(JSON.stringify(g))];
    S.quote = S.quote || {};
    S.quote.gstRate = 15;
    S.quote.selectablesSnapshot = null;
    S.quote.share = null;
    S.quote.proposalOptions = { steelGrade:'maxam' };
    S.quote.lineItems = [{ desc:'Roof replacement', qty:1, price:20000 }];
    try { recalcQuoteTotals(); } catch(e){}
  }, GUARD);
}
await setUp();

let v = await pg.evaluate(() => ({ groups: _selExtras().length, pick: (_selExtraPick(_selExtras()[0])||{}).id }));
check('a company option group is offered on the quote', v.groups === 1, JSON.stringify(v));
check('…starting on the choice the quote already includes', v.pick === 'no', JSON.stringify(v));

// ── the money ──
const sum = () => pg.evaluate(() => _qpSelectionDeltaSum());
check('nothing is added while the included choice is picked', (await sum()) === 0, String(await sum()));
await pg.evaluate(() => _setProposalOption_extra('gutterguard', 'mesh'));
await pg.waitForTimeout(300);
check('picking an extra adds its price to the quote', (await sum()) === 1450, String(await sum()));
v = await pg.evaluate(() => _qpSelectionChanges().map(c => ({ l:c.label, d:c.delta })));
check('…and says what it is on the summary',
  v.some(c => /Gutter guard — Aluminium mesh guard/.test(c.l) && c.d === 1450), JSON.stringify(v));
await pg.evaluate(() => _setProposalOption_extra('gutterguard', 'full'));
await pg.waitForTimeout(300);
check('switching to the dearer choice swaps the price, never stacks them',
  (await sum()) === 2600, String(await sum()));
await pg.evaluate(() => _setProposalOption_extra('gutterguard', 'no'));
await pg.waitForTimeout(300);
check('going back to what was included takes it off again', (await sum()) === 0, String(await sum()));

// ── on the page the customer reads ──
await pg.evaluate(() => { _setProposalOption_extra('gutterguard', 'mesh'); try { refreshQuoteProposal(); } catch(e){} });
await pg.waitForTimeout(800);
v = await pg.evaluate(() => (document.getElementById('qpRoot') || {}).textContent || '');
check('the group is on the Selections page under its own heading',
  /Gutter guard/i.test(v) && /Aluminium mesh guard/.test(v), v.slice(0, 80));
check('…with the roofer\'s own words under it',
  /Keeps the leaves out of the new spouting/.test(v));
check('…and the price the customer will pay, incl. GST',
  /1,667\.50/.test(v.replace(/\s+/g,' ')), (v.match(/[\d,]+\.\d\d/g) || []).slice(0, 8).join(' '));

// ── what was SENT is what they keep ──
await pg.evaluate(() => {
  S.quote.selectablesSnapshot = JSON.parse(JSON.stringify(S.settings.selectables));
  S.quote.share = { token:'t1', status:'sent', priced: _qpBuildPriced() };
  // The office reprices afterwards — the customer holding the link must not
  // suddenly owe more.
  S.settings.selectables.extras[0].rows[1].price = 9999;
  S.settings.selectables.extras[0].rows[1].name = 'Renamed after sending';
});
v = await pg.evaluate(() => _qpSelectionChanges().map(c => ({ l:c.label, d:c.delta })));
check('a sent quote keeps the price it was sent at',
  v.some(c => c.d === 1450) && !v.some(c => c.d === 9999), JSON.stringify(v));
check('…and the name it was sent with',
  v.some(c => /Aluminium mesh guard/.test(c.l)) && !v.some(c => /Renamed after sending/.test(c.l)),
  JSON.stringify(v));

// ── a group with nothing behind it is not a group ──
v = await pg.evaluate(() => {
  const bad = [
    { id:'ok2', title:'Fine', rows:[{id:'a',name:'A'},{id:'b',name:'B',price:10}] },
    { id:'nope', title:'', rows:[{id:'a',name:'A'},{id:'b',name:'B'}] },          // no title
    { id:'one', title:'Only one choice', rows:[{id:'a',name:'A'}] },              // nothing to choose
    { id:'b ad', title:'Bad id', rows:[{id:'a',name:'A'},{id:'b',name:'B'}] },    // id would reach an onclick
    { id:'rowbad', title:'Bad row id', rows:[{id:'a',name:'A'},{id:"b')//",name:'B'}] },
  ];
  S.quote.selectablesSnapshot = null; S.quote.share = null;
  S.settings.selectables.extras = bad;
  return _selExtras().map(g => g.id);
});
check('a half-made group is left off the quote rather than half-rendered',
  JSON.stringify(v) === JSON.stringify(['ok2']), JSON.stringify(v));

// ── the settings editor ──
v = await pg.evaluate(() => {
  S.settings.selectables.extras = [];
  _selExtraAddGroup();
  const g = _selExtrasRaw()[0];
  _selExtraSetTitle(0, 'Ridge vents');
  _selExtraSetRow(0, 1, 'name', 'Two vents');
  _selExtraSetRow(0, 1, 'price', '480');
  _selExtraAddRow(0);
  _selExtraSetRow(0, 2, 'name', 'Four vents');
  _selExtraSetRow(0, 2, 'price', '900');
  renderSelectablesUI();
  // The titles live in input VALUES, which textContent does not see.
  const box = document.getElementById('selectablesUI');
  return { rows: _selExtrasRaw()[0].rows.length, title: _selExtrasRaw()[0].title,
           prices: _selExtrasRaw()[0].rows.map(r => r.price),
           ui: box.textContent,
           vals: Array.from(box.querySelectorAll('input')).map(i => i.value) };
});
check('a new group can be added and named in Settings',
  v.title === 'Ridge vents' && v.rows === 3, JSON.stringify(v.prices));
check('…with prices typed against each choice',
  JSON.stringify(v.prices) === JSON.stringify([0, 480, 900]), JSON.stringify(v.prices));
check('…and it shows up in the products panel',
  /Your own options/.test(v.ui) && v.vals.indexOf('Ridge vents') >= 0,
  JSON.stringify(v.vals.slice(-6)));

// The first choice is the baseline every price is measured from, so it
// cannot be removed — and a group needs something to choose between.
v = await pg.evaluate(() => {
  _selExtraDelRow(0, 0);                       // refused: it is the baseline
  const afterFirst = _selExtrasRaw()[0].rows.length;
  _selExtraDelRow(0, 2);                       // fine: back to two
  const afterThird = _selExtrasRaw()[0].rows.length;
  _selExtraDelRow(0, 1);                       // refused: would leave nothing to choose
  return { afterFirst, afterThird, now: _selExtrasRaw()[0].rows.length };
});
check('the included choice cannot be deleted', v.afterFirst === 3, JSON.stringify(v));
check('…an added choice can', v.afterThird === 2, JSON.stringify(v));
check('…and a group is never left with nothing to choose between', v.now === 2, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
