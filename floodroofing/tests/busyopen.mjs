// "It just seems the app is frozen."
//
// Opening a job saves what is on screen, fetches the job and rebuilds the
// canvas from it — several seconds on a real drawing, during which nothing
// moved. And a Fergus job-number search waited for BOTH lookups before it
// painted anything, so typing 2971 sat on an empty list for a minute while
// the job-number lookup had answered in two seconds.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));

// The job fetch takes a beat, the way it does on a real drawing.
await pg.route('**/jobs/job-1', async r => {
  await new Promise(res => setTimeout(res, 900));
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'job-1', client_name: 'Sharon', site_address: '12 Kerikeri Rd', draw_state: {} }) });
});
// Fergus: the job-number lookup is quick, the text search is not. Which is
// the whole point — one of them should not hold the other up.
await pg.route('**/fergus/jobs**', async r => {
  const u = r.request().url();
  const jobNo = /filterJobNo=/.test(u);
  await new Promise(res => setTimeout(res, jobNo ? 150 : 3000));
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    value: jobNo
      ? [{ id: 'f-2971', jobNo: '2971', customer: 'Quick Answer', address: '9 Fast St' }]
      : [{ id: 'f-slow', jobNo: '8888', customer: 'Slow Text Search', address: '1 Late Ave' }] }) });
});
// Everything else is stubbed empty. fallback(), not continue(): continue()
// would go to the network and skip the two handlers above.
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  if (/\/jobs\/job-1|\/fergus\/jobs/.test(r.request().url())) return r.fallback();
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'a@b.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2200);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display='none'; document.getElementById('selectJobModal').style.display='none'; } catch(e){}
});

// ── the overlay exists and counts ────────────────────────────────
check('there is a busy overlay to put up', await pg.evaluate(() => !!document.getElementById('appBusy')));
const count = await pg.evaluate(() => {
  busyHide(true);
  busyShow('One');                    const a = document.getElementById('appBusy').style.display;
  busyShow('Two');                    // a nested operation takes a second reference
  busyHide();                         const b = document.getElementById('appBusy').style.display;
  busyHide();                         const c = document.getElementById('appBusy').style.display;
  return { a, b, c };
});
check('it shows when something starts', count.a === 'flex', count.a);
check('…stays up while a nested job is still working', count.b === 'flex', count.b);
check('…and comes down when the last one finishes', count.c === 'none', count.c);
const msg = await pg.evaluate(() => {
  busyHide(true); busyShow('Opening job…', 'first');
  busyMsg('Opening job…', 'second');   // a STEP, not a new operation
  busyHide();
  return { sub: document.getElementById('appBusySub').textContent, shown: document.getElementById('appBusy').style.display };
});
check('changing the words mid-job does not leave the overlay stuck on afterwards',
  msg.shown === 'none', msg.shown + ' / ' + msg.sub);

// ── opening a job puts it up for the whole wait ──────────────────
await pg.evaluate(() => { busyHide(true); window.__p = openJob('job-1'); });
await pg.waitForTimeout(350);
const during = await pg.evaluate(() => ({
  shown: document.getElementById('appBusy').style.display,
  msg: document.getElementById('appBusyMsg').textContent,
}));
check('opening a job says so straight away, instead of looking frozen',
  during.shown === 'flex' && /Opening job/i.test(during.msg), JSON.stringify(during));
await pg.evaluate(() => window.__p.catch(() => {}));
await pg.waitForTimeout(1600);
check('…and the overlay goes when the job is open',
  await pg.evaluate(() => document.getElementById('appBusy').style.display === 'none'));
// It must come down on a FAILED open too, or the app really is frozen.
await pg.evaluate(() => { window.alert = () => {}; busyHide(true); });
await pg.evaluate(() => openJob('job-missing').catch(() => {}));
await pg.waitForTimeout(600);
check('…and it goes when the open fails, too',
  await pg.evaluate(() => document.getElementById('appBusy').style.display === 'none'));

// ── a job number answers on the quick lookup ─────────────────────
await pg.evaluate(() => {
  S.fergConnected = true; S.fergJobsCache = [];
  const box = document.getElementById('selectJobFergList');
  if (box) box.innerHTML = '';
  _serverSearchSelectJobFergus('2971', _sjFergSearchSeq);
});
await pg.waitForTimeout(700);           // the job-number lookup has landed; the text search has not
const early = await pg.evaluate(() => (document.getElementById('selectJobFergList') || {}).innerHTML || '');
check('a job-number search shows the job as soon as Fergus answers on the number',
  /Job 2971/.test(early), early.replace(/<[^>]+>/g, ' ').trim().slice(0, 80));
check('…while still saying the slower search is running, so it does not read as "no such job"',
  /also checking Fergus/i.test(early), early.replace(/<[^>]+>/g, ' ').trim().slice(-60));
await pg.waitForTimeout(3200);
const late = await pg.evaluate(() => ({
  html: (document.getElementById('selectJobFergList') || {}).innerHTML || '',
  cached: (S.fergJobsCache || []).map(j => String(j.jobNo || j.displayNo || '')).sort().join(','),
}));
check('…the slower text search still lands, into the cache behind it',
  /8888/.test(late.cached) && /2971/.test(late.cached), late.cached);
check('…and once both are in, the list stops saying it is still looking',
  /Job 2971/.test(late.html) && !/also checking Fergus/i.test(late.html),
  late.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 80));

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
