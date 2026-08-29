// The Inbox tab: Missive for a roofing office. This suite drives the
// three-pane mail client with route stubs — list and unread states,
// the sandboxed conversation view with blocked remote images, reply,
// archive/snooze, compose, the guided account setup, and the
// Business-tier teaser.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();

function mkData(){
  const accounts = [
    { id: 'acc1', label: 'Office', email: 'office@floodroofing.co.nz', provider: 'gmail', shared: true, status: 'ok', last_error: '' },
    { id: 'acc2', label: 'Aron', email: 'aron@floodroofing.co.nz', provider: 'gmail', shared: false, status: 'error', last_error: 'IMAP LOGIN failed' },
  ];
  const threads = [
    { id: 't1', account_id: 'acc1', subject: 'Re-roof quote for 148 Horeke Road', participants: ['brian@lewis.co.nz', 'office@floodroofing.co.nz'],
      snippet: 'It leaks over the kitchen.', last_date: '2026-08-28T02:00:00Z', status: 'inbox', unread: true,
      category: 'lead', urgency: 92, job_id: 'j1', ai_draft: 'Hi Brian,\n\nWe can look on Tuesday.\n\nFlood Roofing',
      msg_count: 2, account_email: 'office@floodroofing.co.nz', account_label: 'Office' },
    { id: 't2', account_id: 'acc1', subject: 'Price list update', participants: ['sales@supplier.co.nz'],
      snippet: 'New prices attached.', last_date: '2026-08-28T03:00:00Z', status: 'inbox', unread: false,
      category: 'supplier', urgency: 25, job_id: null, ai_draft: null,
      msg_count: 1, account_email: 'office@floodroofing.co.nz', account_label: 'Office' },
    { id: 't3', account_id: 'acc1', subject: 'Old enquiry', participants: ['x@y.nz'],
      snippet: 'Sorted long ago.', last_date: '2026-07-01T00:00:00Z', status: 'archived', unread: false,
      msg_count: 1, account_email: 'office@floodroofing.co.nz', account_label: 'Office' },
  ];
  const messages = {
    t1: [
      { from_addr: 'brian@lewis.co.nz', from_name: 'Brian Lewis', date: '2026-08-27T01:00:00Z',
        body_text: 'Hi, keen on a quote.', body_html: '', attachments: [] },
      { from_addr: 'brian@lewis.co.nz', from_name: 'Brian Lewis', date: '2026-08-28T02:00:00Z',
        body_text: '', body_html: '<p>It leaks over the kitchen.</p><img data-rsrc="https://photos.example/roof.jpg">',
        attachments: [{ name: 'leak.jpg', size: 5000, type: 'image/jpeg' }] },
    ],
    t2: [{ from_addr: 'sales@supplier.co.nz', from_name: 'Steel Supplier', date: '2026-08-28T03:00:00Z',
      body_text: 'New prices attached.', body_html: '', attachments: [] }],
  };
  return { accounts, threads, messages };
}

async function boot(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  const calls = [];
  const data = mkData();
  if (opts.noAccounts){ data.accounts = []; data.threads = []; }
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/inbox\/threads\?/.test(u) && m === 'GET'){
      calls.push(['GET threads', u]);
      const status = (u.match(/status=(\w+)/) || [])[1] || 'inbox';
      const th = data.threads.filter(t => status === 'all' || t.status === status);
      return json({ threads: th, accounts: data.accounts, ai_enabled: true });
    }
    if (/\/inbox\/threads\/t\d+\/draft$/.test(u)){
      calls.push(['draft', u.split('/')[u.split('/').length - 2]]);
      return json({ draft: 'Thanks — noted, we will confirm pricing.\n\nFlood Roofing' });
    }
    if (/\/inbox\/threads\/t\d+$/.test(u) && m === 'GET'){
      const id = u.split('/').pop();
      return json({ thread: data.threads.find(t => t.id === id), messages: data.messages[id] || [] });
    }
    if (/\/inbox\/threads\/t\d+$/.test(u) && m === 'PATCH'){
      calls.push(['PATCH ' + u.split('/').pop(), JSON.parse(r.request().postData() || '{}')]);
      return json({});
    }
    if (/\/inbox\/threads\/t\d+\/reply$/.test(u)){
      calls.push(['reply', JSON.parse(r.request().postData() || '{}')]);
      return json({ ok: true, message: {} });
    }
    if (/\/inbox\/compose$/.test(u)){
      calls.push(['compose', JSON.parse(r.request().postData() || '{}')]);
      return json({ ok: true, message: {} });
    }
    if (/\/inbox\/accounts$/.test(u) && m === 'POST'){
      calls.push(['connect', JSON.parse(r.request().postData() || '{}')]);
      return json({ id: 'acc9', label: 'Office', email: 'office@x.nz', shared: true, status: 'ok', last_error: '' });
    }
    if (/\/inbox\//.test(u)) return json({ ok: true });
    if (/fergus/i.test(u)) return r.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((o) => {
    // Init scripts also run inside the sandboxed srcdoc frames the inbox
    // renders email into — localStorage throws there, by design.
    try {
      localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
      localStorage.setItem('fr_settings', 'null');
      if (o.lockedPlan) localStorage.setItem('fr_company',
        JSON.stringify({ id: 'co', role: 'owner', plan: 'team', limits: { inbox: false } }));
      else localStorage.removeItem('fr_company');
    } catch (e) {}
  }, opts);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => gotoTab('inbox'));
  await pg.waitForTimeout(800);
  return { ctx, pg, calls };
}

