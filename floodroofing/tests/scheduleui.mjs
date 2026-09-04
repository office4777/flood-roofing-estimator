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
        handover_done:false, last_notified:null, job_no:'FR-2996', fergus_no:'8801', fergus_id:'15576244',
        // Asked the supplier for the 18th; they have not come back yet.
        requested_delivery:'2026-09-18', confirmed_delivery:null,
        archived:false, created_at:'2026-08-01', accepted_at:'2026-08-27T09:00:00Z', auto:{} },
      { id:'r2', job_id:null, client_name:'Modspace', site_address:'Whetu Rau', email:'', length_days:4,
        notes:'', progress_pct:null, deposit_paid:false, ordered:false, delivery_check:false,
        handover_done:false, last_notified:null, job_no:'',
        // Asked for the 25th and the supplier confirmed it.
        requested_delivery:'2026-09-25', confirmed_delivery:'2026-09-25',
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
      // A slow server, like a phone on 4G — the paint must not wait for this.
      return new Promise(res => setTimeout(res, 600)).then(() =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ id: 'nb' + calls.length }, body)) })); }
    if (/\/schedule\/config$/.test(u) && m === 'PUT'){ calls.push(['PUT config', JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (/\/schedule\/blocks\//.test(u) && m === 'PATCH'){ calls.push(['PATCH ' + u.split('/').pop(), JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/\/schedule\/rows\/[^/]+$/.test(u) && m === 'PATCH'){ calls.push(['PATCH row', JSON.parse(r.request().postData() || '{}')]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/\/schedule\/rows\/[^/]+\/compose$/.test(u)){ calls.push(['compose', JSON.parse(r.request().postData() || '{}')]);
      // Slow, like the real server — the box must open before this answers.
      return new Promise(res => setTimeout(res, 500)).then(() => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ to: 'b@l.nz', subject: 'Your roofing job — expected timing', body: 'Hi Brian, late October it is.' }) })); }
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

// ── what the board shows at a glance ──────────────────────────────
// Acceptance date, job length, notes and progress % were four columns
// carrying one line each, squeezed to nothing and eating the calendar. They
// live in the popup now — which is where they were edited from anyway.
{
  const { ctx: c0, pg: p0 } = await boot();
  let g = await p0.evaluate(() => ({
    heads: Array.from(document.querySelectorAll('.sched-hd-row:not(.months) .sched-cell.hd')).map(e => e.textContent.trim()),
    // r1 by name, not "the first row" — the board sorts oldest acceptance
    // first, so which row is on top is not this check's business.
    job: (document.querySelector('[data-rowzone="r1"] .sched-cell:nth-child(2)') || {}).innerHTML || '',
    site: (document.querySelector('[data-rowzone="r1"] .sched-cell:nth-child(3)') || {}).textContent || '',
    siteTitle: (document.querySelector('[data-rowzone="r1"] .sched-cell:nth-child(3) span') || {}).title || '',
    openBtn: (document.querySelector('[data-rowzone="r1"] .sched-cell:nth-child(1) [data-info]') || {}).outerHTML || '',
  }));
  check('the board no longer carries the four squeezed text columns',
    !g.heads.some(h => /Acc|Len|Notes|%/.test(h)), JSON.stringify(g.heads));
  check('…and still carries the four milestones', 
    ['💰','🤝','📦','🚚'].every(i => g.heads.indexOf(i) >= 0), JSON.stringify(g.heads));
  check('the job column is the Fergus number, as a link into Fergus',
    /app\.fergus\.com\/jobs\/view\/8801/.test(g.job) && /FR-2996|8801/.test(g.job), g.job.slice(0, 160));
  check('…drawn as a link, not plain text', /<a /.test(g.job) && /underline/.test(g.job), g.job.slice(0, 120));
  check('…opening in a new tab, so the board is not navigated away from',
    /target="_blank"/.test(g.job) && /rel="noopener"/.test(g.job), g.job.slice(0, 160));
  check('the site column is the street on its own',
    g.site.trim() === 'Horeke Road', JSON.stringify(g.site));
  check('…with the whole address, and who it is for, on hover',
    /148 Horeke Road/.test(g.siteTitle) && /Brian Lewis/.test(g.siteTitle), g.siteTitle);
  check('the button beside it opens the job details',
    /data-info/.test(g.openBtn), g.openBtn);
  check('…and is still the drag handle, so the board can be put in order',
    /draggable="true"/.test(g.openBtn) && /data-rowdrag/.test(g.openBtn), g.openBtn);
  check('…and is big enough to hit', /font-size:15px/.test(g.openBtn), g.openBtn);

  // A job with no Fergus link must not leave a blank cell.
  g = await p0.evaluate(() => {
    _SCHED.data.rows.find(x => x.id === 'r1').fergus_no = '';
    _SCHED.data.rows.find(x => x.id === 'r1').fergus_id = '';
    _schedRender();
    const c = document.querySelector('[data-rowzone="r1"] .sched-cell:nth-child(2)');
    return { html: c.innerHTML, text: c.textContent.trim() };
  });
  check('a job with no Fergus job linked still names itself',
    !!g.text && !/<a /.test(g.html), g.html.slice(0, 140));
  check('…and still opens its details', /data-rowmenu/.test(g.html), g.html.slice(0, 140));
  // The street reader, on the shapes a NZ address comes in.
  const st = await p0.evaluate(() => ['23, Don Buck Road, Massey', '148 Horeke Road , Okaihau',
    '10/1 Ash Grove Circle, Haruru', '1156 SH12, Oue', 'Kemp House', ''].map(a => _schedStreet(a)));
  check('the street is read out of an address however it is written',
    JSON.stringify(st) === JSON.stringify(['Don Buck Road','Horeke Road','Ash Grove Circle','SH12','Kemp House','']),
    JSON.stringify(st));
  await c0.close();
}

