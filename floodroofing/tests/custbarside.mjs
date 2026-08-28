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

const geom = (pg) => pg.evaluate(() => {
  const bar = document.getElementById('custBar');
  const page = document.querySelector('#customerView .report-preview');
  const br = bar.getBoundingClientRect(), pr = page.getBoundingClientRect();
  const btns = [...bar.querySelectorAll('button')].map(x => x.getBoundingClientRect());
  return { vw: window.innerWidth, vh: window.innerHeight,
    bar: { left: br.left, right: br.right, top: br.top, bottom: br.bottom, w: br.width, h: br.height },
    pageRight: pr.right,
    stacked: btns.length > 1 && btns.every((r, i) => i === 0 || r.top >= btns[i-1].bottom - 1),
    mode: !!window.__CUSTOMER_MODE };
});

// ── computer: the bar is a side panel, clear of the page ──────────
const d = await openCustomer({ width: 1500, height: 950 });
let g = await geom(d.pg);
check('customer link opened on a computer', g.mode, '');
check('the pricing bar sits at the SIDE, not across the bottom',
  g.bar.w < 420 && g.bar.right > g.vw - 60 && g.bar.bottom < g.vh - 40,
  `bar ${Math.round(g.bar.w)}×${Math.round(g.bar.h)} at right=${Math.round(g.bar.right)} of ${g.vw}`);
check('…the quote page does not run underneath it',
  g.pageRight <= g.bar.left + 1, `page right ${Math.round(g.pageRight)} vs panel left ${Math.round(g.bar.left)}`);
check('…its buttons stack vertically', g.stacked, '');
// The tap-for-breakdown sheet opens BESIDE the panel, not across the screen.
const brk = await d.pg.evaluate(() => {
  _custBarToggleBreakdown();
  const br = document.getElementById('custBarBreak').getBoundingClientRect();
  const bar = document.getElementById('custBar').getBoundingClientRect();
  return { w: br.width, right: br.right, barLeft: bar.left, shown: br.height > 40 };
});
check('the price breakdown opens beside the panel, not full-width',
  brk.shown && brk.w < 480 && brk.right <= brk.barLeft + 8,
  `break ${Math.round(brk.w)}px wide, right=${Math.round(brk.right)} vs panel left=${Math.round(brk.barLeft)}`);
check('nothing threw on the computer view', d.errs.length === 0, d.errs.join(' | ') || 'clean');
await d.ctx.close();

// ── phone: exactly the bar it always had ──────────────────────────
const m = await openCustomer({ width: 390, height: 844 });
g = await geom(m.pg);
check('on a phone the bar still spans the bottom of the screen',
  g.bar.w > g.vw - 8 && g.bar.bottom > g.vh - 4 && g.bar.left < 4,
  `bar ${Math.round(g.bar.w)}px wide, bottom=${Math.round(g.bar.bottom)} of ${g.vh}`);
check('…and its buttons sit in a row, not a stack', !g.stacked, '');
await m.ctx.close();

// ── tablet (≤1100): also unchanged ────────────────────────────────
const t = await openCustomer({ width: 1024, height: 768 });
g = await geom(t.pg);
check('a tablet keeps the bottom bar too',
  g.bar.w > g.vw - 8 && g.bar.bottom > g.vh - 4,
  `bar ${Math.round(g.bar.w)}px wide at ${g.vw}px viewport`);
await t.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