// ── the inbox, unlocked ───────────────────────────────────────────
let { ctx, pg, calls } = await boot();
let v = await pg.evaluate(() => ({
  wrap: getComputedStyle(document.getElementById('ibxWrap')).display !== 'none',
  chips: document.querySelectorAll('#ibxStatusChips .ibx-chip').length,
  rows: document.querySelectorAll('.ibx-row').length,
  unread: document.querySelectorAll('.ibx-row.unread').length,
  setup: getComputedStyle(document.getElementById('ibxSetupCard')).display === 'none',
}));
check('the inbox renders its status chips and thread list',
  v.wrap && v.chips === 4 && v.rows === 2 && v.unread === 1 && v.setup, JSON.stringify(v));

// The AI's sort shows on the rows and in the controls.
v = await pg.evaluate(() => ({
  urg: (document.querySelector('[data-ibxthread="t1"] [data-urg]') || {}).textContent,
  lead: /Lead/.test(document.querySelector('[data-ibxthread="t1"]').textContent),
  draftStar: /✨/.test(document.querySelector('[data-ibxthread="t1"]').textContent),
  sortBtn: getComputedStyle(document.getElementById('ibxSortBtn')).display !== 'none',
}));
check('a hot lead wears its urgency, category and waiting-draft badges',
  v.urg === '⚡92' && v.lead && v.draftStar && v.sortBtn, JSON.stringify(v));
await pg.selectOption('#ibxCatSel', 'supplier');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.querySelectorAll('.ibx-row').length);
check('the category picker filters the list', v === 1, v + ' rows');
await pg.selectOption('#ibxCatSel', '');
await pg.waitForTimeout(200);
calls.length = 0;
await pg.evaluate(() => document.getElementById('ibxSortBtn').click());
await pg.waitForTimeout(300);
v = calls.find(c => c[0] === 'GET threads');
check('the sort toggle asks the server for newest-first', !!v && /sort=date/.test(v[1]), v && v[1]);
await pg.evaluate(() => document.getElementById('ibxSortBtn').click());
await pg.waitForTimeout(300);

// Open the unread lead.
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({
  subj: /Horeke/.test(document.getElementById('ibxConv').textContent),
  frames: document.querySelectorAll('.ibx-msg iframe').length,
  sandboxed: !!document.querySelector('.ibx-msg iframe[sandbox]'),
  blockedBtn: !!document.querySelector('[data-ibximg]'),
  srcdoc: (document.querySelector('.ibx-msg iframe') || {}).getAttribute
    ? document.querySelector('.ibx-msg iframe').getAttribute('srcdoc') : '',
  attach: /leak\.jpg/.test(document.getElementById('ibxConv').textContent),
}));
check('a conversation opens with its HTML in a sandboxed frame',
  v.subj && v.frames === 1 && v.sandboxed && v.attach, JSON.stringify({ f: v.frames, sb: v.sandboxed }));
check('…remote images blocked until asked',
  v.blockedBtn && /data-rsrc/.test(v.srcdoc) && !/ src="https:/.test(v.srcdoc));
let read = calls.find(c => c[0] === 'PATCH t1' && c[1].unread === false);
check('opening it marks the thread read', !!read, JSON.stringify(read));
v = await pg.evaluate(() => ({
  strip: !!document.getElementById('ibxDraftStrip'),
  jobChip: !!document.querySelector('[data-ibxjob="j1"]'),
}));
check('the hot lead opens with its suggested reply and job link', v.strip && v.jobChip, JSON.stringify(v));
await pg.evaluate(() => document.getElementById('ibxUseDraft').click());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => document.getElementById('ibxReplyBody').value);
check('"Use it" drops the draft into the reply box — nothing sent', /Tuesday/.test(v), v.slice(0, 40));
await pg.evaluate(() => { document.getElementById('ibxReplyBody').value = ''; });

await pg.evaluate(() => document.querySelector('[data-ibximg]').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.querySelector('.ibx-msg iframe').getAttribute('srcdoc'));
check('Load images swaps the blocked sources live', /src="https:\/\/photos\.example\/roof\.jpg"/.test(v));

// Reply.
calls.length = 0;
await pg.fill('#ibxReplyBody', 'Hi Brian — Tuesday suits us.');
await pg.evaluate(() => _ibxReplySend());
await pg.waitForTimeout(500);
let rep = calls.find(c => c[0] === 'reply');
check('the reply posts exactly what was written',
  !!rep && /Tuesday suits/.test(rep[1].body_text), JSON.stringify(rep && rep[1]));

