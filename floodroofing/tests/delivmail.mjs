// The board has a "delivery confirmed" tick, and confirming it was a person
// reading an email and then remembering to go and tick it. That is the step
// where jobs slip: the steel is booked, the supplier replies with a date, and
// nobody moves it on the board — so the crew turns up to nothing.
//
// The inbox already mirrors the real mail. When a message carries a date and
// there is an order out with nothing confirmed against it, the thread offers
// to set it. It never sets one by itself: a date read out of prose is a
// suggestion, and the office is the one who knows which job it is about.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

const accounts = [{ id:'acc1', label:'Office', email:'office@floodroofing.co.nz', provider:'gmail',
  shared:true, status:'ok', last_error:'' }];
const threads = [
  { id:'t1', account_id:'acc1', subject:'RE: Order 3206 — Taheke', participants:['steve@roofingindustries.co.nz'],
    snippet:'Booked in', status:'inbox', unread:true, category:'supplier', urgency:40, job_id:'j1',
    msg_count:1, account_email:'office@floodroofing.co.nz', account_label:'Office',
    last_date:new Date().toISOString() },
  { id:'t2', account_id:'acc1', subject:'Newsletter', participants:['news@steel.co.nz'],
    snippet:'Spring specials', status:'inbox', unread:false, category:'supplier', urgency:5, job_id:null,
    msg_count:1, account_email:'office@floodroofing.co.nz', account_label:'Office',
    last_date:new Date().toISOString() },
];
const messages = {
  t1: [{ from_addr:'steve@roofingindustries.co.nz', from_name:'Steve', date:new Date().toISOString(),
    subject:'RE: Order 3206', body_text:'Morning — that one is booked in for delivery on 17/09/2026. Cheers, Steve',
    body_html:'', attachments:[] }],
  t2: [{ from_addr:'news@steel.co.nz', from_name:'Steel News', date:new Date().toISOString(),
    subject:'Newsletter', body_text:'Spring specials on now. Great prices all round.',
    body_html:'', attachments:[] }],
};
const sched = {
  cfg: { crews: [], cap: 4, shutdowns: [], region:'auckland' },
  rows: [
    // Ordered, nothing confirmed — the job an answer could be about.
    { id:'r1', job_id:'j1', client_name:'Sharon Thomson', site_address:'3687 SH12, Taheke', email:'',
      length_days:3, notes:'', progress_pct:null, deposit_paid:true, ordered:true, delivery_check:false,
      handover_done:false, requested_delivery:'2026-09-15', confirmed_delivery:null, folder:'',
      archived:false, created_at:'2026-09-01', accepted_at:'2026-09-01T00:00:00Z', auto:{} },
    // Ordered AND already confirmed — must not be offered.
    { id:'r2', job_id:'j2', client_name:'Greg Thomas', site_address:'98 Settlers Way', email:'',
      length_days:2, notes:'', progress_pct:null, deposit_paid:true, ordered:true, delivery_check:true,
      handover_done:false, requested_delivery:'2026-09-03', confirmed_delivery:'2026-09-03', folder:'',
      archived:false, created_at:'2026-08-20', accepted_at:'2026-08-20T00:00:00Z', auto:{} },
    // Not ordered yet — nothing to confirm.
    { id:'r3', job_id:'j3', client_name:'Modspace', site_address:'Whetu Rau', email:'',
      length_days:1, notes:'', progress_pct:null, deposit_paid:null, ordered:false, delivery_check:false,
      handover_done:false, requested_delivery:null, confirmed_delivery:null, folder:'',
      archived:false, created_at:'2026-08-25', accepted_at:null, auto:{} },
  ],
  blocks: [], nonwork: [], range:{ from:'2026-08-01', to:'2026-12-31', today:'2026-09-04' },
  feed_url:'https://x/schedule/feed.ics?c=co&sig=abc',
};

