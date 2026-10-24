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
  const r = await pg.evaluate(() => ({ open: document.getElementById('cash-modal').classList.contains('open'), n: document.querySelectorAll('#cmodal-body .cash-detail').length }));
  if (!r.open || !r.n) bad.push(i + ':' + JSON.stringify(r));
  await pg.evaluate(() => closeCashDetail());
}
check('every Cash at a glance box (' + boxes + ') opens its detail', boxes === 6 && bad.length === 0, bad.join(' '));

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
const lead = await pg.evaluate(() => {
  const j = document.querySelectorAll('#bc-list .bcm-job')[1]; j.click(); const open = j.classList.contains('open');
  const sel = j.querySelector('.bcm-more select.lr-sel'); if (!sel) return { open, sel: false };
  sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { open, sel: true, set: Object.values(leadOverride).includes(sel.options[1].value) };
});
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

// Workload: Per active job sits straight under the hero, and on a phone it is one row a job — tick, job number
// over the short address, then the figures — with no sideways scroll (2026-10-25, the owner).
await pg.evaluate(() => go('work')); await pg.waitForTimeout(400);
const wk = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('#page-work > .card')];
  const vis = s => { const e = document.querySelector(s); return !!(e && e.getBoundingClientRect().height > 0); };
  const rows = [...document.querySelectorAll('#work-list .wkm-row:not(.wkm-hd)')], host = document.getElementById('work-list');
  const r0 = rows[0], j0 = fwJobs.find(j => j.id === r0.dataset.id);
  return { second: cards[1] && cards[1].id, list: vis('#work-list'), table: vis('.wk-tbl-wrap'), n: rows.length, want: fwJobs.length,
    no: r0.querySelector('.wkm-id b').textContent, addr: r0.querySelector('.wkm-id span').textContent, jobNo: j0 && j0.jobNo,
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
check('…and Rev / person beside it', crew.sepRev === 'Rev / person');
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
check('…and Last Month starts open beside Cash at a glance', await pg.evaluate(() => { const d = document.querySelector('.d-last details.acc'); return !!(d && d.open); }));
await pg.evaluate(() => go('bc')); await pg.waitForTimeout(400);
const bcd = await pg.evaluate(() => ({ table: document.querySelector('.bc-tbl-wrap').getBoundingClientRect().height > 0,
  list: document.getElementById('bc-list').getBoundingClientRect().height > 0,
  heads: document.querySelectorAll('#bc-tbl tr.bc-mhead').length, subs: document.querySelectorAll('#bc-tbl tr.bc-msub').length }));
check('on a computer Back Cost keeps the full table, with a band and a total for every month', bcd.table && !bcd.list && bcd.heads >= 2 && bcd.heads === bcd.subs, JSON.stringify(bcd));
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
await ctx.close();
await b.close();

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
