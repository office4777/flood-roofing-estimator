// "The app doesn't have the usual 'app has been updated, click reload'."
//
// It didn't, and it cost us both. A tab left open all day runs whatever code
// it loaded that morning; fixes shipped since are not in it, and nothing said
// so. A roofer reports a fault that was fixed hours ago and neither side can
// tell which version they are looking at — which is exactly what happened
// with a batch of five reports.
//
// The check is on the app FILE, not on the backend. The backend deploys a
// minute or so ahead of the frontend, so asking it "what build are you?"
// would offer a reload that lands on the very same old code. The file's own
// ETag changes when, and only when, the new one is actually being served.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The app has to be served over http for any of this to apply, so serve it.
const APP = readFileSync(_j(_ROOT, 'frontend', 'app.html'));
let etag = '"v1"';
let heads = 0;
const srv = http.createServer((req, res) => {
  // Only the app itself: anything else must 404, or a stray same-origin
  // fetch gets HTML back and the page reports a script parse error that has
  // nothing to do with what is being tested.
  const path = (req.url || '').split('?')[0];
  if (path !== '/app.html'){ res.writeHead(404); return res.end(); }
  if (req.method === 'HEAD') heads++;
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method === 'HEAD'){ res.writeHead(200); return res.end(); }
  res.writeHead(200); res.end(APP);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port + '/app.html';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto(BASE);
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){} });

const shown = () => pg.evaluate(() => {
  const el = document.getElementById('appUpdateBar');
  return !!el && getComputedStyle(el).display !== 'none';
});

// ── nothing has changed: stay out of the way ──────────────────────
await pg.evaluate(() => _verCheck());
await pg.evaluate(() => _verCheck());
await pg.waitForTimeout(300);
check('with the same version being served, nothing is said', !(await shown()));
check('…and it did look', heads > 0, heads + ' checks');
check('…and remembered which version this tab is running',
  (await pg.evaluate(() => _VER.tag)) === etag, await pg.evaluate(() => _VER.tag));

// ── a new version goes live ───────────────────────────────────────
etag = '"v2"';
await pg.evaluate(() => _verCheck());
await pg.waitForTimeout(300);
check('THE REPORT: when a newer app is live, the tab says so', await shown());
const text = await pg.evaluate(() => document.getElementById('appUpdateBar').textContent.replace(/\s+/g, ' ').trim());
check('…in words a roofer can act on', /updated/i.test(text) && /reload/i.test(text), text);
check('…with a way to put it off', await pg.isVisible('#appUpdateLater'), text);

// ── it does not nag ───────────────────────────────────────────────
await pg.click('#appUpdateLater');
await pg.waitForTimeout(200);
check('"Later" puts it away', !(await shown()));
etag = '"v3"';
await pg.evaluate(() => _verCheck());
await pg.waitForTimeout(300);
check('…and it stays away for the rest of the session, rather than asking again',
  !(await shown()));

// ── reloading keeps the work ──────────────────────────────────────
await pg.evaluate(() => { _VER.dismissed = false; _VER.shown = false; _VER.tag = '"old"';
  DRAW.outline = [[100,100],[400,100],[400,300],[100,300]]; DRAW.outlineDone = true;
  window.__drafted = 0;
  window._writeLocalDraftNow = function(){ window.__drafted++; };
});
await pg.evaluate(() => _verCheck());
await pg.waitForTimeout(300);
check('it comes back when there is a new version and it has not been dismissed', await shown());
const navigated = pg.waitForNavigation({ timeout: 15000 }).then(() => true).catch(() => false);
await pg.click('#appUpdateReload');
await pg.waitForTimeout(250);
check('pressing Reload keeps what is on screen on this device first',
  (await pg.evaluate(() => window.__drafted)) === 1, String(await pg.evaluate(() => window.__drafted)));
check('…and then actually reloads', await navigated, 'navigation seen');
await pg.waitForTimeout(1500);
check('…coming back on the newer version, with the bar gone',
  !(await shown()) && (await pg.evaluate(() => window.__drafted)) === undefined,
  'drafted=' + String(await pg.evaluate(() => window.__drafted)));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
await new Promise(r => srv.close(r));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
