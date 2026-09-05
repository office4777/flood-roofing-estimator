// "remove notifications from the left menu, leave the bell notifications at
//  the top, also remove the email tab too … show the selected job as job#,
//  customer name and address … a 'change job' button and a 'History' button
//  … also change the colour of the task sections so they're all different"
//
// The Notifications item was the same list as the bell at the top of every
// tab, in two places. The Email tab is gone from the menu but NOT from the
// app — emailing a customer happens where the work is, on the quote and on
// the schedule board, and the inbox itself is untouched.
//
// The history window is assembled from what the job already carries. The one
// thing that had to be recorded for it is the schedule board's customer
// updates: the board stamped last_notified, one timestamp, which answers
// "have we told them" and nothing else.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const sched = { cfg:{ crews:[], cap:4, shutdowns:[] }, rows:[
  { id:'r1', job_id:'j1', client_name:'Sharon Thomson', site_address:'23 Don Buck Road, Henderson',
    length_days:1, archived:false, folder:'', auto:{},
    last_notified:'2026-09-02T03:00:00Z',
    notify_log:[ { at:'2026-08-20T01:00:00Z', to:'s@t.nz', subject:'Roughly when we will be there' },
                 { at:'2026-09-02T03:00:00Z', to:'s@t.nz', subject:'Confirming your start date' } ] },
], blocks:[], nonwork:[], range:{ from:'2026-08-01', to:'2026-12-31', today:'2026-09-05' }, feed_url:'x' };
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/schedule(\?|$)/.test(u)) return j(sched);
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing LTD' },
    quote_defaults:{}, jms_keys:{} });
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// ── the left menu ──
let v = await pg.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id);
    return !!e && getComputedStyle(e).display !== 'none'; };
  return { email: vis('navInboxBtn'), notif: vis('navNotifBtn'),
           bell: !!document.getElementById('qnBellBtn') || /🔔/.test(document.body.innerHTML),
           inboxTabExists: !!document.getElementById('tab-inbox'),
           schedule: vis('navScheduleBtn'), quote: vis('navQuoteBtn') };
});
// Default ON where the plan allows it — the inbox is what the Business tier
// sells, and a paid feature hidden until you find a switch is one nobody
// knows they bought. A company turns it off for itself.
check('the Email item is in the menu by default', v.email, JSON.stringify(v));
check('…and so is Notifications, which the bell already does', !v.notif, JSON.stringify(v));
check('the bell is still there', v.bell);
check('…and the inbox itself is untouched — only the menu item went',
  v.inboxTabExists, String(v.inboxTabExists));
check('the tabs that do the work are where they were', v.schedule && v.quote);

// ── the company's own choice ──
v = await pg.evaluate(() => {
  S.settings = S.settings || {}; S.settings.branding = S.settings.branding || {};
  _emailTabToggle(false);
  const btn = document.getElementById('navInboxBtn');
  return { shown: getComputedStyle(btn).display !== 'none',
           saved: S.settings.branding.show_email_tab,
           box: document.getElementById('brShowEmailTab').checked };
});
check('turning the Email tab off takes it out of the menu', !v.shown, JSON.stringify(v));
check('…and remembers the choice on the company, not the device',
  v.saved === false, JSON.stringify(v));
check('…with the settings tick in step', v.box === false, JSON.stringify(v));
v = await pg.evaluate(() => {
  // A plan sync must not put it back — that was the bug the first time.
  _navPlanSync();
  return getComputedStyle(document.getElementById('navInboxBtn')).display !== 'none';
});
check('…and a plan sync does not put it back', !v, String(v));
v = await pg.evaluate(() => {
  _emailTabToggle(true);
  return getComputedStyle(document.getElementById('navInboxBtn')).display !== 'none';
});
check('turning it back on returns it', v, String(v));
v = await pg.evaluate(() => {
  // A plan without the inbox hides it whatever the company says.
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', role:'owner', plan:'solo',
    limits:{ inbox:false, schedule:false } }));
  _emailTabSync();
  const r = getComputedStyle(document.getElementById('navInboxBtn')).display !== 'none';
  localStorage.removeItem('fr_company');
  return r;
});
check('a plan without the inbox hides it whatever the company chose', !v, String(v));
await pg.evaluate(() => { _emailTabSync(); });

