// "Let's fully revamp the phone's customer quote — book style pages with
//  next/previous arrows, one decision a page."
//
// On a phone the customer link is now a BOOK: one page on screen, arrows to
// turn it, a page per decision. The A4 proposal is untouched — a computer, a
// tablet, the office and every print still get the paper document, and the
// book is rendered from the same helpers as the paper, so the two cannot
// disagree about a figure.
//
// Pinned here: the page order; that the price appears on the Re-Roof
// Proposal page and not before it; that the brackets-and-downpipes page only
// exists once a gutter is chosen (and the colour page only when the steel is
// painted); that the photos are a swipeable gallery in the bottom half of the
// condition page; that a tap on an option moves the total; and that a wide
// screen still gets A4.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#5d6970"/></svg>');
const quote = () => ({
  ref:'FR-30124', client:'Sharon Whittaker', addr:'14 Kamo Road, Whangarei',
  date:'18 Sept 2026', validUntil:'30 days', gstRate:15, coverTitle:'Whittaker Residence',
  condMaterial:'Corrugate Colorsteel', condAge:'34 years', condRoofType:'Hip roof', condPitch:'22°',
  condExpectedLife:'30–35 years', condRemainingPct:8,
  conditionSummary:'The lead-head nails have lifted right across the north face.',
  condPhotos:[{ src:PHOTO, caption:'North face' }, { src:PHOTO, caption:'The valley' }, { src:PHOTO, caption:'Underlay' }],
  baseGrade:'maxam', materialBase:9200, gutterLm:48, gutterLines:4, scaffoldBase:4200,
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                    colour:'', gutterType:'none', gutterBracket:'internal', downpipes:'no', disposal:'dispose' },
  extraRoofs:[{ name:'Garage', price:6400 }],
  roofMapGeom:{ bbox:{minX:0,minY:0,maxX:200,maxY:140}, rot:0, roofs:[
    { idx:0, name:'Main Roof', area:168, mode:'main', extraPos:null, gutterLm:48,
      pts:[[10,10],[130,10],[130,110],[10,110]], lines:[], gutters:[] },
    { idx:1, name:'Garage', area:42, mode:'separate', extraPos:0, gutterLm:16,
      pts:[[140,40],[196,40],[196,110],[140,110]], lines:[], gutters:[] }]},
  options:[{ id:'a', selected:true, title:'Main scope of work',
             inclusionsText:'Set up and remove appropriate scaffolding\nStrip the existing roof and underlay\nSupply and install new Colorsteel roofing',
             lines:[{ desc:'Roof replacement', qty:1, unit:31200 }] }],
  lineItems:[{ desc:'Strip and re-roof', qty:1, unit:31200 }], total:31200
});

const b = await chromium.launch();
async function open(viewport, patch){
  const ctx = await b.newContext(Object.assign({ viewport }, viewport.width <= 720 ? { isMobile:true, hasTouch:true } : {}));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const q = Object.assign(quote(), patch || {});
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
    if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234' } }) });
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  await pg.goto('file://' + DIR + '/app.html?q=tok&j=FR-30124');
  await pg.waitForTimeout(3200);
  return { ctx, pg, errs };
}
const read = (pg) => pg.evaluate(() => ({
  book: document.documentElement.classList.contains('qp-book'),
  keys: (typeof _qbPages === 'function') ? _qbPages().map(p => p.key) : [],
  i: (typeof QB !== 'undefined') ? QB.i : -1,
  page: (document.getElementById('qbPage') || {}).dataset ? document.getElementById('qbPage').dataset.qbPage : '',
  heading: (document.querySelector('#qbPage .qb-h2') || document.querySelector('#qbPage h1') || {}).textContent || '',
  price: (document.getElementById('qbPriceVal') || {}).textContent || '',
  hasPrice: !!document.getElementById('qbPrice'),
  prevOff: !!(document.getElementById('qbPrev') || {}).disabled,
  nextOff: !!(document.getElementById('qbNext') || {}).disabled,
  arrows: !!document.getElementById('qbPrev') && !!document.getElementById('qbNext'),
  barHidden: (function(){ var e = document.getElementById('custBar'); return !e || getComputedStyle(e).display === 'none'; })(),
  a4: document.querySelectorAll('#qpRoot .rp-page').length
}));

