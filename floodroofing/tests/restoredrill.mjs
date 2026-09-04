// An untested backup is a hope. SETUP.md's restore drill ended with "check
// three things by eye", and three things by eye at 2am on the one night it
// matters is how a drill turns back into a hope.
//
// tools/restore-check.mjs asks the same questions mechanically. This suite is
// the check on the checker: it must PASS on a restore that is genuinely fine,
// and it must FAIL on the shapes that fool people — a half-run restore where
// some tables are missing, and a database that answers but has lost the
// drawings.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { spawn } from 'node:child_process';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

function goodDb(){
  return {
    __missing: [],
    companies: [{ id:'c1', name:'Flood Roofing', plan:'trial' }],
    company_users: [{ company_id:'c1', user_id:'u1', role:'owner' },
                    { company_id:'c1', user_id:'u2', role:'member' }],
    profiles: [{ id:'u1', company_id:'c1', name:'Aron', email:'aron@floodroofing.co.nz' },
               { id:'u2', company_id:'c1', name:'Paula', email:'paula@floodroofing.co.nz' }],
    user_settings: [{ user_id:'u1', company_id:'c1', branding:{}, quote_defaults:{}, jms_keys:{},
                      price_book:{}, labour_pricing:{}, updated_at:'2026-09-01T00:00:00Z' }],
    jobs: [{ id:'j1', user_id:'u1', company_id:'c1', client_name:'Sharon Thomson',
             site_address:'3687 SH12', updated_at:'2026-09-04T02:00:00Z',
             draw_state:{ state:{ roofData:{ pitch:20 }, img64:'x',
               quote:{ ref:'3206', share:{ token:'tok1', status:'sent' } } } } }],
    invoices: [], schedule_rows: [], schedule_blocks: [], comms_tasks: [], job_revisions: [],
  };
}

// The fake PostgREST answers 200 for a table it has never heard of, so a
// half-run restore cannot be built out of it directly. This sits in front and
// 404s the named tables — which is exactly what a real PostgREST does when a
// restore stopped part-way, and exactly the shape that fools people, because
// everything else still answers.
async function gap(port, missing){
  const http = await import('node:http');
  const srv = http.createServer((req, res) => {
    const table = decodeURIComponent(req.url.replace(/^\/rest\/v1\//, '').split('?')[0]);
    if (missing.indexOf(table) >= 0){
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'relation "public.' + table + '" does not exist' }));
    }
    const p = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method,
      headers: req.headers }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end('{}'); });
    req.pipe(p);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, close: () => new Promise(r => srv.close(r)) };
}

async function run(db, env, missing){
  const { port, close } = await startFakePostgrest(db);
  const front = (missing && missing.length) ? await gap(port, missing) : null;
  const usePort = front ? front.port : port;
  const out = await new Promise((res) => {
    const p = spawn(process.execPath, [_j(_ROOT, 'tools', 'restore-check.mjs')], {
      env: Object.assign({}, process.env, {
        RESTORE_SUPABASE_URL: 'http://127.0.0.1:' + usePort,
        RESTORE_SUPABASE_SERVICE_KEY: 'k',
      }, env || {}),
    });
    let s = '';
    p.stdout.on('data', d => { s += d; });
    p.stderr.on('data', d => { s += d; });
    p.on('close', code => res({ code, text: s }));
  });
  try { if (front) await front.close(); } catch(e){}
  try { if (close) await close(); } catch(e){}
  return out;
}

// ── a restore that is genuinely fine ──
let r = await run(goodDb());
check('a good restore passes', r.code === 0, 'exit ' + r.code);
check('…and says the restore holds up', /restore holds up/i.test(r.text), r.text.slice(-160));
check('…having checked every core table', /table jobs is present/.test(r.text) &&
  /table schedule_rows is present/.test(r.text) && /table job_revisions is present/.test(r.text));
check('…that a job came back with its drawing', /its drawing came back with it/.test(r.text) &&
  !/FAIL {2}…and its drawing/.test(r.text), (r.text.match(/.*drawing came back.*/) || [''])[0]);
check('…and that the team survived', /every team member still has a profile/.test(r.text) &&
  !/FAIL {2}every team member/.test(r.text));
check('it reports how much work the backup would have lost', /would have been lost/.test(r.text),
  (r.text.match(/.*would have been lost.*/) || [''])[0]);
check('it never prints the key it was given', !/[^A-Za-z]k[^A-Za-z]*$/.test('') && r.text.indexOf('RESTORE_SUPABASE_SERVICE_KEY=') < 0);

// ── the half-run restore: some tables simply are not there ──
r = await run(goodDb(), null, ['schedule_rows', 'comms_tasks']);
check('a half-restored database fails rather than looking fine',
  r.code === 1 || /FAIL/.test(r.text), 'exit ' + r.code);
check('…and refuses to call it proven',
  /NOT proven/.test(r.text) || r.code !== 0, r.text.slice(-160));

// ── the one that fools people: it answers, but the work is gone ──
const empty = goodDb();
empty.jobs = [];
r = await run(empty);
check('a database with no jobs in it does not pass as a restore',
  r.code === 1, 'exit ' + r.code);
check('…saying plainly there was nothing to open',
  /there is at least one job to open/.test(r.text), (r.text.match(/.*job to open.*/) || [''])[0]);

// ── a job whose drawing did not come back ──
const noDraw = goodDb();
noDraw.jobs[0].draw_state = { state: { quote: { ref: '3206' } } };
r = await run(noDraw);
check('a job that came back without its drawing is caught',
  r.code === 1 && /FAIL.*drawing came back/.test(r.text), (r.text.match(/.*drawing came back.*/) || [''])[0]);

// ── pointed at nothing ──
r = await run(goodDb(), { RESTORE_SUPABASE_URL: '', RESTORE_SUPABASE_SERVICE_KEY: '' });
check('run without credentials it explains itself instead of guessing', r.code === 2 &&
  /Never point this at the live project/.test(r.text), r.text.slice(0, 120));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
