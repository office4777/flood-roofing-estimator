// CUSTOM OPTIONS ON THE QUOTE, AND WHAT THEY SAY (the owner, 2026-10-02):
//   "have the quote reflect the options, even my custom option of the roof
//    paint, the recommended choice should be added to the line item of the
//    whats included, then if the customer decides to exclude it, it should be
//    removed from the whats included and added as an exclusion line ... do the
//    same for the Gutters"
//   "let me be able to add it as an 'insert custom option' button in the left
//    menu above the roof colour section ... a delete this page button ... an
//    edit this section button to edit the title and the options ... a save
//    this custom option button ... next time it should give me two options,
//    new custom option or select from saved"
// Pinned on the modern quote's computer layout:
//   • "+ Insert custom option" stands above the roof colour (office only);
//   • a new option made in the editor lands on THIS quote (S.quote.customExtras)
//     with its recommended pick, its price in the total and in share.priced,
//     and Edit / Save / Delete on its section;
//   • What's included carries the picked choice's words; a pick that leaves it
//     out moves the option to What's excluded; the gutter does the same;
//   • edit changes the title and the prices; save keeps it in Settings
//     (branding.saved_options); delete takes it off; insert-from-saved brings
//     it back with its recommendation; a Settings option taken off this quote
//     is offered back; a template carries the quote's options.
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

await pg.evaluate(async () => {
  window.__savedSettings = 0;
  window.saveSettings = async function(){ window.__savedSettings++; };
  S.settings = S.settings || {};
  S.settings.selectables = _defaultSelectables();
  S.settings.selectables.extras = [{ id:'washdown', title:'Wash-down', rows:[ { id:'no', name:'Not included', price:0 }, { id:'yes', name:'Water-blast first', desc:'Water-blast the roof before work starts', price:450 } ] }];
  S.quote = S.quote || defaultQuote();
  S.quote.style = 'modern'; S.quote.gstRate = 15; S.quote.selectablesSnapshot = null; S.quote.share = null;
  S.quote.proposalOptions = { steelGrade:'maxam', gutterType:'none', extras:{ washdown:'no' } };
  S.quote.custDesc = ['Remove existing Roofing Nails', 'Supply & install new Roofing Screws'];
  S.quote.lineItems = [{ desc:'Re-screw', qty:1, price:2876.16 }];
  try { recalcQuoteTotals(); } catch(e){}
  gotoTab('quote'); await new Promise(r => setTimeout(r, 600));
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 900));
});
const state = () => pg.evaluate(() => {
  const secs = [...document.querySelectorAll('#qpRoot .qd-main > section')].map(s => s.getAttribute('data-qd-sec') || (s.hasAttribute('data-qd-addopt') ? 'ADD' : 'parked'));
  return {
    secs,
    incl: _qbInclusionLines(), excl: _qbExclusionLines(),
    domExcl: [...document.querySelectorAll('#qpRoot .qb-excl-row span')].map(x => x.textContent),
    total: Math.round(_custBarTotalValue() * 100) / 100,
  };
});

// ── the Insert button, above the roof colour ─────────────────────
let v = await state();
const addAt = v.secs.indexOf('ADD'), colAt = v.secs.indexOf('colour');
check('"+ Insert custom option" stands straight above the roof colour section', addAt >= 0 && colAt === addAt + 1, JSON.stringify(v.secs));
check('the gutter with "No new guttering" picked is an exclusion: "New guttering"', v.excl.includes('New guttering') && v.domExcl.includes('New guttering'), JSON.stringify(v.excl));
check('a Settings option left out ("Not included") is an exclusion by its title', v.excl.includes('Wash-down'), JSON.stringify(v.excl));
const base = v.total;