// ── the board, unlocked ───────────────────────────────────────────
let { ctx, pg, calls } = await boot();
let v = await pg.evaluate(() => ({
  wrap: getComputedStyle(document.getElementById('schedWrap')).display !== 'none',
  rows: document.querySelectorAll('.sched-row:not(.pad)').length,
  blocks: document.querySelectorAll('.sched-block').length,
  chips: document.querySelectorAll('#schedPalette [data-pal]').length,
  editChip: !!document.querySelector('#schedPalette [data-pal-edit]'),
  weekendShades: document.querySelectorAll('.sched-shade:not(.cap):not(.today)').length,
  capShades: document.querySelectorAll('.sched-shade.cap').length,
}));
check('the board renders rows, blocks, palette (with its ✎ chip) and weekend shading',
  v.wrap && v.rows === 2 && v.blocks === 2 && v.chips === 3 && v.editChip && v.weekendShades > 20, JSON.stringify(v));
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

// The tap paints IMMEDIATELY — the (slow) server answer only swaps the id in.
calls.length = 0;
await pg.mouse.click(box.x + 18 * 24 + 12, box.y + 15);   // Mon 14 Sep, free working day
await pg.waitForTimeout(120);
v = await pg.evaluate(() => document.querySelectorAll('[data-block^="tmp-"]').length);
check('a tap paints instantly, before the server answers', v >= 1, v + ' temp blocks at 120ms');
await pg.waitForTimeout(900);
v = await pg.evaluate(() => document.querySelectorAll('[data-block^="tmp-"]').length);
check('…and the block takes the server id when the answer lands', v === 0, v + ' temp blocks left');

// Solid-book: click the pencil block with Troy selected.
calls.length = 0;
box = await pg.locator('[data-strip="r1"]').boundingBox();
await pg.mouse.click(box.x + 8 * 24 + 12, box.y + 15);   // pencil b1 covers Sep 4 (idx 8)
await pg.waitForTimeout(400);
let rep = calls.find(c => /^PATCH b1/.test(c[0]));
check('clicking a pencil block with a crew selected solid-books it',
  !!rep && rep[1].kind === 'crew' && rep[1].crew_id === 'troy', JSON.stringify(rep && rep[1]));

// ── the ✉ milestone flags on the calendar ─────────────────────────
v = await pg.evaluate(() => {
  const flags = [...document.querySelectorAll('.sched-flag')].map(f => ({
    k: f.getAttribute('data-flag'), row: f.getAttribute('data-flagrow'),
    col: f.style.color, op: +getComputedStyle(f).opacity,
    size: parseFloat(getComputedStyle(f).fontSize) }));
  const helper = _schedRowFlags(_SCHED.data.rows.find(r => r.id === 'r1')).map(f => f.kind + '@' + f.date);
  return { flags, helper };
});
check('the three milestone dates hang off acceptance and the start',
  v.helper.join('|') === 'pencil@2026-08-28|week@2026-08-21|confirm@2026-09-01', v.helper.join('|'));
check('…and the in-range ones render as coloured envelopes',
  v.flags.some(f => f.k === 'pencil' && f.row === 'r1' && /220, 38, 38/.test(f.col)) &&
  v.flags.some(f => f.k === 'confirm' && f.row === 'r1' && /22, 163, 74/.test(f.col)),
  JSON.stringify(v.flags).slice(0, 140));
