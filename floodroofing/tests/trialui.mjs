// The browser half: a trial must not run out silently. Quiet for most of the
// fortnight, insistent at the end — and it must never say "0 days left" to
// somebody who still has an afternoon.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(sub){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/subscription/.test(u)) return sub === undefined
      ? r.fulfill({status:500,contentType:'application/json',body:'{"error":"boom"}'}) : j(sub);
    if (/\/settings/.test(u)) return j({ user_id:'u1',
      branding:{ company_name:'Acme Roofing Ltd', phone:'09 123 4567', email:'o@a.co.nz' },
      quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'bob@acmeroofing.co.nz', name:'Bob' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
  await pg.goto('file://' + _j(DIR, 'app.html'));
  await pg.waitForTimeout(2600);
  await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
  const txt = await pg.evaluate(() => {
    const el = document.getElementById('trialBanner');
    return { html: el ? el.innerHTML.trim() : '', txt: el ? el.textContent.replace(/\s+/g,' ').trim() : '',
             cls: el && el.firstElementChild ? el.firstElementChild.className : '' };
  });
  return { ctx, pg, txt };
}
const trial = (d, expired) => ({ status: expired ? 'trialing' : 'trialing', billing:true, live: !expired,
  plan:'trial', trial:{ ends_at:new Date(Date.now()+d*864e5).toISOString(), days_left:d, expired: !!expired } });
// What every business signing up now looks like: no trial object at all.
const pending = (over) => ({ status:'pending', billing:true, live:false, plan:'trial',
  trial:null, ...(over||{}) });

// ── quiet when there's plenty of time ──
let { ctx, txt } = await open(trial(14));
check('nothing is said on day one', txt.html === '', txt.txt.slice(0,50));
await ctx.close();
({ ctx, txt } = await open(trial(8)));
check('…nor with eight days to go', txt.html === '');
await ctx.close();

// ── a quiet note in the last week ──
({ ctx, txt } = await open(trial(7)));
check('a quiet note appears in the last week', /7 days left/.test(txt.txt) && /tb-calm/.test(txt.cls), txt.txt.slice(0,64));
check('…that says nothing gets deleted', /Nothing is deleted/.test(txt.txt));
await ctx.close();

// ── amber in the last three days ──
({ ctx, txt } = await open(trial(3)));
check('it turns amber in the last three days', /tb-soon/.test(txt.cls) && /3 days left/.test(txt.txt), txt.cls);
await ctx.close();
({ ctx, txt } = await open(trial(1)));
check('…and reads "tomorrow" on the last day, not "1 days"', /ends tomorrow/.test(txt.txt), txt.txt.slice(0,54));
await ctx.close();
({ ctx, txt } = await open(trial(0)));
check('…and "today" on the day itself', /ends today/.test(txt.txt), txt.txt.slice(0,50));
await ctx.close();

// ── and red once it's gone ──
({ ctx, txt } = await open(trial(0, true)));
check('an expired trial says so, in red', /tb-out/.test(txt.cls) && /trial has ended/.test(txt.txt), txt.cls);
check('…and reassures them their work is still there', /jobs are all still here/.test(txt.txt), txt.txt.slice(0,90));
// With billing ON the way to carry on is a button into Settings → Billing;
// the email address is the billing-off fallback.
check('…and says how to carry on', /Choose a plan/.test(txt.txt), txt.txt.slice(0,90));
await ctx.close();

// ── a paying subscriber is never nagged ──
({ ctx, txt } = await open({ status:'active', billing:true, live:true, plan:'business', trial:null }));
check('a paying subscriber is never shown a countdown', txt.html === '', txt.txt.slice(0,40));
await ctx.close();

// ── the shape with no trial: a pending business must be PROMPTED, not
//    left to discover the gate as a 403 on their first save ──
({ ctx, txt } = await open(pending()));
check('a business with no trial is told to pick a plan',
  /Pick a plan to start saving jobs/.test(txt.txt), txt.txt.slice(0,80));
check('…without being told a trial ended that it never had',
  !/trial/i.test(txt.txt), txt.txt.slice(0,120));
check('…and is told it can look around first, so the ask does not read as a wall',
  /Look around/.test(txt.txt) && /demo job/.test(txt.txt), txt.txt.slice(0,140));
// seo.mjs enforces this pairing on every public page; the in-app copy makes the
// same promise, so it has to carry the same terms.
// No founding discount since 2026-10-23: the bar must not promise one.
check('…and promises no discount, because there is none',
  !/30%/.test(txt.txt) && !/founding/i.test(txt.txt), txt.txt.slice(0,200));
check('…and it is a calm bar, not the red expired one',
  /tb-calm/.test(txt.cls) && !/tb-out/.test(txt.cls), txt.cls);
await ctx.close();

// A paid-up account must never see it, whether or not a trial was ever set.
({ ctx, txt } = await open(pending({ status:'active', live:true })));
check('a paying business with no trial is shown nothing', txt.html === '', txt.txt.slice(0,60));
await ctx.close();

// Before billing is switched on the gate is open, so nagging would be a lie —
// they can save. live:false here is deliberately a combination the backend
// would never send (it returns live:true whenever billing is off), because the
// bar must not depend on those two agreeing in order to stay honest.
({ ctx, txt } = await open(pending({ billing:false })));
check('…and nothing is said while billing is switched off', txt.html === '', txt.txt.slice(0,60));
await ctx.close();

// ── and a broken endpoint never breaks the app ──
({ ctx, txt } = await open(undefined));
check('a failed subscription check is silent, not a broken app', txt.html === '');
const stillWorks = await ctx.pages()[0].evaluate(() => typeof gotoTab === 'function' && !!document.getElementById('homeBoardTiles'));
check('…and the app still works', stillWorks);
await ctx.close();

// ── the window a trial ends on ────────────────────────────────────
// A banner is easy to scroll past, and the first thing an expired account
// used to meet was a 403 on saving a job. The plans come to them instead.
{
  const { ctx, pg } = await open(trial(0, true));
  const v = await pg.evaluate(() => {
    const el = document.getElementById('planGateModal');
    return { shown: !!el && el.style.display !== 'none',
             txt: el ? el.textContent.replace(/\s+/g,' ').trim() : '',
             btns: el ? [...el.querySelectorAll('.pg-card button')].map(b => b.textContent.trim()) : [] };
  });
  check('an ended trial is met by the plan window, not a banner alone', v.shown);
  check('…it says the trial ended and the work is safe',
    /trial has ended/i.test(v.txt) && /nothing has been deleted/i.test(v.txt), v.txt.slice(0, 120));
  // Business went off sale on 2026-10-23.
  check('…it offers the three plans with their prices, and not Business',
    v.btns.length === 3 && /Measure/.test(v.btns[0]) && /Trade/.test(v.btns[1]) && /Team/.test(v.btns[2]) &&
    /\$79/.test(v.txt) && /\$149/.test(v.txt) && /\$299/.test(v.txt) && !/\$549/.test(v.txt), JSON.stringify(v.btns));
  check('…and says paying is month to month and cancellable',
    /cancel any time/i.test(v.txt) && /Settings . Billing/i.test(v.txt), v.txt.slice(-220));
  // There is no way past it. An account that cannot save a job must not be
  // able to half-use the app either — that shape reads as broken rather than
  // as unpaid, and it is how somebody spends an hour drawing a roof they are
  // then refused the right to keep.
  const v2 = await pg.evaluate(() => ({
    close: !!document.querySelector('#planGateModal .pg-close'),
    later: [...document.querySelectorAll('#planGateModal .pg-later')].map(b => b.textContent.trim()),
    scroll: document.body.style.overflow,
  }));
  check('…there is no close button and no "not now"',
    !v2.close && !v2.later.some(t => /not right now/i.test(t)), JSON.stringify(v2));
  check('…the app behind it cannot be scrolled', v2.scroll === 'hidden', v2.scroll);
  check('…but signing out is always possible',
    v2.later.some(t => /sign out/i.test(t)), JSON.stringify(v2.later));
  await ctx.close();
}

// A paying business must never see it.
{
  const { ctx, pg } = await open({ status:'active', billing:true, live:true, plan:'team', trial:null });
  check('a paying business is never shown the plan window',
    await pg.evaluate(() => !document.getElementById('planGateModal')));
  await ctx.close();
}

// Billing off = nothing is gated, so selling a plan would be a lie.
{
  const { ctx, pg } = await open({ status:'pending', billing:false, live:true, plan:'trial', trial:null });
  check('with billing switched off nobody is shown it either',
    await pg.evaluate(() => !document.getElementById('planGateModal')));
  await ctx.close();
}

// ── THE ROOF TRIAL (2026-10-23): 3 real roofs or 30 days ──
const roofTrial = (left, extra) => Object.assign({ status:'trialing', billing:true, live:true, plan:'trial',
  trial:{ ends_at:new Date(Date.now()+24*864e5).toISOString(), days_left:24, expired:false, days:30,
          roofs_limit:3, roofs_used:3-left, roofs_left:left, roof_jobs: left === 3 ? [] : ['job-a','job-b','job-c'].slice(0, 3-left) } }, extra || {});
{
  const { ctx, txt } = await open(roofTrial(3));
  check('a roof trial shows its counter from day one, not just at the end',
    /3 of 3 free roofs left/.test(txt.txt) && /24 days left/.test(txt.txt) && /tb-calm/.test(txt.cls), txt.txt.slice(0, 120));
  check('…and says what counts as a roof, and that the practice job never does',
    /outline and a scale/.test(txt.txt) && /practice job never does/.test(txt.txt), txt.txt);
  await ctx.close();
}
{
  const { ctx, txt } = await open(roofTrial(1));
  check('one roof left turns it amber', /1 of 3 free roofs left/.test(txt.txt) && /tb-soon/.test(txt.cls), txt.txt.slice(0, 80) + ' ' + txt.cls);
  await ctx.close();
}
{
  const { ctx, pg, txt } = await open(roofTrial(0));
  check('all three used: the bar says so, and that the three stay open',
    /measured your 3 free roofs/.test(txt.txt) && /stay open for 24 days/.test(txt.txt), txt.txt.slice(0, 160));
  check('…but no window is forced on them — they can still work their three roofs',
    await pg.evaluate(() => { const m = document.getElementById('planGateModal'); return !m || m.style.display === 'none'; }));
  // A new job, measured: the roof is not built, the plans come up instead.
  const r = await pg.evaluate(() => {
    S.isSampleJob = false; S.currentJobId = null; S.versionOf = null;
    DRAW.outline = [[100,100],[400,100],[400,300],[100,300]]; DRAW.scaleMetresPerPx = 0.03; DRAW.lines = [];
    autoGenerateRoof('gable');
    return { lines: DRAW.lines.length, blocked: _trialRoofsBlocked() };
  });
  await pg.waitForTimeout(500);
  const m = await pg.evaluate(() => { const el = document.getElementById('planGateModal');
    return { shown: !!el && el.style.display === 'flex', txt: el ? el.textContent.replace(/\s+/g, ' ') : '',
             back: !!document.getElementById('pgBackToRoofs') }; });
  check('a 4th roof is stopped before it is built', r.blocked && r.lines === 0, JSON.stringify(r));
  check('…by the plans window, naming the 3 free roofs',
    m.shown && /measured your 3 free roofs/.test(m.txt) && /stay open until your trial ends/.test(m.txt), m.txt.slice(0, 200));
  check('…which can be closed, because the account still works', m.back);
  await pg.click('#pgBackToRoofs');
  check('…and closes', await pg.evaluate(() => document.getElementById('planGateModal').style.display === 'none'));
  // One of the three counted jobs is never stopped.
  const ok = await pg.evaluate(() => { S.currentJobId = 'job-b'; return _trialRoofsBlocked(); });
  check('a job that already used one of the three is never stopped', ok === false);
  const ver = await pg.evaluate(() => { S.currentJobId = 'job-b-v2'; S.versionOf = 'job-b'; return _trialRoofsBlocked(); });
  check('…nor a version of one', ver === false);
  const smp = await pg.evaluate(() => { S.currentJobId = null; S.versionOf = null; S.isSampleJob = true; return _trialRoofsBlocked(); });
  check('…nor the practice job or the sample', smp === false);
  await ctx.close();
}

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
