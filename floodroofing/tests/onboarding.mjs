// The first sign-in, end to end. A new account lands on Map Roof with the
// practice job open — John Smith, 23 Don Buck Road, Massey — and ONE card
// walking them through it: find the property, take the picture, centre,
// zoom, straighten, trace, roof type and pitch, scale, Job Pack, check the
// numbers, order, send the order to themselves, done. Nothing else opens on
// top of it (the branding wizard waits for the first real send; the setup
// guide and the 29-step tour are opt-in), nothing on the practice job saves
// or goes to a supplier, and every step is reported so the daily report can
// say where people stop.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await chromium.launch();
async function boot(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const usage = [], puts = [], sends = [];
  // No satellite, no geocoder: the walkthrough has to survive without them.
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/nominatim.openstreetmap.org/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/\/usage/.test(u) && m === 'POST'){ try { usage.push(JSON.parse(r.request().postData() || '{}')); } catch(e){} return j({ ok: true }); }
    if (/\/settings\/ui-flags/.test(u)){ try { puts.push(JSON.parse(r.request().postData() || '{}')); } catch(e){} return j({ ok: true }); }
    if (/\/practice\/job/.test(u)){
      if (opts.noPractice) return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No practice picture' }) });
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#6f8f5a"/><rect x="250" y="150" width="400" height="300" fill="#5d6970"/></svg>';
      return j({ job_no: 'TEST-1', draw_state: { state: { img64: null }, draw: { bg: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), bgW: 900, bgH: 600,
        imgView: { zoom: 1, offX: 0, offY: 0, rot: 0 }, scaleMetresPerPx: 0.03, scaleAuto: false, geoScale: null, rotation: 0 } } });
    }
    if (/\/email\/send-order/.test(u)){ try { sends.push(JSON.parse(r.request().postData() || '{}')); } catch(e){} return j({ ok: true, id: 'm1' }); }
    if (/\/settings/.test(u) && m === 'GET') return j({ branding: opts.branded ? { company_name: 'Acme Roofing Ltd' } : {}, quote_defaults: {}, jms_keys: {},
                                                        ui_flags: opts.flags === undefined ? { first_roof: 'offer' } : opts.flags });
    if (/\/subscription/.test(u)) return j({ live: true, status: 'trialing', plan: 'trial', trial_ends_at: new Date(Date.now() + 12 * 864e5).toISOString() });
    if (/\/jobs/.test(u) && m === 'GET') return j(opts.jobs || []);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_user', JSON.stringify({ email: 'me@acmeroofing.co.nz', name: 'Sam Tui' }));
    localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Acme Roofing Ltd', role: 'owner', plan: 'trial' }));
    if (o.done) localStorage.setItem('fr_first_roof', o.done);
  }, opts);
  await pg.goto('file://' + DIR + '/app.html');
  return { ctx, pg, errs, usage, puts, sends };
}
const stepKey = pg => pg.evaluate(() => (window.TOUR && TOUR.open && TOUR.steps[TOUR.i]) ? TOUR.steps[TOUR.i].key : '');
async function waitStep(pg, key, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)){ if (await stepKey(pg) === key) return true; await sleep(150); }
  return false;
}
const overlays = pg => pg.evaluate(() => ({
  wizard: !!document.getElementById('setupWizard'), guide: !!document.getElementById('setupGuide'),
  tour: !!document.getElementById('tourWrap'), kind: window.TOUR && TOUR.kind, plan: !!document.querySelector('#planGate, #planGateModal'),
  tab: document.body.getAttribute('data-tab'),
}));

// ── a new account: one card, their own roof first ─────────────────
let { ctx, pg, errs, usage, puts, sends } = await boot({});
await waitStep(pg, 'start', 7000);
let v = await overlays(pg);
check('a first sign-in lands on Map Roof with ONE thing open: the first-roof card', v.tab === 'roof' && v.tour && v.kind === 'firstroof' && !v.wizard && !v.guide,
  JSON.stringify(v));
v = await pg.evaluate(() => ({ title: document.getElementById('tourTitle').textContent, addr: !!document.getElementById('frAddr'),
  buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent), demo: !!S.isSampleJob, client: document.getElementById('jobClient').value }));
check('…it asks what roof THEY are quoting, with the practice roof as the fallback and a skip',
  /What roof are you quoting/.test(v.title) && v.addr && v.buttons.length === 3 && /Quote this roof/.test(v.buttons[0]) && /practice roof/.test(v.buttons[1]) && /Skip/.test(v.buttons[2]), JSON.stringify(v));
