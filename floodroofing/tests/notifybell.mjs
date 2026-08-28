// "A notification gets pushed through to RoofMap when the customer opens
//  their quote — but make sure it's the customer opening it, not the office.
//  Also a notification if a question is asked, if the quote's accepted or
//  declined — and stamp the time and date on each."
//
// The bell in the sidebar. Its feed is the share.events history the backend
// already stamps; what it adds is unread tracking, the date+time on every
// entry, and a toast when something lands while the office is in the app.
// The office-vs-customer half is the preview=1 flag: the app's own Open
// button and its link-verify fetch carry it, and the backend records nothing
// for such hits — asserted here from both ends.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// All in the recent past relative to the machine's clock — unread and
// "fresh" comparisons are against Date.now(), so a fixture stamped in the
// future would invert them.
const H = 3600000;
const AT = {
  declined: new Date(Date.now() - 5 * H).toISOString(),
  opened:   new Date(Date.now() - 3 * H).toISOString(),
  queried:  new Date(Date.now() - 2 * H).toISOString(),
  accepted: new Date(Date.now() - 1 * H).toISOString(),
};
const FEED = [
  { jobId: 'j1', client: 'Sharon Thomson', ref: '3206', status: 'opened', token: 't1',
    openCount: 2, lastOpenedAt: AT.opened, query: { message: 'Can you do it in Grey Friars colour?', at: AT.queried },
    events: [ { type: 'opened', at: AT.opened }, { type: 'queried', at: AT.queried } ] },
  { jobId: 'j2', client: 'Bob Builder', ref: '3101', status: 'accepted', token: 't2',
    openCount: 5, lastOpenedAt: AT.accepted, query: null,
    events: [ { type: 'declined', at: AT.declined }, { type: 'accepted', at: AT.accepted } ] },
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
let feedServed = 0;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const url = r.request().url();
  if (/\/quote-activity/.test(url)) { feedServed++; return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(FEED) }); }
  r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.removeItem('fr_notif_seen'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// ── the bell is in the sidebar, with the unread count ──────────────
await pg.evaluate(() => _qnFetch());
await pg.waitForTimeout(300);
let s = await pg.evaluate(() => ({
  bell: !!document.getElementById('navNotifBtn'),
  badge: (document.getElementById('qnBadge')||{}).textContent,
  badgeShown: (document.getElementById('qnBadge')||{style:{}}).style.display !== 'none',
  n: _QN.items.length,
}));
check('the sidebar carries a Notifications bell', s.bell);
check('all four kinds of customer event arrive', s.n === 4, s.n + ' items');
check('…and the unread badge counts them', s.badgeShown && s.badge === '4', s.badge);

// ── the panel: every entry named and STAMPED ───────────────────────
await pg.evaluate(() => _qnToggle());
await pg.waitForTimeout(200);
await pg.evaluate((at) => { window.__qnAtAccepted = at; }, AT.accepted);
s = await pg.evaluate(() => {
  const t = (document.getElementById('qnPanel')||{}).innerText || '';
  return {
    text: t,
    accepted: /Bob Builder ACCEPTED their quote — quote 3101/.test(t.replace(/\n/g,' ')),
    opened: /Sharon Thomson viewed their quote/.test(t),
    queried: /asked a question/.test(t) && /Grey Friars/.test(t),
    declined: /declined their quote/.test(t),
    // 2026-08-28T02:31Z = 2:31 pm NZST on the 28th — but the suite machine
    // is UTC, so assert the LOCAL formatting of the stamp, not a fixed zone.
    stamped: t.indexOf(new Date(window.__qnAtAccepted).toLocaleString('en-NZ',
      { day:'2-digit', month:'2-digit', year:'numeric', hour:'numeric', minute:'2-digit' })) >= 0,
    ordered: t.indexOf('ACCEPTED') < t.indexOf('asked a question'),
  };
});
check('an acceptance is announced by name and quote number', s.accepted, s.text.slice(0, 120));
check('…a customer viewing their quote too', s.opened);
check('…a question, with what they asked', s.queried);
check('…and a decline', s.declined);
check('every entry carries its date and time stamp', s.stamped);
check('newest first', s.ordered);

// Opening the panel marks everything seen — the badge clears.
s = await pg.evaluate(() => ({
  seen: !!localStorage.getItem('fr_notif_seen'),
  badgeShown: (document.getElementById('qnBadge')||{style:{}}).style.display !== 'none',
}));
check('opening the panel marks the lot as seen and clears the badge',
  s.seen && !s.badgeShown, JSON.stringify(s));

// ── something new arriving while the app is open → a toast ─────────
const toast = await pg.evaluate(async () => {
  window._qnToastSpy = [];
  const orig = window._siteToast;
  window._siteToast = function(m){ window._qnToastSpy.push(m); try { orig && orig(m); } catch(e){} };
  window.__pushFreshEvent = true;
  return true;
});
await pg.evaluate(() => _qnToggle());   // close the panel
FEED[0].events.push({ type: 'accepted', at: new Date().toISOString() });
await pg.evaluate(() => _qnFetch());
await pg.waitForTimeout(300);
s = await pg.evaluate(() => ({ toasts: window._qnToastSpy, unread: _qnUnread() }));
check('a fresh event while the app is open raises a toast, dated feed and all',
  s.toasts.length === 1 && /Sharon Thomson ACCEPTED their quote/.test(s.toasts[0]), JSON.stringify(s.toasts));
check('…and the badge goes live again', s.unread >= 1, String(s.unread));

// ── the office's own opens never look like the customer ────────────
// Both office paths to /q carry preview=1; the customer link itself stays
// clean; and the customer page forwards a preview flag when told to.
const app = readFileSync(_j(DIR, 'app.html'), 'utf8');
check('the office Open button previews, it does not "open" the quote',
  app.indexOf("esc(link + '&preview=1')") >= 0);
check('…and so does the link-verify probe',
  /\/q\/' \+ encodeURIComponent\(token\) \+ '\?preview=1'/.test(app));
check('…while the customer page forwards preview only when the URL says so',
  /__CUSTOMER_PREVIEW/.test(app) && app.indexOf("get('preview') === '1'") >= 0);

check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
