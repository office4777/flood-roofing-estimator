// "can you remove the pole sheds from the quote tab, i only want to keep it
//  for my flood roofing log in"
//
// The pole-shed quote is Flood Roofing's own product line — its own pricing
// model, its own consent wording, its own six pages. It is not part of what
// RoofMap sells to other roofing companies, and every one of them was being
// offered a "Pole Shed" draft on the Quote tab and a "Pole Shed" job type in
// the job modal.
//
// The gate is deliberately NOT the one that decides who may show the built-in
// photos. That answers a different question, and turning the photos off for
// an account should not quietly take a product line with it. Same shape
// though — an explicit setting wins — so it can be switched on for somebody
// by hand without a deploy.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const errs = [];

async function open(companyName, extraBranding){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (/\/settings/.test(u)) return j({ user_id:'u1',
      branding: Object.assign({ company_name: companyName, phone:'09 123 4567',
                                email:'office@example.co.nz' }, extraBranding || {}),
      quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript((n) => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@example.co.nz', name:'Sam Tui' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:n, role:'owner' })); }, companyName);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { ['setupWizard','_rsModal'].forEach(i => {
    const e = document.getElementById(i); if (e) e.remove(); }); });
  await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
    finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
  await pg.waitForTimeout(2200);
  return { ctx, pg };
}
const shown = (pg, sel) => pg.evaluate(s => {
  const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);

// ── the account it belongs to keeps it ────────────────────────────
let { ctx, pg } = await open('Flood Roofing LTD');
check('the account whose product it is still gets the Pole Shed draft',
  await shown(pg, '#qkDraftToggle'));
check('…and can still pick it as a job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const e = document.getElementById('jtTypeToggle');
  return !!e && getComputedStyle(e).display !== 'none';
}));
check('…and switching to it actually switches',
  (await pg.evaluate(() => { _setQuoteKind('poleshed'); return S.quote.quoteKind; })) === 'poleshed');
await ctx.close();

// ── everybody else does not ───────────────────────────────────────
({ ctx, pg } = await open('Kauri Roofing Ltd'));
check('THE ASK: another roofing company is not offered a Pole Shed draft',
  !(await shown(pg, '#qkDraftToggle')));
check('…nor a Pole Shed job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const e = document.getElementById('jtTypeToggle');
  return !e || getComputedStyle(e).display === 'none';
}));
// A job saved while it WAS offered, or a template copied from one, must not
// strand somebody on a document they cannot switch away from — the toggle
// that would switch them back is the thing that is gone.
check('…and a job carrying a shed draft is put back to a roofing one, not stranded',
  (await pg.evaluate(() => { S.quote.quoteKind = 'poleshed'; _syncQuoteKindToggle();
                             return S.quote.quoteKind; })) === 'roofing');
check('…so the proposal it renders is the roofing one',
  await pg.evaluate(async () => { refreshQuoteProposal(); await new Promise(r => setTimeout(r, 600));
    return !/Pole Shed/i.test(document.getElementById('qpRoot').textContent || ''); }));
// The rest of the Quote tab is untouched — this removes a draft type, not a tab.
check('…while the Quote tab itself still works as it did',
  await shown(pg, '#tab-quote > .q-actionbar') &&
  (await pg.evaluate(() => (document.getElementById('qpRoot').textContent || '').length)) > 400);
await ctx.close();

// ── and it can be turned on for somebody by hand ──────────────────
({ ctx, pg } = await open('Kauri Roofing Ltd', { poleshed_enabled: true }));
check('a company switched on by hand gets it, without a deploy',
  await shown(pg, '#qkDraftToggle'));
await ctx.close();

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
