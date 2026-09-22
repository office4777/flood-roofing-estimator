// "The computer version should be overhauled to feel like the same product,
//  but use the extra screen space … a summary panel on the right: selected
//  options, live total including GST, and a 'Review quote' button that stays
//  visible. Clickable section navigation … related choices could sit
//  each their own full-width section — steel grade, profile and thickness
//  laid out like the guttering (the owner found three narrow columns confusing).
//  Keep the selections, wording and prices consistent across both."
//
// And, from the same message, the customer's DESCRIPTION of the work: six
// plain lines on the Re-Roof Proposal, the chosen steel grade filled in, with
// an office-only "Edit description" window to reword, reorder, remove and
// add lines.
//
// The customer link on a computer (or a tablet) is now one scrolling page
// built from the SAME renderers as the phone book — same option cards, same
// wording, same helpers for every figure — with a sticky summary rail and a
// section nav. Pinned here: the sections and their order; the rail's total
// and choices moving with a pick; that a pick does not throw the page back
// to the top; that grade, profile and thickness share one section; that
// Accept is inline (no popup) and ends on "Quote accepted"; that a print is
// the A4 document; the six description lines and their editor; and that the
// phone and the computer show the same description and the same total.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#5d6970"/></svg>');
const quote = () => ({
  ref:'FR-30130', client:'Sharon Whittaker', addr:'14 Kamo Road, Whangarei',
  date:'19/09/2026', validUntil:'30 days', gstRate:15, coverTitle:'Whittaker Residence',
  condMaterial:'Corrugate Colorsteel', condAge:'34 years', condRemainingPct:8,
  condPhotos:[{ src:PHOTO, caption:'North face' }, { src:PHOTO, caption:'The valley' }],
  baseGrade:'maxam', materialBase:9200, gutterLm:48, gutterLines:4, scaffoldBase:4200,
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                    colour:'', gutterType:'none', gutterBracket:'internal', downpipes:'no', disposal:'dispose' },
  extraRoofs:[{ name:'Garage', price:6400 }],
  roofMapGeom:{ bbox:{minX:0,minY:0,maxX:200,maxY:140}, rot:0, roofs:[
    { idx:0, name:'Main Roof', area:168, mode:'main', extraPos:null, gutterLm:48,
      pts:[[10,10],[130,10],[130,110],[10,110]], lines:[], gutters:[] },
    { idx:1, name:'Garage', area:42, mode:'separate', extraPos:0, gutterLm:16,
      pts:[[140,40],[196,40],[196,110],[140,110]], lines:[], gutters:[] }]},
  lineItems:[{ desc:'Strip and re-roof', qty:1, unit:31200 }], total:31200
});

const b = await chromium.launch();
async function open(viewport, patch){
  const ctx = await b.newContext(Object.assign({ viewport }, viewport.width <= 720 ? { isMobile:true, hasTouch:true } : {}));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const posted = [];
  pg.on('dialog', d => d.accept());
  const q = Object.assign(quote(), patch || {});
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)){ try { posted.push(JSON.parse(r.request().postData() || '{}')); } catch(e){}
      return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }); }
    if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234', email:'office@floodroofing.co.nz', prepared_by_name:'Aron Flood' } }) });
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  await pg.goto('file://' + DIR + '/app.html?q=tok&j=' + q.ref);
  await pg.waitForTimeout(3200);
  return { ctx, pg, errs, posted };
}

