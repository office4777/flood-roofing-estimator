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
  const members = [
    { id: 'u1', name: 'Aron', email: 'aron@floodroofing.co.nz', role: 'owner' },
    { id: 'u2', name: 'Lizzie', email: 'lizzie@floodroofing.co.nz', role: 'member' },
  ];
  const tasks = [
    { id: 'tk1', title: 'Reply: Re-roof quote — Brian Lewis', urgency: 88, due_date: '2026-08-28',
      assignee_user_id: 'u2', done: false, thread_id: 't1', job_id: 'j1' },
    { id: 'tk2', title: 'Order the ridge flashings', urgency: 20, due_date: null,
      assignee_user_id: null, done: false, thread_id: null, job_id: null },
    { id: 'tk3', title: 'Ring the bank about the ute', urgency: null, due_date: null,
      assignee_user_id: 'u1', done: false, thread_id: null, job_id: null, personal: true },
  ];
  return { accounts, threads, messages, members, tasks };
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
    if (/\/inbox\/chat\/channels$/.test(u) && m === 'GET'){
      return json({ channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'jobs' }], members: data.members });
    }
    if (/\/inbox\/chat\/messages\?channel_id=c1/.test(u) && m === 'GET'){
      return json({ messages: [
        { id: 'cm1', user_id: 'u1', body: 'Morning — @Lizzie the Horeke job is on for Monday.', created_at: '2026-08-29T08:00:00Z' },
        { id: 'cm2', user_id: 'u2', body: 'On it.', created_at: '2026-08-29T08:05:00Z' },
      ] });
    }
    if (/\/inbox\/chat\/messages\?thread_id=t1/.test(u) && m === 'GET'){
      return json({ messages: [{ id: 'cm3', user_id: 'u2', body: 'He rang too — wants us before the rain.', created_at: '2026-08-29T08:10:00Z' }] });
    }
    if (/\/inbox\/chat\/messages\?/.test(u) && m === 'GET'){ return json({ messages: [] }); }
    if (/\/inbox\/chat\/messages$/.test(u) && m === 'POST'){
      const pb = JSON.parse(r.request().postData() || '{}');
      calls.push(['chatpost', pb]);
      return json(/order/i.test(pb.body || '')
        ? { ok: true, task_suggest: { title: 'Order the Modspace flashings', urgency: 65 } }
        : { ok: true });
    }
    if (/\/inbox\/tasks$/.test(u) && m === 'GET'){
      return json({ tasks: data.tasks, members: data.members, ai_enabled: true });
    }
    if (/\/inbox\/tasks$/.test(u) && m === 'POST'){
      calls.push(['newtask', JSON.parse(r.request().postData() || '{}')]);
      return json({ id: 'tk9', title: 'x', assignee_user_id: 'u2', done: false });
    }
    if (/\/inbox\/tasks\/tk\d+$/.test(u) && m === 'PATCH'){
      calls.push(['PATCH task ' + u.split('/').pop(), JSON.parse(r.request().postData() || '{}')]);
      return json({});
    }
    if (/\/inbox\/threads\/t\d+\/task$/.test(u) && m === 'POST'){
      calls.push(['emailtask', u.split('/')[u.split('/').length - 2]]);
      return json({ id: 'tk8', assignee_user_id: 'u2' });
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
    if (/\/inbox\/assistant$/.test(u) && m === 'POST'){
      const ab = JSON.parse(r.request().postData() || '{}');
      calls.push(['assistant', ab]);
      const ins = ab.instruction || '';
      if (/rundown/i.test(ins)) return json({ action: 'answer', text: 'Two open tasks.\nOne hot lead waiting.' });
      if (/open the schedule/i.test(ins)) return json({ action: 'goto', tab: 'schedule' });
      if (/tell the team/i.test(ins)) return json({ action: 'chat', body: 'Yard closes early on Friday.' });
      if (/archive/i.test(ins)) return json({ action: 'threads', op: 'archive', count: 2 });
      if (/reply/i.test(ins)) return json({ action: 'reply', thread_id: 't1', body: 'No worries — thanks for the update.' });
      if (/task/i.test(ins)) return json({ action: 'task', task: { id: 'tk7', title: 'Check over job #3099', assignee_user_id: 'u2',
        urgency: 45, done: false, personal: false, thread_id: null, job_id: null } });
      return json({ action: 'email', to: 'suzie@customer.co.nz', subject: 'Colour selection — job 3342',
        body: 'Hi Suzie,\n\nCould you send through your colour selection for job 3342?\n\nFlood Roofing' });
    }
    if (/\/inbox\/ai-compose$/.test(u) && m === 'POST'){
      calls.push(['aicompose', JSON.parse(r.request().postData() || '{}')]);
      return json({ to: 'steve@roofingindustries.co.nz', subject: 'Delivery update — job 3057',
        body: 'Hi Steve,\n\nCould you give us an update on the delivery for job 3057?\n\nFlood Roofing' });
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

// Gmail-style thread: the older message sits collapsed to a one-line header
// with a snippet; clicking the header opens it, clicking again re-folds it.
v = await pg.evaluate(() => {
  const first = document.querySelector('[data-ibxmsg="0"]'), last = document.querySelector('[data-ibxmsg="1"]');
  const bodyHidden = el => { const b = el.querySelector('iframe,.txt'); return !b || getComputedStyle(b).display === 'none'; };
  return {
    firstFolded: first.classList.contains('clpsd') && bodyHidden(first),
    snippet: getComputedStyle(first.querySelector('.msnip')).display !== 'none' && /keen on a quote/.test(first.textContent),
    lastOpen: !last.classList.contains('clpsd') && !bodyHidden(last),
  };
});
check('older messages open collapsed with a snippet, the newest one open — like Gmail',
  v.firstFolded && v.snippet && v.lastOpen, JSON.stringify(v));
await pg.evaluate(() => document.querySelector('[data-ibxmsg="0"] [data-ibxtoggle]').click());
await pg.waitForTimeout(150);
v = await pg.evaluate(() => {
  const first = document.querySelector('[data-ibxmsg="0"]');
  return { open: !first.classList.contains('clpsd'), bodyShown: getComputedStyle(first.querySelector('.txt')).display !== 'none' };
});
check('clicking a collapsed header expands that message', v.open && v.bodyShown, JSON.stringify(v));
await pg.evaluate(() => document.querySelector('[data-ibxmsg="0"] [data-ibxtoggle]').click());
await pg.waitForTimeout(150);
v = await pg.evaluate(() => document.querySelector('[data-ibxmsg="0"]').classList.contains('clpsd'));
check('…and clicking again folds it back', v === true);
v = await pg.evaluate(() => ({
  strip: !!document.getElementById('ibxDraftStrip'),
  jobChip: !!document.querySelector('[data-ibxjob="j1"]'),
}));
check('the hot lead opens with its suggested reply and job link', v.strip && v.jobChip, JSON.stringify(v));
await pg.evaluate(() => document.getElementById('ibxUseDraft').click());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => document.getElementById('ibxReplyBody').innerText);
check('"Use it" drops the draft into the reply box — nothing sent', /Tuesday/.test(v), v.slice(0, 40));
await pg.evaluate(() => { document.getElementById('ibxReplyBody').innerText = ''; });

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
check('…as rich HTML too, from the thread\'s own account by default',
  !!rep && /Tuesday suits/.test(rep[1].body_html || '') && rep[1].account_id === 'acc1',
  JSON.stringify({ h: !!rep[1].body_html, a: rep[1].account_id }));

// Reply-from: pick the other account, format bar at hand.
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  fmtbar: !!document.querySelector('#ibxConv .ibx-fmtbar'),
  bold: /B/.test((document.querySelector('#ibxConv .ibx-fmtbar') || {}).textContent || ''),
  from: document.getElementById('ibxReplyFrom') && document.getElementById('ibxReplyFrom').options.length,
  sel: (document.getElementById('ibxReplyFrom') || {}).value,
}));
check('the reply carries a Gmail-style format bar and a From picker',
  v.fmtbar && v.bold && v.from === 2 && v.sel === 'acc1', JSON.stringify(v));
