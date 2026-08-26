// The tutorial: a ring round the real button, not a description of it.
//
// The thing that goes wrong with a guided tour is silent rot. A selector
// stops matching because a button was renamed, the step quietly skips, and
// the tour still "works" — it just walks past the feature it existed to
// explain. So the first thing this suite does is walk every step and prove
// every one of them found something on screen.
//
// The second thing is the escape hatch. A tutorial that traps you is worse
// than no tutorial, so the backdrop must never swallow clicks and Cancel
// must be on every step.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null');
    if (!o.firstRun) localStorage.setItem('fr_setup_done','1');
    if (o.tourDone) localStorage.setItem('fr_tour_done','1');
  }, opts);
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(opts.firstRun ? 5200 : 2600);
  return { ctx, pg, errs };
}

// ── every step points at something ────────────────────────────────
let { ctx, pg, errs } = await boot({});
await pg.evaluate(() => openTour(true));
await pg.waitForTimeout(700);
let v = await pg.evaluate(() => ({
  open: !!document.getElementById('tourWrap'),
  total: (window.TOUR_STEPS || []).length,
  shown: ((window.TOUR && TOUR.steps) || []).length,
  title: (document.getElementById('tourTitle')||{}).textContent || '',
  count: (document.getElementById('tourCount')||{}).textContent || '',
}));
check('the tutorial opens', v.open, v.title);
check('…on the welcome card', /run round RoofMap/i.test(v.title), v.title);
check('…counting every step it will show', v.shown === v.total && /Step 1 of/.test(v.count),
  v.shown + '/' + v.total + ' · ' + v.count);
check('…with Cancel tutorial on it',
  await pg.evaluate(() => (document.getElementById('tourCancel')||{}).textContent === 'Cancel tutorial'));

// Walk the whole thing with the card's own button and record what each step
// landed on. A step that found nothing is the failure this suite exists for.
const walk = await pg.evaluate(async () => {
  const seen = [], sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let guard = 0; guard < 80; guard++){
    if (!document.getElementById('tourWrap')) break;
    const st = TOUR.steps[TOUR.i];
    // Ask the engine what it actually ended up pointing at, so a step with a
    // fallback target is judged on the element it really rang.
    const el = st.centre ? null : _tourEl(st);
    const sel = st.centre ? '' : (st._alt ? st.alt.sel : (st.gate || st.sel || ''));
    const r = el ? el.getBoundingClientRect() : null;
    const ring = document.getElementById('tourRing').getBoundingClientRect();
    seen.push({
      key: st.key, tab: st.tab || '', sel: sel, alt: !!st._alt,
      found: st.centre ? true : !!(r && r.width > 2 && r.height > 2),
      gated: !!st.gate,
      // The ring has to be round the target, not parked at the origin.
      ringOnTarget: st.centre ? true : !!(r && Math.abs(ring.left - (r.left - 7)) < 3
                                            && Math.abs(ring.top - (r.top - 7)) < 3),
      body: (document.getElementById('tourBody')||{}).textContent || '',
      next: (document.getElementById('tourNext')||{}).textContent || '',
      hand: (document.getElementById('tourHand')||{}).textContent || '',
    });
    const last = TOUR.i === TOUR.steps.length - 1;
    document.getElementById('tourNext').click();
    await sleep(360);
    if (last) break;
  }
  return { seen, stillOpen: !!document.getElementById('tourWrap'), done: localStorage.getItem('fr_tour_done') };
});
const missing = walk.seen.filter(s => !s.found);
check('every step found the element it points at', missing.length === 0,
  missing.map(s => s.key + ' → ' + s.sel).join(', ') || walk.seen.length + ' steps');
const offTarget = walk.seen.filter(s => !s.ringOnTarget);
check('…and the highlight is drawn round it, not parked at the corner',
  offTarget.length === 0, offTarget.map(s => s.key).join(', '));
check('…every step reached, none skipped',
  walk.seen.length === v.total, walk.seen.length + ' of ' + v.total);
check('…each one carrying a pointing finger', walk.seen.filter(s => !s.gated && s.sel)
  .every(s => /[\u{1F446}-\u{1F449}]/u.test(s.hand)),
  walk.seen.map(s => s.hand).join(''));
check('the last step finishes and closes it', !walk.stillOpen && walk.done === '1',
  walk.stillOpen ? 'still open' : 'closed, done=' + walk.done);

// A step whose real target does not exist on an empty job must fall back and
// still explain the feature — never vanish.
const rt = walk.seen.find(s => s.key === 'roof-type');
check('the roof-type step survives an empty job', !!rt && rt.found, rt ? rt.sel : 'missing');
check('…by pointing at the outline button instead',
  !!rt && rt.alt && rt.sel === '#btn-outline', rt && rt.sel);
check('…and still explaining Change roof type and Clearlite',
  !!rt && /Change roof type/.test(rt.body) && /Clearlite/.test(rt.body), rt && rt.body.slice(0,60));

// ── it covers all six tabs ────────────────────────────────────────
const tabs = [...new Set(walk.seen.map(s => s.tab).filter(Boolean))];
check('it walks every tab in the menu',
  ['select','roof','materials','quote','settings','feedback'].every(t => tabs.includes(t)), tabs.join(' '));