// ── a computer gets the one-page layout ──────────────────────────
const d = await open({ width:1366, height:850 });
const v = await d.pg.evaluate(() => ({
  desk: document.documentElement.classList.contains('qp-desk'),
  book: document.documentElement.classList.contains('qp-book'),
  root: !!document.getElementById('qdRoot'),
  a4: document.querySelectorAll('#qpRoot .rp-page').length,
  secs: [...document.querySelectorAll('[data-qd-sec]')].map(s => s.dataset.qdSec),
  nav: [...document.querySelectorAll('#qdNav button')].map(x => x.textContent.trim()),
  rail: !!document.querySelector('.qd-rail-in'),
  total: (document.getElementById('qdTotal') || {}).textContent || '',
  review: !!document.querySelector('.qd-rail-btn'),
  barHidden: getComputedStyle(document.getElementById('custBar')).display === 'none',
  scrolls: getComputedStyle(document.body).overflow !== 'hidden',
  name: !!document.getElementById('qbAcceptName'), terms: !!document.getElementById('qbAcceptTerms'),
  hero: !!document.querySelector('#qd-cover .qb-hero'),
  photos: document.querySelectorAll('#qd-condition .qd-photo').length,
  swatches: document.querySelectorAll('#qd-colour .qb-sw').length,
  gradeCards: document.querySelectorAll('#qd-grade [data-qb-opt="steelGrade"]').length,
  profileCards: document.querySelectorAll('#qd-profile [data-qb-opt="profile"]').length,
  gaugeCards: document.querySelectorAll('#qd-thickness [data-qb-opt="steelThickness"]').length,
  rec: document.querySelectorAll('#qd-grade .qb-rec, #qd-profile .qb-rec, #qd-thickness .qb-rec').length,
  noGrid3: !document.querySelector('#qdRoot .qd-grid3'),
  rowsWide: (function(){ const a = document.querySelector('#qd-grade [data-qb-opt="steelGrade"]').getBoundingClientRect().width, b = document.querySelector('#qd-gutter [data-qb-opt="gutterType"]').getBoundingClientRect().width; return Math.abs(a - b) < 4; })(),
  plan: !!document.querySelector('#qd-proposal .qp-roofmap svg'),
  planBtns: document.querySelectorAll('#qd-proposal .qp-incl-btns button').length,
  reviewPlan: !!document.querySelector('#qd-review .qb-sum-plan .qp-roofmap svg'),
  reviewBtns: document.querySelectorAll('#qd-review .qp-incl-btns button').length
}));
check('the customer link on a computer opens as one page, not the book and not A4',
  v.desk && !v.book && v.root && v.a4 === 0, JSON.stringify({ desk:v.desk, book:v.book, a4:v.a4 }));
check('…the sections run cover, proposal, roof, steel grade, profile, thickness, colour, guttering, old roof, review',
  v.secs.join(',') === 'cover,proposal,condition,grade,profile,thickness,colour,gutter,disposal,review', v.secs.join(','));
check('…with a nav button for each', v.nav.length === v.secs.length && v.nav.includes('Steel grade') && v.nav.includes('Review'), v.nav.join(' | '));
check('…a summary rail with the live total incl. GST and a Review button', v.rail && /\$/.test(v.total) && v.review, v.total);
check('…the old bottom/side bar is out of the way and the page scrolls', v.barHidden && v.scrolls);
check('…the name and the terms tick are on the page, like the phone', v.name && v.terms);
check('…the same hero, a photo grid, and every swatch', v.hero && v.photos === 2 && v.swatches >= 6, JSON.stringify({ photos:v.photos, sw:v.swatches }));
check('steel grade, profile and thickness are each a full-width section of their own, rows like the guttering',
  v.gradeCards >= 3 && v.profileCards >= 2 && v.gaugeCards === 2 && v.noGrid3 && v.rowsWide, JSON.stringify({ g:v.gradeCards, p:v.profileCards, t:v.gaugeCards, grid:v.noGrid3, wide:v.rowsWide }));
check('…each with a "Recommended for your roof" pick', v.rec >= 3, v.rec + ' badges');
check('the proposal carries the roof plan with the include/exclude buttons', v.plan && v.planBtns >= 2, v.planBtns + ' buttons');
check('…and the review shows the roofs read-only', v.reviewPlan && v.reviewBtns === 0, v.reviewBtns + ' buttons');

