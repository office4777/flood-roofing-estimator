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

// ── a new account: the practice job, and nothing else ─────────────
let { ctx, pg, errs, usage, puts, sends } = await boot({});
await waitStep(pg, 'start', 7000);
let v = await overlays(pg);
check('a first sign-in lands on Map Roof with ONE thing open: the practice-job card', v.tab === 'roof' && v.tour && v.kind === 'firstroof' && !v.wizard && !v.guide,
  JSON.stringify(v));
v = await pg.evaluate(() => ({
  client: document.getElementById('jobClient').value, addr: document.getElementById('jobAddr').value, no: document.getElementById('jobNo').value,
  demo: !!(S.isSampleJob && S.demoKind === 'test'), id: S.currentJobId, strip: (document.querySelector('[data-sample-strip]') || {}).textContent || '',
  title: document.getElementById('tourTitle').textContent, buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent),
  label: (document.getElementById('navJobName') || {}).textContent || '',
}));
check('…it is John Smith at 23 Don Buck Road, Massey, as a demo job with no id', /John Smith/.test(v.client) && /23 Don Buck Road, Massey/.test(v.addr) && v.no === 'TEST-1' && v.demo && !v.id, JSON.stringify(v));
check('…the strip says it is the practice job and nothing saves', /practice job/.test(v.strip) && /not.*saved/.test(v.strip), v.strip.slice(0, 80));
check('…and the card offers start, the finished sample, or skip', /practice job/i.test(v.title) && v.buttons.length === 3 && /finished job/.test(v.buttons[1]) && /Skip/.test(v.buttons[2]), JSON.stringify(v.buttons));
check('the path is reported the moment it starts', usage.some(u => u.name === 'onboarding_path' && u.props.path === 'practice') && usage.some(u => u.name === 'walkthrough' && u.props.action === 'started'),
  JSON.stringify(usage.map(u => u.name + ':' + JSON.stringify(u.props))));

// Step 1: find the property. The click opens the finder; the card moves on by itself.
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('Start goes to "find the property", ringing the finder button', await waitStep(pg, 'find'), await stepKey(pg));
await pg.click('#aerialFindBtn');
check('…clicking it (not Next) moves the walkthrough on to "take the picture"', await waitStep(pg, 'useview'), await stepKey(pg));
v = await pg.evaluate(() => ({ modal: document.getElementById('aerialModal').style.display, addr: document.getElementById('aerialAddressInput').value,
  wait: (document.getElementById('tourRing') || {}).style.display, nextLbl: document.getElementById('tourNext').textContent }));
check('…the finder is open with the address already in it', v.modal === 'block' && /Don Buck/.test(v.addr), JSON.stringify(v));
// Satellite blocked: "Use this view" falls back to a practice picture.
await pg.evaluate(() => document.getElementById('tourNext').click());
await sleep(1800);
v = await pg.evaluate(() => ({ img: !!DRAW.bgImg, scale: DRAW.scaleMetresPerPx, modal: document.getElementById('aerialModal').style.display, key: TOUR.steps[TOUR.i].key }));
check('with no satellite reachable, the picture still lands (a labelled practice picture), scaled, finder closed', v.img && v.scale > 0 && v.modal === 'none', JSON.stringify(v));
check('…and the walkthrough starts with straightening, the rotate menu already open', await waitStep(pg, 'rotate'), await stepKey(pg));
check('…the failure was reported as the picture source, then the fallback', usage.some(u => u.name === 'roof_source' && u.props.failed) && usage.some(u => u.name === 'roof_source' && u.props.type === 'fallback'));
check('…and the address was not pinned to guessed coordinates — the geocoder gets first go', await pg.evaluate(() => window._autoLat === null && /Don Buck/.test(document.getElementById('aerialAddressInput').value)));
await sleep(600);
v = await pg.evaluate(() => ({ menu: document.getElementById('viewMenu').style.display, next: document.getElementById('tourNext').textContent,
  top: document.getElementById('roofPlanCard').getBoundingClientRect().top, ring: document.getElementById('tourRing').style.display }));
