// ONE JOB IS ONE ROW, A NEW VERSION STARTS BLANK, AND A SENT QUOTE REACHES
// THE BOARD (the owner, 2026-10-18, on job 3303):
//
//   "when searching a job, like job#3303, it shows 3 jobs, two as 'saved' and
//    one as 'fergus' and i don't know which is the job i've been working on
//    that has work in it, there should only be one job when i search job
//    #3303, if it's a fergus job it should have a fergus tick, if a quotes
//    been sent in that job it should have a quote tick"
//   "if i click into that job then click on create new version, only then
//    should it create a completely new version without the roofmap, canavs
//    drawing or quote adjustements on it ... by default call that new version
//    'version 2' then allow me to edit the name if i want"
//
// The REAL server (in-process, on the fake PostgREST) with the office's own
// app pointed at it: the three rows he saw were a job, its second version and
// the Fergus job it is LINKED TO — all real, none of them saying so.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const DIR = process.env.FR_FRONTEND_DIR || _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CO = 'cccccccc-8888-4444-4444-444444444444', U = 'aaaaaaaa-8888-4444-4444-444444444444';
const { port, db } = await startFakePostgrest({
  __missing: [],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, email: 'office@floodroofing.co.nz' }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'active', plan: 'business' }],
  user_settings: [], jobs: [], invoices: [], usage_events: [], company_invites: [], job_revisions: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34879';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await sleep(700);
const API = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: 'office@floodroofing.co.nz', cid: CO, name: 'Aron' }, 'test-secret', { expiresIn: '2h' });
async function call(method, path, body){
  const r = await fetch(API + path, { method,
    headers: Object.assign({ authorization: 'Bearer ' + TOK }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch(e){}
  return { status: r.status, body: j, text: t };
}

// A job exactly like his: a drawing on it, a quote sent, linked to Fergus
// job 3303, and a RoofMap number of its own that is NOT 3303.
const JOB_STATE = {
  state: {
    linkedJobId: 'F-3303', linkedJobNo: '3303',
    quote: { ref: '06121', client: 'Dot Bolous', lineItems: [{ desc: 'Re-roof', qty: 1, unit: 18400, amount: 18400 }],
             share: { token: 'tok3303', status: 'sent', sentAt: '2026-10-18T02:00:00.000Z' } },
    roofs: [{ outline: [[0,0],[10,0],[10,8],[0,8]], lines: [1,2,3] }],
    img64: 'data:image/png;base64,AAAA',
  },
  draw: { outline: [[0,0],[10,0],[10,8],[0,8]] },
  form: { jobClient: 'Dot Bolous', jobAddr: '23 Gilbert Mair Rise', jobNo: '06121' },
};
let v = await call('POST', '/jobs', { client_name: 'Dot Bolous', site_address: '23 Gilbert Mair Rise', draw_state: JOB_STATE, settings: {} });
check('the job is created', v.status === 200 && !!v.body.id, v.text.slice(0, 160));
const JOB = v.body.id;

// ── (e) the list says what each job IS ───────────────────────────
v = await call('GET', '/jobs');
let row = (v.body || []).find(j => String(j.id) === String(JOB));
check('the jobs list carries the Fergus link and whether the quote went out',
  !!row && row.linked_job === 'F-3303' && row.linked_no === '3303' && !!row.quote_sent && row.job_no === '06121',
  JSON.stringify(row && { no: row.job_no, linked: row.linked_job, fno: row.linked_no, sent: row.quote_sent }));

// ── (f) a new version is blank, and named for its number ─────────
const BLANK = { state: { linkedJobId: 'F-3303', linkedJobNo: '3303',
                         quote: { ref: '06121', client: 'Dot Bolous', lineItems: [] } },
                form: { jobClient: 'Dot Bolous', jobAddr: '23 Gilbert Mair Rise', jobNo: '06121' } };
v = await call('POST', '/jobs/' + JOB + '/versions', { draw_state: BLANK });
check('a new version is called "Version 2", not after whoever made it',
  v.status === 200 && v.body.name === 'Version 2', v.text.slice(0, 160));
const V2 = v.body.id;
const v2row = db.jobs.find(j => String(j.id) === String(V2));
check('…and it is BLANK: no roof map, no canvas drawing, no quote lines',
  v2row && !((v2row.draw_state.state || {}).roofs || []).length && !(v2row.draw_state.state || {}).img64 &&
  !v2row.draw_state.draw && !(((v2row.draw_state.state || {}).quote || {}).lineItems || []).length,
  JSON.stringify(Object.keys(v2row ? v2row.draw_state : {})));
check('…while the first version still has every bit of its work',
  (db.jobs.find(j => String(j.id) === String(JOB)).draw_state.state.roofs || []).length === 1, '');
check('…and the customer’s link and acceptance never come across',
  v2row && !(((v2row.draw_state.state || {}).quote || {}).share), JSON.stringify(((v2row.draw_state.state||{}).quote||{}).share));
check('…but who the job is for does: the client, the number and the Fergus link',
  v2row && v2row.client_name === 'Dot Bolous' && v2row.draw_state.state.linkedJobNo === '3303' &&
  v2row.draw_state.state.quote.ref === '06121', '');
v = await call('POST', '/jobs/' + JOB + '/versions', { draw_state: BLANK });
check('a third is "Version 3"', v.body && v.body.name === 'Version 3', JSON.stringify(v.body));
const V3 = v.body.id;
// Renaming still works, and the list follows it.
v = await call('PUT', '/jobs/' + V3 + '/version-name', { name: 'Cheaper option' });
check('a version can be renamed', v.status === 200 && v.body.name === 'Cheaper option', v.text.slice(0, 120));
v = await call('GET', '/jobs/' + JOB + '/versions');
check('…and the group lists all three, the original first',
  v.body && v.body.versions.length === 3 && v.body.versions[0].is_root &&
  v.body.versions.map(x => x.name).join('|') === 'Original|Version 2|Cheaper option',
  JSON.stringify((v.body || {}).versions || []));

// ── (d) a fresh read is never the cached one ─────────────────────
await call('GET', '/quote-activity');                       // fills the cache
// A send that landed on ANOTHER server instance: the row changes under this
// one, whose cache has no idea and is not stale.
const live = db.jobs.find(j => String(j.id) === String(JOB));
live.draw_state.state.quote.share.token = 'tok-after';
let f1 = await call('GET', '/quote-activity');
let f2 = await call('GET', '/quote-activity?fresh=1');
check('the ordinary read may still hand back the cached feed (that is what it is for)',
  f1.status === 200 && (f1.body[0] || {}).token === 'tok3303', JSON.stringify((f1.body || [])[0] || null));
check('…and fresh=1 reads the database instead, so a just-sent quote is on the board',
  f2.status === 200 && (f2.body[0] || {}).token === 'tok-after', JSON.stringify((f2.body || [])[0] || null));

// ── the search, on the office's own screen ───────────────────────
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.route('**/api.mapbox.com/**', r => r.abort());
await ctx.route('**/flood-roofing-estimator-production.up.railway.app/**', async (route) => {
  const u = new URL(route.request().url());
  try {
    const resp = await route.fetch({ url: API + u.pathname + u.search });
    await route.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) });
  } catch (e) { await route.abort(); }
});
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.addInitScript((t) => {
  localStorage.setItem('fr_token', t); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_first_roof', 'never');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'office@floodroofing.co.nz', name: 'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'cccccccc-8888-4444-4444-444444444444', name: 'Flood Roofing', role: 'owner', plan: 'business' }));
}, TOK);
await pg.goto('file://' + DIR + '/app.html');
await sleep(3200);

