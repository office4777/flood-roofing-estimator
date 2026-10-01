// WHAT THE OFFICE SENDS IS EXACTLY WHAT THE CUSTOMER SEES — AND IS KEPT
// (the owner, 2026-10-02, after job 3288: "make sure whatever I send the
// quote, custom options, custom profiles, custom anything ... always carries
// through and is an exact copy of what the customer sees, always save the
// exact quote that gets sent, and always save the exact quote that gets
// accepted in the app job, and clearly mark the two").
//
// End to end, nothing stubbed between the two screens: the REAL server
// (in-process, on the fake PostgREST) with the office's app and the
// customer's page both pointed at it. The office builds a quote with every
// kind of customisation — an option of its own (Paint Roof) picked as the
// recommendation, a profile added for this job only, a grade hidden from this
// quote, a page taken out, its own title, description, exclusions and
// summary wording — saves it and sends it the real way (Email quote → Send).
// Then:
//   • the customer's page (?q=<token>, through GET /q/:token) shows the SAME
//     quote: the same sections, the same choices in each, the same picks and
//     recommendations, the same words, the same total — to the cent;
//   • the job keeps the quote exactly as sent (versions.sent, labelled), and
//     the total sent is the office's;
//   • the customer accepts: the job keeps the quote exactly as accepted
//     (versions.accepted, labelled), the sent copy is still there beside it,
//     and the office reopening the job sees both, marked, and the acceptance;
//   • an office screen still holding the pre-acceptance quote cannot write
//     over it (the job 3288 overwrite).
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

// mail goes to a fake relay
const sent = [];
const relay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch(e){} res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const CO = 'cccccccc-4444-4444-4444-444444444444', U = 'aaaaaaaa-4444-4444-4444-444444444444';
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
const PORT = process.env.TEST_PORT || '34851';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await sleep(700);
const API = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: 'office@floodroofing.co.nz', cid: CO, name: 'Aron' }, 'test-secret', { expiresIn: '2h' });

const b = await chromium.launch();
// Every call the app makes to the production API goes to THIS server instead.
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
const officeCtx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await wire(officeCtx);
const office = await officeCtx.newPage();
const errs = []; office.on('pageerror', e => errs.push('office: ' + e.message));
office.on('dialog', d => d.accept());
await office.addInitScript((t) => {
  localStorage.setItem('fr_token', t); localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_first_roof', 'never');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'office@floodroofing.co.nz', name: 'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'cccccccc-4444-4444-4444-444444444444', name: 'Flood Roofing', role: 'owner', plan: 'business' }));
}, TOK);
await office.goto('file://' + DIR + '/app.html');
await sleep(3500);

// The products of this company: the defaults plus an option of its own.
let v = await office.evaluate(async () => {
  S.settings.branding = Object.assign({}, S.settings.branding || {}, { company_name: 'Flood Roofing', phone: '0800 435 663', email: 'office@floodroofing.co.nz' });
  const sel = JSON.parse(JSON.stringify(_defaultSelectables()));
  sel.extras = [{ id: 'paintroof', title: 'Paint Roof', rows: [
    { id: 'excl', name: 'Exclude', desc: '', price: 0 },
    { id: 'incl', name: 'Include', desc: 'Paint roof with roof paint using an airless sprayer', price: 3200 } ] }];
  S.settings.selectables = sel;
  try { document.getElementById('setupWizard')?.remove(); } catch(e){}
  await saveSettings();
  return { saved: true, live: !!window.__settingsLive };
});
check('the office’s products (with its own Paint Roof option) are saved to the server', v.saved, JSON.stringify(v));

