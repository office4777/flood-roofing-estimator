// A ROOFER WHO HAS NEVER HEARD OF FERGUS (2026-11-05, the owner: "I don't think
// any of the trial users or any of the paying users have connected to Fergus
// ... make sure the app's optimized from their point of view with no
// connection to our job management software like Fergus ... run a big audit
// and do a lot of tests").
//
// End to end on the REAL server (fake PostgREST), as a trial business with no
// Fergus key: a new job, a roof, the Job Pack, Files & Photos, the quote with
// its photos, the Pricing drawer, the schedule, Settings, the send and the
// customer's acceptance. Nothing on the way may be a Fergus dead end, nothing
// may ask the server about Fergus, and the work the acceptance raises must not
// tell them to "Accept in Fergus". tests/nojms.mjs pins the html.no-jms switch
// itself; this is the whole journey.
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
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sent = [];
const relay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch(e){} res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const CO = 'cccccccc-6666-4444-4444-444444444444', U = 'aaaaaaaa-6666-4444-4444-444444444444';
const now = Date.now();
const { port, db } = await startFakePostgrest({
  __missing: [],
  companies: [{ id: CO, name: 'Kauri Roofing', plan: 'trial' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, email: 'kauri@example.co.nz', name: 'Jo Kauri' }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'trialing', plan: 'trial', trial_ends_at: new Date(now + 20*864e5).toISOString(),
    trial_roof_limit: 3, created_at: new Date(now - 2*864e5).toISOString() }],
  user_settings: [], jobs: [], invoices: [], usage_events: [], company_invites: [], job_revisions: [],
  trial_roofs: [], plan_roofs: [], job_files: [], job_messages: [], comms_tasks: [], schedule_rows: [], schedule_blocks: [], platform_state: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.GAS_RELAY_IS_PLATFORM = 'true';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34879';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await sleep(700);
const API = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: 'kauri@example.co.nz', cid: CO, name: 'Jo' }, 'test-secret', { expiresIn: '2h' });

const reqs = [];
const b = await chromium.launch();
async function wire(ctx){
  await ctx.route('**/api.mapbox.com/**', r => r.abort());
  await ctx.route('**/basemaps.linz.govt.nz/**', r => r.abort());
  await ctx.route('**/flood-roofing-estimator-production.up.railway.app/**', async (route) => {
    const u = new URL(route.request().url());
    reqs.push(route.request().method() + ' ' + u.pathname);
    try {
      const resp = await route.fetch({ url: API + u.pathname + u.search });
      await route.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) });
    } catch (e) { await route.abort(); }
  });
}
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await wire(ctx);
const pg = await ctx.newPage();
const errs = [], dialogs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
await pg.addInitScript((t) => {
  localStorage.setItem('fr_token', t); localStorage.setItem('fr_first_roof', 'never');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'kauri@example.co.nz', name: 'Jo' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'cccccccc-6666-4444-4444-444444444444', name: 'Kauri Roofing', role: 'owner', plan: 'trial' }));
}, TOK);
await pg.goto('file://' + DIR + '/app.html');
await sleep(3500);

// Every piece of visible text (and placeholder / tooltip) that says Fergus.
const fergusText = () => pg.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const hits = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { if (/fergus/i.test(n.nodeValue) && n.parentElement && vis(n.parentElement) && !n.parentElement.closest('#frHelpPanel')) hits.push(n.nodeValue.trim().slice(0, 90)); }
  document.querySelectorAll('[placeholder],[title]').forEach(el => { const t = (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('title') || ''); if (/fergus/i.test(t) && vis(el)) hits.push('[attr] ' + t.trim().slice(0, 90)); });
  return hits;
});

let v = await pg.evaluate(() => ({ noJms: document.documentElement.classList.contains('no-jms'), ph: document.getElementById('homeJobSearch').placeholder,
  chip: document.getElementById('navJobInfo').title }));