const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const patches = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const json = o => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if (/\/inbox\/threads\?/.test(u) && m === 'GET') return json({ threads, accounts, ai_enabled:false });
  if (/\/inbox\/threads\/t\d+$/.test(u) && m === 'GET'){
    const id = u.split('/').pop();
    return json({ thread: threads.find(t => t.id === id), messages: messages[id] || [] });
  }
  if (/\/schedule(\?|$)/.test(u) && m === 'GET') return json(sched);
  if (/\/schedule\/rows\/[^/]+$/.test(u) && m === 'PATCH'){
    patches.push([u.split('/').pop(), JSON.parse(r.request().postData() || '{}')]);
    return json({});
  }
  if (/\/inbox\//.test(u)) return json({ ok:true });
  if (/\/schedule\//.test(u)) return json({});
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { try {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null'); localStorage.removeItem('fr_company');
} catch(e){} });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// The date reader, on the shapes a supplier actually writes.
let v = await pg.evaluate(() => ({
  slash: _ibxDatesIn('booked in for delivery on 17/09/2026'),
  words: _ibxDatesIn('we can get it there Tuesday 15 September'),
  rev:   _ibxDatesIn('delivery Sept 15'),
  iso:   _ibxDatesIn('ETA 2026-09-17 as discussed'),
  none:  _ibxDatesIn('Spring specials on now. Great prices all round.'),
}));
check('a 17/09/2026 in a reply is read day-first', v.slash[0] === '2026-09-17', JSON.stringify(v.slash));
check('"15 September" is read too', (v.words[0] || '').slice(5) === '09-15', JSON.stringify(v.words));
check('…and "Sept 15" the other way round', (v.rev[0] || '').slice(5) === '09-15', JSON.stringify(v.rev));
check('an ISO date is read as itself', v.iso[0] === '2026-09-17', JSON.stringify(v.iso));
check('an email with no date in it offers nothing', v.none.length === 0, JSON.stringify(v.none));

// The board has to be loaded for the strip to know what is open.
await pg.evaluate(() => gotoTab('schedule'));
await pg.waitForTimeout(900);
await pg.evaluate(() => gotoTab('inbox'));
await pg.waitForTimeout(900);
await pg.evaluate(() => _ibxOpen('t1'));
await pg.waitForTimeout(700);

v = await pg.evaluate(() => {
  const el = document.getElementById('ibxDelivStrip');
  return el ? { text: el.textContent,
                buttons: Array.from(el.querySelectorAll('button')).map(x => x.getAttribute('onclick')) } : null;
});
check('a supplier reply carrying a date offers to set the delivery', !!v, 'no strip');
check('…and never sets one by itself', patches.length === 0, JSON.stringify(patches));
check('…offering the date it found', v && /17 Sep/.test(v.text), v && v.text);
check('…on the job this thread is already tied to, and no other',
  v && v.buttons.length === 1 && /'r1','2026-09-17'/.test(v.buttons[0]), JSON.stringify(v && v.buttons));

v = await pg.evaluate(() => _ibxOpenOrders().map(r => r.id));
check('only the job with an order out and nothing confirmed is a candidate',
  JSON.stringify(v) === JSON.stringify(['r1']), JSON.stringify(v));

await pg.evaluate(() => _ibxSetDelivery('r1', '2026-09-17'));
await pg.waitForTimeout(400);
check('clicking it confirms the delivery on the board',
  patches.length === 1 && patches[0][0] === 'r1' && patches[0][1].confirmed_delivery === '2026-09-17',
  JSON.stringify(patches));
check('…and ticks delivery checked with it', patches[0][1].delivery_check === true, JSON.stringify(patches[0][1]));
check('…and says so rather than leaving the strip up',
  await pg.evaluate(() => /Delivery confirmed/.test((document.getElementById('ibxDelivStrip')||{}).textContent || '')));

// A newsletter with no date, and no job — nothing offered.
await pg.evaluate(() => _ibxOpen('t2'));
await pg.waitForTimeout(600);
check('an email with no date in it never offers anything',
  await pg.evaluate(() => !document.getElementById('ibxDelivStrip')));

// A job already confirmed, or not ordered at all, was never a candidate —
// and r1 has just been confirmed, so nothing is open now.
v = await pg.evaluate(() => _ibxOpenOrders().map(r => r.id));
check('a confirmed job drops out of the candidates, and the unordered one was never in',
  JSON.stringify(v) === JSON.stringify([]), JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
