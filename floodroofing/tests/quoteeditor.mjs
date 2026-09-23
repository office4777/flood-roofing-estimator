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
// Pinned: the edit buttons beside what they edit (the rail was replaced); the description editor edits the
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

// The buttons sit ON the preview beside what they edit (the owner: "edit
// the quote description next to the description, edit this quote's
// selections next to the selections, edit the gutter selections next to
// the gutter selections") — no rail down the left any more.
const where = await pg.evaluate(async () => {
  const at = () => [...document.querySelectorAll('#qpRoot .qe-inline')].map(b => b.dataset.qeBtn + '@' + ((b.closest('section') || {}).id || ''));
  const out = { rail: !!document.getElementById('qeRail'), desk: at() };
  _qeEdit('gutter'); await new Promise(r => setTimeout(r, 200));
  out.gutterTitle = (document.querySelector('#qselModal .qsel-hd b') || {}).textContent || '';
  out.gutterGroups = [...document.querySelectorAll('#qselList .qsel-g')].map(g => g.textContent.replace(/\s*\(.*$/, ''));
  _qselClose();
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 600));
  const keys = _qbPages().map(p => p.key); out.book = {};
  for (const k of ['proposal', 'grade', 'gutter']){ _qbGo(keys.indexOf(k)); await new Promise(r => setTimeout(r, 150)); out.book[k] = [...document.querySelectorAll('#qbPage .qe-inline')].map(b => b.dataset.qeBtn).join(','); }
  _setQuoteStyle('classic'); _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 900));
  out.a4 = [...document.querySelectorAll('#qpRoot .qe-inline')].map(b => b.dataset.qeBtn);
  _setQuoteStyle('modern'); await new Promise(r => setTimeout(r, 700));
  return out;
});
check('Edit description sits on the proposal, Edit roof condition on the condition, Edit this quote’s selections on the roofing, Edit gutter selections on the guttering',
  where.desk.join(',') === 'cond@qd-condition,desc@qd-proposal,sel@qd-grade,profile@qd-profile,thickness@qd-thickness,gutter@qd-gutter', JSON.stringify(where.desk));
// …and on a wide office screen they are lifted into a rail down the LEFT of
// the preview, each one level with the thing it edits and pointing at it.
const rail = await pg.evaluate(async () => {
  _qeRailSync(); await new Promise(r => setTimeout(r, 100));
  const wrap = document.getElementById('quoteProposal').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#qeRail .qe-rail-btn')].map(b => {
    const r = b.getBoundingClientRect();
    const a = document.querySelector('#qpRoot .qe-inline[data-qe-btn="' + b.dataset.qeRail + '"]').getBoundingClientRect();
    const hand = [...document.querySelectorAll('#qeRail .qe-rail-line')].find(l => Math.abs(parseFloat(l.style.top) - parseFloat(b.style.top)) < 2);
    const h = hand ? hand.getBoundingClientRect() : null;
    return { what: b.dataset.qeRail, x: r.left - wrap.left, level: Math.abs(r.top - a.top) < 3, leftOf: r.right < a.left,
             close: a.left - r.right < 80, hand: !!h && h.left >= r.right - 2 && h.right <= a.left + 2 && /\u{1F449}/u.test(hand.textContent) };
  });
  const lines = [...document.querySelectorAll('#qeRail .qe-rail-line')].map(l => /\u{1F449}/u.test(l.textContent));
  return { on: document.documentElement.classList.contains('qe-rail-on'), gutter: parseFloat(getComputedStyle(document.getElementById('quoteProposal')).paddingLeft), btns, lines,
           inlineHidden: getComputedStyle(document.querySelector('#qpRoot .qe-inline')).visibility === 'hidden' };
});
check('a wide office screen shows the rail: six buttons in the left gutter, each level with its block, close beside it, a pointing hand between',
  rail.on && rail.gutter >= 150 && rail.btns.length === 6 && rail.btns.every(b => b.level && b.leftOf && b.close && b.hand) && rail.lines.length === 6 && rail.lines.every(Boolean) && rail.inlineHidden,
  JSON.stringify(rail));