calls.length = 0;
await pg.evaluate(() => { document.getElementById('ibxReplyFrom').value = 'acc2'; });
await pg.evaluate(() => { document.getElementById('ibxReplyBody').innerHTML = '<b>Cheers</b> — will do.'; });
await pg.evaluate(() => _ibxReplySend());
await pg.waitForTimeout(500);
rep = calls.find(c => c[0] === 'reply');
check('…and sending from the other account carries the choice and the bold',
  !!rep && rep[1].account_id === 'acc2' && /<b>Cheers<\/b>/.test(rep[1].body_html || ''),
  JSON.stringify({ a: rep && rep[1].account_id }));

// The supplier thread has no waiting draft — draft one on demand.
await pg.evaluate(() => document.querySelector('[data-ibxthread="t2"]').click());
await pg.waitForTimeout(500);
calls.length = 0;
await pg.evaluate(() => _ibxDraft());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.getElementById('ibxReplyBody').innerText);
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

// ── the task board ────────────────────────────────────────────────
await pg.evaluate(() => _ibxTasksToggle());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('ibxTasksWrap')).display !== 'none',
  mailShown: document.getElementById('ibxMain').style.display !== 'none',
  cols: [...document.querySelectorAll('[data-tcol]')].map(c => c.getAttribute('data-tcol')),
  hotInLizzie: !!document.querySelector('[data-tcol="u2"] [data-task="tk1"]'),
  hotText: (document.querySelector('[data-task="tk1"]') || {}).textContent || '',
}));
check('the task board expands ABOVE the mail list — everything in one place',
  v.shown && v.mailShown && v.cols.join(',') === ',u1,u2', JSON.stringify(v.cols));
