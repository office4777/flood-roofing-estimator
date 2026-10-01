// The owner, 2026-10-01, on a Re-Screw & paint quote:
//   "the summary is wrong, make the summary editable and remove those things
//    if their selection was removed, and make it all editable like the whats
//    included description with a button on the left"
//   "it's also not visually showing that i've clicked my custom option of
//    'roof paint' included, it changed the price but doesn't show it selected
//    or show it's recommended"
// Pinned on the modern quote (computer and phone):
//   • a section the office deleted (grade, profile, thickness) leaves "What you
//     chose" and the rail's "Your choices" too;
//   • "Edit summary" stands beside the summary (office only): the main line's
//     words, and the picks reworded, removed, reordered, added to — saved on the
//     quote, read by the customer, reset back to the automatic list;
//   • an office option (an extra group) shows the picked row as picked, and the
//     Recommended pill on the roofer's pick — live in the office, the stamped
//     `recommended.extras` for the customer.
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
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_first_roof','never'); });
await pg.goto('file://' + DIR + '/app.html');
await sleep(2600);

const PAINT = { id:'roofpaint', title:'Roof Paint', rows:[
  { id:'no',  name:'Not included', desc:'', price:0 },
  { id:'yes', name:'Included', desc:'Apply new Roof paint using an airless roof painting sprayer', price:3750 } ] };
await pg.evaluate(async (g) => {
  S.settings = S.settings || {};
  S.settings.selectables = _defaultSelectables();
  S.settings.selectables.extras = [JSON.parse(JSON.stringify(g))];
  S.quote = S.quote || defaultQuote();
  S.quote.style = 'modern'; S.quote.gstRate = 15; S.quote.selectablesSnapshot = null; S.quote.share = null;
  S.quote.proposalOptions = { steelGrade:'maxam' };
  S.quote.lineItems = [{ desc:'Re-screw', qty:1, price:2876.16 }];
  try { recalcQuoteTotals(); } catch(e){}
  gotoTab('quote'); await new Promise(r => setTimeout(r, 600));
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 900));
}, PAINT);

// ── the office's own option shows what was picked ─────────────────
await pg.evaluate(() => _setProposalOption_extra('roofpaint', 'yes'));
await sleep(700);
const optState = () => pg.evaluate(() => {
  const rows = [...document.querySelectorAll('#qpRoot .qb-opt[data-qb-opt="extra:roofpaint"]')];
  return rows.map(r => ({ val: r.getAttribute('data-qb-val'), on: r.classList.contains('on'), rec: !!r.querySelector('.qb-rec') }));
});
let v = await optState();
check('picking "Included" on the Roof Paint option shows that row picked', v.length === 2 && v.find(x => x.val === 'yes').on && !v.find(x => x.val === 'no').on, JSON.stringify(v));
check('…with "Recommended for your roof" on the roofer’s pick, not the first row', v.find(x => x.val === 'yes').rec && !v.find(x => x.val === 'no').rec, JSON.stringify(v));
v = await pg.evaluate(async () => {
  _qbRecSnapshot && (S.quote.recommended = _qbRecSnapshot());
  const stamped = S.quote.recommended && S.quote.recommended.extras && S.quote.recommended.extras.roofpaint;
  // the customer turns it off: their pick moves, the recommendation stays
  window.__CUSTOMER_MODE = true;
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { extras: { roofpaint: 'no' } });
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 500));
  const rows = [...document.querySelectorAll('#qpRoot .qb-opt[data-qb-opt="extra:roofpaint"]')].map(r => ({ val: r.getAttribute('data-qb-val'), on: r.classList.contains('on'), rec: !!r.querySelector('.qb-rec') }));
  window.__CUSTOMER_MODE = false;
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { extras: { roofpaint: 'yes' } });
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 400));
  return { stamped, rows };
});
check('the send stamps the roofer’s option pick as the recommendation', v.stamped === 'yes', JSON.stringify(v));
check('…so the customer sees their own pick as picked and the roofer’s as recommended',
  v.rows.find(x => x.val === 'no').on && v.rows.find(x => x.val === 'yes').rec && !v.rows.find(x => x.val === 'no').rec, JSON.stringify(v.rows));

// ── a deleted section leaves the summary ──────────────────────────
const picks = () => pg.evaluate(() => ({
  sum: [...document.querySelectorAll('#qpRoot .qb-picks .qb-pick span')].map(x => x.textContent),
  all: _qbPicks().map(r => r[0]),
}));
v = await picks();
check('to start with, the summary names the steel grade, profile and thickness', ['Steel grade', 'Roof profile', 'Steel thickness'].every(k => v.all.includes(k)), JSON.stringify(v));
await pg.evaluate(async () => { ['grade', 'profile', 'thickness'].forEach(k => _qbSectionRemove(k)); await new Promise(r => setTimeout(r, 600)); });
v = await picks();
check('deleting the grade, profile and thickness pages takes them off "What you chose" (and the rail, which reads the same list)',
  !['Steel grade', 'Roof profile', 'Steel thickness'].some(k => v.all.includes(k)) && !v.sum.some(k => /Steel grade|Roof profile|Steel thickness/.test(k)), JSON.stringify(v));