check('…and nothing has been opened yet — no demo job, no practice job', !v.demo && v.client === '');
check('…no survey and no sample banner crowd it', await pg.evaluate(() => !document.querySelector('#aboutYouCard select') && !document.querySelector('#sampleJobBannerRoof .sj-card')));
check('an empty address is refused, not accepted', await pg.evaluate(() => { _firstRoofOwnGo(); return !!document.getElementById('frAddr') && TOUR.steps[TOUR.i].key === 'start'; }));

// The practice path.
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[1].click());
check('"Use the practice roof" opens the practice job and goes straight to "trace the building"', await waitStep(pg, 'outline', 9000), await stepKey(pg));
v = await pg.evaluate(() => ({
  client: document.getElementById('jobClient').value, addr: document.getElementById('jobAddr').value, no: document.getElementById('jobNo').value,
  demo: !!(S.isSampleJob && S.demoKind === 'test'), id: S.currentJobId, strip: (document.querySelector('[data-sample-strip]') || {}).textContent || '',
  img: !!DRAW.bgImg, w: DRAW.bgImg && DRAW.bgImg.naturalWidth, scale: DRAW.scaleMetresPerPx, folded: document.getElementById('roofBgBody').style.display,
  top: document.getElementById('roofPlanCard').getBoundingClientRect().top, path: FIRST_ROOF.path,
}));
check('…it is John Smith at 23 Don Buck Road, Massey, as a demo job with no id', /John Smith/.test(v.client) && /23 Don Buck Road, Massey/.test(v.addr) && v.no === 'TEST-1' && v.demo && !v.id && v.path === 'practice', JSON.stringify(v));
check('…the strip says it is the practice job and nothing saves', /practice job/.test(v.strip) && /not.*saved/.test(v.strip), v.strip.slice(0, 80));
check('…with the prepared aerial already on the canvas, at its saved scale, card folded, toolbar in view', v.img && v.w === 900 && v.scale === 0.03 && v.folded === 'none' && v.top < 420, JSON.stringify(v));
check('the path is reported the moment it starts', usage.some(u => u.name === 'onboarding_path' && u.props.path === 'practice') && usage.some(u => u.name === 'walkthrough' && u.props.action === 'started'),
  JSON.stringify(usage.map(u => u.name + ':' + JSON.stringify(u.props))));
check('…reported as an aerial source, not a fallback', usage.some(u => u.name === 'roof_source' && u.props.type === 'aerial') && !usage.some(u => u.name === 'roof_source' && u.props.type === 'fallback'));
v = await pg.evaluate(() => {
  const card = document.getElementById('tourCard').getBoundingClientRect();
  return ['tourCancel', 'tourHelp', 'tourBack', 'tourNext'].map(id => { const r = document.getElementById(id).getBoundingClientRect();
    return { id, inside: r.left >= card.left - 1 && r.right <= card.right + 1 && r.top >= card.top - 1 && r.bottom <= card.bottom + 1, w: Math.round(r.width) }; });
});
check('every button sits inside the card, even with a long label', v.every(b => b.inside), JSON.stringify(v));