// ── the six description lines ────────────────────────────────────
const lines = await d.pg.evaluate(() => [...document.querySelectorAll('#qd-proposal .qb-incl-row')].map(e => e.textContent.trim()));
const dcover = await d.pg.evaluate(() => { const el = document.getElementById('qd-cover'); const rows = {}; el.querySelectorAll('.qb-meta > div').forEach(x => { rows[x.querySelector('dt').textContent] = x.querySelector('dd').textContent; }); return { rows, stats: el.querySelectorAll('.qb-stat').length, lead: /Prepared for/.test(el.textContent) }; });
check('the computer cover carries the same facts: Expires and Prepared by, no area, pitch or "Prepared for"', dcover.rows.Expires === '19/10/2026' && dcover.rows['Prepared by'] === 'Aron Flood' && dcover.stats === 0 && !dcover.lead, JSON.stringify(dcover));
check('the proposal reads the six plain lines, the chosen grade filled in',
  lines.length === 6 && lines[0] === 'Edge-Protection / Scaffolding' && lines[1] === 'Remove existing Roofing' &&
  lines[2] === 'Install New Synthetic Underlay' && lines[3] === 'Install New Colorsteel® MAXAM Roofing Sheets' &&
  lines[4] === 'Install all associated Flashings' && lines[5] === 'Tidy site and issue Warranty sign-off', lines.join(' / '));

// ── a pick moves the rail and the page stays where it was ────────
const pick = await d.pg.evaluate(async () => {
  _qdGoTo('grade', true);
  await new Promise(r => setTimeout(r, 300));
  const sc = document.getElementById('customerView');
  const y0 = sc.scrollTop;
  const t0 = document.getElementById('qdTotal').textContent;
  document.querySelector('#qd-grade [data-qb-opt="steelGrade"][data-qb-val="colorzen"]').click();
  await new Promise(r => setTimeout(r, 700));
  return { y0, y1: sc.scrollTop, t0, t1: document.getElementById('qdTotal').textContent,
           line: [...document.querySelectorAll('#qd-proposal .qb-incl-row')][3].textContent.trim(),
           pick: /Armorsteel ColorZen/.test((document.querySelector('.qd-rail-picks') || {}).textContent || ''),
           on: (document.querySelector('#qdNav button.on') || {}).textContent,
           saved: S.quote.proposalOptions.steelGrade };
});
check('choosing another grade moves the rail total', pick.t0 !== pick.t1 && /\$/.test(pick.t1), pick.t0 + ' → ' + pick.t1);
check('…and the rail lists the new choice', pick.pick && pick.saved === 'colorzen');
check('…and the description line follows the grade', pick.line === 'Install New Armorsteel ColorZen Roofing Sheets', pick.line);
check('…without throwing the page back to the top', pick.y0 > 100 && Math.abs(pick.y1 - pick.y0) < 40, pick.y0 + ' → ' + pick.y1);
check('…and the nav still says Steel grade', pick.on === 'Steel grade', pick.on);

// brackets & downpipes appear beside the gutter once a gutter is chosen
const kit = await d.pg.evaluate(async () => {
  const before = document.querySelectorAll('#qd-gutter [data-qb-opt="gutterBracket"]').length;
  const g = document.querySelector('#qd-gutter [data-qb-opt="gutterType"]:not([data-qb-val="none"])');
  if (g) g.click();
  await new Promise(r => setTimeout(r, 700));
  return { before, after: document.querySelectorAll('#qd-gutter [data-qb-opt="gutterBracket"]').length,
           sideBySide: !!document.querySelector('#qd-gutter .qd-grid2') };
});
check('brackets and downpipes appear beside the gutter once one is chosen', kit.before === 0 && kit.after === 2 && kit.sideBySide, JSON.stringify(kit));

// the nav jumps
const jump = await d.pg.evaluate(async () => {
  document.querySelector('#qdNav [data-qd-nav="review"]').click();
  await new Promise(r => setTimeout(r, 900));
  const top = document.getElementById('qd-review').getBoundingClientRect().top;
  return { top, on: (document.querySelector('#qdNav button.on') || {}).textContent };
});
check('the nav jumps straight to a section', jump.top < 120 && jump.on === 'Review', JSON.stringify(jump));