// ── the phone gets a book ─────────────────────────────────────────
const m = await open({ width: 390, height: 844 });
let v = await read(m.pg);
check('the customer link on a phone opens as a book', v.book, 'qp-book=' + v.book);
check('…one page on screen, arrows to turn it', v.book && v.arrows, 'page ' + (v.i + 1));
check('…the A4 stack of pages is not what the phone is showing', v.a4 === 0, v.a4 + ' A4 pages');
check('…and the old fixed bottom bar is out of the way', v.barHidden);
check('the first page is the cover, with nowhere to go back to', v.page === 'cover' && v.prevOff, v.page);
check('the pages run cover, roof condition, proposal, then a page per choice, then the total',
  v.keys.join(',') === 'cover,condition,proposal,grade,profile,thickness,colour,gutter,disposal,summary', v.keys.join(','));

// ── the price does not appear before the proposal page ────────────
check('no price on the cover', !v.hasPrice, v.price);
await m.pg.evaluate(() => _qbGo(1));
await m.pg.waitForTimeout(400);
v = await read(m.pg);
check('the condition page is "Existing Roof Condition"', v.page === 'condition' && /Existing Roof Condition/.test(v.heading), v.heading);
check('…and still no price — they have not been shown the proposal yet', !v.hasPrice);
const gal = await m.pg.evaluate(() => {
  const w = document.querySelector('#qbPage .qb-gal-wrap');
  const g = document.getElementById('qbGal');
  const st = document.getElementById('qbStage');
  if (!w || !g || !st) return null;
  const slides = g.querySelectorAll('.qb-slide').length;
  const r = w.getBoundingClientRect(), sr = st.getBoundingClientRect();
  const cs = getComputedStyle(g);
  return { slides, half: r.height / sr.height, bottom: Math.abs(r.bottom - sr.bottom) < 3,
           snaps: /x/.test(cs.scrollSnapType || ''), scrolls: cs.overflowX === 'auto' || cs.overflowX === 'scroll',
           dots: (document.getElementById('qbGalDots') || { children: [] }).children.length };
});
check('the photos are a swipeable gallery', !!gal && gal.slides === 3 && gal.snaps && gal.scrolls, JSON.stringify(gal));
check('…sitting in the bottom half of the page, as asked', !!gal && gal.bottom && gal.half > 0.4 && gal.half < 0.62,
  gal ? Math.round(gal.half * 100) + '% of the page, at the bottom' : '—');
check('…with a dot per photo', !!gal && gal.dots === 3);
const galMove = await m.pg.evaluate(async () => {
  _qbGalGo(2); await new Promise(r => setTimeout(r, 450));
  return { i: QB.g, lbl: (document.getElementById('qbGalN') || {}).textContent };
});
check('…and swiping to the third photo says so', galMove.i === 2 && /3 \/ 3/.test(galMove.lbl || ''), JSON.stringify(galMove));

// ── the proposal page: inclusions on top, the roof plan below ─────
await m.pg.evaluate(() => _qbGo(2));
await m.pg.waitForTimeout(500);
v = await read(m.pg);
check('the third page is the Re-Roof Proposal', v.page === 'proposal' && /Re-Roof Proposal/.test(v.heading), v.heading);
check('…and THIS is where the price starts showing', v.hasPrice && /\$/.test(v.price), v.price);
const split = await m.pg.evaluate(() => {
  const body = document.querySelector('#qbPage > .qb-body');
  const plan = document.querySelector('#qbPage > .qb-plan');
  const st = document.getElementById('qbStage');
  if (!body || !plan || !st) return null;
  const br = body.getBoundingClientRect(), pr = plan.getBoundingClientRect(), sr = st.getBoundingClientRect();
  return { incl: document.querySelectorAll('#qbPage .qb-incl-row').length,
           planTitle: (plan.querySelector('.ed-eyebrow') || {}).textContent || '',
           topFirst: br.top < pr.top, planHalf: pr.height / sr.height,
           roofButtons: plan.querySelectorAll('button').length };
});
check('…the inclusions are the top half and the roof plan the bottom half',
  !!split && split.incl >= 3 && split.topFirst && split.planHalf > 0.4 && split.planHalf < 0.62,
  JSON.stringify(split));