check("the AI's assignment and urgency show on the card",
  v.hotInLizzie && /⚡88/.test(v.hotText) && /📅 2026-08-28/.test(v.hotText), v.hotText.slice(0, 60));

// Add a task — the server (AI) picks the assignee.
calls.length = 0;
await pg.fill('#ibxTaskNew', 'Chase the Modspace deposit');
await pg.evaluate(() => _ibxTaskAdd());
await pg.waitForTimeout(400);
let nt = calls.find(c => c[0] === 'newtask');
check('typing a task posts it for AI assignment',
  !!nt && nt[1].title === 'Chase the Modspace deposit' && nt[1].assignee_user_id === undefined,
  JSON.stringify(nt && nt[1]));

// Re-assign through the card menu.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-task="tk1"]').click());
await pg.waitForTimeout(300);
await pg.evaluate(() => {
  [...document.querySelectorAll('.sched-menu button')].find(b => /Aron/.test(b.textContent)).click();
});
await pg.waitForTimeout(300);
let ra = calls.find(c => c[0] === 'PATCH task tk1');
check('handing a card to a teammate saves the new assignee',
  !!ra && ra[1].assignee_user_id === 'u1', JSON.stringify(ra && ra[1]));
v = await pg.evaluate(() => !!document.querySelector('[data-tcol="u1"] [data-task="tk1"]'));
check('…and the card moves columns instantly', v === true);

// Tick it done.
calls.length = 0;
await pg.evaluate(() => {
  const cb = document.querySelector('[data-tdone="tk1"]');
  cb.checked = true; cb.dispatchEvent(new Event('change'));
});
await pg.waitForTimeout(300);
let dn = calls.find(c => c[0] === 'PATCH task tk1');
check('ticking a task done saves it', !!dn && dn[1].done === true, JSON.stringify(dn && dn[1]));

// ➕ Task straight from an email.
await pg.evaluate(() => _ibxTasksToggle());
await pg.waitForTimeout(300);
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(500);
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-ibxact="task"]').click());
await pg.waitForTimeout(400);
let et = calls.find(c => c[0] === 'emailtask');
check('➕ Task turns the open email into a task', !!et && et[1] === 't1', JSON.stringify(et));

// ── internal notes on the open email ──────────────────────────────
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  strip: /customer never sees/.test(document.getElementById('ibxConv').textContent),
  note: /before the rain/.test((document.getElementById('ibxNotesList') || {}).textContent || ''),
  who: /Lizzie/.test((document.getElementById('ibxNotesList') || {}).textContent || ''),
}));
check('the email carries its internal notes strip, named and loaded',
  v.strip && v.note && v.who, JSON.stringify(v));
calls.length = 0;
await pg.fill('#ibxNoteInput', 'Troy can start early @Aron');
await pg.evaluate(() => _ibxNoteSend());
await pg.waitForTimeout(300);
let np = calls.find(c => c[0] === 'chatpost');
check('adding a note posts it to the thread — never to the customer',
  !!np && np[1].thread_id === 't1' && /Troy can start/.test(np[1].body), JSON.stringify(np && np[1]));

