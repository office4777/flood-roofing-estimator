// A QUOTE KEEPS THE PRODUCTS IT WAS BUILT WITH (2026-10-29, the owner on job
// 3306: "i just clicked on a sent quote, i want to duplicate it to add another
// option the customer requested ... when i created a new draft and clicked
// duplicate this quote, it deleted the custom roof profile and changed the
// price total"). The draft read Settings' product list alone; RI-925 was not
// in it any more (the list the 2026-10-28 reload bug wrote over), so the
// profile the quote was sent on — and the price it carries — fell away, and
// every autosave stamped the poorer list over the quote's own copy.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Kauri Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { try { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.removeItem('fr_settings'); window.__DEFAULT_QUOTE_STYLE = 'modern'; } catch(e){} });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','_rsModal','tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });

const r = await pg.evaluate(() => {
  const o = {};
  gotoTab('roof'); clearAll(true);
  DRAW.scaleMetresPerPx = 0.05; DRAW.calPitch = 15;
  DRAW.outline = [[0,0],[200,0],[200,120],[0,120]]; DRAW.outlineDone = true;
  autoGenerateRoof('gable');
  S.settings.price_book = S.settings.price_book || {};
  S.settings.price_book.sheets = [{ product:'Standard corrugate', price:20, unit:'m2' }];
  S.settings.price_book.defaultSheetProduct = 'Standard corrugate';
  const sel = JSON.parse(JSON.stringify(_defaultSelectables()));
  sel.profiles.push({ id:'p_ri925', name:'RI-925', locksGauge:'', coverMm:925, rate:38, rateUnit:'m2', desc:'Tray' });
  S.settings.selectables = sel;
  if (!S.quote) S.quote = defaultQuote();
  S.quote.proposalOptions = S.quote.proposalOptions || {};
  S.quote.proposalOptions.profile = 'p_ri925';
  S.quote.baseProfile = 'p_ri925';
  gotoTab('quote');
  const settle = () => { try { renderMaterialPriceTable(); } catch(e){} try { calcLabour(); } catch(e){} try { _syncQuoteBaseLineItems(); } catch(e){} try { recalcQuoteTotals(); } catch(e){} };
  settle();
  const sheetPrice = () => ((((_buildMaterialPriceRows() || []).filter(x => x.key === 'sheets')[0] || {}).variants || [])[0] || {}).price;
  o.before = { tot: Math.round(_quoteMoney().tot * 100) / 100, price: sheetPrice() };
  _qStampCustomerCopy(); _qvMarkSent();
  o.snapHas = (S.quote.versions.sent.quote.selectablesSnapshot.profiles || []).some(p => p.id === 'p_ri925');
  // Settings loses it — the 2026-10-28 overwrite, or simply deleted.
  S.settings.selectables.profiles = S.settings.selectables.profiles.filter(p => p.id !== 'p_ri925');
  _qvView('sent');
  _qvNewDraft();
  settle();
  o.after = { viewing: !!S._qvViewing, locked: !!S.jobLocked, pick: S.quote.proposalOptions.profile,
              offered: _selProfiles().map(p => p.id), price: sheetPrice(),
              tot: Math.round(_quoteMoney().tot * 100) / 100 };
  // the autosave's stamp keeps it on the quote
  _qStampCustomerCopy();
  o.stampHas = (S.quote.selectablesSnapshot.profiles || []).some(p => p.id === 'p_ri925');
  try { refreshQuoteProposal(); } catch(e){}
  o.page = (document.getElementById('qpRoot') || {}).innerText || '';
  // a product Settings REMOVED (kept, marked removed) stays removed
  S.settings.selectables.profiles.push({ id:'p_ri925', name:'RI-925', removed:true, rate:38, rateUnit:'m2' });
  o.removedOffered = _selProfiles().some(p => p.id === 'p_ri925');
  o.removedResolves = _selProfilesAll().some(p => p.id === 'p_ri925');
  return o;
});
check('the sent quote carries RI-925 in its own product list', r.snapHas);
check('Duplicate this quote off the sent copy gives an editable draft', !r.after.viewing && !r.after.locked, JSON.stringify(r.after));
check('…that still offers RI-925 and keeps it picked, though Settings no longer has it',
  r.after.offered.includes('p_ri925') && r.after.pick === 'p_ri925', JSON.stringify(r.after));
check('…and still prices the sheets at RI-925’s own rate', r.after.price === 38 && r.before.price === 38, r.before.price + ' → ' + r.after.price);
check('…so the total is the total that was sent', Math.abs(r.after.tot - r.before.tot) < 0.01 && r.before.tot > 0, r.before.tot + ' → ' + r.after.tot);
check('the autosave stamp keeps RI-925 on the quote’s own list', r.stampHas);
check('the proposal names RI-925, not Corrugate', /RI-925/.test(r.page), r.page.slice(0, 200));
check('a product Settings REMOVED is not offered again', !r.removedOffered && r.removedResolves);