// ── a print is the A4 document ───────────────────────────────────
const pr = await d.pg.evaluate(async () => {
  window.__PRINTING_QUOTE = true;
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 500));
  const during = { desk: document.documentElement.classList.contains('qp-desk'),
                   a4: document.querySelectorAll('#qpRoot .rp-page').length, qd: !!document.getElementById('qdRoot') };
  window.__PRINTING_QUOTE = false;
  _fitCustomerView();
  await new Promise(r => setTimeout(r, 500));
  return { during, after: { desk: document.documentElement.classList.contains('qp-desk'), qd: !!document.getElementById('qdRoot') } };
});
check('a print swaps the page out for the A4 document', !pr.during.desk && !pr.during.qd && pr.during.a4 > 0, JSON.stringify(pr.during));
check('…and the page is back when it is done', pr.after.desk && pr.after.qd, JSON.stringify(pr.after));

// ── the acceptance PDF renders the A4 behind a veil, never on screen ─
const veil = await d.pg.evaluate(async () => {
  const p = _buildQuotePdf({ scale: 1, veilMsg: 'Recording your acceptance…' });
  // Read at once: with the PDF library blocked in this test the build gives
  // up within a few ms and the veil lifts with it.
  const v = document.getElementById('qpPdfVeil');
  const during = { veil: !!v, msg: v ? v.textContent : '', a4: document.querySelectorAll('#qpRoot .rp-page').length,
                   covers: !!v && v.getBoundingClientRect().width >= window.innerWidth - 1 };
  await p;
  await new Promise(r => setTimeout(r, 400));
  return { during, after: { veil: !!document.getElementById('qpPdfVeil'), desk: document.documentElement.classList.contains('qp-desk'), qd: !!document.getElementById('qdRoot') } };
});
check('while the acceptance PDF renders the A4, a veil covers the screen and says why',
  veil.during.veil && veil.during.covers && /Recording your acceptance/.test(veil.during.msg) && veil.during.a4 > 0, JSON.stringify(veil.during));
check('…and it lifts to the same page afterwards', !veil.after.veil && veil.after.desk && veil.after.qd, JSON.stringify(veil.after));

// ── accept: inline, no popup, ends on "Quote accepted" ───────────
const acc = await d.pg.evaluate(async () => {
  _qdGoTo('review', true);
  await new Promise(r => setTimeout(r, 300));
  acceptQuoteDigitally();
  await new Promise(r => setTimeout(r, 300));
  const bare = { modal: !!document.getElementById('acceptConfirmModal'), accepted: !!S.quote.accepted };
  document.getElementById('qbAcceptTerms').checked = true;
  document.getElementById('qbAcceptName').value = 'Sharon Whittaker';
  acceptQuoteDigitally();
  await new Promise(r => setTimeout(r, 2500));
  return { bare, modal: !!document.getElementById('acceptConfirmModal'), accepted: !!S.quote.accepted,
           h: (document.querySelector('#qd-review .qb-done-h') || {}).textContent || '',
           rail: (document.querySelector('.qd-rail-done b') || {}).textContent || '',
           frozen: document.querySelectorAll('.qd .qb-opt:disabled').length > 5,
           desk: document.documentElement.classList.contains('qp-desk'), qd: !!document.getElementById('qdRoot') };
});
check('Accept without the tick does nothing, and opens no popup', !acc.bare.modal && !acc.bare.accepted);
check('…with the tick it accepts straight from the page, no popup', acc.accepted && !acc.modal);
check('…the acceptance was recorded with the name', d.posted.some(p => p.type === 'accepted' && p.name === 'Sharon Whittaker'));
check('…the review reads "Quote accepted", the rail too, and the picks are frozen',
  acc.h === 'Quote accepted' && acc.rail === 'Quote accepted' && acc.frozen, JSON.stringify(acc));
check('…and the page is still the computer layout afterwards (the PDF pass did not leave the A4 behind)', acc.desk && acc.qd);
check('nothing on the computer threw', d.errs.length === 0, d.errs.join(' | ') || 'clean');
await d.ctx.close();