check('a business with no Fergus key runs in no-jms mode', v.noJms, JSON.stringify(v));
check('…the Home search promises saved jobs, not Fergus jobs', !/fergus/i.test(v.ph) && /saved jobs/.test(v.ph), v.ph);
check('…and the job chip\'s tooltip says nothing about linking Fergus', !/fergus/i.test(v.chip), v.chip);

// ── a new job ──
await pg.evaluate(() => { gotoTab('select'); });
await sleep(400);
await pg.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(e => /Create new job/.test(e.textContent) && e.offsetParent); x && x.click(); });
await sleep(1000);
v = await pg.evaluate(() => { const bx = document.getElementById('jobDetailsFergus'); return { shown: !!bx && getComputedStyle(bx).display !== 'none', txt: bx ? bx.textContent : '' }; });
check('the New job window carries no "Not linked to a Fergus job / Connect Fergus" box', !v.shown, JSON.stringify(v));
check('…and the job number comes from RoofMap\'s own counter', /^\d+$/.test(await pg.inputValue('#jobNo')), await pg.inputValue('#jobNo'));
await pg.fill('#jobClient', 'Sam Smith'); await pg.fill('#jobAddr', '12 Kamo Road, Whangarei'); await pg.fill('#jobEmail', 'sam@example.co.nz');
await pg.click('#jobDetailsPrimaryBtn'); await sleep(2000);

// ── a roof, saved ──
const job = await pg.evaluate(async () => {
  DRAW.scaleMetresPerPx = 0.04; DRAW.calPitch = 20;
  DRAW.outline = [[300,250],[750,250],[750,520],[300,520]]; DRAW.outlineDone = true; DRAW.lines = [];
  autoGenerateRoof('hip'); try { autoCalcLineMeasurements(); } catch(e){} try { _syncCurrentToRoof(); } catch(e){}
  setTool('select'); redrawAll();
  // two photos taken on site, in the PHOTOS panel
  const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d');
  x.fillStyle = '#c33'; x.fillRect(0, 0, 160, 90); const red = c.toDataURL('image/jpeg', .8);
  x.fillStyle = '#3c3'; x.fillRect(0, 0, 160, 90); const green = c.toDataURL('image/jpeg', .8);
  S.photos = [{ src: red, caption: 'Rusted ridge' }, { src: green, caption: 'Valley' }];
  try { _renderJobPhotosGrid(); } catch(e){}
  await saveCurrentJob(); await new Promise(r => setTimeout(r, 1200));
  return { id: S.currentJobId, ref: S.quote.ref };
});
check('the job saves with a roof and its own number', !!job.id && /^\d+$/.test(job.ref || ''), JSON.stringify(job));
check('the Map Roof tab says nothing about Fergus', (await fergusText()).length === 0, JSON.stringify(await fergusText()));

v = await pg.evaluate(() => { _fergusPanelOpen(true); return null; });
await sleep(900);
v = await pg.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('#jobPhotosGrid button')).filter(b => /Use in quote/.test(b.textContent));
  return { n: btn.length, panel: (document.getElementById('fergusRoofPanel') || {}).innerText || '' };
});
check('the PHOTOS panel holds the job\'s own photos, each with "Use in quote"', v.n === 2 && !/fergus/i.test(v.panel), JSON.stringify({ n: v.n, f: /fergus/i.test(v.panel) }));
v = await pg.evaluate(async () => {
  Array.from(document.querySelectorAll('#jobPhotosGrid button')).filter(b => /Use in quote/.test(b.textContent))[1].click();
  await new Promise(r => setTimeout(r, 600));
  const cp = (S.quote.condPhotos || [])[0];
  return { slot0: !!(cp && cp.src), other: !!((S.quote.condPhotos || [])[1] || {}).src };
});
check('…"Use in quote" puts it in the quote\'s first empty photo slot', v.slot0 && !v.other, JSON.stringify(v));
await pg.evaluate(() => { try { _fergusPanelClose(); } catch(e){} });