// Trace: the tool, then the corners one by one, then Enter.
await pg.click('#btn-outline');
check('clicking Building outline moves to "click each corner"', await waitStep(pg, 'corners'), await stepKey(pg));
v = await pg.evaluate(() => ({ body: document.getElementById('tourBody').textContent, light: document.getElementById('tourCard').classList.contains('tour-light') }));
check('…pointing at the canvas, screen kept light, saying to click each corner', /Click on each corner/.test(v.body) && v.light, JSON.stringify(v).slice(0, 100));
await pg.evaluate(() => { DRAW.currentPts = [[120,120],[520,120],[520,420],[120,420]]; });
await sleep(800);
v = await pg.evaluate(() => document.getElementById('tourBody').textContent);
check('…after the fourth corner it says to press Enter', /4 corners/.test(v) && /Press Enter/.test(v), v.slice(0, 90));
await pg.evaluate(() => finishCurrent());
check('closing the outline moves on to "select your roof type"', await waitStep(pg, 'rooftype'), await stepKey(pg));
await sleep(200);
v = await pg.evaluate(() => ({ modal: !!document.getElementById('_rsModal'), ring: document.getElementById('tourRing').style.display }));
check('…with the popup open and the roof types ringed', v.modal && v.ring === 'block', JSON.stringify(v));
await pg.evaluate(() => document.querySelector('#_rsTypes [data-rstype="hip"]').click());
check('picking a type moves on to the pitch', await waitStep(pg, 'pitch'), await stepKey(pg));
await pg.evaluate(() => { document.getElementById('_rsPitch').value = '15'; document.getElementById('_rsOk').click(); });
check('Draw the roof → the scale explanation', await waitStep(pg, 'scale'), await stepKey(pg));
v = await pg.evaluate(() => document.getElementById('tourBody').textContent);
check('…which calls the satellite scale approximate and says to calibrate using a known measurement', /approximate/.test(v) && /calibrate using a known measurement/.test(v) && !/exact/.test(v), v.slice(0, 80));
check('…and the skip button says so too', /Use approximate scale for this practice/.test(await pg.evaluate(() => document.getElementById('tourNext').textContent)));
await pg.click('#btn-calibrate');
check('clicking Calibrate scale → "click a line to calibrate"', await waitStep(pg, 'calibrate-line'), await stepKey(pg));
// Picking the line opens the Set scale popup; the step must WAIT for the
// Calibrate button, not jump on before the length is typed.
await pg.evaluate(() => { DRAW.calibratePixels = 200; document.getElementById('calPopup').style.display = 'block'; });
await sleep(900);
v = await pg.evaluate(() => ({ key: TOUR.steps[TOUR.i].key, body: document.getElementById('tourBody').textContent }));
check('picking the line does not move on — the card now says to type the length and click Calibrate', v.key === 'calibrate-line' && /click Calibrate/.test(v.body), JSON.stringify(v));
await pg.evaluate(() => { document.getElementById('calPopup').style.display = 'none'; DRAW.scaleLabel = '1px=20.00mm | ref:10m flat'; });
check('Calibrate (scale set, popup gone) → the Job Pack gate', await waitStep(pg, 'jobpack'), await stepKey(pg));
await pg.click('#navJobPackBtn');
check('clicking Job Pack lands on "always check the calculations"', await waitStep(pg, 'lineitems'), await stepKey(pg));
v = await pg.evaluate(() => ({ tab: document.body.getAttribute('data-tab'), body: document.getElementById('tourBody').textContent, buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent) }));
check('…on the Job Pack tab, telling them to check every quantity against the roof', v.tab === 'materials' && /Check them against the roof/.test(v.body), JSON.stringify(v).slice(0, 120));
check('…and this is a finishing point: send a test order, skip to the price, or start my own roof', v.buttons.length === 3 && /Send test order/.test(v.buttons[0]) && /price/.test(v.buttons[1]) && /own roof/.test(v.buttons[2]), JSON.stringify(v.buttons));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('"Send test order" → Order Roof', await waitStep(pg, 'order'), await stepKey(pg));

// Order: the checklist arrives ticked, then confirm, supplier, send.
await pg.evaluate(() => orderRoofViaSupplier());
check('the checklist opens — and NOT the branding wizard, on a demo job', await waitStep(pg, 'checklist') && !(await overlays(pg)).wizard, await stepKey(pg));
v = await pg.evaluate(() => ({ all: Array.from(document.querySelectorAll('#orderChecklistModal .ordck')).every(b => b.checked), tickAll: document.getElementById('ordckAll').checked, go: !document.getElementById('orderChecklistGo').disabled }));
check('…every line is pre-ticked on the practice job, the Tick-every-line box with them, Confirm enabled', v.all && v.tickAll && v.go, JSON.stringify(v));
await sleep(1200);
check('…and it waits for Next, not a timer', (await stepKey(pg)) === 'checklist' && (await pg.evaluate(() => document.getElementById('tourNext').textContent)) === 'Next');
await pg.evaluate(() => document.getElementById('tourNext').click());
check('Next → Confirm & order roof', await waitStep(pg, 'confirm'), await stepKey(pg));
await pg.evaluate(() => document.getElementById('orderChecklistGo').click());
check('confirming opens the email and points at the supplier list', await waitStep(pg, 'supplier'), await stepKey(pg));
v = await pg.evaluate(() => document.getElementById('tourBody').textContent);
check('…saying to set default suppliers up in Settings', /default suppliers in Settings/.test(v), v.slice(0, 80));
await sleep(1200);
check('…and waits for Next there too', (await stepKey(pg)) === 'supplier');
await pg.evaluate(() => document.getElementById('tourNext').click());
check('Next → the Send button', await waitStep(pg, 'send'), await stepKey(pg));
v = await pg.evaluate(() => ({ to: document.getElementById('orderEmailCustomTo').value, ro: document.getElementById('orderEmailCustomTo').readOnly,
  sel: document.getElementById('orderEmailSupplier').disabled, opt: document.getElementById('orderEmailSupplier').options[0].textContent,
  subject: document.getElementById('orderEmailSubject').value, body: document.getElementById('tourBody').textContent }));