// ── the chat view ─────────────────────────────────────────────────
await pg.evaluate(() => _ibxChatToggle());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  chans: document.querySelectorAll('#ibxChanList [data-chan]').length,
  msgs: /Morning —/.test(document.getElementById('ibxChatMsgs').textContent),
  names: /Aron/.test(document.getElementById('ibxChatMsgs').textContent) && /Lizzie/.test(document.getElementById('ibxChatMsgs').textContent),
  mention: !!document.querySelector('#ibxChatMsgs span[style*="fef3c7"]'),
}));
check('Chat opens on #general with named messages and highlighted @mentions',
  v.chans === 2 && v.msgs && v.names && v.mention, JSON.stringify(v));
calls.length = 0;
await pg.fill('#ibxChatInput', 'Scaffold is booked for Tuesday.');
await pg.evaluate(() => _ibxChatSend());
await pg.waitForTimeout(300);
let cp = calls.find(c => c[0] === 'chatpost');
check('sending posts into the picked channel',
  !!cp && cp[1].channel_id === 'c1' && /Scaffold is booked/.test(cp[1].body), JSON.stringify(cp && cp[1]));
await pg.evaluate(() => _ibxChatToggle());
await pg.waitForTimeout(200);

// ── the 📖 Guide: the whole workflow, ringed for real ─────────────
await pg.evaluate(() => { localStorage.removeItem('fr_tour_done'); _ibxGuideOpen(); });
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  open: !!document.getElementById('tourWrap'),
  kind: /Inbox guide/.test(document.getElementById('tourCard').textContent),
  title: document.getElementById('tourTitle').textContent,
  steps: TOUR.steps.length,
  noTick: !document.getElementById('tourDontShow'),
  close: document.getElementById('tourCancel').textContent,
}));
check('📖 Guide opens the Inbox walkthrough — its own card, no tick box',
  v.open && v.kind && /Inbox, end to end/.test(v.title) && v.steps === 14 && v.noTick && v.close === 'Close guide',
  JSON.stringify({ t: v.title, s: v.steps, c: v.close }));
await pg.evaluate(() => document.getElementById('tourNext').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const r = document.getElementById('tourRing').getBoundingClientRect();
  const t = document.getElementById('ibxStatusChips').getBoundingClientRect();
  return { title: document.getElementById('tourTitle').textContent,
    near: Math.abs(r.left - t.left) < 50 && Math.abs(r.top - t.top) < 50 };
});
check('…and rings the real controls step by step', /Four piles/.test(v.title) && v.near, v.title);
await pg.evaluate(() => closeTour(true));
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ open: !!document.getElementById('tourWrap'),
  done: localStorage.getItem('fr_tour_done') }));
check('closing the guide never marks the main tutorial as seen',
  !v.open && v.done !== '1', String(v.done));

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
v = await pg.evaluate(() => !document.getElementById('ichatLaunch'));
check('…and gets no Internal chat bubble either', v === true);
await ctx.close();

// ── the roomy reply box, the task strip, and Internal chat ────────
({ ctx, pg, calls } = await boot());
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const t = document.getElementById('ibxReplyBody');
  const h0 = t.getBoundingClientRect().height;
  t.innerText = 'line\n'.repeat(40);
  const h1 = t.getBoundingClientRect().height;
  return { h0, h1, capped: h1 <= window.innerHeight * 0.5 };
});
check('the reply box opens roomy and grows with what you type',
  v.h0 >= 140 && v.h1 > v.h0 && v.capped, JSON.stringify(v));

v = await pg.evaluate(() => ({
  banner: !document.getElementById('ibxTaskBar'),
  board: getComputedStyle(document.getElementById('ibxTasksWrap')).display !== 'none',
  cards: document.querySelectorAll('#ibxTaskBoard .ibx-task').length,
  cap: (document.getElementById('ibxList').style.maxHeight || '') !== '' &&
    document.getElementById('ibxList').style.overflowY === 'auto',
}));
check('the Tasks banner is gone — the status board just lives above a capped 8-row mail list',
  v.banner && v.board && v.cards === 2 && v.cap, JSON.stringify(v));

// Internal chat floats on every tab, not just the Inbox.
await pg.evaluate(() => gotoTab('home'));
await pg.waitForTimeout(300);
v = await pg.evaluate(() => !!document.getElementById('ichatLaunch') &&
  getComputedStyle(document.getElementById('ichatLaunch')).display !== 'none');