// The supplier thread has no waiting draft — draft one on demand.
await pg.evaluate(() => document.querySelector('[data-ibxthread="t2"]').click());
await pg.waitForTimeout(500);
calls.length = 0;
await pg.evaluate(() => _ibxDraft());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.getElementById('ibxReplyBody').value);
check('✍ Draft a reply asks the AI and fills the box for review',
  calls.some(c => c[0] === 'draft') && /confirm pricing/.test(v), v.slice(0, 40));

// Archive.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-ibxact="archive"]').click());
await pg.waitForTimeout(400);
let arch = calls.find(c => /^PATCH t2/.test(c[0]));
check('Archive files the thread', !!arch && arch[1].status === 'archived', JSON.stringify(arch && arch[1]));

// Snooze via the menu.
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(500);
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-ibxact="snooze"]').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => [...document.querySelectorAll('.sched-menu button')].map(x => x.textContent));
check('Snooze offers tomorrow / Monday / a week', v.length === 3 && /Tomorrow/.test(v[0]), JSON.stringify(v));
await pg.evaluate(() => document.querySelectorAll('.sched-menu button')[0].click());
await pg.waitForTimeout(400);
let sn = calls.find(c => /^PATCH t1/.test(c[0]) && c[1].status === 'snoozed');
check('…and picking one snoozes with a wake time',
  !!sn && /^\d{4}-\d{2}-\d{2}T/.test(sn[1].snoozed_until || ''), JSON.stringify(sn && sn[1]));

// Compose.
calls.length = 0;
await pg.evaluate(() => _ibxComposeOpen());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('ibxComposeModal')).display !== 'none',
  froms: document.querySelectorAll('#ibxCFrom option').length,
}));
check('Compose opens with the connected accounts to send from', v.shown && v.froms === 2, JSON.stringify(v));
await pg.fill('#ibxCTo', 'new@customer.co.nz');
await pg.fill('#ibxCSubject', 'Your roofing quote');
await pg.fill('#ibxCBody', 'Quote attached shortly.');
await pg.evaluate(() => _ibxComposeSend());
await pg.waitForTimeout(400);
let comp = calls.find(c => c[0] === 'compose');
check('…and Send posts the email from the picked account',
  !!comp && comp[1].to === 'new@customer.co.nz' && comp[1].account_id === 'acc1', JSON.stringify(comp && comp[1]).slice(0, 90));

// Accounts modal: guided setup.
await pg.evaluate(() => _ibxAcctOpen());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  listed: document.querySelectorAll('#ibxAcctList [data-ibxsync]').length,
  err: /IMAP LOGIN failed/.test(document.getElementById('ibxAcctList').textContent),
  provs: document.querySelectorAll('#ibxProvPick [data-ibxprov]').length,
}));
check('the accounts modal lists both accounts (one showing its error) and four providers',
  v.listed === 2 && v.err && v.provs === 4, JSON.stringify(v));
await pg.evaluate(() => document.querySelector('[data-ibxprov="gmail"]').click());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({
  steps: document.querySelectorAll('#ibxProvSteps li').length,
  imap: document.getElementById('ibxAImapHost').value,
  hostsHidden: getComputedStyle(document.getElementById('ibxAHosts')).display === 'none',
}));
check('picking Gmail shows the app-password steps and prefills the hosts',
  v.steps === 3 && v.imap === 'imap.gmail.com' && v.hostsHidden, JSON.stringify(v));
calls.length = 0;
await pg.fill('#ibxAEmail', 'office@floodroofing.co.nz');
await pg.fill('#ibxAPass', 'abcd efgh ijkl mnop');
await pg.evaluate(() => _ibxAcctConnect());
await pg.waitForTimeout(400);
let conn = calls.find(c => c[0] === 'connect');
check('Connect sends the guided config with the app password',
  !!conn && conn[1].imap_host === 'imap.gmail.com' && conn[1].smtp_host === 'smtp.gmail.com' &&
  conn[1].password === 'abcd efgh ijkl mnop' && conn[1].shared === true, JSON.stringify(conn && Object.keys(conn[1])));
await ctx.close();

// ── no accounts yet ───────────────────────────────────────────────
({ ctx, pg, calls } = await boot({ noAccounts: true }));
v = await pg.evaluate(() => getComputedStyle(document.getElementById('ibxSetupCard')).display !== 'none');
check('a fresh company sees the connect-your-first-account card', v === true);
await ctx.close();

// ── locked plan ───────────────────────────────────────────────────
({ ctx, pg, calls } = await boot({ lockedPlan: true }));
v = await pg.evaluate(() => ({
  teaser: getComputedStyle(document.getElementById('ibxLockedCard')).display !== 'none',
  wrap: getComputedStyle(document.getElementById('ibxWrap')).display === 'none',
  text: document.getElementById('ibxLockedCard').textContent,
}));
check('a plan without the inbox sees the Business teaser', v.teaser && v.wrap && /Business/.test(v.text));
check('…and never asks the server for mail', !calls.some(c => c[0] === 'GET threads'), JSON.stringify(calls));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