// A quote with every kind of customisation, on a real job.
v = await office.evaluate(async () => {
  gotoTab('quote');
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('jobClient', 'Miria Lovey Henry'); set('jobAddr', '72 Fairlie Crescent, Opononi'); set('jobNo', '3288'); set('jobEmail', 'customer@example.co.nz');
  S.quote = defaultQuote();
  const q = S.quote;
  q.style = 'modern'; q.gstRate = 15; q.client = 'Miria Lovey Henry'; q.ref = '3288'; q.email = 'customer@example.co.nz';
  q.lineItems = [{ desc: 'Re-screw and seal', qty: 1, unit: 2925.61, price: 2925.61, amount: 2925.61 }];
  q.proposalTitle = 'Re-Screw & Optional Painting Proposal';
  q.custDesc = ['Remove existing Roofing Nails', 'Supply & install new Roofing Screws', 'Paint Roofing (unless deselected below)'];
  q.custExcl = ['Spouting'];
  q.customProfiles = [{ id: 'trimrib7', name: 'Trimrib 7 (this job only)', pct: 4 }];
  // an option made on THIS quote (Insert custom option, 2026-10-02)
  q.customExtras = [{ id: 'qxguard', title: 'Gutter guard', custom: true, rows: [
    { id: 'r1', name: 'Not included', desc: '', price: 0 },
    { id: 'r2', name: 'Fit gutter guard', desc: 'Supply & fit gutter guard to every gutter', price: 640 } ] }];
  const g2 = (_selGrades().find(g => g.id !== _selBaseGradeId()) || {}).id;
  q.selHide = { grades: { zincalume: true } };
  q.modernParked = ['disposal'];
  q.summaryBaseLabel = 'Re-screw & paint — main scope of work';
  q.summaryPicks = [{ k: 'grade', label: '', value: '' }, { label: 'Fixings', value: 'New roofing screws' }];
  q.proposalOptions = { steelGrade: g2 || 'maxam', profile: 'corrugate', steelThickness: '40', extras: { paintroof: 'incl', qxguard: 'r2' } };
  try { recalcQuoteTotals(); } catch(e){}
  try { refreshQuoteProposal(); } catch(e){}
  const ok = await saveCurrentJob({ force: true });
  return { ok: ok !== false, id: S.currentJobId };
});
check('the job is saved to the server', v.ok && !!v.id, JSON.stringify(v));
const JOB = v.id;

// What the office is looking at, in the customer's own terms.
const SNAP = () => {
  const keys = (_qdSections() || []).map(s => s.key).filter(k => k !== 'condition' || _qbHasCondition());
  return {
    sections: keys,
    total: Math.round(_custBarTotalValue() * 100) / 100,
    rows: _custBarRows().map(r => r.kind + ':' + r.label + '=' + r.value),
    picks: _qbPicks().map(p => p[0] + '=' + p[1]),
    extras: _selExtras().map(g => g.id + ':' + g.title + '[' + g.rows.map(r => r.id + '/' + r.name + '/' + r.price).join(',') + ']'),
    extraPick: (_selExtras()[0] && (_selExtraPick(_selExtras()[0]) || {}).id) || null,
    extraRec: (_selExtras()[0] && _qbExtraRec(_selExtras()[0])) || null,
    grades: _selGrades().map(g => g.id), profiles: _selProfiles().map(p => p.id),
    title: _qbProposalTitle(),
    desc: _qbInclusionLines ? _qbInclusionLines().map(String) : [],
    excl: _qbExclusionLines ? _qbExclusionLines().map(String) : [],
  };
};
// Send it the real way: Email quote → Send email now.
v = await office.evaluate(async () => {
  await openQuoteEmail(); await new Promise(r => setTimeout(r, 300));
  document.getElementById('quoteEmailTo').value = 'customer@example.co.nz';
  const su = document.getElementById('quoteEmailSubject'); if (su && !su.value) su.value = 'Your roofing quote 3288 — Flood Roofing';
  const bo = document.getElementById('quoteEmailBody'); if (bo && !/https?:/.test(bo.value)) bo.value = 'Hi Miria, here is your quote: ' + (_customerLinkString() || '');
  await _quoteEmailSendNow();
  for (let i = 0; i < 60 && !(S.quote.share && S.quote.share.sentAt && S.quote.versions && S.quote.versions.sent); i++) await new Promise(r => setTimeout(r, 250));
  try { await (window.__qSendTail || Promise.resolve()); } catch(e){}
  await new Promise(r => setTimeout(r, 1500));
  return { token: S.quote.share && S.quote.share.token, sentAt: S.quote.share && S.quote.share.sentAt,
           status: (document.getElementById('quoteEmailStatus') || {}).textContent || '', qa: (document.getElementById('qaMsg') || {}).textContent || '' };
});
const TOKEN = v.token;
check('the quote is sent the real way (Email quote → Send)', !!TOKEN && !!v.sentAt && sent.some(m => /customer@example\.co\.nz/.test(JSON.stringify(m.to || m))), JSON.stringify(v) + ' mails:' + sent.length);
// back to the working draft (the send may leave the Sent version on screen)
const officeSent = await office.evaluate(new Function('return (' + SNAP.toString() + ')()'));

