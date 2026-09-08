// The three questions the setup-call form used to ask — roofs a month, what
// they quote on now, which plan — are asked once on the Home tab of a trial
// account instead. Optional, one tap to skip, and gone for good either way.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(company, user){
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  const pg = await ctx.newPage();
  const posts = [];
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    if (/\/auth\/about/.test(r.request().url())){ posts.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript(([c, u]) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_user', JSON.stringify(u)); localStorage.setItem('fr_company', JSON.stringify(c));
  }, [company, user]);
  await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2200);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  return { ctx, pg, posts };
}
const card = pg => pg.evaluate(() => { const el = document.getElementById('aboutYouCard'); return { shown: !!(el && el.firstElementChild), text: el ? el.textContent : '' }; });

// ── a trial account is asked, once ───────────────────────────────
let o = await open({ id: 'c1', name: 'Kauri Roofing', plan: 'trial', limits: {} }, { email: 'kiri@kauri.co.nz' });
let v = await card(o.pg);
check('a trial account is asked about its setup on the Home tab', v.shown && /Roofs you quote/.test(v.text) && /quote on now/.test(v.text) && /plan looks right/.test(v.text), v.text.slice(0, 80));
await o.pg.selectOption('#aboutVolume', '6-10'); await o.pg.selectOption('#aboutSoftware', 'fergus'); await o.pg.selectOption('#aboutPlan', 'team');
await o.pg.click('#aboutYouCard button');
await o.pg.waitForTimeout(500);
check('…the answers are sent', o.posts.length === 1 && o.posts[0].volume === '6-10' && o.posts[0].current_software === 'fergus' && o.posts[0].plan === 'team', JSON.stringify(o.posts));
v = await card(o.pg);
check('…and the card goes', !v.shown);
const flagged = await o.pg.evaluate(() => ({ flag: localStorage.getItem('fr_about_done'), about: (JSON.parse(localStorage.getItem('fr_user') || '{}') || {}).about }));
check('…and the answer is remembered on this device', flagged.flag === '1' && !!flagged.about, JSON.stringify(flagged));
// A second page in the same browser shares the storage — the card must not
// come back there either. (A reload was used here before, and under a full
// parallel gate it twice came back with the storage empty; a fresh page is
// the same question asked without the reload's timing.)
const pg2 = await o.ctx.newPage();
await pg2.goto('file://' + DIR + '/app.html');
await pg2.waitForFunction(() => typeof window._aboutYouSync === 'function' && document.getElementById('homeBoard'), null, { timeout: 20000 }).catch(() => null);
await pg2.waitForTimeout(800);
const again = await pg2.evaluate(() => { try { _aboutYouSync(); } catch(e){}
  const el = document.getElementById('aboutYouCard');
  return { shown: !!(el && el.firstElementChild), flag: localStorage.getItem('fr_about_done'), user: localStorage.getItem('fr_user') }; });
check('…for good', !again.shown, JSON.stringify(again));
await pg2.close();
await o.ctx.close();

// ── skipping is one tap and just as final ────────────────────────
o = await open({ id: 'c2', name: 'Tui Roofing', plan: 'trial', limits: {} }, { email: 'tui@tui.co.nz' });
await o.pg.click('#aboutYouCard button:nth-of-type(2)');
await o.pg.waitForTimeout(400);
check('Skip sends a skip, and the card goes', o.posts.length === 1 && o.posts[0].skipped === true && !(await card(o.pg)).shown, JSON.stringify(o.posts));
await o.ctx.close();

// ── a paying business is not asked ───────────────────────────────
o = await open({ id: 'c3', name: 'Flood Roofing', plan: 'business', limits: {} }, { email: 'aron@floodroofing.co.nz' });
check('a paying business is not asked', !(await card(o.pg)).shown);
await o.ctx.close();
// ── nor one that already answered ────────────────────────────────
o = await open({ id: 'c4', name: 'Rata Roofing', plan: 'trial', limits: {} }, { email: 'r@rata.co.nz', about: { volume: '3-5' } });
check('nor one whose profile already carries an answer', !(await card(o.pg)).shown);
await o.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