// ── the selected-job block ──
v = await pg.evaluate(() => {
  S.currentJobId = 'j1';
  S.linkedJobNo = '3206';
  S.jobCreatedAt = '2026-08-01T20:00:00Z';
  S.quote = { ref:'3206', client:'Sharon Thomson', addr:'23 Don Buck Road, Henderson', gstRate:15,
    share:{ token:'t1', status:'accepted', sentAt:'2026-08-10T02:00:00Z', sentTotal:17002.04,
            events:[{ type:'opened', at:'2026-08-11T01:00:00Z' }] },
    accepted:{ name:'Sharon Thomson', at:'2026-09-04T02:52:21Z', total:17002.04 } };
  S.orderSent = { at:'2026-09-04T20:00:00Z', supplier:'Roofing Industries', delivery_date:'2026-09-17' };
  const c = document.getElementById('jobClient'); if (c) c.value = 'Sharon Thomson';
  const a = document.getElementById('jobAddr'); if (a) a.value = '23 Don Buck Road, Henderson';
  // setCurrentJobLabel is what fills the selected-job block;
  // updateSidebarJobChip was retired long ago and only keeps autosave wiring.
  setCurrentJobLabel({ id:'j1', created_at:'2026-08-01T20:00:00Z', client_name:'Sharon Thomson' });
  const btns = document.getElementById('navJobBtns');
  return { no: document.getElementById('navJobNo').textContent,
           name: document.getElementById('navJobName').textContent,
           addr: document.getElementById('navJobAddr').textContent,
           btns: getComputedStyle(btns).display !== 'none',
           html: btns.innerHTML };
});
check('the selected job leads with its number', /3206/.test(v.no), v.no);
check('…then the customer', v.name === 'Sharon Thomson', v.name);
check('…then the address', /23 Don Buck Road/.test(v.addr), v.addr);
check('there is a Change job button and a History button', v.btns &&
  /Change job/.test(v.html) && /History/.test(v.html), v.html.slice(0, 90));
check('…Change job in blue, History in orange',
  /#0099cc[^>]*>\s*Change job/.test(v.html) && /#ea580c[^>]*>\s*History/.test(v.html), v.html.slice(0, 200));

// ── the history window ──
await pg.evaluate(() => _jobHistoryOpen());
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  open: getComputedStyle(document.getElementById('jobHistModal')).display !== 'none',
  who: document.getElementById('jobHistWho').textContent,
  txt: document.getElementById('jobHistBody').textContent,
}));
check('History opens a window of its own', v.open && /Job 3206/.test(v.who), v.who);
check('…the enquiry date', /Enquiry/.test(v.txt) && /1 Aug/.test(v.txt), v.txt.slice(0, 90));
check('…the date the quote was sent', /Quote sent/.test(v.txt) && /10 Aug/.test(v.txt));
check('…the date it was accepted', /Quote accepted/.test(v.txt) && /4 Sep/.test(v.txt));
check('…who accepted it and for how much',
  /Sharon Thomson/.test(v.txt) && /17,002\.04/.test(v.txt));
check('…the date the roof was ordered',
  /Roof ordered/.test(v.txt) && /Roofing Industries/.test(v.txt) && /2026-09-17/.test(v.txt));
check('…and every update emailed from the schedule',
  /Confirming your start date/.test(v.txt) && /Roughly when we will be there/.test(v.txt),
  v.txt.slice(-160));

// A job with none of it yet says so, rather than leaving the line off — "no
// order sent" is the answer somebody came here for.
v = await pg.evaluate(() => {
  S.quote = { ref:'', client:'New client', share:{} }; S.orderSent = null; S.currentJobId = null;
  _jobHistoryOpen();
  return document.getElementById('jobHistBody').textContent;
});
check('a job with nothing done yet shows the steps as not yet, not missing',
  /Roof ordered/.test(v) && (v.match(/not yet/g) || []).length >= 3, v.slice(0, 120));
await pg.evaluate(() => _jobHistoryClose());
check('…and it closes', await pg.evaluate(() =>
  getComputedStyle(document.getElementById('jobHistModal')).display === 'none'));

// ── a colour per task column ──
v = await pg.evaluate(() => {
  const keys = ['', 'u-matt', 'u-ethan', 'u-paula', 'u-troy', 'u-nick'];
  const cols = _ibxColColors(keys);
  return { cols: cols, unique: new Set(cols).size };
});
check('every task column gets its own colour', v.unique === 6, JSON.stringify(v.cols));
check('…with Unassigned kept amber, so it reads as nobody\'s',
  v.cols[0] === '#b45309', v.cols[0]);
v = await pg.evaluate(() => {
  // More teammates than colours: they still must not repeat side by side.
  const many = ['', 'a','b','c','d','e','f','g','h','i'];
  const cols = _ibxColColors(many);
  let clash = 0;
  for (let i = 1; i < cols.length; i++) if (cols[i] === cols[i-1]) clash++;
  return { clash, n: cols.length };
});
check('…and a big team never gets two the same next to each other', v.clash === 0, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
