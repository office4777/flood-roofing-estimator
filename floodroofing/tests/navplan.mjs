// The nav has to match the plan, and there has to be a way out.
//
// Two things a new account showed up with: every tab, Email and Schedule
// included, whatever plan the business was on — you found out a tab was not
// yours by opening it and reading a locked card — and no sign-out anywhere.
// doLogout() existed and nothing called it, so leaving an account meant
// clearing the browser's storage. On a shared office machine that is not a
// small thing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(company){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  // Confirms are answered in the PAGE, not by a Playwright dialog listener.
  // The listener was the flake: sign-out opens a confirm and reloads, and on
  // a loaded CI runner the accept and the reload could cross so the click
  // came back with the session still up — a red build with nothing wrong
  // with the app. Answering in the page is the same question asked the same
  // way, decided before the click returns, and it lets the test check that
  // saying NO keeps you signed in, which the listener could never do.
  pg.on('dialog', d => d.accept());          // belt and braces for any other prompt
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/subscription/.test(u)) return j({ status:'active', billing:false, live:true, plan:'solo', trial:null });
    if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Acme Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
    return j([]);
  });
  // Seeded ONCE. Signing out reloads the page, and an init script that seeds
  // on every load would put the session straight back and hide the bug.
  await pg.addInitScript(([co]) => {
    // Runs again after the sign-out reload, which is where it is needed.
    // Kept in sessionStorage, not on window: a reload wipes window, and the
    // whole question when this fails is whether the page reloaded and, if it
    // did, whether sign-out was what reloaded it.
    window.__confirms = [];
    window.__confirmAnswer = true;
    window.confirm = function(m){
      window.__confirms.push(String(m));
      try { sessionStorage.setItem('__asked', String((+sessionStorage.getItem('__asked') || 0) + 1)); } catch(e){}
      return window.__confirmAnswer !== false;
    };
    try { sessionStorage.setItem('__loads', String((+sessionStorage.getItem('__loads') || 0) + 1)); } catch(e){}
    window.addEventListener('error', function(ev){
      try { sessionStorage.setItem('__err', String((ev && ev.message) || 'error')); } catch(e){}
    });
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
    localStorage.setItem('fr_user', JSON.stringify({ email:'bob@acmeroofing.co.nz', name:'Bob' }));
    localStorage.setItem('fr_company', JSON.stringify(co));
  }, [company]);
  await pg.goto('file://' + _j(DIR, 'app.html'));
  // Wait for the app to be READY, not for a stopwatch. Under the parallel
  // runner four browsers share the machine and 2600ms was sometimes short of
  // boot: the sign-out click then landed on a button whose handler did not
  // exist yet, nothing happened, and the suite reported sign-out as broken.
  // A flake that fails one run in four is worse than no test, because it
  // teaches everyone to re-run instead of look.
  await pg.waitForFunction(
    () => typeof window.doLogout === 'function' &&
          typeof window._navPlanSync === 'function' &&
          !!document.getElementById('navSignOutBtn'),
    null, { timeout: 30000 });
  await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
  return { ctx, pg };
}
const shown = (pg, id) => pg.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && getComputedStyle(el).display !== 'none';
}, id);

const LIMITS = (o) => Object.assign({ seats:1, slug:false, domain:false, jms:false, schedule:false, inbox:false }, o||{});

// ── Solo: no Email, no Schedule ──────────────────────────────────
let { ctx, pg } = await open({ id:'c1', name:'Acme Roofing Ltd', role:'owner', plan:'solo', limits: LIMITS() });
check('a Solo account is not offered the Email tab', !(await shown(pg,'navInboxBtn')));
check('…nor the Schedule tab', !(await shown(pg,'navScheduleBtn')));
// The banner buttons are the same feature as the Email tab: chat, the team
// task board and the personal to-do list all call /inbox/..., which the
// server refuses below Business. A visible button that can only error is
// worse than no button.
check('…nor the banner\'s Internal chat button', !(await shown(pg,'gtbChatBtn')));
check('…nor the team Tasks dropdown', !(await shown(pg,'gtbTasksBtn')));
check('…nor My To Do List, which is the same task board', !(await shown(pg,'gtbTodoBtn')));
check('…while the banner itself and the AI Assistant stay, being on every plan',
  (await shown(pg,'globalTopBar')) &&
  /AI Assistant/.test(await pg.evaluate(() => document.getElementById('globalTopBar').textContent)));
