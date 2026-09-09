// What the app tells the server for the daily activity report: a minute in
// the app counts when the tab is visible and something was touched lately,
// and goes up in batches; drawing on the canvas is one event per half hour.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const usage = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  if (/\/usage$/.test(r.request().url()) && r.request().method() === 'POST'){ usage.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'b@k.nz' })); localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} })); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2500);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); try { document.getElementById('selectJobOverlay').style.display = 'none'; document.getElementById('selectJobModal').style.display = 'none'; } catch(e){} });

// ── minutes ──────────────────────────────────────────────────────
await pg.mouse.click(700, 500);
await pg.evaluate(() => { for (let i = 0; i < 4; i++) _appTimeTick(); });
await pg.waitForTimeout(300);
check('four active minutes are held, not yet sent', !usage.some(u => u.name === 'app_time'));
await pg.evaluate(() => _appTimeTick());
await pg.waitForTimeout(400);
let t = usage.filter(u => u.name === 'app_time');
check('the fifth sends the batch of five', t.length === 1 && t[0].minutes === 5, JSON.stringify(t));
await pg.evaluate(() => { _appTimeTick(); _appTimeTick(); _appTimeFlush(); });
await pg.waitForTimeout(400);
t = usage.filter(u => u.name === 'app_time');
check('leaving the tab sends whatever is left', t.length === 2 && t[1].minutes === 2, JSON.stringify(t));

// ── the canvas ───────────────────────────────────────────────────
await pg.evaluate(() => { gotoTab('roof'); saveSnapshot(); saveSnapshot(); saveSnapshot(); });
await pg.waitForTimeout(400);
check('drawing on the canvas is reported once, not per stroke', usage.filter(u => u.name === 'canvas_used').length === 1, JSON.stringify(usage.map(u => u.name)));

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
