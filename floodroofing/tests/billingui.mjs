// The office side of Stripe: the Billing section in Settings, the trial
// banner's "Choose a plan", and the hand-off to Stripe Checkout. The backend
// is faked at the network edge.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(sub){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  const checkouts = [];
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = new URL(r.request().url());
    const j = x => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (u.pathname === '/subscription') return j(sub);
    if (u.pathname === '/billing/checkout'){
      checkouts.push(JSON.parse(r.request().postData() || '{}'));
      return j({ url: 'https://checkout.stripe.test/cs_1' });
    }
    if (/\/settings/.test(u.pathname)) return j({ user_id:'u1', branding:{company_name:'Acme'}, quote_defaults:{next_job_no:'0001'}, jms_keys:{} });
    return j([]);
  });
  await pg.route('https://checkout.stripe.test/**', r => r.fulfill({status:200,contentType:'text/html',body:'<title>stripe</title>checkout'}));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings'); });
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2600);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  return { ctx, pg, checkouts };
}

// ── an expired trial with billing ON ──────────────────────────────
let { ctx, pg, checkouts } = await boot({ status:'trialing', billing:true, live:false,
  trial:{ ends_at:'2026-08-01T00:00:00Z', days_left:0, expired:true }, plan:'trial' });
let v = await pg.evaluate(() => (document.getElementById('trialBanner')||{}).textContent || '');
check('the expired banner offers a button, not an email address',
  /Choose a plan/.test(v) && !/office@floodroofing/.test(v), v.replace(/\s+/g,' ').slice(0,90));

await pg.click('#trialBanner button');
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  tab: document.body.getAttribute('data-tab'),
  on: document.getElementById('set-billing').classList.contains('on'),
  body: document.getElementById('billingBody').textContent,
}));
check('…and lands on Settings → Billing', v.tab === 'settings' && v.on, JSON.stringify({tab:v.tab,on:v.on}));
check('…which says the trial has ended and shows the three plans',
  /trial has ended/.test(v.body) && /\$149/.test(v.body) && /\$299/.test(v.body) && /\$549/.test(v.body), v.body.slice(0,80));
check('…and that the card goes to Stripe, jobs stay', /Stripe/.test(v.body) && /jobs stay/.test(v.body));
check('…with no yearly toggle while no yearly price exists', !/2 months free/.test(v.body), '');
await pg.locator('#set-billing').screenshot({ path: S + '/billing_settings.png' });

// choosing a plan calls checkout and hands the browser to Stripe
await pg.evaluate(() => { [...document.querySelectorAll('#billingBody button')].find(b => /Choose Team/.test(b.textContent)).click(); });
await pg.waitForTimeout(1200);
v = { url: pg.url(), sent: checkouts };
check('Choose Team starts a Stripe Checkout for the team plan',
  v.sent.length === 1 && v.sent[0].plan === 'team' && /checkout\.stripe\.test/.test(v.url), JSON.stringify(v.sent) + ' → ' + v.url);
await ctx.close();

// ── billing OFF (today's production): honest, nothing chargeable ──
({ ctx, pg, checkouts } = await boot({ status:'trialing', billing:false, live:true,
  trial:{ ends_at:'2026-09-01T00:00:00Z', days_left:11, expired:false }, plan:'trial' }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  body: document.getElementById('billingBody').textContent,
  disabled: [...document.querySelectorAll('#billingBody button')].every(b => b.disabled),
}));
check('with billing off the section says so and disables the buy buttons',
  /isn’t switched on yet/.test(v.body) && /Nothing can be charged/.test(v.body) && v.disabled, v.body.slice(0,90));
v = await pg.evaluate(() => (document.getElementById('trialBanner')||{}).textContent || '');
check('…and a quiet mid-trial banner stays quiet', v.trim() === '', v.slice(0,60));
await ctx.close();

