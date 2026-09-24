// The owner, 2026-09-23 (a batch in one message):
//  · "I just opened a new untouched job and it has the pdf plan in the
//    'upload roof picture' section from the last job I had open"
//  · "put the photos tab from the jobpack tab on the quote tab too"
//  · the photo lists: the zoom bar "zooms up towards the photos at the top of
//    the list which jumps me off the photo I was trying to zoom on … hold
//    control … scroll the mouse wheel to zoom … remove the scrolling up/down
//    (2026-09-24: "bring back the scrolling … make so the scroll down/up
//    jumps to the next photo" — the plain wheel turns one photo per notch)
//    … an up & down button to cycle the photos, also allow keyboard up and
//    down … a smooth slide transition … lock the photo size … so the photo
//    slots stay the same size … I can see some of the photo above and below"
//  · "Add in the home page a 'Job to price' section which (if connected with
//    Fergus) shows a list of the jobs needing to be priced"
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1600, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const fergusAsks = [];
const TO_PRICE = [
  { id: 9101, jobNo: '3251', jobNumber: '3251', description: '221A Huaroa Road - Matt Cooper', lastModified: '2026-09-23T01:00:00Z', jobType: 'Quote', status: 'To Price',
    customer: { customerFullName: 'Matt Cooper' }, siteAddress: { address1: '221A Huaroa Road', addressCity: 'Russell', addressPostcode: '0272' }, activeQuote: null, archived: false },
  { id: 9102, jobNo: '3256', jobNumber: '3256', description: '4 Ngawha School Road - Ngaire', lastModified: '2026-09-22T22:00:00Z', jobType: 'Quote', status: 'To Price',
    customer: { customerFullName: 'Ngaire' }, siteAddress: { address1: '4 Ngawha School Road', addressCity: 'Kaikohe', addressPostcode: '0472' }, activeQuote: { id: 5, isSent: true, isAccepted: false }, archived: false },
];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/fergus\/jobs\?/.test(u)){ fergusAsks.push(decodeURIComponent(u.split('/fergus')[1])); return j({ result: 'success', data: /filterJobStatus=To(\+|%20| )Price/.test(u) ? TO_PRICE : [], paging: {} }); }
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_jms_linked', '1');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });

// ── the last job's roof picture never shows on a new one ──
const PLAN = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/><path d="M20 20h360v260H20z" stroke="#000" fill="none"/></svg>');
const leak = await pg.evaluate(async (plan) => {
  gotoTab('roof');
  const img = document.getElementById('roofPrevImg'); img.src = plan;
  document.getElementById('roofPrev').style.display = 'block'; document.getElementById('roofUZ').style.display = 'none';
  const before = document.getElementById('roofPrev').style.display;
  startNewJob(); await new Promise(r => setTimeout(r, 600));
  const a = { shown: getComputedStyle(document.getElementById('roofPrev')).display !== 'none', src: document.getElementById('roofPrevImg').getAttribute('src'),
              zone: getComputedStyle(document.getElementById('roofUZ')).display !== 'none' };
  // …and a job whose saved record has no state at all
  img.src = plan; document.getElementById('roofPrev').style.display = 'block';
  restoreFromJob({ id: 'x1', draw_state: { form: { jobClient: 'Somebody' } } });
  const c = { shown: getComputedStyle(document.getElementById('roofPrev')).display !== 'none', src: document.getElementById('roofPrevImg').getAttribute('src') };
  return { before, a, c };
}, PLAN);
check('a new job starts with an empty Upload roof picture card — not the last job’s PDF plan', leak.before === 'block' && !leak.a.shown && !leak.a.src && leak.a.zone, JSON.stringify(leak.a));
check('…and so does opening a job saved with no picture state', !leak.c.shown && !leak.c.src, JSON.stringify(leak.c));