const gated = walk.seen.filter(s => s.gated);
check('…each one entered through its own menu button, not jumped to',
  gated.length === 6 && gated.every(s => /^#nav/.test(s.sel)), gated.map(s => s.sel).join(' '));
check('…and the gate step names the button to click',
  gated.every(s => /^Click /.test(s.next)), gated.map(s => s.next).join(' | '));

// ── the features it was written for ───────────────────────────────
const all = walk.seen.map(s => s.body).join('\n');
check('it explains the roof-setup popup', /roof shape and the sheet material/i.test(all));
check('…the boxed penetration flashing set', /boxed.{0,20}penetration/i.test(all) && /saddle/i.test(all));
check('…the per-roof pricing tabs', /tab per roof/i.test(all) && /optional extra/i.test(all));
check('…the whole-job flashing total', /flashing metres/i.test(all));
check('…that feedback reaches support@roofmap.co.nz', /support@roofmap\.co\.nz/.test(all));
check('…and where to run it again', /Settings → General/i.test(all));

// ── clicking the real tab is what a gate wants ────────────────────
await pg.evaluate(() => { localStorage.removeItem('fr_tour_done'); openTour(true); });
await pg.waitForTimeout(600);
await pg.evaluate(() => document.getElementById('tourNext').click());   // welcome → Home gate
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ key: TOUR.steps[TOUR.i].key, next: document.getElementById('tourNext').textContent }));
check('step two is the Home gate', v.key === 'tab-home' && /Home/.test(v.next), v.key + ' · ' + v.next);
await pg.click('#navHomeBtn');
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({ key: TOUR.steps[TOUR.i].key, tab: document.body.getAttribute('data-tab') }));
check('…clicking the real menu button moves it on', v.key === 'home-new', v.key);
check('…and lands on that tab', v.tab === 'select', v.tab);

// ── nothing is trapped behind it ──────────────────────────────────
v = await pg.evaluate(() => {
  const w = getComputedStyle(document.getElementById('tourWrap')).pointerEvents;
  const ring = getComputedStyle(document.getElementById('tourRing')).pointerEvents;
  const card = getComputedStyle(document.getElementById('tourCard')).pointerEvents;
  // What actually receives a click in the middle of the screen.
  const hit = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
  return { w, ring, card, hitId: hit ? (hit.id || hit.tagName) : '' , inTour: !!(hit && hit.closest && hit.closest('#tourWrap')) };
});
check('the backdrop does not swallow clicks', v.w === 'none' && v.ring === 'none', v.w + ' / ' + v.ring);
check('…while the card itself is still clickable', v.card === 'auto', v.card);
check('…so the app underneath stays usable', !v.inTour, v.hitId);

// ── cancel, and it stays cancelled ────────────────────────────────
await pg.evaluate(() => document.getElementById('tourCancel').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ open: !!document.getElementById('tourWrap'), done: localStorage.getItem('fr_tour_done') }));
check('Cancel tutorial closes it', !v.open);
check('…and remembers, so it does not reopen by itself', v.done === '1', v.done);
await pg.evaluate(() => openTour(false));
await pg.waitForTimeout(300);
check('…even when something asks it to open again',
  !(await pg.evaluate(() => !!document.getElementById('tourWrap'))));

// ── Settings runs it again on purpose ─────────────────────────────
v = await pg.evaluate(() => {
  gotoTab('settings'); switchSettingsSub('set-general');
  const btn = document.querySelector('[data-tour="set-tutorial"]');
  if (!btn) return { btn:false };
  btn.click();
  return { btn:true, open:!!document.getElementById('tourWrap'), label: btn.textContent.trim() };
});
check('Settings → General has a Run the tutorial button', v.btn, v.label);
check('…and it opens even though the tutorial was finished', v.open);
await pg.evaluate(() => closeTour(false));
check('no page errors', errs.length === 0, errs.slice(0,2).join(' | '));
await ctx.close();

// ── with a roof on screen it rings the real button ────────────────
({ ctx, pg, errs } = await boot({}));
v = await pg.evaluate(() => {
  gotoTab('roof');
  DRAW.outline = [[0,0],[600,0],[600,400],[0,400]]; DRAW.outlineDone = true;
  DRAW.lines = [{ type:'ridge', pts:[[100,200],[500,200]], measM:8 }];
  DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 25;
  try { updateStepUI(); } catch(e){}
  const p = document.getElementById('roofTypePanel'); if (p) p.style.display = 'block';
  try { _syncRoofTypeDropLabel(); redrawAll(); } catch(e){}
  return true;
});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  openTour(true);
  const st = TOUR_STEPS.find(s => s.key === 'roof-type');
  const el = _tourEl(st);
  return { alt: !!st._alt, id: el ? el.id : '', body: _tourStepBody(st).slice(0, 40) };
});
check('once a roof is drawn it points at the real Change roof type button',
  v.id === 'roofTypeDropBtn' && !v.alt, v.id + (v.alt ? ' (fallback)' : ''));
check('…with the wording for that button, not the fallback',
  /^Hip & valley/.test(v.body), v.body);
await pg.evaluate(() => closeTour(false));
await ctx.close();

// ── first login: it follows the setup guide, once ─────────────────
({ ctx, pg, errs } = await boot({ firstRun: true }));
v = await pg.evaluate(() => ({ guide: !!document.getElementById('setupGuide'), tour: !!document.getElementById('tourWrap') }));
check('the setup guide comes first on a brand-new account', v.guide, JSON.stringify(v));
check('…and the tutorial does not fight it for the screen', !v.tour);
await pg.evaluate(() => closeSetupGuide(false));
await pg.waitForTimeout(1200);
v = await pg.evaluate(() => ({ tour: !!document.getElementById('tourWrap'),
                               title: (document.getElementById('tourTitle')||{}).textContent || '' }));
check('finishing the setup guide starts the tutorial', v.tour, v.title);
await pg.evaluate(() => closeTour(false));
await pg.waitForTimeout(200);
// Second time round it must not reappear.
await pg.evaluate(() => { closeSetupGuide(false); });
await pg.waitForTimeout(1200);
check('…but only ever once', !(await pg.evaluate(() => !!document.getElementById('tourWrap'))));
check('no page errors on the first run', errs.length === 0, errs.slice(0,2).join(' | '));
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