check('the book carries the same three on its proposal, grade and gutter pages', where.book.proposal === 'desc' && where.book.grade === 'sel' && where.book.gutter === 'gutter', JSON.stringify(where.book));
check('the classic document carries them beside its scope, its selections page and its guttering panel', where.a4.includes('desc') && where.a4.includes('sel') && where.a4.includes('gutter'), where.a4.join(','));
check('Edit gutter selections opens the selections window filtered to gutters, brackets and downpipes',
  where.gutterTitle === 'Edit gutter selections' && where.gutterGroups.join('|') === 'Guttering|Gutter brackets|Downpipes', JSON.stringify([where.gutterTitle, where.gutterGroups]));

// The Existing roof condition card is back on the Quote tab with a tick that
// puts the section in the quote or takes it out — on the phone and the
// computer as well as the document.
const cond = await pg.evaluate(async () => {
  const card = document.getElementById('qCondCard'); const cb = document.getElementById('qCondInclude');
  const out = { card: !!card && getComputedStyle(card).display !== 'none', tickedAtStart: cb.checked, inDocAtStart: _qpInDoc('condition') };
  document.getElementById('qdCondSummary').value = 'Around 35 years old and rusting through.'; onQuoteEdit(); await new Promise(r => setTimeout(r, 500));
  out.saved = S.quote.conditionSummary;
  out.onPage = (document.getElementById('qpRoot').textContent || '').includes('rusting through');
  cb.checked = false; _qCondIncludeToggle(cb); await new Promise(r => setTimeout(r, 500));
  out.off = { inDoc: _qpInDoc('condition'), desk: !!document.getElementById('qd-condition'), sectionsCard: !!document.querySelector('#qProposalSections [data-section="condition"].on'), text: (document.getElementById('qpRoot').textContent || '').includes('rusting through') };
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 600));
  out.offBook = _qbPages().map(p => p.key).includes('condition');
  cb.checked = true; _qCondIncludeToggle(cb); await new Promise(r => setTimeout(r, 500));
  out.on = { inDoc: _qpInDoc('condition'), book: _qbPages().map(p => p.key).includes('condition') };
  _qbGo(_qbPages().map(p => p.key).indexOf('condition')); await new Promise(r => setTimeout(r, 200));
  out.condBtn = [...document.querySelectorAll('#qbPage .qe-inline')].map(b => b.dataset.qeBtn).join(',');
  _qeEdit('cond'); await new Promise(r => setTimeout(r, 700));
  out.cardOpened = card.open;
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 600));
  return out;
});
check('the Existing roof condition card is on the Quote tab, ticked, and its summary reaches the customer’s page', cond.card && cond.tickedAtStart && cond.inDocAtStart && cond.saved === 'Around 35 years old and rusting through.' && cond.onPage, JSON.stringify(cond));
check('unticking it takes the section out of the document, the one-page layout and the book (and the Proposal sections card agrees)',
  !cond.off.inDoc && !cond.off.desk && !cond.off.sectionsCard && !cond.off.text && !cond.offBook, JSON.stringify(cond.off));
check('ticking it puts the section back, with Edit roof condition on it, which opens the card', cond.on.inDoc && cond.on.book && cond.condBtn === 'cond' && cond.cardOpened, JSON.stringify([cond.on, cond.condBtn, cond.cardOpened]));

// the arrow's landing on each layout
const spots = await pg.evaluate(async () => {
  const out = {};
  _qeSpot('desc'); out.desk = (document.querySelector('#qpRoot .qe-spot') || {}).className || '';
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 600));
  _qeSpot('desc'); await new Promise(r => setTimeout(r, 200));
  out.bookPage = document.getElementById('qbPage').dataset.qbPage; out.book = (document.querySelector('#qpRoot .qe-spot') || {}).className || '';
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
check('the selections window lists every group, and NOTHING is locked — the base grade, the standard profile and the standard choices can all come off (2026-09-23)',
  sel.rows >= 12 && sel.groups.length >= 7 && !sel.baseLocked && !sel.corrLocked && !sel.stdThickLocked, JSON.stringify({ rows: sel.rows, groups: sel.groups }));
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
check('the grade picked on this quote can be unticked too, and is labelled as the pick', !noPick.locked && /picked/.test(noPick.why), JSON.stringify(noPick));
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