check('the Internal chat bubble follows you off the Inbox tab', v === true);
await pg.evaluate(() => _ichatToggle());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  open: getComputedStyle(document.getElementById('ichatPanel')).display !== 'none',
  msgs: /Morning —/.test(document.getElementById('ichatMsgs').textContent),
  name: /Aron/.test(document.getElementById('ichatMsgs').textContent),
  chans: document.querySelectorAll('#ichatChan option').length,
  taskBtns: document.querySelectorAll('#ichatMsgs [data-ichattask]').length,
}));
check('the messenger opens on the team room — names, channels, a make-task button on every message',
  v.open && v.msgs && v.name && v.chans === 2 && v.taskBtns === 2, JSON.stringify(v));

// A task-shaped message: the AI asks, a person decides.
await pg.fill('#ichatInput', 'Can someone order the Modspace flashings before Thursday?');
await pg.evaluate(() => _ichatSend());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  sug: getComputedStyle(document.getElementById('ichatSuggest')).display !== 'none',
  text: document.getElementById('ichatSuggest').textContent,
  urg: (document.getElementById('ichatSugUrg') || {}).value,
}));
check('the AI spots the task and asks first — urgency picker preset from its score',
  v.sug && /Sounds like a task/.test(v.text) && /Modspace/.test(v.text) && v.urg === '50', JSON.stringify({ u: v.urg }));
calls.length = 0;
await pg.evaluate(() => _ichatSuggestGo(document.querySelector('#ichatSuggest [data-title]')));
await pg.waitForTimeout(300);
nt = calls.find(c => c[0] === 'newtask');
v = await pg.evaluate(() => document.getElementById('ichatSuggest').textContent);
check('accepting creates the task at the chosen urgency and says who got it',
  !!nt && /Modspace/.test(nt[1].title) && nt[1].urgency === 50 && /Task created/.test(v) && /Lizzie/.test(v),
  JSON.stringify(nt));
await pg.fill('#ichatInput', 'Sweet as, see everyone at smoko.');
await pg.evaluate(() => _ichatSend());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('ichatSuggest').textContent);
check('small talk raises no task prompt', !/Sounds like a task/.test(v), v.slice(0, 60));

// The friendliness pass: avatars, relative times, colours, density, badge.
v = await pg.evaluate(() => ({
  chatAv: document.querySelectorAll('#ichatMsgs .ibx-av').length,
  chatSep: document.querySelectorAll('#ichatMsgs .ichat-daysep').length,
}));
check('chat bubbles wear teammate avatars and day separators',
  v.chatAv >= 1 && v.chatSep >= 1, JSON.stringify(v));
await pg.evaluate(() => gotoTab('inbox'));
await pg.waitForTimeout(500);
v = await pg.evaluate(() => {
  const row = document.querySelector('[data-ibxthread="t1"]');
  const av = row.querySelector('.ibx-av');
  const cat = row.querySelector('span[style*="255, 237, 213"], span[style*="#ffedd5"]');
  const when = row.querySelector('.p[title]');
  return { av: av && av.textContent, cat: !!cat, when: (when || {}).textContent || '' };
});
check('thread rows carry an initials avatar, a Home-coloured category chip and a relative time',
  v.av === 'B' && v.cat && (/ago|just now|^[A-Z][a-z]{2}$/.test(v.when.trim())), JSON.stringify(v));
v = await pg.evaluate(() => {
  document.getElementById('ibxDensityBtn').click();
  const list = document.getElementById('ibxList');
  const sn = document.querySelector('[data-ibxthread="t1"] .sn');
  return { compact: list.classList.contains('compact'), stored: localStorage.getItem('fr_ibx_density'),
    snippetHidden: getComputedStyle(sn).display === 'none',
    label: document.getElementById('ibxDensityBtn').textContent };
});
check('the density toggle compacts the rows, hides snippets and remembers the choice',
  v.compact && v.stored === 'compact' && v.snippetHidden && /Cosy/.test(v.label), JSON.stringify(v));
await pg.evaluate(() => document.getElementById('ibxDensityBtn').click());
v = await pg.evaluate(() => ({
  badge: (document.getElementById('navInboxBadge') || {}).textContent,
  shown: !!document.getElementById('navInboxBadge') &&
    getComputedStyle(document.getElementById('navInboxBadge')).display !== 'none',
}));
check('the side-menu Inbox button wears the unread count', v.badge === '1' && v.shown, JSON.stringify(v));