check('the order is addressed to the signed-in person, locked, with no supplier offered', v.to === 'me@acmeroofing.co.nz' && v.ro && v.sel && /Send to me/.test(v.opt), JSON.stringify(v));
check('…the subject says it is a test order, and the card says the example goes to their email', /TEST ORDER/.test(v.subject) && /to your own email/.test(v.body), v.subject);
v = await pg.evaluate(() => { const el = document.getElementById('orderEmailCustomTo'); el.readOnly = false; el.value = 'orders@merchant.co.nz'; const o = _orderEmailGather(); el.value = 'me@acmeroofing.co.nz'; return o; });
check('…a merchant address typed in anyway is refused', v === null);
await pg.evaluate(() => { window._orderEmailBuildBlob = async () => new Blob(['pdf'], { type: 'application/pdf' }); });
await pg.evaluate(() => _orderEmailSendNow());
check('sending goes on to the Quote gate — the other half', await waitStep(pg, 'quote', 6000), await stepKey(pg));
check('…the send went to them, flagged as a test, and stamped no job into the account',
  sends.length === 1 && sends[0].to === 'me@acmeroofing.co.nz' && sends[0].test === true && !sends[0].cc && /TEST ORDER/.test(sends[0].subject) && !(await pg.evaluate(() => S.currentJobId || S.orderSent)),
  JSON.stringify(sends.map(s => [s.to, s.test])));
check('…and the order popups were closed out of the way', await pg.evaluate(() => document.getElementById('orderEmailModal').style.display === 'none'));

// The quote: pricing panel, the customer's pages, sending.
await pg.click('#navQuoteBtn');
check('clicking Quote lands on "where the price is built" with the pricing panel open', await waitStep(pg, 'pricing') && await pg.evaluate(() => document.getElementById('quotePricingPanel').classList.contains('is-open')), await stepKey(pg));
v = await pg.evaluate(() => document.getElementById('tourBody').textContent);
check('…which says the rates come from Settings → Price book and the practice job uses the sample rates', /Price book/.test(v) && /sample rates/.test(v), v.slice(0, 100));
// The pricing panel, card by card — each one pointed at with the panel open.
const PRICE_STEPS = [['p-scaffold', /scaffolding price/, '#scaffoldCard'], ['p-labour', /overwrite the calculated hours/, '#labourTableWrap'], ['p-material', /calculated automatically/, '#materialPriceTableWrap'], ['p-gutters', /not added to the roof price/, '#gutterDownpipeCard'], ['p-profit', /labour price per m²/, '#profitCard']];
let priceOk = true, priceWhy = '';
for (const [k, re, sel] of PRICE_STEPS){
  await pg.evaluate(() => document.getElementById('tourNext').click());
  const got = await waitStep(pg, k);
  const st = await pg.evaluate(sel => ({ body: document.getElementById('tourBody').textContent, open: document.getElementById('quotePricingPanel').classList.contains('is-open'), there: !!document.querySelector(sel) && document.querySelector(sel).getBoundingClientRect().width > 0 }), sel);
  if (!got || !re.test(st.body) || !st.open || !st.there){ priceOk = false; priceWhy += k + ':' + JSON.stringify({ got, st: { open: st.open, there: st.there, body: st.body.slice(0, 60) } }) + ' '; }
}
check('Next walks the pricing panel: scaffolding, labour hours, materials, gutters, profitability — panel open, each card on screen', priceOk, priceWhy);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then "close the pricing tab and look at the quote"', await waitStep(pg, 'q-close') && /Close the pricing tab/.test(await pg.evaluate(() => document.getElementById('tourBody').textContent)), await stepKey(pg));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('"Close it for me" closes the panel and lands on the cover page', await waitStep(pg, 'q-cover') && !(await pg.evaluate(() => document.getElementById('quotePricingPanel').classList.contains('is-open'))), await stepKey(pg));
const PAGE_STEPS = [['q-page1', /existing roof photos/], ['q-page2', /include or leave out/], ['q-page3', /edited in Settings/], ['q-page4', /most common roofing product/], ['q-page5', /terms and conditions/], ['q-page6', /Accept quote/]];
let pageOk = true, pageWhy = '';
for (const [k, re] of PAGE_STEPS){
  await pg.evaluate(() => document.getElementById('tourNext').click());
  const got = await waitStep(pg, k);
  const st = await pg.evaluate(() => ({ body: document.getElementById('tourBody').textContent, ring: !!document.getElementById('tourRing') && document.getElementById('tourRing').getBoundingClientRect().height > 40 }));
  if (!got || !re.test(st.body)){ pageOk = false; pageWhy += k + ':' + JSON.stringify({ got, body: st.body.slice(0, 60) }) + ' '; }
}
check('then the six pages, one step each: condition + photos, what is included + options, selections, product, terms, acceptance', pageOk, pageWhy);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('Next → Email Quote: on the practice job, send yourself the test quote', await waitStep(pg, 'qsend') && /goes to you/.test(await pg.evaluate(() => document.getElementById('tourBody').textContent)), await stepKey(pg));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('"Open it for me" opens the email and points at Send', await waitStep(pg, 'qsend-go'), await stepKey(pg));
v = await pg.evaluate(() => ({ to: document.getElementById('quoteEmailTo').value, ro: document.getElementById('quoteEmailTo').readOnly, cc: document.getElementById('quoteEmailCc').textContent }));
check('…addressed to the signed-in person, locked, copied to nobody', v.to === 'me@acmeroofing.co.nz' && v.ro && /nobody/.test(v.cc), JSON.stringify(v));
await pg.evaluate(() => { window._buildQuotePdf = async () => null; _quoteEmailSendNow(); });
check('sending lands on the finish card', await waitStep(pg, 'done', 6000), await stepKey(pg));
check('…the quote went to them as a TEST QUOTE, flagged, with no customer link published and no job saved',
  sends.length === 2 && sends[1].to === 'me@acmeroofing.co.nz' && sends[1].test === true && sends[1].kind === 'quote' && !sends[1].cc && /TEST QUOTE/.test(sends[1].subject) && !/https?:\/\//.test(sends[1].text) && !(await pg.evaluate(() => S.currentJobId)),
  JSON.stringify(sends.map(s => [s.to, s.test, s.kind, s.subject])));
