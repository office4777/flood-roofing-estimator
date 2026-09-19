// "Place quote pricing footer from the bottom of the customer quote (the one
//  frozen to the bottom of the screen that doesn't move when scrolling down
//  the page) to the side of the quote on computer. Don't change the phone
//  version."
//
// On a computer the fixed bottom bar covered the tail of every page and left
// a metre of dead width either side of the A4 sheet. It is now a fixed panel
// on the RIGHT of the quote (≥1100px): price on top, buttons stacked under
// it, the tap-for-breakdown sheet opening beside it — and the A4 pages
// rescale to sit clear of it, because _fitCustomerView measures the container
// the panel's gutter is carved out of. At phone and tablet widths nothing
// changes at all.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const sent = () => ({
  ref:'FR-30012', client:'Mrs Tui', accepted:false,
  extraRoofs:[], proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate' },
  baseGrade:'maxam',
  roofMapGeom:{ bbox:{minX:0,minY:0,maxX:100,maxY:80}, roofs:[
    { name:'Main Roof', area:100, mode:'main', idx:0, lines:[], gutters:[], pts:[[0,0],[100,0],[100,80],[0,80]] },
  ]},
  options:[{id:'a',selected:true}],
  lineItems:[{desc:'Roof replacement', qty:1, price:24000}], total:24000,
});

async function openCustomer(viewport){
  const ctx = await b.newContext({ viewport });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    if (/\/q\//.test(u)) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ quote: sent(), branding:{} })});
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.goto('file://'+DIR+'/app.html?q=tok&j=FR-30012');
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs };
}

// Since the one-page computer layout (tests/quotedesk.mjs) the side panel
// is the summary RAIL: the same rows as the phone's price sheet, the total
// incl. GST, the choices and the Review button, sticky on the right.
const geom = (pg) => pg.evaluate(() => {
  const bar = document.querySelector('.qd-rail-in');
  const page = document.querySelector('.qd-main');
  const old = document.getElementById('custBar');
  if (!bar || !page) return { vw: window.innerWidth, vh: window.innerHeight, bar:{ w:0, h:0, left:0, right:0, top:0, bottom:0 }, pageRight:0, mode: !!window.__CUSTOMER_MODE };
  const br = bar.getBoundingClientRect(), pr = page.getBoundingClientRect();
  const btns = [...bar.querySelectorAll('button')].map(x => x.getBoundingClientRect());
  return { vw: window.innerWidth, vh: window.innerHeight,
    bar: { left: br.left, right: br.right, top: br.top, bottom: br.bottom, w: br.width, h: br.height },
    pageRight: pr.right,
    stacked: btns.length > 1 && btns[0].top < btns[1].top,
    oldHidden: !old || getComputedStyle(old).display === 'none',
    rows: bar.querySelectorAll('.qd-rail-row').length, total: (document.getElementById('qdTotal') || {}).textContent || '',
    mode: !!window.__CUSTOMER_MODE };
});

// ── computer: the summary rail is a side panel, clear of the page ──
const d = await openCustomer({ width: 1500, height: 950 });
let g = await geom(d.pg);
check('customer link opened on a computer', g.mode, '');
check('the pricing panel sits at the SIDE, not across the bottom',
  g.bar.w < 420 && g.bar.right > g.vw - 160 && g.bar.bottom < g.vh - 40,
  `panel ${Math.round(g.bar.w)}×${Math.round(g.bar.h)} at right=${Math.round(g.bar.right)} of ${g.vw}`);
check('…the quote page does not run underneath it',
  g.pageRight <= g.bar.left + 1, `page right ${Math.round(g.pageRight)} vs panel left ${Math.round(g.bar.left)}`);
check('…its buttons stack vertically, and the old bottom bar is gone', g.stacked && g.oldHidden, '');
check('the price breakdown is in the panel itself, with the total incl. GST',
  g.rows >= 1 && /\$/.test(g.total), `${g.rows} rows, ${g.total}`);
check('nothing threw on the computer view', d.errs.length === 0, d.errs.join(' | ') || 'clean');
// The deposit terms the customer reads: payable within 7 days of acceptance,
// locking their spot in the queue — the old "~7 days before start" scheme is
// gone from every page. Those pages are the A4 document (the print / PDF).
const dep = await d.pg.evaluate(() => {
  window.__PRINTING_QUOTE = true; refreshQuoteProposal();
  const t = (document.getElementById('customerView') || document.body).innerText || '';
  window.__PRINTING_QUOTE = false; refreshQuoteProposal();
  return { newTerms: /within 7 days of acceptance/i.test(t),
           oldTerms: /~7 days before/i.test(t),
           // The fuller sentence lives in defaults that render per-quote
           // (pole shed intro) — assert it at the source it renders from,
           // so a reworded default can't drift back.
           intro: /payable within 7 days of acceptance — once paid, your spot in the queue is locked in/.test(
             (typeof POLESHED_DEFAULTS !== 'undefined' && POLESHED_DEFAULTS.psIntro) || '') };
});
check('the payment schedule the customer reads says within 7 days of acceptance',
  dep.newTerms, JSON.stringify({ newTerms: dep.newTerms }));
check('…and the old "~7 days before start" wording is gone', !dep.oldTerms, '');
check('…and the intro default carries the full sentence, queue and all', dep.intro, '');
await d.ctx.close();

// ── phone: the book's own bar spans the bottom ────────────────────
// A phone gets the quote as a book now (tests/quotebook.mjs), so the price
// and the way forward are pinned to the bottom by the BOOK's bar and the old
// #custBar steps aside. The rule this suite exists for is unchanged: on a
// phone the price is across the bottom, never a side panel.
const m = await openCustomer({ width: 390, height: 844 });
const mb = await m.pg.evaluate(() => {
  const nav = document.querySelector('.qb-nav');
  const old = document.getElementById('custBar');
  if (!nav) return null;
  const r = nav.getBoundingClientRect();
  return { book: document.documentElement.classList.contains('qp-book'),
           w: r.width, left: r.left, bottom: r.bottom,
           vw: window.innerWidth, vh: window.innerHeight,
           oldHidden: !old || getComputedStyle(old).display === 'none',
           arrows: nav.querySelectorAll('.qb-arrow').length };
});
check('on a phone the bar still spans the bottom of the screen',
  !!mb && mb.w > mb.vw - 8 && mb.bottom > mb.vh - 4 && mb.left < 4,
  mb ? `bar ${Math.round(mb.w)}px wide, bottom=${Math.round(mb.bottom)} of ${mb.vh}` : 'no book bar');
check('…it is the book\u2019s bar, with the old one out of the way',
  !!mb && mb.book && mb.oldHidden && mb.arrows === 2, JSON.stringify(mb));
await m.ctx.close();

// ── a narrow tablet: the rail drops below and the total rides a bottom bar ──
const t = await openCustomer({ width: 800, height: 1100 });
const tb = await t.pg.evaluate(() => {
  const mini = document.querySelector('.qd-mini'); if (!mini) return null;
  const r = mini.getBoundingClientRect();
  return { w: r.width, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight,
           shown: getComputedStyle(mini).display !== 'none', total: /\$/.test(mini.textContent || ''),
           review: !!mini.querySelector('button') };
});
check('a narrow tablet keeps the total across the bottom of the screen',
  !!tb && tb.shown && tb.w > tb.vw - 8 && tb.bottom > tb.vh - 4 && tb.total && tb.review,
  tb ? `bar ${Math.round(tb.w)}px wide at ${tb.vw}px viewport` : 'no bar');
await t.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