// ── the photos pop-out is on the Quote tab too, under PRICING ──
const qt = await pg.evaluate(async () => {
  gotoTab('quote'); await new Promise(r => setTimeout(r, 600));
  const fp = document.getElementById('fergusRoofPanel');
  const out = { shown: getComputedStyle(fp).display !== 'none', second: fp.classList.contains('jp-second'), open: fp.classList.contains('is-open') };
  try { _openPricingPanel(); } catch(e){}
  await new Promise(r => setTimeout(r, 300));
  _fergusPanelOpen(); await new Promise(r => setTimeout(r, 500));
  out.photosOpen = fp.classList.contains('is-open');
  out.pricingClosed = !document.getElementById('quotePricingPanel').classList.contains('is-open');
  _fergusPanelClose();
  return out;
});
check('the Quote tab carries the PHOTOS tab, as a second tab under PRICING, closed until pressed', qt.shown && qt.second && !qt.open, JSON.stringify(qt));
check('…and opening it puts the Pricing drawer away — one out at a time', qt.photosOpen && qt.pricingClosed, JSON.stringify(qt));
const tabs = await pg.evaluate(async () => {
  gotoTab('quote'); await new Promise(r => setTimeout(r, 500));
  const a = document.getElementById('quotePricingPanelToggle').getBoundingClientRect(), b = document.getElementById('fergusRoofPanelToggle').getBoundingClientRect();
  return { pricing: [Math.round(a.top), Math.round(a.bottom)], photos: [Math.round(b.top), Math.round(b.bottom)], gap: Math.round(b.top - a.bottom) };
});
check('on the Quote tab PHOTOS sits under PRICING, the two tabs apart like MAPS and PHOTOS on the Job Pack', tabs.gap >= 8 && tabs.gap <= 20, JSON.stringify(tabs));