// The job, as the server holds it.
const row = () => db.jobs.find(j => j.id === JOB);
let q = row().draw_state.state.quote;
check('the job keeps the quote EXACTLY as sent — versions.sent, labelled "Sent quote", with the sent total',
  q.versions && q.versions.sent && /Sent/i.test(q.versions.sent.label || '') && Math.abs((q.versions.sent.total || 0) - officeSent.total) < 0.01,
  JSON.stringify({ label: q.versions && q.versions.sent && q.versions.sent.label, total: q.versions && q.versions.sent && q.versions.sent.total, office: officeSent.total }));
check('…and the total sent to the customer is the office’s total, to the cent', Math.abs(q.share.sentTotal - officeSent.total) < 0.01, q.share.sentTotal + ' vs ' + officeSent.total);
check('…with every customisation inside it: the option, the job’s own profile, the hide, the page taken out, the words',
  (q.selectablesSnapshot.extras || []).some(g => g.id === 'paintroof') && (q.customProfiles || []).some(p => p.id === 'trimrib7') &&
  q.selHide && q.selHide.grades && q.selHide.grades.zincalume && (q.modernParked || []).includes('disposal') && q.proposalTitle && q.custDesc.length === 3 && q.summaryPicks.length === 2,
  JSON.stringify({ extras: (q.selectablesSnapshot.extras || []).map(g => g.id) }));

// SENT AGAIN (2026-10-02, the owner's: "I just sent another quote and it has
// overwritten the previous ... it should show both sent quotes separately"):
// the second send is kept beside the first, never over it.
const firstSentId = q.versions.sent.id, firstSentAt = q.versions.sent.at;
await sleep(1100);
v = await office.evaluate(async () => {
  await openQuoteEmail(); await new Promise(r => setTimeout(r, 300));
  document.getElementById('quoteEmailTo').value = 'customer@example.co.nz';
  const su = document.getElementById('quoteEmailSubject'); if (su && !su.value) su.value = 'Your roofing quote 3288 — Flood Roofing';
  const bo = document.getElementById('quoteEmailBody'); if (bo && !/https?:/.test(bo.value)) bo.value = 'Hi Miria, here is your quote again: ' + (_customerLinkString() || '');
  const before = S.quote.versions.sent.id;
  await _quoteEmailSendNow();
  for (let i = 0; i < 60 && S.quote.versions.sent.id === before; i++) await new Promise(r => setTimeout(r, 250));
  try { await (window.__qSendTail || Promise.resolve()); } catch(e){}
  await new Promise(r => setTimeout(r, 1500));
  const menu = document.getElementById('qvViewingMenu');
  return { items: menu ? [...menu.querySelectorAll('button')].map(x => x.textContent.trim()) : [] };
});
q = row().draw_state.state.quote;
check('a second send is KEPT BESIDE the first: the latest is the Sent quote, the first is still there whole',
  q.versions.sent.id !== firstSentId && Array.isArray(q.versions.sentEarlier) && q.versions.sentEarlier.length === 1 &&
  q.versions.sentEarlier[0].id === firstSentId && q.versions.sentEarlier[0].at === firstSentAt && !!q.versions.sentEarlier[0].quote,
  JSON.stringify({ sent: q.versions.sent.id, first: firstSentId, earlier: (q.versions.sentEarlier || []).map(d => d.id) }));
