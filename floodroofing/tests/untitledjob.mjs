// Drawing before a job is selected makes an Untitled job that autosaves;
// the sidebar's selected job opens its details; a job can be linked to a
// Fergus job from there, which pulls the Fergus details across and keeps
// the drawing and the quote.
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
const calls = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
  const u = r.request().url(), m = r.request().method();
  if (/\/jobs$/.test(u) && m === 'POST'){
    const body = JSON.parse(r.request().postData() || '{}'); calls.push(['POST /jobs', body]);
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'j1', client_name: body.client_name, site_address: body.site_address, updated_at: '2026-09-07T00:00:00Z' }) });
  }
  if (/\/jobs\/j1$/.test(u) && m === 'PUT'){
    const body = JSON.parse(r.request().postData() || '{}'); calls.push(['PUT /jobs/j1', body]);
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'j1', client_name: body.client_name, site_address: body.site_address, updated_at: '2026-09-07T00:00:01Z' }) });
  }
  if (/\/jobs(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  if (/fergus/i.test(u)) return r.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
  localStorage.setItem('fr_settings', 'null'); localStorage.setItem('fr_jms_linked', '1');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'bob@kauri.co.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Kauri Roofing Ltd', plan: 'team', limits: { jms: true } }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none'; document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
  gotoTab('roof');
});

// ── draw first, name later ────────────────────────────────────────
let v = await pg.evaluate(() => ({ job: S.currentJobId, client: document.getElementById('jobClient').value }));
check('nothing selected to start with', !v.job && !v.client, JSON.stringify(v));
await pg.evaluate(() => {
  DRAW.outline = [[100,100],[500,100],[500,340]];
  _pushSnap(_captureSnapState());      // what every canvas edit does
});
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ job: S.currentJobId, client: document.getElementById('jobClient').value,
  nav: document.getElementById('navJobName').textContent.trim(), outline: DRAW.outline.length }));
const made = calls.find(c => c[0] === 'POST /jobs');
check('the first corner drawn with no job selected creates an Untitled job',
  !!made && made[1].client_name === 'Untitled', JSON.stringify(made && { client: made[1].client_name }));
check('…which becomes the selected job, with the drawing kept',
  v.job === 'j1' && v.client === 'Untitled' && /Untitled/.test(v.nav) && v.outline === 3, JSON.stringify(v));
await pg.evaluate(() => { DRAW.outline.push([100,340]); _pushSnap(_captureSnapState()); });
await pg.waitForTimeout(700);
check('…and only one job is created however much is drawn', calls.filter(c => c[0] === 'POST /jobs').length === 1,
  calls.filter(c => c[0] === 'POST /jobs').length + ' created');

// ── the sidebar's selected job opens its details ─────────────────
await pg.click('#navJobInfo');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  details: document.getElementById('jobDetailsModal').style.display,
  chooser: document.getElementById('selectJobModal').style.display,
  title: document.getElementById('jobDetailsTitle').textContent,
  ferg: document.getElementById('jobDetailsFergus').textContent,
  linkBtn: !!document.getElementById('jobDetailsFergusLink'),
}));
check('tapping the selected job in the sidebar opens its details, not the chooser',
  v.details === 'flex' && v.chooser !== 'flex' && /Edit job/.test(v.title), JSON.stringify(v));
check('…which says it is not a Fergus job yet, with a button to link one',
  /Not linked/.test(v.ferg) && v.linkBtn, v.ferg);

// ── link it to a Fergus job: details come across, the work stays ──
await pg.evaluate(() => {
  S.fergJobsCache = [{ id: 'f9', jobNo: '8801', customer: 'Brian Lewis', address: '148 Horeke Road, Okaihau', email: 'b@l.nz', phone: '021 555' }];
  if (!S.quote) S.quote = defaultQuote();
  S.quote.lineItems = [{ desc: 'Reroof', qty: 1, price: 12000 }];
});
await pg.click('#jobDetailsFergusLink');
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ chooser: document.getElementById('selectJobModal').style.display, mode: !!window._fergLinkMode }));
check('Link opens the Fergus picker in link mode', v.chooser === 'flex' && v.mode, JSON.stringify(v));
calls.length = 0;
await pg.evaluate(() => useFergusJobInModal('f9'));
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({
  linked: S.linkedJobId, no: S.linkedJobNo,
  client: document.getElementById('jobClient').value, addr: document.getElementById('jobAddr').value,
  email: document.getElementById('jobEmail').value,
  outline: DRAW.outline.length, lines: (S.quote.lineItems || []).length, ref: S.quote.ref,
  chooser: document.getElementById('selectJobModal').style.display,
  details: document.getElementById('jobDetailsModal').style.display,
  ferg: document.getElementById('jobDetailsFergus').textContent,
  job: S.currentJobId, mode: !!window._fergLinkMode,
}));
check('picking a Fergus job links it to the open job and pulls its details across',
  v.linked === 'f9' && v.no === '8801' && v.client === 'Brian Lewis' && /Horeke/.test(v.addr) && v.email === 'b@l.nz',
  JSON.stringify(v));
check('…keeping the drawing, the quote and the job itself',
  v.outline === 4 && v.lines === 1 && v.job === 'j1' && v.ref === '8801', JSON.stringify({ outline: v.outline, lines: v.lines, job: v.job, ref: v.ref }));
check('…the picker closes and the details reopen saying which Fergus job it is',
  v.chooser !== 'flex' && v.details === 'flex' && /Fergus job #8801/.test(v.ferg) && !v.mode, v.ferg);
const saved = calls.find(c => c[0] === 'PUT /jobs/j1');
check('…and the job is saved with the Fergus details', !!saved && saved[1].client_name === 'Brian Lewis', JSON.stringify(saved && saved[1].client_name));

// ── and unlinked again ────────────────────────────────────────────
await pg.evaluate(() => _fergusUnlink());
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ linked: S.linkedJobId, ferg: document.getElementById('jobDetailsFergus').textContent, outline: DRAW.outline.length }));
check('Unlink drops the Fergus link and keeps the work', !v.linked && /Not linked/.test(v.ferg) && v.outline === 4, JSON.stringify(v));
check('no page errors along the way', errs.length === 0, errs.join(' | '));

await ctx.close(); await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
