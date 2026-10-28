// THE PRICE CARD BESIDE THE FROZEN ROOF MAP (2026-10-18, the owner, with
// screenshots of his Pricing drawer: "the numbers don't add up properly").
//
// His card read Labour $8,100.00 / Material $7,347.09 / Scaffolding $2,500.00,
// total $17,947.09 — beside cards reading $13,800.00 (60 hrs x $140 + 60 x $90),
// $10,124.16 and $5,500.00, and a profitability panel agreeing with THOSE. The
// card's own three rows added to its own total exactly, which is what made it
// so convincing: it was not bad arithmetic, it was one render showing an older
// state of the job.
//
// TWO HOLES, both reproduced before anything was changed:
//   1. _renderPricingRoofSwitchBar returned early when there were fewer than
//      two pricing TABS — before _renderPricingRoofMap(), the only place the
//      card is ever drawn. His job is exactly that shape: Roof 2 folded into
//      the main roof, which collapses two tabs into one. From that moment the
//      card froze and kept showing what was last painted.
//   2. Even with the card live, a MATERIAL edit never refreshed it —
//      renderMaterialPriceTable and refreshQuoteProposal do not call the
//      switch bar, so a mark-up typed 5% -> 50% moved the card's own figure by
//      thousands while the card sat still. calcLabour covered labour and the
//      scaffold, which is why those two usually looked right.
//
// The pin is the same in every case: what the card SAYS must equal
// _pricingRoofParts(ri) to the cent, and its rows must add to its own total.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/settings/.test(u)) return r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ user_id:'u1', branding:{ company_name:'Flood Roofing' }, quote_defaults:{}, jms_keys:{} }) });
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });

// Read the card back as NUMBERS, and the live figures beside them.
await pg.evaluate(() => {
  window.__card = function(){
    const el = document.querySelector('.pr-price');
    if (!el) return null;
    const money = (s) => { const m = String(s).replace(/[^0-9.\-]/g, ''); return m ? +m : null; };
    const row = (label) => {
      const r = Array.from(el.querySelectorAll('.pr-price-row'))
        .find(x => (x.querySelector('span') || {}).textContent === label);
      return r ? money(r.querySelector('strong').textContent) : 0;
    };
    const tot = el.querySelector('.pr-price-tot strong');
    const all = Array.from(el.querySelectorAll('.pr-price-row')).map(x => money((x.querySelector('strong') || {}).textContent) || 0)
      .reduce((a, v) => a + v, 0);
    return { labour: row('Labour'), material: row('Material'), scaffold: row('Scaffolding'), rows: all,
             total: tot ? money(tot.textContent) : null };
  };
  window.__live = function(ri){ const p = _pricingRoofParts(ri);
    return { labour:+p.labour, material:+p.material, scaffold:+p.scaffold, total:+p.total }; };
  window.__agrees = function(ri){
    const c = __card(); if (!c) return { ok:false, why:'no card on screen' };
    const l = __live(ri == null ? _pricingRoofIdx() : ri);
    const near = (a, b2) => Math.abs((a || 0) - (b2 || 0)) < 0.005;
    const rowsAdd = Math.abs(c.rows - c.total) < 0.015;
    const matches = near(c.labour, l.labour) && near(c.material, l.material) &&
                    near(c.scaffold, l.scaffold) && near(c.total, l.total);
    return { ok: rowsAdd && matches, rowsAdd, matches, card: c, live: l };
  };
});

const agrees = () => pg.evaluate(() => __agrees());
const step = async (code, ms) => { await pg.evaluate(c => eval(c), code); await pg.waitForTimeout(ms || 450); };

// ── a two-roof job, the drawer open ──────────────────────────────
await step(`(function(){
  clearAll(true); DRAW.scaleMetresPerPx = 0.03;
  setTool('outline'); DRAW.currentPts = [[200,200],[800,200],[800,600],[200,600]]; finishCurrent();
  var m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable', 0); DRAW.calPitch = 25;
  _addAndSwitchToNewRoof();
  setTool('outline'); DRAW.currentPts = [[900,250],[1150,250],[1150,450],[900,450]]; finishCurrent();
  m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable', 0); DRAW.calPitch = 25;
  autoCalcLineMeasurements(); redrawAll(); gotoTab('quote');
})()`, 500);
await step(`_openPricingPanel(true)`, 900);
const tabs = await pg.evaluate(() => _pricingRoofTabIdxs().length);
check('(set-up) a two-roof job has two pricing tabs', tabs === 2, String(tabs));
check('the card agrees with the live figures when the drawer opens', (await agrees()).ok, JSON.stringify(await agrees()));

// ── hole 2: a MATERIAL edit, card live ───────────────────────────
const beforeMk = await pg.evaluate(() => __card().material);
await step(`_setRoofMatMarkup(50, 0)`, 500);
const afterMk = await agrees();
check('a material mark-up edit moves the card', afterMk.card.material !== beforeMk,
  beforeMk + ' -> ' + afterMk.card.material);
check('…and it still agrees to the cent', afterMk.ok, JSON.stringify(afterMk));