check('…while the tabs that ARE theirs are untouched',
  (await shown(pg,'navRoofBtn')) && (await shown(pg,'navQuoteBtn')) && (await shown(pg,'navSettingsBtn')));

// ── the way out ──────────────────────────────────────────────────
check('there is a sign-out button', await shown(pg,'navSignOutBtn'));
check('…and it says who is signed in',
  /bob@acmeroofing\.co\.nz/.test(await pg.evaluate(() => document.getElementById('navAccountWho').textContent)));
// Sign-out asks first, and NO means no — a misfired click on the way past
// the account line must not drop a roofer's session mid-quote.
await pg.evaluate(() => { window.__confirmAnswer = false; });
await pg.click('#navSignOutBtn');
await pg.waitForTimeout(400);
const declined = await pg.evaluate(() => ({
  asked: window.__confirms.length, tok: localStorage.getItem('fr_token') }));
check('signing out asks before it does anything', declined.asked === 1,
  declined.asked + ' asked');
// It must not wait on the server to let you out. This used to await the
// logout POST, so on a slow link — or a loaded test machine — you were still
// looking at a signed-in app long after you asked to leave it.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(_j(_ROOT, 'frontend', 'app.html'), 'utf8');
  const fn = src.slice(src.indexOf('async function _navSignOut'), src.indexOf('async function _navSignOut') + 1400);
  check('…and never waits on the network to let you out',
    !/await api\('POST', '\/auth\/logout'/.test(fn) && /auth\/logout/.test(fn),
    fn.split('\n').filter(l => /logout/.test(l)).join(' | ').slice(0, 150));
}
check('…and saying no keeps you signed in', declined.tok === 't', JSON.stringify(declined));

// Yes means yes: the session is dropped and the reload returns the page to
// the login screen. The wait is on the CONDITION, not a stopwatch — a slow
// reload on a shared runner is not a bug.
await pg.evaluate(() => {
  window.__confirmAnswer = true;
  // Did the click reach the handler at all? Recorded in sessionStorage,
  // which survives the reload sign-out causes — window does not.
  var real = window._navSignOut;
  window._navSignOut = function(){
    try { sessionStorage.setItem('__signout', 'entered'); } catch(e){}
    return real.apply(this, arguments);
  };
  try { sessionStorage.removeItem('__signout'); } catch(e){}
});
await Promise.all([ pg.waitForNavigation({ timeout: 20000 }).catch(() => null),
                    pg.click('#navSignOutBtn') ]);
await pg.waitForFunction(() => !localStorage.getItem('fr_token'), null, { timeout: 20000 }).catch(() => null);
await pg.waitForFunction(() => {
  const el = document.getElementById('login-screen');
  return !!el && getComputedStyle(el).display !== 'none';
}, null, { timeout: 20000 }).catch(() => null);
// Report enough to tell the two halves apart when this fails: whether the
// button was clicked and the question asked at all (asked === 2), or whether
// it was asked and the sign-out still did not finish. Without that a failure
// here is a guess, and this one has been guessed at twice.
const after = await pg.evaluate(() => ({
  tok: localStorage.getItem('fr_token'), user: localStorage.getItem('fr_user'),
  co: localStorage.getItem('fr_company'),
  asked: (window.__confirms || []).length,
  askedEver: sessionStorage.getItem('__asked'),
  entered: sessionStorage.getItem('__signout'),
  loads: sessionStorage.getItem('__loads'),
  err: sessionStorage.getItem('__err'),
  seeded: sessionStorage.getItem('__seeded'),
  login: (function(){ const el = document.getElementById('login-screen');
    return !!el && getComputedStyle(el).display !== 'none'; })() }));
