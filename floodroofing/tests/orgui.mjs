// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const JOBS = [
  { id:'job-a', client_name:'Mrs Hale', site_address:'3 Kea St', status:'draft',
    updated_at:'2026-08-19T02:00:00Z', created_at:'2026-08-18T02:00:00Z', created_by:'Matt', order_sent:null },
  { id:'job-b', client_name:'Mr Aiono', site_address:'9 Tui Rd', status:'ordered',
    updated_at:'2026-08-19T01:00:00Z', created_at:'2026-08-17T02:00:00Z', created_by:'Aaron',
    order_sent:{ at:'2026-08-19T01:00:00Z', to:'orders@steel.co.nz', supplier:'Steel & Tube', by_name:'Ethan' } },
];
const posted = [];
const ctx = await b.newContext({ viewport:{width:1600,height:1000} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const q = r.request(), u = q.url(), m = q.method();
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/settings\/next-job-no/.test(u)){
    posted.push({ u, m, body: q.postDataJSON() });
    // Someone else took 06121 a second ago — we get 06122.
    return j({ jobNo:'06122', next:'06123', atomic:true });
  }
  if (/\/jobs\/[^/]+\/order-sent/.test(u)){
    posted.push({ u, m, body: q.postDataJSON() });
    return j({ ok:true, order_sent:{ at:new Date().toISOString(), to:'orders@steel.co.nz', by_name:'Ethan' } });
  }
  if (/\/jobs\/job-a(\?|$)/.test(u) && m === 'GET')
    return j(Object.assign({}, JOBS[0], { draw_state:{} }));
  if (/\/jobs(\?|$)/.test(u) && m === 'GET') return j(JOBS);
  if (/\/quote-activity/.test(u)) return j([]);
  if (/\/settings/.test(u) && m === 'GET')
    return j({ user_id:'u1', branding:{}, quote_defaults:{ next_job_no:'06121', gst_rate:15 }, jms_keys:{}, price_book:{}, labour_pricing:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => { gotoTab('select'); fetchRecentDrafts(); });
await pg.waitForTimeout(1200);

// ── the board says who ──
let v = await pg.evaluate(() => {
  const host = document.getElementById('homeBoard');
  return { drafts:(host.textContent||'').replace(/\s+/g,' '),
           rows:(window._recentDraftsRows||[]).map(r=>({c:r.client, by:r.by})),
           orders:(window._ordersSentRows||[]).map(o=>({c:o.client, by:o.by})) };
});
check('the jobs list carries who made each job',
  JSON.stringify(v.rows) === JSON.stringify([{c:'Mrs Hale',by:'Matt'},{c:'Mr Aiono',by:'Aaron'}]), JSON.stringify(v.rows));
check('…and the board shows it', /made by Matt/.test(v.drafts) && /made by Aaron/.test(v.drafts), v.drafts.slice(0,150));
check('the orders column knows who sent the order',
  v.orders.length === 1 && v.orders[0].by === 'Ethan', JSON.stringify(v.orders));
await pg.evaluate(() => _hbSelect('orders'));
await pg.waitForTimeout(400);
check('…and shows it on the row',
  /sent by Ethan/.test((await pg.evaluate(() => document.getElementById('homeBoard').textContent)) || ''));
await pg.locator('#homeBoard').screenshot({ path: S+'/org_board.png' });
await pg.evaluate(() => _hbSelect('drafts'));
await pg.waitForTimeout(300);
await pg.locator('#homeBoard').screenshot({ path: S+'/org_drafts.png' });

// ── opening a job says whose it is ──
await pg.evaluate(() => openJob('job-a'));
await pg.waitForTimeout(1600);
v = await pg.evaluate(() => {
  const el = document.getElementById('globalJobBarBy');
  return { txt: el ? el.textContent : null, shown: !!el && getComputedStyle(el).display !== 'none' };
});
check('opening a teammate\'s job says who made it', v.shown && v.txt === 'made by Matt', JSON.stringify(v));

// ── job numbers come from the server, and a clash is adopted, not ignored ──
const alloc = await pg.evaluate(async () => {
  S.settings = S.settings || {};
  S.settings.quote_defaults = { next_job_no: '06121' };
  const jn = document.getElementById('jobNo'); if (jn) jn.value = '06121';
  S.quote = S.quote || {}; S.quote.ref = '06121';
  const got = await _consumeJobNo('06121');
  return { got: got, field: (document.getElementById('jobNo')||{}).value,
           ref: S.quote.ref, counter: S.settings.quote_defaults.next_job_no };
});
check('a new job number is allocated by the server, not counted locally',
  posted.some(p => /next-job-no/.test(p.u)), JSON.stringify(posted.map(p=>p.u.split('/').pop())));
check('…and when someone else got there first, this job takes the number it was given',
  alloc.got === '06122' && alloc.field === '06122' && alloc.ref === '06122', JSON.stringify(alloc));
check('…with the shared counter left where the server put it', alloc.counter === '06123', alloc.counter);

// typing your own number must NOT touch the counter
const before = posted.length;
const own = await pg.evaluate(async () => {
  S.settings.quote_defaults = { next_job_no: '06123' };
  const got = await _consumeJobNo('99999');
  return { got: got, counter: S.settings.quote_defaults.next_job_no };
});
check('typing your own job number leaves the shared counter alone',
  own.got === '99999' && own.counter === '06123' && posted.length === before, JSON.stringify(own));

// ── the order stamp goes to the endpoint that records who ──
await pg.evaluate(() => {
  S.currentJobId = 'job-a';
  return api('POST', '/jobs/' + S.currentJobId + '/order-sent', { to:'orders@steel.co.nz', supplier:'Steel & Tube' });
});
await pg.waitForTimeout(600);
const os = posted.filter(p => /order-sent/.test(p.u));
check('sending an order calls the endpoint that stamps who sent it',
  os.length === 1 && os[0].m === 'POST' && os[0].body.to === 'orders@steel.co.nz', JSON.stringify(os));
check('…and does NOT try to set the author from the browser', os.length === 1 && !('by' in os[0].body), JSON.stringify(os[0] && os[0].body));

await ctx.close();
await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