// "increase the size of the email symbols on the schedule". They were 11px
// and half-faded on a board this dense — small enough to miss, and they are
// the buttons that send the customer their emails. Still short of the day
// column's width, so they cannot overlap their neighbours.
check('THE ASK: the envelopes are big enough to see and to hit',
  v.flags.length > 0 && v.flags.every(f => f.size >= 14 && f.size <= 22 && f.op >= 0.7),
  JSON.stringify(v.flags.map(f => f.size + 'px @' + f.op)).slice(0, 120));
await pg.evaluate(() => document.querySelector('.sched-flag[data-flagrow="r1"][data-flag="confirm"]').click());
await pg.waitForTimeout(150);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedMailModal')).display !== 'none',
  title: document.getElementById('schedMailTitle').textContent,
}));
check('clicking a flag opens the email box on that wording', v.shown && /confirm start date/i.test(v.title), v.title);
await pg.evaluate(() => _schedMailClose());
await pg.waitForTimeout(700);

// Compose + send goes through the review modal.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-mail="r1"]').click());
await pg.waitForTimeout(120);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedMailModal')).display !== 'none',
  writing: /Writing the email/.test(document.getElementById('schedMailBody').value),
  disabled: document.getElementById('schedMailSendBtn').disabled,
  kinds: [...document.querySelectorAll('#schedMailKinds [data-mailkind]')].map(b => b.getAttribute('data-mailkind')),
}));
check('the email box opens INSTANTLY, wording still being written',
  v.shown && v.writing && v.disabled && v.kinds.join(',') === 'pencil,week,confirm', JSON.stringify(v));
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedMailModal')).display !== 'none',
  to: document.getElementById('schedMailTo').value,
  body: document.getElementById('schedMailBody').value,
  enabled: !document.getElementById('schedMailSendBtn').disabled,
}));
check('the email opens prefilled for review — never auto-sent',
  v.shown && v.to === 'b@l.nz' && /late October/.test(v.body) && v.enabled, JSON.stringify(v).slice(0, 100));

// The three wordings switch in place.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-mailkind="week"]').click());
await pg.waitForTimeout(900);
let wkc = calls.find(c => c[0] === 'compose');
check('the Week of… button re-composes in that wording',
  !!wkc && wkc[1].kind === 'week' && /week of/i.test(await pg.evaluate(() => document.getElementById('schedMailTitle').textContent)),
  JSON.stringify(wkc && wkc[1]));
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
// Acceptance date, length, notes and % came off the board and into the
// popup: four columns of squeezed text that were eating the calendar.
check('…and » brings the full set back — open, job, site and the milestones',
  v === 8, v + ' header cells');

// The ✎ chip edits crews & colours right from the header bar.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-pal-edit]').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedCrewPop')).display !== 'none',
  rows: document.querySelectorAll('#schedCrewPopList [data-crewname]').length,
}));
check('the ✎ chip opens Crews & colours with the existing crews', v.shown && v.rows === 2, JSON.stringify(v));
await pg.evaluate(() => {
  _schedCrewAdd('schedCrewPopList');
  const inps = document.querySelectorAll('#schedCrewPopList [data-crewname]');
  const last = inps[inps.length - 1];
  last.value = "Nick's boys"; last.dispatchEvent(new Event('input'));
});
await pg.evaluate(() => _schedCrewPopSave());
await pg.waitForTimeout(400);
const cfgPut = calls.find(c => c[0] === 'PUT config');
check('Save sends all three crews and reloads the board',
  !!cfgPut && (cfgPut[1].crews || []).length === 3 && cfgPut[1].crews[2].name === "Nick's boys" &&
  calls.some(c => c[0] === 'GET /schedule'), JSON.stringify(cfgPut && cfgPut[1]).slice(0, 110));

// ── Ctrl + scroll zooms the calendar ──────────────────────────────
v = await pg.evaluate(() => {
  const scroll = document.getElementById('schedScroll');
  const mk = () => new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, clientX: 700, bubbles: true, cancelable: true });
  const before = _SCHED.dayW;
  for (let i = 0; i < 5; i++) scroll.dispatchEvent(mk());
  const mid = { dayW: _SCHED.dayW,
    cssVar: document.getElementById('schedGrid').style.getPropertyValue('--sched-dayw'),
    stored: localStorage.getItem('fr_sched_dayw'),
    blockW: document.querySelector('[data-block="b1"]').getBoundingClientRect().width };
  for (let i = 0; i < 20; i++) scroll.dispatchEvent(mk());
  const floor = _SCHED.dayW;
  const numbered = [...document.querySelectorAll('.sched-day-hd')].filter(x => x.textContent).length;
  const total = document.querySelectorAll('.sched-day-hd').length;
  return { before, mid, floor, numbered, total };
});
check('Ctrl + scroll zooms the calendar out — day width shrinks and sticks',
  v.before === 24 && v.mid.dayW === 14 && v.mid.cssVar === '14px' && v.mid.stored === '14',
  JSON.stringify({ b: v.before, m: v.mid.dayW, css: v.mid.cssVar, ls: v.mid.stored }));