// ── the same quote on a phone reads the same lines and the same total ─
const m = await open({ width:390, height:844 }, { custDesc:['Scaffold the house', 'Strip the old roof', 'Fit new {grade} sheets'] });
const ph = await m.pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  _qbGo(keys.indexOf('proposal'));
  await new Promise(r => setTimeout(r, 400));
  return { book: document.documentElement.classList.contains('qp-book'),
           lines: [...document.querySelectorAll('#qbPage .qb-incl-row')].map(e => e.textContent.trim()),
           total: _qbTotal() };
});
await m.ctx.close();
const d2 = await open({ width:1366, height:850 }, { custDesc:['Scaffold the house', 'Strip the old roof', 'Fit new {grade} sheets'] });
const dk = await d2.pg.evaluate(() => ({ lines: [...document.querySelectorAll('#qd-proposal .qb-incl-row')].map(e => e.textContent.trim()), total: _qbTotal() }));
await d2.ctx.close();
check('an office-edited description reaches the customer, grade filled in',
  ph.book && ph.lines.join('|') === 'Scaffold the house|Strip the old roof|Fit new Colorsteel® MAXAM sheets', ph.lines.join(' / '));
check('…and the phone and the computer read the same lines and the same total',
  ph.lines.join('|') === dk.lines.join('|') && ph.total === dk.total && ph.total > 0, ph.total + ' vs ' + dk.total);

// EXCLUSIONS (2026-09-22): listed by the office, they get their own heading
// and a red cross; the inclusions gain a heading only then.
const ex = await open({ width:1366, height:850 }, { custDesc:['Scaffold the house'], custExcl:['Gutter replacement', 'Painting of {grade} flashings'] });
const xd = await ex.pg.evaluate(() => ({
  heads: [...document.querySelectorAll('#qd-proposal .qb-incl-hd')].map(e => e.textContent.trim()),
  incl: [...document.querySelectorAll('#qd-proposal .qb-incl:not(.qb-excl) .qb-incl-row')].map(e => e.textContent.trim()),
  excl: [...document.querySelectorAll('#qd-proposal .qb-excl .qb-excl-row')].map(e => e.textContent.trim()),
  cross: [...document.querySelectorAll('#qd-proposal .qb-excl-row svg')].every(sv => getComputedStyle(sv).color === 'rgb(192, 57, 43)'),
}));
await ex.ctx.close();
check('exclusions show under their own heading, crossed in red, and the inclusions get a heading too',
  xd.heads.join('|') === 'What’s included|What’s excluded' && xd.incl.join('|') === 'Scaffold the house' && xd.excl.join('|') === 'Gutter replacement|Painting of Colorsteel® MAXAM flashings' && xd.cross,
  JSON.stringify(xd));
check('…and a quote with none carries no headings at all', dk.lines.length === 3 && !(await (async () => { const o = await open({ width:1366, height:850 }, { custDesc:['Scaffold the house'] }); const h = await o.pg.evaluate(() => document.querySelectorAll('#qd-proposal .qb-incl-hd').length); await o.ctx.close(); return h; })()));

