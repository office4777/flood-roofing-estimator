// A trial that opens on an empty board has nothing to judge. This is the
// audit for the sample job that fills it — and for the rule that it never
// writes itself into somebody's account.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Served over HTTP so the sample's own fetch() works the way it will in
// production — file:// would block it.
const TYPES = { '.html':'text/html', '.json':'application/json', '.png':'image/png',
                '.jpg':'image/jpeg', '.js':'text/javascript', '.webmanifest':'application/manifest+json' };
const srv = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const buf = await readFile(DIR + (path === '/' ? '/app.html' : path));
    res.writeHead(200, {'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream'});
    res.end(buf);
  } catch(e){ res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

let posted = [];
async function open(jobs){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request(), u = q.url(), m = q.method();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/jobs/.test(u) && (m === 'POST' || m === 'PUT')){ posted.push({m, u, body:q.postDataJSON()}); return j({id:'new1'}); }
    if (/\/jobs$/.test(u)) return j(jobs || []);
    if (/\/settings/.test(u)) return j({ user_id:'u1',
      branding:{ company_name:'Acme Roofing Ltd', phone:'09 123 4567', email:'office@acmeroofing.co.nz' },
      quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam Tui' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' })); });
  await pg.goto(`http://127.0.0.1:${PORT}/app.html`);
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
  return { ctx, pg };
}

// ── the payload itself is a real, finished job ──
const demo = JSON.parse(await readFile(DIR + '/demo-job.json', 'utf8'));
check('the sample ships as a real job payload',
  !!demo.client_name && !!demo.site_address && !!demo.draw_state,
  demo.client_name + ' · ' + demo.site_address);
check('…with a measured roof on it',
  demo.draw_state.draw.lines.length > 8 && demo.draw_state.draw.scaleMetresPerPx > 0 &&
  demo.draw_state.draw.roofs.length === 1,
  demo.draw_state.draw.lines.length + ' lines, scale ' + demo.draw_state.draw.scaleMetresPerPx);
check('…that a roofer would recognise — ridge, hips, a valley and gutter',
  ['ridge','hip','valley','gutter'].every(t => demo.draw_state.draw.lines.some(l => l.type === t)),
  JSON.stringify(Array.from(new Set(demo.draw_state.draw.lines.map(l=>l.type)))));
check('…priced, not empty',
  demo.draw_state.state.labour > 0 && demo.draw_state.state.materials > 0,
  'labour $' + demo.draw_state.state.labour + ' materials $' + Math.round(demo.draw_state.state.materials));
check('…with a scope of work and a spec',
  /Strip/.test(demo.draw_state.state.quote.scope || '') &&
  demo.draw_state.form.matGrade === 'Colorsteel Maxam' && demo.draw_state.form.matColour === 'Ironsand',
  demo.draw_state.form.matGrade + ' ' + demo.draw_state.form.matThickness + ' ' + demo.draw_state.form.matColour);
check('…and carries nobody\'s photos or aerial imagery',
  (demo.draw_state.state.photos||[]).length === 0 && !demo.draw_state.state.img64);
check('…and is small enough to ship in the app shell',
  JSON.stringify(demo).length < 200 * 1024, Math.round(JSON.stringify(demo).length/1024) + ' KB');

// ── an empty board offers it ──
let { ctx, pg } = await open([]);
let v = await pg.evaluate(() => {
  const el = document.getElementById('sampleJobBanner');
  return { html: !!(el && el.innerHTML.trim()), txt: (el ? el.textContent : '').replace(/\s+/g,' ').trim() };
});
check('a business with no jobs is offered the sample', v.html, v.txt.slice(0, 80));
check('…and told it will not be saved to their account',
  /Nothing is saved to your account until you save it/i.test(v.txt), v.txt.slice(-90));