v = await pg.evaluate(() => ({ title: document.getElementById('tourTitle').textContent, body: document.getElementById('tourBody').textContent, buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent) }));
check('…which says the first job is complete and to look at the test order and quote in their email, with Finish first', /completed your first job/.test(v.title) && /test order and the test quote/.test(v.body) && v.buttons[0] === 'Finish', JSON.stringify(v));
v = await pg.evaluate(() => Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent));
check('the finish card offers finish, or their own roof', v.length === 2 && /Finish/.test(v[0]) && /own roof/.test(v[1]), JSON.stringify(v));
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[0].click());
await sleep(500);
v = await overlays(pg);
const flag = await pg.evaluate(() => localStorage.getItem('fr_first_roof'));
check('"Finish" closes the walkthrough', !v.tour, JSON.stringify(v));
check('…remembers it as done, on this device and on the account, and clears the resume point', flag === 'done' && puts.some(p => p.first_roof === 'done') && (await pg.evaluate(() => !localStorage.getItem('fr_first_roof_at'))), flag + ' / ' + JSON.stringify(puts));
check('…without marking the 29-step tutorial as seen', !(await pg.evaluate(() => localStorage.getItem('fr_tour_done'))) && !puts.some(p => p.tour_done));
const shown = usage.filter(u => u.name === 'walkthrough' && u.props.action === 'shown').map(u => u.props.step);
check('every step was reported as it was shown, and the end as finished',
  shown.join() === 'start,outline,corners,rooftype,pitch,scale,calibrate-line,jobpack,lineitems,order,checklist,confirm,supplier,send,quote,pricing,p-scaffold,p-labour,p-material,p-gutters,p-profit,q-close,q-cover,q-page1,q-page2,q-page3,q-page4,q-page5,q-page6,qsend,qsend-go,done' && usage.some(u => u.name === 'walkthrough' && u.props.action === 'finished'),
  shown.join());
check('…and the order milestone carries the example flag', usage.some(u => u.name === 'output_created' && u.props.example === true && u.props.kind === 'order'));
check('…and every event from the demo job says so', usage.filter(u => /roof_source|output_created/.test(u.name)).every(u => u.props.example === true));

// Where they were when they left: the last screen goes out as the tab hides.
await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(600);
v = usage.filter(u => u.name === 'screen_left').pop();
check('hiding the tab reports which screen they were on and for how long', !!v && v.props.screen === 'settings' || (!!v && v.props.screen === 'quote'), JSON.stringify(v));
check('nothing threw along the way', errs.length === 0, errs.join(' | ').slice(0, 200) || 'no page errors');
await ctx.close();

