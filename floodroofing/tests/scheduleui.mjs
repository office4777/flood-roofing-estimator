// The schedule board's UI: the Excel Schedule sheet's mechanics, driven
// with a real mouse. Painting respects the working-day calendar, a
// pencil block solid-books with one crew click, blocks drag, over-
// capacity days warn, the customer email goes through a review modal,
// and a plan without the feature sees the Business teaser — not a
// broken board.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();

function mkSched(){
  const s = {
    cfg: { crews: [{ id:'troy', name:'Troy', colour:'#4472c4' }, { id:'nick', name:'Nick', colour:'#f87d20' }],
           cap: 1, shutdowns: [], region: 'auckland' },
    rows: [
      { id:'r1', job_id:'j1', client_name:'Brian Lewis', site_address:'148 Horeke Road, Okaihau', email:'b@l.nz',
        length_days:8, notes:'', progress_pct:80, deposit_paid:true, ordered:true, delivery_check:false,
        handover_done:false, last_notified:null, job_no:'FR-2996',
        archived:false, created_at:'2026-08-01', accepted_at:'2026-07-20T09:00:00Z', auto:{} },
      { id:'r2', job_id:null, client_name:'Modspace', site_address:'Whetu Rau', email:'', length_days:4,
        notes:'', progress_pct:null, deposit_paid:false, ordered:false, delivery_check:false,
        handover_done:false, last_notified:null, job_no:'',
        archived:false, created_at:'2026-08-10', accepted_at:null, auto:{} },
    ],
    // Both blocks on r1, over the same days, with cap 1 → those days must
    // warn — and r2 stays empty so a first paint lays down the full length.
    blocks: [
      { id:'b1', row_id:'r1', kind:'pencil', crew_id:'', start_date:'2026-09-04', work_days:8 },
      { id:'b2', row_id:'r1', kind:'crew', crew_id:'nick', start_date:'2026-09-07', work_days:3 },
    ],
    nonwork: [], range: { from:'2026-08-27', to:'2026-11-30', today:'2026-08-29' },
    feed_url: 'https://x/schedule/feed.ics?c=co&sig=abc',
  };
  for (let d = new Date('2026-08-27'); d <= new Date('2026-11-30'); d = new Date(d.getTime() + 86400000)){
    const dow = d.getUTCDay(); if (dow === 0 || dow === 6) s.nonwork.push(d.toISOString().slice(0, 10));
  }
  return s;
}

async function boot(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  const calls = [];
  const sched = mkSched();
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    if (/\/schedule(\?|$)/.test(u) && m === 'GET'){ calls.push(['GET /schedule']);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sched) }); }
    if (/\/schedule\/rows$/.test(u) && m === 'POST'){ const body = JSON.parse(r.request().postData() || '{}');
      calls.push(['POST rows', body]);
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(Object.assign({ id: 'nr' + calls.length, archived: false, auto: {} }, body)) }); }
    if (/\/schedule\/blocks$/.test(u) && m === 'POST'){ const body = JSON.parse(r.request().postData() || '{}');
      calls.push(['POST blocks', body]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ id: 'nb' + calls.length }, body)) }); }
    if (/\/schedule\/blocks\//.test(u) && m === 'PATCH'){ calls.push(['PATCH ' + u.split('/').pop(), JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/\/schedule\/rows\/[^/]+$/.test(u) && m === 'PATCH'){ calls.push(['PATCH row', JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/\/schedule\/rows\/[^/]+\/compose$/.test(u)){ calls.push(['compose', JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ to: 'b@l.nz', subject: 'Your roofing job — expected timing', body: 'Hi Brian, late October it is.' }) }); }
    if (/\/schedule\/rows\/[^/]+\/send$/.test(u)){ calls.push(['send', JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (/\/schedule\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/fergus/i.test(u)) return r.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
    localStorage.setItem('fr_settings', 'null');
    if (o.lockedPlan) localStorage.setItem('fr_company',
      JSON.stringify({ id: 'co', role: 'owner', plan: 'team', limits: { schedule: false } }));
    else localStorage.removeItem('fr_company');
  }, opts);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2600);
  await pg.evaluate(() => gotoTab('schedule'));
  await pg.waitForTimeout(800);
  return { ctx, pg, calls };
}

