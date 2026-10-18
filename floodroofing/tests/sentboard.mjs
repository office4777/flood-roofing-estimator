// A QUOTE JUST SENT MUST BE ON THE QUOTES SENT BOARD (the owner, 2026-10-18,
// job 3303: "i just sent a quote (job#3303) and it's not yet showing in the
// quotes sent which is annoying").
//
// Nothing stubbed between the two halves: the REAL server (in-process, on the
// fake PostgREST) with the office's own app pointed at it. The office builds a
// quote on a real job, sends it the real way (Email quote -> Send), then goes
// Home. The board's Quotes Sent column must carry it.
//
// Pinned at three depths, so a failure says WHERE it broke:
//   1. the server's /quote-activity feed carries the job, status 'sent';
//   2. the app's own feed (window._quoteActivityFeed) carries it after the
//      Home tab's refresh;
//   3. the Quotes Sent tile and its list show it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
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

const sent = [];
const relay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch(e){} res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const CO = 'cccccccc-7777-4444-4444-444444444444', U = 'aaaaaaaa-7777-4444-4444-444444444444';
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
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'Flood Roofing <office@floodroofing.co.nz>';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34873';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await sleep(700);
const API = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: 'office@floodroofing.co.nz', cid: CO, name: 'Aron' }, 'test-secret', { expiresIn: '2h' });
async function feed(){
  const r = await fetch(API + '/quote-activity', { headers: { authorization: 'Bearer ' + TOK } });
  if (!r.ok) return { http: r.status, rows: [] };
  return { http: 200, rows: await r.json() };
}

const b = await chromium.launch();
async function wire(ctx){
  await ctx.route('**/api.mapbox.com/**', r => r.abort());
  await ctx.route('**/flood-roofing-estimator-production.up.railway.app/**', async (route) => {
    const u = new URL(route.request().url());
    try {
      const resp = await route.fetch({ url: API + u.pathname + u.search });
      await route.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) });
    } catch (e) { await route.abort(); }
  });
}
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await wire(ctx);
const office = await ctx.newPage();
const errs = []; office.on('pageerror', e => errs.push(e.message));
office.on('dialog', d => d.accept());
await office.addInitScript((t) => {
  localStorage.setItem('fr_token', t); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_first_roof', 'never');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'office@floodroofing.co.nz', name: 'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'cccccccc-7777-4444-4444-444444444444', name: 'Flood Roofing', role: 'owner', plan: 'business' }));
}, TOK);
await office.goto('file://' + DIR + '/app.html');
await sleep(3500);

let v = await office.evaluate(async () => {
  try { document.getElementById('setupWizard')?.remove(); } catch(e){}
  S.settings.branding = Object.assign({}, S.settings.branding || {}, { company_name: 'Flood Roofing', phone: '0800 435 663', email: 'office@floodroofing.co.nz' });
  await saveSettings();
  gotoTab('quote');
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('jobClient', 'Dot Bolous'); set('jobAddr', '23 Gilbert Mair Rise'); set('jobNo', '3303'); set('jobEmail', 'customer@example.co.nz');
  S.quote = defaultQuote();
  S.quote.style = 'modern'; S.quote.gstRate = 15; S.quote.client = 'Dot Bolous'; S.quote.ref = '3303'; S.quote.email = 'customer@example.co.nz';
  S.quote.lineItems = [{ desc: 'Re-roof', qty: 1, unit: 18400, price: 18400, amount: 18400 }];
  try { recalcQuoteTotals(); } catch(e){}
  try { refreshQuoteProposal(); } catch(e){}
  const ok = await saveCurrentJob({ force: true });
  return { ok: ok !== false, id: S.currentJobId };
});
check('the job is saved to the server', v.ok && !!v.id, JSON.stringify(v));
const JOB = v.id;

// Nothing on the board before the send — so a pass below means the send put
// it there, not that the board shows every job it can find.
let f = await feed();
check('before the send the feed is empty (the job has no customer link yet)', f.http === 200 && f.rows.length === 0, JSON.stringify(f));

v = await office.evaluate(async () => {
  await openQuoteEmail(); await new Promise(r => setTimeout(r, 300));
  document.getElementById('quoteEmailTo').value = 'customer@example.co.nz';
  const su = document.getElementById('quoteEmailSubject'); if (su && !su.value) su.value = 'Your roofing quote 3303 — Flood Roofing';
  const bo = document.getElementById('quoteEmailBody'); if (bo && !/https?:/.test(bo.value)) bo.value = 'Hi Dot, here is your quote: ' + (_customerLinkString() || '');
  await _quoteEmailSendNow();
  for (let i = 0; i < 60 && !(S.quote.share && S.quote.share.sentAt && S.quote.versions && S.quote.versions.sent); i++) await new Promise(r => setTimeout(r, 250));
  try { await (window.__qSendTail || Promise.resolve()); } catch(e){}
  await new Promise(r => setTimeout(r, 1500));
  return { token: S.quote.share && S.quote.share.token, sentAt: S.quote.share && S.quote.share.sentAt,
           status: S.quote.share && S.quote.share.status, skipped: window.__qLinkSkipped || 0 };
});
check('the quote is sent the real way (Email quote → Send)',
  !!v.token && !!v.sentAt && sent.some(m => /customer@example\.co\.nz/.test(JSON.stringify(m.to || m))),
  JSON.stringify(v) + ' mails:' + sent.length);
