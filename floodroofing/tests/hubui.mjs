// THE FINANCE HUB IN ROOFMAP'S LOOK (2026-10-24, the owner: "fully redesign the app, focusing on the phone
// version first ... look like roofmaps colours ... a more expansive computer version (make the computer/phone
// version auto detect which device I'm view the app from) ... bring the forward workflow weeks/hours into the
// first page/command center ... make sure everything stays clickable").
//
// Drives the real hub/FloodRoofing_Financials.html over file:// with the network blocked, seeded from
// tests/_hubseed.mjs. Pins:
//   - a phone gets the bottom bar, a computer the sidebar, and it is decided by the width alone;
//   - light is the default, the moon still gives dark, and that choice stays on the device;
//   - the forward workflow card reads totalRemaining() / capacity() exactly, and opens the same list the tile did;
//   - EVERY tile on the Command Centre (KPIs, cash boxes, dashboard month cards) opens its window, with content;
//   - every tab renders without a page error; the nightly sync's entry point is still there.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { hubSeedScript } from './_hubseed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = pathToFileURL(join(ROOT, 'hub', 'FloodRoofing_Financials.html')).href;
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ('  — ' + d) : '')); }

const b = await chromium.launch();
async function open(vp, extraInit){
  const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 800, isMobile: vp.width < 800 });
  await ctx.route(u => !u.href.startsWith('file:'), r => r.abort());
  await ctx.addInitScript(hubSeedScript());
  if (extraInit) await ctx.addInitScript(extraInit);
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(HUB); await pg.waitForTimeout(900);
  return { ctx, pg, errs };
}
const visible = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