check('…and the roofs can be added or dropped right there', !!split && split.roofButtons >= 2, split ? split.roofButtons + ' buttons' : '—');
const added = await m.pg.evaluate(async () => {
  const before = _custBarTotalValue();
  const bt = [...document.querySelectorAll('#qbPage .qp-incl-btns button')].find(x => /Include/.test(x.textContent));
  if (bt) bt.click();
  await new Promise(r => setTimeout(r, 600));
  return { before, after: _custBarTotalValue(), shown: (document.getElementById('qbPriceVal') || {}).textContent, stayed: QB.i };
});
check('adding the garage moves the total, on the page the customer is on',
  added.after > added.before + 1 && added.stayed === 2, added.before.toFixed(0) + ' → ' + added.after.toFixed(0) + ' (' + added.shown + ')');

// ── a page per choice ─────────────────────────────────────────────
const titles = await m.pg.evaluate(async () => {
  const out = [];
  const keys = _qbPages().map(p => p.key);
  for (let i = 3; i < keys.length; i++){
    _qbGo(i); await new Promise(r => setTimeout(r, 260));
    out.push({ key: keys[i], h: (document.querySelector('#qbPage .qb-h2') || {}).textContent || '',
               opts: document.querySelectorAll('#qbPage [data-qb-opt]').length,
               sw: document.querySelectorAll('#qbPage .qb-sw').length });
  }
  return out;
});
const byKey = {}; titles.forEach(t => byKey[t.key] = t);
check('steel grade has its own page with the grades on it', (byKey.grade || {}).opts >= 2 && /Steel grade/.test((byKey.grade || {}).h || ''), JSON.stringify(byKey.grade));
check('roof profile has its own page, with the profile drawn', /Roof profile/.test((byKey.profile || {}).h || '') &&
  await m.pg.evaluate(async () => { _qbGo(4); await new Promise(r => setTimeout(r, 250)); return !!document.querySelector('#qbPage .qb-fig svg'); }), JSON.stringify(byKey.profile));
check('steel thickness has its own page', /thickness/i.test((byKey.thickness || {}).h || ''), JSON.stringify(byKey.thickness));
check('colour has its own page of swatches', (byKey.colour || {}).sw > 3, JSON.stringify(byKey.colour));
check('guttering has its own page', /Guttering/.test((byKey.gutter || {}).h || ''), JSON.stringify(byKey.gutter));
check('the old roofing — keep it or we take it away — has its own page', /old roofing/i.test((byKey.disposal || {}).h || ''), JSON.stringify(byKey.disposal));
check('the roofs are NOT offered again on the option pages — that was page three',
  !titles.some(t => /roof 2|garage|additional roofs/i.test(t.h)), titles.map(t => t.h).join(' | '));

// ── brackets and downpipes only exist once a gutter is chosen ─────
const gk = await m.pg.evaluate(async () => {
  const keysBefore = _qbPages().map(p => p.key);
  const gi = keysBefore.indexOf('gutter');
  _qbGo(gi); await new Promise(r => setTimeout(r, 300));
  const pick = [...document.querySelectorAll('#qbPage [data-qb-opt="gutterType"]')].find(e => e.dataset.qbVal !== 'none');
  const before = _custBarTotalValue();
  if (pick) pick.click();
  await new Promise(r => setTimeout(r, 700));
  const keysAfter = _qbPages().map(p => p.key);
  const ki = keysAfter.indexOf('gutterkit');
  _qbGo(ki); await new Promise(r => setTimeout(r, 300));
  return { before, after: _custBarTotalValue(), hadKit: keysBefore.indexOf('gutterkit') >= 0,
           hasKit: ki >= 0, h: (document.querySelector('#qbPage .qb-h2') || {}).textContent || '',
           groups: [...document.querySelectorAll('#qbPage [data-qb-opt]')].map(e => e.dataset.qbOpt).filter((x, i, a) => a.indexOf(x) === i) };
});
check('with no gutter chosen there is no brackets page to wade through', !gk.hadKit);
check('choosing a gutter adds the brackets & downpipes page', gk.hasKit && /Brackets/.test(gk.h), gk.h);
check('…carrying both decisions', gk.groups.join(',') === 'gutterBracket,downpipes', gk.groups.join(','));
check('…and the gutter itself is on the price', gk.after > gk.before + 1, gk.before.toFixed(0) + ' → ' + gk.after.toFixed(0));

