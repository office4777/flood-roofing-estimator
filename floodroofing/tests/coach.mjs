// The getting-started coach (the owner, 2026-09-30): "I just set up a new
// trial ... and no onboarding or helpful information appeared." A new
// account's first login: Photos folded away, a welcome naming Settings →
// Guides, then one pointer at a time on their OWN first roof — the picture
// (satellite, drone shot or PDF plan), the Building outline, NOTHING while
// the corners go in, "press Enter" once it looks finished, nothing over the
// roof-type window, the real-measurement tip, the Job Pack, the Quote, and
// a last card with the guides, support@roofmap.co.nz and the Help bubble.
// Also pinned: another account's answer on the same browser never swallows
// the welcome (it did — the owner's own "done" was still on his laptop).
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
  const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const puts = [], usage = [];
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/nominatim.openstreetmap.org/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/\/usage/.test(u) && m === 'POST'){ try { usage.push(JSON.parse(r.request().postData() || '{}')); } catch(e){} return j({ ok: true }); }
    if (/\/settings\/ui-flags/.test(u)){ try { puts.push(JSON.parse(r.request().postData() || '{}')); } catch(e){} return j({ ok: true }); }
    if (/\/settings/.test(u) && m === 'GET') return j({ branding: {}, quote_defaults: {}, jms_keys: {}, ui_flags: opts.flags || { first_roof: 'offer' } });
    if (/\/subscription/.test(u)) return j({ live: true, status: 'trialing', plan: 'trial', trial_ends_at: new Date(Date.now() + 12 * 864e5).toISOString() });
    return j([]);
  });
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_user', JSON.stringify({ email: 'sales@acme.co.nz', name: 'Sam' }));
    localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Acme', role: 'owner', plan: 'trial' }));
    if (o.local) localStorage.setItem('fr_first_roof', o.local);
  }, opts);
  await pg.goto('file://' + DIR + '/app.html');
  return { ctx, pg, errs, puts, usage };
}
const key = pg => pg.evaluate(() => (window.TOUR && TOUR.open && TOUR.steps[TOUR.i]) ? TOUR.steps[TOUR.i].key : '');
async function waitKey(pg, k, ms){ const t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)){ if (await key(pg) === k) return true; await sleep(120); } return false; }
const card = pg => pg.evaluate(() => {
  const w = document.getElementById('tourWrap');
  const n = document.getElementById('tourNext');
  return { shown: !!w && w.style.display !== 'none', title: (document.getElementById('tourTitle') || {}).textContent || '',
           body: (document.getElementById('tourBody') || {}).textContent || '', count: (document.getElementById('tourCount') || {}).textContent || '',
           next: (n && n.style.display !== 'none') ? n.textContent : '',
           ring: (document.getElementById('tourRing') || { style: {} }).style.display,
           buttons: Array.from(document.querySelectorAll('#tourExtra button')).map(x => x.textContent) };
});
const putPicture = (pg, w, h) => pg.evaluate(([w, h]) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#6f8f5a'; x.fillRect(0, 0, w, h);
  const im = new Image(); im.onload = () => { _applyCanvasBg(im, { zoom: 1, offX: 0, offY: 0, rot: 0 }); res(); }; im.src = c.toDataURL();
}), [w, h]);

// ── the welcome ───────────────────────────────────────────────────
let { ctx, pg, errs, puts, usage } = await boot({});
check('a new account is welcomed on its first login', await waitKey(pg, 'c-welcome', 9000), await key(pg));
let v = await card(pg);
let p = await pg.evaluate(() => {
  const fp = document.getElementById('fergusRoofPanel');
  return { tab: document.body.getAttribute('data-tab'), kind: TOUR.kind, photos: !!(fp && fp.classList.contains('is-open')),
           practice: !!(S.isSampleJob && S.demoKind === 'test') };
});
check('…on Map Roof, on their own roof (not the practice job), with the Photos panel folded away',
  p.tab === 'roof' && p.kind === 'coach' && !p.photos && !p.practice, JSON.stringify(p));
check('…the welcome says the guides and tutorials are in Settings → Guides',
  /Welcome to RoofMap/.test(v.title) && /Guides and tutorials/.test(v.body) && /Settings → Guides/.test(v.body) && v.shown, JSON.stringify(v));
check('…no "Step 1 of 9" and no Back',
  !v.count && await pg.evaluate(() => document.getElementById('tourBack').style.visibility === 'hidden'), v.count);
