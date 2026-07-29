// Nightly headless sync for the Flood Roofing Hub team mode.
//
// Runs the REAL Hub in a headless browser so all the existing sync + compute logic
// is reused (no server-side reimplementation). It logs in for a token, seeds the
// proxy credentials + team API into localStorage, runs a refresh, and lets the app
// push the fresh state to the shared store. Intended to run from GitHub Actions.
//
// Env (from CI secrets):
//   HUB_API_URL   e.g. https://flood-hub-api.vercel.app   (the team-mode API)
//   HUB_USER      a username from HUB_USERS
//   HUB_PASS      that user's password
//   PROXY_URL     the fergus-proxy production URL
//   PROXY_SECRET  the PROXY_SECRET value
//   SYNC_MODE     "refresh" (default, recent+changed) or "master" (full history)
//
// Usage: node scripts/headless-sync.js
const path = require('path');
const { chromium } = require('playwright');

const HUB_HTML = path.resolve(__dirname, '../../hub/FloodRoofing_Financials.html');

async function main() {
  const api = (process.env.HUB_API_URL || '').replace(/\/+$/, '');
  const { HUB_USER, HUB_PASS, PROXY_URL, PROXY_SECRET } = process.env;
  const mode = (process.env.SYNC_MODE || 'refresh').toLowerCase();
  if (!api || !HUB_USER || !HUB_PASS || !PROXY_URL || !PROXY_SECRET) {
    throw new Error('Missing env: need HUB_API_URL, HUB_USER, HUB_PASS, PROXY_URL, PROXY_SECRET.');
  }

  // 1) get a token
  const authRes = await fetch(api + '/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: HUB_USER, pass: HUB_PASS }),
  });
  const authJson = await authRes.json();
  if (!authRes.ok || !authJson.token) throw new Error('Login failed: ' + (authJson.error || authRes.status));
  const token = authJson.token;

  // 2) boot the Hub headless with creds seeded before its scripts run
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('[hub console error]', m.text()); });
  await page.addInitScript(([a, t, pu, ps]) => {
    try {
      localStorage.setItem('fr3_hubApiUrl', a);
      localStorage.setItem('fr3_hubToken', t);
      localStorage.setItem('fr3_fergus_proxy_url', JSON.stringify(pu));
      localStorage.setItem('fr3_fergus_proxy_secret', JSON.stringify(ps));
      // don't let the headless run trigger a full auto-master unless we asked for it
      localStorage.setItem('fr3_autoWeekly', JSON.stringify('off'));
    } catch (e) {}
  }, [api, token, PROXY_URL, PROXY_SECRET]);

  await page.goto('file://' + HUB_HTML, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__teamHeadlessSync === 'function', null, { timeout: 30000 });

  // 3) run the sync (master is heavy — do it weekly; refresh nightly) and push
  console.log('Running ' + mode + ' sync…');
  const result = await page.evaluate(m => window.__teamHeadlessSync(m), mode);
  console.log('Sync result:', JSON.stringify(result));

  await browser.close();
  if (result && result.pushed) { console.log('✓ Shared state updated.'); process.exit(0); }
  throw new Error('Sync did not push state: ' + JSON.stringify(result));
}

main().catch(e => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