check('…and the Viewing menu lists both, numbered, the latest marked',
  v.items.some(t => /^(✓ )?Sent quote 2 · latest/.test(t)) && v.items.some(t => /^(✓ )?Sent quote 1/.test(t)), JSON.stringify(v.items));
v = await office.evaluate(async (id) => {
  _qvView('sent', id); await new Promise(r => setTimeout(r, 400));
  const t = Math.round(_custBarTotalValue() * 100) / 100, st = (document.querySelector('.qv-status') || {}).textContent || '';
  _qvBackToDraft(); await new Promise(r => setTimeout(r, 300));
  return { t, st };
}, firstSentId);
check('…the first send opens on its own, read only, saying the link shows the latest',
  v.t === officeSent.total && /earlier send/.test(v.st), JSON.stringify(v));

// ── the customer's page ──────────────────────────────────────────
const custCtx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await wire(custCtx);
const cust = await custCtx.newPage();
cust.on('pageerror', e => errs.push('customer: ' + e.message));
cust.on('dialog', d => d.accept());
await cust.goto('file://' + DIR + '/app.html?q=' + encodeURIComponent(TOKEN) + '&i=' + encodeURIComponent(JOB));
await cust.waitForFunction(() => window.__CUSTOMER_MODE && document.querySelector('#qpRoot') && document.querySelector('#qpRoot').textContent.length > 200, null, { timeout: 30000 }).catch(() => {});
await sleep(1500);
const custSaw = await cust.evaluate(new Function('return (' + SNAP.toString() + ')()'));
const same = (k) => JSON.stringify(officeSent[k]) === JSON.stringify(custSaw[k]);
check('the customer sees the same sections as the office sent', same('sections'), JSON.stringify({ office: officeSent.sections, customer: custSaw.sections }));
check('…the same office options (Paint Roof, and the quote’s own Gutter guard), with the same choices and prices', same('extras') && custSaw.extras.length === 2 && custSaw.extras.some(x => /^qxguard:Gutter guard/.test(x)), JSON.stringify({ office: officeSent.extras, customer: custSaw.extras }));
check('…on the same pick, recommended the same', same('extraPick') && same('extraRec') && custSaw.extraPick === 'incl' && custSaw.extraRec === 'incl', JSON.stringify({ o: [officeSent.extraPick, officeSent.extraRec], c: [custSaw.extraPick, custSaw.extraRec] }));
check('…the same grades (the hidden one hidden) and profiles (the job’s own one there)',
  same('grades') && same('profiles') && !custSaw.grades.includes('zincalume') && custSaw.profiles.includes('trimrib7'), JSON.stringify({ o: [officeSent.grades, officeSent.profiles], c: [custSaw.grades, custSaw.profiles] }));
check('…the same title, description and exclusions', same('title') && same('desc') && same('excl'), JSON.stringify({ o: officeSent.title, c: custSaw.title }));
check('…What’s included carries the picked options’ own words (Paint Roof, Gutter guard)',
  custSaw.desc.includes('Paint roof with roof paint using an airless sprayer') && custSaw.desc.includes('Supply & fit gutter guard to every gutter'), JSON.stringify(custSaw.desc));
check('…the same summary, line for line, and the same picks', same('rows') && same('picks'), JSON.stringify({ o: officeSent.rows, c: custSaw.rows }));
check('…and the same total, to the cent', officeSent.total === custSaw.total, officeSent.total + ' vs ' + custSaw.total);

