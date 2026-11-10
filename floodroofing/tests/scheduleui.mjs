// The schedule board's UI: the Excel Schedule sheet's mechanics, driven
// with a real mouse. Painting respects the working-day calendar, a
// pencil block solid-books with one crew click, blocks drag, over-
// capacity days warn, the customer email goes through a review modal,
// and a plan without the feature sees the Team teaser — not a
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

// The saved job behind r1: a 12.6 x 8.1 m hip with a sent, accepted quote
// (the frozen customer copy the window reads), drawn once in a page of its
// own and kept for every boot.
let JOB_J1 = null;
async function mkJob(){
  const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /settings/.test(r.request().url()) ? JSON.stringify({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{}, labour_pricing:{ lead_price:180, lead_cost:45, app_price:70, app_cost:25, scaffold_price:2500, scaffold_cost:2000 } }) : '[]' }));
  await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.removeItem('fr_settings'); });
  await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);
  JOB_J1 = await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[140,160],[560,160],[560,430],[140,430]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
    document.querySelectorAll('#_rsModal,.rs-drop').forEach(e => e.remove());
    gotoTab('quote'); S.quote.ref = 'FR-2996'; S.quote.client = 'Brian Lewis';
    try { calcLabour(); } catch(e){} try { refreshQuoteProposal(); } catch(e){} try { _qpStashRoofGeom(false); } catch(e){}
    try { _qpBuildPriced(); } catch(e){} try { _qStampCustomerCopy(); } catch(e){}
    S.quote.share = Object.assign({}, S.quote.share || {}, { sentAt: '2026-08-20T02:00:00Z', status: 'accepted' });
    S.quote.accepted = { by: 'Brian Lewis', at: '2026-08-27T09:00:00Z' };
    return { id: 'j1', draw_state: snapshotCurrentJob() };
  });
  await pg.context().close();
}
await mkJob();

async function boot(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  const calls = [];
  const sched = opts.sched || mkSched();
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
    if (/\/jobs\/j1$/.test(u) && m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.job || JOB_J1) });
    if (/\/jobs(\?|$)/.test(u) && m === 'GET' && opts.jobs) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.jobs) });
    if (/fergus/i.test(u)) return r.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((o) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
    localStorage.setItem('fr_settings', 'null');
    // the office runs Fergus: the Job column links into it (a business without
    // Fergus gets plain text — tests/nofergus.mjs)
    localStorage.setItem('fr_jms', 'fergus'); localStorage.setItem('fr_jms_linked', '1');
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
  check('the job column is the Fergus number, opening the job window (no Fergus link, 2026-11-10)',
    /data-info="r1"/.test(g.job) && /FR-2996|8801/.test(g.job) && !/fergus\.com/.test(g.job), g.job.slice(0, 160));
  check('…drawn as a button, not a hyperlink', !/<a /.test(g.job), g.job.slice(0, 120));
  check('…and never a new tab', !/target="_blank"/.test(g.job), g.job.slice(0, 160));
  check('the site column is the street on its own',
    g.site.trim() === 'Horeke Road', JSON.stringify(g.site));
  check('…with the whole address, and who it is for, on hover',
    /148 Horeke Road/.test(g.siteTitle) && /Brian Lewis/.test(g.siteTitle), g.siteTitle);
  check('the button beside it opens the job details',
    /data-info/.test(g.openBtn), g.openBtn);
  check('…and is still the drag handle, so the board can be put in order',
    /draggable="true"/.test(g.openBtn) && /data-rowdrag/.test(g.openBtn), g.openBtn);
  check('…and is a proper badge, big enough to hit', /class="sched-i"/.test(g.openBtn), g.openBtn);

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
  check('…and still opens its details', /data-info/.test(g.html), g.html.slice(0, 140));
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
  rows: document.querySelectorAll('.sched-row:not(.pad):not(.sched-add):not(.sched-gap)').length,
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

// NO QUICK ROW ANYWHERE (2026-11-11): a blank line is blank, and "+ Add row"
// under the jobs opens the same Add job window the toolbar button does.
v = await pg.evaluate(() => ({
  padInputs: document.querySelectorAll('.sched-row.pad input').length,
  all: document.querySelectorAll('.sched-row').length,
  btn: !!document.querySelector('.sched-row.sched-add .sched-addrow-btn'),
  quick: !!document.getElementById('schedQClient'),
}));
check('blank rows carry no inputs and the quick-row form is gone', v.padInputs === 0 && v.all === 20 && v.btn && !v.quick, JSON.stringify(v));
await pg.click('.sched-row.sched-add .sched-addrow-btn');
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ open: document.getElementById('schedAddModal').style.display,
  w: document.getElementById('schedAddModal').getBoundingClientRect().width,
  fs: parseFloat(getComputedStyle(document.getElementById('schedJobSearch')).fontSize) }));
check('"+ Add row" opens the Add job window, twice the size it was', v.open === 'flex' && v.w >= 1000 && v.fs >= 15, JSON.stringify(v));
await pg.evaluate(() => _schedAddClose());

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
  v.hd === 3 && v.strips >= 2 && v.job && v.info && v.stored === '1', JSON.stringify(v));

// The ⓘ opens the details popup: full address, title, and the sheet's
// admin columns — ticking Handover done saves it.
await pg.evaluate(() => document.querySelector('[data-info="r1"]').click());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('schedInfoModal')).display !== 'none',
  title: document.getElementById('schedInfoTitle').textContent,
  no: document.getElementById('schedInfoNo').textContent,
  site: document.querySelector('#schedInfoModal [data-ishow="site_address"]').textContent,
  siteInputHidden: document.querySelector('#schedInfoModal [data-iedit="site_address"]').offsetParent === null,
  jobNo: document.querySelector('#schedInfoModal [data-ishow="job_no"]').textContent,
  noAccepted: !document.getElementById('schedInfoAccepted'), noColour: !document.getElementById('schedInfoColour'),
  lenEditable: document.querySelector('#schedInfoModal [data-iedit="length_days"]').offsetParent !== null,
  notesEditable: document.querySelector('#schedInfoModal [data-iedit="notes"]').offsetParent !== null,
  dep: document.querySelector('#schedInfoModal [data-iedit="deposit_paid"]').checked,
}));
check('ⓘ opens the job-details popup with the full address and title',
  v.shown && v.title === 'Brian Lewis' && /FR-2996/.test(v.no) &&
  v.site === '148 Horeke Road, Okaihau' && v.dep === true, JSON.stringify(v));
check('…on a saved job the client, job no, site and email are plain text, no accepted date or colour row, length and notes still edit',
  v.siteInputHidden && /FR-2996/.test(v.jobNo) && v.noAccepted && v.noColour && v.lenEditable && v.notesEditable, JSON.stringify(v));
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