const search = await pg.evaluate(async () => {
  try { document.getElementById('setupWizard')?.remove(); } catch(e){}
  gotoTab('select');
  await new Promise(r => setTimeout(r, 300));
  // The Fergus job the saved one is linked to, as the Fergus cache holds it.
  S.fergJobsCache = [{ id: 'F-3303', jobNo: '3303', customer: 'Dot Bolous', address: '23 Gilbert Mair Rise' },
                     { id: 'F-9999', jobNo: '9999', customer: 'Someone Else', address: '1 Other Road' }];
  S.fergConnected = false;
  window._selectJobsCache = null;
  const inp = document.getElementById('homeJobSearch');
  inp.value = '3303';
  _homeJobSearchInput();
  for (let i = 0; i < 40 && !(window._selectJobsCache || []).length; i++) await new Promise(r => setTimeout(r, 150));
  _hbPaintSearch('3303');
  await new Promise(r => setTimeout(r, 200));
  const drop = document.getElementById('homeJobSearchDrop');
  const rows = [...drop.querySelectorAll('.hb-drop-row')];
  return {
    cached: (window._selectJobsCache || []).length,
    heads: rows.filter(r => r.hasAttribute('data-job-head')).length,
    versions: rows.filter(r => r.hasAttribute('data-job-version')).length,
    fergus: rows.filter(r => /Fergus/.test((r.querySelector('.hb-drop-badge') || {}).textContent || '')).length,
    total: rows.length,
    ticks: [...drop.querySelectorAll('.hb-drop-tick')].map(t => t.textContent.trim()),
    headText: rows.length ? rows[0].textContent.replace(/\s+/g, ' ').trim() : '',
    verNames: rows.filter(r => r.hasAttribute('data-job-version')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
  };
});
check('the whole group is in the cache (three rows in the database)', search.cached === 3, JSON.stringify(search));
check('searching 3303 shows ONE job, not three',
  search.heads === 1 && search.fergus === 0, JSON.stringify(search));
check('…found by its FERGUS number, though its own number is 06121',
  /Dot Bolous/.test(search.headText) && /06121/.test(search.headText), search.headText);
check('…with a Fergus tick and a quote-sent tick on it',
  search.ticks.some(t => /Fergus/.test(t)) && search.ticks.some(t => /Quote sent/.test(t)),
  JSON.stringify(search.ticks));
check('…and its two other versions listed under it, named',
  search.versions === 2 && /Version 2/.test(search.verNames.join('|')) && /Cheaper option/.test(search.verNames.join('|')),
  JSON.stringify(search.verNames));

// A Fergus job nothing is linked to is still offered — this must not hide
// work that has not been started.
const unlinked = await pg.evaluate(async () => {
  const inp = document.getElementById('homeJobSearch');
  inp.value = '9999'; _hbPaintSearch('9999');
  await new Promise(r => setTimeout(r, 150));
  const drop = document.getElementById('homeJobSearchDrop');
  return [...drop.querySelectorAll('.hb-drop-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
});
check('a Fergus job nobody has started is still offered on its own',
  unlinked.length === 1 && /Someone Else/.test(unlinked[0]), JSON.stringify(unlinked));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
