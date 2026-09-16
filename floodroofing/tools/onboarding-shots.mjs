// Onboarding audit: every screen a brand-new account meets, in order,
// numbered, as one PDF. Drives the REAL app.html in Chromium — nothing here
// is a mock-up, so what is in the PDF is what a roofer sees.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const _ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(_ROOT, 'frontend');
const OUT = process.argv[2] || join(_ROOT, 'tools', 'out-onboarding');
mkdirSync(OUT, { recursive: true });
const shots = [];
let n = 0;

const SETTINGS_NEW = { user_id:'u1', branding:{}, quote_defaults:{}, jms_keys:{}, price_book:{}, ui_flags:{ first_roof:'offer' } };
const SETTINGS_SEEN = { user_id:'u1', branding:{}, quote_defaults:{}, jms_keys:{}, price_book:{}, ui_flags:{ first_roof:'done' } };

async function newPage(b, { token = true, settings = SETTINGS_NEW, company = { id:'c1', name:'', plan:'trial', limits:{} } } = {}){
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  [pageerror]', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (/\/settings/.test(u)) return j(settings);
    if (/\/subscription/.test(u)) return j({
      status:'trialing', plan:'trial', live:true, billing:true, billing_account:false,
      trial:{ ends_at: new Date(Date.now()+12*864e5).toISOString(), days_left:12, expired:false },
    });
    if (/\/email\/send-order/.test(u)) return j({ ok:true, id:'m1' });
    if (/\/jobs\b/.test(u)) return j([]);
    return j([]);
  });
  // Everything off the app's own domain (fonts, Mapbox) is unreachable from
  // this machine; fail it fast so no screen waits on a spinner that can
  // never resolve.
  await pg.route(/^https?:\/\/(?!.*railway)/, r => r.abort());
  await pg.addInitScript(([tok, comp]) => {
    if (tok){
      localStorage.setItem('fr_token','demo-token');
      localStorage.setItem('fr_user', JSON.stringify({ email:'you@yourroofing.co.nz', name:'You' }));
      localStorage.setItem('fr_company', JSON.stringify(comp));
    } else {
      localStorage.clear();
    }
  }, [token, company]);
  return { ctx, pg };
}

async function shot(pg, title, note){
  n++;
  const file = join(OUT, String(n).padStart(2,'0') + '.png');
  await pg.screenshot({ path: file, fullPage: false });
  shots.push({ n, file, title, note: note || '' });
  console.log(String(n).padStart(2,'0') + '  ' + title);
}

const b = await chromium.launch();

// ── 1. The public sign-up page ───────────────────────────────────
{
  const { ctx, pg } = await newPage(b, { token: false });
  await pg.route(/^file:.*$/, r => r.continue());
  await pg.goto('file://' + DIR + '/signup.html');
  await pg.waitForTimeout(900);
  await shot(pg, 'Sign-up page (roofmap.co.nz/signup)', 'Where a stranger starts. Reached from the homepage “Start free” buttons.');
  await ctx.close();
}

// ── 2. The app with no session: sign in / set a password ─────────
{
  const { ctx, pg } = await newPage(b, { token: false });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(1800);
  await shot(pg, 'Sign-in screen', 'What opens at roofmap.co.nz/app with no session.');
  const hasSetup = await pg.evaluate(() => typeof window.showSetupView === 'function');
  if (hasSetup){
    await pg.evaluate(() => showSetupView());
    await pg.waitForTimeout(500);
    await shot(pg, 'Set your password (from the invite / sign-up email)', 'The first screen of a brand-new account, opened from the email link.');
    await pg.evaluate(() => showForgotView());
    await pg.waitForTimeout(400);
    await shot(pg, 'Forgot password', 'Off the sign-in screen.');
  }
  await ctx.close();
}

// ── 3. First sign-in: the practice job, step by step ─────────────
// What a new account actually meets: Map Roof, John Smith's job at 23 Don
// Buck Road open, and one card. The satellite is unreachable here, so the
// walkthrough shows its fallback picture — on a real connection the same
// step shows the aerial of the property.
{
  const { ctx, pg } = await newPage(b);
  await pg.goto('file://' + DIR + '/app.html');
  const stepKey = () => pg.evaluate(() => (window.TOUR && TOUR.open && TOUR.steps[TOUR.i]) ? TOUR.steps[TOUR.i].key : '');
  const waitStep = async (key, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)){ if (await stepKey() === key) return true; await pg.waitForTimeout(150); } return false; };
  const cardTitle = () => pg.evaluate(() => (document.getElementById('tourTitle') || {}).textContent || '');
  const total = 15;
  let i = 0;
  const step = async (key, note) => { await waitStep(key, 7000); await pg.waitForTimeout(500); i++; await shot(pg, 'Practice job ' + i + ' of ' + total + ' — ' + (await cardTitle()), note); };
  await step('start', 'What a brand-new account sees first: Map Roof, the practice job open, and this one card. Nothing else opens on top of it.');
  await pg.evaluate(() => document.querySelector('#tourExtra button').click());
  await step('find', 'The finder button is ringed; the address is already filled in. Clicking it moves the card on — Next only does it for them.');
  await pg.click('#aerialFindBtn');
  await step('useview', 'The satellite finder. On a real connection the map is on the property; here the imagery is unreachable so it is blank.');
  await pg.evaluate(() => document.getElementById('tourNext').click());
  await step('pan', 'The picture is on the canvas (the labelled practice picture stands in for the aerial here). Dragging it completes the step.');
  await pg.evaluate(() => { IMG_OFFSET = { x: 40, y: 20 }; redrawAll(); });
  await step('zoom', 'Zooming completes it.');
  await pg.evaluate(() => adjustZoom(0.1));
  await step('rotate', 'Optional — the button says Skip.');
  await pg.evaluate(() => document.getElementById('tourNext').click());
  await step('outline', 'Trace the building. Completes when the outline closes.');
  await pg.evaluate(() => { DRAW.tool = 'outline'; DRAW.currentPts = [[220,200],[720,200],[720,560],[220,560]]; finishCurrent(); });
  await step('roofsetup', 'Roof type and pitch — the app\u2019s own popup, with the card waiting beside it.');
  await pg.evaluate(() => { document.getElementById('_rsPitch').value = '15'; document.getElementById('_rsOk').click(); });
  await step('scale', 'Satellite scale is roughly right; Calibrate scale for exact. Read and Next.');
  await pg.evaluate(() => document.getElementById('tourNext').click());
  await step('jobpack', 'The Job Pack gate: clicking the tab is the step.');
  await pg.click('#navJobPackBtn');
  await step('lineitems', 'Always check the calculations.');
  await pg.evaluate(() => document.getElementById('tourNext').click());
  await step('order', 'Order Roof.');
  await pg.evaluate(() => orderRoofViaSupplier());
  await step('checklist', 'The order checklist — every box before Confirm.');
  await pg.evaluate(() => { document.querySelectorAll('#orderChecklistModal .ordck').forEach(b => { b.checked = true; }); _orderChecklistSync(); document.getElementById('orderChecklistGo').click(); });
  await step('send', 'The order email, addressed to the signed-in person and locked there. Subject says TEST ORDER.');
  await pg.evaluate(() => { window._orderEmailBuildBlob = async () => new Blob(['pdf'], { type: 'application/pdf' }); _orderEmailSendNow(); });
  await step('done', 'Finished: carry on to quoting, or start their own job.');
  await ctx.close();
}