// ── the batch from the phone screenshots ──────────────────────────
({ ctx, pg, calls } = await boot());
// Blank rows are blank; under the last job sits one "+ Add row" button.
v = await pg.evaluate(() => ({
  ph: Array.from(document.querySelectorAll('.sched-row.pad input')).filter(i => i.placeholder).length,
  adds: document.querySelectorAll('.sched-row.sched-add').length,
  btn: (document.querySelector('.sched-row.sched-add .sched-addrow-btn') || {}).textContent,
  pointer: getComputedStyle(document.querySelector('.sched-hd-row [data-tip]')).cursor,
  badge: getComputedStyle(document.querySelector('[data-rowzone="r1"] .sched-i')).borderRadius,
}));
check('blank rows carry no "Client name" placeholder', v.ph === 0, JSON.stringify(v));
check('one "+ Add row" button sits under the jobs', v.adds === 1 && v.btn === '+ Add row', JSON.stringify(v));
check('the column icons show a pointer finger', v.pointer === 'pointer', v.pointer);
check('the job button is a round badge', /50%/.test(v.badge), v.badge);

// Hover half a second over a column icon → a legend says what it means.
await pg.hover('.sched-hd-row [data-tip]:nth-of-type(4)');
await pg.waitForTimeout(60);
v = await pg.evaluate(() => (document.querySelector('.sched-tip') || {}).textContent || '');
check('the legend for a column icon pops up at once (2026-11-10)', /Deposit/.test(v), v);
// The job number opens the job window (no Fergus link any more), and the
// Site column widens by dragging its header's grip like a spreadsheet's.
v = await pg.evaluate(() => ({ fg: document.querySelectorAll('[data-fergus]').length,
  no: document.querySelectorAll('.sched-row [data-info]').length,
  grips: document.querySelectorAll('.sched-hd-row [data-colrz]').length }));
check('no job number links out to Fergus', v.fg === 0, JSON.stringify(v));
check('the job numbers open the job window', v.no >= 2, JSON.stringify(v));
check('every header column carries a resize grip', v.grips >= 7, JSON.stringify(v));
{
  const w0 = await pg.evaluate(() => document.querySelector('.sched-hd-row [data-colrz="site"]').parentElement.getBoundingClientRect().width);
  const gb = await pg.locator('.sched-hd-row [data-colrz="site"]').boundingBox();
  await pg.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await pg.mouse.down(); await pg.mouse.move(gb.x + 80, gb.y + 5, { steps: 4 }); await pg.mouse.up();
  await pg.waitForTimeout(150);
  const w1 = await pg.evaluate(() => document.querySelector('.sched-hd-row [data-colrz="site"]').parentElement.getBoundingClientRect().width);
  const kept = await pg.evaluate(() => JSON.parse(localStorage.getItem('fr_sched_colw') || '{}').site);
  check('dragging the Site grip widens the column', w1 > w0 + 50, w0 + ' -> ' + w1);
  check('…and the width is kept on this device', kept === Math.round(w1), kept + ' vs ' + w1);
  // Back to the shipped widths so the pins below land where they always did.
  await pg.evaluate(() => { localStorage.removeItem('fr_sched_colw'); _SCHED.colW = null; _schedRender(); });
}
// THE JOB WINDOW SHOWS THE JOB (2026-11-10): r1 has a saved job behind it,
// so the right-hand half reads GET /jobs/j1 and draws its roof, its accepted
// quote and the picks — and the hidden map-shot frame hands back the
// detailed map with the aerial. r2 was typed by hand and says so.
{
  await pg.evaluate(() => _schedInfoOpen('r1'));
  await pg.waitForTimeout(700);
  v = await pg.evaluate(() => ({
    w: document.getElementById('schedInfoModal').getBoundingClientRect().width,
    txt: (document.getElementById('schedInfoJob') || {}).textContent || '',
    hasSvg: !!document.querySelector('#sijMap svg'),
    frame: !!document.getElementById('schedMapFrame') }));
  check('the job window is the big one', v.w > 1000, v.w + 'px');
  check('…with the saved job\'s quote summary and the picks on the right', /Quote summary/.test(v.txt) && /What the customer chose/.test(v.txt) && /Steel grade/.test(v.txt), v.txt.slice(0, 160));
  check('…and the map straight away, the hidden render frame opened for the detailed one', v.hasSvg && v.frame, JSON.stringify({ svg: v.hasSvg, frame: v.frame }));
  let img = false;
  try { await pg.waitForSelector('#sijMap img', { timeout: 45000 }); img = true; } catch(e){}
  check('the detailed roof map lands from the frame', img, (await pg.evaluate(() => (document.querySelector('#sijMap .sij-wait') || {}).textContent)) || 'no img');
  v = await pg.evaluate(() => ({ roofs: (DRAW.roofs || []).length, tab: document.body.getAttribute('data-tab'), posts: 0 }));
  check('…and the office\'s own screen is untouched by it', v.roofs === 0 && v.tab === 'schedule', JSON.stringify(v));
  check('…the frame wrote nothing', !calls.some(c => /^(POST|PATCH|PUT) /.test(c[0]) && !/rows|blocks|config/.test(c[0])), JSON.stringify(calls.map(c => c[0])));
  await pg.evaluate(() => _schedInfoClose());
  await pg.evaluate(() => _schedInfoOpen('r2'));
  await pg.waitForTimeout(200);
  v = await pg.evaluate(() => (document.getElementById('schedInfoJob') || {}).textContent || '');
  check('a hand-typed row says there is no saved job behind it', /no saved RoofMap job/.test(v), v.slice(0, 120));
  await pg.evaluate(() => _schedInfoClose());
}
await pg.mouse.move(5, 5);
await pg.waitForTimeout(100);
v = await pg.evaluate(() => document.querySelectorAll('.sched-tip').length);
check('…which goes when the mouse leaves', v === 0, v + ' tips');

// Click an empty day with NOTHING selected: a popup offers pencil + crews.
calls.length = 0;
box = await pg.locator('[data-strip="r2"]').boundingBox();
await pg.mouse.click(box.x + 4 * 24 + 12, box.y + 15);   // Mon 31 Aug
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({
  menu: !!document.querySelector('.sched-menu[data-pick]'),
  items: Array.from(document.querySelectorAll('.sched-menu button')).map(b => b.textContent.trim()),
  sel: document.querySelectorAll('.sched-selbox').length,
}));
check('an empty day clicked with nothing selected opens the pencil/crew popup',
  v.menu && v.items[0] === 'Pencil' && v.items.includes('Troy') && v.items.includes('Nick') && v.items.some(t => /crews/.test(t)),
  JSON.stringify(v.items));
