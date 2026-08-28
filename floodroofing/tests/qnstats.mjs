// What the bell looks like on each side of the Team line.
//
// Team: the notification panel opens with a stats strip on top — sent /
// opened / accepted over 30 or 90 days, from /quote-analytics. Solo: the bell
// wears a lock, never polls the feed, and one tap opens a teaser that says
// what Team notifications do and offers the upgrade — the feature is
// discoverable, just not on.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const STATS = { 30: { days: 30, sent: 12, opened: 9, accepted: 4, declined: 1,
                      open_rate: 75, accept_rate: 33, median_days_to_accept: 2.5 },
                90: { days: 90, sent: 31, opened: 22, accepted: 11, declined: 2,
                      open_rate: 71, accept_rate: 35, median_days_to_accept: 3.1 } };

async function boot(plan, opts){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const hits = { activity: 0, analytics: [] };
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const url = r.request().url();
    if (/\/quote-analytics/.test(url)) {
      const days = /days=90/.test(url) ? 90 : 30;
      hits.analytics.push(days);
      if (opts && opts.deny403) return r.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: "Not on your plan — Team covers it.", code: 'PLAN_LIMIT', needs: 'Team' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATS[days]) });
    }
    if (/\/quote-activity/.test(url)) {
      hits.activity++;
      if (plan === 'solo' || (opts && opts.deny403)) return r.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: "Quote notifications isn't included on your plan — Team covers it.", code: 'PLAN_LIMIT', needs: 'Team' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((p) => {
    localStorage.setItem('fr_token', 't');
    localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Kauri Roofing', plan: p,
      limits: { seats: p === 'solo' ? 1 : 5, slug: p !== 'solo', domain: false, jms: false,
                activity: p !== 'solo', reminders: p !== 'solo' } }));
  }, plan);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2600);
  await pg.evaluate((p) => { window.SUBSCRIPTION = Object.assign(window.SUBSCRIPTION || {}, { plan: p }); }, plan);
  return { ctx, pg, errs, hits };
}

// ── Team: the strip renders and the pills refetch ─────────────────
const t = await boot('team');
await t.pg.evaluate(() => _qnToggle());
await t.pg.waitForTimeout(600);
let s = await t.pg.evaluate(() => {
  const el = document.getElementById('qnStats');
  return { there: !!el, text: el ? el.textContent : '' };
});
check('the Team panel opens with the stats strip', s.there, '');
check('…showing the 30-day numbers', /Sent 12/.test(s.text) && /Opened 9/.test(s.text) &&
  /75%/.test(s.text) && /Accepted 4/.test(s.text) && /2\.5d/.test(s.text), s.text.slice(0, 120));
await t.pg.evaluate(() => _qnStatsSetDays(90));
await t.pg.waitForTimeout(600);
s = await t.pg.evaluate(() => (document.getElementById('qnStats') || {}).textContent || '');
check('the 90-day pill refetches and re-renders', /Sent 31/.test(s) && /Accepted 11/.test(s),
  s.slice(0, 120));
check('…the request really asked for 90 days', t.hits.analytics.includes(90), JSON.stringify(t.hits.analytics));
check('no page errors on the Team side', t.errs.length === 0, t.errs.join(' | ') || 'clean');
await t.ctx.close();

// ── Solo: locked bell, no polling, teaser sells the upgrade ───────
const so = await boot('solo');
await so.pg.waitForTimeout(4500);   // past the 3.5s poll kickoff
let v = await so.pg.evaluate(() => ({
  canUse: typeof _qnCanUse === 'function' ? _qnCanUse() : null,
  badge: (document.getElementById('qnBadge') || {}).textContent || '',
  badgeShown: ((document.getElementById('qnBadge') || {}).style || {}).display !== 'none',
}));
check('Solo: the bell knows it is locked', v.canUse === false, String(v.canUse));
check('…and wears the lock, visibly', v.badgeShown && /🔒/.test(v.badge), JSON.stringify(v));
check('…and never even asked the server for the feed', so.hits.activity === 0, so.hits.activity + ' polls');
await so.pg.evaluate(() => _qnToggle());
await so.pg.waitForTimeout(400);
v = await so.pg.evaluate(() => {
  const pane = document.getElementById('qnPanel');
  return { text: pane ? pane.textContent : '',
           upgrade: !!(pane && pane.querySelector('[onclick*="_billingOpen"]')) };
});
check('the tap opens the teaser, not an empty feed',
  /Team plan/i.test(v.text) && /opens/i.test(v.text) && /accepts/i.test(v.text), v.text.slice(0, 140));
check('…with an Upgrade button wired to billing', v.upgrade, '');
check('no page errors on the Solo side', so.errs.length === 0, so.errs.join(' | ') || 'clean');
await so.ctx.close();

// ── unknown plan + server 403: the fallback still locks cleanly ───
const u = await boot('', { deny403: true });
await u.pg.evaluate(() => _qnFetch());
await u.pg.waitForTimeout(500);
v = await u.pg.evaluate(() => ({ locked: !!_QN.locked, canUse: _qnCanUse() }));
check('a PLAN_LIMIT 403 from the server locks the bell even when the plan is unknown',
  v.locked === true && v.canUse === false, JSON.stringify(v));
check('no page errors on the fallback path', u.errs.length === 0, u.errs.join(' | ') || 'clean');
await u.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