// THE ROOF PLAN ON THE OFFICE'S PREVIEW carries the three-way control per
// roof — part of the main price, a separate optional extra, excluded — the
// A4 always had; the modern layouts render it too, never for the customer.
const modes = await pg.evaluate(async () => {
  gotoTab('roof'); _addAndSwitchToNewRoof(); setTool('outline');
  DRAW.currentPts = [[600,140],[900,140],[900,400],[600,400]]; finishCurrent(); autoGenerateRoof('hip');
  await new Promise(r => setTimeout(r, 400));
  gotoTab('quote'); await new Promise(r => setTimeout(r, 1500));
  const plan = () => document.querySelector('#qd-proposal .qp-roofmap');
  const seg = () => [...plan().querySelectorAll('button')].filter(b => /^(Part of main|Separate|Exclude)$/.test(b.textContent.trim())).map(b => b.textContent.trim());
  const incl = () => [...plan().querySelectorAll('.qp-incl-btns button')].map(b => b.textContent.trim());
  const out = { seg: seg(), inclSeparate: incl() };
  _setRoofMode(1, 'folded'); await new Promise(r => setTimeout(r, 900));
  out.inclFolded = incl(); out.foldedMode = _roofQuoteMode(1);
  _setRoofMode(1, 'excluded'); await new Promise(r => setTimeout(r, 900));
  out.excluded = _roofQuoteMode(1); out.inclExcluded = incl(); out.legendExcl = /Not included/.test(plan().textContent) && !/tap to add/.test(plan().textContent);
  _setRoofMode(1, 'separate'); await new Promise(r => setTimeout(r, 900));
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 700));
  const keys = _qbPages().map(p => p.key); _qbGo(keys.indexOf('proposal')); await new Promise(r => setTimeout(r, 300));
  out.bookSeg = [...document.querySelectorAll('#qbPage .qp-roofmap button')].filter(b => /^(Part of main|Separate|Exclude)$/.test(b.textContent.trim())).length;
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 700));
  return out;
});
check('the one-page preview’s roof plan offers Part of main / Separate extra / Exclude for the second roof', modes.seg.join(',') === 'Part of main,Separate,Exclude', JSON.stringify(modes.seg));
check('a separate roof has its Include button; folded into the main price it has none; excluded it has none and reads Not included',
  modes.inclSeparate.some(t => /Include Roof 2/.test(t)) && modes.foldedMode === 'folded' && !modes.inclFolded.some(t => /Roof 2/.test(t)) && modes.excluded === 'excluded' && !modes.inclExcluded.some(t => /Roof 2/.test(t)) && modes.legendExcl,
  JSON.stringify(modes));
check('the phone preview’s roof plan carries the same control', modes.bookSeg === 3, String(modes.bookSeg));

// EACH MAP FRAME KEEPS ITS OWN VIEW: zooming the proposal's plan leaves
// the review's plan (and the A4's) where they were.
const views = await pg.evaluate(async () => {
  _qpRoofMapZoom(0.5, 'desk'); await new Promise(r => setTimeout(r, 100));
  const t = k => ((document.querySelector('.qp-map-frame[data-map-key="' + k + '"] .qp-map-inner') || {}).style || {}).transform || '';
  const out = { desk: t('desk'), desksum: t('desksum'), saved: (S.quote.roofMapViews || {}).desk, main: S.quote.roofMapView };
  // The phone's plan has never been moved, so it follows the computer's…
  out.bookFollows = _qpRoofMapView('book').zoom;
  // …until it is moved itself; then each keeps its own.
  _qpRoofMapViewSet({ zoom: 2 }, 'book');
  out.bookOwn = _qpRoofMapView('book').zoom; out.deskAfter = _qpRoofMapView('desk').zoom;
  delete S.quote.roofMapViews.book;
  _qpRoofMapZoom(-0.5, 'desk'); await new Promise(r => setTimeout(r, 100));
  return out;
});
check('zooming the proposal’s plan does not move the review’s plan', /scale\(1\.5\)/.test(views.desk) && /scale\(1\)/.test(views.desksum) && views.saved && views.saved.zoom === 1.5 && (!views.main || views.main.zoom === 1), JSON.stringify(views));
check('the phone’s plan follows the computer’s until it is moved itself, and then each keeps its own', views.bookFollows === 1.5 && views.bookOwn === 2 && views.deskAfter === 1.5, JSON.stringify(views));