await pg.evaluate(() => document.querySelector('#tourExtra button').click());

// ── step one: the picture ─────────────────────────────────────────
check('"Show me how" → it points at the picture box', await waitKey(pg, 'c-picture'), await key(pg));
v = await card(pg);
p = await pg.evaluate(() => TOUR.steps[TOUR.i].sel);
check('…explaining the satellite image, or a drone shot or PDF plan uploaded from the PC',
  p === '#roofBgCard' && /Find your property/.test(v.body) && /satellite image/.test(v.body) && /drone shot/.test(v.body) &&
  /PDF plan/.test(v.body) && /Upload from PC/.test(v.body) && /PDF Plans/.test(v.body) && v.ring === 'block', JSON.stringify(v));
check('…with the "look at a finished job" banner held back while the tips run',
  await pg.evaluate(() => !document.querySelector('#sampleJobBannerRoof .sj-card')));
check('…and offers no Next: nothing moves on until the picture is there', !v.next, v.next);
await pg.evaluate(() => _openAerialModal()); await sleep(700);
check('…the card gets out of the way while the satellite finder is open', !(await card(pg)).shown);
await pg.evaluate(() => _closeAerialModal()); await sleep(700);
v = await card(pg);
check('…and comes back, still on the picture, when it closes without one', v.shown && await key(pg) === 'c-picture', await key(pg));
await putPicture(pg, 900, 600);

// ── the outline ───────────────────────────────────────────────────
// ── zoom and move, then turn it square (2026-10-01, the owner's) ──
check('the picture on the canvas → "zoom in on the roof"', await waitKey(pg, 'c-zoom', 5000), await key(pg));
const rings = () => pg.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); return e && e.style.display === 'block' ? e.getBoundingClientRect() : null; };
  const inside = (ring, id) => { const t = document.getElementById(id).getBoundingClientRect(); return !!ring && ring.left <= t.left && ring.right >= t.right && ring.top <= t.top && ring.bottom >= t.bottom; };
  const a = r('tourRing'), b = r('tourRing2');
  return { a: !!a, b: !!b, sel: TOUR.steps[TOUR.i].sel, canvasLit: inside(b, 'roofCanvas'), tool: DRAW.tool };
});
v = await card(pg); p = await rings();
check('…lighting the Zoom buttons AND the canvas, saying zoom with the buttons and drag the picture with the mouse',
  p.sel === '#roofZoomStepper' && p.a && p.b && p.canvasLit && /Zoom \+ \/ −/.test(v.body) && /drag the picture with the mouse/.test(v.body) && p.tool === 'select', JSON.stringify(p) + ' ' + v.body);
check('…and waiting: the button offers "It’s already right" until they zoom or drag', /already right/.test(v.next), v.next);
await pg.evaluate(() => adjustZoom(0.1)); await sleep(700);
v = await card(pg);
check('zooming turns it into Next — it does not jump on while they are still placing it', await key(pg) === 'c-zoom' && v.next === 'Next', v.next);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('→ "turn it square"', await waitKey(pg, 'c-rotate', 3000), await key(pg));
v = await card(pg); p = await rings();
check('…lighting the Rotate bar AND the canvas, saying snap points work best with the picture square to the canvas',
  p.sel === '#rotImgWrap' && p.a && p.b && p.canvasLit && /Rotate background image/.test(v.body) && /snap points work best when the picture is square to the canvas/.test(v.body), JSON.stringify(p) + ' ' + v.body);
check('…waiting for them the same way', /already square/.test(v.next), v.next);
await pg.evaluate(() => _setFineRotate(2.5)); await sleep(700);
check('turning it makes the button Next', (await card(pg)).next === 'Next' && await key(pg) === 'c-rotate');
await pg.evaluate(() => document.getElementById('tourNext').click());
check('→ "click Building outline"', await waitKey(pg, 'c-outline', 3000), await key(pg));
check('…with the second ring gone', !(await rings()).b);
v = await card(pg);
check('…explaining to click the corners of the roof', /Building outline/.test(v.body) && /corner of the roof/.test(v.body), v.body);
await pg.click('#btn-outline');
check('clicking it → the coach goes quiet', await waitKey(pg, 'c-enter'), await key(pg));
await sleep(500);
check('…nothing on screen while they start', !(await card(pg)).shown);
await pg.evaluate(() => { DRAW.currentPts = [[120,120],[520,120],[520,420]]; });
await sleep(3000);
check('…still nothing with three corners down, however long they pause', !(await card(pg)).shown);
await pg.evaluate(() => { DRAW.currentPts = [[120,120],[520,120],[520,420],[120,420]]; });
await sleep(900);
check('…nor straight after the fourth — they may be mid-way round', !(await card(pg)).shown);
await sleep(2400);
v = await card(pg);
check('once they stop clicking it looks finished: "press Enter to finish the outline"',
  v.shown && /Press Enter/.test(v.body) && /finish the outline/.test(v.body), JSON.stringify(v));