// ── the board, unlocked ───────────────────────────────────────────
let { ctx, pg, calls } = await boot();
let v = await pg.evaluate(() => ({
  wrap: getComputedStyle(document.getElementById('schedWrap')).display !== 'none',
  rows: document.querySelectorAll('.sched-row:not(.pad)').length,
  blocks: document.querySelectorAll('.sched-block').length,
  chips: document.querySelectorAll('#schedPalette .sched-chip').length,
  weekendShades: document.querySelectorAll('.sched-shade:not(.cap):not(.today)').length,
  capShades: document.querySelectorAll('.sched-shade.cap').length,
}));
check('the board renders rows, blocks, palette and weekend shading',
  v.wrap && v.rows === 2 && v.blocks === 2 && v.chips === 3 && v.weekendShades > 20, JSON.stringify(v));
check('days holding more jobs than the cap wear the warning tint', v.capShades >= 2, v.capShades + ' warned days');

// The Excel-sheet look: the board pads out to 20 lines of blank rows, the
// calendar shading runs the full grid, and blank strips are unpaintable.
v = await pg.evaluate(() => ({
  all: document.querySelectorAll('.sched-row').length,
  padPaintable: document.querySelectorAll('.sched-row.pad [data-strip]').length,
  overlayH: document.querySelector('.sched-shade').parentElement.offsetHeight,
}));
check('the board pads out to 20 rows like the printed sheet', v.all === 20, v.all + ' rows');
check('…whose blank strips are unpaintable until the row exists', v.padPaintable === 0, v.padPaintable + ' paintable');
check('…and the calendar shading covers the full 20-row grid', v.overlayH >= 20 * 31, v.overlayH + 'px');

// An 8-working-day pencil starting Friday must SPAN its weekends: Sep 4 → Sep 15 = 12 calendar days.
v = await pg.evaluate(() => {
  const el = document.querySelector('[data-block="b1"]');
  return { w: el.getBoundingClientRect().width };
});
check('an 8-day block starting Friday spans 12 calendar days of grid',
  Math.abs(v.w - (12 * 24 - 2)) < 2, v.w + 'px');

// Paint: pick Troy, click a working Monday on the Modspace row.
await pg.evaluate(() => document.querySelector('[data-pal="troy"]').click());
let box = await pg.locator('[data-strip="r2"]').boundingBox();
await pg.mouse.click(box.x + 4 * 24 + 12, box.y + 15);   // idx 4 = Mon 31 Aug
await pg.waitForTimeout(400);
let paint = calls.find(c => c[0] === 'POST blocks');
check('clicking a day paints the job\'s full length as one crew block',
  !!paint && paint[1].kind === 'crew' && paint[1].crew_id === 'troy' &&
  paint[1].start_date === '2026-08-31' && paint[1].work_days === 4, JSON.stringify(paint && paint[1]));

// Weekend clicks snap forward to Monday.
await pg.mouse.click(box.x + 12 * 24 + 12, box.y + 15);  // idx 12 = Tue 8 Sep? no — from 27 Aug, idx 12 = Sat 8? compute: 27+12=8 Sep TUE. use idx 10 = Sun 6 Sep
await pg.waitForTimeout(300);
calls.length = 0;
await pg.mouse.click(box.x + 10 * 24 + 12, box.y + 15);  // Sun 6 Sep → snaps to Mon 7
await pg.waitForTimeout(400);
paint = calls.find(c => c[0] === 'POST blocks');
check('a weekend click snaps the block to the next working day',
  !!paint && paint[1].start_date === '2026-09-07', JSON.stringify(paint && paint[1]));

// Solid-book: click the pencil block with Troy selected.
calls.length = 0;
box = await pg.locator('[data-strip="r1"]').boundingBox();
await pg.mouse.click(box.x + 8 * 24 + 12, box.y + 15);   // pencil b1 covers Sep 4 (idx 8)
await pg.waitForTimeout(400);
let rep = calls.find(c => /^PATCH b1/.test(c[0]));
check('clicking a pencil block with a crew selected solid-books it',
  !!rep && rep[1].kind === 'crew' && rep[1].crew_id === 'troy', JSON.stringify(rep && rep[1]));

// Compose + send goes through the review modal.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-mail="r1"]').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedMailModal')).display !== 'none',
  to: document.getElementById('schedMailTo').value,
  body: document.getElementById('schedMailBody').value,
}));
check('the email opens prefilled for review — never auto-sent',
  v.shown && v.to === 'b@l.nz' && /late October/.test(v.body), JSON.stringify(v).slice(0, 100));
await pg.evaluate(() => _schedMailSend());
await pg.waitForTimeout(400);
const sent = calls.find(c => c[0] === 'send');
check('…and Send posts exactly what the office approved',
  !!sent && sent[1].to === 'b@l.nz' && /late October/.test(sent[1].body), JSON.stringify(sent && sent[1]).slice(0, 90));