const TOKEN = v.token;

// 1. THE SERVER'S ROW. The share the feed reads off is the one the send wrote.
const row = () => db.jobs.find(j => j.id === JOB);
let q = (row() || { draw_state: { state: { quote: {} } } }).draw_state.state.quote;
check('the SERVER holds the share with its token (the send published it)',
  !!(q.share && q.share.token) && q.share.token === TOKEN,
  JSON.stringify({ stored: q.share && q.share.token, screen: TOKEN }));
check('…and the stored share says it was sent', !!(q.share && q.share.sentAt), JSON.stringify((q.share || {})));

// 2. THE FEED. /quote-activity is what the board paints from.
f = await feed();
const fr = (f.rows || []).find(r => String(r.jobId) === String(JOB));
check('/quote-activity carries the job straight after the send', !!fr,
  'http ' + f.http + ' rows ' + (f.rows || []).length + ' ' + JSON.stringify((f.rows || []).map(r => [r.jobId, r.ref, r.status])));
check('…with status "sent" (what the Quotes Sent column filters on)',
  !!fr && (fr.status === 'sent' || fr.status === 'opened'), JSON.stringify(fr || null));

// 3. THE BOARD. Home's own refresh, then the tile and the list.
v = await office.evaluate(async (jobId) => {
  gotoTab('select');
  await new Promise(r => setTimeout(r, 400));
  await fetchQuoteActivity();
  _hbSelect('sent');
  await new Promise(r => setTimeout(r, 300));
  const tiles = [...document.querySelectorAll('#homeBoardTiles .hb-tile')].map(t => ({
    lbl: (t.querySelector('.hb-tile-lbl') || {}).textContent || '',
    num: (t.querySelector('.hb-tile-num') || {}).textContent || '' }));
  const tile = tiles.find(t => /Quotes Sent/i.test(t.lbl));
  const host = document.getElementById('homeBoard');
  return {
    feedLen: (window._quoteActivityFeed || []).length,
    feedHas: (window._quoteActivityFeed || []).some(x => String(x.jobId) === String(jobId)),
    feedErr: window._quoteActivityError || null,
    tileNum: tile ? tile.num : null,
    listText: host ? host.textContent.slice(0, 400) : '',
    rowOpens: !!(host && /openJob\(/.test(host.innerHTML)),
  };
}, JOB);
check('the app’s own feed carries it after Home’s refresh', v.feedHas, JSON.stringify(v));
check('the Quotes Sent tile counts it', v.tileNum === '1', JSON.stringify({ tile: v.tileNum }));
check('the Quotes Sent list names the client and the job', /Dot Bolous/.test(v.listText) && /3303/.test(v.listText), JSON.stringify(v.listText.slice(0, 200)));
check('…and the row opens the job', v.rowOpens, '');

// A SECOND SEND MUST NOT DROP IT OFF THE BOARD, and re-reading inside the
// server's 60s feed cache must still see it — the cache is marked stale by
// the write, never served past it.
v = await office.evaluate(async () => {
  gotoTab('quote');
  await new Promise(r => setTimeout(r, 400));
  await openQuoteEmail(); await new Promise(r => setTimeout(r, 300));
  document.getElementById('quoteEmailTo').value = 'customer@example.co.nz';
  const bo = document.getElementById('quoteEmailBody'); if (bo && !/https?:/.test(bo.value)) bo.value = 'Again: ' + (_customerLinkString() || '');
  const before = (S.quote.versions && S.quote.versions.sent && S.quote.versions.sent.id) || '';
  await _quoteEmailSendNow();
  for (let i = 0; i < 60 && ((S.quote.versions && S.quote.versions.sent && S.quote.versions.sent.id) || '') === before; i++) await new Promise(r => setTimeout(r, 250));
  try { await (window.__qSendTail || Promise.resolve()); } catch(e){}
  await new Promise(r => setTimeout(r, 1200));
  gotoTab('select');
  await new Promise(r => setTimeout(r, 300));
  await fetchQuoteActivity();
  _hbSelect('sent');
  await new Promise(r => setTimeout(r, 250));
  const host = document.getElementById('homeBoard');
  return { listText: host ? host.textContent.slice(0, 300) : '', feedLen: (window._quoteActivityFeed || []).length };
});
check('a second send leaves it on the board, once', /Dot Bolous/.test(v.listText) && v.feedLen === 1, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));

await b.close();
try { relay.close(); } catch(e){}
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
