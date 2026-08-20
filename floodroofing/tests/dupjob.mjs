// The exact failure that cost an hour today: a save arrives with no job id but
// carrying a job number that already exists, and silently becomes a SECOND
// record. This is the guard against it.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const CO2 = 'dddddddd-1111-1111-1111-111111111111';
const U = 'uuuuuuuu-0000-0000-0000-000000000001';
const job = (id, ref, client, company) => ({
  id, company_id: company || CO, user_id: U, client_name: client, site_address: '11 Morcom Lane, Kerikeri',
  status: 'draft', updated_at: '2026-08-18T19:50:26Z',
  draw_state: { state: { quote: { ref } } },
});
const db = {
  __missing: [],
  jobs: [ job('0f695ede', '3099', 'Nikki Barrett'), job('other-co', '3099', 'Someone Else', CO2) ],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, name: 'Aaron', email: 'aaron@floodroofing.co.nz' }],
  subscriptions: [], user_settings: [], companies: [{ id: CO, name: 'Flood Roofing' }],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34571';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const tok = jwtLib.sign({ id: U, email: 'aaron@floodroofing.co.nz', cid: CO }, 'test-secret', { expiresIn: '1h' });
const post = async (body) => {
  const r = await fetch('http://127.0.0.1:' + PORT + '/jobs', { method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(()=>null) };
};
const withRef = (ref) => ({ client_name:'Nikki Barrett', site_address:'11 Morcom Lane', draw_state:{ state:{ quote:{ ref } } }, settings:{} });

const before = db.jobs.length;
let r = await post(withRef('3099'));
check('a save carrying an existing job number is refused', r.status === 409, r.status + ' ' + JSON.stringify(r.body));
check('…with a code the app can act on', r.body.code === 'DUPLICATE_JOB_NO' && r.body.jobNo === '3099', JSON.stringify(r.body.code));
check('…and the job that already has the number, so the app can offer to open it',
  r.body.existing && r.body.existing.id === '0f695ede' && r.body.existing.client_name === 'Nikki Barrett',
  JSON.stringify(r.body.existing));
check('…and NO second record was created', db.jobs.length === before, db.jobs.length + ' jobs');
check('…and the message is one an office can read', /Job 3099 already exists/.test(r.body.error || ''), r.body.error);

r = await post(withRef('3100'));
check('an unused job number saves normally', r.status === 200, r.status + ' ' + JSON.stringify(r.body && r.body.id));
check('…and is actually stored', db.jobs.length === before + 1, db.jobs.length + ' jobs');

r = await post(Object.assign(withRef('3099'), { allowDuplicateRef: true }));
check('a deliberate second record is still allowed', r.status === 200, String(r.status));
check('…and is stored', db.jobs.length === before + 2, db.jobs.length + ' jobs');

r = await post({ client_name:'No number', site_address:'x', draw_state:{ state:{ quote:{} } }, settings:{} });
check('a job with no number at all is unaffected', r.status === 200, String(r.status));
r = await post({ client_name:'Blank', site_address:'x', draw_state:{ state:{ quote:{ ref:'   ' } } }, settings:{} });
check('…so is a blank one', r.status === 200, String(r.status));
r = await post({ client_name:'No quote', site_address:'x', draw_state:{}, settings:{} });
check('…and one with no quote at all', r.status === 200, String(r.status));

// another business using the same number is none of our concern
r = await post(withRef('3099'));
check('the clash reported is from YOUR business, never another\'s',
  r.status === 409 && r.body.existing && r.body.existing.client_name === 'Nikki Barrett',
  JSON.stringify(r.body.existing && r.body.existing.client_name));

// the check must never cost someone their save
db.__fail500 = 'jobs';   // the duplicate lookup now genuinely errors
const n = db.jobs.length;
r = await post(withRef('3099'));
db.__fail500 = null;
check('if the check itself fails, the save still goes through rather than being lost',
  r.status === 200 && db.jobs.length === n + 1, r.status + ', ' + db.jobs.length + ' jobs');

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
