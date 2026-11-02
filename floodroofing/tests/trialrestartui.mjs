// A SECOND GO AT THE TRIAL — the app's half (2026-11-03). The win-back email's
// button is /app?restart=trial: signed in, the trial restarts at once and says
// so; signed out, the sign-in screen says why they are there and the wish
// survives the sign-in. The trial-ended window offers the same button to any
// business the server says may restart (restart_ok), and to nobody else.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const ended = (over) => Object.assign({ status: 'trialing', billing: true, live: false, plan: 'trial', restart_ok: true,
  trial: { ends_at: new Date(Date.now() - 40 * 864e5).toISOString(), days_left: 0, expired: true, days: 14 } }, over || {});
const fresh = { status: 'trialing', billing: true, live: true, plan: 'trial', restart_ok: false,
  trial: { ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), days_left: 30, expired: false, days: 30, roofs_limit: 3, roofs_used: 0, roofs_left: 3, roof_jobs: [] } };

const b = await chromium.launch();
async function open(o){
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  const pg = await ctx.newPage();
  const posts = [];
  let restarted = false;
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    const j = (x, st) => r.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/\/billing\/trial-restart/.test(u) && m === 'POST'){ posts.push(u); restarted = true; return j({ ok: true, roofs: 3, days: 30 }); }
    if (/\/subscription/.test(u)) return j(restarted ? fresh : o.sub);
    if (/\/settings/.test(u)) return j({ user_id: 'u1', branding: { company_name: 'Acme Roofing Ltd', phone: '09 123 4567', email: 'o@a.co.nz' },
      quote_defaults: { next_job_no: '00001' }, jms_keys: {} });
    return j([]);
  });
  await pg.addInitScript((signedIn) => {
    if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('fr_setup_done', '1'); localStorage.removeItem('fr_settings');
    if (signedIn){
      localStorage.setItem('fr_token', 't');
      localStorage.setItem('fr_user', JSON.stringify({ email: 'bob@acmeroofing.co.nz', name: 'Bob' }));
      localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Acme Roofing Ltd', role: 'owner' }));
    }
  }, o.signedIn !== false);
  await pg.goto('file://' + _j(DIR, 'app.html') + (o.q || ''));
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  const modal = () => pg.evaluate(() => { const el = document.getElementById('planGateModal');
    return { shown: !!el && el.style.display === 'flex', txt: el ? el.textContent.replace(/\s+/g, ' ') : '' }; });
  return { ctx, pg, posts, modal };
}

// ── the trial-ended window offers it ──
let t = await open({ sub: ended() });
let m = await t.modal();
check('an early trial that ran out sees the offer in the trial-ended window',
  m.shown && /Your free trial has ended/.test(m.txt) && /Restart my free trial/.test(m.txt) && /3 real roofs or 30 days/.test(m.txt), m.txt.slice(0, 220));
check('…and nothing is restarted until asked', t.posts.length === 0, String(t.posts.length));
await t.pg.click('#pgRestartBtn');
await t.pg.waitForTimeout(600);
m = await t.modal();
check('the button restarts it and says so', t.posts.length === 1 && m.shown && /Your free trial has restarted/.test(m.txt) && /3 real roofs or 30 days/.test(m.txt), m.txt.slice(0, 200));
check('…the banner now reads the new trial', await t.pg.evaluate(() => /3 of 3 free roofs left/.test((document.getElementById('trialBanner') || {}).textContent || '')));
await t.pg.click('#pgRestarted button');
check('…and Start measuring closes it', await t.pg.evaluate(() => document.getElementById('planGateModal').style.display === 'none'));
await t.ctx.close();

// ── nobody else is offered it ──
t = await open({ sub: ended({ restart_ok: false }) });
m = await t.modal();
check('a trial the server will not restart is not offered it', m.shown && !/Restart my free trial/.test(m.txt), m.txt.slice(0, 160));
await t.ctx.close();

// ── the email's link, signed in ──
t = await open({ sub: ended(), q: '?restart=trial' });
m = await t.modal();
check('the email link restarts the trial straight away', t.posts.length === 1 && m.shown && /Your free trial has restarted/.test(m.txt), t.posts.length + ' ' + m.txt.slice(0, 120));
check('…takes the wish out of the address bar and off the device',
  await t.pg.evaluate(() => !/restart=/.test(location.search) && !localStorage.getItem('fr_restart_trial')));
await t.ctx.close();

// ── the email's link on a trial still running: nothing to do, nothing said ──
t = await open({ sub: fresh, q: '?restart=trial' });
m = await t.modal();
check('a trial still running is left alone', t.posts.length === 0 && !m.shown, t.posts.length + ' ' + m.shown);
await t.ctx.close();

// ── the email's link, signed out ──
t = await open({ sub: ended(), q: '?restart=trial', signedIn: false });
const li = await t.pg.evaluate(() => ({ screen: getComputedStyle(document.getElementById('login-screen')).display !== 'none',
  note: (function(){ const n = document.getElementById('li-restart-note'); return n && n.style.display !== 'none' ? n.textContent : ''; })(),
  kept: !!localStorage.getItem('fr_restart_trial') }));
check('signed out, the sign-in screen says they are here to restart their trial', li.screen && /Sign in to restart your free trial/.test(li.note), JSON.stringify(li));
check('…and the wish is kept for after the sign-in', li.kept);
// Signing in brings the subscription read, which acts on it.
await t.pg.evaluate(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_user', JSON.stringify({ email: 'bob@acmeroofing.co.nz' })); });
await t.pg.evaluate(() => loadSubscription());
await t.pg.waitForTimeout(500);
m = await t.modal();
check('…which restarts it once they are in', t.posts.length === 1 && /Your free trial has restarted/.test(m.txt), t.posts.length + ' ' + m.txt.slice(0, 100));
await t.ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
