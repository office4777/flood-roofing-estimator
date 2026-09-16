// Signing in lands on MAP ROOF.
//
// Measuring a roof is what people open RoofMap to do; the Home tiles were a
// menu in front of the work. The landing is deliberately conservative: it
// only moves off the DEFAULT tab, so anything that already sent the user
// somewhere — a customer quote link, a deep link, a resumed draft — keeps it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(opts){
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await pg.addInitScript((signedIn) => {
    if (signedIn){
      localStorage.setItem('fr_token','t');
      localStorage.setItem('fr_user', JSON.stringify({ email:'a@b.nz' }));
      localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} }));
    } else {
      localStorage.removeItem('fr_token');
    }
    localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  }, !!(opts && opts.signedIn));
  await pg.goto('file://' + DIR + '/app.html' + ((opts && opts.query) || ''));
  await pg.waitForTimeout(2600);
  return { ctx, pg };
}
const tabOf = pg => pg.evaluate(() => document.body.getAttribute('data-tab'));

// ── signed in ────────────────────────────────────────────────────
{
  const { ctx, pg } = await open({ signedIn: true });
  check('a signed-in session opens on Map Roof, not Home', await tabOf(pg) === 'roof', await tabOf(pg));
  check('…with the Map Roof menu entry lit, not Home',
    await pg.evaluate(() => {
      const on = [...document.querySelectorAll('.nav-btn.active')].map(b => (b.getAttribute('onclick') || ''));
      return on.length === 1 && /gotoTab\('roof'\)/.test(on[0]);
    }));
  check('…and the canvas is really there to draw on',
    await pg.evaluate(() => {
      const c = document.getElementById('roofCanvas');
      return !!c && c.closest('.panel').classList.contains('active') && c.width > 0;
    }));
  // Once per page load: it must not yank a tab away from somebody working.
  await pg.evaluate(() => gotoTab('quote'));
  await pg.waitForTimeout(1500);
  check('…and it never moves the user again after that', await tabOf(pg) === 'quote', await tabOf(pg));
  await ctx.close();
}

// ── signed out ───────────────────────────────────────────────────
{
  const { ctx, pg } = await open({ signedIn: false });
  check('a signed-out visitor is not landed anywhere — the sign-in screen has it',
    await tabOf(pg) === 'select', await tabOf(pg));
  // Signing in on the same page load still lands: the boot retries until a
  // token appears, which is the path a fresh sign-in takes.
  await pg.evaluate(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_user', JSON.stringify({ email:'a@b.nz' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'K', plan:'team', limits:{} })); });
  await pg.waitForTimeout(1800);
  check('…but signing in on the same page load does land on Map Roof',
    await tabOf(pg) === 'roof', await tabOf(pg));
  await ctx.close();
}

// ── a customer opening a quote link is untouched ─────────────────
// The customer view runs in the same file. Landing it on Map Roof would put
// the office app in front of a homeowner reading their quote.
{
  const { ctx, pg } = await open({ signedIn: true, query: '?q=sometoken' });
  const t = await tabOf(pg);
  check('a customer quote link never lands on Map Roof', t !== 'roof', String(t));
  await ctx.close();
}

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
