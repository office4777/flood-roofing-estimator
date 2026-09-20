// Feedback report 56: "confusing with the document style and hard to edit the
//  quote — just have the computer and phone options, remove the document
//  style, but bring back the quote editor with two main options, Classic
//  style and Modern style … then all the pages should be editable. In the
//  quote tab down the left hand side, put Edit description with an arrow
//  pointing at the description on that page, same with the selections —
//  Edit this quote's selections — which pops up a window to edit the listed
//  products for this specific quote, with a button Edit default selections
//  that jumps to the settings products tab."
//
// Pinned: the rail and its two buttons; the description editor edits the
// modern lines or the classic scope depending on the style; the selections
// window hides a product for THIS quote only (never the base grade, never
// what is picked, never the company's defaults) and every layout leaves it
// out; the defaults button lands on Settings → Quote's Product Options; a
// print from any preview is the A4; and the CUSTOMER gets the style the
// office chose — classic is the document on a computer and the reflowed
// document on a phone.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

// ── the office ────────────────────────────────────────────────────
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);

const rail = await pg.evaluate(() => {
  const r = document.getElementById('qeRail'); const card = document.querySelector('.qe-wrap > .card');
  const rr = r.getBoundingClientRect(), cr = card.getBoundingClientRect();
  return { rail: !!r, left: rr.right <= cr.left + 1, desc: !!document.getElementById('qeBtnDesc'), sel: !!document.getElementById('qeBtnSel'),
           selText: (document.getElementById('qeBtnSel')||{}).textContent || '', arrows: r.querySelectorAll('.qe-arrow').length, office: r.classList.contains('no-print') };
});
check('the rail sits down the LEFT of the preview with Edit description and Edit this quote’s selections, arrows and all',
  rail.rail && rail.left && rail.desc && rail.sel && /quote.s selections/i.test(rail.selText) && rail.arrows === 2 && rail.office, JSON.stringify(rail));

// the arrow's landing on each layout
const spots = await pg.evaluate(async () => {
  const out = {};
  _qeSpot('desc'); out.desk = (document.querySelector('.qe-spot') || {}).className || '';
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 600));
  _qeSpot('desc'); await new Promise(r => setTimeout(r, 200));
  out.bookPage = document.getElementById('qbPage').dataset.qbPage; out.book = (document.querySelector('.qe-spot') || {}).className || '';
  _setQuoteStyle('classic'); _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 800));
  _qeSpot('desc'); out.a4 = !!document.querySelector('[data-qe="desc"].qe-spot');
  return out;
});
check('Edit description points at the description on the one-page layout, turns the book to the proposal page, and finds the document’s scope',
  /qb-incl/.test(spots.desk) && spots.bookPage === 'proposal' && /qb-incl/.test(spots.book) && spots.a4, JSON.stringify(spots));

// the description editor follows the style
const cdesc = await pg.evaluate(async () => {
  _qeEditDescription(); await new Promise(r => setTimeout(r, 300));
  const h = document.getElementById('qdescModal'); const classic = h._classic; const n = h._lines.length;
  _qdescSet(0, 'Scaffold the whole house'); _qdescSave(); await new Promise(r => setTimeout(r, 400));
  return { classic, n, first: (S.quote.scope || '').split('\n')[0], custDescUntouched: !S.quote.custDesc };
});
check('in Classic the editor edits the document’s "What’s included" scope, a bullet a line', cdesc.classic && cdesc.n >= 3 && cdesc.first === '• Scaffold the whole house' && cdesc.custDescUntouched, JSON.stringify(cdesc));
const mdesc = await pg.evaluate(async () => {
  _setQuoteStyle('modern'); await new Promise(r => setTimeout(r, 800));
  _qeEditDescription(); await new Promise(r => setTimeout(r, 300));
  const h = document.getElementById('qdescModal'); const classic = h._classic;
  _qdescSet(0, 'Scaffold it'); _qdescSave(); await new Promise(r => setTimeout(r, 400));
  return { classic, first: (S.quote.custDesc || [])[0], scopeKept: /Scaffold the whole house/.test(S.quote.scope || '') };
});
check('in Modern the same button edits the six customer lines, and the classic scope is left alone', !mdesc.classic && mdesc.first === 'Scaffold it' && mdesc.scopeKept, JSON.stringify(mdesc));