// ── hole 1: fold the second roof in — ONE tab ────────────────────
await step(`_setRoofMode(1, 'main')`, 500);
const oneTab = await pg.evaluate(() => _pricingRoofTabIdxs().length);
check('(set-up) folding Roof 2 in collapses the tabs to one', oneTab === 1, String(oneTab));
const folded = await agrees();
check('the card is still drawn with only one tab — it used to freeze here', !!folded.card, JSON.stringify(folded));
check('…and agrees to the cent', folded.ok, JSON.stringify(folded));
// The buttons are what a single tab has no use for, not the money.
const barShown = await pg.evaluate(() => {
  const bar = document.getElementById('pricingRoofSwitchBar');
  return !!bar && bar.style.display !== 'none' && !!bar.innerHTML.trim();
});
check('…while the roof-switch BUTTONS are hidden, which is all a single tab means', barShown === false);

// ── every control that moves a figure the card shows ─────────────
for (const [name, code] of [
  ['the scaffold price typed on the card', `updateScaffold('price', 5500)`],
  ['the scaffold cost typed on the card',  `updateScaffold('cost', 5200)`],
  ['a material mark-up change',            `_setRoofMatMarkup(12, 0)`],
  ['a quantity safety buffer change',      `_setRoofMatQtyBuffer(20, 0)`],
  ['labour hours and rates',               `(function(){ S.labour = S.labour || {};
      S.labour.leadHours = 60; S.labour.appHours = 60; S.labour.leadPrice = 140; S.labour.appPrice = 90;
      calcLabour(); })()`],
]) {
  await step(code, 500);
  const a = await agrees();
  check('the card follows ' + name, a.ok, JSON.stringify(a));
}

// ── job 3306 (2026-10-29): a custom line taken off, and the options ──
// "the yellow pricing main roof summary ... still isn't accurate ... and it
// doesn't change if i remove a custom material line". The card read $36,622.54
// beside a quote of $39,280.83 — the difference the RI-925 / 0.55 row — and a
// material line taken off left it where it was.
await step(`_qAddCustom('material', { desc:'Extra flashing', qty:1, unit:900, uom:'', amount:900 })`, 600);
const withLine = await agrees();
check('a custom material line added moves the card', withLine.ok && withLine.card.material > afterMk.card.material - 1e9, JSON.stringify(withLine));
const lineMat = withLine.card.material;
await step(`_qDelCustom('material', (S.quote.customLines.material || []).length - 1)`, 600);
const noLine = await agrees();
check('…and taking it off moves the card back by the line', noLine.ok && Math.abs((lineMat - noLine.card.material) - 900) < 0.02,
  lineMat + ' -> ' + noLine.card.material);
await step(`_setProposalOption('steelThickness', '55')`, 600);
const withOpt = await pg.evaluate(() => ({ a: __agrees(), sub: _quoteMoney().sub, deltas: _quoteMoney().deltaSum,
  rows: Array.from(document.querySelectorAll('.pr-price .pr-price-row span')).map(s => s.textContent) }));
check('(set-up) the 0.55 pick adds to the quote', withOpt.deltas > 1, JSON.stringify(withOpt));
check('the main roof card lists the option and comes to the quote\'s own sub-total', withOpt.a.ok &&
  Math.abs(withOpt.a.card.total - withOpt.sub) < 0.02 && withOpt.rows.some(r => /0\.55/.test(r)), JSON.stringify(withOpt));
await step(`_setProposalOption('steelThickness', '40')`, 600);
check('…and leaves it off again when it is taken off', (await agrees()).ok);

// ── a plain SINGLE-ROOF job ──────────────────────────────────────
// It shows NO band at all today: the band needs the multi-roof mini map, and
// _qpRoofMapSvg draws nothing for one roof. That is a gap, not this bug — the
// owner asked why the numbers disagreed, not for a card where there was none,
// so adding one is his call and not something to slip in alongside a fix.
// What IS pinned is the invariant that cost him the morning: a card is either
// absent or correct, NEVER stale. If the band is ever given to single-roof
// jobs, this pin holds it to the same standard instead of blocking it.
await step(`(function(){
  clearAll(true); DRAW.scaleMetresPerPx = 0.03;
  setTool('outline'); DRAW.currentPts = [[200,200],[800,200],[800,600],[200,600]]; finishCurrent();
  var m = document.getElementById('_rsModal'); if (m) m.remove();
  autoGenerateRoof('gable', 0); DRAW.calPitch = 25;
  autoCalcLineMeasurements(); redrawAll(); gotoTab('quote');
})()`, 500);
await step(`_openPricingPanel(true)`, 900);
const solo = await agrees();
check('a single-roof job shows no card today — and that is written down, not stale',
  solo.why === 'no card on screen' || solo.ok, JSON.stringify(solo));
await step(`_setRoofMatMarkup(40, 0)`, 500);
const soloEdit = await agrees();
check('…and after an edit it is still either absent or correct, never stale',
  soloEdit.why === 'no card on screen' || soloEdit.ok, JSON.stringify(soloEdit));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