// ── the photo list is a viewer ──
const shade = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="' + c + '"/></svg>');
const view = await pg.evaluate(async (pics) => {
  gotoTab('roof'); _fergusPanelOpen(true);
  S.photos = pics.map(src => ({ src, caption: '' }));
  renderPhotos(); await new Promise(r => setTimeout(r, 500));
  _pvLayout('job'); await new Promise(r => setTimeout(r, 200));
  const box = document.getElementById('jobPhotosScroll');
  const slots = [...document.querySelectorAll('#jobPhotosGrid > .pv-slot')];
  const hs = slots.map(s => Math.round(s.getBoundingClientRect().height));
  const bh = box.clientHeight;
  const posText = () => (document.getElementById('pvPos_job') || {}).textContent;
  const out = { n: slots.length, heights: [...new Set(hs)], boxH: bh, pos0: posText() };
  // ▼ twice, then read where the list sits
  _pvStep('job', 1); _pvStep('job', 1); await new Promise(r => setTimeout(r, 900));
  const cur = document.querySelector('#jobPhotosGrid > .pv-slot.pv-cur');
  const br = box.getBoundingClientRect(), cr = cur.getBoundingClientRect();
  out.cur = +cur.dataset.pvI; out.pos2 = posText();
  out.centred = Math.abs((cr.top + cr.bottom) / 2 - (br.top + br.bottom) / 2) < 12;
  out.peek = cr.top > br.top + 10 && cr.bottom < br.bottom - 10;
  // the zoom bar: slots keep their size and the list does not move
  const st0 = box.scrollTop;
  const z = document.getElementById('jobPhotosZoom'); z.value = 250; z.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 300));
  out.zoomSlots = [...new Set(slots.map(s => Math.round(s.getBoundingClientRect().height)))];
  out.zoomScroll = box.scrollTop - st0;
  out.imgScale = getComputedStyle(cur.querySelector('img')).transform;
  // a plain wheel turns one photo per notch — a second notch straight after
  // is swallowed so a flick never skips photos — and back up again
  const wd = (dy) => { const e = new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }); cur.dispatchEvent(e); return e.defaultPrevented; };
  wd(100); wd(100);
  await new Promise(r => setTimeout(r, 450));
  out.wheelDown = _PV.job.i; out.wheelPos = posText();
  wd(-100);
  await new Promise(r => setTimeout(r, 900));
  out.wheelUp = _PV.job.i;
  out.wheelCentred = (() => { const c = document.querySelector('#jobPhotosGrid > .pv-slot.pv-cur').getBoundingClientRect(); return Math.abs((c.top + c.bottom) / 2 - (br.top + br.bottom) / 2) < 12; })();
  // at the first photo the wheel up is left for the page
  _pvGo('job', 0, false); out.edgeLetThrough = !wd(-100); _pvGo('job', 2, false);
  await new Promise(r => setTimeout(r, 450));
  const z0 = +z.value;
  cur.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: cr.left + 20, clientY: cr.top + 20 }));
  await new Promise(r => setTimeout(r, 200));
  out.ctrlZoom = +z.value - z0;
  // keys, only while the pointer is over the panel
  document.getElementById('fergusRoofPanel').dispatchEvent(new PointerEvent('pointerenter'));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 100));
  out.afterUp = _PV.job.i;
  document.getElementById('fergusRoofPanel').dispatchEvent(new PointerEvent('pointerleave'));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 100));
  out.awayDown = _PV.job.i;
  return out;
}, ['#8b0000', '#006400', '#00008b', '#8b8b00', '#4b0082']);
check('every photo sits in a slot of one fixed size, three-quarters of the list', view.n === 5 && view.heights.length === 1 && Math.abs(view.heights[0] - view.boxH * 0.74) < 4, JSON.stringify(view.heights) + ' of ' + view.boxH);
check('▼ slides to the next photo, centred, with the ones above and below peeking in', view.cur === 2 && view.centred && view.peek && view.pos0 === '1 / 5' && view.pos2 === '3 / 5', JSON.stringify(view));
check('the zoom bar zooms INSIDE the slots: no slot changes size and the list does not move off the photo', view.zoomSlots.length === 1 && view.zoomSlots[0] === view.heights[0] && Math.abs(view.zoomScroll) < 2 && /matrix\(2\.5/.test(view.imgScale), JSON.stringify({ s: view.zoomSlots, d: view.zoomScroll, t: view.imgScale }));
check('the mouse wheel turns one photo per notch, down then up, and lands it centred', view.wheelDown === 3 && view.wheelPos === '4 / 5' && view.wheelUp === 2 && view.wheelCentred, JSON.stringify({ d: view.wheelDown, p: view.wheelPos, u: view.wheelUp, c: view.wheelCentred }));
check('…and above the first photo the wheel is left to scroll the page', view.edgeLetThrough);
check('Ctrl + wheel over a photo zooms in', view.ctrlZoom > 0, String(view.ctrlZoom));
check('↑ moves to the previous photo while the pointer is over the panel — and the arrows are left alone once it leaves', view.afterUp === 1 && view.awayDown === 1, JSON.stringify({ up: view.afterUp, away: view.awayDown }));

// ── Home: Jobs to price, from Fergus ──
const tp = await pg.evaluate(async () => {
  try { _refreshJmsLinkUI(); } catch(e){}
  document.documentElement.classList.remove('no-jms');
  gotoTab('select'); await new Promise(r => setTimeout(r, 900));
  const tiles = [...document.querySelectorAll('#homeBoardTiles .hb-tile')].map(t => t.textContent.replace(/\s+/g, ' ').trim());
  _hbSelect('toprice'); await new Promise(r => setTimeout(r, 100));
  const title = document.getElementById('homeBoardListTitle').textContent;
  const rows = [...document.querySelectorAll('#homeBoard tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
  let opened = null;
  const real = window.useFergusJobInModal; window.useFergusJobInModal = function(id){ opened = { id: String(id), cached: (S.fergJobsCache || []).some(x => String(x.id) === String(id)) }; };
  document.querySelector('#homeBoard tbody tr').click();
  window.useFergusJobInModal = real;
  const t0 = document.querySelector('#homeBoardTiles .hb-tile');
  const lbl = t0 ? t0.querySelector('.hb-tile-lbl').textContent : '', num = t0 ? t0.querySelector('.hb-tile-num').textContent : '';
  const tops = [...document.querySelectorAll('#homeBoardTiles .hb-tile')].map(t => Math.round(t.getBoundingClientRect().top));
  const hts = [...document.querySelectorAll('#homeBoardTiles .hb-tile')].map(t => Math.round(t.getBoundingClientRect().height));
  return { shown: lbl === 'Jobs to Price' && num === '2', tiles, title, count: num, rows, opened, oldCard: !!document.getElementById('hbToPrice'),
           rowsOfTiles: new Set(tops).size, nTiles: tops.length, maxH: Math.max(...hts) };
});
check('every Status board tile sits on ONE row, and they are thin (2026-09-24)', tp.nTiles >= 8 && tp.rowsOfTiles === 1 && tp.maxH <= 110, JSON.stringify({ n: tp.nTiles, rows: tp.rowsOfTiles, h: tp.maxH }));
check('Jobs to Price is the first Status board tile, with its count, asked of Fergus as its "To Price" jobs (2026-09-24: a tile like the others, not a card of its own)',
  tp.shown && !tp.oldCard && tp.title === 'Jobs to Price' && fergusAsks.some(a => /filterJobStatus=To Price/.test(a)), JSON.stringify({ tiles: tp.tiles.slice(0, 3), title: tp.title }));
check('…one row a job: number, customer, area, description, last modified and the quote’s state',
  tp.rows.length === 2 && /#3251/.test(tp.rows[0][0]) && tp.rows[0][1] === 'Matt Cooper' && tp.rows[0][2] === 'Russell 0272' && /Huaroa/.test(tp.rows[0][3]) && tp.rows[0][4] === '23/9/2026' && tp.rows[0][5] === '—' && tp.rows[1][5] === 'Sent' && tp.count === '2',
  JSON.stringify(tp.rows));
check('…and a click opens that job, the same way the Fergus search does', tp.opened && tp.opened.id === '9101' && tp.opened.cached, JSON.stringify(tp.opened));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
