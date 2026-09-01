// The diagnostic card a subscriber actually presses.
//
// The old screen put four Fergus account-id boxes and a paragraph about
// trailing numbers in URLs in front of every roofer who opened the page —
// developer setup, shown as if it were the main event. The main event is now
// "Something not working?": describe it in your own words, press once, carry
// on. The account ids are still reachable (a materials push has nowhere to
// file its lines without them) but folded away.
//
// This drives the real app.html, so it fails if the button is wired to
// nothing — which is exactly how the admin page shipped broken once before.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const posted = [];
let holdDiagnose = null;          // set to a promise to keep the request in flight

async function open(){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
    const u = r.request().url(), m = r.request().method();
    if (/\/jms\/diagnose/.test(u) && m === 'POST'){
      posted.push(r.request().postDataJSON());
      if (holdDiagnose) await holdDiagnose;
      return r.fulfill({ status: 202, contentType: 'application/json',
        body: JSON.stringify({ queued: true, to: 'support@roofmap.co.nz' }) });
    }
    if (/\/settings/.test(u))
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ branding: { company_name: 'Kauri Roofing Ltd' }, quote_defaults: {}, jms_keys: {} }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript(() => {
    localStorage.setItem('fr_token', 't');
    localStorage.setItem('fr_setup_done', '1');
    localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email: 'bob@kauri.co.nz' }));
    localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Kauri Roofing Ltd',
      plan: 'team', limits: { seats: 5, slug: true, domain: false, jms: true, schedule: true, inbox: false } }));
  });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  // Settings → Job Management Software, which is where the card lives.
  await pg.evaluate(() => {
    try { document.getElementById('selectJobOverlay').style.display = 'none';
          document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
    gotoTab('settings');
    switchSettingsSub('set-jms', document.getElementById('jmsSubTabBtn'));
  });
  await pg.waitForTimeout(600);
  return { ctx, pg, errs };
}
const shown = (pg, id) => pg.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}, id);

const { ctx, pg, errs } = await open();

// ── what a roofer sees first ──────────────────────────────────────
check('the diagnostic card is on the job-management screen', await shown(pg, 'jmsDiagCard'));
check('…asking for the problem in plain words, not for an account id',
  /what is going wrong/i.test(await pg.evaluate(() =>
    (document.getElementById('jmsDiagCard') || {}).textContent || '')));

// The account boxes still exist — the push has nowhere to file its material
// lines without them — but they sit inside a closed <details>.
//
// Note on the assertion: a closed <details> in Chromium still LAYS OUT its
// contents (offsetWidth stays non-zero); it skips painting them. So the
// honest test of "on the screen" is Playwright's own visibility, not a
// measured box — measuring passes whether the fold works or not.
check('the Fergus account-id boxes exist for when support asks',
  await pg.evaluate(() => !!document.getElementById('intFergusMatAcct')));
check('…but are folded away, not shouted at every user',
  (await pg.evaluate(() => !document.getElementById('intFergusMatAcct').closest('details').open)) &&
  !(await pg.isVisible('#intFergusMatAcct')));
await pg.click('#intFergusMatAcct >> xpath=ancestor::details/summary');
await pg.waitForTimeout(200);
check('…and one click on the summary brings them out',
  await pg.isVisible('#intFergusMatAcct'));

// ── it will not send nothing ──────────────────────────────────────
await pg.click('#jmsDiagBtn');
await pg.waitForTimeout(400);
check('pressing it empty asks for a description instead of sending',
  posted.length === 0 &&
  /tell us what is going wrong/i.test(await pg.evaluate(() =>
    (document.getElementById('jmsDiagMsg') || {}).textContent || '')),
  posted.length + ' posted');

// ── the loading state, while the request is in flight ─────────────
let release;
holdDiagnose = new Promise(r => { release = r; });
await pg.fill('#jmsDiagWhat', 'Pushed a quote and the materials did not come across, only the labour.');
await pg.click('#jmsDiagBtn');
await pg.waitForTimeout(300);
const during = await pg.evaluate(() => ({
  spinner: (function(){ const s = document.getElementById('jmsDiagSpin');
    return !!s && getComputedStyle(s).display !== 'none'; })(),
  label: (document.getElementById('jmsDiagBtnText') || {}).textContent || '',
  disabled: !!(document.getElementById('jmsDiagBtn') || {}).disabled,
  msg: (document.getElementById('jmsDiagMsg') || {}).textContent || '',
}));
check('a spinner shows while it is working', during.spinner, JSON.stringify(during));
check('…the button says what it is doing and cannot be pressed twice',
  /sending/i.test(during.label) && during.disabled, during.label + ' disabled=' + during.disabled);
check('…and the wait is explained rather than left blank', /checking/i.test(during.msg), during.msg);

release();
await pg.waitForTimeout(600);

// ── what was sent, and what it says afterwards ────────────────────
check('exactly one check was sent', posted.length === 1, posted.length + ' posted');
check('…carrying the roofer\'s own description', /materials did not come across/.test((posted[0] || {}).problem || ''),
  JSON.stringify(posted[0] || {}).slice(0, 90));
const after = await pg.evaluate(() => ({
  msg: (document.getElementById('jmsDiagMsg') || {}).textContent || '',
  spinner: (function(){ const s = document.getElementById('jmsDiagSpin');
    return !!s && getComputedStyle(s).display !== 'none'; })(),
  label: (document.getElementById('jmsDiagBtnText') || {}).textContent || '',
  disabled: !!(document.getElementById('jmsDiagBtn') || {}).disabled,
  box: (document.getElementById('jmsDiagWhat') || {}).value,
}));
check('the spinner stops', !after.spinner, JSON.stringify(after).slice(0, 90));
check('…the button comes back', !after.disabled && /run the check/i.test(after.label), after.label);
check('…it says the report is on its way to support',
  /support/i.test(after.msg) && /✓/.test(after.msg), after.msg);
check('…and tells them to carry on working rather than wait',
  /carry on/i.test(after.msg), after.msg);
check('…and the box is cleared, so nobody sends it twice by accident',
  after.box === '', JSON.stringify(after.box));

check('no page errors anywhere in that', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