// this quote's selections
const sel = await pg.evaluate(async () => {
  _qeEditSelections(); await new Promise(r => setTimeout(r, 300));
  const rows = [...document.querySelectorAll('#qselList input')].map(i => ({ k: i.dataset.qselKind, id: i.dataset.qselId, locked: i.disabled }));
  const groups = [...document.querySelectorAll('#qselList .qsel-g')].map(g => g.textContent);
  const cz = document.querySelector('#qselList input[data-qsel-id="colorzen"]'); cz.checked = false; cz.dispatchEvent(new Event('change'));
  const ext = document.querySelector('#qselList input[data-qsel-kind="brackets"][data-qsel-id="external"]'); ext.checked = false; ext.dispatchEvent(new Event('change'));
  _qselSave(); await new Promise(r => setTimeout(r, 800));
  return { rows: rows.length, groups, baseLocked: rows.find(r => r.id === 'maxam').locked, corrLocked: rows.find(r => r.id === 'corrugate').locked,
           stdThickLocked: rows.find(r => r.k === 'thickness' && r.id === '40').locked,
           selHide: S.quote.selHide, deskGrades: [...document.querySelectorAll('#qpRoot [data-qb-opt="steelGrade"]')].map(e => e.dataset.qbVal),
           settingsClean: !JSON.stringify((S.settings || {}).selectables || {}).includes('"hidden":true') };
});
check('the selections window lists every group, with the base grade, the standard profile and the standard choices locked on',
  sel.rows >= 12 && sel.groups.length >= 7 && sel.baseLocked && sel.corrLocked && sel.stdThickLocked, JSON.stringify({ rows: sel.rows, groups: sel.groups }));
check('unticking a grade and a bracket hides them on THIS quote only', JSON.stringify(sel.selHide) === '{"grades":{"colorzen":true},"brackets":{"external":true}}' && sel.settingsClean, JSON.stringify(sel.selHide));
check('…and the one-page layout no longer offers that grade', !sel.deskGrades.includes('colorzen') && sel.deskGrades.includes('maxam'), sel.deskGrades.join(','));
const bookHide = await pg.evaluate(async () => {
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 700));
  const keys = _qbPages().map(p => p.key); _qbGo(keys.indexOf('grade')); await new Promise(r => setTimeout(r, 400));
  const grades = [...document.querySelectorAll('#qbPage [data-qb-opt="steelGrade"]')].map(e => e.dataset.qbVal);
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 600));
  _qbGo(_qbPages().map(p => p.key).indexOf('gutterkit')); await new Promise(r => setTimeout(r, 400));
  const brackets = [...document.querySelectorAll('#qbPage [data-qb-opt="gutterBracket"]')].map(e => e.dataset.qbVal);
  _setProposalOption_gutter('none'); _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 600));
  return { grades, brackets };
});
check('…nor does the book, on the grade page or the brackets page', !bookHide.grades.includes('colorzen') && bookHide.brackets.join(',') === 'internal', JSON.stringify(bookHide));
const a4Hide = await pg.evaluate(async () => {
  _setQuoteStyle('classic'); await new Promise(r => setTimeout(r, 800));
  // The document's selection cards (its products page also carries marketing
  // prose that names the grades; that is copy, not an offer).
  const cards = [...document.querySelectorAll('#qpRoot [onclick*="_setProposalOption_grade"]')].map(e => e.getAttribute('onclick'));
  const out = { zen: cards.some(c => /colorzen/.test(c)), maxam: cards.some(c => /maxam/.test(c)), n: cards.length };
  _setQuoteStyle('modern'); await new Promise(r => setTimeout(r, 800));
  return out;
});
check('…nor does the classic document', !a4Hide.zen && a4Hide.maxam, JSON.stringify(a4Hide));
const noPick = await pg.evaluate(async () => {
  _setProposalOption_grade('colourcote'); await new Promise(r => setTimeout(r, 500));
  _qeEditSelections(); await new Promise(r => setTimeout(r, 300));
  const cc = document.querySelector('#qselList input[data-qsel-id="colourcote"]');
  const out = { locked: cc.disabled, why: (cc.closest('.qsel-row').querySelector('.qsel-why') || {}).textContent || '' };
  _qselClose(); _setProposalOption_grade('maxam'); await new Promise(r => setTimeout(r, 400));
  return out;
});
check('the grade picked on this quote cannot be hidden', noPick.locked && /picked/.test(noPick.why), JSON.stringify(noPick));
const defaults = await pg.evaluate(async () => {
  _qeEditSelections(); await new Promise(r => setTimeout(r, 200));
  const btn = [...document.querySelectorAll('#qselModal button')].find(x => /Edit default selections/.test(x.textContent));
  btn.click(); await new Promise(r => setTimeout(r, 600));
  const panel = document.getElementById('set-products');
  return { modalGone: !document.getElementById('qselModal'), settingsTab: document.getElementById('tab-settings').classList.contains('active'),
           products: !!panel && getComputedStyle(panel).display !== 'none' };
});
check('"Edit default selections" jumps to Settings → Quote’s Product Options', defaults.modalGone && defaults.settingsTab && defaults.products, JSON.stringify(defaults));
await pg.evaluate(() => gotoTab('quote')); await pg.waitForTimeout(800);

