// A real 5xx from production: "canceling statement due to statement timeout"
// on /jobs/:id, hit by a roofer saving a job.
//
// GET had already been round this once — a job row runs to tens of MB once the
// aerial and site photos land in draw_state, and the PostgREST role carries
// Supabase's 8-second statement_timeout — so the read goes over a direct
// connection with no such ceiling. The WRITE never got the same treatment, and
// it was worse than the read: .select() with no columns handed the WHOLE row
// back, so every save shipped the aerial and every photo down the wire again
// for nothing. The two callers use the id, the labels and the timestamp.
//
// So: the write goes over the direct connection when there is one, the
// response names its columns, and draw_state never travels back.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const CO2 = 'dddddddd-1111-1111-1111-111111111111';
const U  = 'uuuuuuuu-0000-0000-0000-000000000001';
// A believable heavy row: this is the shape that times out.
const BIG = 'x'.repeat(200000);
const db = {
  __missing: [],
  jobs: [
    { id:'job-1', company_id:CO, user_id:U, client_name:'Nikki Barrett',
      site_address:'11 Morcom Lane', status:'draft', updated_at:'2026-08-18T19:50:26Z',
      draw_state:{ aerial: BIG, photos:[BIG], state:{ quote:{ ref:'3099' } } }, settings:{} },
    { id:'job-other', company_id:CO2, user_id:U, client_name:'Other Co',
      site_address:'elsewhere', status:'draft', draw_state:{}, settings:{} },
  ],
  company_users: [{ company_id:CO, user_id:U, role:'owner' }],
  profiles: [{ id:U, company_id:CO, name:'Ethan', email:'ethan@floodroofing.co.nz' }],
  subscriptions: [], user_settings: [], companies: [{ id:CO, name:'Flood Roofing' }],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34599';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;              // no direct pool → PostgREST path
const jwtLib = require('jsonwebtoken');
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const tok = jwtLib.sign({ id:U, email:'ethan@floodroofing.co.nz', cid:CO }, 'test-secret', { expiresIn:'1h' });

async function put(id, body){
  const r = await fetch('http://127.0.0.1:' + PORT + '/jobs/' + id, { method:'PUT',
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
    body: JSON.stringify(body) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch(e){}
  return { status: r.status, body: j, bytes: txt.length };
}

// ── the save itself still works ───────────────────────────────────
let r = await put('job-1', { client_name:'Nikki Barrett-Smith', draw_state:{ aerial:BIG, lines:[1,2,3] } });
check('a save still saves', r.status === 200, r.status + '');
check('…and actually changed the row',
  db.jobs[0].client_name === 'Nikki Barrett-Smith', db.jobs[0].client_name);
check('…including the drawing',
  JSON.stringify(db.jobs[0].draw_state.lines) === '[1,2,3]', JSON.stringify(db.jobs[0].draw_state.lines));
check('…and stamped when', !!db.jobs[0].updated_at && db.jobs[0].updated_at !== '2026-08-18T19:50:26Z');

// ── the response is light, which is the fix ───────────────────────
check('the reply carries what the app uses',
  r.body && r.body.id === 'job-1' && 'client_name' in r.body &&
  'site_address' in r.body && 'updated_at' in r.body, Object.keys(r.body||{}).join(','));
check('…and NOT the drawing it just sent up',
  r.body && !('draw_state' in r.body) && !('settings' in r.body),
  Object.keys(r.body||{}).join(','));
check('…so the reply is small, not megabytes',
  r.bytes < 2000, r.bytes + ' bytes for a ' + Math.round(BIG.length/1024) + 'KB row');

// ── ownership is unchanged ────────────────────────────────────────
r = await put('job-1', { client_name:'x', user_id:'someone-else', company_id:CO2, id:'hijack' });
check('a client cannot rewrite who owns a job',
  db.jobs[0].user_id === U && db.jobs[0].company_id === CO && db.jobs[0].id === 'job-1',
  db.jobs[0].user_id + ' / ' + db.jobs[0].company_id);

// ── and nothing else can be written either ────────────────────────
const before = JSON.stringify(db.jobs[0]);
r = await put('job-1', { created_at:'1999-01-01', nonsense_col:'boom', client_name:'Nikki' });
check('unknown columns are dropped rather than passed to SQL',
  r.status === 200 && !('nonsense_col' in db.jobs[0]) && db.jobs[0].created_at !== '1999-01-01',
  Object.keys(db.jobs[0]).join(','));
// "Nothing writable" means nothing but the timestamp the server adds itself.
r = await put('job-1', {});
check('an empty body is a 400, not a row touched for nothing',
  r.status === 400, r.status + ' ' + JSON.stringify(r.body));
r = await put('job-1', { nonsense_col:'boom', updated_at:'1999-01-01' });
check('…and so is a body with only junk and a timestamp it does not own',
  r.status === 400, r.status + ' ' + JSON.stringify(r.body));

// ── another company's job is still not yours ──────────────────────
r = await put('job-other', { client_name:'hijacked' });
check('another company\'s job cannot be written', r.status === 404 &&
  db.jobs[1].client_name === 'Other Co', r.status + ' / ' + db.jobs[1].client_name);
r = await put('no-such-job', { client_name:'x' });
check('a job that does not exist is a 404, not a 500', r.status === 404, r.status + '');

// ── the first save of a job is the same shape ─────────────────────
const rp = await fetch('http://127.0.0.1:' + PORT + '/jobs', { method:'POST',
  headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
  body: JSON.stringify({ client_name:'Brand New', site_address:'1 New Rd',
                         draw_state:{ aerial: BIG }, settings:{} }) });
const ptxt = await rp.text();
let pj = null; try { pj = JSON.parse(ptxt); } catch(e){}
check('creating a job returns the same light row', rp.status === 200 && pj && pj.id &&
  !('draw_state' in pj), Object.keys(pj||{}).join(','));
check('…small too, on a first save of a big drawing', ptxt.length < 2000, ptxt.length + ' bytes');

// ── two people on one job ─────────────────────────────────────────
// The office has the job open; someone opens it onsite; both save. Without
// this the last write wins and the other person's work is gone, silently.
// A save carries the updated_at it loaded with, and a row that has moved
// since is refused — a 409 that names what is there now — not overwritten.
const stamp = db.jobs[0].updated_at;
r = await put('job-1', { client_name:'From the office', base_updated_at: stamp });
check('a save that knows what it loaded goes through', r.status === 200, r.status + '');
const stamp2 = db.jobs[0].updated_at;
check('…and the row moves on', stamp2 && stamp2 !== stamp, stamp2);
r = await put('job-1', { client_name:'From the site, on a stale copy', base_updated_at: stamp });
check('THE FIX: a save from a stale copy is refused, not written over the top',
  r.status === 409, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
check('…in a way the app can act on', r.body && r.body.code === 'JOB_MOVED', JSON.stringify(r.body && r.body.code));
check('…naming the version that is there now',
  r.body && r.body.current && r.body.current.updated_at === stamp2 && r.body.current.client_name === 'From the office',
  JSON.stringify(r.body && r.body.current));
check('…and the row is untouched', db.jobs[0].client_name === 'From the office' && db.jobs[0].updated_at === stamp2,
  db.jobs[0].client_name);
r = await put('job-1', { client_name:'Forced over the top' });
check('a save that says nothing about what it loaded still saves, as it always did',
  r.status === 200 && db.jobs[0].client_name === 'Forced over the top', r.status + ' / ' + db.jobs[0].client_name);
r = await put('no-such-job', { client_name:'x', base_updated_at: stamp });
check('a stale save to a job that does not exist is still a 404, not a 409', r.status === 404, r.status + '');

// ── the photos it already has ─────────────────────────────────────
// Autosave used to ship the aerial and every site photo every couple of
// seconds, unchanged. A save may now leave them out and name them, and the
// server carries its own copy across — never a copy the client makes up.
db.jobs[0].draw_state = { state: { img64: 'AERIAL-ON-SERVER', photos: [{ src:'P1' }, { src:'P2' }], lines: [1] } };
r = await put('job-1', { draw_state: { state: { lines: [1, 2, 3] } }, draw_state_keep: ['img64', 'photos'] });
const st = db.jobs[0].draw_state && db.jobs[0].draw_state.state || {};
check('a save can leave the aerial and photos out', r.status === 200, r.status + '');
check('…and the row keeps the ones it had', st.img64 === 'AERIAL-ON-SERVER' && JSON.stringify(st.photos) === '[{"src":"P1"},{"src":"P2"}]',
  JSON.stringify(st).slice(0, 80));
check('…while the drawing that was sent is what landed', JSON.stringify(st.lines) === '[1,2,3]', JSON.stringify(st.lines));
r = await put('job-1', { draw_state: { state: { lines: [9], img64: 'NEW-AERIAL' } }, draw_state_keep: ['photos'] });
const st2 = db.jobs[0].draw_state.state;
check('naming only the photos keeps only the photos — a new aerial still lands',
  st2.img64 === 'NEW-AERIAL' && st2.photos.length === 2, JSON.stringify(st2).slice(0, 80));
r = await put('job-1', { draw_state: { state: { lines: [9] } }, draw_state_keep: ['photos', 'settings', 'user_id', '__proto__'] });
check('only the two named things can be kept — anything else in the list is ignored',
  r.status === 200 && db.jobs[0].user_id === U, r.status + ' / ' + db.jobs[0].user_id);
r = await put('job-1', { draw_state: { state: { lines: [9], photos: [] } } });
check('and a save that sends everything, as before, replaces everything, as before',
  JSON.stringify(db.jobs[0].draw_state.state.photos) === '[]', JSON.stringify(db.jobs[0].draw_state.state.photos));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