// ── 3b. The branding wizard — now only when something first goes out ──
{
  const { ctx, pg } = await newPage(b, { settings: SETTINGS_SEEN });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { try { _brandingBeforeSend(function(){}); } catch(e){} });
  await pg.waitForTimeout(700);
  await shot(pg, 'Set your business up (asked once, at the first real send)',
    'No longer opens at sign-in. It appears the first time a quote, an order or a job pack is about to go out under their name, and says why.');
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  await ctx.close();
}

// ── 4. The setup guide, card by card ─────────────────────────────
{
  const { ctx, pg } = await newPage(b, { settings: SETTINGS_SEEN });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
  await pg.evaluate(() => openSetupGuide(true));
  await pg.waitForTimeout(900);
  const total = await pg.evaluate(() => (window.SETUP && SETUP.steps ? SETUP.steps.length : 0));
  for (let i = 0; i < total; i++){
    const t = await pg.evaluate(() => {
      const st = SETUP.steps[SETUP.i] || {};
      return { key: st.key || '', title: (document.querySelector('#setupGuide h2, #setupGuide [id*=Title]') || {}).textContent || st.title || '' };
    });
    await shot(pg, 'Setup guide ' + (i+1) + ' of ' + total + ' — ' + (t.title || t.key),
      'Opt-in now: Settings → General → Open the setup guide. It no longer runs by itself.');
    if (i < total - 1){
      await pg.click('#sgNext').catch(() => {});
      await pg.waitForTimeout(450);
    }
  }
  await pg.evaluate(() => { const w = document.getElementById('setupGuide'); if (w) w.remove(); });
  await ctx.close();
}

// ── 5. The tutorial, step by step ────────────────────────────────
{
  const { ctx, pg } = await newPage(b, { settings: SETTINGS_SEEN });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { ['setupWizard','setupGuide'].forEach(id => { const w = document.getElementById(id); if (w) w.remove(); }); });
  await pg.evaluate(() => openTour(true));
  await pg.waitForTimeout(800);
  const total = await pg.evaluate(() => (window.TOUR && TOUR.steps ? TOUR.steps.length : 0));
  for (let i = 0; i < total; i++){
    const t = await pg.evaluate(() => {
      const st = (TOUR.steps || [])[TOUR.i] || {};
      const box = document.getElementById('tourBox');
      const h = box ? box.querySelector('strong, h2, div[style*="font-weight:8"]') : null;
      return { key: st.key || '', title: st.title || (h ? h.textContent : '') };
    });
    await shot(pg, 'Tutorial ' + (i+1) + ' of ' + total + ' — ' + (t.title || t.key),
      'The 29-step tour. Opt-in now: Settings → General → Run the tutorial. Every card carries "Help with this step".');
    if (i < total - 1){
      await pg.click('#tourNext').catch(() => {});
      await pg.waitForTimeout(500);
    }
  }
  await pg.evaluate(() => { const w = document.getElementById('tourWrap'); if (w) w.remove(); });
  await ctx.close();
}

// ── 6. Where a new account lands once the guides are done ────────
{
  const { ctx, pg } = await newPage(b, { settings: SETTINGS_SEEN });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(3200);
  await pg.evaluate(() => { ['setupWizard','setupGuide','tourWrap'].forEach(id => { const w = document.getElementById(id); if (w) w.remove(); }); });
  await pg.waitForTimeout(400);
  await shot(pg, 'Where a new account lands — Map Roof',
    'Signing in opens here. Carries the plan bar, the sample-job offer and the three optional questions.');
  await pg.evaluate(() => gotoTab('select'));
  await pg.waitForTimeout(600);
  await shot(pg, 'The Home tab', 'Still there, one click down the menu.');
  await ctx.close();
}

writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots, null, 1));
await b.close();
console.log('\n' + n + ' screens captured');