// ── Job Pack, Files & Photos, History ──
await pg.evaluate(() => gotoTab('materials')); await sleep(3500);
check('the Job Pack says nothing about Fergus', (await fergusText()).length === 0, JSON.stringify(await fergusText()));
await pg.evaluate(() => _jobFilesOpen()); await sleep(1500);
v = await fergusText();
check('Files & Photos has no Fergus section for a business without it', v.length === 0, JSON.stringify(v));
await pg.keyboard.press('Escape');
await pg.evaluate(() => { document.querySelectorAll('#jfModal,#jobFilesModal,[id^="jf"]').forEach(e => { if (e.style) e.style.display = 'none'; }); });

// ── the Quote ──
await pg.evaluate(async () => { gotoTab('quote'); await new Promise(r => setTimeout(r, 900)); try { _closePricingPanel(); } catch(e){} try { _setQuotePreviewMode('desk'); } catch(e){} refreshQuoteProposal(); });
await sleep(1200);
v = await pg.evaluate(() => {
  const empty = document.querySelector('#qpRoot .qp-cond-empty');
  const btns = empty ? Array.from(empty.querySelectorAll('button')).filter(b => getComputedStyle(b).display !== 'none').map(b => b.textContent.trim()) : [];
  return { btns, cover: (() => { const n = document.querySelector('#qpRoot .qd-cover-body .qb-cta-note'); return n ? Math.round(n.getBoundingClientRect().width) : -1; })() };
});
check('an empty quote photo slot leads with Upload from PC and offers this job\'s photos — no Fergus button', v.btns[0] === '⬆ Upload from PC' && v.btns.some(t => /this job's photos/.test(t)) && !v.btns.some(t => /fergus/i.test(t)), JSON.stringify(v.btns));
check('the quote\'s cover note is never squeezed to a word a line', v.cover >= 240, 'note width ' + v.cover);
check('the Quote tab says nothing about Fergus', (await fergusText()).length === 0, JSON.stringify(await fergusText()));
dialogs.length = 0;
v = await pg.evaluate(async () => {
  const b = Array.from(document.querySelectorAll('#qpRoot .qp-cond-empty button')).find(x => /this job's photos/.test(x.textContent));
  b.click(); await new Promise(r => setTimeout(r, 400));
  const m = document.getElementById('cpJobPhotoModal');
  const tiles = m ? m.querySelectorAll('[data-cp-job-i]').length : 0;
  if (m) m.querySelector('[data-cp-job-i="0"]').click();
  await new Promise(r => setTimeout(r, 700));
  return { tiles, filled: (S.quote.condPhotos || []).filter(c => c && c.src).length };
});
check('"From this job\'s photos" opens the job\'s photos and drops the one picked into the slot', v.tiles === 2 && v.filled === 2, JSON.stringify(v));
v = await pg.evaluate(async () => { _qpCondPhotoFromFergus(3); await new Promise(r => setTimeout(r, 300)); const m = !!document.getElementById('cpJobPhotoModal'); try { document.getElementById('cpJobPhotoModal').remove(); } catch(e){} return m; });
check('a shed / cover button that used to go to the Fergus picker opens the job\'s photos instead — never "Link a Fergus job first"', v && !dialogs.some(d => /fergus/i.test(d)), JSON.stringify(dialogs));
await pg.evaluate(() => { try { _openPricingPanel(); } catch(e){} }); await sleep(1500);
check('the Pricing drawer says nothing about Fergus', (await fergusText()).length === 0, JSON.stringify(await fergusText()));
await pg.evaluate(() => { try { _closePricingPanel(); } catch(e){} });
v = await pg.evaluate(() => { const t = document.querySelector('.slot-tab[data-tab="fergus"]'); return t ? getComputedStyle(t).display : 'none'; });
check('the photo picker\'s "From Fergus" tab is hidden', v === 'none', v);

// ── Schedule and Settings ──
v = await pg.evaluate(() => _schedFergusUrl({ job_ref: '8801' }));
check('a job number typed on the schedule board never becomes a Fergus link', v === '', v);
await pg.evaluate(() => gotoTab('settings')); await sleep(1200);
v = await pg.evaluate(() => { const c = document.getElementById('jmsBigLinkCard'); return { shown: !!c && getComputedStyle(c).display !== 'none', txt: c ? c.innerText : '' }; });
check('Settings offers Fergus as optional, saying RoofMap works on its own', v.shown && /optional/i.test(v.txt) && /works fully on its own/.test(v.txt), JSON.stringify(v));
await pg.evaluate(() => document.getElementById('jmsBigLinkHide').click()); await sleep(200);
v = await pg.evaluate(() => { _refreshJmsLinkUI(); const c = document.getElementById('jmsBigLinkCard'); return getComputedStyle(c).display; });
check('…and "I don\'t use job management software — hide this" puts it away for good', v === 'none', v);
v = await pg.evaluate(() => {
  localStorage.removeItem('fr_jms_card_hide');
  const co = JSON.parse(localStorage.getItem('fr_company')); const keep = JSON.stringify(co);
  co.limits = Object.assign({}, co.limits || {}, { jms: false }); localStorage.setItem('fr_company', JSON.stringify(co));
  _refreshJmsLinkUI(); const d = getComputedStyle(document.getElementById('jmsBigLinkCard')).display;
  localStorage.setItem('fr_company', keep); _refreshJmsLinkUI();
  return d;
});
check('…and a Measure or Trade business, whose plan has no Fergus, is never shown it', v === 'none', v);

// ── the help bot ──
v = await pg.evaluate(() => {
  const a = q => { const r = window._helpSearch(q); return r.best ? r.best.a : ''; };
  return { need: a('do i need fergus'), inv: a('how do i invoice'), flow: a('what is the normal workflow'), num: a('how do i number jobs'), cost: a('how much does roofmap cost') };
});
check('the help bot answers "do I need Fergus?" with no', /do not need|works on its own/i.test(v.need), v.need.slice(0, 120));
check('…says RoofMap does its own invoicing, not Fergus', /Settings → Invoicing/.test(v.inv) && !/handled in \*\*Fergus/.test(v.inv), v.inv.slice(0, 120));
check('…numbers jobs from Settings, not "FR-####"', /Next job number/.test(v.num), v.num.slice(0, 120));
check('…and no longer calls RoofMap "Flood Roofing\'s internal tool, no charge"', !/internal tool|no charge/i.test(v.cost) && /trial/.test(v.cost), v.cost.slice(0, 120));

// ── the send and the customer's acceptance ──
v = await pg.evaluate(async () => {
  S.settings.branding = Object.assign({}, S.settings.branding || {}, { company_name: 'Kauri Roofing', phone: '021 555 555', email: 'kauri@example.co.nz' });
  // the business has been set up (the first-send branding window is its own suite)
  localStorage.setItem('fr_setup_done', '1'); try { document.getElementById('setupWizard')?.remove(); } catch(e){}
  gotoTab('quote'); await new Promise(r => setTimeout(r, 500));
  await openQuoteEmail(); await new Promise(r => setTimeout(r, 600));
  const m = document.getElementById('quoteEmailModal');
  if (!m || getComputedStyle(m).display === 'none') return { open: false };
  document.getElementById('quoteEmailTo').value = 'sam@example.co.nz';
  await _quoteEmailSendNow();
  for (let i = 0; i < 60 && !(S.quote.share && S.quote.share.sentAt); i++) await new Promise(r => setTimeout(r, 250));
  try { await (window.__qSendTail || Promise.resolve()); } catch(e){}
  await new Promise(r => setTimeout(r, 1500));
  return { open: true, token: S.quote.share && S.quote.share.token, sentAt: S.quote.share && S.quote.share.sentAt, qa: (document.getElementById('qaMsg') || {}).textContent || '' };
});
check('the quote sends to the customer, with no Fergus step or warning after it', v.open && !!v.token && !!v.sentAt && !/fergus/i.test(v.qa) && sent.some(m => /sam@example/.test(JSON.stringify(m.to))), JSON.stringify(v));
const cctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await wire(cctx);
const c = await cctx.newPage(); c.on('pageerror', e => errs.push('customer: ' + e.message)); c.on('dialog', d => d.accept());
await c.goto('file://' + DIR + '/app.html?q=' + encodeURIComponent(v.token) + '&i=' + encodeURIComponent(job.id));
await c.waitForFunction(() => window.__CUSTOMER_MODE && document.querySelector('#qpRoot') && document.querySelector('#qpRoot').textContent.length > 200, null, { timeout: 30000 }).catch(() => {});
await sleep(1200);
v = await c.evaluate(() => (document.body.innerText.match(/fergus/ig) || []).length);
check('the customer\'s quote never mentions Fergus', v === 0, String(v));
await c.evaluate(async () => { const n = document.getElementById('qbAcceptName'), t = document.getElementById('qbAcceptTerms'); if (n) n.value = 'Sam Smith'; if (t) t.checked = true; try { await acceptQuoteDigitally(); } catch(e){} await new Promise(r => setTimeout(r, 3500)); });
await sleep(1500);
const jrow = db.jobs.find(j => j.id === job.id);
check('the customer accepts it', jrow && jrow.draw_state.state.quote.share.status === 'accepted', jrow && jrow.draw_state.state.quote.share.status);
check('…and the office is emailed the acceptance', sent.some(m => /Quote accepted/i.test(m.subject || '') && /kauri@example/.test(JSON.stringify(m.to))), sent.map(m => m.subject).join(' | '));
const tasks = db.comms_tasks.filter(t => t.job_id === job.id).map(t => t.title);
check('the tasks the acceptance raises never say "Accept in Fergus" or name Flood Roofing\'s staff',
  tasks.length >= 3 && !tasks.some(t => /fergus|tentative schedule|hand-over/i.test(t)), JSON.stringify(tasks));
check('…and the deposit task uses the business\'s own percentage', tasks.some(t => /^Send the 50% deposit invoice: Sam Smith/.test(t)) && db.comms_tasks.filter(t => t.job_id === job.id).every(t => !t.assignee_user_id), JSON.stringify(tasks));

// ── a business that DOES run Fergus keeps its buttons across a sign-in ──
v = await pg.evaluate(() => {
  const before = _jmsProvider();
  S.settings.jms_keys = Object.assign({}, S.settings.jms_keys || {}, { fergus: 'fergPAT_x' });
  const after = _jmsProvider();
  S.settings.jms_keys.fergus = '';
  return { before, after };
});
check('a company Fergus key brings Fergus back on a fresh device (the device flag is wiped at sign-in)', v.before === 'none' && v.after === 'fergus', JSON.stringify(v));

// ── nothing on the whole journey asked the server about Fergus ──
const fergReqs = reqs.filter(r => /fergus|\/jms\//i.test(r));
check('no request to a Fergus or JMS endpoint anywhere on the journey', fergReqs.length === 0, JSON.stringify(fergReqs));
// …and a business that picked Fergus but never saved a key asks once, not every 30 s
reqs.length = 0;
v = await pg.evaluate(async () => {
  localStorage.setItem('fr_jms', 'fergus');
  await testFergus(); await new Promise(r => setTimeout(r, 800));
  return { noKey: !!window.__fergNoKey };
});
const probes = reqs.filter(r => /fergus/i.test(r)).length;
check('a Fergus pick with no key saved stops at the server\'s "not connected": one request, no fallbacks, no polling', v.noKey && probes <= 2, probes + ' requests ' + JSON.stringify(v));
await pg.evaluate(() => localStorage.removeItem('fr_jms'));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