// ── the last page totals it up and accepts ───────────────────────
const sum = await m.pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  _qbGo(keys.length - 1); await new Promise(r => setTimeout(r, 400));
  const el = document.getElementById('qbPage');
  const txt = el.textContent;
  return { key: el.dataset.qbPage, total: (el.querySelector('.qb-total b') || {}).textContent || '',
           live: fmtMoney(_custBarTotalValue()),
           rows: el.querySelectorAll('.qb-sum-row').length,
           picks: [...el.querySelectorAll('.qb-pick')].map(r => r.textContent),
           accept: !!el.querySelector('.qb-accept'),
           actions: [...el.querySelectorAll('.qb-actions button')].map(x => x.textContent.trim()),
           nextOff: document.getElementById('qbNext').disabled };
});
check('the book ends on the summary', sum.key === 'summary' && sum.nextOff);
check('…showing the same total the bar has carried all along', sum.total === sum.live, sum.total + ' vs ' + sum.live);
check('…itemised', sum.rows >= 3, sum.rows + ' rows');
check('…with every choice they made named back to them',
  sum.picks.length >= 6 && sum.picks.some(t => /Steel grade/.test(t)) && sum.picks.some(t => /Gutter brackets/.test(t)),
  sum.picks.join(' | ').slice(0, 120));
check('…and the accept button, with the other actions beside it',
  sum.accept && sum.actions.length === 3, sum.actions.join(' / '));

// ── an unpainted roof has no colour to choose ────────────────────
const zinc = await m.pg.evaluate(async () => {
  _setProposalOption_grade('zincalume');
  await new Promise(r => setTimeout(r, 700));
  const keys = _qbPages().map(p => p.key);
  _setProposalOption_grade('maxam');
  await new Promise(r => setTimeout(r, 500));
  return { keys, back: _qbPages().map(p => p.key) };
});
check('Zincalume is unpainted, so there is no colour page to answer', zinc.keys.indexOf('colour') < 0, zinc.keys.join(','));
check('…and it comes back when a painted grade is chosen', zinc.back.indexOf('colour') >= 0);

// ── Download PDF hands them the A4 document, then the book comes back ──
// The customer taps Download PDF from the last page. The paper quote is the
// A4 document, so the book has to step aside for the print and step back
// afterwards — not leave them looking at a reflowed A4 stack on a phone.
const pr = await m.pg.evaluate(async () => {
  _qbGo(_qbPages().length - 1); await new Promise(r => setTimeout(r, 400));
  window.__PRINTING_QUOTE = true;
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 500));
  const during = { book: document.documentElement.classList.contains('qp-book'),
                   a4: document.querySelectorAll('#qpRoot .rp-page').length, scrolls: true };
  const duringScrolls = getComputedStyle(document.documentElement).overflow !== 'hidden';
  during.scrolls = duringScrolls;
  window.__PRINTING_QUOTE = false;
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 600));
  return { during, after: { book: document.documentElement.classList.contains('qp-book'),
                            scrolls: getComputedStyle(document.documentElement).overflow !== 'hidden',
                            page: (document.getElementById('qbPage') || {}).dataset ? document.getElementById('qbPage').dataset.qbPage : '' } };
});
check('a print swaps the book out for the A4 document', !pr.during.book && pr.during.a4 > 0, JSON.stringify(pr.during));
check('…so the printed sheet is not laid out as a phone', !pr.during.book);
check('…and the book is back when it is done', pr.after.book && pr.after.page === 'summary', JSON.stringify(pr.after));