// ── opening it ──
await pg.click('#sampleJobBanner .sj-go');
await pg.waitForTimeout(2200);
let o = await pg.evaluate(() => ({
  flag: S.isSampleJob, jobId: S.currentJobId,
  lines: DRAW.lines.length, scale: DRAW.scaleMetresPerPx,
  client: (document.getElementById('jobClient')||{}).value,
  labour: S.labour, materials: S.materials,
  tab: (document.querySelector('.panel.active')||{}).id,
  strips: Array.from(document.querySelectorAll('[data-sample-strip]')).map(e => (e.textContent||'').trim().length),
}));
check('opening it loads the drawing', o.lines > 8 && o.scale > 0, o.lines + ' lines');
check('…and the client, the labour and the materials',
  o.client === 'M. & R. Whitiora' && o.labour > 0 && o.materials > 0,
  o.client + ' · $' + o.labour + ' + $' + Math.round(o.materials));
check('…lands on the roof plan, where the drawing is', o.tab === 'tab-roof', o.tab);
check('…is marked as the sample, with no job id to overwrite', o.flag === true && !o.jobId);
check('…and says so on every tab it is looked at on',
  o.strips.length >= 3 && o.strips.every(n => n > 20), JSON.stringify(o.strips));

// the quote renders under THEIR name, not ours
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(2000);
let q = await pg.evaluate(() => {
  const root = document.getElementById('qpRoot');
  const t = (root ? root.textContent : '').replace(/\s+/g,' ');
  return { txt: t.slice(0, 400), flood: /Flood Roofing/i.test(t), matthew: /Anderson-Smith/i.test(t),
           imgs: Array.from((root||document).querySelectorAll('img')).map(i => i.getAttribute('src')||'').filter(s => /^brand\//.test(s)) };
});
check('the sample quote carries the roofer\'s own name, not ours',
  !q.flood && /Acme Roofing/.test(q.txt), q.txt.slice(0, 110));
check('…and nobody else\'s salesperson', !q.matthew);
check('…and none of our fleet, crew or accreditation badges', q.imgs.length === 0, JSON.stringify(q.imgs));
await pg.locator('#qpRoot').screenshot({ path: S+'/sample_quote.png' });

// ── it never writes itself into their account ──
posted = [];
await pg.evaluate(() => { DRAW.rotation = (DRAW.rotation||0) + 90; });   // dirty it
await pg.waitForTimeout(2500);
let dirty = await pg.evaluate(() => _isJobDirty());
check('an open sample never counts as unsaved work', dirty === false);
check('…so nothing is posted to their account behind their back',
  posted.length === 0, JSON.stringify(posted.map(p => p.m + ' ' + p.u.split('/').pop())));
let idb = await pg.evaluate(async () => { try { return (await _listLocalDrafts()).length; } catch(e){ return -1; } });
check('…and no local draft of it is left on the device', idb === 0, String(idb));

// ── saving it deliberately makes it theirs ──
await pg.evaluate(() => { const c=document.getElementById('jobClient'); if(c) c.value='M. & R. Whitiora'; });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(1800);
let after = await pg.evaluate(() => ({ flag: S.isSampleJob,
  strips: Array.from(document.querySelectorAll('[data-sample-strip]')).map(e => (e.textContent||'').trim()) }));
check('saving it makes it an ordinary job of theirs', after.flag === false);
check('…and takes the sample banner off it', after.strips.every(t => t === ''));
check('…creating a NEW job rather than overwriting one',
  posted.length === 1 && posted[0].m === 'POST', JSON.stringify(posted.map(p=>p.m)));
await ctx.close();

// ── a business with its own work is not shown it ──
({ ctx, pg } = await open([{ id:'j1', client_name:'R. Ngata', site_address:'8 Rimu St',
                             updated_at:new Date().toISOString(), created_by:'Sam Tui' }]));
let busy = await pg.evaluate(() => {
  const el = document.getElementById('sampleJobBanner');
  return !!(el && el.innerHTML.trim());
});
check('a business that already has jobs is not shown the sample', busy === false);
await pg.screenshot({ path: S+'/home_with_jobs.png' });
await ctx.close();

// and the empty-board home, for the record
({ ctx, pg } = await open([]));
await pg.screenshot({ path: S+'/home_empty.png' });
await ctx.close();

await b.close(); srv.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
