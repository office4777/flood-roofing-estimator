// The app's side of the maintenance switch (2026-09-30): a write answered
// 503 MAINTENANCE puts up one calm banner saying the work is kept, instead of
// a string of save errors — and the failed save still keeps its device copy.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const MSG = 'RoofMap is moving to a faster server — back by 11:30 pm. Nothing is lost: anything you change now stays on this device and saves when we are back.';
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  if (/\/health/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, maintenance: { on: true } }) });
  if (m !== 'GET') return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: MSG, code: 'MAINTENANCE' }) });
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2500);
const v = await pg.evaluate(async () => {
  let err = null;
  try { await api('PUT', '/jobs/j1', { draw_state: {} }); } catch (e) { err = { code: e.code, status: e.status, msg: e.message }; }
  try { await api('POST', '/jobs', { draw_state: {} }); } catch (e) {}
  const el = document.getElementById('maintBanner');
  return { err, shown: !!el && getComputedStyle(el).display !== 'none', txt: el ? el.textContent : '',
           count: document.querySelectorAll('#maintBanner').length };
});
check('a save refused for maintenance still fails as a save (so the device copy is kept)', v.err && v.err.code === 'MAINTENANCE' && v.err.status === 503, JSON.stringify(v.err));
check('…and puts up ONE banner saying what is happening', v.shown && v.count === 1 && /Back in a few minutes/.test(v.txt) && /faster server/.test(v.txt), v.txt.slice(0, 120));
check('…which says nothing is lost', /Nothing is lost/.test(v.txt));
check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