check('…blocks rescale with it (8 working days over a weekend = 12 × 14px)',
  Math.abs(v.mid.blockW - (12 * 14 - 2)) < 2, v.mid.blockW + 'px');
check('…zooming right out clamps at 6px/day and thins the day numbers to Mondays',
  v.floor === 6 && v.numbered < v.total / 3, v.floor + 'px, ' + v.numbered + '/' + v.total + ' numbered');
await pg.evaluate(() => { _SCHED.dayW = 24; try { localStorage.removeItem('fr_sched_dayw'); } catch(e){} _schedRender(); });
await pg.waitForTimeout(300);

// ── the delivery, carried over from the material order ────────────
// "show the delivery date in orange which indicates thats the requested day
//  … a tick box to say that delivery date has been confirmed which then
//  turns the indicator green."
{
  const d = await pg.evaluate(() => [...document.querySelectorAll('.sched-deliv')].map(e => ({
    row: e.getAttribute('data-delivrow'), col: e.style.color, title: e.getAttribute('title') || '' })));
  check('THE ASK: the delivery shows on the board on its own day',
    d.length === 2, JSON.stringify(d).slice(0, 160));
  check('…orange while it is only the day that was asked for',
    d.some(x => x.row === 'r1' && /234, 88, 12/.test(x.col) && /requested/i.test(x.title)),
    JSON.stringify(d.find(x => x.row === 'r1') || null));
  check('…and green once the supplier has confirmed it',
    d.some(x => x.row === 'r2' && /22, 163, 74/.test(x.col) && /confirmed/i.test(x.title)),
    JSON.stringify(d.find(x => x.row === 'r2') || null));
  // One row, one truck: a requested AND a confirmed date on the same job must
  // not paint two, or the board reads as two separate deliveries.
  check('…and a confirmed job shows one delivery, not two',
    d.filter(x => x.row === 'r2').length === 1, JSON.stringify(d));
}

// ── correcting and confirming it, from the job popup ──────────────
{
  const patches = [];
  await pg.route('**/schedule/rows/**', async (r) => {
    if (r.request().method() === 'PATCH') patches.push(r.request().postDataJSON());
    await r.fulfill({ status:200, contentType:'application/json', body:'{}' });
  });
  await pg.evaluate(() => _schedInfoOpen('r1'));
  await pg.waitForTimeout(300);
  const shown = await pg.evaluate(() => ({
    date: (document.querySelector('#schedInfoModal [data-iedit="requested_delivery"]') || {}).value,
    tick: !!(document.getElementById('schedInfoDelivOk') || {}).checked,
  }));
  check('the job popup shows the delivery date it was ordered for',
    shown.date === '2026-09-18', JSON.stringify(shown));
  check('…and the confirmed tick is clear while it is still only a request',
    shown.tick === false, JSON.stringify(shown));

  await pg.evaluate(() => { const i = document.querySelector('#schedInfoModal [data-iedit="requested_delivery"]');
    i.value = '2026-09-21'; i.onchange(); });
  await pg.waitForTimeout(200);
  check('THE ASK: the delivery date can be changed by hand',
    patches.some(p => p && p.requested_delivery === '2026-09-21'), JSON.stringify(patches).slice(0, 160));

  await pg.evaluate(() => { const c = document.getElementById('schedInfoDelivOk'); c.checked = true; c.onchange(); });
  await pg.waitForTimeout(200);
  check('THE ASK: ticking confirmed saves the day it was confirmed for',
    patches.some(p => p && p.confirmed_delivery === '2026-09-21'), JSON.stringify(patches).slice(0, 200));
  const nowGreen = await pg.evaluate(() =>
    [...document.querySelectorAll('.sched-deliv')].some(e =>
      e.getAttribute('data-delivrow') === 'r1' && /22, 163, 74/.test(e.style.color)));
  check('…and the board turns that delivery green straight away', nowGreen);

  await pg.evaluate(() => { const c = document.getElementById('schedInfoDelivOk'); c.checked = false; c.onchange(); });
  await pg.waitForTimeout(200);
  check('…and un-ticking it puts it back to a request rather than losing the day',
    patches.some(p => p && p.confirmed_delivery === null), JSON.stringify(patches).slice(-150));
  await pg.evaluate(() => _schedInfoClose());
  await pg.unroute('**/schedule/rows/**');
}

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
