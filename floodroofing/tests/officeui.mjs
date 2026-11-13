// THE OFFICE MENUS, the app half (2026-11-13, the owner: "these new menus
// should be along the top of the screen ... jobs ... supplier invoices ... a
// GPS map ... the schedule, the settings, and the request a fix ... remain
// always in the left menu on every single tab ... a financials tab ... only for
// my account first"). The real app.html with the API stubbed.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }
const b = await chromium.launch();

const INV = [
  { id: 'i1', source: 'email', from_addr: 'accounts@ri.co.nz', subject: 'Invoice', received_at: '2026-11-12T01:00:00Z', file_name: 'RI-1.pdf', mime: 'application/pdf', storage_path: 'c1/i1/RI-1.pdf',
    status: 'read', kind: 'invoice', supplier: 'Roofing Industries', inv_number: 'RI-1', inv_date: '2026-11-10', subtotal: 2400, gst: 360, total: 2760, refs: ['3341'], description: 'Corrugate',
    job_id: 'j1', job_label: '3341 — Doug Rodgers — 704A SH10', alloc: 'auto', alloc_why: 'Job number 3341 is on the invoice', suggest: [], xero: {} },
  { id: 'i2', source: 'upload', from_addr: 'aron@floodroofing.co.nz', received_at: '2026-11-13T01:00:00Z', file_name: 'carters.pdf', mime: 'application/pdf', storage_path: 'c1/i2/c.pdf',
    status: 'read', kind: 'invoice', supplier: 'Carters', inv_number: 'C-9', inv_date: '2026-11-12', subtotal: 100, gst: 15, total: 115, refs: ['Cash sale'], description: 'Screws',
    job_id: null, job_label: '', alloc: '', alloc_why: '', suggest: [], xero: {} },
];
const JOBS = [
  { id: 'j1', no: '3341', client: 'Doug Rodgers', addr: '704A SH10', acceptedEx: 10000, acceptedAt: '2026-11-05T00:00:00Z', quoteEx: 10000, cost: 2400, invoices: [{ id: 'i1', supplier: 'Roofing Industries', number: 'RI-1', date: '2026-11-10', ex: 2400 }] },
  { id: 'j2', no: '3351', client: 'Arran Simpson', addr: '12 Kauri Lane', acceptedEx: null, quoteEx: 8000, cost: 0, invoices: [] },
];
const months = []; for (let i = 13; i >= 1; i--){ const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push({ month: d.toISOString().slice(0, 7), income: 100000, cos: 60000, gross: 40000, expenses: 25000, net: 15000 }); }

async function boot(enabled){
  const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  const puts = [];
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
    const J = (o, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/supinv/enabled') return J({ enabled });
    if (!enabled && /^\/(supinv|costing|xero)/.test(p)) return J({ error: 'off', code: 'SUPINV_OFF' }, 403);
    if (p === '/supinv/address') return J({ ok: true, address: 'floodroofing-ab12@invoices.roofmap.co.nz', receiving: true });
    if (p === '/supinv' && m === 'GET') return J({ ok: true, invoices: INV, xero: { connected: true, org: 'Flood Roofing Ltd' } });
    if (/^\/supinv\/i\d$/.test(p)) return J({ ok: true, invoice: INV.find(x => '/supinv/' + x.id === p) });
    if (/\/assign$/.test(p)) { const body = JSON.parse(r.request().postData() || '{}'); puts.push(body);
      return J({ ok: true, invoice: Object.assign({}, INV[1], { job_id: body.jobId, job_label: '3351 — Arran Simpson — 12 Kauri Lane', alloc: 'manual', alloc_why: 'Assigned by aron@floodroofing.co.nz' }) }); }
    if (p === '/costing/jobs') return J({ ok: true, jobs: JOBS });
    if (p === '/xero/status') return J({ ok: true, configured: true, connected: true, org: 'Flood Roofing Ltd', account: '300', status: 'DRAFT' });
    if (p === '/xero/pnl') return J({ ok: true, connected: true, org: 'Flood Roofing Ltd', months });
    if (p === '/crew/office/now') return J({ ok: true, today: '2026-11-13', sites: [{ lat: -35.2, lng: 173.9, row_id: 'r1', client: 'Arran Simpson', site: '12 Kauri Lane' }],
      people: [{ id: 'u3', name: 'Nick Example', crew: 'Crew 1', crew_id: 'crew1', colour: '#f87d20', booked: true, status: 'on', status_at: new Date().toISOString(),
        status_row: { client: 'Arran Simpson', site: '12 Kauri Lane' }, last: { lat: -35.2, lng: 173.9, at: new Date().toISOString() }, track: [] }] });
    if (p === '/crew/office/hours') return J({ ok: true, from: u.searchParams.get('from'), to: u.searchParams.get('to'), rows: { r1: { client: 'Arran Simpson', site: '12 Kauri Lane' } },
      people: [{ id: 'u3', name: 'Nick Example', crew_id: 'crew1', days: [{ date: u.searchParams.get('from'), onsite: { r1: 7.5 }, onsiteTotal: 7.5, travel: 1.25, total: 8.75, open: false, first: '2026-11-09T19:00:00Z', last: '2026-11-10T04:00:00Z' }] }] });
    if (p === '/crew/office/members' && m === 'GET') return J({ ok: true, crews: [{ id: 'crew1', name: 'Crew 1' }, { id: 'crew2', name: 'Crew 2' }],
      members: [{ id: 'u1', email: 'aron@floodroofing.co.nz', crew_id: '' }, { id: 'u3', email: 'nick@floodroofing.co.nz', name: 'Nick Example', crew_id: 'crew1' }] });
    if (/^\/crew\/office\/members\//.test(p)) { puts.push({ crew: JSON.parse(r.request().postData() || '{}'), uid: p.split('/').pop() }); return J({ ok: true }); }
    if (p === '/crew/office/settings' && m === 'GET') return J({ ok: true, checklists: [] });
    if (p === '/crew/office/settings' && m === 'PUT') { const bd = JSON.parse(r.request().postData() || '{}'); puts.push({ lists: bd.checklists }); return J(Object.assign({ ok: true }, bd)); }
    return J([]);
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_user', JSON.stringify({ id: 'u1', email: 'aron@floodroofing.co.nz' })); });
  await pg.goto('file://' + _j(DIR, 'app.html'));
  await pg.waitForTimeout(3200);
  await pg.evaluate(() => { ['setupWizard', '_rsModal', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); }); });
  return { pg, errs, puts };
}
const vis = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'); }, sel);

