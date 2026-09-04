// "can you auto populate the schedule following the attached pictures,
//  entering in the jobs and current colour blocks from my excel file and I can
//  start using the roofmap schedule going forward"
//
// A roofing office will not retype forty live jobs to try a new board, so
// without a way in, the schedule only ever holds new work. Paste rather than
// a file upload: Excel puts tab-separated text on the clipboard, everybody
// knows how to copy rows, and there is no file format to get wrong.
//
// The parts that would hurt to get wrong: nothing is written until the button
// is pressed, dates as a spreadsheet actually writes them are understood, and
// a date it cannot read is SAID rather than quietly dropped.
//
// Also covers the folders — Pole Sheds, Completed Jobs, Checks to do — which
// the sheet kept as blocks of rows further down the page.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const sched = {
  cfg: { crews: [{ id:'justin', name:'Justin', colour:'#e83e8c' }, { id:'luke', name:'Luke', colour:'#7c3aed' }],
         cap: 4, shutdowns: [], region: 'auckland' },
  rows: [], blocks: [], nonwork: [],
  range: { from:'2026-08-01', to:'2026-12-31', today:'2026-09-04' },
  feed_url: 'https://x/schedule/feed.ics?c=co&sig=abc',
};
const ctx = await b.newContext({ viewport:{ width:1700, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const calls = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/schedule(\?|$)/.test(u) && m === 'GET') return j(sched);
  if (/\/schedule\/rows$/.test(u) && m === 'POST'){
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push(['row', body]);
    return j(Object.assign({ id:'nr' + calls.length, archived:false, auto:{} }, body));
  }
  if (/\/schedule\/blocks$/.test(u) && m === 'POST'){
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push(['block', body]);
    return j(Object.assign({ id:'nb' + calls.length }, body));
  }
  if (/\/schedule\/rows\/[^/]+$/.test(u) && m === 'PATCH'){
    calls.push(['patch', JSON.parse(r.request().postData() || '{}')]); return j({});
  }
  if (/\/schedule\//.test(u)) return j({});
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.removeItem('fr_company'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => gotoTab('schedule'));
await pg.waitForTimeout(800);

// Straight off the sheet in the screenshots — the real headings, the real
// date formats, a spacer row, and a delivery cell that is a note not a date.
const PASTE = [
  'Job\tClient\tSite\tSpecial Notes\tConfirmed Delivery\tStart\tDays\tCrew\tDeposit Paid?\tOrdered?\tFolder',
  '2535\tBrian Lewis\t148 Horeke Road , Okaihau\tonly roofs left to paint\t4-Nov\t2026-09-07\t8\tJustin\tPAID\t\t',
  '3150\tModspace\tChristie Waipapa\tEthan Ordered\t\t\t\t\t\tYes\t',
  '\t\t\t\t\t\t\t\t\t\t',
  '3125\tGreg Thomas\t98 Settlers Way, Okaihau\tPartial Re-Roof in Zinc\t3-Sept\t3/09/2026\t4\tLuke\tPAID\tYes\t',
  '2787\tJustin Tilly\tState highway 12, Whirinaki\t10 x 10 Pole Shed\t30-Jul\t\t\t\tPAID\tYes\tPole Sheds',
  '3098\tWaikeri Stirling\t28 Puia Street, Ngawha\tPole Shed\tRoof lift\t\t\t\tPAID\t\tCompleted Jobs',
].join('\n');

await pg.evaluate(() => _schedImportOpen());
await pg.waitForTimeout(200);
let v = await pg.evaluate(() => ({
  open: getComputedStyle(document.getElementById('schedImpModal')).display !== 'none',
  go: document.getElementById('schedImpGo').disabled,
}));
check('the importer opens with nothing to import yet', v.open && v.go === true, JSON.stringify(v));

await pg.evaluate((t) => { document.getElementById('schedImpText').value = t; _schedImportPreview(); }, PASTE);
await pg.waitForTimeout(200);
const parsed = await pg.evaluate(() => ({
  rows: _SCHED_IMP.rows, warn: _SCHED_IMP.warn,
  go: document.getElementById('schedImpGo').disabled,
  msg: document.getElementById('schedImpMsg').textContent,
  preview: document.querySelectorAll('#schedImpPreview tr').length,
}));
check('it reads the jobs and skips the spacer row',
  parsed.rows.length === 5, parsed.rows.length + ' rows');
check('…and shows them before anything is written',
  parsed.preview === 6 && /5 jobs/.test(parsed.msg), parsed.preview + ' preview rows · ' + parsed.msg);
check('…with nothing sent to the server yet', calls.length === 0, JSON.stringify(calls.length));

const byName = (n) => parsed.rows.find(r => r.client_name === n) || {};
check('a "4-Nov" delivery is read as a real date',
  /^\d{4}-11-04$/.test(byName('Brian Lewis').confirmed_delivery || ''),
  byName('Brian Lewis').confirmed_delivery);
check('"3-Sept" is read too — the sheet writes months both ways',
  /^\d{4}-09-03$/.test(byName('Greg Thomas').confirmed_delivery || ''),
  byName('Greg Thomas').confirmed_delivery);
check('a day-first date like 3/09/2026 is September, not March',
  byName('Greg Thomas')._start === '2026-09-03', byName('Greg Thomas')._start);
check('the job number is kept with the notes, not thrown away',
  /2535/.test(byName('Brian Lewis').notes) && /only roofs left to paint/.test(byName('Brian Lewis').notes),
  byName('Brian Lewis').notes);
check('a delivery cell that is a note, not a date, is called out rather than dropped',
  parsed.warn.some(w => /Waikeri Stirling/.test(w) && /Roof lift/.test(w)), JSON.stringify(parsed.warn));
check('…and that job still imports', !!byName('Waikeri Stirling').client_name);
check('PAID and Yes are understood as ticks',
  byName('Greg Thomas')._deposit === true && byName('Greg Thomas')._ordered === true,
  JSON.stringify({ d: byName('Greg Thomas')._deposit, o: byName('Greg Thomas')._ordered }));
check('a folder column lands the job in that folder',
  byName('Justin Tilly').folder === 'poleshed' && byName('Waikeri Stirling').folder === 'completed',
  JSON.stringify([byName('Justin Tilly').folder, byName('Waikeri Stirling').folder]));

// ── the import itself ──
await pg.evaluate(() => _schedImportRun());
await pg.waitForTimeout(1200);
const rowsSent = calls.filter(c => c[0] === 'row').map(c => c[1]);
const blocksSent = calls.filter(c => c[0] === 'block').map(c => c[1]);
check('pressing Import creates every job', rowsSent.length === 5, rowsSent.length + ' rows');
check('…carrying the site address across',
  (rowsSent.find(r => r.client_name === 'Brian Lewis') || {}).site_address === '148 Horeke Road , Okaihau',
  JSON.stringify((rowsSent[0] || {}).site_address));
check('…and the folder', (rowsSent.find(r => r.client_name === 'Justin Tilly') || {}).folder === 'poleshed');
check('only the jobs with a start date get painted on the board',
  blocksSent.length === 2, blocksSent.length + ' blocks');
check('…for the right number of days',
  (blocksSent.find(x => x.start_date === '2026-09-07') || {}).work_days === 8,
  JSON.stringify(blocksSent));
check('a named crew is booked to that crew, not left pencilled',
  (blocksSent.find(x => x.start_date === '2026-09-07') || {}).crew_id === 'justin',
  JSON.stringify(blocksSent.map(x => x.crew_id)));
check('the importer closes itself once it is done',
  await pg.evaluate(() => getComputedStyle(document.getElementById('schedImpModal')).display === 'none'));

// ── a real job has several runs on the calendar, not one ──────────────
// Start/Days carries one booking. The sheet this was built from has a
// scaffold run, a crew run and a second visit after the rain on the same
// job — 145 coloured runs across 89 jobs — so one is not enough.
calls.length = 0;
const MULTI = [
  'Job\tClient\tSite\tBlocks\tFolder',
  '2917\tAmy Hunter\t1156 SH12, Oue\t2026-08-26:2:Scaffold; 2026-08-28:1:Nick; 2026-08-31:2:Nick\t',
  '3125\tGreg Thomas\t98 Settlers Way\t2026-09-02:1:Scaffold; 2026-09-03:2:Luke\t',
  '3148\tFreedom Whare\t9 Dickeson Street\t2026-09-14:5\t',
  '3195\tPaihia Beach Resort\t130 Marsden Road\tnot a date at all\t',
].join('\n');
await pg.evaluate(() => _schedImportOpen());
await pg.evaluate((t) => { document.getElementById('schedImpText').value = t; _schedImportPreview(); }, MULTI);
await pg.waitForTimeout(200);
const multi = await pg.evaluate(() => ({ rows: _SCHED_IMP.rows, warn: _SCHED_IMP.warn,
  preview: document.getElementById('schedImpPreview').textContent }));
const mby = (n) => multi.rows.find(r => r.client_name === n) || {};
check('a Blocks cell carries every run on the job',
  (mby('Amy Hunter')._blocks || []).length === 3, JSON.stringify(mby('Amy Hunter')._blocks));
check('…each with its own start, length and crew',
  JSON.stringify((mby('Amy Hunter')._blocks || [])[0]) === JSON.stringify({ start:'2026-08-26', days:2, crew:'Scaffold' }),
  JSON.stringify((mby('Amy Hunter')._blocks || [])[0]));
check('…and a run with no crew named is still a run',
  (mby('Freedom Whare')._blocks || []).length === 1 && mby('Freedom Whare')._blocks[0].crew === '',
  JSON.stringify(mby('Freedom Whare')._blocks));
check('the preview says how many bookings a job has, not a length',
  /3 bookings/.test(multi.preview), multi.preview.slice(0, 200));
check('bookings it cannot read are named, and the job still imports',
  multi.warn.some(w => /Paihia Beach Resort/.test(w)) && !!mby('Paihia Beach Resort').client_name,
  JSON.stringify(multi.warn));

await pg.evaluate(() => _schedImportRun());
await pg.waitForTimeout(1500);
const mb = calls.filter(c => c[0] === 'block').map(c => c[1]);
check('every run is painted on the board, not just the first',
  mb.length === 6, mb.length + ' blocks');
check('…the scaffold run booked to the scaffolder',
  !!mb.find(x => x.start_date === '2026-08-26' && x.work_days === 2), JSON.stringify(mb.slice(0, 2)));
check('…a run whose crew is not on this board is pencilled, not dropped',
  (mb.find(x => x.start_date === '2026-09-14') || {}).kind === 'pencil',
  JSON.stringify(mb.find(x => x.start_date === '2026-09-14')));
check('…and a named crew that IS on the board is booked to them',
  (mb.find(x => x.start_date === '2026-09-03') || {}).crew_id === 'luke',
  JSON.stringify(mb.find(x => x.start_date === '2026-09-03')));

// ── the folders on the board ──
await pg.evaluate(() => {
  _SCHED.data.rows = [
    { id:'a', client_name:'Live job', site_address:'', length_days:1, folder:'', archived:false, created_at:'2026-08-01', accepted_at:'2026-08-01T00:00:00Z', auto:{} },
    { id:'b', client_name:'A pole shed', site_address:'', length_days:1, folder:'poleshed', archived:false, created_at:'2026-08-02', accepted_at:'2026-08-02T00:00:00Z', auto:{} },
    { id:'c', client_name:'Old job', site_address:'', length_days:1, folder:'completed', archived:false, created_at:'2026-07-01', accepted_at:'2026-07-01T00:00:00Z', auto:{} },
  ];
  _SCHED.data.blocks = [];
  _schedRender();
});
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  bands: Array.from(document.querySelectorAll('.sched-fold')).map(e => e.textContent.trim()),
  order: Array.from(document.querySelectorAll('.sched-row:not(.pad):not(.sched-fold) [data-rowmenu]')).map(e => e.textContent.trim()),
}));
check('the board groups the folders under headings',
  v.bands.length === 3 && /Pole Sheds/.test(v.bands.join('|')) && /Completed Jobs/.test(v.bands.join('|')),
  JSON.stringify(v.bands));
check('…with the live work first, and a finished job never sorted up among it',
  v.order[0] === 'Live job' && v.order[v.order.length - 1] === 'Old job', JSON.stringify(v.order));
check('collapsing a folder hides its jobs but keeps its heading', await (async () => {
  await pg.evaluate(() => _schedFoldToggle('poleshed'));
  await pg.waitForTimeout(200);
  return pg.evaluate(() => {
    const bands = document.querySelectorAll('.sched-fold').length;
    const names = Array.from(document.querySelectorAll('.sched-row:not(.pad):not(.sched-fold) [data-rowmenu]')).map(e => e.textContent.trim());
    return bands === 3 && names.indexOf('A pole shed') < 0 && names.indexOf('Live job') >= 0;
  });
})());

// A board with nothing in a folder looks exactly as it always did.
await pg.evaluate(() => {
  _SCHED.data.rows = [{ id:'a', client_name:'Only job', site_address:'', length_days:1, folder:'', archived:false, created_at:'2026-08-01', auto:{} }];
  _schedRender();
});
await pg.waitForTimeout(200);
check('a board with no folders in use shows no headings at all',
  await pg.evaluate(() => document.querySelectorAll('.sched-fold').length === 0));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