// DELETE THIS PAGE / INSERT … PAGE (2026-09-22): the grade, profile and
// thickness sections carry the delete link; a deleted section leaves an
// Insert button where it was, on the computer preview and under the book.
const park = await pg.evaluate(async () => {
  const out = {};
  out.delBtns = [...document.querySelectorAll('#qpRoot .qb-sec-del')].map(b => b.closest('.qd-sec').getAttribute('data-qd-sec'));
  _qbSectionRemove('profile'); await new Promise(r => setTimeout(r, 500));
  out.parked = (S.quote.modernParked || []).slice();
  out.profileGone = !document.querySelector('#qd-profile');
  const ph = document.querySelector('#qpRoot .qd-parked[data-qd-parked="profile"]');
  out.placeholder = ph ? ph.textContent.trim() : null;
  out.afterGrade = ph && ph.previousElementSibling && ph.previousElementSibling.getAttribute('data-qd-sec');
  out.beforeThickness = ph && ph.nextElementSibling && ph.nextElementSibling.getAttribute('data-qd-sec');
  // the customer never sees a placeholder
  window.__CUSTOMER_MODE = true; out.custParked = _qbParkedForOffice().length; window.__CUSTOMER_MODE = false;
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 700));
  out.bookStrip = [...document.querySelectorAll('#qpRoot .qb-parked .qe-insert')].map(b => b.textContent.trim());
  out.bookHasProfile = _qbPages().some(p => p.key === 'profile');
  _setQuotePreviewMode('computer'); await new Promise(r => setTimeout(r, 700));
  _qbSectionInsert('profile'); await new Promise(r => setTimeout(r, 500));
  out.back = !!document.querySelector('#qd-profile') && !document.querySelector('#qpRoot .qd-parked');
  return out;
});
check('the grade, profile, thickness, guttering and old roof sections each carry Delete this page from this quote', park.delBtns.join(',') === 'grade,profile,thickness,gutter,disposal', JSON.stringify(park.delBtns));
check('deleting the profile section leaves an Insert Profile page button between the grade and the thickness', park.parked.join(',') === 'profile' && park.profileGone && /Insert Profile page/.test(park.placeholder || '') && park.afterGrade === 'grade' && park.beforeThickness === 'thickness', JSON.stringify(park));
check('…the customer never sees a placeholder, and the phone preview lists it under the book', park.custParked === 0 && park.bookStrip.join('|') === '+ Insert Profile page' && !park.bookHasProfile, JSON.stringify({ c: park.custParked, strip: park.bookStrip }));
check('…and Insert puts it back', park.back);

// GRADE AND GAUGE DELTAS ARE WORKED ON THE RAW MATERIAL COST — before the
// quantity buffer and the mark-up (2026-09-22).
const raw = await pg.evaluate(() => {
  S.quote.materialBase = 11550; S.quote.materialRaw = 10000;
  const g = _selGauge55Delta(), z = _selGradeDelta('zincalume');
  const q0 = S.quote; delete q0.materialRaw; q0.roofMatQtyBuffer = 5; q0.roofMaterialMarkup = 10;
  const derived = _selMaterialBaseRaw();
  return { g, z, pct: _selGradePctOf('zincalume'), derived };
});
check('the 0.55 upgrade is 22% of the raw material, not of the marked-up figure', Math.abs(raw.g - 2200) < 0.01, String(raw.g));
check('…and a grade swap likewise', Math.abs(raw.z - raw.pct * 10000) < 0.01, raw.z + ' vs ' + raw.pct * 10000);
check('…a quote stamped before the raw figure existed divides the buffer and the mark-up back out', Math.abs(raw.derived - 10000) < 0.5, String(raw.derived));