check('nothing on the phone threw', m.errs.length === 0, m.errs.join(' | ') || 'clean');
await m.ctx.close();

// ── a computer still gets the A4 proposal ────────────────────────
const dsk = await open({ width: 1400, height: 900 });
const dv = await read(dsk.pg);
check('a computer still gets the A4 proposal, not the book', !dv.book && dv.a4 > 0, dv.a4 + ' A4 pages');
check('…and its bottom/side price bar is still there', !dv.barHidden);
check('nothing on the computer threw', dsk.errs.length === 0, dsk.errs.join(' | ') || 'clean');
await dsk.ctx.close();

// ── QUOTES THAT WERE ALREADY SENT ────────────────────────────────
// The book must not strand a customer holding a link sent before it
// existed. Those quotes carry no roof plan, sometimes no condition report,
// and the oldest ones price their optional roofs as option PACKAGES rather
// than as roofs on a plan. All of them still have to be readable, still
// have to offer whatever the customer was offered, and above all still
// have to accept.
async function openRaw(q){
  const ctx = await b.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const posted = [];
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)){
      try { posted.push(JSON.parse(r.request().postData() || '{}')); } catch(e){ posted.push({ bad:true }); }
      return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
    }
    if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd' } }) });
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  await pg.goto('file://' + DIR + '/app.html?q=tok&j=' + (q.ref || 'x'));
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs, posted };
}
// The oldest shape: option packages, no line items, no roof plan, no
// condition report, no proposalOptions at all.
const legacy = await openRaw({
  ref:'FR-20044', client:'Mr Patel', addr:'9 Vine St', date:'2 Mar 2026', validUntil:'30 days', gstRate:15,
  options:[
    { id:'a', selected:true,  title:'Main scope of work', inclusionsText:'Strip existing roof\nNew underlay\nNew Colorsteel roofing',
      lineItems:[{ desc:'Re-roof', qty:1, unit:18000 }] },
    { id:'b', selected:false, title:'Garage roof', inclusionsText:'Strip and re-roof the garage',
      lineItems:[{ desc:'Garage', qty:1, unit:5000 }] }]
});
const lg = await legacy.pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  const pi = keys.indexOf('proposal');
  _qbGo(pi); await new Promise(r => setTimeout(r, 350));
  const row = document.querySelector('#qbPage [data-qb-roof]');
  const before = _custBarTotalValue();
  if (row) row.click();
  await new Promise(r => setTimeout(r, 700));
  return { keys, base: before, row: !!row, label: row ? row.textContent.replace(/\s+/g,' ').trim() : '',
           after: _custBarTotalValue() };
});
check('a quote sent before the book still opens as a book', lg.keys.length > 5, lg.keys.join(','));
check('…with no condition report on it, there is no condition page to read',
  lg.keys.indexOf('condition') < 0, lg.keys.join(','));
