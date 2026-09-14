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
  // A gated account is met by the plan window on sign-in (trialui.mjs owns
  // that behaviour). This suite is about the Settings → Billing panel behind
  // it, so dismiss it the way a roofer would before driving that panel.
  await pg.evaluate(() => { try { _planGateClose(); } catch(e){} });
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
  // The PLAN buttons — not every button in the panel. Saving the billing
  // email is not a purchase and stays available whether billing is on or off.
  disabled: [...document.querySelectorAll('#billingBody button')]
    .filter(b => /^(Choose|Subscribe to|Manage billing)/.test(b.textContent.trim()))
    .every(b => b.disabled),
}));
check('with billing off the section says so and disables the buy buttons',
  /isn’t switched on yet/.test(v.body) && /Nothing can be charged/.test(v.body) && v.disabled, v.body.slice(0,90));
v = await pg.evaluate(() => (document.getElementById('trialBanner')||{}).textContent || '');
check('…and a quiet mid-trial banner stays quiet', v.trim() === '', v.slice(0,60));
await ctx.close();

// ── an active subscriber sees where they stand ────────────────────
// billing_account true = there IS a Stripe customer, which is what makes the
// billing portal a real destination. Active alone does not.
({ ctx, pg, checkouts } = await boot({ status:'active', billing:true, live:true, trial:null,
  plan:'team', billing_account:true }));
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

// ── a comped account: on a plan, paying nothing ───────────────────
// This is what every account looks like today — comped through the
// grandfather tool, so status is 'pending' rather than 'active'. CURRENT
// used to be pinned to a live Stripe subscription, which left the owner
// staring at three plans with no way to tell which one they were on.
({ ctx, pg, checkouts } = await boot({ status:'pending', billing:true, live:true, plan:'team',
  trial:{ ends_at:'2027-09-01T00:00:00Z', days_left:365, expired:false } }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => document.getElementById('billingBody').textContent);
check('a comped account is told which plan it is on', /You’re on Team/.test(v), v.slice(0, 80));
check('…and that plan is the one marked CURRENT', /CURRENT/.test(v));
check('…and it is told there is nothing to pay, with the date it runs to',
  /Nothing to pay/.test(v) && /2027/.test(v), v.slice(0, 130));
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

// ── "active" with no Stripe customer: comped, and wanting to pay ──
// The owner's own account read status 'active' on Business with no customer
// behind it, so the Business card offered Manage billing — which answers "no
// billing account yet — subscribe first". The one plan a comped business
// could not subscribe to was its own. The card offers the checkout now.
({ ctx, pg, checkouts } = await boot({ status:'active', billing:true, live:true, plan:'business',
  billing_account:false, trial:null }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  body: document.getElementById('billingBody').textContent,
  // The BUTTONS, not the body text — the footer note mentions Manage billing
  // in passing, so reading the whole panel cannot tell you what is clickable.
  btns: [...document.querySelectorAll('#billingBody button')].map(b => b.textContent.trim()),
}));
check('an active account with no card is not told its card is in the portal',
  !/cancellation are in the billing portal/.test(v.body), v.body.slice(0, 140));
check('…it is told plainly there is no card on file', /no card on file/i.test(v.body), v.body.slice(0, 160));
check('…and its own plan offers Subscribe, not Manage billing',
  v.btns.includes('Subscribe to Business') && !v.btns.some(x => /Manage billing/.test(x)),
  JSON.stringify(v.btns));
await pg.click('button:has-text("Subscribe to Business")');
await pg.waitForTimeout(700);
check('…and that button really starts a Business checkout',
  checkouts.length === 1 && checkouts[0].plan === 'business', JSON.stringify(checkouts));
await ctx.close();

// ── active AND paying: the portal is right for them ───────────────
({ ctx, pg, checkouts } = await boot({ status:'active', billing:true, live:true, plan:'team',
  billing_account:true, trial:null }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({
  body: document.getElementById('billingBody').textContent,
  btns: [...document.querySelectorAll('#billingBody button')].map(b => b.textContent.trim()),
}));
check('a paying account still gets Manage billing',
  v.btns.some(x => /Manage billing/.test(x)) &&
  /cancellation are in the billing portal/.test(v.body), JSON.stringify(v.btns));
await ctx.close();

// ── the billing email: where receipts and tax invoices go ─────────
// Asked for, not assumed — the person who pays is often not the person who
// signed up. Empty means the account's own login.
({ ctx, pg, checkouts } = await boot({ status:'active', billing:true, live:true, plan:'team',
  billing_account:true, trial:null }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-billing'); _billingRenderSection(); });
await pg.waitForTimeout(500);
check('the billing screen asks where receipts should go',
  await pg.isVisible('#billingEmailInput'));
const puts = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/settings', r => {
  if (r.request().method() === 'PUT') puts.push(JSON.parse(r.request().postData() || '{}'));
  return r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ user_id:'u1', branding:{company_name:'Acme'}, quote_defaults:{}, jms_keys:{},
                           billing_email: puts.length ? puts[puts.length-1].billing_email : '' }) });
});
await pg.fill('#billingEmailInput', 'not-an-email');
await pg.click('#billingEmailSaveBtn');
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.getElementById('billingEmailMsg').textContent);
check('…and refuses something that is not an address', /doesn.t look like an email/i.test(v), v);
check('…without sending anything to the server', puts.length === 0, JSON.stringify(puts));
await pg.fill('#billingEmailInput', 'accounts@kauri.co.nz');
await pg.click('#billingEmailSaveBtn');
await pg.waitForTimeout(700);
check('…and a real address is saved with the settings',
  puts.length === 1 && puts[0].billing_email === 'accounts@kauri.co.nz', JSON.stringify(puts.map(x => x.billing_email)));
v = await pg.evaluate(() => document.getElementById('billingEmailMsg').textContent);
check('…and says where the mail will land now', /accounts@kauri\.co\.nz/.test(v), v);
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