// THE QUOTE TAB'S TOP (2026-09-22): no Job type card; the scope lives in
// More (always shown now); the template picker is a solid light-blue button.
const top = await pg.evaluate(() => {
  const sb = document.querySelector('#tab-quote .q-scopebar');
  const more = document.getElementById('qaMore');
  const list = (document.getElementById('qaMoreList') || {}).textContent || '';
  const tpl = document.querySelector('#qaTplMenu > summary');
  return { scopeHidden: !sb || getComputedStyle(sb).display === 'none', moreShown: !!more && getComputedStyle(more).display !== 'none',
           scopeInMore: /Job scope/.test(list) && /Re-Roof/.test(list), tplBg: tpl ? getComputedStyle(tpl).backgroundColor : '', tplFg: tpl ? getComputedStyle(tpl).color : '' };
});
check('the Job type card is gone from the top of the Quote tab and the job scope is in More', top.scopeHidden && top.moreShown && top.scopeInMore, JSON.stringify(top));
check('the template picker is a solid light-blue button with white text', top.tplBg === 'rgb(0, 153, 204)' && top.tplFg === 'rgb(255, 255, 255)', top.tplBg + ' / ' + top.tplFg);

// SETTINGS: dark-blue group headers and a nav that stays put while scrolling;
// a Save button that shows a spinner, then a tick and the time.
const setv = await pg.evaluate(async () => {
  gotoTab('settings'); await new Promise(r => setTimeout(r, 400));
  const nav = document.querySelector('#tab-settings .set-nav'), grp = document.querySelector('#tab-settings .set-grp');
  const on = document.querySelector('#tab-settings .set-nav .tab-sm.on');
  const out = { onBg: on ? getComputedStyle(on).backgroundColor : '', sticky: nav ? getComputedStyle(nav).position : '', grpBg: grp ? getComputedStyle(grp).backgroundColor : '', grpFg: grp ? getComputedStyle(grp).color : '' };
  const real = window.saveSettings; window.saveSettings = async function(){ await new Promise(r => setTimeout(r, 150)); return true; };
  const btn = document.getElementById('saveSettingsBtn');
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  out.during = btn.innerHTML; out.ring = !!btn.querySelector('.sv-ring'); out.disabled = btn.disabled;
  await new Promise(r => setTimeout(r, 1100));
  out.after = btn.textContent; out.ok = btn.classList.contains('sv-ok');
  window.saveSettings = real;
  await new Promise(r => setTimeout(r, 4200));
  out.restored = /Save now/.test(btn.textContent);
  gotoTab('quote');
  return out;
});
check('the selected Settings tab is the app’s light blue (#0099cc), like Change job', setv.onBg === 'rgb(0, 153, 204)', setv.onBg);
check('the Settings menu stays put while scrolling, with dark-blue group headers', setv.sticky === 'sticky' && setv.grpBg === 'rgb(10, 22, 40)' && setv.grpFg === 'rgb(255, 255, 255)', JSON.stringify(setv));
check('Save now shows a spinner for at least a second, then a green tick with the time, then goes back to itself', setv.ring && /Saving/.test(setv.during) && setv.disabled && setv.ok && /Saved \d/.test(setv.after) && setv.restored, JSON.stringify({ during: setv.during, after: setv.after, restored: setv.restored }));