// ── the recommended choice is the roofer's own pick ──────────────
// "whatever selection is chosen in the app before the user sends it …
//  becomes the recommended choice in the customer quote"
const r1 = await open({ width:1366, height:850 }, {
  recommended:{ steelGrade:'maxam', profile:'corrugate', steelThickness:'55', gutterType:'box125', gutterBracket:'external', downpipes:'yes', disposal:'keep' },
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'55', colour:'', gutterType:'box125', gutterBracket:'external', downpipes:'yes', disposal:'keep' } });
const rec = await r1.pg.evaluate(() => {
  const badge = (grp, val) => { const el = document.querySelector('[data-qb-opt="' + grp + '"][data-qb-val="' + val + '"]'); return el ? { rec: !!el.querySelector('.qb-rec'), tag: (el.querySelector('.qb-opt-price') || {}).textContent || '' } : null; };
  return { g125: badge('gutterType', 'box125'), gNone: badge('gutterType', 'none'), t55: badge('steelThickness', '55'), t40: badge('steelThickness', '40'),
           brExt: badge('gutterBracket', 'external'), dpYes: badge('downpipes', 'yes'), keep: badge('disposal', 'keep'), noPriceBox: !document.querySelector('#qd-proposal .qb-price-open') };
});
await r1.ctx.close();
check('the gutter the roofer picked is the recommended one, not "no new guttering"', rec.g125 && rec.g125.rec && rec.gNone && !rec.gNone.rec, JSON.stringify({ g125:rec.g125, none:rec.gNone }));
check('…and it still shows what it adds — Recommended is a badge, not a price', rec.g125 && /\$/.test(rec.g125.tag) && !/Included/.test(rec.g125.tag), rec.g125 && rec.g125.tag);
check('…thickness, brackets, downpipes and disposal follow the pick too',
  rec.t55.rec && !rec.t40.rec && rec.brExt.rec && rec.dpYes.rec && rec.keep.rec, JSON.stringify({ t55:rec.t55, br:rec.brExt, dp:rec.dpYes, keep:rec.keep }));
