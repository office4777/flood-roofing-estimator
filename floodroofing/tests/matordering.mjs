// SETTINGS → MATERIAL ORDERING, and the external-bracket rate beside it
// (2026-10-19, the owner).
//
// (1) "internal and external brackets are saying the same price, can you add
//     in a specific cost in the settings gutter profiles for the added
//     price/lm for external brackets". The column was already on Quote's
//     Product Options and he had typed 6 / 3 / 3 into it — but the three
//     SHIPPED products read a pair of Default item pricing boxes instead,
//     which save as 0 on any account that has pressed Save there. So his rate
//     was honoured for a product he had added himself and ignored for the
//     three he quotes, and the customer was offered external brackets free.
//
// (2) "add in a settings tab called 'Material Ordering' with a sub-tab called
//     wastage … then another sub-tab called 'Consumables'". Every allowance
//     in the take-off was a constant in the code. The rule the whole page
//     rests on: EVERY DEFAULT IS WHAT THE CODE ALREADY DID, so nothing
//     reprices until somebody types in it, and a box cleared again goes back
//     to the standard rather than ordering nothing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = process.env.FR_FRONTEND_DIR || _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/cdn.jsdelivr.net/**', r => r.abort());
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

// ── (1) THE EXTERNAL BRACKET RATE ────────────────────────────────────
let v = await pg.evaluate(() => {
  const o = {};
  // The shape the owner is on: a price book saved with those two boxes blank.
  S.settings = S.settings || {};
  S.settings.price_book = Object.assign({}, S.settings.price_book || {},
    { gutter: Object.assign({}, (S.settings.price_book || {}).gutter || {},
        { ext_bracket_box125_lm: 0, ext_bracket_marley_lm: 0 }) });
  S.quote = S.quote || defaultQuote();
  S.quote.proposalOptions = Object.assign(S.quote.proposalOptions || {},
    { gutterType:'box125', gutterBracket:'internal' });
  window._selGutterLm = () => 40;              // 40 lm of gutter run
  o.shipped = _bracketExtPerLm('box125');
  o.delta   = _selBracketExtDelta();
  o.card    = _qpCardDeltas().bracketExt;
  const i = _selGuttersAll().findIndex(g => g.id === 'box125');
  _selEdit('gutters', i, 'extBracketLm', 9);
  o.typed      = _bracketExtPerLm('box125');
  o.typedDelta = _selBracketExtDelta();
  o.typedCard  = _qpCardDeltas().bracketExt;
  _selEdit('gutters', i, 'extBracketLm', 0);
  o.zero = _bracketExtPerLm('box125');
  o.zeroCard = _qpCardDeltas().bracketExt;
  return o;
});
check('the rate on the gutter product is what external brackets cost',
  v.shipped === 6, '$' + v.shipped + '/lm');
check('…and 40 lm of it reaches the card the customer presses',
  v.delta === 240 && v.card === 240, JSON.stringify({ delta: v.delta, card: v.card }));
check('typing a different rate on the product moves both at once',
  v.typed === 9 && v.typedDelta === 360 && v.typedCard === 360,
  JSON.stringify({ rate: v.typed, delta: v.typedDelta, card: v.typedCard }));
check('…and a rate of 0 is a real answer: the two bracket choices cost the same',
  v.zero === 0 && v.zeroCard === 0, JSON.stringify({ rate: v.zero, card: v.zeroCard }));

v = await pg.evaluate(() => ({
  gone: !document.getElementById('pbGutExtBox125Lm') && !document.getElementById('pbGutExtMarleyLm'),
  kept: (function(){
    // The page that wrote these is gone; a save must not put a 0 over what an
    // older account still falls back to.
    S.settings.price_book.gutter.ext_bracket_marley_lm = 4.25;
    collectPriceBookFromUI();
    return S.settings.price_book.gutter.ext_bracket_marley_lm;
  })()
}));
check('the duplicate Default item pricing boxes are gone — one number, one place', v.gone);
check('…and saving does not wipe the figure an older account still reads',
  v.kept === 4.25, String(v.kept));

// ── (2) WASTAGE ──────────────────────────────────────────────────────
v = await pg.evaluate(() => {
  delete S.settings.price_book.ordering;
  return { ridge: _ordWaste('ridge'), barge: _ordWaste('barge'),
           w6: _flashWaste([6], 0, 'ridge').total, w20: _flashWaste([20], 0, 'barge').total,
           bare: _flashWaste([20], 0).total };
});
check('every flashing starts on the allowance the code always used',
  v.ridge.run === 0.5 && v.ridge.lap === 0.1 && v.ridge.split === 8 &&
  v.barge.run === 0.5 && v.barge.split === 8, JSON.stringify(v.ridge));
check('…so a 6 m run is 6.5 m and a 20 m run is 20.7 m, exactly as before',
  Math.abs(v.w6 - 6.5) < 1e-9 && Math.abs(v.w20 - 20.7) < 1e-9,
  JSON.stringify({ six: v.w6, twenty: v.w20 }));
check('…and a caller that names no type still gets the standard',
  Math.abs(v.bare - 20.7) < 1e-9, String(v.bare));