const { pg, errs, puts } = await boot(true);
const bar = await pg.evaluate(() => [...document.querySelectorAll('#topMenu button')].map(x => x.textContent));
check('the top bar is there for the owner’s login: Jobs, Supplier Invoices, Job Costing, Financials, GPS Map',
  JSON.stringify(bar) === '["Jobs","Supplier Invoices","Job Costing","Financials","GPS Map"]' && await vis(pg, '#topMenu'), JSON.stringify(bar));
const tb = await pg.evaluate(() => { const bar = document.getElementById('globalTopBar'), r = bar.getBoundingClientRect();
  return { inBar: !!bar.querySelector('#topMenu'), h: Math.round(r.height), bg: getComputedStyle(bar).backgroundColor,
    labels: ['gtbAi', 'gtbChatBtn', 'gtbTasksBtn', 'gtbTodoBtn'].map(id => { const b = document.getElementById(id); return b ? [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim() : null; }),
    badges: !!document.getElementById('gtbTasksBadge') && !!document.getElementById('gtbTodoBadge') && !!document.getElementById('gtbBellBadge') }; });
check('the menu and the AI / chat / bell / tasks / to-do buttons share ONE slim navy bar', tb.inBar && tb.h <= 48 && /rgb\(10, 22, 40\)/.test(tb.bg), JSON.stringify(tb));
check('…the buttons are short, their badges kept', JSON.stringify(tb.labels) === '["✨ AI","💬 Chat","📋 Tasks","📝 To do"]' && tb.badges, JSON.stringify(tb));
check('…on Jobs the left menu is the app as it was', await vis(pg, '#navRoofBtn') && await vis(pg, '#navQuoteBtn'), '');
await pg.click('#topMenu button[data-top="supinv"]');
await pg.waitForTimeout(500);
check('Supplier Invoices opens its tab and lights its button', await pg.evaluate(() => document.getElementById('tab-supinv').classList.contains('active') &&
  document.querySelector('#topMenu button.on').getAttribute('data-top') === 'supinv'), '');
check('…the left menu keeps Schedule, Settings and Request a Fix, and drops the job tabs',
  await vis(pg, '#navScheduleBtn') && await vis(pg, '#navSettingsBtn') && await vis(pg, '#navFeedbackBtn') && !(await vis(pg, '#navRoofBtn')) && !(await vis(pg, '#navQuoteBtn')), '');
const tx = await pg.evaluate(() => document.getElementById('supinvRoot').innerText);
check('the invoice address and both ways of getting invoices there are shown', /floodroofing-ab12@invoices\.roofmap\.co\.nz/.test(tx) || await pg.evaluate(() => /floodroofing-ab12/.test(document.getElementById('ofAddr').textContent)), tx.slice(0, 200));
check('it opens on the ones to assign: Carters, not the one already on job 3341', /Carters/.test(tx) && !/Roofing Industries/.test(tx), '');
await pg.click('.of-chip:has-text("All")');
const tx2 = await pg.evaluate(() => document.getElementById('supinvRoot').innerText);
check('All shows the one put on 3341 by itself, and why', /Roofing Industries/.test(tx2) && /Auto · Job number 3341/.test(tx2) && /\$2,760\.00/.test(tx2), tx2.slice(0, 400));
await pg.click('.of-chip:has-text("To assign")');
await pg.fill('.of-assign input', '3351');
await pg.waitForTimeout(150);
const drop = await pg.evaluate(() => document.querySelector('.of-drop').innerText);
check('the Assign box searches the jobs by number', /3351 — Arran Simpson — 12 Kauri Lane/.test(drop) && !/3341/.test(drop), drop);
await pg.fill('.of-assign input', 'kauri');
await pg.waitForTimeout(100);
check('…and by address', /3351/.test(await pg.evaluate(() => document.querySelector('.of-drop').innerText)), '');
await pg.dispatchEvent('.of-drop div', 'mousedown');
await pg.waitForTimeout(300);
check('picking one puts the invoice on that job', puts.length === 1 && puts[0].jobId === 'j2', JSON.stringify(puts));
await pg.click('.of-chip:has-text("All")');
await pg.click('#supinvRoot tr.click >> nth=0');
await pg.waitForTimeout(300);
const sum = await pg.evaluate(() => (document.getElementById('ofSumModal') || {}).innerText || '');
check('clicking an invoice opens its summary: what it is, the job, the date, the money, Open PDF', /Excl\. GST/.test(sum) && /Total/.test(sum) && /Open PDF/.test(sum) && /Invoice date/.test(sum), sum.slice(0, 300));
await pg.evaluate(() => document.getElementById('ofSumModal').remove());

await pg.click('#topMenu button[data-top="costing"]');
await pg.waitForTimeout(400);
const ct = await pg.evaluate(() => document.getElementById('costingRoot').innerText);
check('Job Costing lists the job with its price, supplier costs and what is left', /3341/.test(ct) && /\$10,000/.test(ct) && /\$2,400/.test(ct) && /\$7,600/.test(ct) && /76%/.test(ct), ct.slice(0, 500));
await pg.click('#topMenu button[data-top="finance"]');
await pg.waitForTimeout(500);
const ft = await pg.evaluate(() => document.getElementById('financeRoot').innerText);
check('Financials shows Xero’s P&L: rolling 3- and 6-month averages, the financial years, the months', /Rolling 3-month average/i.test(ft) && /Rolling 6-month average/i.test(ft) && /FY\d\d/.test(ft) && /P&L by month/i.test(ft) && /\$100,000/.test(ft), ft.slice(0, 400));
await pg.click('#topMenu button[data-top="gps"]');
await pg.waitForTimeout(600);
const gt = await pg.evaluate(() => document.getElementById('gpsRoot').innerText);
check('GPS Map gives the crew app’s link and the 7–7 booked-day rule', /\/crew/.test(gt) && /only recorded 7 am – 7 pm on days/.test(gt), gt.slice(0, 300));
check('…lists who is where: Nick, Crew 1, on site at Arran Simpson', /Nick Example/.test(gt) && /On site — Arran Simpson/.test(gt) && /Booked/.test(gt), gt.slice(0, 600));
check('…the week’s hours, on site + travel', /7:30 \+ 1:15/.test(gt) && /8:45/.test(gt), '');
await pg.selectOption('select[data-crew-uid="u1"]', 'crew2'); await pg.waitForTimeout(200);
check('…a person is put on a crew from here', puts.some(x => x.uid === 'u1' && x.crew && x.crew.crew_id === 'crew2'), JSON.stringify(puts));
await pg.click('text=+ Add a checklist'); await pg.click('#ofListSave'); await pg.waitForTimeout(200);
check('…and the first checklist starts from a sensible set and saves', puts.some(x => x.lists && x.lists[0] && x.lists[0].name === 'Before we start' && x.lists[0].items.length === 3), JSON.stringify(puts.slice(-1)));
await pg.click('#navScheduleBtn');
await pg.waitForTimeout(300);
check('Schedule from the left menu keeps the slim left menu', !(await vis(pg, '#navRoofBtn')) && await vis(pg, '#navSettingsBtn'), '');
await pg.click('#topMenu button[data-top="jobs"]');
await pg.waitForTimeout(300);
check('Jobs brings the job tabs back', await vis(pg, '#navRoofBtn') && await vis(pg, '#navQuoteBtn') && await pg.evaluate(() => document.body.getAttribute('data-tab') === 'select'), '');
check('no page errors', errs.length === 0, errs.join(' | '));

const other = await boot(false);
check('…and keeps the long button names', await other.pg.evaluate(() => /AI Assistant/.test(document.getElementById('globalTopBar').textContent)), '');
check('another login gets no top bar and no new tabs', !(await vis(other.pg, '#topMenu')) && await vis(other.pg, '#navRoofBtn') &&
  await other.pg.evaluate(() => !document.getElementById('tab-supinv')), '');
check('…and no page errors', other.errs.length === 0, other.errs.join(' | '));

await b.close();
console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