// ── the phone ─────────────────────────────────────────────────────
let { ctx, pg, errs } = await open({ width: 390, height: 844 });
check('the phone boots with no page error', errs.length === 0, JSON.stringify(errs));
check('a phone is not the computer layout', !(await pg.evaluate(() => document.documentElement.classList.contains('is-desktop'))));
const nav = await pg.evaluate(() => { const r = document.getElementById('nav').getBoundingClientRect(); return { top: r.top, h: r.height, w: r.width }; });
check('…the tabs are a bar along the bottom, the full width', nav.top > 760 && nav.w === 390, JSON.stringify(nav));
check('…and the sidebar\'s logo and settings button are not shown', !(await visible(pg, '.nav-brand')) && !(await visible(pg, '.nav-foot')));
check('light like RoofMap by default', await pg.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'));
const ink = await pg.evaluate(() => getComputedStyle(document.getElementById('top')).backgroundColor);
check('…with RoofMap\'s navy header', ink === 'rgb(10, 22, 40)', ink);
check('the page is the Command Centre', (await pg.textContent('#page-title')).trim() === 'Command Centre');

// the forward workflow card — the Workload tab's own sums
const fw = await pg.evaluate(() => {
  const c = capacity(), rem = Math.max(0, totalRemaining());
  return { want: Math.round(rem / c.perDay / 5 * 10) / 10, wantH: fmtH(Math.round(rem)) + ' h',
    weeks: (document.getElementById('fwh-weeks') || {}).textContent, hours: (document.getElementById('fwh-hours') || {}).textContent,
    top: document.getElementById('cmd-fw').getBoundingClientRect().top, kpis: document.getElementById('cmd-kpis').getBoundingClientRect().top,
    spark: !!document.querySelector('#cmd-fw .fwh-svg'), oldTile: [...document.querySelectorAll('#cmd-kpis .kpi .kl')].some(e => /forward workflow/i.test(e.textContent)) };
});
check('the forward workflow card shows the weeks booked, as the Workload tab works them out', fw.weeks === String(fw.want), JSON.stringify(fw));
check('…and the hours left', fw.hours === fw.wantH, fw.hours + ' vs ' + fw.wantH);
check('…at the top of the Command Centre, above the tiles', fw.top < fw.kpis, fw.top + ' < ' + fw.kpis);
check('…with the six-month trend drawn', fw.spark);
const byM = await pg.evaluate(() => { const g = document.querySelector('#page-dash .dgrid'), kids = [...g.children];
  const r = s => document.querySelector(s).getBoundingClientRect();
  return { next: kids[kids.indexOf(document.getElementById('cmd-fw')) + 1].className, fwBot: Math.round(r('#cmd-fw').bottom), moTop: Math.round(r('.d-month').top), kpis: Math.round(r('#cmd-kpis').top), cards: document.querySelectorAll('#month-strip-dash .mcard').length }; });
check('By Month sits straight under the forward workflow, above the tiles', /\bd-month\b/.test(byM.next) && byM.moTop >= byM.fwBot && byM.moTop - byM.fwBot < 40 && byM.moTop < byM.kpis && byM.cards > 0, JSON.stringify(byM));
check('…and the old tile is gone from the grid, not shown twice', !fw.oldTile);
await pg.click('#cmd-fw .fwh-num');
let t = await pg.evaluate(() => ({ open: document.getElementById('cmd-modal').classList.contains('open'), title: document.getElementById('cmd-modal-title').textContent, rows: document.querySelectorAll('#cmd-modal-body tr').length }));
check('tapping the card opens the active-jobs list the tile used to open', t.open && /forward workflow/i.test(t.title) && t.rows >= 14, JSON.stringify(t));
await pg.evaluate(() => closeCmdDetail());
await pg.click('#cmd-fw .fwh-go');
check('"Workload ›" goes to the Workload tab, not the list', await pg.evaluate(() => page === 'work' && !document.getElementById('cmd-modal').classList.contains('open')));
await pg.evaluate(() => go('dash'));

// every KPI tile opens its window, with something in it
const keys = await pg.evaluate(() => [...document.querySelectorAll('#cmd-kpis .kpi-tap')].map(e => (e.getAttribute('onclick') || '').match(/openCmdDetail\('(\w+)'\)/)).filter(Boolean).map(m => m[1]));
check('the Command Centre still has its tiles', keys.length >= 9, keys.join(','));
let bad = [];
for (let i = 0; i < keys.length; i++){
  await pg.evaluate(i => { closeCmdDetail(); document.querySelectorAll('#cmd-kpis .kpi-tap')[i].scrollIntoView(); }, i);
  await pg.locator('#cmd-kpis .kpi-tap').nth(i).locator('.kl').click();
  const r = await pg.evaluate(() => ({ open: document.getElementById('cmd-modal').classList.contains('open'), len: document.getElementById('cmd-modal-body').textContent.trim().length }));
  if (!r.open || r.len < 20) bad.push(keys[i] + ':' + JSON.stringify(r));
}
await pg.evaluate(() => closeCmdDetail());
check('…and every one of them opens its window with content', bad.length === 0, bad.join(' '));

// the Cash at a glance boxes
const boxes = await pg.locator('#dash-summary .mb-tap').count();
bad = [];
for (let i = 0; i < boxes; i++){
  await pg.locator('#dash-summary .mb-tap').nth(i).click();
  // VISIBLE, not just flagged open: the modal was written inside the Cash tab, so from here it
  // opened inside a hidden page and the owner's taps did nothing (2026-10-25).
  const r = await pg.evaluate(() => { const m = document.getElementById('cash-modal'); const b = m.getBoundingClientRect(); return { open: m.classList.contains('open'), shown: b.width > 0 && b.height > 0, n: document.querySelectorAll('#cmodal-body .cash-detail').length, rows: document.querySelectorAll('#cmodal-body tbody tr').length, t: document.getElementById('cmodal-title').textContent }; });
  if (!r.open || !r.shown || !r.n) bad.push(i + ':' + JSON.stringify(r));
  if (i >= 1 && !r.rows) bad.push(i + ' no jobs listed:' + JSON.stringify(r));
  await pg.evaluate(() => closeCashDetail());
}
check('every Cash at a glance box (' + boxes + ') opens its detail ON SCREEN from the Command Centre, the jobs listed', boxes === 6 && bad.length === 0, bad.join(' '));
const owedJobs = await pg.evaluate(() => { openCashDetail('owed'); const ids = [...document.querySelectorAll('#cmodal-body table')].map(t => t.id); closeCashDetail(); return ids; });
const fitW = await pg.evaluate(() => { openCashDetail('owed'); const r = [...document.querySelectorAll('#cmodal-body table.tb')].map(t => t.scrollWidth - t.parentElement.clientWidth); closeCashDetail(); return r; });
check('…and on a phone every list fits the screen, the Due in figure never off the right', fitW.length >= 4 && fitW.every(d => d <= 1), JSON.stringify(fitW));
check('Total owed to you lists every due-in job and every unpaid invoice', ['cf-due-tbl', 'cash-ar-tbl'].every(id => owedJobs.includes(id)) && owedJobs.length >= 4, owedJobs.join(','));

// a dashboard month card opens that month's P&L
const mk = await pg.evaluate(() => { const c = document.querySelector('#month-strip-dash .mcard.mc-tap'); return c ? c.querySelector('.mm').firstChild.textContent : null; });
if (mk) await pg.locator('#month-strip-dash .mcard.mc-tap').first().click();
check('a month card on the Command Centre opens that month on the P&L tab', mk && await pg.evaluate(m => page === 'pl' && plSelected === m, mk), mk);
await pg.evaluate(() => go('dash'));

// every tab, from the bottom bar
bad = [];
for (const p of ['work', 'bc', 'pl', 'growth', 'marketing', 'cash', 'dash']){
  await pg.click('#nav-' + p);
  if (!(await pg.evaluate(p => page === p && document.getElementById('page-' + p).classList.contains('active'), p))) bad.push(p);
}
check('every tab opens from the bottom bar', bad.length === 0, bad.join(','));
check('…with no page error anywhere along the way', errs.length === 0, JSON.stringify(errs));
check('the nightly sync\'s entry point is still there', await pg.evaluate(() => typeof window.__teamHeadlessSync === 'function'));

// every other tab carries the same look (2026-10-24, "do the same styling for all the tabs")
const look = await pg.evaluate(() => {
  const out = {};
  for (const t of ['work', 'bc', 'pl', 'growth', 'marketing', 'cash']){ go(t); document.querySelectorAll('details.acc').forEach(d => d.open = true); }
  const boxes = [...document.querySelectorAll('.page .mb')].filter(e => !e.closest('.mg-list'));
  out.boxes = boxes.length; out.unmarked = boxes.filter(e => !e.querySelector('.mb-mark')).length;
  out.bcTiles = document.querySelectorAll('#bc-tiles .kpi.sc').length; out.plTiles = document.querySelectorAll('#pl-tiles .kpi.sc').length;
  out.heroes = ['page-work', 'page-growth', 'page-marketing'].map(id => { const c = document.querySelector('#' + id + ' > .hero-card'); return c ? getComputedStyle(c).backgroundColor : 'none'; });
  out.plStrip = [...document.querySelectorAll('#pl-strip .mcard')].every(c => /selectMonth\(/.test(c.getAttribute('onclick') || '')) && document.querySelectorAll('#pl-strip .mcard').length > 0;
  out.heads = ['bc-strip', 'mkt-strip', 'mkt-wk-strip', 'pl-strip'].map(id => !!document.querySelector('#' + id + ' .mcard .mrev'));
  return out; });
check('every metric box on every tab has its coloured marker', look.boxes >= 20 && look.unmarked === 0, JSON.stringify(look));
check('the Back Cost and P&L totals are stat cards', look.bcTiles === 4 && look.plTiles === 4, look.bcTiles + ' / ' + look.plTiles);
check('Workload, Growth and Marketing open on a navy headline card', look.heroes.every(c => c === 'rgb(10, 22, 40)'), look.heroes.join(' '));
check('every month strip leads with its headline figure', look.heads.every(Boolean), JSON.stringify(look.heads));
check('…and a P&L month card still selects its month', look.plStrip);
bad = [];
for (const k of ['deposit', 'owed', 'due50', 'due10', 'due0', 'ar']){
  const r = await pg.evaluate(k => { go('cash'); openCashDetail(k); const n = document.querySelectorAll('#cmodal-body .cash-detail').length; const open = document.getElementById('cash-modal').classList.contains('open'); closeCashDetail(); return n > 0 && open; }, k);
  if (!r) bad.push(k);
}
check('every Cash detail still opens from the Cash tab', bad.length === 0, bad.join(','));
const tog = await pg.evaluate(() => { go('cash'); const a = document.querySelector('#bank-accts .bacct'); if (!a) return null; const was = a.classList.contains('off'); a.click(); const now = document.querySelector('#bank-accts .bacct').classList.contains('off'); document.querySelector('#bank-accts .bacct').click(); return was !== now; });
check('a bank account still switches in and out of the forecast', tog === true, String(tog));
check('…and no page error on any tab', errs.length === 0, JSON.stringify(errs));
await pg.evaluate(() => go('dash'));

// Back Cost: All Back Costing first; on a phone each job is two lines and every month ends on its total
// (2026-10-24, the owner: "move the 'all back costing' to the top ... make each job two lines ... at the bottom
// of the month show the combined total before starting the next month").
await pg.evaluate(() => go('bc')); await pg.waitForTimeout(500);
const bc = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('#page-bc > .card')], first = cards[1] && cards[1].querySelector('.ct');
  const out = { first: first ? first.textContent.trim() : '', top: cards[0] && cards[0].id, strip: document.querySelectorAll('#bc-strip .mcard').length,
    stripVis: document.getElementById('bc-strip').getBoundingClientRect().height > 0,
    newest: (document.querySelector('#bc-strip .mcard .mm') || {}).textContent || '', want: dataMonths().slice(-1)[0] };
  const vis = s => { const e = document.querySelector(s); return !!(e && e.getBoundingClientRect().height > 0); };
  out.list = vis('#bc-list'); out.table = vis('.bc-tbl-wrap');
  const jobs = [...document.querySelectorAll('#bc-list .bcm-job')];
  out.jobs = jobs.length; out.twoLine = jobs.every(j => j.querySelector(':scope > .bcm-l1') && j.querySelector(':scope > .bcm-l2'));
  const withNo = jobs.filter(j => /^#\d+/.test((j.querySelector('.bcm-l1 b') || {}).textContent || ''));
  out.withNo = withNo.length;
  out.firstL1 = jobs[0] ? jobs[0].querySelector('.bcm-l1').textContent.trim() : '';
  // each month: the last thing in it is its total, and that total is the sum of its (not crossed-out) jobs
  out.months = [...document.querySelectorAll('#bc-list .bcm-month')].map(m => {
    const kids = [...m.children], last = kids[kids.length - 1];
    const label = m.querySelector('.bcm-mhead').firstChild.textContent.trim().replace(' ', '-');
    const rows = getAllBC().filter(r => (r.month || '') === label && !isExcl(r));
    const want = rows.reduce((s, r) => s + num(r.sales), 0);
    const shown = last.querySelector('.bcm-f b').textContent;
    return { label, endsOnTotal: last.classList.contains('bcm-sub'), shown, want: fmtK(want) };
  }).slice(0, 4);
  return out;
});
check('the 12-Month History opens the Back Cost tab, open, newest month first', bc.top === 'bc-strip-card' && bc.stripVis && bc.strip >= 12 && bc.newest === bc.want, JSON.stringify({ top: bc.top, strip: bc.strip, newest: bc.newest, want: bc.want }));
check('…with All Back Costing straight under it', /^All Back Costing/.test(bc.first), bc.first);
check('…on a phone it is a list, not the wide table', bc.list && !bc.table, JSON.stringify({ list: bc.list, table: bc.table }));
check('…every job is two lines: the job number and a short address, then the figures', bc.jobs > 0 && bc.twoLine && bc.withNo >= 9 && /^#3240\s*\S/.test(bc.firstL1), JSON.stringify({ jobs: bc.jobs, withNo: bc.withNo, l1: bc.firstL1 }));
check('…and the short address is short (no town, no postcode)', !/Whangarei|Northland/.test(bc.firstL1), bc.firstL1);
check('every month ends on its own total, before the next month starts', bc.months.length >= 2 && bc.months.every(m => m.endsOnTotal), JSON.stringify(bc.months));
check('…and each month\'s total is that month\'s jobs added up', bc.months.every(m => m.shown === m.want), JSON.stringify(bc.months));
// The filters fold into one button beside Show all · Roofer view (2026-10-25, the owner)
const flt = await pg.evaluate(() => {
  const vis = s => { const e = document.querySelector(s); return !!(e && e.getBoundingClientRect().height > 0); };
  const bar = document.querySelector('#page-bc .bc-cols-bar'), btn = document.getElementById('bc-filter-btn');
  const out = { inBar: !!(bar && bar.contains(btn)), shut: !vis('#bc-year') && !vis('#bc-search') && !vis('#bc-count'),
    title: document.querySelector('#page-bc > .card:nth-of-type(2) .ct').textContent.trim(), jobs0: parseInt(document.getElementById('bc-count').textContent) };
  btn.click(); out.open = vis('#bc-year') && vis('#bc-type') && vis('#bc-lead') && vis('#bc-search') && /jobs/.test(document.getElementById('bc-count').textContent);
  const ye = document.getElementById('bc-year'); ye.value = ye.options[ye.options.length - 1].value; ye.dispatchEvent(new Event('change'));
  out.label = btn.textContent; out.lit = btn.classList.contains('on'); out.jobs1 = parseInt(document.getElementById('bc-count').textContent);
  bcFilterClear(); out.cleared = btn.textContent; out.jobs2 = parseInt(document.getElementById('bc-count').textContent);
  btn.click(); out.shutAgain = !vis('#bc-year');
  return out;
});
check('All Back Costing\'s filters fold into a Filter button beside Show all · Roofer view, shut to start', flt.inBar && flt.shut && flt.title === 'All Back Costing', JSON.stringify(flt));
check('…it opens on the year, type, roofer, search and the job count', flt.open, JSON.stringify(flt));
check('…a filter set lights it and says how many are on, and Clear filters puts every job back', /Filter · 1/.test(flt.label) && flt.lit && flt.jobs1 < flt.jobs0 && flt.cleared === 'Filter' && flt.jobs2 === flt.jobs0 && flt.shutAgain, JSON.stringify(flt));
const lead = await pg.evaluate(() => {
  const j = document.querySelectorAll('#bc-list .bcm-job')[1]; j.click(); const open = j.classList.contains('open');
  const sel = j.querySelector('.bcm-more select.lr-sel'); if (!sel) return { open, sel: false };
  sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { open, sel: true, set: Object.values(leadOverride).includes(sel.options[1].value) };
});
// Two months open, the rest behind "See previous month" under the last one shown (2026-10-25, the owner)
const more = await pg.evaluate(() => {
  const ms = () => [...document.querySelectorAll('#bc-list .bcm-month')], btn = () => document.querySelector('#bc-list .bc-more-btn');
  const after = () => { const b = btn(), m = ms(); return !!(b && m.length && m[m.length - 1].nextElementSibling === b); };
  const all = new Set(getAllBC().map(r => r.month || '—')).size;
  const out = { all, start: ms().length, label: btn() ? btn().firstChild.textContent.trim() : '', after0: after(),
    grandLast: (document.querySelector('#bc-list').lastElementChild || { classList: { contains: () => false } }).classList.contains('bcm-grand') };
  btn().click(); out.one = ms().length; out.after1 = after();
  let guard = 0; while (btn() && guard++ < 60) btn().click();
  out.end = ms().length; out.gone = !btn();
  return out;
});
check('All Back Costing shows the two newest months, "See previous month" under the second, the grand total last', more.all > 3 && more.start === 2 && more.label === 'See previous month' && more.after0 && more.grandLast, JSON.stringify(more));
check('…each press opens one more month and the button stays under the last one, until every month is out', more.one === 3 && more.after1 && more.end === more.all && more.gone, JSON.stringify(more));
const fit = await pg.evaluate(() => {
  const ms = [...document.querySelectorAll('#bc-list .bcm-month')];
  const big = ms.reduce((b, m) => (m.querySelectorAll('.bcm-job').length > (b ? b.querySelectorAll('.bcm-job').length : 0) ? m : b), null);
  big.scrollIntoView({ block: 'start' }); window.scrollBy(0, big.getBoundingClientRect().top - document.getElementById('top').getBoundingClientRect().bottom - 6);
  const navTop = document.getElementById('nav').getBoundingClientRect().top, topBot = document.getElementById('top').getBoundingClientRect().bottom;
  const head = big.querySelector('.bcm-mhead').getBoundingClientRect(), sub = big.querySelector('.bcm-sub').getBoundingClientRect(), jobs = big.querySelector('.bcm-jobs');
  const before = jobs.scrollTop; jobs.scrollTop = 200; const scrolled = jobs.scrollTop > before;
  return { n: big.querySelectorAll('.bcm-job').length, headTop: Math.round(head.top), topBot: Math.round(topBot), subBottom: Math.round(sub.bottom), navTop: Math.round(navTop),
    scrollable: jobs.scrollHeight > jobs.clientHeight + 4, scrolled };
});
check('a busy month fits on one phone screen: its band at the top, its total above the tab bar', fit.n > 10 && fit.headTop >= fit.topBot - 2 && fit.subBottom <= fit.navTop, JSON.stringify(fit));
check('…and its jobs scroll between the two', fit.scrollable && fit.scrolled, JSON.stringify(fit));

// Growth: Xero's P&L months ÷ the crews on the tools (2026-10-25, the owner: "fully recalculate the growth tab to
// suit the actual numbers of my guys on the tools for the P&L months", then "work it out per crew instead of per guy")
await pg.evaluate(() => { localStorage.removeItem('fr3_growthCfg'); growthCfg = Object.assign({}, growthCfg, { win: '12', crews: '', ohMo: '' }); go('growth'); });
await pg.waitForTimeout(300);
const gr = await pg.evaluate(() => {
  const cur = calMonthKey(0), months = crewMonths().filter(k => k !== cur && crewFor(k) && crewFor(k).n > 0 && !crewFor(k).part && crewTeamsFor(k) && xeroFig(k) && xeroFig(k).rev > 0);
  const last12 = months.slice(-12);
  const sum = (ks, f) => ks.reduce((s, k) => s + f(k), 0);
  const cm = sum(last12, k => crewTeamsFor(k).c);
  const want = sum(last12, k => xeroFig(k).rev) / cm, wantNp = sum(last12, k => xeroFig(k).np) / cm;
  const body = [...document.querySelectorAll('#g-mbody tr')];
  const out = { hero: document.getElementById('g-np').textContent, unit: document.getElementById('g-np-unit').textContent, want: fmtK(want), wantNp: fmtK(wantNp),
    sub: document.getElementById('g-np-sub').textContent,
    rows: body.length, n12: last12.length, first: body[0] ? body[0].cells[0].textContent : '', newest: last12[last12.length - 1].replace('-20', ' '),
    firstCrews: body[0] ? body[0].cells[1].textContent : '', avgRow: body.length ? body[body.length - 1].textContent : '',
    fergus: /Fergus/.test(document.getElementById('page-growth').innerText), oldInputs: !!document.getElementById('g-guys') || !!document.getElementById('g-hrswk') };
  gSetWin('all'); out.allFirst = [...document.querySelectorAll('#g-mbody tr')].slice(-2)[0].cells[0].textContent; out.allRows = document.querySelectorAll('#g-mbody tr').length - 1; out.allN = months.length;
  gSetWin('3'); out.threeRows = document.querySelectorAll('#g-mbody tr').length - 1; gSetWin('12');
  // a crew number typed on the P&L strip moves the month's figure here
  const k = last12[last12.length - 1], f = xeroFig(k); window.prompt = () => '8'; crewTeamsEdit(null, k); renderGrowth();
  out.typed = document.querySelector('#g-mbody tr').cells[2].textContent; out.typedWant = fmtK(f.rev / 8);
  window.prompt = () => ''; crewTeamsEdit(null, k); renderGrowth();
  const m = growthModel(), c = m.crewsNow + 2; gSetCrews(c); const proj = document.getElementById('g-proj').innerText;
  out.projNp = proj.indexOf(fmtK(c * m.per.gp - m.ohAvg)) >= 0; out.projRev = proj.indexOf(fmtK(c * m.per.rev)) >= 0;
  const tot = [...document.querySelectorAll('#g-body tr.tot td')].map(td => td.textContent);
  out.tblCrews = tot[0] === String(c); out.tblGuys = tot[1] === String(m.guysNow + 4); out.tradies = document.getElementById('g-tradies').textContent;
  gSetCrews(''); return out; });
check('Growth opens on what a CREW brings in a month: Xero revenue ÷ the crews on the tools, last 12 months', gr.hero === gr.want && /a crew/.test(gr.unit) && gr.sub.indexOf('NP ' + gr.wantNp + ' a crew') >= 0 && !gr.fergus && !gr.oldInputs, JSON.stringify(gr));
check('…month by month, newest first, crews with the head count under them, and an average row', gr.rows === gr.n12 + 1 && gr.first === gr.newest && /^\d+\s*\d+ guys/.test(gr.firstCrews) && /^Average/.test(gr.avgRow), JSON.stringify(gr));
check('…the window switches: Since Sep 2024 takes every full month (not Aug 2024\'s part), 3 months takes three', gr.allFirst === 'Sep 24' && gr.allRows === gr.allN && gr.threeRows === 3, JSON.stringify(gr));
check('…a crew number typed on the P&L strip is the one used', gr.typed === gr.typedWant, JSON.stringify(gr));
const gfit = await pg.evaluate(() => { const w = document.querySelector('.g-mtbl'); return { sw: w.scrollWidth, cw: w.clientWidth }; });
check('…and on a phone the month table fits with no sideways scroll', gfit.sw <= gfit.cw + 1, JSON.stringify(gfit));
check('…and adding crews adds GP a crew, each a leader and an apprentice, while the overheads stay put', gr.projNp && gr.projRev && gr.tblCrews && gr.tblGuys && /crews · \d+ guys/.test(gr.tradies), JSON.stringify(gr));

// Workload: Per active job sits straight under the hero, and on a phone it is one row a job — tick, job number
// over the short address, then the figures — with no sideways scroll (2026-10-25, the owner).
await pg.evaluate(() => go('work')); await pg.waitForTimeout(400);
const wk = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('#page-work > .card')];
  const vis = s => { const e = document.querySelector(s); return !!(e && e.getBoundingClientRect().height > 0); };
  const rows = [...document.querySelectorAll('#work-list .wkm-row:not(.wkm-hd)')], host = document.getElementById('work-list');
  const r0 = rows[0], j0 = fwJobs.find(j => j.id === r0.dataset.id);
  return { second: cards[1] && cards[1].id, list: vis('#work-list'), table: vis('.wk-tbl-wrap'), n: rows.length, want: fwJobs.length,
    no: r0.querySelector('.wkm-id b').firstChild.textContent, addr: r0.querySelector('.wkm-id span').textContent, jobNo: j0 && j0.jobNo,
    figs: [...r0.querySelectorAll('.wkm-n')].map(e => e.textContent).concat(r0.querySelector('.wk-rem').value),
    want0: j0 ? [fmtH(j0.priced), fmtH(j0.actual), String(remVal(j0))] : [],
    fits: host.scrollWidth <= host.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1,
    inside: rows.every(r => r.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1) };
});
check('Per active job is the card straight under Remaining Work', wk.second === 'work-jobs-card', wk.second);
check('…on a phone it is a list of every active job, not the wide table', wk.list && !wk.table && wk.n === wk.want && wk.n > 0, JSON.stringify(wk));
check('…each row: the job number over the short address, then priced, actual and remaining hours', wk.no === '#' + wk.jobNo && wk.addr && !/Whangarei|—/.test(wk.addr) && JSON.stringify(wk.figs) === JSON.stringify(wk.want0), JSON.stringify(wk));
check('…and it all fits across a phone, no sideways scroll', wk.fits && wk.inside, JSON.stringify(wk));
const wkTick = await pg.evaluate(() => {
  const r = document.querySelector('#work-list .wkm-row:not(.wkm-hd)'), id = r.dataset.id, before = totalRemaining();
  const c = r.querySelector('.wk-chk'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
  const after = totalRemaining(), done = !!fwDone[id], dim = document.querySelector('#work-list .wkm-row[data-id="' + id + '"]').classList.contains('wk-done');
  toggleWkDone(id, false); return { before, after, done, dim };
});
check('…ticking a job done on the phone drops its hours from the total', wkTick.done && wkTick.dim && wkTick.after < wkTick.before, JSON.stringify(wkTick));
// A tap on a job's number opens its details under the row (2026-10-25, the owner: "let me click each of
// those jobs to see the whole address, customer name, job title and total job revenue").
const wkOpen = await pg.evaluate(async () => {
  const wrap = id => document.querySelector('#work-list .wkm-row[data-id="' + id + '"]').closest('.wkm-job');
  const j = fwJobs.find(x => x.title), old = fwJobs.find(x => !('title' in x));
  const w = wrap(j.id), more = w.querySelector('.wkm-more'), hidden = more.getBoundingClientRect().height === 0;
  w.querySelector('.wkm-id').click();
  const txt = more.innerText, shown = more.getBoundingClientRect().height > 0;
  setWkRem(j.id, String(remVal(j)));   // an edit re-draws the list — the job stays open
  const still = wrap(j.id).classList.contains('open');
  wrap(old.id).querySelector('.wkm-id').click(); const oldTxt = wrap(old.id).querySelector('.wkm-more').innerText;
  wrap(j.id).querySelector('.wkm-id').click(); const shut = !wrap(j.id).classList.contains('open');
  wrap(old.id).querySelector('.wkm-id').click();
  const host = document.getElementById('work-list');
  return { hidden, shown, still, shut, txt, oldTxt, client: j.client, site: j.site, title: j.title, rev: fmt$(j.sale),
    oldClient: old.job.split(' — ')[0], oldSite: old.job.split(' — ')[1],
    fits: host.scrollWidth <= host.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 };
});
check('…a tap on a job opens the customer, the whole address, the job title and the job revenue', wkOpen.hidden && wkOpen.shown && wkOpen.txt.includes(wkOpen.client) && wkOpen.txt.includes(wkOpen.site) && wkOpen.txt.includes(wkOpen.title) && wkOpen.txt.includes(wkOpen.rev) && /excl\. GST/.test(wkOpen.txt), JSON.stringify(wkOpen));
check('…it stays open when the list re-draws, shuts on a second tap, and still fits a phone', wkOpen.still && wkOpen.shut && wkOpen.fits, JSON.stringify(wkOpen));
check('…a job from an older sync takes the customer and address out of its name and says the title comes with the next sync', wkOpen.oldTxt.includes(wkOpen.oldClient) && wkOpen.oldTxt.includes(wkOpen.oldSite) && /next Fergus sync/.test(wkOpen.oldTxt), JSON.stringify(wkOpen));

await pg.evaluate(() => go('pl')); await pg.waitForTimeout(400);
const crew = await pg.evaluate(() => {
  const host = document.getElementById('pl-crew'), cards = [...host.querySelectorAll('.mcard')];
  const card = m => host.querySelector('.mcard[data-m="' + m + '"]');
  const first = document.querySelector('#page-pl > .card');
  const r = host.getBoundingClientRect(), last = cards[cards.length - 1].getBoundingClientRect();
  return { first: first && first.id, n: cards.length, want: crewMonths().length, firstM: cards[0].dataset.m, lastM: cards[cards.length - 1].dataset.m,
    now: calMonthKey(0), sep: card('Sep-2024').querySelector('.crew-n').innerText, jul: card('Jul-2024').querySelector('.crew-n').innerText,
    sepRev: (card('Sep-2024').textContent.match(/Rev \/ person/) || [])[0] || '', scrolls: host.scrollWidth > host.clientWidth + 20,
    lastSeen: last.right <= r.right + 2 && host.scrollLeft > 0,
    missing: crewMonths().filter(m => m !== 'Jul-2024' && !(crewFor(m) && crewFor(m).n > 0)) };
});
check('the P&L tab opens on the crew strip', crew.first === 'pl-crew-card', JSON.stringify(crew));
const plGone = await pg.evaluate(() => ({ body: !!document.getElementById('epl-body'), text: /P&L — earned|tie out\?|Earned vs Xero revenue|deposits held/.test(document.getElementById('page-pl').textContent), cards: document.querySelectorAll('#page-pl > .card').length }));
check('the earned P&L card (earned month, work in progress, earned vs Xero, reconciliation) is gone from the P&L tab', !plGone.body && !plGone.text && plGone.cards > 2, JSON.stringify(plGone));
check('…one card a month from Jul 2024 to this month', crew.n === crew.want && crew.firstM === 'Jul-2024' && crew.lastM === crew.now && crew.n >= 27, JSON.stringify(crew));
check('…Sep 2024 reads 4 on the tools from the pay runs, with its full-time equivalent', /^4\b/.test(crew.sep) && /on the tools/.test(crew.sep) && /3\.8 full-time/.test(crew.sep), crew.sep);
check('…every month from Aug 2024 to now has a crew number from the pay runs', crew.missing.length === 0, crew.missing.join(' '));
// Under Last 12 Months: rolling 3- and 6-month averages, then one card a financial year (Apr – Mar) to swipe
// through; Average job value folded away (2026-10-25, the owner).
const plx = await pg.evaluate(() => {
  const ids = [...document.querySelectorAll('#page-pl > .card, #page-pl > details')].map(e => e.id || (e.querySelector('[id]') || {}).id);
  const at = id => ids.indexOf(id), strip = ids.indexOf('pl-strip') >= 0 ? ids.indexOf('pl-strip') : ids.findIndex(x => x === 'pl-strip');
  const stripCard = document.getElementById('pl-strip').closest('.card');
  const order = [...document.getElementById('page-pl').children];
  const pos = el => order.indexOf(el);
  const r3 = document.querySelectorAll('#pl-roll3 .mcard'), r6 = document.querySelectorAll('#pl-roll6 .mcard');
  const yrs = [...document.querySelectorAll('#pl-years .mcard')];
  const fy = yrs[1] && +yrs[1].dataset.fy, ms = fy ? plFyMonths(fy).filter(k => xeroFig(k)) : [];
  const want = ms.reduce((a, k) => a + xeroFig(k).rev, 0);
  const acc = document.getElementById('pl-avgjob-acc'), host = document.getElementById('pl-years');
  return { after: pos(document.getElementById('pl-roll3-card')) === pos(stripCard) + 1 && pos(document.getElementById('pl-roll6-card')) === pos(stripCard) + 2 && pos(document.getElementById('pl-year-card')) === pos(stripCard) + 3,
    r3: r3.length, r6: r6.length, r3lbl: r3[0] && r3[0].innerText, r6lbl: r6[0] && r6[0].innerText,
    years: yrs.map(c => c.dataset.fy), fy, rev: yrs[1] && yrs[1].querySelector('.mrev b').textContent, want: fmtK(want), first: yrs[0] && yrs[0].innerText,
    swipe: getComputedStyle(host).overflowX, accClosed: acc && acc.tagName === 'DETAILS', accHas: !!(acc && acc.querySelector('#pl-avgjob')),
    apr: plFyOf('Apr-2026'), mar: plFyOf('Mar-2026') };
});
check('Under Last 12 Months come the rolling 3-month and 6-month averages, then the P&L by year', plx.after, JSON.stringify(plx));
check('…each rolling strip is a card a month', plx.r3 >= 6 && plx.r6 >= 6 && /3-mo avg/i.test(plx.r3lbl) && /6-mo avg/i.test(plx.r6lbl), JSON.stringify(plx));
check('…the years run newest first, April to March, and a year is the total of its months', plx.apr === 2027 && plx.mar === 2026 && plx.years.length >= 2 && plx.years[0] > plx.years[1] && plx.rev === plx.want && /To date/i.test(plx.first), JSON.stringify(plx));
// Millions read as millions, and the year still running says where it is on track to land (2026-10-25, the owner).
const rr = await pg.evaluate(() => {
  const fmt = [fmtK(1064000), fmtK(2320000), fmtK(1000000), fmtK(999400), fmtK(3348123), fmtK(-1250000), fmtK(64500)];
  const fy = plFyOf(calMonthKey(0)), card = document.querySelector('#pl-years .mcard[data-fy="' + fy + '"]'), box = card && card.querySelector('.py-rr');
  const cur = calMonthKey(0), all = plFyMonths(fy), done = all.filter((k, i) => i < all.indexOf(cur) && xeroFig(k));
  const sum = k => done.reduce((s, m) => s + xeroFig(m)[k], 0), proj = k => sum(k) / done.length * 12;
  const others = [...document.querySelectorAll('#pl-years .mcard')].filter(c => c !== card).some(c => c.querySelector('.py-rr'));
  return { fmt, has: !!box, txt: box && box.innerText, rev: box && box.querySelector('.mrev b').textContent, want: fmtK(proj('rev')), np: fmtK(proj('np')), n: done.length, others,
    noK: !/\d{4,}k/.test(document.getElementById('page-pl').innerText) };
});
check('…a million and up reads in millions — $1.064m, $2.32m, $1m — never $1064k', JSON.stringify(rr.fmt) === JSON.stringify(['$1.064m', '$2.32m', '$1m', '$999k', '$3.348m', '-$1.25m', '$64.5k']) && rr.noK, JSON.stringify(rr));
check('…and the year still running shows its run-rate: the full months so far, at their average for the rest', rr.has && rr.rev === rr.want && rr.txt.includes(rr.np) && new RegExp(rr.n + ' full month').test(rr.txt) && !rr.others, JSON.stringify(rr));
const plSrc = readFileSync(join(ROOT, 'hub', 'FloodRoofing_Financials.html'), 'utf8');   // the suite opens every fold above, so read the page as shipped
check('…the years swipe sideways, and Average job value is folded away', /auto|scroll/.test(plx.swipe) && plx.accClosed && plx.accHas && /<details class="acc" id="pl-avgjob-acc">/.test(plSrc), JSON.stringify(plx));
check('…and Rev / person beside it', crew.sepRev === 'Rev / person');
const crews = await pg.evaluate(() => { const txt = m => { const c = document.querySelector('#pl-crew .mcard[data-m="' + m + '"] .crew-c'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : ''; };
  const card = document.querySelector('#pl-crew .mcard[data-m="Sep-2026"]'), rows = [...card.querySelectorAll('.ml .k')].map(e => e.textContent);
  const f = xeroFig('Sep-2026');
  const out = { sep24: txt('Sep-2024'), jan26: txt('Jan-2026'), jul26: txt('Jul-2026'), sep26: txt('Sep-2026'), mar25: txt('Mar-2025'), jul24: txt('Jul-2024'),
    rows, perCrew: f && f.rev > 0 ? card.innerText.indexOf(fmtK(f.rev / 4)) >= 0 : null,
    names: /Ethan|Luke|Jacob|Justin/.test(document.getElementById('pl-crew').innerText) };
  window.prompt = () => '5'; crewTeamsEdit(null, 'Sep-2026'); out.typed = crewTeamsFor('Sep-2026').c; out.keptN = crewFor('Sep-2026').n;
  window.prompt = () => ''; crewTeamsEdit(null, 'Sep-2026'); out.back = crewTeamsFor('Sep-2026').src + ':' + crewTeamsFor('Sep-2026').c;
  return out; });
check('every month carries its crews (team leaders on the tools): 2 from Sep 2024, 3 from May 2025, 4 from Jan 2026, 4 now', /^2 crews/.test(crews.sep24) && /^2 crews/.test(crews.mar25) && /^4 crews/.test(crews.jan26) && /^4 crews/.test(crews.sep26) && /2\.5 a crew/.test(crews.sep26), JSON.stringify(crews));
check('…the July 2026 handover counts one crew, not two, and no names reach the page', /^4 crews/.test(crews.jul26) && /new leader from 27 Jul/.test(crews.jul26) && !crews.names && crews.jul24 === '', JSON.stringify(crews));
check('…with Rev / crew and NP / crew beside the per-person figures', crews.rows.includes('Rev / crew') && crews.rows.includes('NP / crew') && crews.perCrew !== false, JSON.stringify(crews));
check('…and the crews can be typed over without touching the head count, blank puts the payroll figure back', crews.typed === 5 && crews.keptN === 10 && crews.back === 'payroll:4', JSON.stringify(crews));
check('…Jul 2024, before the first pay run, asks for the crew', /tap to add crew/.test(crew.jul), crew.jul);
check('…it swipes sideways and opens on the newest month', crew.scrolls && crew.lastSeen, JSON.stringify(crew));
const typed = await pg.evaluate(() => {
  const k = calMonthKey(-2), f = xeroFig(k); window.prompt = () => '6'; crewEdit(null, k);
  const card = document.querySelector('#pl-crew .mcard[data-m="' + k + '"]'), txt = card.innerText;
  const stored = JSON.parse(localStorage.getItem('fr3_crewMonthly') || '{}')[k];
  window.prompt = () => ''; crewEdit(null, 'Sep-2024'); const back = crewFor('Sep-2024');
  window.prompt = () => '7'; crewEdit(null, 'Sep-2024'); const over = crewFor('Sep-2024').n;
  window.prompt = () => ''; crewEdit(null, 'Sep-2024'); const again = crewFor('Sep-2024');
  return { six: card.querySelector('.crew-n b').textContent === '6', crewTxt: card.querySelector('.crew-n').textContent, stored: stored && stored.n, perOk: txt.indexOf(fmtK(f.rev / 6)) >= 0, over, back: again.src + ':' + again.n };
});
check('typing a crew number keeps it and works the per-person figures from it', typed.six && typed.stored === 6 && typed.perOk, JSON.stringify(typed));
check('…a typed number wins over the payroll figure, and blank puts it back', typed.over === 7 && typed.back === 'payroll:4', JSON.stringify(typed));
check('tapping a job opens its lead and crew pickers, and picking a lead still records it', lead.open && lead.sel && lead.set, JSON.stringify(lead));
await pg.evaluate(() => go('dash'));

// dark is still one tap away, and stays on this device
await pg.click('#theme-btn');
check('the moon gives dark', await pg.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark' && localStorage.getItem('fr3_look') === 'dark'));
check('…and the choice is never sent to the team (device-only key)', await pg.evaluate(() => !!TEAM_LOCAL_KEYS['fr3_look']));
await pg.reload(); await pg.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 15000 }).catch(() => {});
check('…it is still dark after a reload', await pg.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));
await ctx.close();