v = await pg.evaluate(() => {
  S.settings.price_book.ordering = { waste: { barge: { run: 0.9, split: 6 } } };
  return { barge: _ordWaste('barge'), ridge: _ordWaste('ridge'),
           b20: _flashWaste([20], 0, 'barge').total,
           r20: _flashWaste([20], 0, 'ridge').total,
           note: _flashWasteNote(_flashWaste([20], 0, 'barge')) };
});
check('a wastage typed against ONE flashing moves only that flashing',
  Math.abs(v.b20 - 21.2) < 1e-9 && Math.abs(v.r20 - 20.7) < 1e-9,
  JSON.stringify({ barge: v.b20, ridge: v.r20 }));
check('…splitting at 6 m buys three sticks and pays three laps',
  v.barge.split === 6 && /0\.9m/.test(v.note) && /3 joins/.test(v.note), v.note);
check('…and the half of the row left blank keeps the standard lap',
  v.barge.lap === 0.1, String(v.barge.lap));

// ── (3) CONSUMABLES ──────────────────────────────────────────────────
const cons = async (ordering) => pg.evaluate((ord) => {
  if (ord) S.settings.price_book.ordering = ord; else delete S.settings.price_book.ordering;
  DRAW.roofs = null; DRAW.outline = null; DRAW.scaleMetresPerPx = null;
  DRAW.lines = [ { type:'barge', measM:'5' }, { type:'barge', measM:'5' },
                 { type:'ridge', measM:'9' }, { type:'hip', measM:'4' } ];
  const by = {}; _buildMaterialPriceRows().forEach(r => by[r.key] = r);
  return { rivets: by.rivets ? by.rivets.autoQty : null,
           rivetNote: by.rivets ? by.rivets.note : '',
           ridge: by.ridge ? +by.ridge.autoQty.toFixed(2) : null,
           barge: by.barge ? +by.barge.autoQty.toFixed(2) : null };
}, ordering);

let c0 = await cons(null);
check('rivets come out at one box of 100 per 60 lm, as they always have',
  c0.rivets === 100, JSON.stringify(c0));
let c1 = await cons({ cons: { rivetPack: 250, rivetPerLm: 10 } });
check('…and follow the box size and the metres typed against them',
  c1.rivets === 750 && /250 per 10 lm/.test(c1.rivetNote),
  JSON.stringify({ qty: c1.rivets, note: c1.rivetNote }));

v = await pg.evaluate(() => {
  const out = {};
  const q = (ord) => {
    if (ord) S.settings.price_book.ordering = ord; else delete S.settings.price_book.ordering;
    return _ordCons();
  };
  out.def = q(null);
  out.typed = q({ cons: { underlayWastePct: 10, screwsPerM2: 10, screwsRound: 250,
                          dektiteSpare: 2, gutterBracketSpacingM: 0.8, gutterBracketStartPerRun: 1 } });
  // A box cleared is the standard back, never "none at all" — a 0 lap or a 0
  // roll cover would order a roof with no allowance off an empty field.
  out.blanked = q({ cons: { screwsPerM2: '', rivetPack: null } });
  // Nonsense cannot divide by nothing.
  out.guard = q({ cons: { screwsRound: 0, rivetPack: 0, gutterBracketSpacingM: 0 } });
  return out;
});
check('the consumable defaults are the formulas the code already ran',
  v.def.underlayWastePct === 20 && v.def.screwsPerM2 === 8 && v.def.screwsRound === 100 &&
  v.def.rivetPack === 100 && v.def.rivetPerLm === 60 && v.def.dektiteSpare === 0 &&
  v.def.gutterBracketSpacingM === 0.5 && v.def.gutterBracketStartPerRun === 0,
  JSON.stringify(v.def));
check('…each one takes the figure typed against it',
  v.typed.screwsPerM2 === 10 && v.typed.screwsRound === 250 && v.typed.underlayWastePct === 10 &&
  v.typed.dektiteSpare === 2 && v.typed.gutterBracketSpacingM === 0.8 &&
  v.typed.gutterBracketStartPerRun === 1, JSON.stringify(v.typed));
check('…a box cleared goes back to the standard, not to nothing',
  v.blanked.screwsPerM2 === 8 && v.blanked.rivetPack === 100, JSON.stringify(v.blanked));
check('…and a 0 where something must be divided by cannot get through',
  v.guard.screwsRound >= 1 && v.guard.rivetPack >= 1 && v.guard.gutterBracketSpacingM > 0,
  JSON.stringify(v.guard));

// Gutter brackets: the spacing and the per-run starting count, on the real
// itemised gutter lines.
v = await pg.evaluate(() => {
  const n = (ord) => {
    if (ord) S.settings.price_book.ordering = ord; else delete S.settings.price_book.ordering;
    const row = _gutterMaterialLines('marley_typhoon', 40, 2, 0)
      .filter(r => /bracket/i.test(r.desc))[0];
    return row ? { qty: row.qty, desc: row.desc } : null;
  };
  return { def: n(null), typed: n({ cons: { gutterBracketSpacingM: 0.8, gutterBracketStartPerRun: 1 } }) };
});
check('gutter brackets stay at one per 500 mm until somebody says otherwise',
  v.def && v.def.qty === 80, JSON.stringify(v.def));