check('the picture landing scrolled the roof toolbar to the top of the screen and opened the rotate menu', v.menu === 'block' && v.top < 140 && v.ring === 'block', JSON.stringify(v));
check('…straightening is optional — the button says skip', /Skip/.test(v.next), v.next);
await pg.evaluate(() => _setFineRotate(2));
await sleep(900);
v = await pg.evaluate(() => ({ key: TOUR.steps[TOUR.i].key, next: document.getElementById('tourNext').textContent }));
check('rotating does NOT yank them off the step — the button turns into Next and waits', v.key === 'rotate' && v.next === 'Next', JSON.stringify(v));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('Next → Move / Edit, and the rotate menu is closed out of the way', await waitStep(pg, 'move') && await pg.evaluate(() => document.getElementById('viewMenu').style.display !== 'block'), await stepKey(pg));
await pg.click('#btn-move');
check('clicking Move / Edit moves on to dragging', await waitStep(pg, 'pan'), await stepKey(pg));
v = await pg.evaluate(() => ({ light: document.getElementById('tourCard').classList.contains('tour-light'), next: document.getElementById('tourNext').textContent, shadow: document.getElementById('tourRing').style.boxShadow }));
check('…the screen stays light while they drag, and the button says Skip until they have', v.light && v.next === 'Skip' && /5px/.test(v.shadow) && !/9999/.test(v.shadow), JSON.stringify(v));
await pg.evaluate(() => { IMG_OFFSET = { x: 40, y: 20 }; redrawAll(); });
await sleep(900);
v = await pg.evaluate(() => ({ key: TOUR.steps[TOUR.i].key, next: document.getElementById('tourNext').textContent }));
check('dragging waits for Next too', v.key === 'pan' && v.next === 'Next', JSON.stringify(v));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('Next → zoom', await waitStep(pg, 'zoom'), await stepKey(pg));
await pg.evaluate(() => adjustZoom(0.1));
await sleep(900);
check('zooming waits for Next as well', (await stepKey(pg)) === 'zoom' && (await pg.evaluate(() => document.getElementById('tourNext').textContent)) === 'Next');
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then "trace the building"', await waitStep(pg, 'outline'), await stepKey(pg));

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
check('…which says the satellite scale is roughly right and how to calibrate for exact', /roughly right/.test(v) && /Calibrate scale/.test(v), v.slice(0, 80));
await pg.click('#btn-calibrate');
check('clicking Calibrate scale → "click a line to calibrate"', await waitStep(pg, 'calibrate-line'), await stepKey(pg));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then the Job Pack gate', await waitStep(pg, 'jobpack'), await stepKey(pg));
await pg.click('#navJobPackBtn');
check('clicking Job Pack lands on "always check the calculations"', await waitStep(pg, 'lineitems'), await stepKey(pg));
v = await pg.evaluate(() => ({ tab: document.body.getAttribute('data-tab'), body: document.getElementById('tourBody').textContent }));
check('…on the Job Pack tab, telling them to check every quantity against the roof', v.tab === 'materials' && /Check them against the roof/.test(v.body), JSON.stringify(v).slice(0, 120));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('then Order Roof', await waitStep(pg, 'order'), await stepKey(pg));

// Order: the checklist arrives ticked, then confirm, supplier, send.
await pg.evaluate(() => orderRoofViaSupplier());
check('the checklist opens — and NOT the branding wizard, on a demo job', await waitStep(pg, 'checklist') && !(await overlays(pg)).wizard, await stepKey(pg));
v = await pg.evaluate(() => ({ all: Array.from(document.querySelectorAll('#orderChecklistModal .ordck')).every(b => b.checked), tickAll: document.getElementById('ordckAll').checked, go: !document.getElementById('orderChecklistGo').disabled }));
check('…every line is pre-ticked on the practice job, the Tick-every-line box with them, Confirm enabled', v.all && v.tickAll && v.go, JSON.stringify(v));
check('…and after three seconds it points at Confirm & order roof by itself', await waitStep(pg, 'confirm', 5000), await stepKey(pg));
await pg.evaluate(() => document.getElementById('orderChecklistGo').click());
check('confirming opens the email and points at the supplier list', await waitStep(pg, 'supplier'), await stepKey(pg));
v = await pg.evaluate(() => document.getElementById('tourBody').textContent);
check('…saying to set default suppliers up in Settings', /default suppliers in Settings/.test(v), v.slice(0, 80));
check('…then, after three seconds, the Send button', await waitStep(pg, 'send', 5000), await stepKey(pg));
v = await pg.evaluate(() => ({ to: document.getElementById('orderEmailCustomTo').value, ro: document.getElementById('orderEmailCustomTo').readOnly,
  sel: document.getElementById('orderEmailSupplier').disabled, opt: document.getElementById('orderEmailSupplier').options[0].textContent,
  subject: document.getElementById('orderEmailSubject').value, body: document.getElementById('tourBody').textContent }));
