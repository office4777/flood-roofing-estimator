// A roofer who signs up lands on a blank canvas with no idea that the quote
// comes from the price book, that the products list is theirs to change, or
// that Fergus is optional. Seven cards, each with a button to the screen it
// is talking about.
//
// The card that matters is the price book one. RoofMap now ships with real
// trade rates so the first quote is a believable number rather than zero —
// which makes it essential that nobody quotes a customer on them without
// being told. So the disclaimer is in the guide AND fires on its own the
// first time that screen is opened, because the guide can be skipped.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(opts){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',
      // maybeOpenSetup() only fires when /settings answers with an OBJECT, so
      // a test that wants the branding wizard has to be given one.
      body: ((opts||{}).keepWizard && /\/settings/.test(r.request().url()))
              ? JSON.stringify({ branding:{}, quote_defaults:{}, jms_keys:{} })
              : '[]' }));
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null');
    if (o.done) localStorage.setItem('fr_setup_done','1');
    if (o.site) localStorage.setItem('fr_site_mode','on');
  }, opts || {});
  await pg.goto('file://'+DIR+'/index.html');
  // 1.4s first-run delay, then the guide waits up to 2s for a branding wizard
  // to show up before opening anyway. Clear both.
  await pg.waitForTimeout(5200);
  // A brand-new account also gets the branding wizard, which is modal and
  // owns the screen first. Unless a test is specifically about that ordering,
  // dismiss it the way a roofer would ("I'll set this up later") and let the
  // guide take over — branding stays blank, so all seven cards still show.
  if (!(opts||{}).keepWizard){
    if (await pg.evaluate(() => { if (!document.getElementById('setupWizard')) return false;
                                  _swLater(); return true; }))
      await pg.waitForTimeout(1600);
  }
  return { ctx, pg, errs };
}

// ── it shows up on a first run, and not after ─────────────────────
let { ctx, pg, errs } = await boot({});
let v = await pg.evaluate(() => ({
  open: !!document.getElementById('setupGuide'),
  steps: ((window.SETUP && SETUP.steps) || []).length,
  title: (document.getElementById('sgTitle') || {}).textContent || '',
  dots: document.querySelectorAll('#sgDots span').length,
}));
check('a first login opens the setup guide', v.open, v.title);
check('…at step one of seven', v.steps === 7 && v.dots === 7 && /Welcome/.test(v.title),
  v.steps + ' steps');

// ── the price-book card, and its wording ──────────────────────────
await pg.evaluate(() => setupGuideStep(1));
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({
  title: document.getElementById('sgTitle').textContent,
  body: document.getElementById('sgBody').textContent,
  cta: document.getElementById('sgGo').textContent,
}));
check('step two is the price book', /price book/i.test(v.title), v.title);
check('…it says the rates are a starting point, not theirs',
  /starting point/i.test(v.body) && /not your prices/i.test(v.body));
check('…it tells them how to load their own', /Upload CSV/i.test(v.body));
check('…and it does not claim the rates belong to anyone',
  !/Flood/i.test(v.body), v.body.slice(0, 60) + '…');
check('…with a button to the screen itself', /price book/i.test(v.cta), v.cta);

// Following the button lands on the right screen and keeps the card.
await pg.evaluate(() => _setupGo());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  tab: document.body.getAttribute('data-tab'),
  panel: (document.getElementById('set-pricebook') || {}).className || '',
  stillThere: !!document.getElementById('setupGuide'),
  tucked: (document.getElementById('setupGuide') || {}).className || '',
}));
check('the button opens Settings → Price book', v.tab === 'settings' && / on|^on/.test(v.panel),
  v.tab + ' / ' + v.panel);
check('…and the card stays, tucked aside, so their place is not lost',
  v.stillThere && /sg-tucked/.test(v.tucked));

// ── it walks and finishes ─────────────────────────────────────────
v = await pg.evaluate(() => {
  const seen = [];
  for (let i = 0; i < SETUP.steps.length; i++){
    setupGuideStep(i);
    seen.push({ t: document.getElementById('sgTitle').textContent,
                go: document.getElementById('sgGo').style.display !== 'none' });
  }
  return { seen, last: document.getElementById('sgNext').textContent };
});
check('every step has a title', v.seen.every(x => x.t.length > 4), v.seen.length + ' steps');
check('the five setup steps each offer a way there, the first and last do not',
  v.seen.filter(x => x.go).length === 5, v.seen.filter(x => x.go).length + ' with a button');
check('the last step says Finish, not Next', v.last === 'Finish', v.last);
check('Fergus is offered as optional',
  v.seen.some(x => /Fergus/.test(x.t)) &&
  /only if you use it|skip/i.test(v.seen.find(x => /Fergus/.test(x.t)).t + ''),
  v.seen.find(x => /Fergus/.test(x.t)).t);