// an old dark setting from before is not carried into the new look
({ ctx, pg, errs } = await open({ width: 390, height: 844 }, 'try{localStorage.setItem("fr3_theme",JSON.stringify("dark"));}catch(e){}'));
check('a device that had the old dark default opens in the new light look', await pg.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'));
await ctx.close();

// ── the computer ──────────────────────────────────────────────────
({ ctx, pg, errs } = await open({ width: 1440, height: 900 }));
check('the computer boots with no page error', errs.length === 0, JSON.stringify(errs));
check('1440 px wide is the computer layout', await pg.evaluate(() => document.documentElement.classList.contains('is-desktop')));
await pg.locator('#dash-summary .mb-tap').nth(4).click();
const dCash = await pg.evaluate(() => { const c = document.querySelector('#cash-modal .cmodal-card').getBoundingClientRect(); const r = { w: c.width, rows: document.querySelectorAll('#cmodal-body tbody tr').length }; closeCashDetail(); return r; });
check('on the computer too, a Cash at a glance line opens its jobs over the Command Centre', dCash.w > 400 && dCash.rows > 0, JSON.stringify(dCash));
const side = await pg.evaluate(() => { const r = document.getElementById('nav').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
check('…the tabs are a sidebar down the left, the full height', side.left === 0 && side.top === 0 && side.w > 200 && side.w < 260 && side.h === 900, JSON.stringify(side));
check('…with the logo at the top and Sync & settings at the foot', (await visible(pg, '.nav-brand')) && (await visible(pg, '.nav-foot button')));
check('…and the logo is the hub\'s own', await pg.evaluate(() => document.querySelector('.nav-brand img').src === document.querySelector('.brand-logo').src));
const lay = await pg.evaluate(() => {
  const app = document.getElementById('app').getBoundingClientRect(), f = document.getElementById('cmd-fw').getBoundingClientRect(),
    a = document.querySelector('.d-alerts').getBoundingClientRect(), k = document.querySelector('#cmd-kpis .kpi').getBoundingClientRect();
  return { app: app.width, fw: f.width, fwTop: f.top, alLeft: a.left, alTop: a.top, fwRight: f.right, kpiW: k.width };
});
check('the Command Centre spreads out: the workflow card takes two thirds with the flags beside it', lay.fw > lay.app * 0.55 && lay.alLeft > lay.fwRight && Math.abs(lay.alTop - lay.fwTop) < 2, JSON.stringify(lay));
check('…and the tiles run four across', lay.kpiW < lay.app / 3.5, JSON.stringify(lay));
const byMd = await pg.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect();
  return { fwBot: Math.round(r('#cmd-fw').bottom), moTop: Math.round(r('.d-month').top), moW: Math.round(r('.d-month').width), app: Math.round(document.getElementById('app').getBoundingClientRect().width), kpis: Math.round(r('#cmd-kpis').top) }; });
check('…and on the computer By Month runs full width under the workflow card, above the tiles', byMd.moTop > byMd.fwBot && byMd.moTop < byMd.kpis && byMd.moW > byMd.app * 0.9, JSON.stringify(byMd));
// The Last Month card came off the Command Centre on 2026-10-28 (the owner: "remove 'last month' from the home tab").
check('…and there is no Last Month card on the Command Centre', await pg.evaluate(() => !document.querySelector('.d-last') && !document.getElementById('met-last')));
await pg.evaluate(() => go('bc')); await pg.waitForTimeout(400);
const bcd = await pg.evaluate(() => ({ table: document.querySelector('.bc-tbl-wrap').getBoundingClientRect().height > 0,
  list: document.getElementById('bc-list').getBoundingClientRect().height > 0,
  heads: document.querySelectorAll('#bc-tbl tr.bc-mhead').length, subs: document.querySelectorAll('#bc-tbl tr.bc-msub').length }));
check('on a computer Back Cost keeps the full table, with a band and a total for every month', bcd.table && !bcd.list && bcd.heads >= 2 && bcd.heads === bcd.subs, JSON.stringify(bcd));
const bcm = await pg.evaluate(() => { _bcMonthsShown = 2; renderBC(); const b = document.getElementById('bc-body'), last = b.lastElementChild;
  const out = { heads: b.querySelectorAll('tr.bc-mhead').length, btnLast: !!(last && last.classList.contains('bc-more-row') && last.previousElementSibling.classList.contains('bc-msub')),
    label: last ? last.textContent.trim() : '' };
  last.querySelector('button').click(); out.heads1 = document.querySelectorAll('#bc-body tr.bc-mhead').length; return out; });
check('…two months there too, See previous month under the second month\'s total, a press opens the next', bcm.heads === 2 && bcm.btnLast && /^See previous month/.test(bcm.label) && bcm.heads1 === 3, JSON.stringify(bcm));
await pg.evaluate(() => go('work')); await pg.waitForTimeout(300);
const wkd = await pg.evaluate(() => ({ table: document.querySelector('.wk-tbl-wrap').getBoundingClientRect().height > 0,
  list: document.getElementById('work-list').getBoundingClientRect().height > 0, rows: document.querySelectorAll('#work-body tr').length }));
check('on a computer Per active job keeps its table', wkd.table && !wkd.list && wkd.rows > 0, JSON.stringify(wkd));
await pg.click('#nav-pl');
check('a sidebar tab opens its page', await pg.evaluate(() => page === 'pl'));
await pg.evaluate(() => go('dash'));
await pg.locator('#cmd-kpis .kpi-tap').first().click();
const panel = await pg.evaluate(() => { const r = document.querySelector('#cmd-modal .cmodal-card').getBoundingClientRect(); return { w: r.width, left: r.left }; });
check('a tile\'s window is a centred panel, not a full-height sheet', panel.w <= 1000 && panel.left > 200, JSON.stringify(panel));
await pg.setViewportSize({ width: 800, height: 900 }); await pg.waitForTimeout(150);
check('narrow the window and it becomes the phone layout by itself', await pg.evaluate(() => !document.documentElement.classList.contains('is-desktop')));
// A/P NEXT MONTH IS THE CALENDAR MONTH AFTER THIS ONE (2026-10-28, the owner: "A/P next month should show
// xero's bills to pay next month (88.3k)"). apExp.next is the next 20th — from the 20th on that IS next month,
// and the tile, which always read foll, showed the month after next. Driven on the 28th and the 10th of a month.
const apn = await pg.evaluate(() => {
  const d20 = (y, m) => new Date(y, m, 20).getTime();
  const out = {};
  for (const day of [28, 10]) {
    const now = new Date(); now.setDate(day); const y = now.getFullYear(), m = now.getMonth();
    const nm = new Date(y, m + 1, 1), nm2 = new Date(y, m + 2, 1);
    const real = Date; const fixed = now.getTime();
    // the slot's "now" is the only clock it reads; stub it for the call
    window.Date = class extends real { constructor(...a){ super(...(a.length ? a : [fixed])); } static now(){ return fixed; } };
    const next20 = day >= 20 ? d20(nm.getFullYear(), nm.getMonth()) : d20(y, m);
    const foll20 = day >= 20 ? d20(nm2.getFullYear(), nm2.getMonth()) : d20(nm.getFullYear(), nm.getMonth());
    window.__apExp = { next: { ms: next20, ap: 0, mat: 1000, jobs: [{ mat: 1000 }] }, foll: { ms: foll20, ap: 0, mat: 2000, jobs: [{ mat: 2000 }] } };
    const sl = apNextMonthSlot();
    window.Date = real;
    out[day] = { month: new Date(sl.ms).getMonth(), want: nm.getMonth(), bills: sl.bills && typeof sl.bills.total === 'number' };
  }
  return out;
});
check('on the 28th, A/P next month is next month\'s 20th (apExp.next), not the month after', apn[28].month === apn[28].want && apn[28].bills, JSON.stringify(apn[28]));
check('on the 10th it is still next month (apExp.foll)', apn[10].month === apn[10].want && apn[10].bills, JSON.stringify(apn[10]));
// The tile is Xero's bills alone; the materials still to buy sit on the Cash tab as "likely due" the 20th
// of the month after next (2026-10-28, the owner: "put them as likely due in December 20th and move it to the cash tab").
const mdue = await pg.evaluate(() => {
  const now = new Date(); const want = new Date(now.getFullYear(), now.getMonth() + 2, 20);
  window.__apExp = { next: { ms: 0, ap: 0, mat: 0, jobs: [] }, foll: { ms: 0, ap: 0, mat: 0, jobs: [] }, all: [{ job: 'A — 1 Road', mat: 1000 }, { job: 'B — 2 Road', mat: 2500 }] };
  renderMatDue();
  const rows = Array.from(document.querySelectorAll('#cash-matdue-tbl tbody tr')).map(r => r.textContent.trim());
  return { when: document.getElementById('cash-matdue-when').textContent, want: want.getDate() + ' ' + FG_MONTHS[want.getMonth()], total: document.getElementById('cash-matdue-total').textContent, rows, onCash: !!document.querySelector('#page-cash #cash-matdue-card'), onDash: !!document.querySelector('#page-dash #cash-matdue-card') };
});
check('the Cash tab carries Materials likely due the 20th of the month after next, biggest first, and the Command Centre does not', mdue.when.startsWith(mdue.want) && mdue.total === '$3.5k' && mdue.rows.length === 3 && /^B/.test(mdue.rows[0]) && mdue.onCash && !mdue.onDash, JSON.stringify(mdue));
await ctx.close();
await b.close();

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