check('…then one every 800 mm with one to start each run reads 50 + 2',
  v.typed && v.typed.qty === 52 && /800mm \+ 1\/run/.test(v.typed.desc), JSON.stringify(v.typed));

// ── (4) THE PAGE ─────────────────────────────────────────────────────
v = await pg.evaluate(() => {
  gotoTab('settings'); switchSettingsSub('set-ordering');
  const panel = document.getElementById('set-ordering');
  const out = { tabs: [...panel.querySelectorAll('[data-ord-tab]')].map(x => x.textContent.trim()),
                rows: panel.querySelectorAll('#ordPane-waste tbody tr').length,
                boxes: panel.querySelectorAll('[data-ord]').length };
  // Type on the page and read it back through the real save path.
  delete S.settings.price_book.ordering;
  panel.querySelector('[data-ord="waste.apron.run"]').value = '0.7';
  panel.querySelector('[data-ord="cons.dektiteSpare"]').value = '2';
  collectPriceBookFromUI();
  out.stored = JSON.parse(JSON.stringify(S.settings.price_book.ordering));
  out.apron = _ordWaste('apron').run;
  // …and only what was typed is kept, so a later change to a standard reaches
  // an account that never touched it.
  out.keys = Object.keys(out.stored.waste || {});
  return out;
});
check('the page carries a Wastage and a Consumables tab', 
  v.tabs.length === 2 && /Wastage/i.test(v.tabs[0]) && /Consumables/i.test(v.tabs[1]), JSON.stringify(v.tabs));
check('…a row per flashing type and a box for every allowance',
  v.rows === 5 && v.boxes >= 20, JSON.stringify({ rows: v.rows, boxes: v.boxes }));
check('…what is typed on it is what the take-off reads',
  v.apron === 0.7 && v.stored.cons.dektiteSpare === 2, JSON.stringify(v.stored));
check('…and nothing else is written down, so a standard can still be changed later',
  v.keys.length === 1 && v.keys[0] === 'apron', JSON.stringify(v.keys));

v = await pg.evaluate(() => {
  // A save made from somewhere else must not wipe the page's own store.
  S.settings.price_book.ordering = { cons: { screwsPerM2: 11 } };
  document.getElementById('set-ordering').innerHTML = '';
  collectPriceBookFromUI();
  return _ordCons().screwsPerM2;
});
check('a settings save with the page never opened leaves it alone', v === 11, String(v));

// ── (5) ONE SET OF NUMBERS, NOT FOUR ─────────────────────────────────
// The screw, rivet and underlay arithmetic was hand-copied into the priced
// take-off, the quote's own cost breakdown, the Job Pack's consumables card
// and the supplier order. Settings reaching one of them would have had the
// office reading 8 per m² on the pack beside 10 on the quote — the
// `autosaveJob` lesson in a different coat: grep for the ghost, not the
// symptom. Each of the three renderers is driven here with the same figures.
v = await pg.evaluate(() => {
  S.settings.price_book.ordering = { cons: { screwsPerM2: 12, screwsRound: 50,
                                             rivetPack: 200, rivetPerLm: 20,
                                             underlayWastePct: 35 } };
  DRAW.roofs = null; DRAW.outline = null; DRAW.scaleMetresPerPx = null;
  DRAW.lines = [ { type:'barge', measM:'5' }, { type:'ridge', measM:'9' } ];
  const by = {}; _buildMaterialPriceRows().forEach(r => by[r.key] = r);
  const d = { roofArea: 100, flashingsLm: 60 };
  const txt = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return {
    takeoffRivets: by.rivets ? by.rivets.autoQty : null,
    pack:  txt(_jpRenderConsumablesSection(d)),
    order: (function(){
      // _matRenderConsumables writes into #matConsumables rather than
      // returning, so give it somewhere to write.
      var host = document.getElementById('matConsumables');
      if (!host){ host = document.createElement('div'); host.id = 'matConsumables'; document.body.appendChild(host); }
      try { _matRenderConsumables(d); } catch(e){ return 'threw: ' + e.message; }
      return txt(host.innerHTML);
    })()
  };
});
check('the priced take-off follows a rivet box typed on the page',
  v.takeoffRivets === 200, String(v.takeoffRivets));
// 100 m² × 12 = 1200 screws, already a multiple of 50; 60 lm ÷ 20 = 3 boxes
// of 200 = 600 rivets; underlay covers 135 m².
check('…and so does the Job Pack’s own consumables card',
  /× 12 = 1200/.test(v.pack) && /135\.0 m²/.test(v.pack),
  v.pack.slice(0, 200));
check('…and the supplier order, which used to print 8 per m² beside it',
  /× 12 = 1200/.test(v.order) && /auto: 600 \(200 \/ 20lm/.test(v.order) &&
  /incl\. 35% waste/.test(v.order), v.order.slice(0, 400));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(r => !r).length;
console.log((bad ? 'FAIL' : 'PASS') + '  ' + (results.length - bad) + '/' + results.length);
process.exit(bad ? 1 : 0);