// ONE WRITE TO THE JOB AT A TIME: saves and the quote publish never overlap
// on the row, and a burst of saves collapses to the one running and one
// waiting.
const writes = await pg.evaluate(async () => {
  const realApi = window.api, hadId = S.currentJobId;
  if (!S.currentJobId) S.currentJobId = 'job-serial';
  const cl = document.getElementById('jobClient'); const hadCl = cl ? cl.value : ''; if (cl && !cl.value) cl.value = 'Serial Test';
  let inFlight = 0, maxInFlight = 0, calls = 0;
  window.api = async function(m, path){ const w = (m === 'PUT' && /^\/jobs\//.test(path)); if (w){ calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); } await new Promise(r => setTimeout(r, 120)); if (w) inFlight--; return { id: S.currentJobId, updated_at: new Date().toISOString(), ok: true }; };
  try {
    delete window._lastSent;
    const p1 = saveCurrentJob(); const p2 = _publishQuoteOnly(); const p3 = saveCurrentJob(); const p4 = saveCurrentJob();
    await Promise.all([p1, p2, p3, p4]);
  } finally { window.api = realApi; if (!hadId) S.currentJobId = null; if (cl) cl.value = hadCl; }
  return { maxInFlight, calls };
});
check('a save, a publish and two more saves go to the row one at a time, the last two as one', writes.maxInFlight === 1 && writes.calls <= 3, JSON.stringify(writes));

// A HUNG REQUEST NEVER BLOCKS THE QUEUE OR A JOB OPEN (2026-09-22): a job
// write gives up after the request timeout, the queue moves on, and the
// save before a switch waits a bounded time before drafting locally.
let hang = true;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/jobs/hung-job', async r => { if (hang) await new Promise(res => setTimeout(res, 15000)); r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ id:'hung-job', updated_at: new Date().toISOString() }) }); });
const hung = await pg.evaluate(async () => {
  window.__API_TIMEOUT_MS = 700; window.__SAVE_SWITCH_WAIT_MS = 400;
  const hadId = S.currentJobId; S.currentJobId = 'hung-job';
  const cl = document.getElementById('jobClient'); const hadCl = cl ? cl.value : ''; if (cl && !cl.value) cl.value = 'Hung Test';
  delete window._lastSent;
  const t0 = Date.now();
  let err = null;
  try { await api('PUT', '/jobs/hung-job', { client_name:'x' }); } catch(e){ err = e; }
  const apiMs = Date.now() - t0;
  const t1 = Date.now();
  await _saveBeforeSwitch();
  const switchMs = Date.now() - t1;
  window.__API_TIMEOUT_MS = 0; window.__SAVE_SWITCH_WAIT_MS = 0;
  S.currentJobId = hadId; if (cl) cl.value = hadCl;
  return { timeout: !!(err && err.timeout), msg: err && err.message, apiMs, switchMs };
});
hang = false;
check('a job write that never answers fails after the timeout with a message that says the work is kept', hung.timeout && /kept on this device/.test(hung.msg || '') && hung.apiMs < 3000, JSON.stringify(hung));
check('…and the save before a job open waits a bounded time, not for ever', hung.switchMs < 3000, hung.switchMs + 'ms');

// THE PRICING DRAWER sits over the quote — it no longer reserves its width
// and shoves the Quote tab left.
const drawer = await pg.evaluate(async () => {
  const before = getComputedStyle(document.documentElement).getPropertyValue('--pop-reserve').trim();
  _openPricingPanel(); await new Promise(r => setTimeout(r, 500));
  const open = document.getElementById('quotePricingPanel').classList.contains('is-open');
  const during = getComputedStyle(document.documentElement).getPropertyValue('--pop-reserve').trim();
  _closePricingPanel(); await new Promise(r => setTimeout(r, 400));
  return { before, during, open };
});
check('opening the Pricing drawer leaves the quote where it is (no width reserved)', drawer.open && parseFloat(drawer.during) < 100 && drawer.during === drawer.before, JSON.stringify(drawer));

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
    grades: [...document.querySelectorAll('[data-qb-opt="steelGrade"]')].map(x => x.dataset.qbVal), text: document.getElementById('qpRoot').textContent,
    editBtns: document.querySelectorAll('.qe-inline').length }));
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
check('the customer never sees an edit button, on any layout', [kc, kp, mc, mp].every(x => x.editBtns === 0), [kc, kp, mc, mp].map(x => x.editBtns).join(','));
check('nothing threw on the customer’s screens', [kc, kp, mc, mp].every(x => x.errs.length === 0));

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