// ── My list: personal to-dos beside the team board ────────────────
await pg.evaluate(() => _ibxView('tasks'));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  mine: /Ring the bank/.test(document.getElementById('ibxMyItems').textContent),
  offBoard: !document.querySelector('#ibxTaskBoard [data-task="tk3"]'),
}));
check('a personal to-do sits in My list — never on the team board',
  v.mine && v.offBoard, JSON.stringify(v));
calls.length = 0;
await pg.fill('#ibxMyNew', 'Book the ute in for a service');
await pg.evaluate(() => _ibxMyAdd());
await pg.waitForTimeout(300);
nt = calls.find(c => c[0] === 'newtask');
check('jotting a to-do saves it as personal', !!nt && nt[1].personal === true &&
  nt[1].title === 'Book the ute in for a service', JSON.stringify(nt && nt[1]));
calls.length = 0;
await pg.evaluate(() => {
  const cb = document.querySelector('[data-mydone="tk3"]');
  cb.checked = true; cb.dispatchEvent(new Event('change'));
});
await pg.waitForTimeout(250);
v = await pg.evaluate(() => (document.querySelector('[data-mydone="tk3"]') || {}).checked === true &&
  /line-through/.test((document.querySelector('[data-mydone="tk3"]') || { parentElement: { innerHTML: '' } }).parentElement.innerHTML));
check('ticking a to-do strikes it through and saves',
  v === true && !!calls.find(c => c[0] === 'PATCH task tk3' && c[1].done === true), JSON.stringify(calls[0]));

// ── tell the AI what to send ──────────────────────────────────────
await pg.evaluate(() => _ibxComposeOpen());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  bar: getComputedStyle(document.getElementById('ibxCAiBar')).display !== 'none',
  mic: !!document.getElementById('ibxCMic'),
}));
check('the compose window carries the tell-the-AI bar with a microphone', v.bar && v.mic, JSON.stringify(v));
calls.length = 0;
await pg.fill('#ibxCAsk', 'email steve from roofing industries asking for an update on the delivery for job 3057');
await pg.evaluate(() => _ibxAiCompose());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  to: document.getElementById('ibxCTo').value,
  subject: document.getElementById('ibxCSubject').value,
  body: document.getElementById('ibxCBody').innerText,
  note: document.getElementById('ibxCMsg').textContent,
}));
check('one instruction fills To, Subject and the whole draft — nothing sends itself',
  !!calls.find(c => c[0] === 'aicompose') && v.to === 'steve@roofingindustries.co.nz' &&
  /3057/.test(v.subject) && /Hi Steve/.test(v.body) && /read it over/i.test(v.note), JSON.stringify(v).slice(0, 140));
await pg.evaluate(() => _ibxComposeClose());

// ── the ✨ AI Assistant: words in, work out ────────────────────────
v = await pg.evaluate(() => ({
  launch: !!document.getElementById('iaiLaunch'),
  mic: !!document.getElementById('iaiMic'),
  placeholder: (document.getElementById('iaiAsk') || {}).placeholder,
}));
check('the AI Assistant button exists with a mic and its "Give me a task…" box',
  v.launch && v.mic && /Give me a task/.test(v.placeholder), JSON.stringify(v));
await pg.evaluate(() => { if (!_IAI.open) _iaiToggle(); });
await pg.waitForTimeout(200);
calls.length = 0;
await pg.fill('#iaiAsk', 'set task for lizzie to check over job #3099');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  out: document.getElementById('iaiOut').textContent,
  onBoard: !!document.querySelector('#ibxTaskBoard [data-task="tk7"]'),
}));
check('"set task for…" creates the task and says who got it — straight onto the board',
  !!calls.find(c => c[0] === 'assistant') && /Task created/.test(v.out) && /Lizzie/.test(v.out) && v.onBoard,
  JSON.stringify(v).slice(0, 140));
calls.length = 0;
await pg.fill('#iaiAsk', 'email suzie from job number #3342 and ask for her colour selection');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  modal: getComputedStyle(document.getElementById('ibxComposeModal')).display !== 'none',
  to: document.getElementById('ibxCTo').value,
  subject: document.getElementById('ibxCSubject').value,
  body: document.getElementById('ibxCBody').innerText,
  out: document.getElementById('iaiOut').textContent,
}));
check('"email…" opens compose with the whole draft filled — a person still presses Send',
  v.modal && v.to === 'suzie@customer.co.nz' && /3342/.test(v.subject) && /Hi Suzie/.test(v.body) &&
  /Draft ready/.test(v.out), JSON.stringify({ to: v.to, s: v.subject }).slice(0, 110));