// Typing a client name into a blank row creates the row inline — exactly
// how the office types into the spreadsheet today.
calls.length = 0;
await pg.fill('[data-newclient="0"]', 'Lizzie Campbell');
await pg.keyboard.press('Tab');
await pg.waitForTimeout(500);
const made = calls.find(c => c[0] === 'POST rows');
check('typing a client name into a blank row creates the row inline',
  !!made && made[1].client_name === 'Lizzie Campbell', JSON.stringify(made && made[1]));
v = await pg.evaluate(() => ({
  all: document.querySelectorAll('.sched-row').length,
  real: document.querySelectorAll('.sched-row:not(.pad)').length,
  named: /Lizzie Campbell/.test(document.getElementById('schedGrid').textContent),
}));
check('…and the new row takes a blank line — the board stays 20 deep',
  v.all === 20 && v.real === 3 && v.named, JSON.stringify(v));

// The « toggle folds the job columns down to the client column, handing
// the width to the calendar — and remembers the choice.
await pg.evaluate(() => document.querySelector('[data-coltoggle]').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  hd: document.querySelectorAll('.sched-hd-row:not(.months) .sched-cell.hd').length,
  strips: document.querySelectorAll('[data-strip]').length,
  stored: localStorage.getItem('fr_sched_compact'),
  job: /FR-2996/.test(document.getElementById('schedGrid').textContent) &&
       /148 Horeke Road/.test(document.getElementById('schedGrid').textContent) &&
       !/Okaihau/.test(document.getElementById('schedGrid').textContent),
  info: !!document.querySelector('[data-info="r1"]'),
}));
check('the « toggle collapses the info panel to job number + short address + ⓘ',
  v.hd === 3 && v.strips >= 3 && v.job && v.info && v.stored === '1', JSON.stringify(v));

// The ⓘ opens the details popup: full address, title, and the sheet's
// admin columns — ticking Handover done saves it.
await pg.evaluate(() => document.querySelector('[data-info="r1"]').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedInfoModal')).display !== 'none',
  title: document.getElementById('schedInfoTitle').textContent,
  no: document.getElementById('schedInfoNo').textContent,
  site: document.querySelector('#schedInfoModal [data-iedit="site_address"]').value,
  dep: document.querySelector('#schedInfoModal [data-iedit="deposit_paid"]').checked,
}));
check('ⓘ opens the job-details popup with the full address and title',
  v.shown && v.title === 'Brian Lewis' && /FR-2996/.test(v.no) &&
  v.site === '148 Horeke Road, Okaihau' && v.dep === true, JSON.stringify(v));
calls.length = 0;
await pg.evaluate(() => {
  const cb = document.querySelector('#schedInfoModal [data-iedit="handover_done"]');
  cb.checked = true; cb.dispatchEvent(new Event('change'));
});
await pg.waitForTimeout(300);
let ho = calls.find(c => c[0] === 'PATCH row');
check('ticking Handover done saves it to the row',
  !!ho && ho[1].handover_done === true, JSON.stringify(ho && ho[1]));
await pg.evaluate(() => _schedInfoClose());
await pg.evaluate(() => document.querySelector('[data-coltoggle]').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => document.querySelectorAll('.sched-hd-row:not(.months) .sched-cell.hd').length);
check('…and » brings all eleven columns back', v === 11, v + ' header cells');

// Extended view overlays the whole viewport — side menu and all.
await pg.evaluate(() => _schedExtToggle());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => {
  const t = document.getElementById('tab-schedule'), r = t.getBoundingClientRect();
  return { fixed: getComputedStyle(t).position === 'fixed', left: r.left,
    full: Math.abs(r.width - window.innerWidth) < 2,
    label: document.getElementById('schedExtBtn').textContent };
});
check('Extended view pins the board over the full screen width',
  v.fixed && v.left === 0 && v.full && /Exit/.test(v.label), JSON.stringify(v));
await pg.evaluate(() => { gotoTab('home'); });
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.body.classList.contains('sched-extended'));
check('…and leaving the tab drops back to the normal layout', v === false);
await ctx.close();

// ── locked plan ───────────────────────────────────────────────────
({ ctx, pg, calls } = await boot({ lockedPlan: true }));
v = await pg.evaluate(() => ({
  teaser: getComputedStyle(document.getElementById('schedLockedCard')).display !== 'none',
  wrap: getComputedStyle(document.getElementById('schedWrap')).display === 'none',
  text: document.getElementById('schedLockedCard').textContent,
}));
check('a plan without the board sees the Business teaser', v.teaser && v.wrap && /Business/.test(v.text),
  JSON.stringify({ teaser: v.teaser, wrap: v.wrap }));
check('…and never even asks the server for the board',
  !calls.some(c => c[0] === 'GET /schedule'), JSON.stringify(calls));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