check('…with the picked day highlighted', v.sel === 1, v.sel + ' boxes');
check('…and nothing painted yet', !calls.some(c => c[0] === 'POST blocks'));
// Clicking anywhere else closes it.
await pg.mouse.click(box.x - 300, box.y + 15);
await pg.waitForTimeout(100);
v = await pg.evaluate(() => ({ menu: document.querySelectorAll('.sched-menu').length, sel: document.querySelectorAll('.sched-selbox').length }));
check('clicking elsewhere closes the popup and clears the highlight', v.menu === 0 && v.sel === 0, JSON.stringify(v));
check('…without painting anything', !calls.some(c => c[0] === 'POST blocks'));
// Pick Nick from it → a crew block, the job's full length.
await pg.mouse.click(box.x + 4 * 24 + 12, box.y + 15);
await pg.waitForTimeout(200);
await pg.evaluate(() => Array.from(document.querySelectorAll('.sched-menu button')).find(b => /Nick/.test(b.textContent)).click());
await pg.waitForTimeout(300);
paint = calls.find(c => c[0] === 'POST blocks');
check('picking a crew from the popup paints the job there',
  !!paint && paint[1].kind === 'crew' && paint[1].crew_id === 'nick' && paint[1].start_date === '2026-08-31' && paint[1].work_days === 4,
  JSON.stringify(paint && paint[1]));
await pg.waitForTimeout(800);

// Hold and drag across days: the run dragged is exactly what gets painted.
calls.length = 0;
box = await pg.locator('[data-strip="r2"]').boundingBox();
await pg.mouse.move(box.x + 18 * 24 + 12, box.y + 15);   // Mon 14 Sep
await pg.mouse.down();
await pg.mouse.move(box.x + 20 * 24 + 12, box.y + 15, { steps: 4 });
await pg.mouse.move(box.x + 22 * 24 + 12, box.y + 15, { steps: 4 });   // → Fri 18 Sep
await pg.waitForTimeout(100);
v = await pg.evaluate(() => (document.querySelector('.sched-selbox') || { offsetWidth: 0 }).offsetWidth);
check('dragging stretches the highlight over the days held', Math.abs(v - (5 * 24 - 2)) < 2, v + 'px');
await pg.mouse.up();
await pg.waitForTimeout(200);
await pg.evaluate(() => Array.from(document.querySelectorAll('.sched-menu button')).find(b => /Pencil/.test(b.textContent)).click());
await pg.waitForTimeout(300);
paint = calls.find(c => c[0] === 'POST blocks');
check('…and pencil paints those five working days, not the job length',
  !!paint && paint[1].kind === 'pencil' && paint[1].start_date === '2026-09-14' && paint[1].work_days === 5,
  JSON.stringify(paint && paint[1]));
await pg.waitForTimeout(800);

// Drag down across two rows with a crew selected: both rows get the block.
calls.length = 0;
await pg.evaluate(() => document.querySelector('[data-pal="troy"]').click());
const b1 = await pg.locator('[data-strip="r1"]').boundingBox();
const b2 = await pg.locator('[data-strip="r2"]').boundingBox();
const top = Math.min(b1.y, b2.y), bot = Math.max(b1.y, b2.y);
await pg.mouse.move(b1.x + 28 * 24 + 12, top + 15);      // Thu 24 Sep
await pg.mouse.down();
await pg.mouse.move(b1.x + 29 * 24 + 12, bot + 15, { steps: 6 });   // → Fri 25, next row
await pg.mouse.up();
await pg.waitForTimeout(300);
v = calls.filter(c => c[0] === 'POST blocks').map(c => c[1]);
check('holding across two rows paints both in the selected crew',
  v.length === 2 && v.every(x => x.crew_id === 'troy' && x.start_date === '2026-09-24' && x.work_days === 2) &&
  v.map(x => x.row_id).sort().join() === 'r1,r2', JSON.stringify(v));
await pg.waitForTimeout(800);

// The job details popup can take the row off the board.
pg.on('dialog', d => d.accept());
await pg.evaluate(() => _schedInfoOpen('r2'));
await pg.waitForTimeout(100);
calls.length = 0;
await pg.evaluate(() => _schedInfoDelete());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ gone: !document.querySelector('[data-rowzone="r2"]'),
  closed: document.getElementById('schedInfoModal').style.display === 'none' }));
check('the details popup has a Delete row button that removes the row', v.gone && v.closed, JSON.stringify(v));
await ctx.close();

// A block that started before the window still shows what is left of it,
// and folders sit in the company's dragged order.
{
  const sched = mkSched();
  sched.blocks.push({ id:'b0', row_id:'r2', kind:'crew', crew_id:'troy', start_date:'2026-08-24', work_days:5 }); // Mon 24 → Fri 28; window opens Thu 27
  sched.rows[0].folder = 'poleshed'; sched.rows[1].folder = '';
  sched.cfg.folder_order = ['poleshed', '', 'completed', 'checks'];
  ({ ctx, pg, calls } = await boot({ sched }));
  v = await pg.evaluate(() => {
    const el = document.querySelector('[data-block="b0"]');
    const folds = Array.from(document.querySelectorAll('[data-fold]')).map(e => e.getAttribute('data-fold'));
    return { w: el ? el.getBoundingClientRect().width : 0, left: el ? parseFloat(el.style.left) : -1, folds,
             draggable: Array.from(document.querySelectorAll('[data-fold]')).every(e => e.getAttribute('draggable') === 'true') };
  });
  check('a block that began before the window shows the days left in it', Math.abs(v.w - (2 * 24 - 2)) < 2 && v.left === 0, JSON.stringify(v));
  check('folders sit in the order the company dragged them into', v.folds.join('|') === 'poleshed|', v.folds.join('|'));
  check('…and their headings are draggable', v.draggable);
  // Each open section ends with "+ Add row", and a blank line separates it
  // from the next heading. A typed name lands in THAT section.
  v = await pg.evaluate(() => {
    const kinds = Array.from(document.querySelectorAll('#schedGrid .sched-row')).map(e =>
      e.classList.contains('sched-fold') ? 'F' : e.classList.contains('sched-add') ? 'A' : e.classList.contains('sched-gap') ? '_' : e.classList.contains('pad') ? 'p' : 'r');
    return { seq: kinds.join('').replace(/p+$/, ''), folders: Array.from(document.querySelectorAll('[data-addjob]')).map(e => e.getAttribute('data-addjob')) };
  });
  check('each section ends with an add row, and a blank line before the next heading', v.seq === 'FrA_FrA', v.seq);
  check('…and the add row knows its section', v.folders.join('|') === 'poleshed|', v.folders.join('|'));
  calls.length = 0;
  await pg.click('[data-addjob="poleshed"]');
  await pg.waitForTimeout(200);
  // The pick goes through the window's own binding, so the row lands in THAT section.
  await pg.evaluate(() => { var pick = document.getElementById('schedJobPick');
    pick.innerHTML = _schedAddRowHtml({ head: { id: 'jshed', client_name: 'Shed job' }, rows: [{ id: 'jshed' }], accepted: '2026-11-01T00:00:00Z' }, {});
    _schedAddBind(pick); });
  await pg.click('#schedJobPick [data-pickjob="jshed"]');
  await pg.waitForTimeout(300);
  const made = calls.find(c => c[0] === 'POST rows');
  check('a job picked under Pole Sheds is created in Pole Sheds', !!made && made[1].job_id === 'jshed' && made[1].folder === 'poleshed', JSON.stringify(made && made[1]));
  // A job number typed by hand shows in the Job column and links to Fergus.
  await pg.evaluate(() => { const r = _SCHED.data.rows.find(x => x.id === 'r2'); r.job_ref = '9123'; _schedRender(); });
  v = await pg.evaluate(() => (document.querySelector('[data-rowzone="r2"] .sched-cell:nth-child(2)') || {}).innerHTML || '');
  check('a hand-typed Fergus number shows in the Job column, no link out', !/fergus\.com/.test(v) && /9123/.test(v) && /data-info/.test(v), v.slice(0, 120));
  await pg.evaluate(() => _schedFolderMove('', 'poleshed'));
  await pg.waitForTimeout(200);
  v = await pg.evaluate(() => Array.from(document.querySelectorAll('[data-fold]')).map(e => e.getAttribute('data-fold')).join('|'));
  const put = calls.find(c => c[0] === 'PUT config');
  check('dropping a folder above another reorders the board and saves the order',
    v === '|poleshed' && !!put && put[1].folder_order[0] === '' && put[1].folder_order[1] === 'poleshed', v + ' ' + JSON.stringify(put && put[1]));
  await ctx.close();
}

