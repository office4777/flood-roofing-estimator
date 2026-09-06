// Two ways a working Fergus link reported itself broken.
//
// A subscriber's report: "it just said fergus wasn't connected, it also
// wouldn't connect to job#3045". Their own API answered GET /jobs 200 with
// records in it, so both halves were ours.
//
//   1. A stale mapping was a DEAD END. RoofMap remembers which saved job
//      belongs to which Fergus job. Delete the RoofMap job and the mapping
//      still points at it; opening that Fergus job then fetched a job the
//      server had never heard of. There was already a fall-back to starting
//      it fresh — but openJob() alerted and swallowed the error instead of
//      throwing, so the recovery was unreachable code and the roofer got
//      "Could not open job: not found" and nothing else.
//
//   2. The connection test asked ONE question. It sorts and pages the jobs
//      list, and not every Fergus partner account answers that query string.
//      One call failing declared the whole integration disconnected.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// Every alert is recorded — a dead end is precisely an alert with no recovery.
const alerts = [];
pg.on('dialog', d => { alerts.push(d.message()); d.accept(); });

let fergusPaths = [];
let fergusOkPaths = /.^/;              // set per-case: which paths answer 200
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x, s) => r.fulfill({ status: s || 200, contentType:'application/json',
                                  body: JSON.stringify(x) });
  const fx = /\/fergus(\/.*)$/.exec(u.split('?')[0]);
  if (fx || /\/fergus\//.test(u)){
    const path = decodeURIComponent(u.slice(u.indexOf('/fergus') + 7));
    fergusPaths.push(path);
    if (fergusOkPaths.test(path)) return j({ value: [
      { id: 'f1', jobNo: '3045', customer: 'K. Rewi', address: '9 Kauri Rd' } ] });
    return j({ message: 'Route GET:/api/partner' + path.split('?')[0] + ' not found' }, 404);
  }
  // Sub-resources first: /jobs/live1/invoices must not be answered with the
  // job itself, which lands as _INVOICES.rows and is not an array.
  if (/\/jobs\/[^/]+\/\w+/.test(u)) return j([]);
  // The RoofMap job the stale mapping points at is GONE.
  if (/\/jobs\/gone1/.test(u)) return j({ error: 'not found' }, 404);
  if (/\/jobs\/live1/.test(u)) return j({ id:'live1', client_name:'R. Ngata',
    site_address:'8 Rimu St', draw_state:{ draw:{}, state:{}, form:{} } });
  if (/\/jobs/.test(u) && m === 'GET') return j([]);
  if (m !== 'GET') return j({ ok:true, id:'new1' });
  if (/\/settings/.test(u)) return j({ user_id:'u1',
    branding:{ company_name:'Kauri Roofing Ltd' }, quote_defaults:{},
    jms_keys:{ fergus:'k'.repeat(88) } });
  return j([]);
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1');
  localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_jms_linked','1');
  localStorage.setItem('fr_user', JSON.stringify({ email:'bob@kauri.co.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Kauri Roofing Ltd',
    plan:'team', limits:{ jms:true, schedule:true, inbox:true } }));
  // Fergus job f1 → RoofMap job gone1, which no longer exists.
  localStorage.setItem('fr_ferg2job', JSON.stringify({ f1: 'gone1' }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

// ── 1. openJob's error is reachable ───────────────────────────────
let v = await pg.evaluate(async () => {
  try { await openJob('gone1', { quiet: true }); return 'no throw'; }
  catch(e){ return 'threw: ' + e.message; }
});
check('a caller that can recover is told the job is missing, not shown an alert',
  /threw/.test(v), v);
check('…and nothing was alerted at it', alerts.length === 0, JSON.stringify(alerts));

// The ordinary path still speaks up — this is the same function.
alerts.length = 0;
await pg.evaluate(() => openJob('gone1'));
await pg.waitForTimeout(400);
check('opening a missing job by hand still says so',
  alerts.length === 1 && /not found/i.test(alerts[0]), JSON.stringify(alerts));

// ── 2. a stale mapping starts the job fresh instead of dead-ending ─
alerts.length = 0;
await pg.evaluate(() => {
  S.fergJobsCache = [{ id:'f1', jobNo:'3045', customer:'K. Rewi', address:'9 Kauri Rd' }];
});
await pg.evaluate(() => useFergusJobInModal('f1'));
await pg.waitForTimeout(1600);
v = await pg.evaluate(() => ({
  alerted: null,
  linkedId: S.linkedJobId, linkedNo: S.linkedJobNo,
  client: (document.getElementById('jobClient')||{}).value,
  addr: (document.getElementById('jobAddr')||{}).value,
  map: localStorage.getItem('fr_ferg2job'),
  current: S.currentJobId,
}));
check('a Fergus job whose saved job was deleted is not a dead end',
  alerts.length === 0, JSON.stringify(alerts));
check('…it opens as a fresh job carrying the Fergus customer',
  v.client === 'K. Rewi' && /Kauri Rd/.test(v.addr || ''), JSON.stringify(v));
check('…still linked to the Fergus job, so a push knows where to go',
  v.linkedId === 'f1' && String(v.linkedNo) === '3045', JSON.stringify(v));
check('…not pretending to be the job that is gone',
  !v.current, String(v.current));
check('…and the mapping that pointed at nothing is cleared',
  !JSON.parse(v.map || '{}').f1, v.map);

// A mapping that still resolves must keep opening the saved job.
await pg.evaluate(() => {
  localStorage.setItem('fr_ferg2job', JSON.stringify({ f1: 'live1' }));
  S.currentJobId = null;
});
alerts.length = 0;
await pg.evaluate(() => useFergusJobInModal('f1'));
await pg.waitForTimeout(1600);
v = await pg.evaluate(() => ({ id: S.currentJobId,
  client: (document.getElementById('jobClient')||{}).value,
  map: localStorage.getItem('fr_ferg2job') }));
check('a mapping that still resolves opens the saved job, as before',
  v.id === 'live1', JSON.stringify(v));
check('…and that mapping is left alone', JSON.parse(v.map || '{}').f1 === 'live1', v.map);

// ── 3. the connection test asks more than one question ────────────
// Their Fergus refuses the sorted/paged query and answers a bare /jobs.
fergusPaths = [];
fergusOkPaths = /^\/jobs$/;
await pg.evaluate(() => { S.fergConnected = false; return testFergus(); });
await pg.waitForTimeout(2500);
v = await pg.evaluate(() => S.fergConnected === true);
check('a Fergus that only answers a plain /jobs still reads as connected', v,
  JSON.stringify(fergusPaths));
check('…having tried the rich query first, so nothing is given up cheaply',
  /sortField/.test(fergusPaths[0] || ''), fergusPaths[0] || '(none)');

// A key the API rejects is NOT a query-string problem — don't hammer it.
fergusPaths = [];
fergusOkPaths = /.^/;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/fergus/**',
  r => { fergusPaths.push(r.request().url()); return r.fulfill({ status:401,
    contentType:'application/json', body: JSON.stringify({ message:'Unauthorized' }) }); });
await pg.evaluate(() => { S.fergConnected = false; return testFergus().catch(()=>{}); });
await pg.waitForTimeout(1800);
check('a rejected key fails on the first call rather than being retried four times',
  fergusPaths.length === 1, fergusPaths.length + ' calls');

check('no page errors anywhere in that', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
