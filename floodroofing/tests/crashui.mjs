// The browser half: an unhandled error must actually leave the machine.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const reports = [];
const ctx = await b.newContext({ viewport:{width:1200,height:800} });
const pg = await ctx.newPage();
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const q = r.request(), u = q.url();
  if (/\/client-error/.test(u)){ reports.push(q.postDataJSON()); return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}); }
  if (/\/settings/.test(u)) return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({user_id:'u1',branding:{company_name:'Acme Roofing Ltd',phone:'09 1',email:'o@a.co.nz'},quote_defaults:{},jms_keys:{}})});
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); gotoTab('roof'); });

// an error nobody caught
await pg.evaluate(() => { setTimeout(() => { null.getContext('2d'); }, 0); });
await pg.waitForTimeout(700);
check('an unhandled error is reported', reports.length === 1, JSON.stringify(reports.map(r=>r.message)));
const r0 = reports[0] || {};
check('…with the message and a stack', /getContext/.test(r0.message||'') && (r0.stack||'').length > 10, (r0.message||'').slice(0,60));
check('…naming the company, the person and the tab',
  r0.company === 'Acme Roofing Ltd' && /sam@/.test(r0.user||'') && r0.where === 'roof',
  JSON.stringify({co:r0.company, where:r0.where}));
check('…and the page, without a quote token in the query',
  !/[?&]q=/.test(r0.url||''), r0.url);

// the same error again is not a second report
await pg.evaluate(() => { setTimeout(() => { null.getContext('2d'); }, 0); });
await pg.waitForTimeout(600);
check('the same error repeating is reported once', reports.length === 1, String(reports.length));

// a rejected promise nobody handled
await pg.evaluate(() => { Promise.reject(new Error('save failed: network is down')); });
await pg.waitForTimeout(600);
check('an unhandled promise rejection is reported too',
  reports.length === 2 && /network is down/.test(reports[1].message), JSON.stringify(reports.map(r=>r.message.slice(0,30))));
check('…and marked as one', reports[1].where === 'promise');

// a rejection the code DOES handle is not a crash
await pg.evaluate(async () => { try { await Promise.reject(new Error('handled, not a crash')); } catch(e){} });
await pg.waitForTimeout(500);
check('a rejection the app handles is not reported', reports.length === 2, String(reports.length));

// a missing image is not a crash either
await pg.evaluate(() => { const i=new Image(); i.src='brand/definitely-not-here.png'; document.body.appendChild(i); });
await pg.waitForTimeout(600);
check('a missing image is not reported as a crash', reports.length === 2, String(reports.length));

// ── a cancelled request is not a crash ───────────────────────────
// Mapbox aborts its own tile fetches every time the map pans, zooms or drops
// a tile it no longer needs. That surfaced as "[RoofMap client] Fetch is
// aborted" in the owner's inbox, with a stack entirely inside mapbox-gl.js:
// nothing broken, nothing to fix, and one email per subscriber who used the
// aerial — which is how a real crash report ends up read past.
for (const m of ['Fetch is aborted', 'The user aborted a request.', 'The operation was aborted.', 'signal is aborted without reason']){
  await pg.evaluate((msg) => {
    const e = new Error(msg); e.name = 'AbortError';
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject(e).catch(() => {}), reason: e }));
  }, m);
  await pg.waitForTimeout(150);
}
check('a cancelled request is not reported as a crash', reports.length === 2, reports.length + ' sent');
// …but a real failure from the same library still is. The filter is on the
// abort MESSAGE, not on whose code it came from.
await pg.evaluate(() => {
  const e = new Error('Style is not done loading');
  e.stack = 'at _render@https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js:45:682258';
  window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject(e).catch(() => {}), reason: e }));
});
await pg.waitForTimeout(400);
check('…but a genuine failure in the same library still is',
  reports.length === 3 && /Style is not done loading/.test((reports[2] || {}).message || ''),
  reports.length + ' sent');

// and it stops eventually
for (let i = 0; i < 12; i++){
  await pg.evaluate((n) => { setTimeout(() => { throw new Error('distinct failure ' + n); }, 0); }, i);
  await pg.waitForTimeout(90);
}
await pg.waitForTimeout(500);
check('one session cannot send an unbounded number of reports', reports.length <= 8, reports.length + ' sent');

await ctx.close(); await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