// ── AS SENT vs WORKED OUT TODAY (the second message the same morning) ──
const a = await pg.evaluate(() => {
  const o = {};
  const settle = () => { try { renderMaterialPriceTable(); } catch(e){} try { calcLabour(); } catch(e){} try { _syncQuoteBaseLineItems(); } catch(e){} try { recalcQuoteTotals(); } catch(e){} };
  S.settings.selectables.profiles = S.settings.selectables.profiles.filter(p => p.id !== 'p_ri925');
  delete S.quote.dupFrom;
  S.settings.price_book.ridge_lm = 40;
  settle();
  o.sentTot = Math.round(_quoteMoney().tot * 100) / 100;
  _qStampCustomerCopy(); _qvMarkSent();
  // the price book moves after the send
  S.settings.price_book.ridge_lm = 10;
  _qvView('sent'); settle();
  const strip = () => { const el = document.getElementById('prAsSent'); return el && el.style.display !== 'none' ? el.innerText : ''; };
  try { renderProfitability(); } catch(e){}
  o.frozenStrip = strip();
  o.frozenTot = Math.round(_quoteMoney().tot * 100) / 100;
  _qvNewDraft(); settle(); try { renderProfitability(); } catch(e){}
  o.draftTot = Math.round(_quoteMoney().tot * 100) / 100;
  o.draftStrip = strip();
  o.btn = !!document.querySelector('#prAsSent .pas-btn');
  _asSentCarry(); settle();
  o.carriedTot = Math.round(_quoteMoney().tot * 100) / 100;
  o.afterStrip = strip();
  o.lines = (S.quote.customLines && S.quote.customLines.material || []).map(l => l.desc + ' ' + l.amount);
  return o;
});
check('a sent quote whose prices moved says so in the Pricing drawer, part by part',
  /priced differently/.test(a.frozenStrip) && /Materials/.test(a.frozenStrip) && /less today/.test(a.frozenStrip) && !/Labour[^\n]*less today/.test(a.frozenStrip), a.frozenStrip);
check('…while the sent copy itself still reads what was sent', Math.abs(a.frozenTot - a.sentTot) < 0.01, a.sentTot + ' / ' + a.frozenTot);
check('the duplicate is priced today, and says what it was duplicated from', a.draftTot < a.sentTot && /duplicated from the sent quote/.test(a.draftStrip) && a.btn, a.draftTot + ' | ' + a.draftStrip.slice(0, 120));
check('"Keep the sent prices" brings the draft back to the sent total, as a visible line',
  Math.abs(a.carriedTot - a.sentTot) < 0.02 && a.lines.some(l => /^As sent/.test(l)), a.carriedTot + ' vs ' + a.sentTot + ' ' + JSON.stringify(a.lines));
check('…and the note goes once it is carried', a.afterStrip === '', a.afterStrip);
// ── THE SAME NOTE ON THE QUOTE TAB, AND THE OPTIONS NAMED (2026-10-29, job
// 3306 again: the drawer was shut, so the yellow box was never seen; and the
// RI-925 / 0.55 gauge row moves with the material price too) ──
const q = await pg.evaluate(() => {
  const o = {};
  const settle = () => { try { renderMaterialPriceTable(); } catch(e){} try { calcLabour(); } catch(e){} try { _syncQuoteBaseLineItems(); } catch(e){} try { recalcQuoteTotals(); } catch(e){} };
  S.quote.customLines = {}; delete S.quote.dupFrom;
  S.settings.price_book.ridge_lm = 40;
  S.quote.proposalOptions.steelGrade = 'colourcote';
  settle();
  o.sentSub = Math.round(_quoteMoney().sub * 100) / 100;
  o.sentDelta = Math.round(_quoteMoney().deltaSum * 100) / 100;
  _qStampCustomerCopy(); _qvMarkSent();
  S.settings.price_book.ridge_lm = 10;
  // and an option's price moves too: ColorCote's percentage in Settings
  S.settings.selectables.grades.forEach(g => { if (g.id === 'colourcote') g.pct = -0.2; });
  _qvView('sent'); settle();
  _qvNewDraft(); settle(); try { renderProfitability(); } catch(e){} try { _qvRenderBar(); } catch(e){}
  const bar = () => { const el = document.getElementById('qAsSentBar'); return el ? el.innerText : ''; };
  o.dupSub = S.quote.dupFrom && S.quote.dupFrom.sub;
  o.draftSub = Math.round(_quoteMoney().sub * 100) / 100;
  o.draftDelta = Math.round(_quoteMoney().deltaSum * 100) / 100;
  const i = _asSentInfo();
  o.diffs = i && i.diffs; o.total = i && i.total;
  o.bar = bar();
  o.inQuoteTab = !!document.querySelector('#qaVersions #qAsSentBar .qas-btn');
  document.querySelector('#qAsSentBar .qas-btn').click(); settle();
  o.carriedSub = Math.round(_quoteMoney().sub * 100) / 100;
  o.barAfter = bar();
  return o;
});
check('a duplicate remembers the sent sub-total', Math.abs((q.dupSub || 0) - q.sentSub) < 0.01, q.dupSub + ' / ' + q.sentSub);
check('…the options that moved with the price are named beside the base lines',
  q.sentDelta !== q.draftDelta && q.diffs && q.diffs.other != null && Math.abs(q.total - (q.sentSub - q.draftSub)) < 0.02, JSON.stringify(q));
check('the Quote tab itself says how much less the draft comes to, part by part, with the button',
  q.inQuoteTab && /less<\/?|less/.test(q.bar) && /Materials/.test(q.bar) && /Options/.test(q.bar), q.bar);
check('…the button there brings the draft to the sent sub-total, and the note goes',
  Math.abs(q.carriedSub - q.sentSub) < 0.02 && q.barAfter === '', q.carriedSub + ' vs ' + q.sentSub + ' | ' + q.barAfter);
check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