await pg.evaluate(() => _ibxComposeClose());

// The wider command set, driven through the same box.
await pg.fill('#iaiAsk', 'give me my rundown');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('iaiOut').innerHTML);
check('a question comes back as an answer with its line breaks',
  /Two open tasks/.test(v) && /One hot lead waiting/.test(v) && /<br>/.test(v), v.slice(-120));
await pg.fill('#iaiAsk', 'archive everything from the supplier');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('iaiOut').textContent);
check('a tidy-up reports what it did', /Archived 2 conversations/.test(v), v.slice(-80));
await pg.fill('#iaiAsk', 'tell the team the yard closes early friday');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  input: (document.getElementById('ichatInput') || {}).value,
  open: _ICHAT.open,
  out: document.getElementById('iaiOut').textContent,
}));
check('"tell the team…" stages the message in Internal chat — a person presses ➤',
  v.open && v.input === 'Yard closes early on Friday.' && /press ➤/.test(v.out), JSON.stringify(v).slice(0, 120));
await pg.fill('#iaiAsk', 'open the schedule');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.body.getAttribute('data-tab'));
check('"open the schedule" navigates there', v === 'schedule', String(v));

// ── the Communications makeover ───────────────────────────────────
await pg.evaluate(() => gotoTab('inbox'));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  nav: /Communications/.test(document.getElementById('navInboxBtn').textContent),
  title: /Communications/.test(document.querySelector('#ibxWrap .card strong').textContent),
  aiBig: /AI Assistant/.test((document.getElementById('ibxAiBigBtn') || {}).textContent || ''),
  chatBig: /Internal chat/.test((document.getElementById('ibxChatBigBtn') || {}).textContent || ''),
  bubblesOff: getComputedStyle(document.getElementById('ichatLaunch')).display === 'none' &&
    getComputedStyle(document.getElementById('iaiLaunch')).display === 'none',
}));
check('the tab is Communications, with big AI Assistant + Internal chat buttons and no floating bubbles here',
  v.nav && v.title && v.aiBig && v.chatBig && v.bubblesOff, JSON.stringify(v));
await pg.evaluate(() => document.querySelector('[data-ibxthread="t1"]').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const html = document.getElementById('ibxConv').innerHTML;
  return { order: html.indexOf('ibxReplyBody') < html.indexOf('ibxNotesList'),
    noAuto: !/margin-top:auto/.test(html) };
});
check('the reply box sits right below the email — notes after it, nothing pushed to the bottom',
  v.order && v.noAuto, JSON.stringify(v));
calls.length = 0;
await pg.evaluate(() => { if (!_IAI.open) _iaiToggle(); });
await pg.fill('#iaiAsk', 'draft a reply to say no worries thanks for the update');
await pg.evaluate(() => _iaiGo());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  sent: null,
  body: (document.getElementById('ibxReplyBody') || {}).innerText,
  out: document.getElementById('iaiOut').textContent,
}));
nt = calls.find(c => c[0] === 'assistant');
check('"draft a reply" fills the reply box on the OPEN conversation — the person sends',
  !!nt && nt[1].thread_id === 't1' && /No worries/.test(v.body) && /Reply drafted/.test(v.out),
  JSON.stringify({ t: nt && nt[1].thread_id, b: (v.body || '').slice(0, 30) }));

// ── My list: Ask the team, or hand a task back ────────────────────
calls.length = 0;
await pg.evaluate(() => { if (_IAI.open) _iaiToggle(); });
await pg.evaluate(() => _ibxTaskAsk('tk3', 'where are the ute keys?'));
await pg.waitForTimeout(500);
let ask = calls.find(c => c[0] === 'chatpost');
v = await pg.evaluate(() => _ICHAT.open);
check('💬 Ask fires the question into Internal chat, named and tied to the task',
  v === true && !!ask && /question about task "Ring the bank about the ute": where are the ute keys\?/.test(ask[1].body),
  JSON.stringify(ask && ask[1]).slice(0, 130));