await pg.evaluate(() => closeSetupGuide(false));
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ gone: !document.getElementById('setupGuide'),
                               flag: localStorage.getItem('fr_setup_done') }));
check('finishing closes it and remembers', v.gone && v.flag === '1');
check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();

// ── second visit ──────────────────────────────────────────────────
({ ctx, pg, errs } = await boot({ done:true }));
v = await pg.evaluate(() => !!document.getElementById('setupGuide'));
check('it does not come back on the next login', !v);
v = await pg.evaluate(() => { openSetupGuide(true); return !!document.getElementById('setupGuide'); });
check('…but Settings can run it again', v);
await ctx.close();

// ── the disclaimer stands on its own ──────────────────────────────
({ ctx, pg, errs } = await boot({ done:true }));
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-pricebook'); });
await pg.waitForTimeout(600);
v = await pg.evaluate(() => {
  const m = document.getElementById('pbDiscModal');
  return { shown: !!m, txt: m ? m.textContent : '' };
});
check('opening the price book warns you about the rates even if setup was skipped',
  v.shown && /starting point/i.test(v.txt));
check('…and that warning names nobody either', v.shown && !/Flood/i.test(v.txt));
await pg.evaluate(() => document.getElementById('pbDiscOk').click());
await pg.evaluate(() => { switchSettingsSub('set-general'); switchSettingsSub('set-pricebook'); });
await pg.waitForTimeout(500);
v = await pg.evaluate(() => !!document.getElementById('pbDiscModal'));
check('…once, not every time', !v);
await ctx.close();

// ── it waits its turn behind the branding wizard ──────────────────
// Regression: the guide used to open on a 1.4s timer regardless, landing an
// overlay on top of the modal branding wizard. That swallowed the clicks on
// its "Save and get started" button, so a first-time user could not enter
// their own business details at all — the one thing they MUST do.
({ ctx, pg, errs } = await boot({ keepWizard:true }));
v = await pg.evaluate(() => ({
  wiz: !!document.getElementById('setupWizard'),
  guide: !!document.getElementById('setupGuide'),
}));
check('the branding wizard goes first, on its own', v.wiz && !v.guide,
  'wizard=' + v.wiz + ' guide=' + v.guide);
check('…so its Save button is actually clickable', await pg.evaluate(async () => {
  const btn = document.getElementById('swSaveBtn'); if (!btn) return false;
  const r = btn.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return !!top && (top === btn || btn.contains(top));
}));
// Dismiss it and the guide takes over.
await pg.evaluate(() => _swLater());
await pg.waitForTimeout(1800);
v = await pg.evaluate(() => ({ wiz: !!document.getElementById('setupWizard'),
                               guide: !!document.getElementById('setupGuide') }));
check('…and the guide follows once the wizard is gone', !v.wiz && v.guide,
  'wizard=' + v.wiz + ' guide=' + v.guide);
check('nothing threw while they took turns', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();

// ── it does not re-ask for what the wizard just collected ─────────
({ ctx, pg, errs } = await boot({}));
v = await pg.evaluate(() => {
  // Stand in for a saved wizard: the business now has a name.
  S.settings = S.settings || {}; S.settings.branding = { company_name:'Acme Roofing Ltd' };
  closeSetupGuide(false); openSetupGuide(true);
  return { n: SETUP.steps.length, keys: SETUP.steps.map(s => s.key) };
});
check('once the business is named, the branding card drops out',
  v.n === 6 && v.keys.indexOf('brand') < 0, v.n + ' steps: ' + v.keys.join(','));
check('…and the count reflects what they will actually see',
  await pg.evaluate(() => /of 6/.test(document.getElementById('sgCount').textContent)),
  await pg.evaluate(() => document.getElementById('sgCount').textContent));
check('…and Next still walks to the end without a dead card',
  await pg.evaluate(() => {
    for (let i = 0; i < 8; i++){
      const nx = document.getElementById('sgNext'); if (!nx) return false;
      if (nx.textContent === 'Finish') return !!document.getElementById('sgTitle').textContent;
      nx.click();
    }
    return false;
  }));
await ctx.close();

// ── not up a ladder ───────────────────────────────────────────────
({ ctx, pg, errs } = await boot({ site:true }));
v = await pg.evaluate(() => ({ site: document.documentElement.classList.contains('site-mode'),
                               guide: !!document.getElementById('setupGuide') }));
check('Site mode is left alone — nobody sets a price book up a ladder',
  v.site && !v.guide, 'siteMode=' + v.site + ' guide=' + v.guide);
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