// ── a new custom option ───────────────────────────────────────────
v = await pg.evaluate(async () => {
  document.querySelector('#qpRoot .qco-insert').click(); await new Promise(r => setTimeout(r, 200));
  const menu = document.getElementById('qcoModal') && document.getElementById('qcoModal').textContent;
  document.getElementById('qcoNewBtn').click(); await new Promise(r => setTimeout(r, 200));
  document.getElementById('qcoTitle').value = 'Paint Roof';
  document.getElementById('qcoN0').value = 'Exclude';
  document.getElementById('qcoN1').value = 'Include';
  document.getElementById('qcoD1').value = 'Paint roof with appropriate Roof paint in any selected colour using airless sprayer';
  document.getElementById('qcoP1').value = '3680';
  document.querySelector('input[name=qcoRec][value=r2]').checked = true;
  _qcoApply(); await new Promise(r => setTimeout(r, 700));
  const g = (S.quote.customExtras || [])[0] || {};
  const sec = [...document.querySelectorAll('#qpRoot .qd-main > section')].find(s => /Paint Roof/.test((s.querySelector('h2') || {}).textContent || ''));
  return { menu, g, pick: (S.quote.proposalOptions.extras || {})[g.id],
           tools: sec ? [...sec.querySelectorAll('.qco-tools button')].map(x => x.textContent.trim()) : [],
           picked: sec ? (sec.querySelector('.qb-opt.on') || {}).getAttribute && sec.querySelector('.qb-opt.on').getAttribute('data-qb-val') : null,
           priced: (_qpBuildPriced().extras || {})[g.id] };
});
check('Insert custom option offers "New custom option" and "Select from saved"', /New custom option/.test(v.menu) && /Select from saved/.test(v.menu), v.menu);
check('the new option is on THIS quote (customExtras) with its two choices', v.g.title === 'Paint Roof' && v.g.rows.length === 2 && v.g.rows[1].price === 3680 && v.g.rows[0].price === 0, JSON.stringify(v.g));
check('…on its recommended choice, shown picked on the page', v.pick === 'r2' && v.picked === 'r2', JSON.stringify(v));
check('…with Edit this section, Save this custom option and Delete this page on its section',
  v.tools.some(t => /Edit this section/.test(t)) && v.tools.some(t => /Save this custom option/.test(t)) && v.tools.some(t => /Delete this page/.test(t)), JSON.stringify(v.tools));
check('…and in the priced block the customer’s acceptance is checked against', !!(v.priced && v.priced.rows && v.priced.rows.r2), JSON.stringify(v.priced));
v = await state();
check('…its price is in the total (+$3,680 + GST)', Math.abs(v.total - (base + 3680 * 1.15)) < 0.02, base + ' → ' + v.total);
check('What’s included carries the picked choice’s words', v.incl.includes('Paint roof with appropriate Roof paint in any selected colour using airless sprayer'), JSON.stringify(v.incl));
check('…after the office’s own lines', v.incl[0] === 'Remove existing Roofing Nails' && v.incl.length === 3, JSON.stringify(v.incl));

// ── the customer leaves it out ────────────────────────────────────
v = await pg.evaluate(async () => {
  const id = S.quote.customExtras[0].id;
  window.__CUSTOMER_MODE = true;
  _setProposalOption_extra(id, 'r1'); await new Promise(r => setTimeout(r, 500));
  const out = { incl: _qbInclusionLines(), excl: _qbExclusionLines(), domExcl: [...document.querySelectorAll('#qpRoot .qb-excl-row span')].map(x => x.textContent),
                tools: document.querySelectorAll('#qpRoot .qco-tools, #qpRoot .qco-insert').length };
  window.__CUSTOMER_MODE = false;
  _setProposalOption_extra(id, 'r2'); await new Promise(r => setTimeout(r, 400));
  return out;
});
check('the customer picks Exclude: the paint line leaves What’s included…', !v.incl.some(l => /Paint roof/.test(l)), JSON.stringify(v.incl));
check('…and "Paint Roof" is under What’s excluded, on the page', v.excl.includes('Paint Roof') && v.domExcl.includes('Paint Roof'), JSON.stringify(v));
check('the customer sees no Insert / Edit / Save buttons', v.tools === 0, String(v.tools));

// ── the gutter ───────────────────────────────────────────────────
v = await pg.evaluate(async () => {
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 400));
  const r = { incl: _qbInclusionLines(), excl: _qbExclusionLines() };
  _setProposalOption_gutter('none'); await new Promise(r2 => setTimeout(r2, 300));
  return r;
});
check('a gutter picked is included ("Supply & install new 125mm Colorsteel Box Gutter") and no longer excluded',
  v.incl.includes('Supply & install new 125mm Colorsteel Box Gutter') && !v.excl.includes('New guttering'), JSON.stringify(v));

