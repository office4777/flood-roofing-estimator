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
  await pg.goto('file://'+DIR+'/app.html');
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
check('…at step one of nine', v.steps === 9 && v.dots === 9 && /Welcome/.test(v.title),
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
    // The button is shown and hidden as a ROW now (button + the line saying
    // where that screen lives), so the row is what carries the state.
    seen.push({ t: document.getElementById('sgTitle').textContent,
                go: getComputedStyle(document.getElementById('sgGoRow')).display !== 'none' });
  }
  return { seen, last: document.getElementById('sgNext').textContent };
});
check('every step has a title', v.seen.every(x => x.t.length > 4), v.seen.length + ' steps');
check('the seven setup steps each offer a way there, the first and last do not',
  v.seen.filter(x => x.go).length === 7, v.seen.filter(x => x.go).length + ' with a button');
check('the last step says Finish, not Next', v.last === 'Finish', v.last);
check('Fergus is offered as optional',
  v.seen.some(x => /Fergus/.test(x.t)) &&
  /only if you use it|skip/i.test(v.seen.find(x => /Fergus/.test(x.t)).t + ''),
  v.seen.find(x => /Fergus/.test(x.t)).t);

// ── the logo, on every card ───────────────────────────────────────
v = await pg.evaluate(() => {
  const out = [];
  for (let i = 0; i < SETUP.steps.length; i++){
    setupGuideStep(i);
    const img = document.getElementById('sgLogo');
    out.push(!!img && /roofmap/i.test(img.getAttribute('src') || ''));
  }
  return { all: out.every(Boolean), n: out.length };
});
check('every step carries the RoofMap logo', v.all, v.n + ' steps checked');

// ── step one names the tabs in bold ───────────────────────────────
v = await pg.evaluate(() => {
  setupGuideStep(0);
  const b = document.getElementById('sgBody');
  return { bold: [...b.querySelectorAll('strong')].map(x => x.textContent),
           text: b.textContent };
});
check('the four tab names are bold on the welcome card',
  ['Map Roof','Job Pack','Quote','Settings'].every(t => v.bold.indexOf(t) >= 0),
  v.bold.join(', '));
check('…and nothing leaks the ** markers into the copy', !/\*\*/.test(v.text));

// ── every card with a button says where that screen lives ─────────
v = await pg.evaluate(() => {
  const rows = [];
  // Untuck first: a tucked card is 380px, where the line SHOULD drop under
  // the button. What is being checked here is the full-width card.
  const card = document.getElementById('setupGuide');
  if (card) card.classList.remove('sg-tucked');
  for (let i = 0; i < SETUP.steps.length; i++){
    setupGuideStep(i);
    const st = SETUP.steps[i];
    const row = document.getElementById('sgGoRow');
    const wh = document.getElementById('sgWhere');
    const go = document.getElementById('sgGo');
    rows.push({ key: st.key, hasGo: !!st.go,
                rowShown: getComputedStyle(row).display !== 'none',
                display: getComputedStyle(row).display,
                txt: wh.textContent.trim(),
                sameLine: !!st.go && Math.abs(wh.getBoundingClientRect().top -
                                              go.getBoundingClientRect().top) < 30 });
  }
  return rows;
});
const withGo = v.filter(r => r.hasGo);
check('every step with a button tells you where that screen lives',
  withGo.length === 7 &&
  withGo.every(r => /Settings tab, in the .+ section/.test(r.txt) ||
                    /Send Feedback is in the left-hand menu/.test(r.txt)),
  withGo.map(r => r.key).join(', '));
check('…and it sits beside the button, not under it',
  withGo.every(r => r.sameLine && r.display === 'flex'),
  withGo.filter(r => !r.sameLine).map(r => r.key).join(',') || 'all beside');
check('…while the cards with no button show no row at all',
  v.filter(r => !r.hasGo).every(r => !r.rowShown),
  v.filter(r => !r.hasGo).map(r => r.key).join(', '));
check('…and when the card tucks into a corner it wraps under instead of vanishing',
  await pg.evaluate(() => {
    const card = document.getElementById('setupGuide');
    setupGuideStep(1);
    card.classList.add('sg-tucked');
    const wh = document.getElementById('sgWhere');
    const shown = wh.offsetParent !== null && wh.getBoundingClientRect().width > 40;
    card.classList.remove('sg-tucked');
    return shown;
  }));