// The customer accepts — as the office sent it.
v = await cust.evaluate(async () => {
  const n = document.getElementById('qbAcceptName'), t = document.getElementById('qbAcceptTerms');
  if (n) n.value = 'Miria Lovey Henry'; if (t) t.checked = true;
  try { await acceptQuoteDigitally(); } catch(e){ return { err: e.message }; }
  await new Promise(r => setTimeout(r, 3000));
  return { ok: true };
});
q = row().draw_state.state.quote;
check('the customer’s acceptance lands on the job: accepted, by name, at the total they saw',
  q.share.status === 'accepted' && q.accepted && /Miria/.test(q.accepted.name) && Math.abs((+q.accepted.total || 0) - custSaw.total) < 0.01,
  JSON.stringify({ st: q.share.status, acc: q.accepted && { name: q.accepted.name, total: q.accepted.total } }));
check('…with the quote’s own option accepted as picked (Gutter guard)', ((q.proposalOptions || {}).extras || {}).qxguard === 'r2', JSON.stringify((q.proposalOptions || {}).extras));
check('the job keeps the quote EXACTLY as accepted — versions.accepted, labelled "Accepted quote" — beside the sent one',
  q.versions && q.versions.accepted && /Accepted/i.test(q.versions.accepted.label || '') && q.versions.sent &&
  ((q.versions.accepted.quote || {}).proposalOptions || {}).extras && q.versions.accepted.quote.proposalOptions.extras.paintroof === 'incl',
  JSON.stringify({ acc: q.versions && q.versions.accepted && q.versions.accepted.label, sent: !!(q.versions && q.versions.sent) }));

// An office screen still holding the pre-acceptance quote saves: it cannot wipe the acceptance.
v = await office.evaluate(async () => {
  try { S.quote.lineItems[0].price = 2999; } catch(e){}
  let r = null; try { r = await _publishQuoteOnly(); } catch(e){ r = { err: e.message }; }
  await new Promise(r2 => setTimeout(r2, 500));
  return { notice: !!document.getElementById('keptAccBar') };
});
q = row().draw_state.state.quote;
check('an office screen that had not seen the acceptance saves — the acceptance is kept, and the office is told',
  q.share.status === 'accepted' && q.accepted && q.versions.accepted && v.notice, JSON.stringify({ st: q.share.status, notice: v.notice }));

// The office reopens the job: both copies, clearly marked, and the acceptance.
v = await office.evaluate(async (id) => {
  try { document.getElementById('keptAccBar')?.remove(); } catch(e){}
  S._jobLoaded = null; await openJob(id, { quiet: true });
  gotoTab('quote'); await new Promise(r => setTimeout(r, 800));
  const menu = document.getElementById('qvViewingMenu');
  const items = menu ? [...menu.querySelectorAll('button')].map(x => x.textContent.trim()) : [];
  const status = (document.querySelector('.qv-status') || {}).textContent || '';
  _qvView('accepted'); await new Promise(r => setTimeout(r, 500));
  const accTotal = Math.round(_custBarTotalValue() * 100) / 100;
  const accPick = (_selExtraPick(_selExtras()[0]) || {}).id;
  _qvView('sent'); await new Promise(r => setTimeout(r, 500));
  const sentTotal = Math.round(_custBarTotalValue() * 100) / 100;
  return { items, status, accTotal, accPick, sentTotal };
}, JOB);
check('the office’s Viewing menu marks both: "Sent quote" and "Accepted quote"',
  v.items.some(t => /^Sent quote/.test(t)) && v.items.some(t => /^Accepted quote/.test(t)), JSON.stringify(v.items));
check('…the Accepted quote reads exactly what the customer accepted (total and their pick)',
  v.accTotal === custSaw.total && v.accPick === 'incl', JSON.stringify(v));
check('…and the Sent quote exactly what went out', v.sentTotal === officeSent.total, JSON.stringify(v));
check('nothing threw on either screen', errs.length === 0, errs.join(' | ').slice(0, 400));
await b.close(); relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