await pg.evaluate(() => { DRAW.currentPts = DRAW.currentPts.concat([[300,500]]); });
await sleep(600);
check('…another corner and it goes quiet again', !(await card(pg)).shown);
await sleep(2600);
check('…and says it again when they pause', (await card(pg)).shown);
await pg.evaluate(() => { DRAW.currentPts = [[120,120],[520,120],[520,420],[120,420]]; });
await pg.keyboard.press('Enter');
await sleep(900);
p = await pg.evaluate(() => ({ modal: !!document.getElementById('_rsModal'), done: DRAW.outlineDone }));
check('Enter → the roof-type window, and the coach says nothing over it',
  await key(pg) === 'c-rooftype' && p.modal && !(await card(pg)).shown, JSON.stringify(p) + ' ' + await key(pg));
await pg.evaluate(() => { const h = document.querySelector('#_rsTypes [data-rstype="hip"]'); if (h) h.click(); document.getElementById('_rsPitch').value = '15'; document.getElementById('_rsOk').click(); });

// ── after the roof is drawn ───────────────────────────────────────
check('Draw this roof → the real-measurement tip', await waitKey(pg, 'c-measure', 6000), await key(pg));
v = await card(pg);
check('…"if you want", click a line’s measurement and type its real-life length',
  /If you want/.test(v.body) && /measurement/.test(v.body) && /real-life length/.test(v.body) && v.shown, v.body);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('→ the Job Pack', await waitKey(pg, 'c-jobpack'), await key(pg));
v = await card(pg);
p = await pg.evaluate(() => ({ sel: TOUR.steps[TOUR.i].sel, tab: document.body.getAttribute('data-tab') }));
check('…pointing at the Job Pack button: material orders, straight to their chosen supplier',
  p.sel === '#navJobPackBtn' && /material orders/.test(v.body) && /chosen supplier/.test(v.body) && v.ring === 'block' && p.tab === 'roof', JSON.stringify(p));
await pg.evaluate(() => document.getElementById('tourNext').click());
check('→ the Quote', await waitKey(pg, 'c-quote'), await key(pg));
v = await card(pg);
check('…a live, interactive quote sent straight to the customer',
  /live, interactive/.test(v.body) && /straight to the customer/.test(v.body) && await pg.evaluate(() => TOUR.steps[TOUR.i].sel === '#navQuoteBtn'), v.body);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('→ the last card', await waitKey(pg, 'c-done'), await key(pg));
v = await card(pg);
check('…the guides in Settings, support@roofmap.co.nz, and the Help bubble',
  /Settings → Guides/.test(v.body) && /support@roofmap\.co\.nz/.test(v.body) && /Help/.test(v.body) && v.buttons.length === 3 && /Don’t show this again/.test(v.buttons[2]), JSON.stringify(v));
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
await sleep(300);
p = await pg.evaluate(() => ({ tour: !!document.getElementById('tourWrap'), st: localStorage.getItem('fr_first_roof') }));
check('Finish closes it (done — which does not stop it next sign-in)', !p.tour && p.st === 'done' && puts.some(x => x.first_roof === 'done'), JSON.stringify(p));
const shown = usage.filter(u => u.name === 'walkthrough' && u.props.action === 'shown').map(u => u.props.step);
check('every step is reported as it shows',
  ['c-welcome','c-picture','c-zoom','c-rotate','c-outline','c-enter','c-measure','c-jobpack','c-quote','c-done'].every(k => shown.includes(k)), shown.join());
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 200));
await ctx.close();

