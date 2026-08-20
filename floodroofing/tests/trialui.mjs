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
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'bob@acmeroofing.co.nz', name:'Bob' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
  await pg.goto('file://' + _j(DIR, 'index.html'));
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
check('…and says how to carry on', /office@floodroofing/.test(txt.txt));
await ctx.close();

// ── a paying subscriber is never nagged ──
({ ctx, txt } = await open({ status:'active', billing:true, live:true, plan:'business', trial:null }));
check('a paying subscriber is never shown a countdown', txt.html === '', txt.txt.slice(0,40));
await ctx.close();

// ── and a broken endpoint never breaks the app ──
({ ctx, txt } = await open(undefined));
check('a failed subscription check is silent, not a broken app', txt.html === '');
const stillWorks = await ctx.pages()[0].evaluate(() => typeof gotoTab === 'function' && !!document.getElementById('homeBoardTiles'));
check('…and the app still works', stillWorks);
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