// ── their own roof: a real job, theirs to keep ────────────────────
({ ctx, pg, errs, usage, puts } = await boot({}));
await waitStep(pg, 'start', 7000);
await pg.fill('#frAddr', '12 Kerikeri Road, Kerikeri');
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('"Quote this roof" sets up a real job at that address and points at the finder', await waitStep(pg, 'find', 8000), await stepKey(pg));
v = await pg.evaluate(() => ({ addr: document.getElementById('jobAddr').value, finder: document.getElementById('aerialAddressInput').value, demo: !!S.isSampleJob, strip: (document.querySelector('[data-sample-strip]') || {}).textContent || '', path: FIRST_ROOF.path }));
check('…the address is on the job and in the finder, and it is NOT a demo', /Kerikeri Road/.test(v.addr) && /Kerikeri Road/.test(v.finder) && !v.demo && !v.strip && v.path === 'own', JSON.stringify(v));
check('…the path is reported as their own, not an example', usage.some(u => u.name === 'onboarding_path' && u.props.path === 'own' && !u.props.example));
await pg.click('#aerialFindBtn');
check('the finder opens → "take the picture"', await waitStep(pg, 'useview'), await stepKey(pg));
// No imagery here: put a picture on the canvas the way Use this view would.
await pg.evaluate(() => { _closeAerialModal(); _firstRoofFallbackImage(); });
check('the picture landing → one "square it up" step (rotate, move, zoom together)', await waitStep(pg, 'adjust', 6000), await stepKey(pg));
v = await pg.evaluate(() => ({ body: document.getElementById('tourBody').textContent, menu: document.getElementById('viewMenu').style.display, sel: typeof TOUR.steps[TOUR.i].sel === 'string' ? TOUR.steps[TOUR.i].sel : '' }));
check('…pointing at the Rotate photo slider, with the menu open, saying to slide the bar to square it up', v.sel === '#fineRotateSlider' && v.menu === 'block' && /Slide the/.test(v.body) && /Rotate photo/.test(v.body), JSON.stringify(v));
v = await pg.evaluate(() => ({ next: document.getElementById('tourNext').textContent, light: document.getElementById('tourCard').classList.contains('tour-light') }));
check('…light, and skippable', /Looks right/.test(v.next) && v.light, JSON.stringify(v));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then trace', await waitStep(pg, 'outline'), await stepKey(pg));
await pg.evaluate(() => { DRAW.tool = 'outline'; DRAW.currentPts = [[120,120],[520,120],[520,420],[120,420]]; finishCurrent(); });
await waitStep(pg, 'rooftype');
await pg.evaluate(() => { document.querySelector('#_rsTypes [data-rstype="hip"]').click(); });
await waitStep(pg, 'pitch');
await pg.evaluate(() => { document.getElementById('_rsPitch').value = '22'; document.getElementById('_rsOk').click(); });
check('roof type and pitch as before → scale', await waitStep(pg, 'scale'), await stepKey(pg));
check('…worded for a real quote', /quote you will stand behind/.test(await pg.evaluate(() => document.getElementById('tourBody').textContent)) && /for now/.test(await pg.evaluate(() => document.getElementById('tourNext').textContent)));
await pg.evaluate(() => document.getElementById('tourNext').click());
await waitStep(pg, 'jobpack');
await pg.click('#navJobPackBtn');
check('Job Pack → check the calculations, with Price it / Finish here (no ordering on their own roof)', await waitStep(pg, 'lineitems') && (await pg.evaluate(() => Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent))).join() === 'Price it,Finish here', await stepKey(pg));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('"Price it" → the Quote gate', await waitStep(pg, 'quote'), await stepKey(pg));
await pg.click('#navQuoteBtn');
await waitStep(pg, 'pricing');
check('…the pricing card tells them to put their OWN rates in before it goes to a customer', /put your own in/.test(await pg.evaluate(() => document.getElementById('tourBody').textContent)));
for (const k of ['p-scaffold', 'p-labour', 'p-material', 'p-gutters', 'p-profit', 'q-close', 'q-cover', 'q-page1', 'q-page2', 'q-page3', 'q-page4', 'q-page5', 'q-page6', 'qsend']){
  await pg.evaluate(() => document.getElementById('tourNext').click()); if (!(await waitStep(pg, k))) { check('own roof walks the pricing cards and the pages to Email Quote', false, 'stuck before ' + k + ' at ' + (await stepKey(pg))); break; }
}
check('…Email Quote is explained as the real send on their own roof', /your customer a link/.test(await pg.evaluate(() => document.getElementById('tourBody').textContent)));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then the finish card, offering the price book', await waitStep(pg, 'done') && /rates/.test((await pg.evaluate(() => document.querySelector('#tourExtra button').textContent))), await stepKey(pg));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
await sleep(400);
check('"Put my rates in" closes the walkthrough on the price book', await pg.evaluate(() => !document.getElementById('tourWrap') && document.body.getAttribute('data-tab') === 'settings'));
check('nothing threw on their own roof', errs.length === 0, errs.join(' | ').slice(0, 200) || 'no page errors');
await ctx.close();