check('…its base price is right', Math.round(lg.base) === 20700, lg.base.toFixed(0));
check('…the optional roof it was sent with is still offered', lg.row && /Garage roof/.test(lg.label), lg.label.slice(0, 70));
check('…and adding it still moves the total', Math.round(lg.after - lg.base) === 5750, lg.base.toFixed(0) + ' → ' + lg.after.toFixed(0));
const lgA = await legacy.pg.evaluate(async () => {
  _qbGo(_qbPages().length - 1); await new Promise(r => setTimeout(r, 350));
  const shown = _custBarTotalValue();
  document.querySelector('.qb-accept').click();
  await new Promise(r => setTimeout(r, 500));
  const m = document.getElementById('acceptConfirmModal');
  const mr = m ? m.getBoundingClientRect() : null;
  const onTop = !!mr && m.contains(document.elementFromPoint(mr.left + mr.width/2, mr.top + 30));
  const nm = document.getElementById('acceptConfirmName'); if (nm && !nm.value) nm.value = 'Mr Patel';
  const tk = document.getElementById('acceptConfirmTerms'); if (tk) tk.checked = true;
  _acceptConfirmProceed();
  await new Promise(r => setTimeout(r, 1400));
  return { shown, onTop, accepted: !!(S.quote && S.quote.accepted),
           locked: document.documentElement.classList.contains('quote-locked'),
           stillBook: document.documentElement.classList.contains('qp-book') };
});
check('…the accept popup opens ON TOP of the book, not behind it', lgA.onTop);
check('…and the acceptance goes through', lgA.accepted && lgA.locked, JSON.stringify(lgA));
const lgP = legacy.posted.filter(x => x && x.type === 'accepted');
check('…recorded with the customer\u2019s name and the total they were looking at',
  lgP.length === 1 && /Patel/.test(lgP[0].name || '') && Math.abs(lgP[0].total - lgA.shown) < 0.5,
  lgP.length ? (lgP[0].name + ' · ' + Math.round(lgP[0].total) + ' vs ' + Math.round(lgA.shown)) : 'nothing posted');
check('…carrying the optional roof they added', lgP.length === 1 &&
  (lgP[0].acceptedOptions || []).some(o => /Garage/.test(o.title || '')),
  lgP.length ? (lgP[0].acceptedOptions || []).map(o => o.title).join(', ') : '');
check('…and the book is still what they are looking at afterwards', lgA.stillBook);
check('nothing threw on the old quote', legacy.errs.length === 0, legacy.errs.join(' | ') || 'clean');
await legacy.ctx.close();

// A quote with almost nothing on it at all.
const bare = await openRaw({ ref:'FR-19001', client:'Ms Lee', gstRate:15,
                             lineItems:[{ desc:'Re-roof', qty:1, unit:12000 }] });
const bv = await bare.pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  _qbGo(keys.indexOf('proposal')); await new Promise(r => setTimeout(r, 350));
  const phantom = !!document.querySelector('#qbPage [data-qb-roof]');
  _qbGo(keys.length - 1); await new Promise(r => setTimeout(r, 350));
  return { keys, phantom, total: _custBarTotalValue(), accept: !!document.querySelector('.qb-accept') };
});
check('a bare quote still reads as a book and can be accepted',
  bv.keys[0] === 'cover' && bv.keys[bv.keys.length-1] === 'summary' && bv.accept, bv.keys.join(','));
check('…at the price it was sent at', Math.round(bv.total) === 13800, bv.total.toFixed(0));
check('…with no optional roofs invented for it', !bv.phantom);
check('nothing threw on the bare quote', bare.errs.length === 0, bare.errs.join(' | ') || 'clean');
await bare.ctx.close();

// One the customer already accepted before the book existed.
const done = await openRaw({ ref:'FR-19002', client:'Ms Lee', gstRate:15,
  lineItems:[{ desc:'Re-roof', qty:1, unit:12000 }],
  accepted:{ at:'2026-03-04T02:00:00Z', name:'Ms Lee', total:13800 },
  proposalOptions:{ steelGrade:'maxam', profile:'corrugate', steelThickness:'40', colour:'Ironsand®', gutterType:'none', disposal:'dispose' } });
const accv = await done.pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  _qbGo(keys.length - 1); await new Promise(r => setTimeout(r, 350));
  const el = document.getElementById('qbPage');
  const note = !!el.querySelector('.qb-accepted'), accept = !!el.querySelector('.qb-accept');
  _qbGo(keys.indexOf('grade')); await new Promise(r => setTimeout(r, 300));
  const opts = [...document.querySelectorAll('#qbPage [data-qb-opt]')];
  return { note: note, accept: accept,
           frozen: opts.length > 0 && opts.every(o => o.disabled) };
});
check('an already-accepted quote says so instead of offering Accept again', accv.note && !accv.accept, JSON.stringify(accv));
check('…and its selections are frozen', accv.frozen);
check('nothing threw on the accepted quote', done.errs.length === 0, done.errs.join(' | ') || 'clean');
await done.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