// ── EVERY SIGN-IN until "Don't show this again" (2026-10-01) ─────
// sales@ had answered it once and never saw it again. Now: "Not now" and
// Finish close it for this sign-in only; a reload in the same tab does not
// bring it back; a new sign-in does; "Don't show this again" is for good.
({ ctx, pg, errs, puts } = await boot({}));
await waitKey(pg, 'c-welcome', 9000);
v = await card(pg);
check('the welcome offers Show me how, Not now, and Don’t show this again (and a tick on every card)',
  v.buttons.join('|') === 'Show me how|Not now|Don’t show this again' && await pg.evaluate(() => !!document.getElementById('tourDontShow') && !document.getElementById('tourDontShow').checked), v.buttons.join('|'));
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[1].click());
await sleep(300);
p = await pg.evaluate(() => ({ tour: !!document.getElementById('tourWrap'), st: localStorage.getItem('fr_first_roof') }));
check('"Not now" closes it, without "never"', !p.tour && p.st !== 'never' && !puts.some(x => x.first_roof === 'never'), JSON.stringify(p));
await pg.reload(); await sleep(4500);
check('…a reload in the same sign-in does not bring it back', !(await pg.evaluate(() => !!document.getElementById('tourWrap'))));
await pg.evaluate(() => sessionStorage.clear()); await pg.reload();
check('…the next sign-in does, whatever the account answered before', await waitKey(pg, 'c-welcome', 9000), await key(pg));
await pg.evaluate(() => document.querySelectorAll('#tourExtra button')[2].click());
await sleep(300);
p = await pg.evaluate(() => ({ tour: !!document.getElementById('tourWrap'), st: localStorage.getItem('fr_first_roof') }));
check('"Don’t show this again" closes it for good, on the account', !p.tour && p.st === 'never' && puts.some(x => x.first_roof === 'never'), JSON.stringify(p));
await ctx.close();
({ ctx, pg, errs } = await boot({ flags: { first_roof: 'never' } }));
await sleep(4500);
check('…so an account that said never sees nothing at sign-in', !(await pg.evaluate(() => !!document.getElementById('tourWrap'))));
v = await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-guides'); const b = document.querySelector('[data-tour="set-coach"]'); return b ? b.textContent : ''; });
check('Settings → Guides has "RoofMap tutorial in 60sec"', /RoofMap tutorial in 60sec/.test(v), v);
await pg.evaluate(() => document.querySelector('[data-tour="set-coach"]').click());
check('…which runs it on demand', await waitKey(pg, 'c-welcome', 5000), await key(pg));
await ctx.close();
({ ctx, pg, errs, puts } = await boot({ flags: { first_roof: 'has-work' } }));
check('an account with work of its own and no "never" is welcomed too', await waitKey(pg, 'c-welcome', 9000), await key(pg));
await pg.evaluate(() => { document.getElementById('tourDontShow').checked = true; document.querySelector('#tourExtra button').click(); });
await waitKey(pg, 'c-picture', 3000);
await pg.evaluate(() => document.getElementById('tourCancel').click());
await sleep(300);
check('…and the tick on any card is "never" too', puts.some(x => x.first_roof === 'never'), JSON.stringify(puts));
await ctx.close();

// ── a picture already there: the picture step passes by itself ────
({ ctx, pg, errs } = await boot({}));
await waitKey(pg, 'c-welcome', 9000);
await putPicture(pg, 600, 400);
await pg.evaluate(() => document.querySelector('#tourExtra button').click());
check('with a picture already on the canvas it goes straight to zooming it', await waitKey(pg, 'c-zoom', 5000), await key(pg));
await pg.evaluate(() => document.getElementById('tourNext').click());
await waitKey(pg, 'c-rotate', 3000);
await pg.evaluate(() => document.getElementById('tourNext').click());
check('…and "already right" / "already square" step on to the outline', await waitKey(pg, 'c-outline', 3000), await key(pg));
await ctx.close();

// ── another account's answer on this browser ──────────────────────
({ ctx, pg, errs } = await boot({ flags: { first_roof: 'has-work' } }));
await sleep(3500);
p = await pg.evaluate(() => {
  localStorage.setItem('fr_first_roof', 'done'); localStorage.setItem('fr_first_roof_at', '{}'); localStorage.setItem('fr_tour_done', '1');
  window._frWipeBusinessLocal();
  return ['fr_first_roof', 'fr_first_roof_at', 'fr_tour_done'].map(k => localStorage.getItem(k));
});
check('signing in or out clears the last account’s walkthrough answers from this browser', p.every(x => x === null), JSON.stringify(p));
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