// ── left mid-way: carry on from there ─────────────────────────────
({ ctx, pg, errs, usage, puts } = await boot({}));
await waitStep(pg, 'start', 7000);
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[1].click());
await waitStep(pg, 'outline', 9000);
await pg.click('#btn-outline');
await waitStep(pg, 'corners');
await pg.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await sleep(400);
v = await pg.evaluate(() => ({ st: localStorage.getItem('fr_first_roof'), at: JSON.parse(localStorage.getItem('fr_first_roof_at') || 'null') }));
check('closing the tab mid-walkthrough remembers the step as "left", on the device and the account',
  v.st === 'left' && v.at && v.at.step === 'corners' && v.at.path === 'practice' && puts.some(p => p.first_roof === 'left' && p.first_roof_at && p.first_roof_at.step === 'corners'), JSON.stringify(v) + ' ' + JSON.stringify(puts.slice(-1)));
await ctx.close();
({ ctx, pg, errs, usage } = await boot({ flags: { first_roof: 'left', first_roof_at: { step: 'corners', path: 'practice', jobId: null } } }));
await waitStep(pg, 'resume', 7000);
v = await pg.evaluate(() => ({ title: document.getElementById('tourTitle').textContent, body: document.getElementById('tourBody').textContent, buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent) }));
check('next login offers to carry on from that step, naming it', /Carry on where you left off/.test(v.title) && /Click each corner/.test(v.body) && /practice roof/.test(v.body) && v.buttons.length === 3, JSON.stringify(v));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('"Carry on" opens the practice job at that step', await waitStep(pg, 'corners', 9000) && /John Smith/.test(await pg.evaluate(() => document.getElementById('jobClient').value)), await stepKey(pg));
check('…and says so in the events', usage.some(u => u.name === 'onboarding_path' && u.props.path === 'resumed') && usage.some(u => u.name === 'walkthrough' && u.props.action === 'resumed' && u.props.step === 'corners'));
await pg.evaluate(() => closeTour(true));
check('a deliberate Stop is "stopped" — not offered again', (await pg.evaluate(() => localStorage.getItem('fr_first_roof'))) === 'stopped');
await ctx.close();
({ ctx, pg, errs } = await boot({ flags: { first_roof: 'stopped' } }));
await sleep(4500);
check('…so a stopped walkthrough stays stopped next login', !(await overlays(pg)).tour);
await ctx.close();

// ── no practice picture on the server: the drawn stand-in ─────────
({ ctx, pg, errs, usage } = await boot({ noPractice: true }));
await waitStep(pg, 'start', 9000);
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[1].click());
await waitStep(pg, 'outline', 9000);
v = await pg.evaluate(() => ({ img: !!DRAW.bgImg, w: DRAW.bgImg && DRAW.bgImg.naturalWidth, scale: DRAW.scaleMetresPerPx }));
check('with no practice picture on the server, the labelled stand-in is on the canvas instead', v.img && v.w === 1280 && v.scale > 0, JSON.stringify(v));
check('…and it says so in the events', usage.some(u => u.name === 'roof_source' && u.props.type === 'fallback'));
await ctx.close();

// ── the other two doors on the start card ─────────────────────────
({ ctx, pg, errs, usage, puts } = await boot({}));
await waitStep(pg, 'start', 7000);
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[2].click());
await sleep(400);
v = await overlays(pg);
const f2 = await pg.evaluate(() => localStorage.getItem('fr_first_roof'));
check('"Skip" closes it, remembers it as stopped, and opens nothing else', !v.tour && !v.wizard && !v.guide && f2 === 'stopped' && usage.some(u => u.name === 'onboarding_path' && u.props.path === 'skipped'), JSON.stringify(v) + ' ' + f2);
await ctx.close();