check('the proposal no longer carries a price box at the top (the bar has it)', rec.noPriceBox);
// A quote sent before the stamp existed recommends what it was priced on.
const r0 = await open({ width:390, height:844 }, { proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40', gutterType:'box125', disposal:'dispose' } });
const old = await r0.pg.evaluate(async () => {
  _qbGo(_qbPages().map(p => p.key).indexOf('gutter')); await new Promise(r => setTimeout(r, 400));
  const el = (v) => document.querySelector('#qbPage [data-qb-opt="gutterType"][data-qb-val="' + v + '"]');
  return { none: !!el('none').querySelector('.qb-rec'), g125: !!el('box125').querySelector('.qb-rec'), picked: el('box125').classList.contains('on') };
});
await r0.ctx.close();
check('a quote sent before the stamp still recommends the base, with the pick kept', old.none && !old.g125 && old.picked, JSON.stringify(old));

// ── the office: Edit description ─────────────────────────────────
const o = await (async () => {
  const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', x => x.accept());
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
    if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
    finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
  await pg.waitForTimeout(2400);
  return { ctx, pg, errs };
})();
const ed = await o.pg.evaluate(async () => {
  const btn = [...document.querySelectorAll('#tab-quote button')].find(x => /Edit description/.test(x.textContent));
  const out = { btn: !!btn, office: !btn || btn.classList.contains('no-print') };
  _qdescOpen();
  await new Promise(r => setTimeout(r, 200));
  const rows = () => [...document.querySelectorAll('#qdescList input')].map(i => i.value);
  out.opened = rows();
  _qdescSet(0, 'Full edge protection and scaffold');   // reword
  _qdescMove(5, -1);                                   // move the last line up
  _qdescDel(2);                                        // drop the underlay line
  _qdescAdd(); _qdescSet(5, 'Cart away the old roof');  // add a custom line
  out.edited = document.getElementById('qdescModal')._lines.slice();
  _qdescSave();
  await new Promise(r => setTimeout(r, 500));
  out.saved = (S.quote.custDesc || []).slice();
  out.shown = _qbInclusionLines();
  out.modalGone = !document.getElementById('qdescModal');
  // reset to the default: the field comes OFF the quote
  _qdescOpen(); await new Promise(r => setTimeout(r, 200));
  _qdescReset(); _qdescSave();
  await new Promise(r => setTimeout(r, 400));
  out.afterReset = 'custDesc' in S.quote;
  out.defaultShown = _qbInclusionLines();
  // exclusions from the same editor
  _qdescOpen(); await new Promise(r => setTimeout(r, 200));
  _qdescAdd('x'); _qdescSet(0, 'Downpipes', 'x');
  _qdescAdd('x'); _qdescSet(1, '', 'x');   // a blank one is dropped
  out.exclRows = document.querySelectorAll('#qdescExclList .qdesc-row').length;
  _qdescSave(); await new Promise(r => setTimeout(r, 400));
  out.exclSaved = (S.quote.custExcl || []).slice();
  out.exclShown = _qbExclusionLines();
  out.exclOnPage = document.querySelectorAll('#qpRoot .qb-excl-row').length;
  _qdescOpen(); await new Promise(r => setTimeout(r, 200));
  _qdescDel(0, 'x'); _qdescSave(); await new Promise(r => setTimeout(r, 300));
  out.exclGone = !('custExcl' in S.quote);
  return out;
});
check('the editor takes exclusions too: a blank one is dropped, the rest land on the quote and the page, and removing the last takes the field off',
  ed.exclRows === 2 && ed.exclSaved.join('|') === 'Downpipes' && ed.exclShown.join('|') === 'Downpipes' && ed.exclOnPage >= 1 && ed.exclGone, JSON.stringify({ rows: ed.exclRows, saved: ed.exclSaved, onPage: ed.exclOnPage, gone: ed.exclGone }));
check('the Quote tab has an office-only Edit description button', ed.btn && ed.office);
check('…which opens on the six default lines, {grade} unfilled', ed.opened.length === 6 && ed.opened[3] === 'Install New {grade} Roofing Sheets', ed.opened.join(' / '));
check('…reword, move, delete and add all work', ed.edited.join('|') === 'Full edge protection and scaffold|Remove existing Roofing|Install New {grade} Roofing Sheets|Tidy site and issue Warranty sign-off|Install all associated Flashings|Cart away the old roof', ed.edited.join(' / '));
check('…Save keeps them on the quote and the proposal reads them', ed.modalGone && ed.saved.length === 6 && ed.shown[0] === 'Full edge protection and scaffold' && ed.shown[5] === 'Cart away the old roof' && /Colorsteel/.test(ed.shown[2]), ed.shown.join(' / '));
check('…and Reset to default takes the field off the quote', !ed.afterReset && ed.defaultShown.length === 6 && ed.defaultShown[0] === 'Edge-Protection / Scaffolding');
// In the office the live pick IS the recommendation, so the Phone / Computer
// previews show what would be sent, and a send stamps it on the quote.
const orec = await o.pg.evaluate(async () => {
  try { _setProposalOption_gutter('box125'); } catch(e){}
  _setQuotePreviewMode('computer');
  await new Promise(r => setTimeout(r, 700));
  const el = document.querySelector('#qpRoot [data-qb-opt="gutterType"][data-qb-val="box125"]');
  const none = document.querySelector('#qpRoot [data-qb-opt="gutterType"][data-qb-val="none"]');
  const out = { rec: !!(el && el.querySelector('.qb-rec')), noneRec: !!(none && none.querySelector('.qb-rec')), snap: _qbRecSnapshot() };
  _setQuotePreviewMode('doc');
  return out;
});
check('in the office, picking a gutter makes it the recommended choice in the preview', orec.rec && !orec.noneRec, JSON.stringify({ rec:orec.rec, noneRec:orec.noneRec }));
check('…and the stamp a send writes carries that pick', orec.snap.gutterType === 'box125', JSON.stringify(orec.snap));
// Settings → Branding carries the name the cover reads.
const prep = await o.pg.evaluate(async () => {
  const inp = document.getElementById('brPreparedBy'); if (!inp) return { field:false };
  inp.value = 'Aron Flood'; collectSettingsFromUI();
  _setQuotePreviewMode('phone'); await new Promise(r => setTimeout(r, 700));
  const dd = [...document.querySelectorAll('#qpRoot .qb-meta > div')].find(x => x.querySelector('dt').textContent === 'Prepared by');
  _setQuotePreviewMode('doc');
  return { field:true, saved: S.settings.branding.prepared_by_name, shown: dd ? dd.querySelector('dd').textContent : '' };
});
check('Settings → Branding has a Prepared by field, and the cover reads it', prep.field && prep.saved === 'Aron Flood' && prep.shown === 'Aron Flood', JSON.stringify(prep));
check('nothing threw in the office', o.errs.length === 0, o.errs.join(' | ') || 'clean');
await o.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