check('the order is addressed to the signed-in person, locked, with no supplier offered', v.to === 'me@acmeroofing.co.nz' && v.ro && v.sel && /Send to me/.test(v.opt), JSON.stringify(v));
check('…the subject says it is a test order, and the card says the example goes to their email', /TEST ORDER/.test(v.subject) && /to your own email/.test(v.body), v.subject);
// A recipient swapped in by hand is refused.
v = await pg.evaluate(() => { const el = document.getElementById('orderEmailCustomTo'); el.readOnly = false; el.value = 'orders@merchant.co.nz'; const o = _orderEmailGather(); el.value = 'me@acmeroofing.co.nz'; return o; });
check('…a merchant address typed in anyway is refused', v === null);
await pg.evaluate(() => { window._orderEmailBuildBlob = async () => new Blob(['pdf'], { type: 'application/pdf' }); });
await pg.evaluate(() => _orderEmailSendNow());
check('sending lands on the finish card', await waitStep(pg, 'done', 6000), await stepKey(pg));
check('…the send went to them, flagged as a test, and stamped no job into the account',
  sends.length === 1 && sends[0].to === 'me@acmeroofing.co.nz' && sends[0].test === true && /TEST ORDER/.test(sends[0].subject) && !(await pg.evaluate(() => S.currentJobId || S.orderSent)),
  JSON.stringify(sends.map(s => [s.to, s.test])));
v = await pg.evaluate(() => Array.from(document.querySelectorAll('#tourExtra button')).map(b => b.textContent));
check('the finish card offers quoting or their own job', v.length === 2 && /quoting/.test(v[0]) && /own job/.test(v[1]), JSON.stringify(v));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
await sleep(500);
v = await overlays(pg);
const flag = await pg.evaluate(() => localStorage.getItem('fr_first_roof'));
check('"Carry on to quoting" closes the walkthrough on the Quote tab', !v.tour && v.tab === 'quote', JSON.stringify(v));
check('…remembers it as done, on this device and on the account', flag === 'done' && puts.some(p => p.first_roof === 'done'), flag + ' / ' + JSON.stringify(puts));
check('…without marking the 29-step tutorial as seen', !(await pg.evaluate(() => localStorage.getItem('fr_tour_done'))) && !puts.some(p => p.tour_done));
const shown = usage.filter(u => u.name === 'walkthrough' && u.props.action === 'shown').map(u => u.props.step);
check('every step was reported as it was shown, and the end as finished',
  shown.join() === 'start,find,useview,rotate,move,pan,zoom,outline,corners,rooftype,pitch,scale,calibrate-line,jobpack,lineitems,order,checklist,confirm,supplier,send,done' && usage.some(u => u.name === 'walkthrough' && u.props.action === 'finished'),
  shown.join());
check('…and the order milestone carries the example flag', usage.some(u => u.name === 'output_created' && u.props.example === true && u.props.kind === 'order'));
check('…and every event from the demo job says so', usage.filter(u => /walkthrough|roof_source|output_created/.test(u.name)).every(u => u.props.example === true));

// Where they were when they left: the last screen goes out as the tab hides.
await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(600);
v = usage.filter(u => u.name === 'screen_left').pop();
check('hiding the tab reports which screen they were on and for how long', !!v && v.props.screen === 'quote' && typeof v.props.seconds === 'number', JSON.stringify(v));
check('nothing threw along the way', errs.length === 0, errs.join(' | ').slice(0, 200) || 'no page errors');
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
v = await pg.evaluate(() => { startFirstRoof(); return { tour: !!document.getElementById('tourWrap'), kind: TOUR.kind, client: document.getElementById('jobClient').value }; });
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
v = await pg.evaluate(() => (document.getElementById('aboutYouCard') || {}).textContent || '');
check('the setup questions card says "Three things" and counts three', /Three things/.test(v) && !/Two things/.test(v) && (await pg.evaluate(() => document.querySelectorAll('#aboutYouCard select').length)) === 3, v.slice(0, 60));
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