// ── it is offered once, by the server ─────────────────────────────
({ ctx, pg, errs } = await boot({ flags: { first_roof: 'has-work' } }));
await sleep(4500);
v = await overlays(pg);
check('an account the server says has work sees no walkthrough', !v.tour && !v.wizard && !v.guide, JSON.stringify(v));
check('…and its state is mirrored to this device', (await pg.evaluate(() => localStorage.getItem('fr_first_roof'))) === 'has-work');
await ctx.close();
({ ctx, pg, errs } = await boot({ flags: {} }));
await sleep(4500);
v = await overlays(pg);
check('with no offer from the server, nothing starts on the device’s own guess', !v.tour && !v.wizard && !v.guide, JSON.stringify(v));
await ctx.close();
({ ctx, pg, errs } = await boot({ done: 'done' }));
await sleep(4500);
v = await overlays(pg);
check('a device that already did it sees nothing either', !v.tour && !v.wizard && !v.guide, JSON.stringify(v));
check('…the setup guide and the tutorial do not open on their own any more', !v.guide && !v.tour);
await pg.evaluate(() => startFirstRoof());
await waitStep(pg, 'start', 9000);
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[1].click());
await waitStep(pg, 'outline', 9000);
v = await pg.evaluate(() => ({ tour: !!document.getElementById('tourWrap'), kind: TOUR.kind, client: document.getElementById('jobClient').value }));
check('Settings → General → "Run the practice job" starts it again on demand', v.tour && v.kind === 'firstroof' && /John Smith/.test(v.client), JSON.stringify(v));
check('…and the button is on the General settings screen', await pg.evaluate(() => !!document.querySelector('[data-tour="set-practice"]')));
await ctx.close();

// ── the branding wizard waits for the first real send ─────────────
({ ctx, pg, errs } = await boot({ flags: {} }));
await sleep(3000);
v = await pg.evaluate(() => {
  const before = !!document.getElementById('setupWizard');
  window.__ran = 0;
  const took = _brandingBeforeSend(function(){ window.__ran++; });
  const w = document.getElementById('setupWizard');
  const r = document.getElementById('swSaveBtn').getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return { before, took, wiz: !!w, why: w.textContent, clickable: !!top && (top === document.getElementById('swSaveBtn') || document.getElementById('swSaveBtn').contains(top)),
           guide: !!document.getElementById('setupGuide'), tour: !!document.getElementById('tourWrap') };
});
check('an unbranded account is NOT asked for its details at sign-in', !v.before);
check('…it is asked the first time something goes out under its name, and told why', v.took && v.wiz && /Before this goes out under your name/.test(v.why), v.why.slice(0, 80));
check('…the wizard has the screen to itself, Save clickable', v.clickable && !v.guide && !v.tour);
check('…a second send while it is up does not stack another', await pg.evaluate(() => _brandingBeforeSend(function(){}) && document.querySelectorAll('#setupWizard').length === 1));
await pg.evaluate(() => _swLater());
await sleep(1800);
v = await pg.evaluate(() => ({ wiz: !!document.getElementById('setupWizard'), guide: !!document.getElementById('setupGuide'), tour: !!document.getElementById('tourWrap'), ran: window.__ran, active: _onbActive() }));
check('"later" closes it and nothing follows it onto the screen', !v.wiz && !v.guide && !v.tour && !v.active && v.ran === 0, JSON.stringify(v));
v = await pg.evaluate(() => { S.isSampleJob = true; S.demoKind = 'sample'; const t = _brandingBeforeSend(function(){}); const w = !!document.getElementById('setupWizard'); S.isSampleJob = false; return { t, w }; });
check('…and the sample job never asks — nothing it sends is real', !v.t && !v.w);
v = await pg.evaluate(() => { localStorage.setItem('fr_first_roof', 'done'); _aboutYouSync(); return (document.getElementById('aboutYouCard') || {}).textContent || ''; });
check('the setup questions card, once the practice job is behind them, says "Three things" and counts three', /Three things/.test(v) && !/Two things/.test(v) && (await pg.evaluate(() => document.querySelectorAll('#aboutYouCard select').length)) === 3, v.slice(0, 60));
// Help with this step: the feedback form, with the step named.
v = await pg.evaluate(() => { openTour(true); _tourHelp(); return { tab: document.body.getAttribute('data-tab'), title: document.getElementById('fbTitle').value, details: document.getElementById('fbDetails').value, tour: !!document.getElementById('tourWrap') }; });
check('"Help with this step" opens Feedback with the step already named, tutorial still up', v.tab === 'feedback' && /Stuck at: /.test(v.title) && /could not get past it/.test(v.details) && v.tour, JSON.stringify(v).slice(0, 140));
check('…and the sources are named for what they are: aerial, drone photo, PDF plan',
  await pg.evaluate(() => /aerial photo, drone photo or PDF plan/.test(document.getElementById('roofBgBar').textContent) && /drone photo, site photo or PDF plan/i.test(document.getElementById('roofUZ').textContent)));
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 200) || 'no page errors');
await ctx.close();

await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