await pg.evaluate(() => { if (_ICHAT.open) _ichatToggle(); });
calls.length = 0;
await pg.evaluate(() => _ibxTaskUnassign('tk3'));
await pg.waitForTimeout(300);
let un = calls.find(c => String(c[0]).indexOf('PATCH task tk3') === 0);
v = await pg.evaluate(() => ({
  offMyList: !/Ring the bank/.test(document.getElementById('ibxMyItems').textContent),
  inUnassigned: !!document.querySelector('[data-tcol=""] [data-task="tk3"]'),
  stamp: /unassigned by/.test((document.querySelector('[data-tcol=""] [data-task="tk3"]') || {}).textContent || ''),
}));
check('↩ Unassign parks it in the Unassigned list with a who/when stamp until someone picks it up',
  !!un && un[1].unassign === true && v.offMyList && v.inUnassigned && v.stamp, JSON.stringify(v));

// ── colour-coded people, columns that fit, Gmail bar in compose ───
v = await pg.evaluate(() => {
  const col = document.querySelector('[data-tcol="u2"]');
  const cs = getComputedStyle(col);
  const card = document.querySelector('[data-task="tk1"]');
  const row = document.querySelector('.ibx-row');
  return {
    grow: cs.flexGrow === '1',
    // one row, every column visible: they share the width instead of scrolling
    wrap: getComputedStyle(document.getElementById('ibxTaskBoard')).flexWrap === 'nowrap',
    fits: document.getElementById('ibxTaskBoard').scrollWidth <=
          document.getElementById('ibxTaskBoard').clientWidth + 1,
    tint: cs.backgroundColor !== 'rgb(248, 250, 252)',
    topBar: cs.borderTopWidth === '3px' && cs.borderTopColor !== 'rgb(226, 232, 240)',
    dot: !!col.querySelector('.th span[style*="border-radius"]'),
    cardEdge: card && getComputedStyle(card).borderLeftWidth === '3px',
    rowEdge: row && getComputedStyle(row).borderLeftWidth === '3px',
    chip: !!document.querySelector('.ibx-row .sn span[style*="font-weight:700"], .ibx-row .sn span[style*="font-weight: 700"]'),
  };
});
check('columns squeeze onto one row with no sideways scroll, and wear their member\'s colour — cards and mail rows too',
  v.grow && v.wrap && v.fits && v.tint && v.topBar && v.dot && v.cardEdge && v.rowEdge, JSON.stringify(v));
await pg.evaluate(() => _ibxComposeOpen());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  bar: !!document.querySelector('#ibxCFmtBar .ibx-fmtbar'),
  editable: (document.getElementById('ibxCBody') || {}).contentEditable === 'true',
}));
check('compose carries the same format bar over a rich editor', v.bar && v.editable, JSON.stringify(v));

// ── the permanent top banner: there on every tab, not just Communications ──
await pg.evaluate(() => gotoTab('select'));
await pg.waitForTimeout(300);
v = await pg.evaluate(() => {
  const bar = document.getElementById('globalTopBar');
  const cs = getComputedStyle(bar);
  return {
    shown: cs.display !== 'none' && cs.position === 'fixed',
    ai: /AI Assistant/.test(bar.textContent),
    chat: /Internal chat/.test(bar.textContent),
    bell: /🔔/.test(bar.textContent),
    todo: /To Do List/.test(bar.textContent),
  };
});
check('the top banner rides every tab with assistant, chat, bell and to-dos',
  v.shown && v.ai && v.chat && v.bell && v.todo, JSON.stringify(v));
await pg.evaluate(() => _gtbTodoToggle());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  open: getComputedStyle(document.getElementById('gtbTodoPanel')).display !== 'none',
  mine: /Ring the bank/.test(document.getElementById('gtbTodoItems').textContent),
  teamKeptOut: !/ridge flashings/.test(document.getElementById('gtbTodoItems').textContent),
}));
check('To Do List drops down the personal list — team tasks stay on the board',
  v.open && v.mine && v.teamKeptOut, JSON.stringify(v));
await pg.evaluate(() => _gtbTodoToggle());
await pg.evaluate(() => _gtbChat());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  chatOpen: !!document.getElementById('ichatPanel') && getComputedStyle(document.getElementById('ichatPanel')).display !== 'none',
}));
check('the banner\'s Internal chat button drops the chat down from any tab', v.chatOpen, JSON.stringify(v));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
