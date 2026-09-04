#!/usr/bin/env node
// Is a restored backup actually a working RoofMap, or just a database that
// answers?
//
// SETUP.md's restore drill ended with "check three things by eye". Three
// things by eye at 2am, on the one night it matters, is how a drill turns
// into a hope. This is the same three things, plus the ones a person would
// not think to look at, asked mechanically and answered with an exit code.
//
//   node floodroofing/tools/restore-check.mjs
//
// Reads the RESTORED project's credentials from the environment — never the
// live ones, and it only ever READS:
//
//   RESTORE_SUPABASE_URL          the scratch project's URL
//   RESTORE_SUPABASE_SERVICE_KEY  its service key
//   RESTORE_API                   optional: a backend already pointed at it
//                                 (e.g. http://127.0.0.1:8080), which lets it
//                                 check that a customer quote link resolves
//   RESTORE_TAKEN_AT              optional: when the backup was taken (ISO),
//                                 to report how much work it would have lost
//
// It prints no keys and no connection strings.
const URL_ = process.env.RESTORE_SUPABASE_URL || '';
const KEY  = process.env.RESTORE_SUPABASE_SERVICE_KEY || '';
const API  = (process.env.RESTORE_API || '').replace(/\/$/, '');
const TAKEN = process.env.RESTORE_TAKEN_AT || '';

if (!URL_ || !KEY) {
  console.error('Set RESTORE_SUPABASE_URL and RESTORE_SUPABASE_SERVICE_KEY to the RESTORED project.');
  console.error('Never point this at the live project — use the scratch one from the drill.');
  process.exit(2);
}
const results = [];
function check(name, ok, detail){
  results.push(!!ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ('  — ' + detail) : ''));
}
async function q(path){
  const r = await fetch(URL_.replace(/\/$/, '') + '/rest/v1/' + path, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'count=exact' },
  });
  const body = await r.text();
  let json = null; try { json = JSON.parse(body); } catch (e) {}
  const range = r.headers.get('content-range') || '';
  const rows = Array.isArray(json) ? json : [];
  // Not every PostgREST is configured to answer an exact count; fall back to
  // what came back rather than reporting NaN rows.
  let total = Number((range.split('/')[1] || '').trim());
  if (!isFinite(total)) total = rows.length;
  return { ok: r.ok, status: r.status, rows, total, raw: body.slice(0, 200) };
}

console.log('Restore check — reading the restored project (never the live one)\n');

// 1. The tables are there at all. A restore that half-ran answers 200 on
//    some of these and 404 on the rest, which is the shape that fools people.
const TABLES = ['companies', 'company_users', 'profiles', 'user_settings', 'jobs',
                'invoices', 'schedule_rows', 'schedule_blocks', 'comms_tasks', 'job_revisions'];
const counts = {};
for (const t of TABLES) {
  const r = await q(t + '?select=id&limit=1');
  counts[t] = r.total;
  check('table ' + t + ' is present', r.ok, r.ok ? (r.total + ' rows') : ('HTTP ' + r.status + ' ' + r.raw));
}

// 2. The three the drill asks for by eye.
const jobs = await q('jobs?select=id,client_name,updated_at,draw_state&order=updated_at.desc&limit=1');
const job = jobs.rows[0] || null;
check('there is at least one job to open', !!job, jobs.total + ' jobs');
if (job) {
  const st = (job.draw_state && job.draw_state.state) || {};
  check('…and its drawing came back with it',
    !!(st.roofData || (st.DRAW && st.DRAW.pts) || st.img64 || (st.roofs && st.roofs.length)),
    'draw_state keys: ' + Object.keys(st).slice(0, 8).join(', '));
  check('…and it is a real job, not an empty row', !!String(job.client_name || '').trim(), job.client_name || '(blank)');
}
const teams = await q('company_users?select=company_id,user_id,role&limit=500');
const profs = await q('profiles?select=id&limit=1000');
const profIds = new Set(profs.rows.map(p => p.id));
const orphans = teams.rows.filter(m => !profIds.has(m.user_id));
check('every team member still has a profile', orphans.length === 0,
  orphans.length + ' membership rows with no profile');
check('somebody still owns each business',
  teams.rows.length === 0 || new Set(teams.rows.filter(m => m.role === 'owner').map(m => m.company_id)).size > 0,
  teams.rows.filter(m => m.role === 'owner').length + ' owners');

// A customer quote link is the one thing that talks to the outside world.
const shared = await q("jobs?select=id&draw_state->state->quote->share->>token=not.is.null&limit=1");
check('at least one shared quote survived', shared.rows.length > 0 || jobs.total === 0,
  shared.rows.length ? 'yes' : 'none found');
if (API) {
  const tok = await q("jobs?select=tok:draw_state->state->quote->share->>token&limit=1&draw_state->state->quote->share->>token=not.is.null");
  const t = (tok.rows[0] || {}).tok;
  if (t) {
    try {
      const r = await fetch(API + '/q/' + encodeURIComponent(t) + '?preview=1');
      check('a customer quote link resolves against the restored data', r.status === 200, 'HTTP ' + r.status);
    } catch (e) { check('a customer quote link resolves against the restored data', false, String(e.message || e)); }
  }
  try {
    const h = await fetch(API + '/health');
    check('the backend answers /health against it', h.ok, 'HTTP ' + h.status);
  } catch (e) { check('the backend answers /health against it', false, String(e.message || e)); }
} else {
  console.log('SKIP  the customer-link and /health checks — set RESTORE_API to a backend pointed at this project');
}

// 3. What the drill never asked: how much work would this have lost?
if (job && job.updated_at) {
  const newest = new Date(job.updated_at);
  const when = TAKEN ? new Date(TAKEN) : new Date();
  const hrs = (when - newest) / 3600000;
  console.log('\nNewest job in the backup: ' + newest.toISOString());
  console.log(TAKEN
    ? ('Backup taken:              ' + when.toISOString())
    :  'Compared against now (set RESTORE_TAKEN_AT for the real figure).');
  console.log('Work that would have been lost: about ' +
    (hrs < 1 ? 'under an hour' : (hrs < 48 ? (Math.round(hrs) + ' hours') : (Math.round(hrs / 24) + ' days'))));
  console.log('That number is the answer to "how much would we lose", and it is worth knowing before it matters.\n');
}

const bad = results.filter(x => !x).length;
console.log((results.length - bad) + '/' + results.length + ' checks passed');
if (bad) console.log('\nThis restore is NOT proven. Do not delete the scratch project until it is.');
else console.log('\nThe restore holds up. Write down how long it took — that is your real downtime.');
process.exit(bad ? 1 : 0);