// ── locked plan ───────────────────────────────────────────────────
// ── a Fergus-only job on the board (2026-11-11, job 3275) ─────────────
{
  const fgJob = { id: 15590001, jobNo: '3275', jobNumber: '3275', description: 'Re-Roof',
    customer: { customerFullName: 'Alfred Crawford', email: 'alf@x.nz' }, siteAddress: { address1: '1622F Matauri Bay Road', addressCity: 'Matauri Bay' } };
  const fgQuotes = { data: [
    { id: 901, title: 'Quote v2', status: 'Void', voidedAt: '2026-11-01', total: 100 },
    { id: 902, title: 'Quote v3', status: 'Accepted', isAccepted: true, acceptedAt: '2026-11-10T20:00:00Z', total: 23460,
      notes: 'Strip and re-roof the house in Colorsteel.',
      sections: [
        { name: 'Roof Labour', lineItems: [{ itemName: 'Lead Roofer', itemQuantity: 24, itemPrice: 140 }, { itemName: 'Apprentice', itemQuantity: 24, itemPrice: 90 }] },
        { name: 'Scaffolding', lineItems: [{ itemName: 'Lead Roofer', itemQuantity: 6, itemPrice: 140 }] },
        { name: 'Roof Material', lineItems: [{ itemName: 'Corrugate 0.40 Colorsteel', itemQuantity: 180, itemPrice: 42.5, unitOfMeasureSell: 'm2' }] },
      ] } ] };
  const sched = mkSched();
  const fgCalls = [];
  ({ ctx, pg, calls } = await boot({ sched, jobs: [] }));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/fergus/**', r => {
    const u = r.request().url(); fgCalls.push(u.split('/fergus')[1]);
    if (/\/jobs\?/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/3275|Crawford/i.test(decodeURIComponent(u)) ? { data: [fgJob] } : { data: [] }) });
    if (/\/jobs\/15590001\/quotes$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fgQuotes) });
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await pg.evaluate(() => { S.fergConnected = true; _schedAddOpen(); });
  await pg.waitForTimeout(300);
  await pg.fill('#schedJobSearch', '3275');
  await pg.waitForFunction(() => document.querySelector('[data-pickfergus]'), null, { timeout: 5000 });
  v = await pg.evaluate(() => { const el = document.querySelector('[data-pickfergus]'); return { id: el.getAttribute('data-pickfergus'), no: el.getAttribute('data-fgno'),
    client: el.getAttribute('data-fgclient'), site: el.getAttribute('data-fgsite'), tag: (el.querySelector('.sched-fgonly') || {}).textContent, text: el.textContent }; });
  check('a job quoted only in Fergus is found by its number and marked Fergus only', v.id === '15590001' && v.no === '3275' && v.client === 'Alfred Crawford' && /Matauri/.test(v.site) && /Fergus only — not in RoofMap/.test(v.tag), JSON.stringify(v));
  check('…and Fergus was asked by job number as well as by words', fgCalls.some(u => /filterJobNo=3275/.test(u)) && fgCalls.some(u => /filterSearchText=3275/.test(u)), JSON.stringify(fgCalls));
  calls.length = 0;
  await pg.click('[data-pickfergus]');
  await pg.waitForTimeout(400);
  const made = calls.find(c => c[0] === 'POST rows');
  check('picking it adds a row carrying the Fergus id, number, customer, site and email', !!made && made[1].fergus_job_id === '15590001' && made[1].job_ref === '3275' && made[1].client_name === 'Alfred Crawford' && /Matauri/.test(made[1].site_address) && made[1].email === 'alf@x.nz', JSON.stringify(made && made[1]));
  v = await pg.evaluate(() => ({ open: document.getElementById('schedAddModal').style.display, named: /3275/.test(document.getElementById('schedGrid').textContent) && /Matauri/.test(document.getElementById('schedGrid').textContent),
    row: _SCHED.data.rows[_SCHED.data.rows.length - 1].fergus_id }));
  check('…the window closes and the row is on the board as a Fergus job', v.open === 'none' && v.named && v.row === '15590001', JSON.stringify(v));
  // Its window: the banner, the accepted quote's description, hours and lines.
  const rid = await pg.evaluate(() => _SCHED.data.rows[_SCHED.data.rows.length - 1].id);
  await pg.evaluate((id) => _schedInfoOpen(id), rid);
  await pg.waitForFunction(() => document.querySelector('.sij-fghrs'), null, { timeout: 5000 });
  v = await pg.evaluate(() => { const b = document.getElementById('schedInfoJob');
    const rows = Array.from(b.querySelectorAll('.sij-fghrs tbody tr')).map(tr => tr.textContent.replace(/\s+/g, ' ').trim());
    return { banner: (b.querySelector('.sij-fgbanner') || {}).textContent, desc: (b.querySelector('.sij-fgdesc') || {}).textContent,
      rows, tot: (b.querySelector('.sij-fghrs tfoot') || {}).textContent, lines: b.querySelectorAll('.sij-fglines tbody tr').length,
      total: b.textContent.includes('$23,460.00'), accepted: /Quote — accepted/.test(b.textContent),
      facts: Array.from(document.querySelectorAll('#schedInfoFacts .sii-show')).map(e => e.textContent + '|' + e.style.display).join(';'),
      inputs: ['client_name', 'job_ref', 'site_address', 'email'].filter(k => document.querySelector('#schedInfoFacts [data-iedit="' + k + '"]').style.display !== 'none').length }; });
  check('its window says it is a Fergus-only job, not in RoofMap yet', /Fergus-only job \(not in RoofMap yet\)/.test(v.banner) && /#3275/.test(v.banner), v.banner);
  check('…shows the ACCEPTED quote, not the voided one, with its description and total', v.accepted && /Strip and re-roof/.test(v.desc) && v.total, JSON.stringify([v.desc, v.total, v.accepted]));
  check('…the allocated hours off the labour and scaffolding lines, 54 combined', v.rows.length === 3 && /Roof Labour — Lead Roofer ?24/.test(v.rows[0]) && /Scaffolding — Lead Roofer ?6/.test(v.rows[2]) && /54/.test(v.tot), JSON.stringify(v));
  check('…and every quote line item by section', v.lines === 7, String(v.lines));
  check('…with the facts as plain text from Fergus', /Alfred Crawford\|/.test(v.facts) && /3275\|/.test(v.facts) && v.inputs === 0, v.facts + ' inputs ' + v.inputs);
  await pg.evaluate(() => _schedInfoClose());
  // The same job searched again is marked as already on the schedule.
  await pg.evaluate(() => _schedAddOpen()); await pg.waitForTimeout(200);
  await pg.fill('#schedJobSearch', '3275');
  await pg.waitForFunction(() => document.querySelector('[data-pickfergus]'), null, { timeout: 5000 });
  v = await pg.evaluate(() => !!document.querySelector('[data-pickfergus] .sched-onboard'));
  check('searched again it wears the On the schedule chip', v);
  await ctx.close();
}

// ── live: the last schedule at once, and who is doing what (2026-11-11) ──
{
  const ctx2 = await b.newContext({ viewport: { width: 1700, height: 1000 } });
  const pg2 = await ctx2.newPage();
  pg2.on('pageerror', e => console.log('PAGEERROR', e.message));
  const pres = { users: [], ver: 1 }; const beats = [];
  let schedHold = null;   // null = answer at once; a function = hold the GET
  let getCount = 0;
  await pg2.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    if (/\/schedule\/presence$/.test(u)){ beats.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pres) }); }
    if (/\/schedule(\?|$)/.test(u) && m === 'GET'){ getCount++;
      const done = () => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSched()) });
      if (schedHold) return schedHold(done); return done(); }
    if (/\/schedule\/blocks\//.test(u) && m === 'PATCH') return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/schedule\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg2.addInitScript(() => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null');
    localStorage.setItem('fr_user', JSON.stringify({ name: 'Paula', email: 'paula@x.nz' }));
    localStorage.setItem('fr_company', JSON.stringify({ id: 'co', role: 'owner', plan: 'team', limits: { schedule: true } }));
    sessionStorage.setItem('fr_coach_seen', '1');
  });
  await pg2.goto('file://' + DIR + '/app.html'); await pg2.waitForFunction(() => typeof _schedEnter === 'function');
  await pg2.evaluate(() => gotoTab('schedule'));
  await pg2.waitForFunction(() => _SCHED.data && document.querySelectorAll('.sched-block').length > 0);
  await pg2.waitForTimeout(400);
  let w = await pg2.evaluate(() => ({ copy: !!localStorage.getItem('fr_sched_last_co'), pill: document.getElementById('schedUpdating').style.display }));
  check('the fresh schedule is kept on the device and the Updating pill is off', w.copy && w.pill === 'none', JSON.stringify(w));
  // Leave and come back with the server slow: the board is drawn from the copy
  // at once, the pill spins, and the fresh answer takes the pill away.
  let release = null; schedHold = (done) => { release = done; };
  await pg2.evaluate(() => { gotoTab('home'); _SCHED.data = null; });
  await pg2.waitForTimeout(100);
  const beatsBefore = beats.length;
  await pg2.evaluate(() => gotoTab('schedule'));
  await pg2.waitForTimeout(250);
  w = await pg2.evaluate(() => ({ blocks: document.querySelectorAll('.sched-block').length, pill: document.getElementById('schedUpdating').style.display,
    spin: getComputedStyle(document.querySelector('.sched-spin')).animationName, copy: _SCHED.fromCopy }));
  check('coming back, the last schedule is on screen at once with "Updating…" spinning', w.blocks > 0 && w.pill === 'inline-flex' && /spin/.test(w.spin) && w.copy === true, JSON.stringify(w));
  release(); schedHold = null;
  await pg2.waitForFunction(() => document.getElementById('schedUpdating').style.display === 'none' && !_SCHED.fromCopy);
  check('…and the pill goes once the fresh one lands', true);
  // Heartbeats carry the name and run while the tab is open.
  await pg2.waitForTimeout(1700);
  w = { n: beats.length - beatsBefore, name: (beats[beats.length - 1] || {}).name };
  check('the tab heartbeats every second or two with the person\'s name', w.n >= 2 && w.name === 'Paula', JSON.stringify(w));
  // Somebody else holding block b1: it wears their name, and a grab is refused.
  pres.users = [{ id: 'u2', name: 'Hannah', hold: { what: 'drag', block: 'b1', row: 'r1' }, info: '' }];
  await pg2.waitForFunction(() => document.querySelector('.sched-block.held'), null, { timeout: 5000 });
  w = await pg2.evaluate(() => { const el = document.querySelector('[data-block="b1"]');
    return { held: el.classList.contains('held'), who: el.getAttribute('data-held'), strip: document.getElementById('schedWho').textContent,
      outline: getComputedStyle(el).outlineWidth, label: getComputedStyle(el, '::after').content }; });
  check('a block somebody else is moving wears their name in their colour', w.held && w.who === 'Hannah' && /Hannah/.test(w.strip) && /moving/.test(w.strip) && w.outline === '3px' && /Hannah/.test(w.label), JSON.stringify(w));
  const bb = await pg2.locator('[data-block="b1"]').boundingBox();
  await pg2.mouse.move(bb.x + 10, bb.y + 8); await pg2.mouse.down(); await pg2.mouse.move(bb.x + 90, bb.y + 8, { steps: 4 }); await pg2.mouse.up();
  await pg2.waitForTimeout(200);
  w = await pg2.evaluate(() => ({ msg: document.getElementById('schedMsg').textContent, hold: _SCHED_PRES.hold }));
  check('…and grabbing it is refused with their name', /Hannah/.test(w.msg) && !w.hold, JSON.stringify(w));
  // My own drag is reported as a hold on that block, then released.
  pres.users = [];
  await pg2.waitForFunction(() => !document.querySelector('.sched-block.held'), null, { timeout: 5000 });
  const b2 = await pg2.locator('[data-block="b2"]').boundingBox();
  await pg2.mouse.move(b2.x + 10, b2.y + 8); await pg2.mouse.down();
  await pg2.waitForTimeout(80);
  w = await pg2.evaluate(() => JSON.parse(JSON.stringify(_SCHED_PRES.hold)));
  await pg2.mouse.move(b2.x + 60, b2.y + 8, { steps: 4 }); await pg2.mouse.up();
  await pg2.waitForTimeout(80);
  const after = await pg2.evaluate(() => _SCHED_PRES.hold);
  check('my own drag is reported as a hold on that block and released on drop', w && w.what === 'drag' && w.block === 'b2' && after === null, JSON.stringify([w, after]));
  const sentHold = beats.some(x => x.hold && x.hold.block === 'b2');
  check('…and the server heard it', sentHold);
  // The board's version moved on the server (someone else saved): a quiet reload.
  getCount = 0;
  pres.ver = 2;
  await pg2.waitForTimeout(2200);
  w = await pg2.evaluate(() => _SCHED_PRES.ver);
  check('a change by somebody else reloads the board quietly within two seconds', w === 2 && getCount >= 1, JSON.stringify({ ver: w, getCount }));
  // Leaving the tab stops the heartbeat and says goodbye.
  const nb = beats.length;
  await pg2.evaluate(() => gotoTab('home'));
  await pg2.waitForTimeout(1800);
  w = { leave: beats.slice(nb).some(x => x.leave), extra: beats.slice(nb).filter(x => !x.leave).length };
  check('leaving the tab says goodbye and stops the heartbeat', w.leave && w.extra === 0, JSON.stringify(w));
  await ctx2.close();
}

({ ctx, pg, calls } = await boot({ lockedPlan: true }));
v = await pg.evaluate(() => ({
  teaser: getComputedStyle(document.getElementById('schedLockedCard')).display !== 'none',
  wrap: getComputedStyle(document.getElementById('schedWrap')).display === 'none',
  text: document.getElementById('schedLockedCard').textContent,
}));
check('a plan without the board sees the Team teaser (Business is off sale)', v.teaser && v.wrap && /Team/.test(v.text) && !/Business/.test(v.text),
  JSON.stringify({ teaser: v.teaser, wrap: v.wrap }));
check('…and never even asks the server for the board',
  !calls.some(c => c[0] === 'GET /schedule'), JSON.stringify(calls));
await ctx.close();

// ── 2026-11-10: names in the blocks, the flags centred and ticked once sent,
// the history, the length from the labour, the two zooms, the sticky columns
// over the envelopes, the To address from the row ──
{
  const sched = mkSched();
  sched.rows[0].notify_log = [{ at: '2026-08-28T03:00:00Z', kind: 'pencil', to: 'b@l.nz', subject: 'Your roofing job — expected timing' }];
  sched.rows[0].quote_sent_at = '2026-08-20T01:00:00Z';
  sched.rows[0].order_sent_at = '2026-08-28T20:00:00Z';
  sched.rows[0].labour_days = 4; sched.rows[0].length_set = false; sched.rows[0].length_days = 4;
  sched.rows[1].email = 'mod@space.nz';
  const { ctx, pg, calls } = await boot({ sched });
  let v = await pg.evaluate(() => {
    const blk = [...document.querySelectorAll('.sched-block')].map(b => ({ pencil: b.classList.contains('pencil'), lbl: (b.querySelector('.sched-block-lbl') || {}).textContent }));
    const flag = document.querySelector('.sched-flag'), st = flag && getComputedStyle(flag);
    const sent = document.querySelector('.sched-flag.sent');
    const deliv = document.querySelector('.sched-deliv'), ds = deliv && getComputedStyle(deliv);
    const info = document.querySelector('.sched-row .sched-info'), is = info && getComputedStyle(info);
    const strip = flag && flag.closest('.sched-strip').getBoundingClientRect(), fr = flag && flag.getBoundingClientRect(), dr = deliv && deliv.getBoundingClientRect();
    // each against ITS OWN row's strip — the first envelope and the first truck are on different rows
    const dstrip = deliv && deliv.closest('.sched-strip').getBoundingClientRect();
    const mid = (r, st) => r && st && Math.abs((r.top + r.height / 2) - (st.top + st.height / 2)) < 3;
    return { blk, flagTop: st && st.top, flagTr: st && st.transform, flagMid: mid(fr, strip), delivMid: mid(dr, dstrip), sentTick: !!(sent && sent.querySelector('.sched-flag-tick')), sentKind: sent && sent.getAttribute('data-flag'),
             sentTitle: sent && sent.title, delivTr: ds && ds.transform, infoZ: is && parseInt(is.zIndex, 10), flagZ: st && parseInt(st.zIndex, 10), delivZ: ds && parseInt(ds.zIndex, 10) };
  });
  check('every block carries its crew\'s name, a pencilled one says so', v.blk.some(x => x.lbl === 'Nick') && v.blk.some(x => x.pencil && x.lbl === 'pencilled'), JSON.stringify(v.blk));
  check('the envelopes and the truck sit in the middle of the day box', v.flagMid && v.delivMid, JSON.stringify([v.flagMid, v.delivMid, v.flagTop]));
  check('an envelope whose email has gone wears a tick and says when', v.sentTick && v.sentKind === 'pencil' && /sent 28 Aug/.test(v.sentTitle), v.sentTitle);
  check('the job columns ride over the envelopes and the truck as the board scrolls', v.infoZ > v.flagZ && v.infoZ > v.delivZ, JSON.stringify([v.infoZ, v.flagZ, v.delivZ]));
  // the info window
  v = await pg.evaluate(() => {
    _schedInfoOpen('r1');
    const m = document.getElementById('schedInfoModal');
    return { desc: !!document.getElementById('schedInfoDesc'), hist: document.getElementById('schedInfoHistory').innerText,
             lenNote: document.getElementById('schedInfoLenNote').textContent, len: m.querySelector('[data-iedit="length_days"]').value,
             theJob: /The job/.test(m.querySelector('.sched-info-body').innerText) };
  });
  check('the write-up of the job is gone from the window', !v.desc && !v.theJob);
  check('the History lists the quote sent, accepted, the order and every schedule email, oldest first',
    /20 Aug 2026.*Quote sent/.test(v.hist.replace(/\n/g, ' ')) && /27 Aug 2026.*Quote accepted/.test(v.hist.replace(/\n/g, ' ')) &&
    /28 Aug 2026.*Part of month email sent to b@l\.nz/.test(v.hist.replace(/\n/g, ' ')) && /Order emailed to the supplier/.test(v.hist) &&
    v.hist.indexOf('Quote sent') < v.hist.indexOf('Quote accepted') && v.hist.indexOf('Part of month') < v.hist.indexOf('Order emailed'), v.hist.slice(0, 200));
  check('the length reads the labour\'s four days and says where it came from', v.len === '4' && /32 crew hours/.test(v.lenNote), JSON.stringify([v.len, v.lenNote]));
  await pg.evaluate(() => { const i = document.querySelector('#schedInfoModal [data-iedit="length_days"]'); i.value = '6'; i.dispatchEvent(new Event('change')); });
  v = await pg.evaluate(() => ({ note: document.getElementById('schedInfoLenNote').textContent, set: _SCHED.data.rows[0].length_set }));
  check('a typed length is the office\'s from then on', v.set === true && /labour priced: 4 days/.test(v.note), JSON.stringify(v));
  await pg.evaluate(() => _schedInfoClose());
  // the email box takes the row's own address when the server hands none
  await pg.evaluate(() => { _schedMailOpen('r2', 'pencil'); });
  await pg.waitForTimeout(900);
  v = await pg.evaluate(() => document.getElementById('schedMailTo').value);
  check('the To box falls back to the row\'s own address', v === 'b@l.nz' || v === 'mod@space.nz', v);
  await pg.evaluate(() => { document.getElementById('schedMailTo').value = 'mod@space.nz'; });
  await pg.click('#schedMailSendBtn'); await pg.waitForTimeout(400);
  const sendCall = calls.find(c => c[0] === 'send');
  check('…and the send says which email it was', !!sendCall && sendCall[1].kind === 'pencil', JSON.stringify(sendCall && sendCall[1]));
  await pg.evaluate(() => _schedMailClose());
  // the two zooms
  v = await pg.evaluate(() => {
    const grid = document.getElementById('schedGrid');
    const fz0 = parseFloat(getComputedStyle(document.querySelector('.sched-row .sched-cell')).fontSize);
    const w0 = document.querySelector('.sched-row .sched-info').getBoundingClientRect().width;
    const h0 = document.querySelector('.sched-row .sched-strip').getBoundingClientRect().height;
    const d0 = _SCHED.dayW;
    _schedSetTextZoom(1.4);
    const fz1 = parseFloat(getComputedStyle(document.querySelector('.sched-row .sched-cell')).fontSize);
    const w1 = document.querySelector('.sched-row .sched-info').getBoundingClientRect().width;
    const h1 = document.querySelector('.sched-row .sched-strip').getBoundingClientRect().height;
    const d1 = _SCHED.dayW;
    const bar = document.getElementById('schedZoomText').value, lbl = document.getElementById('schedZoomTextLbl').textContent;
    const info = document.querySelector('.sched-row .sched-info');
    const r = info.getBoundingClientRect();
    info.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: r.left + 5, clientY: r.top + 5, bubbles: true, cancelable: true }));
    const fzW = _schedTextZoom(), dW = _SCHED.dayW;
    _schedSetDayW(12); const d2 = _SCHED.dayW, dayBar = document.getElementById('schedZoomDays').value;
    _schedSetTextZoom(1); _schedSetDayW(d0);
    return { fz0, fz1, w0, w1, h0, h1, d0, d1, bar, lbl, fzW, dW, d2, dayBar, stored: localStorage.getItem('fr_sched_tz') };
  });
  check('the Text zoom bar grows the words, the columns and the rows, and leaves the calendar alone',
    v.fz1 > v.fz0 * 1.3 && v.w1 > v.w0 * 1.3 && v.h1 > v.h0 && v.d1 === v.d0 && v.bar === '1.4' && v.lbl === '140%', JSON.stringify(v));
  check('Ctrl + wheel over the job columns zooms the words only', v.fzW === 1.5 && v.dW === v.d0, JSON.stringify([v.fzW, v.dW]));
  check('the Calendar bar sets the day width and remembers it', v.d2 === 12 && v.dayBar === '12' && v.stored === '1', JSON.stringify([v.d2, v.dayBar, v.stored]));
  // the block menu's Change ▾ drop-down (2026-11-11)
  v = await pg.evaluate(() => {
    const blk = [...document.querySelectorAll('.sched-block')].find(b => b.classList.contains('pencil'));
    const id = blk.getAttribute('data-block') || (blk.dataset || {}).block;
    const b = _SCHED.data.blocks.find(x => x.id === id) || _SCHED.data.blocks.find(x => x.kind !== 'crew');
    _schedBlockMenu(b, { clientX: 200, clientY: 200 });
    const m = document.querySelector('.sched-menu');
    const dd = m.querySelector('.sched-menu-dd'), sub = m.querySelector('.sched-menu-sub');
    const shut = sub.style.display === 'none';
    const labelOnly = dd.textContent.replace(/▾/, '').trim() === 'Change', chev = /▾/.test(dd.textContent);
    dd.click();
    const open = sub.style.display !== 'none' && dd.classList.contains('open');
    const opts = [...sub.querySelectorAll('button')].map(o => o.textContent.trim());
    const dots = sub.querySelectorAll('.dot').length;
    const ticked = [...sub.querySelectorAll('button')].filter(o => o.querySelector('.sched-menu-on')).map(o => o.textContent.trim());
    [...sub.querySelectorAll('button')].find(o => /Nick/.test(o.textContent)).click();
    return { id: b.id, shut, labelOnly, chev, open, opts, dots, ticked, kind: b.kind, crew: b.crew_id, menuGone: !document.querySelector('.sched-menu') };
  });
  await pg.waitForTimeout(200);
  const chg = calls.find(c => c[0] === 'PATCH ' + v.id && c[1].kind === 'crew');
  check('the block menu carries "Change" with a chevron, shut until pressed', v.labelOnly && v.chev && v.shut, JSON.stringify([v.labelOnly, v.chev, v.shut]));
  check('…pressed, it drops Pencil and every crew with its colour, the block\'s own ticked', v.open && v.opts[0].startsWith('Pencil') && v.opts.some(o => /Nick/.test(o)) && v.dots === v.opts.length && v.ticked.length === 1 && /Pencil/.test(v.ticked[0]), JSON.stringify([v.opts, v.ticked, v.dots]));
  check('…and picking a crew re-allocates the block and saves it', v.kind === 'crew' && v.crew && v.menuGone && !!chg && chg[1].crew_id === v.crew, JSON.stringify([v.kind, v.crew, chg]));
  // the header row is 30% taller (2026-11-11)
  v = await pg.evaluate(() => {
    const row = document.querySelector('.sched-hd-row.cols');
    const strip = row.querySelector('.sched-strip').getBoundingClientRect();
    const hd = row.querySelector('.sched-cell.hd'), body = document.querySelector('.sched-row .sched-cell.hd, .sched-row .sched-cell');
    const dn = row.querySelector('.sched-day-hd');
    return { h: strip.height, fz: parseFloat(getComputedStyle(hd).fontSize), dfz: parseFloat(getComputedStyle(dn).fontSize), dlh: parseFloat(getComputedStyle(dn).lineHeight) };
  });
  check('the column / day-number header row is 26px with its words and numbers scaled up', Math.abs(v.h - 26) < 1 && v.fz >= 13 && v.dfz >= 12 && Math.abs(v.dlh - 26) < 1, JSON.stringify(v));
  await ctx.close();
}

// ── feedback report 88 (2026-11-11): the job window shows the ACCEPTED version,
// an Allocated hours table, and Add job lists accepted jobs with a search ──
{
  // a draft made off the acceptance: the live quote lost `accepted` and reads
  // a new ref; the frozen Accepted copy keeps both
  const job = JSON.parse(JSON.stringify(JOB_J1));
  const live = job.draw_state.state.quote;
  const frozen = JSON.parse(JSON.stringify(live));
  frozen.ref = 'FR-ACC'; delete frozen.versions;
  live.versions = { accepted: { id: 'v1', quote: frozen }, media: {} };
  delete live.accepted; live.ref = 'FR-DRAFT';
  live.scaffold = { mode: 'diy', diy: { leadHrs: 4, appHrs: 4, leadPrice: 180, appPrice: 70, leadCost: 45, appCost: 25 } };
  frozen.scaffold = JSON.parse(JSON.stringify(live.scaffold));
  frozen.labour = Object.assign({}, frozen.labour || {}, { leadHrs: 30, appHrs: 30 });
  const jobs = [
    { id: 'j1', client_name: 'Brian Lewis', site_address: '148 Horeke Road, Okaihau', job_no: 'FR-2996', quote_sent: '2026-08-20T02:00:00Z', quote_accepted: '2026-08-27T09:00:00Z', updated_at: '2026-08-28' },
    { id: 'j5', client_name: 'Kristina Skododa', site_address: '1213A SH10, Kerikeri', job_no: '3351', quote_sent: '2026-09-01T02:00:00Z', quote_accepted: '2026-09-03T09:00:00Z', updated_at: '2026-09-03' },
    { id: 'j6', client_name: 'Arran Simpson', site_address: '136 McIntyres Road', job_no: '3352', quote_sent: '2026-09-05T02:00:00Z', quote_accepted: '2026-09-02T09:00:00Z', updated_at: '2026-09-05' },
    { id: 'j7', client_name: 'Jude Kenyon', site_address: '818 Kerikeri Inlet Road', job_no: '3360', quote_sent: '2026-09-09T02:00:00Z', quote_accepted: '', updated_at: '2026-09-09' },
    { id: 'j8', client_name: 'Untitled', site_address: '', job_no: '', quote_sent: '', quote_accepted: '', updated_at: '2026-09-10' },
  ];
  const { ctx, pg, calls } = await boot({ job, jobs });
  await pg.evaluate(() => _schedInfoOpen('r1'));
  await pg.waitForTimeout(700);
  v = await pg.evaluate(() => {
    const txt = (document.getElementById('schedInfoJob') || {}).textContent || '';
    const rows = [...document.querySelectorAll('#sijHours tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    const foot = (document.querySelector('#sijHours tfoot td:last-child') || {}).textContent;
    return { txt, rows, foot };
  });
  check('the job window reads the frozen ACCEPTED version, not the draft made off it', /FR-ACC/.test(v.txt) && !/FR-DRAFT/.test(v.txt) && /Accepted by Brian Lewis/.test(v.txt), v.txt.slice(0, 200));
  check('…with an Allocated hours table: the DIY scaffold, then each roof, guys × hours each = total',
    v.rows.length === 2 && v.rows[0][0].startsWith('Scaffolding') && v.rows[0][1] === '2' && v.rows[0][2] === '4' && v.rows[0][3] === '8' &&
    /Main Roof/.test(v.rows[1][0]) && v.rows[1][1] === '2' && v.rows[1][2] === '30' && v.rows[1][3] === '60', JSON.stringify(v.rows));
  check('…and the total combined hours at the foot', v.foot === '68', v.foot);
  await pg.evaluate(() => _schedInfoClose());
  // Add job
  await pg.evaluate(() => _schedAddOpen());
  await pg.waitForTimeout(500);
  v = await pg.evaluate(() => ({
    rows: [...document.querySelectorAll('#schedJobPick [data-pickjob]')].map(el => ({ id: el.getAttribute('data-pickjob'), on: el.classList.contains('on'), chip: !!el.querySelector('.sched-onboard'), acc: /Accepted/.test(el.textContent) })),
    search: !!document.getElementById('schedJobSearch'),
  }));
  check('Add job lists the ACCEPTED jobs only, newest acceptance first, the one already on the board last with a chip',
    v.rows.map(r => r.id).join(',') === 'j5,j6,j1' && v.rows.every(r => r.acc) && !v.rows[0].on && v.rows[2].on && v.rows[2].chip && !v.rows[0].chip && v.search, JSON.stringify(v));
  await pg.fill('#schedJobSearch', '3360'); await pg.waitForTimeout(150);
  v = await pg.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('schedJobSearchDrop')).display !== 'none',
    hits: [...document.querySelectorAll('#schedJobSearchDrop [data-pickjob]')].map(el => el.getAttribute('data-pickjob')),
  }));
  check('…the search box drops every matching job, a job number included, like the Home search', v.shown && v.hits.join(',') === 'j7', JSON.stringify(v));
  calls.length = 0;
  await pg.evaluate(() => document.querySelector('#schedJobSearchDrop [data-pickjob]').click());
  await pg.waitForTimeout(400);
  const added = calls.find(c => c[0] === 'POST rows');
  check('…and a pick from the search adds that job to the board', !!added && added[1].job_id === 'j7', JSON.stringify(added));
  await ctx.close();
}

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
