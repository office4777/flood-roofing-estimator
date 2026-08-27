// The backups had no door.
//
// job_revisions has kept the 8 newest snapshots of every job since the
// multi-tenant migration — the whole drawing, written by a DB trigger — and
// GET/POST endpoints to list and restore them have existed the whole time.
// Nothing in the app has ever called them. A roofer whose roof map went blank
// had no way to reach the copy sitting in the database.
//
// The list deliberately never carries draw_state (a snapshot is multi-MB once
// photos are in it), which is right, but it means the app cannot tell a good
// snapshot from a blank one, and restoring blind over a live job is just a
// second way to lose a drawing. Hence a geometry-only route: outline, lines
// and roofs, no photos, small enough to fetch and draw before committing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO  = 'cccccccc-1111-1111-1111-111111111111';
const CO2 = 'dddddddd-1111-1111-1111-111111111111';
const U   = 'uuuuuuuu-0000-0000-0000-000000000001';
const PHOTO = 'x'.repeat(120000);            // what makes a snapshot heavy

const goodDraw = {
  outline: [[0,0],[10,0],[10,8],[0,8]],
  lines: [{ type:'ridge', pts:[[0,4],[10,4]], measM:10 }],
  roofs: [{ name:'MainRoof', outline:[[0,0],[10,0],[10,8],[0,8]], lines:[{type:'ridge'}] },
          { name:'Roof2',    outline:[[20,0],[26,0],[26,5],[20,5]], lines:[] }],
  penetrations: [{ kind:'pipe' }],
};
const blankDraw = { outline: [], lines: [], roofs: [], penetrations: [] };

const db = {
  __missing: [],
  jobs: [
    { id:'job-1', company_id:CO, user_id:U, client_name:'Hinekeia Reardon',
      site_address:'4 Hillcrest Road', status:'draft', updated_at:'2026-08-27T01:20:00Z',
      draw_state:{ draw: blankDraw, state:{ photos:[PHOTO] } }, settings:{} },
    { id:'job-other', company_id:CO2, user_id:U, client_name:'Other Co',
      site_address:'elsewhere', status:'draft', draw_state:{}, settings:{} },
  ],
  job_revisions: [
    { id:'rev-good', job_id:'job-1', company_id:CO, user_id:U, client_name:'Hinekeia Reardon',
      site_address:'4 Hillcrest Road', status:'draft', reason:'update',
      saved_at:'2026-08-27T00:40:00Z',
      draw_state:{ draw: goodDraw, state:{ photos:[PHOTO] } }, settings:{} },
    { id:'rev-blank', job_id:'job-1', company_id:CO, user_id:U, client_name:'Hinekeia Reardon',
      site_address:'4 Hillcrest Road', status:'draft', reason:'update',
      saved_at:'2026-08-27T01:14:00Z',
      draw_state:{ draw: blankDraw, state:{} }, settings:{} },
    { id:'rev-theirs', job_id:'job-other', company_id:CO2, user_id:U, client_name:'Other Co',
      site_address:'elsewhere', status:'draft', reason:'update',
      saved_at:'2026-08-26T10:00:00Z', draw_state:{ draw: goodDraw }, settings:{} },
  ],
  company_users: [{ company_id:CO, user_id:U, role:'owner' }],
  profiles: [{ id:U, company_id:CO, name:'Aron', email:'office@floodroofing.co.nz' }],
  subscriptions: [], user_settings: [], companies: [{ id:CO, name:'Flood Roofing' }],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34613';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const tok = jwtLib.sign({ id:U, email:'office@floodroofing.co.nz', cid:CO }, 'test-secret', { expiresIn:'1h' });

async function api(path, method){
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method: method || 'GET',
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok } });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch(e){}
  return { status: r.status, body: j, bytes: txt.length };
}

// ── the list ──────────────────────────────────────────────────────
let r = await api('/jobs/job-1/revisions');
check('a job lists its snapshots', r.status === 200 && Array.isArray(r.body) && r.body.length === 2,
  r.status + ' / ' + (Array.isArray(r.body) ? r.body.length : 'not an array'));
check('…newest first, so the most recent is the obvious pick',
  r.body[0] && r.body[0].id === 'rev-blank', r.body.map(x => x.id).join(', '));
check('…and the list stays light — no drawing, no photos',
  r.body.every(x => !('draw_state' in x)) && r.bytes < 2000,
  r.bytes + ' bytes');
check('…and shows only this company’s snapshots',
  !r.body.some(x => x.id === 'rev-theirs'), r.body.map(x => x.id).join(', '));

// ── the geometry, for looking before leaping ──────────────────────
r = await api('/jobs/job-1/revisions/rev-good/geometry');
check('a snapshot hands back its geometry', r.status === 200 && r.body && r.body.draw,
  r.status + '');
check('…the actual roofs, so it can be drawn before it is restored',
  r.body.draw.roofs && r.body.draw.roofs.length === 2 &&
  r.body.draw.outline.length === 4,
  JSON.stringify(r.body.summary));
check('…summarised, so a list can label it without fetching all of them',
  r.body.summary && r.body.summary.roofs === 2 && r.body.summary.outline === 4 &&
  r.body.summary.lines === 1 && r.body.summary.blank === false,
  JSON.stringify(r.body.summary));
check('…and WITHOUT dragging the photos back down the wire',
  !/x{1000}/.test(JSON.stringify(r.body)) && r.bytes < 4000,
  r.bytes + ' bytes for a row holding a ' + Math.round(PHOTO.length/1024) + 'KB photo');

// A blank snapshot must announce itself, or restoring the history is just
// another way to lose the roof.
r = await api('/jobs/job-1/revisions/rev-blank/geometry');
check('a blank snapshot says it is blank',
  r.status === 200 && r.body.summary && r.body.summary.blank === true &&
  r.body.summary.roofs === 0, JSON.stringify(r.body.summary));

// ── another company's snapshot is not reachable ───────────────────
r = await api('/jobs/job-1/revisions/rev-theirs/geometry');
check('a snapshot belonging to another job is not served', r.status === 404, r.status + '');
r = await api('/jobs/job-other/revisions/rev-theirs/geometry');
check('…nor one belonging to another company', r.status === 404, r.status + '');

// ── the restore ───────────────────────────────────────────────────
r = await api('/jobs/job-1/revisions/rev-good/restore', 'POST');
check('restoring a snapshot succeeds', r.status === 200 && r.body && r.body.ok, r.status + '');
const job = db.jobs.find(j => j.id === 'job-1');
check('…and the roof map is actually back on the job',
  job.draw_state && job.draw_state.draw && job.draw_state.draw.roofs.length === 2,
  JSON.stringify((job.draw_state.draw.roofs || []).map(x => x.name)));
check('…with the outline it had',
  job.draw_state.draw.outline.length === 4, JSON.stringify(job.draw_state.draw.outline));

r = await api('/jobs/job-other/revisions/rev-theirs/restore', 'POST');
check('a restore cannot reach across companies', r.status === 404, r.status + '');

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