// ── an active subscriber sees where they stand ────────────────────
({ ctx, pg, checkouts } = await boot({ status:'active', billing:true, live:true, trial:null, plan:'team' }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  body: document.getElementById('billingBody').textContent,
  manage: [...document.querySelectorAll('#billingBody button')].filter(b => /Manage billing/.test(b.textContent)).length,
  banner: (document.getElementById('trialBanner')||{}).textContent || '',
}));
check('an active subscriber sees their plan marked CURRENT with Manage billing',
  /You’re on Team/.test(v.body) && /CURRENT/.test(v.body) && v.manage === 1, v.body.slice(0,70));
check('…and no trial banner at all', v.banner.trim() === '');
await ctx.close();

// ── a business with no trial: the shape every new signup now has ──────
// The expired-trial path above still matters for accounts created before the
// trial was dropped, but this is the one a new roofer actually meets.
({ ctx, pg, checkouts } = await boot({ status:'pending', billing:true, live:false,
  trial:null, plan:'trial' }));
v = await pg.evaluate(() => (document.getElementById('trialBanner')||{}).textContent || '');
check('a pending business is prompted rather than left to hit a 403',
  /Pick a plan to start saving jobs/.test(v), v.replace(/\s+/g,' ').slice(0,90));
check('…and the banner offers the same button, not an email address',
  /Choose a plan/.test(v) && !/office@floodroofing/.test(v), v.replace(/\s+/g,' ').slice(0,90));
await pg.click('#trialBanner button');
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  tab: document.body.getAttribute('data-tab'),
  on: document.getElementById('set-billing').classList.contains('on'),
  body: document.getElementById('billingBody').textContent,
}));
check('…and that button still lands on Settings → Billing',
  v.tab === 'settings' && v.on, JSON.stringify({tab:v.tab,on:v.on}));
// The prices are the reason this suite exists — they must survive every
// rewording of the screen around them.
check('…which shows the three plans at the standard prices',
  /\$149/.test(v.body) && /\$299/.test(v.body) && /\$549/.test(v.body), v.body.slice(0,80));
check('…and does not tell them a trial ended that they never had',
  !/trial has ended/i.test(v.body), v.body.slice(0,90));
check('…and states the discount with its term and what follows it',
  /30% off your first 12 months/.test(v.body) && /standard rate/.test(v.body), v.body.slice(0,180));
check('…and says cancelling is possible, since the pricing page promises it',
  /cancel any time/i.test(v.body), v.body.slice(0,180));
await ctx.close();

// ── paid yearly: two months free ──────────────────────────────────
({ ctx, pg, checkouts } = await boot({ status:'trialing', billing:true, live:false,
  trial:{ ends_at:'2026-08-01T00:00:00Z', days_left:0, expired:true }, plan:'trial',
  annual:{ solo:true, team:true, business:false } }));
await pg.click('#trialBanner button');
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  bar: !!document.getElementById('billingCycleBar'),
  body: document.getElementById('billingBody').textContent,
}));
check('with yearly prices configured the Monthly / Yearly toggle appears',
  v.bar && /2 months free/.test(v.body), v.body.replace(/\s+/g,' ').slice(0, 80));
check('…opening on monthly, the default and the promise', /\$149\/month/.test(v.body.replace(/\s+/g,'')) || /\$149/.test(v.body), '');
await pg.evaluate(() => { [...document.querySelectorAll('#billingCycleBar button')].find(b => /Yearly/.test(b.textContent)).click(); });
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.getElementById('billingBody').textContent);
check('the yearly view shows the yearly prices with two months free',
  /\$1,490/.test(v) && /\$2,990/.test(v) && /2 months free/.test(v), v.replace(/\s+/g,' ').slice(0, 120));
check('…and a plan with no yearly price says monthly only instead of lying',
  /\$549/.test(v) && /monthly only/.test(v) && !/\$5,490/.test(v), '');
await pg.evaluate(() => { [...document.querySelectorAll('#billingBody button')].find(b => /Choose Team/.test(b.textContent)).click(); });
await pg.waitForTimeout(1200);
check('Choose Team in yearly view buys the ANNUAL team plan',
  checkouts.length === 1 && checkouts[0].plan === 'team' && checkouts[0].billing === 'annual',
  JSON.stringify(checkouts));
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
