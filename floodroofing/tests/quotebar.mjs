// "the header buttons 'email quote' ect disappear when scrolling down the
//  page, i want them always visible above the 'Proposal — click any text to
//  edit' header"
//
// The proposal is a stack of A4 pages — thousands of pixels of scrolling — and
// the Quote tab's action bar (Save, Email Quote, Push to Fergus, Print,
// Customer link) sat at the top of it in the normal flow. The Proposal card's
// own header was already sticky, so scrolling took the buttons away and left
// the thing they sit above pinned in their place.
//
// Both stick now, stacked in the order they are read. The offset between them
// is measured rather than guessed, because the button row wraps to two and
// three lines as the window narrows — a hard-coded top is right at exactly one
// window width.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r0 = v => Math.round(v);

const b = await chromium.launch();

async function openQuoteTab(width, height){
  const ctx = await b.newContext({ viewport: { width, height } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2600);
  await pg.evaluate((g) => {
    DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
    DRAW.outline = g.outline; DRAW.outlineDone = true;
    DRAW.lines = g.lines.map(l => Object.assign({}, l));
    DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
      { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
    DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
    S.quote = S.quote || {}; S.quote.gstRate = 15;
    try { redrawAll(); } catch(e){}
    gotoTab('quote');
    try { refreshQuoteProposal(); } catch(e){}
  }, GEOM);
  await pg.waitForTimeout(2200);
  return { ctx, pg, errs };
}

// Geometry of the two bars, after scrolling well down the proposal.
const probe = () => {
  const bar = document.querySelector('#tab-quote .q-actionbar');
  const hd  = document.querySelector('#tab-quote .js-proposal-print > .card-hd');
  const btn = [...document.querySelectorAll('#tab-quote .q-actionbar button')]
                .find(x => /Email Quote/i.test(x.textContent || ''));
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
  return {
    scrolled: window.scrollY || document.documentElement.scrollTop,
    bar: box(bar), hd: box(hd), btn: box(btn),
    barPos: bar ? getComputedStyle(bar).position : null,
    // In site mode a fixed #phoneTopBar owns the top of the screen; a bar
    // pinned to 0 hides underneath it.
    phoneBar: (function(){ const e = document.getElementById('phoneTopBar');
      if (!e || getComputedStyle(e).display === 'none') return null;
      const r = e.getBoundingClientRect(); return { bottom: r.bottom }; })(),
    // And on the desktop the office banner owns the top of the screen the
    // same way — fixed, and painted over anything that stops at zero.
    globalBar: (function(){ const e = document.getElementById('globalTopBar');
      if (!e || getComputedStyle(e).display === 'none') return null;
      const r = e.getBoundingClientRect(); return { bottom: r.bottom }; })(),
    // What is actually painted where the button is. Geometry alone cannot
    // tell "on screen" from "on screen but behind the banner".
    btnHit: (function(){
      if (!btn) return 'none';
      const r = btn.getBoundingClientRect();
      const m = document.elementFromPoint(Math.round(r.left + r.width / 2),
                                          Math.round(r.top + r.height / 2));
      if (!m) return 'none';
      return (m === btn || btn.contains(m) || m.contains(btn)) ? 'self'
           : (m.id || m.className || m.tagName).toString().slice(0, 40);
    })(),
    hdPos:  hd  ? getComputedStyle(hd).position  : null,
    vh: window.innerHeight,
  };
};

// ── desktop ────────────────────────────────────────────────────────
let { ctx, pg, errs } = await openQuoteTab(1440, 1000);
let before = await pg.evaluate(probe);
check('the quote tab has an action bar and a proposal header to stack',
  !!before.bar && !!before.hd && !!before.btn, JSON.stringify({
    bar: !!before.bar, hd: !!before.hd, btn: !!before.btn }));

await pg.evaluate(() => window.scrollTo(0, 2000));
await pg.waitForTimeout(500);
let v = await pg.evaluate(probe);
check('scrolling 2000px actually moved the page', v.scrolled > 1500, v.scrolled + 'px');
check('the Email Quote button is still on screen after scrolling',
  v.btn && v.btn.top >= -1 && v.btn.bottom <= v.vh,
  v.btn ? ('top ' + r0(v.btn.top) + ', bottom ' + r0(v.btn.bottom) + ', viewport ' + v.vh) : 'gone');
check('…pinned to the top, not just happening to be in view',
  v.bar && v.bar.top >= -1 && v.barPos === 'sticky' &&
  v.bar.top < (v.globalBar ? v.globalBar.bottom + 6 : 6),
  v.bar ? (v.barPos + ' at top ' + r0(v.bar.top)) : 'no bar');
// The bar used to pin at zero, which is where the office banner already sits
// — fixed, and with a higher z-index. It was never scrolled away; it was
// underneath, and the buttons went with it. "the head bars … frozen to the
// screen when i scroll down the page so i can always see them."
check('THE REPORT: it clears the office banner instead of parking under it',
  !v.globalBar || v.bar.top >= v.globalBar.bottom - 1,
  v.globalBar ? ('banner ends ' + r0(v.globalBar.bottom) + ', bar starts ' + r0(v.bar.top)) : 'no banner');
check('…so Email Quote is the thing painted at Email Quote, not the banner',
  v.btnHit === 'self', String(v.btnHit));
check('the Proposal header sits BELOW it, which is where it was asked for',
  v.hd && v.bar && v.hd.top >= v.bar.bottom - 1,
  v.hd && v.bar ? ('bar ends ' + r0(v.bar.bottom) + ', header starts ' + r0(v.hd.top)) : 'n/a');
check('…and the two do not overlap',
  v.hd && v.bar && v.bar.bottom <= v.hd.top + 1,
  v.hd && v.bar ? ('overlap ' + r0(Math.max(0, v.bar.bottom - v.hd.top)) + 'px') : 'n/a');
check('the Proposal header is still pinned itself', v.hdPos === 'sticky', String(v.hdPos));

// ── the bar's total must follow a Pricing-panel edit (FR-14015) ────
// A scaffold or labour change refreshed the proposal preview and the
// customer bar but never rewrote the action bar's "Total incl. GST" — the
// office read $5,226.66 against a page saying $8,642.16. Same debounced
// tick, same engine, both numbers.
let t = await pg.evaluate(async () => {
  S.quote.lineItems = [{ desc: 'Main scope', qty: 1, unit: 10000 }];
  if (typeof recalcQuoteTotals === 'function') recalcQuoteTotals();
  const before = (document.getElementById('qaTotal') || {}).textContent || '';
  // The path a Pricing-panel edit takes: state changes, then the debounced
  // reflect — no direct line-item edit, so nothing else rewrites the bar.
  S.quote.lineItems = [{ desc: 'Main scope', qty: 1, unit: 16000 }];
  _reflectPricingInQuote();
  await new Promise(r => setTimeout(r, 500));
  return { before,
           after: (document.getElementById('qaTotal') || {}).textContent || '',
           want: fmtMoney(_quoteMoney().tot) };
});
check('a pricing change reaches the action bar total on the same tick as the preview',
  t.after === t.want && t.after !== t.before,
  'bar ' + t.before + ' → ' + t.after + ', engine says ' + t.want);
check('nothing threw on the desktop pass', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();

// ── narrow, where the button row wraps and a guessed offset breaks ──
({ ctx, pg, errs } = await openQuoteTab(430, 900));
await pg.evaluate(() => window.scrollTo(0, 1600));
await pg.waitForTimeout(500);
v = await pg.evaluate(probe);
check('on a narrow screen the bar has wrapped to more than one row',
  v.bar && v.bar.height > 60, v.bar ? r0(v.bar.height) + 'px tall' : 'no bar');
check('…the buttons are still on screen',
  v.btn && v.btn.top >= -1 && v.btn.bottom <= v.vh,
  v.btn ? ('top ' + r0(v.btn.top) + ', bottom ' + r0(v.btn.bottom)) : 'gone');
check('…and the wrapped bar still does not cover the Proposal header',
  v.hd && v.bar && v.bar.bottom <= v.hd.top + 1,
  v.hd && v.bar ? ('bar ends ' + r0(v.bar.bottom) + ', header starts ' + r0(v.hd.top)) : 'n/a');
check('…and clears the fixed phone top bar rather than hiding under it',
  !v.phoneBar || v.bar.top >= v.phoneBar.bottom - 1,
  v.phoneBar ? ('phone bar ends ' + r0(v.phoneBar.bottom) + ', action bar starts ' + r0(v.bar.top)) : 'not in site mode');
check('nothing threw on the narrow pass', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();

// ── print: a pinned bar on every page would be absurd ──────────────
const css = readFileSync(_j(DIR, 'app.html'), 'utf8');
const printBlock = css.slice(css.indexOf('.q-actionbar'), css.indexOf('.q-actionbar') + 4000);
check('print puts both bars back in the flow',
  /@media\s+print[^}]*\{[^}]*q-actionbar[^}]*position:\s*static/.test(css.replace(/\s+/g, ' ')),
  'print rule present');

// ── Ctrl + scroll zooms the proposal ──────────────────────────────
({ ctx, pg, errs } = await openQuoteTab(1500, 1000));
const z = await pg.evaluate(() => {
  const el = document.getElementById('quoteProposal');
  const before = _docZoomFactor();
  el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
  const after = _docZoomFactor();
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  return { before, after, plain: _docZoomFactor(),
    slider: +document.getElementById('qpZoomSlider').value };
});
check('Ctrl + scroll over the proposal zooms it and syncs the slider',
  z.after > z.before && Math.round(z.after * 100) === z.slider, JSON.stringify(z));
check('…while a plain scroll keeps scrolling, not zooming', z.plain === z.after, JSON.stringify(z));
// Zooming PAST 70% must stick — the old-default migration used to eat any
// value near 0.70 and snap the zoom back to 60%.
const z2 = await pg.evaluate(() => {
  const el = document.getElementById('quoteProposal');
  for (let i = 0; i < 4; i++)
    el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
  return _docZoomFactor();
});
check('Ctrl + scroll climbs straight past 70% without snapping back',
  Math.abs(z2 - 0.85) < 0.001, (z2 * 100) + '%');
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
