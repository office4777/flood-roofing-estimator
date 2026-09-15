// The version switcher, in the app.
//
// "If Ethan and I were working on the same job, his would say Ethan's version,
// mine would say Aron's version, the selected-job card says which one it is,
// and there's a dropdown to switch — plus create new version, which duplicates
// the one on screen and opens it."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const JOBS = {
  'job-a': { id:'job-a', client_name:'Rangi Parata', site_address:'4 Kauri Rd', status:'draft',
             version_of:null, version_name:"Aron's version", draw_state:{ draw:{ lines:[] }, state:{} } },
  'job-b': { id:'job-b', client_name:'Rangi Parata', site_address:'4 Kauri Rd', status:'draft',
             version_of:'job-a', version_name:"Ethan's version", draw_state:{ draw:{ lines:[] }, state:{} } },
};
const GROUP = {
  root: 'job-a', current: 'job-a',
  versions: [
    { id:'job-a', name:"Aron's version",  is_root:true,  updated_at:'2026-09-15T20:00:00Z', created_by:'Aron' },
    { id:'job-b', name:"Ethan's version", is_root:false, updated_at:'2026-09-15T21:30:00Z', created_by:'Ethan' },
  ],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const posted = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
  const u = r.request().url(), m = r.request().method();
  const j = (status, x) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const mVer = u.match(/\/jobs\/([^/?]+)\/versions/);
  if (mVer && m === 'GET') return j(200, Object.assign({}, GROUP, { current: mVer[1] }));
  if (mVer && m === 'POST') {
    posted.push(mVer[1]);
    JOBS['job-c'] = { id:'job-c', client_name:'Rangi Parata', site_address:'4 Kauri Rd', status:'draft',
                      version_of:'job-a', version_name:"Aron's version 2", draw_state:{ draw:{ lines:[] }, state:{} } };
    GROUP.versions.push({ id:'job-c', name:"Aron's version 2", is_root:false, updated_at:'2026-09-15T22:00:00Z', created_by:'Aron' });
    return j(200, { id:'job-c', name:"Aron's version 2", root:'job-a' });
  }
  const mJob = u.match(/\/jobs\/([^/?]+)(\?|$)/);
  if (mJob && m === 'GET' && JOBS[mJob[1]]) return j(200, JOBS[mJob[1]]);
  if (m === 'GET' && /\/jobs(\?|$)/.test(u)) return j(200, Object.values(JOBS));
  if (m === 'PUT' || m === 'POST') return j(200, { id: (mJob && mJob[1]) || 'job-a' });
  return j(200, []);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'aron@floodroofing.co.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood', plan:'business', limits:{} })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2400);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display='none'; document.getElementById('selectJobModal').style.display='none'; } catch(e){}
});

// ── nothing to see on a job with one version ─────────────────────
check('a job that was never branched shows no version line',
  await pg.evaluate(() => document.getElementById('navJobVersion').style.display === 'none'));

// ── open Aron's version ──────────────────────────────────────────
await pg.evaluate(() => openJob('job-a'));
await pg.waitForTimeout(1400);
let v = await pg.evaluate(() => ({
  name: S.versionName, n: (S.versions || []).length,
  line: document.getElementById('navJobVersion').textContent,
  lineShown: document.getElementById('navJobVersion').style.display !== 'none',
  btn: document.getElementById('navVersionBtn').textContent,
  btnShown: document.getElementById('navVersionBtn').style.display !== 'none',
}));
check('opening a version names it on the selected-job card',
  v.lineShown && /Aron's version/.test(v.line), JSON.stringify(v));
check('…and the left menu carries a Version button saying which one',
  v.btnShown && /Version: Aron's version/.test(v.btn), v.btn);
check('…and the app knows about both versions', v.n === 2, String(v.n));

// ── the dropdown ─────────────────────────────────────────────────
await pg.click('#navVersionBtn');
await pg.waitForTimeout(250);
let menu = await pg.evaluate(() => {
  const m = document.getElementById('versionMenu');
  return { open: m.style.display === 'block', txt: m.textContent,
           rows: m.querySelectorAll('button[onclick^="_versionSwitch"]').length };
});
check('the Version button opens a list of the job\'s versions',
  menu.open && menu.rows === 2, JSON.stringify({ open: menu.open, rows: menu.rows }));
check('…naming each one and who made it',
  /Aron's version/.test(menu.txt) && /Ethan's version/.test(menu.txt) && /Ethan/.test(menu.txt));
check('…with the one on screen marked', /●\s*Aron's version/.test(menu.txt));
check('…and a way to make a new one', /Create new version/.test(menu.txt));

// ── switching ────────────────────────────────────────────────────
await pg.evaluate(() => _versionSwitch('job-b'));
await pg.waitForTimeout(1400);
v = await pg.evaluate(() => ({ id: S.currentJobId, name: S.versionName,
  line: document.getElementById('navJobVersion').textContent,
  menuOpen: document.getElementById('versionMenu').style.display === 'block' }));
check('picking another version opens it', v.id === 'job-b' && /Ethan's version/.test(v.line), JSON.stringify(v));
check('…and the menu closes behind it', v.menuOpen === false);

// ── creating one ─────────────────────────────────────────────────
await pg.evaluate(() => _versionCreate());
await pg.waitForTimeout(1800);
v = await pg.evaluate(() => ({ id: S.currentJobId, name: S.versionName, n: (S.versions || []).length,
  line: document.getElementById('navJobVersion').textContent }));
check('"Create new version" copies the one on screen', posted.length === 1 && posted[0] === 'job-b', posted.join(','));
check('…and opens it straight away, so you are working on the copy',
  v.id === 'job-c' && /Aron's version 2/.test(v.line), JSON.stringify(v));
check('…and the list grows', v.n === 3, String(v.n));

// ── and the same control inside Edit job details ─────────────────
await pg.evaluate(() => openJobDetailsModal('edit'));
await pg.waitForTimeout(400);
const det = await pg.evaluate(() => {
  const box = document.getElementById('jobDetailsVersion');
  return { shown: box.style.display !== 'none', txt: box.textContent,
           btn: !!document.getElementById('jobDetailsVersionBtn') };
});
check('Edit job details says which version is open', det.shown && /Aron's version 2/.test(det.txt), det.txt.slice(0, 80));
check('…how many there are', /3 versions/.test(det.txt), det.txt.slice(0, 80));
check('…and offers the same switcher', det.btn);
await pg.evaluate(() => { document.getElementById('jobDetailsVersionBtn').click(); });
await pg.waitForTimeout(250);
check('…which opens the same list',
  await pg.evaluate(() => document.getElementById('versionMenu').style.display === 'block'));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
