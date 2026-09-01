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
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
    localStorage.setItem('fr_user', JSON.stringify({ email:'bob@acmeroofing.co.nz', name:'Bob' }));
    localStorage.setItem('fr_company', JSON.stringify(co));
  }, [company]);
  await pg.goto('file://' + _j(DIR, 'app.html'));
  await pg.waitForTimeout(2600);
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
// Confirm-then-clear. The reload is what returns the page to the login screen.
pg.on('dialog', d => d.accept());
await Promise.all([ pg.waitForNavigation({ timeout: 15000 }).catch(() => null), pg.click('#navSignOutBtn') ]);
// Wait for the CONDITION, not a stopwatch. A fixed sleep here passed alone
// and failed under the parallel runner, where the reload has to share a
// machine with three other browsers — a slow reload is not a bug.
await pg.waitForFunction(() => !localStorage.getItem('fr_token'), null, { timeout: 20000 }).catch(() => null);
await pg.waitForTimeout(300);
const after = await pg.evaluate(() => ({
  tok: localStorage.getItem('fr_token'), user: localStorage.getItem('fr_user'),
  co: localStorage.getItem('fr_company'),
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