// ── Edit summary ──────────────────────────────────────────────────
v = await pg.evaluate(() => { const b = document.querySelector('#qpRoot [data-qe-btn="summary"]'); return b ? b.textContent : ''; });
check('the summary carries an "Edit summary" button (office)', /Edit summary/.test(v), v);
v = await pg.evaluate(async () => {
  _qeEdit('summary'); await new Promise(r => setTimeout(r, 200));
  const m = document.getElementById('qsumModal');
  const before = m._rows.length;
  document.getElementById('qsumBase').value = 'Re-screw & paint — main scope of work';
  _qsumDel(0);                                      // the first automatic line goes
  _qsumAdd(); const i = m._rows.length - 1;
  _qsumSet(i, 'label', 'Fixings'); _qsumSet(i, 'value', 'New roofing screws');
  _qsumSave(); await new Promise(r => setTimeout(r, 600));
  return { before, saved: S.quote.summaryPicks, base: S.quote.summaryBaseLabel,
           sumText: (document.querySelector('#qpRoot .qb-sum') || {}).textContent || '',
           pickText: (document.querySelector('#qpRoot .qb-picks') || {}).textContent || '' };
});
check('Edit summary rewords the main line', v.base === 'Re-screw & paint — main scope of work' && /Re-screw & paint — main scope of work/.test(v.sumText), v.sumText.slice(0, 120));
check('…takes a line off, adds the office’s own, and the summary shows it', /Fixings/.test(v.pickText) && /New roofing screws/.test(v.pickText) && Array.isArray(v.saved), v.pickText);
v = await pg.evaluate(async () => {
  window.__CUSTOMER_MODE = true; refreshQuoteProposal(); await new Promise(r => setTimeout(r, 400));
  const out = { btn: !!document.querySelector('#qpRoot [data-qe-btn="summary"]'), text: (document.querySelector('#qpRoot .qb-picks') || {}).textContent || '',
                base: (document.querySelector('#qpRoot .qb-sum') || {}).textContent || '' };
  window.__CUSTOMER_MODE = false; refreshQuoteProposal(); await new Promise(r => setTimeout(r, 300));
  return out;
});
check('…the customer reads the same words, with no edit button', !v.btn && /Fixings/.test(v.text) && /Re-screw & paint/.test(v.base), JSON.stringify(v).slice(0, 200));
v = await pg.evaluate(async () => {
  _qeEdit('summary'); await new Promise(r => setTimeout(r, 200));
  _qsumReset(); _qsumSave(); await new Promise(r => setTimeout(r, 300));
  return { picks: 'summaryPicks' in S.quote, base: 'summaryBaseLabel' in S.quote };
});
check('"Reset to automatic" and Save deletes the edits from the quote', !v.picks && !v.base, JSON.stringify(v));
// ── Save as template (2026-10-01, the owner's: "add a save as template
// button on the quote tab ... save as a re-screw and paint template") ──
v = await pg.evaluate(async () => {
  S.quote.proposalTitle = 'Re-Screw & Optional Painting Proposal';
  S.quote.custDesc = ['Remove existing Roofing Nails', 'Supply & install new Roofing Screws'];
  S.quote.summaryBaseLabel = 'Re-screw & paint — main scope of work';
  S.quote.summaryPicks = [{ label: 'Fixings', value: 'New roofing screws' }];
  const btn = document.getElementById('qaSaveTplBtn');
  _qtSaveQuoteAsTemplate(); await new Promise(r => setTimeout(r, 100));
  const offered = document.getElementById('qtSaveName').value;
  document.getElementById('qtSaveName').value = 'Re-Screw & Paint';
  await _qtSaveQuoteAsTemplateGo();
  const t = _qtTemplates().find(x => x.name === 'Re-Screw & Paint');
  return { btn: !!btn && /Save as template/.test(btn.textContent), offered, saved: !!t, id: t && t.id, wording: t && t.tpl.wording,
           parked: t && t.tpl.modernParked, named: S.quote.templateName };
});
check('the Quote tab has a Save as template button, offering the proposal’s own title as the name',
  v.btn && v.offered === 'Re-Screw & Optional Painting', JSON.stringify(v).slice(0, 200));
check('…which saves the quote as a template carrying its title, description, summary and the pages taken out',
  v.saved && v.wording.proposalTitle === 'Re-Screw & Optional Painting Proposal' && v.wording.custDesc.length === 2 &&
  v.wording.summaryBaseLabel && v.wording.summaryPicks.length === 1 && ['grade', 'profile', 'thickness'].every(k => v.parked.includes(k)) && v.named === 'Re-Screw & Paint',
  JSON.stringify(v).slice(0, 300));
const tplId = v.id;
v = await pg.evaluate(async (id) => {
  // another quote, back to the default layout and wording…
  _qChangeTemplate('__default'); await new Promise(r => setTimeout(r, 300));
  const before = { title: _qbProposalTitle(), desc: S.quote.custDesc };
  // …then started from the template
  _qChangeTemplate(id); await new Promise(r => setTimeout(r, 500));
  return { before, title: _qbProposalTitle(), desc: S.quote.custDesc, base: S.quote.summaryBaseLabel, parked: S.quote.modernParked };
}, tplId);
check('starting a quote from it brings all of that back', v.before.title !== v.title && v.title === 'Re-Screw & Optional Painting Proposal' &&
  Array.isArray(v.desc) && v.desc.length === 2 && /Re-screw/.test(v.base) && v.parked.includes('grade'), JSON.stringify(v).slice(0, 300));

// ── "Quote last sent to Fergus" belongs to its job ────────────────
v = await pg.evaluate(async () => {
  S.fergusSent = { quote: '2026-10-01T01:00:00.000Z' }; _renderFergusSent();
  const shownA = (document.getElementById('fergusSentQuoteLbl') || { style: {} }).style.display !== 'none';
  restoreFromJob({ id: 'jobB', draw_state: { state: { quote: defaultQuote() }, draw: {} } });
  const lbl = document.getElementById('fergusSentQuoteLbl');
  return { shownA, after: S.fergusSent, shownB: !!lbl && lbl.style.display !== 'none' };
});
check('opening another job clears the last job’s "Quote last sent to Fergus" (it was crossing between jobs)', v.shownA && !v.after && !v.shownB, JSON.stringify(v));
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 300));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