// ── edit ─────────────────────────────────────────────────────────
v = await pg.evaluate(async () => {
  const id = S.quote.customExtras[0].id;
  _qcoEdit(id); await new Promise(r => setTimeout(r, 200));
  document.getElementById('qcoTitle').value = 'Roof Paint';
  document.getElementById('qcoP1').value = '3700';
  _qcoApply(); await new Promise(r => setTimeout(r, 500));
  const g = S.quote.customExtras[0];
  return { n: S.quote.customExtras.length, title: g.title, price: g.rows[1].price, sameId: g.id === id,
           h2: [...document.querySelectorAll('#qpRoot h2')].some(h => h.textContent === 'Roof Paint') };
});
check('Edit this section changes the title and the price, on the same option', v.n === 1 && v.title === 'Roof Paint' && v.price === 3700 && v.sameId && v.h2, JSON.stringify(v));

// ── save, delete, insert from saved ──────────────────────────────
v = await pg.evaluate(async () => {
  const id = S.quote.customExtras[0].id;
  await _qcoSave(id);
  const saved = JSON.parse(JSON.stringify(S.settings.branding.saved_options));
  const before = Math.round(_custBarTotalValue() * 100) / 100;
  _qcoDelete(id); await new Promise(r => setTimeout(r, 400));
  const afterDel = { n: (S.quote.customExtras || []).length, pick: (S.quote.proposalOptions.extras || {})[id], total: Math.round(_custBarTotalValue() * 100) / 100 };
  _qcoInsertMenu(); await new Promise(r => setTimeout(r, 200));
  const menu = document.getElementById('qcoModal').textContent;
  _qcoInsertSaved(0); await new Promise(r => setTimeout(r, 500));
  const g = S.quote.customExtras[0] || {};
  return { saved, calls: window.__savedSettings, before, afterDel, menu, g, pick: (S.quote.proposalOptions.extras || {})[g.id], total: Math.round(_custBarTotalValue() * 100) / 100 };
});
check('Save this custom option keeps it in Settings (saved_options) with its recommendation, and saves Settings',
  v.saved.length === 1 && v.saved[0].title === 'Roof Paint' && v.saved[0].rec === 'r2' && v.calls >= 1, JSON.stringify(v.saved));
check('Delete this page takes it off the quote, its pick and its price', v.afterDel.n === 0 && v.afterDel.pick == null && Math.abs(v.afterDel.total - base) < 0.02, JSON.stringify(v.afterDel));
check('Insert custom option then lists it under Select from saved', /Roof Paint/.test(v.menu), v.menu.slice(0, 200));
check('…and inserting it brings it back on its recommended choice, at its price', v.g.title === 'Roof Paint' && v.pick === 'r2' && Math.abs(v.total - v.before) < 0.02, JSON.stringify({ pick: v.pick, total: v.total, before: v.before }));

// ── a Settings option taken off this quote, and put back ─────────
v = await pg.evaluate(async () => {
  _qcoDelete('washdown'); await new Promise(r => setTimeout(r, 300));
  const hidden = !_selExtras().some(g => g.id === 'washdown');
  const exclGone = !_qbExclusionLines().includes('Wash-down');
  _qcoInsertMenu(); await new Promise(r => setTimeout(r, 200));
  const menu = document.getElementById('qcoModal').textContent;
  _qcoUnhide('washdown'); await new Promise(r => setTimeout(r, 300));
  return { hidden, exclGone, menu, back: _selExtras().some(g => g.id === 'washdown'), settingsKept: S.settings.selectables.extras.length === 1 };
});
check('deleting a Settings option takes it off THIS quote only (and off its lines)', v.hidden && v.exclGone && v.settingsKept, JSON.stringify(v));
check('…and Insert custom option offers it back', /Wash-down/.test(v.menu) && v.back, JSON.stringify(v));

// ── templates carry the quote's options ──────────────────────────
v = await pg.evaluate(() => { const t = _qtSnapshot(); return (t.wording && t.wording.customExtras || []).map(g => g.title); });
check('a template saved from this quote carries its custom options', v.includes('Roof Paint'), JSON.stringify(v));

check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 300));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
