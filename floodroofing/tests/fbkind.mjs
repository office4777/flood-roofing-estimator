// Send Feedback asks what kind of message this is, because the answer changes
// what RoofMap does with it.
//
// An integration fault is the case worth the extra machinery: choosing it
// fires the Fergus probe against the roofer's own connection at the same
// time as the report, so the ticket arrives already diagnosed instead of
// starting a round of "can you check a setting for me". The other two kinds
// must NOT probe — a general bug report has nothing to do with Fergus, and a
// feature request has nobody's API to test.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let feedback = null, diagnosed = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
  const u = r.request().url();
  if (/\/jms\/diagnose/.test(u)){
    diagnosed.push(r.request().postDataJSON());
    return r.fulfill({ status: 202, contentType: 'application/json', body: '{"queued":true}' });
  }
  if (/\/feedback/.test(u)){
    try { feedback = JSON.parse(r.request().postData() || '{}'); } catch(e){ feedback = {}; }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token', 't');
  localStorage.setItem('fr_setup_done', '1');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'bob@kauri.co.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Kauri Roofing Ltd',
    plan: 'team', limits: { seats: 5, jms: true, schedule: true, inbox: false } }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
  gotoTab('feedback');
});
await pg.waitForTimeout(500);

// ── the three choices, and which one starts selected ──────────────
const kinds = await pg.evaluate(() =>
  [].map.call(document.querySelectorAll('#fbKindRow .fb-kind'), b => ({
    kind: b.getAttribute('data-kind'), text: b.textContent.trim(), on: b.classList.contains('on') })));
check('the form asks what kind of message this is', kinds.length === 3, JSON.stringify(kinds.map(k => k.kind)));
check('…offering a general issue, an integration fault and a feature request',
  kinds.map(k => k.kind).join(',') === 'general,jms,feature', kinds.map(k => k.kind).join(','));
check('…in words a roofer would use, not ours',
  /general issue/i.test(kinds[0].text) && /job management/i.test(kinds[1].text) &&
  /feature/i.test(kinds[2].text), kinds.map(k => k.text).join(' | '));
check('…and a general issue is what you get without choosing',
  kinds[0].on && !kinds[1].on && !kinds[2].on, JSON.stringify(kinds.map(k => k.on)));

// ── choosing the integration says what will happen ────────────────
await pg.click('.fb-kind[data-kind="jms"]');
await pg.waitForTimeout(200);
const noted = await pg.evaluate(() => {
  const n = document.getElementById('fbKindNote');
  return { shown: !!n && getComputedStyle(n).display !== 'none', text: (n || {}).textContent || '',
    on: [].map.call(document.querySelectorAll('#fbKindRow .fb-kind'), b => b.classList.contains('on')) };
});
check('choosing the integration marks it', noted.on.join(',') === 'false,true,false', noted.on.join(','));
check('…and says the connection will be tested too, without asking them to look anything up',
  noted.shown && /test your job management software connection/i.test(noted.text), noted.text.slice(0, 90));
check('…and asks for the job number, which is what makes the probe useful',
  /job number/i.test(noted.text), noted.text.slice(0, 120));

// ── sending an integration fault probes as well ───────────────────
await pg.fill('#fbTitle', 'Photos missing on one job');
await pg.fill('#fbDetails', 'Job 3227 Amy Hunter shows no photos but they are in Fergus.');
await pg.click('#fbSubmitBtn');
await pg.waitForTimeout(2500);
check('the report was sent', !!feedback, JSON.stringify(feedback && feedback.title));
check('…and the connection was probed alongside it', diagnosed.length === 1, diagnosed.length + ' probes');
check('…carrying the job number, so the probe can ask about that job',
  /3227/.test((diagnosed[0] || {}).problem || ''), ((diagnosed[0] || {}).problem || '').slice(0, 70));
check('…and the subject says what it is, so the inbox sorts itself',
  /^\[Integration\]/.test(feedback.title || ''), feedback.title);

// ── the other two kinds do not go near Fergus ─────────────────────
diagnosed = []; feedback = null;
await pg.click('.fb-kind[data-kind="feature"]');
await pg.fill('#fbTitle', 'Let me copy a quote to another job');
await pg.fill('#fbDetails', 'We re-quote the same shed for different clients.');
await pg.click('#fbSubmitBtn');
await pg.waitForTimeout(2500);
check('a feature request is not probed', diagnosed.length === 0, diagnosed.length + ' probes');
check('…and is labelled as one', /^\[Feature request\]/.test((feedback || {}).title || ''), (feedback || {}).title);

diagnosed = []; feedback = null;
await pg.click('.fb-kind[data-kind="general"]');
await pg.fill('#fbTitle', 'Ridge line lands in the wrong place');
await pg.fill('#fbDetails', 'The hip does not meet the ridge on an L-shape.');
await pg.click('#fbSubmitBtn');
await pg.waitForTimeout(2500);
check('a general issue is not probed either', diagnosed.length === 0, diagnosed.length + ' probes');
check('…and carries no tag, because it is the ordinary case',
  !/^\[/.test((feedback || {}).title || ''), (feedback || {}).title);

check('no page errors anywhere in that', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