check('a card that sends you outside Settings brings its own sentence',
  await pg.evaluate(() => {
    const st = SETUP_STEPS.filter(s => s.key === 'feedback')[0];
    return !st.where && /Send Feedback/.test(st.whereText || '');
  }));
check('the section names match real Settings tabs', await pg.evaluate(() => {
  const tabs = [...document.querySelectorAll('.set-nav .tab-sm')].map(b => b.textContent.trim());
  return SETUP_STEPS.filter(s => s.where).every(s => tabs.indexOf(s.where) >= 0);
}), await pg.evaluate(() => SETUP_STEPS.filter(s => s.where).map(s => s.where).join(' | ')));

// ── the three cards whose copy was written to explain the product ──
v = await pg.evaluate(() => {
  const find = k => SETUP_STEPS.filter(s => s.key === k)[0].body;
  return { brand: find('brand'), jms: find('jms'), supl: find('suppliers') };
});
check('the quote card explains the live online quote, not a PDF',
  /online quote/i.test(v.brand) && /not a boring PDF/i.test(v.brand) &&
  /emailing system/i.test(v.brand), 'brand card');
check('…and that selections, questions and acceptance come back',
  /selections/i.test(v.brand) && /questions/i.test(v.brand) &&
  /acceptance/i.test(v.brand) && /status board/i.test(v.brand));
check('the Fergus card explains all three directions',
  /[Pp]hotos/.test(v.jms) && /pull in/i.test(v.jms) &&
  /job pack pushes back as a PDF/i.test(v.jms) &&
  /new quote version/i.test(v.jms), 'jms card');
check('the material-ordering card explains suppliers and the order email',
  /suppliers?/i.test(v.supl) && /material order/i.test(v.supl) &&
  /copy of every order/i.test(v.supl), 'suppliers card');
check('…and it is its own step, named Material ordering',
  await pg.evaluate(() => SETUP_STEPS.filter(s => s.key === 'suppliers')[0].title === 'Material ordering'));

// ── the Send Feedback card ────────────────────────────────────────
v = await pg.evaluate(() => {
  const st = SETUP_STEPS.filter(s => s.key === 'feedback')[0];
  return { title: st.title, body: st.body, tab: (st.go||{}).tab, cta: st.cta };
});
check('Send Feedback has a step of its own', !!v.title, v.title);
check('…that promises the turnaround', /two hours/i.test(v.body), 'two hours');
check('…and says detail is what makes the fix quick and thorough',
  /more detail you give/i.test(v.body) && /faster/i.test(v.body) && /thoroughly/i.test(v.body));
// The roofer describes the problem; the app supplies the rest. Asking somebody
// on a roof for their browser and what tab they were on is how you get a
// report that says "it's broken".
check('…and that they only have to describe the problem',
  /only have to describe the problem/i.test(v.body) &&
  /captured and attached automatically/i.test(v.body));
check('…with the cost of a vague report spelled out',
  /guess/i.test(v.body) && /second round/i.test(v.body));
check('…and its button opens the Send Feedback tab, not a Settings section',
  v.tab === 'feedback');

// The tab itself says the same, because most people never run the guide.
v = await pg.evaluate(() => {
  gotoTab('feedback');
  const card = document.getElementById('tab-feedback');
  return { txt: card.textContent.replace(/\s+/g, ' '),
           ph: (document.getElementById('fbDetails')||{}).placeholder || '' };
});
check('the Send Feedback tab promises the same turnaround', /two hours/i.test(v.txt));
check('…and asks for detail, with a reason', /more detail you give/i.test(v.txt) &&
  /thoroughly/i.test(v.txt) && /guess/i.test(v.txt));
check('…and tells them the context is captured for them',
  /captured and attached/i.test(v.txt) && /automatically/i.test(v.txt));
check('…while the empty box shows a real example, not a form to fill in',
  /^example:/i.test(v.ph) && /ridge lines/i.test(v.ph) &&
  !/what i did/i.test(v.ph) && !/happened instead/i.test(v.ph),
  v.ph.slice(0, 60));
await pg.evaluate(() => gotoTab('settings'));

await pg.evaluate(() => openSetupGuide(true));
await pg.waitForTimeout(150);
await pg.evaluate(() => setupGuideStep(SETUP.steps.length - 1));
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
  v.n === 8 && v.keys.indexOf('brand') < 0, v.n + ' steps: ' + v.keys.join(','));
check('…and the count reflects what they will actually see',
  await pg.evaluate(() => /of 8/.test(document.getElementById('sgCount').textContent)),
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