check('signing out drops the session, not just the screen',
  !after.tok && !after.user && !after.co, JSON.stringify(after));
check('…and lands back on the login screen', after.login, JSON.stringify(after));
await ctx.close();

// ── the job-management screen, below the plan that carries it ────
// Nothing on it a person could act on, so it offers the upgrade instead of a
// page of settings that all refuse. Its own context: the sign-out above is
// destructive, and this has to be looked at on a live session.
({ ctx, pg } = await open({ id:'c1', name:'Acme Roofing Ltd', role:'owner', plan:'solo', limits: LIMITS() }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-jms'); });
await pg.waitForTimeout(400);
check('a plan without the link is offered the upgrade, not dead settings',
  (await shown(pg,'jmsLockedPane')) && !(await shown(pg,'jmsLivePane')));
const lockTxt = await pg.evaluate(() => document.getElementById('jmsLockedPane').textContent);
check('…naming both plans that carry it, with their prices',
  /Team/.test(lockTxt) && /Business/.test(lockTxt) && /\$299/.test(lockTxt) && /\$549/.test(lockTxt),
  lockTxt.replace(/\s+/g, ' ').slice(0, 80));
await ctx.close();

// ── it must not turn into a saying-no machine ────────────────────
({ ctx, pg } = await open({ id:'c1', name:'Acme Roofing Ltd', role:'owner', plan:'business',
                            limits: LIMITS({ seats:15, slug:true, domain:true, jms:true, schedule:true, inbox:true }) }));
check('a Business account keeps the Email tab', await shown(pg,'navInboxBtn'));
check('…and the Schedule tab', await shown(pg,'navScheduleBtn'));
check('…and the Internal chat button', await shown(pg,'gtbChatBtn'));
check('…and both task dropdowns',
  (await shown(pg,'gtbTasksBtn')) && (await shown(pg,'gtbTodoBtn')));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-jms'); });
await pg.waitForTimeout(400);
check('…and the real job-management settings, not the upgrade panel',
  (await shown(pg, 'jmsLivePane')) && !(await shown(pg, 'jmsLockedPane')));
await ctx.close();

// An older cached company, from before the server sent limits at all. Hiding a
// tab somebody is paying for is the worse failure, so silence means show.
({ ctx, pg } = await open({ id:'c1', name:'Acme Roofing Ltd', role:'owner' }));
check('a company brief with no plan in it keeps every tab', await shown(pg,'navInboxBtn'));
check('…including the banner buttons, since silence must not hide paid-for things',
  (await shown(pg,'gtbChatBtn')) && (await shown(pg,'gtbTasksBtn')) && (await shown(pg,'gtbTodoBtn')));
await ctx.close();

// ── standing on a tab that is not yours ──────────────────────────
({ ctx, pg } = await open({ id:'c1', name:'Acme Roofing Ltd', role:'owner', plan:'business',
                            limits: LIMITS({ schedule:true, inbox:true }) }));
await pg.evaluate(() => gotoTab('inbox'));
await pg.waitForTimeout(300);
check('(sanity) the Email tab opens on a plan that has it',
  await pg.evaluate(() => document.body.getAttribute('data-tab')) === 'inbox');
await pg.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('fr_company'));
  c.limits.inbox = false; localStorage.setItem('fr_company', JSON.stringify(c));
  _navPlanSync();
});
await pg.waitForTimeout(300);
check('…and takes the banner buttons with it', !(await shown(pg,'gtbTasksBtn')));
check('losing the plan while standing on the tab moves you off it, not into a dead screen',
  await pg.evaluate(() => document.body.getAttribute('data-tab')) !== 'inbox',
  await pg.evaluate(() => document.body.getAttribute('data-tab')));
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