// a print from the one-page preview is still the A4
const pr = await pg.evaluate(async () => {
  window.print = () => { window.__printedA4 = document.querySelectorAll('#qpRoot .rp-page').length; window.__printedDesk = !!document.getElementById('qdRoot'); };
  printQuote(); await new Promise(r => setTimeout(r, 1500));
  return { a4: window.__printedA4, desk: window.__printedDesk, back: !!document.getElementById('qdRoot'), flag: !!window.__PRINTING_QUOTE };
});
check('Print from the modern preview prints the A4 document and the preview comes back', pr.a4 > 0 && !pr.desk && pr.back && !pr.flag, JSON.stringify(pr));
check('nothing threw in the office', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();

// ── the customer gets the style the office chose ──────────────────
const quote = (patch) => Object.assign({ ref:'FR-30140', client:'Sharon Whittaker', addr:'14 Kamo Road', date:'20/09/2026', validUntil:'30 days', gstRate:15,
  baseGrade:'maxam', materialBase:9200, gutterLm:48, gutterLines:4, scaffoldBase:4200,
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40', colour:'', gutterType:'none', disposal:'dispose' },
  lineItems:[{ desc:'Strip and re-roof', qty:1, unit:31200 }], total:31200 }, patch || {});
async function customer(viewport, q){
  const c = await b.newContext(Object.assign({ viewport }, viewport.width <= 720 ? { isMobile:true, hasTouch:true } : {}));
  const p = await c.newPage(); const e = []; p.on('pageerror', x => e.push(x.message));
  await p.route('**/api.mapbox.com/**', r => r.abort());
  await p.route('**/flood-roofing-estimator-production.up.railway.app/**', r => { const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
    if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd' } }) });
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' }); });
  await p.goto('file://' + DIR + '/app.html?q=tok&j=' + q.ref); await p.waitForTimeout(3000);
  const v = await p.evaluate(() => ({ a4: document.querySelectorAll('#qpRoot .rp-page').length, qd: !!document.getElementById('qdRoot'), book: !!document.querySelector('#qpRoot .qb'),
    desk: document.documentElement.classList.contains('qp-desk'), bookCls: document.documentElement.classList.contains('qp-book'),
    reflow: document.documentElement.classList.contains('customer-mobile'), bar: getComputedStyle(document.getElementById('custBar')).display !== 'none',
    grades: [...document.querySelectorAll('[data-qb-opt="steelGrade"]')].map(x => x.dataset.qbVal), text: document.getElementById('qpRoot').textContent }));
  await c.close(); return Object.assign(v, { errs: e });
}
const kc = await customer({ width:1366, height:850 }, quote({ style:'classic' }));
check('a CLASSIC quote on the customer’s computer is the A4 document with the price bar, not the one-page layout', kc.a4 > 0 && !kc.qd && !kc.desk && kc.bar, JSON.stringify({ a4: kc.a4, qd: kc.qd, bar: kc.bar }));
const kp = await customer({ width:390, height:844 }, quote({ style:'classic' }));
check('…and on their phone it is the document reflowed, not the book', kp.a4 > 0 && !kp.book && !kp.bookCls && kp.reflow, JSON.stringify({ a4: kp.a4, book: kp.book, reflow: kp.reflow }));
const mc = await customer({ width:1366, height:850 }, quote({ style:'modern', selHide:{ grades:{ colorzen:true } } }));
check('a MODERN quote is the one-page layout, without the grade the office took off this quote', mc.qd && mc.desk && !mc.grades.includes('colorzen') && mc.grades.includes('maxam'), mc.grades.join(','));
const mp = await customer({ width:390, height:844 }, quote({ selHide:{ grades:{ colorzen:true } } }));
check('…and with no style at all a quote is modern (the book on a phone)', mp.book && mp.bookCls);
check('nothing threw on the customer’s screens', [kc, kp, mc, mp].every(x => x.errs.length === 0));

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
