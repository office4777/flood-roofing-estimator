// What happens the moment a customer says yes.
//
// Accepting raised a deposit invoice and stopped. Everything after it — the
// job reaching the schedule board, the hand-over, ordering the roof,
// accepting in Fergus, the tentative-dates email — lived in somebody's head
// or in a spreadsheet, and was remembered or it wasn't.
//
// The customer accepting is NOT logged in, so none of this can go through
// _scopeCompany: the rows are written under the job's own company. That is
// the part most worth pinning — a follow-up written under the wrong company,
// or under none, would be invisible to the business that earned the job.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const now = new Date().toISOString();
const mkJob = (id, token, extra) => Object.assign({
  id, user_id: 'u-aron', company_id: 'c1',
  client_name: 'Sharon Thomson', site_address: '3687 State Highway 12, Taheke',
  created_at: now, updated_at: now, order_sent: null, status: 'quoted',
  draw_state: { state: { quote: {
    client: 'Sharon Thomson', ref: '3206', gstRate: 15,
    scope: 'Re-roof the house and garage, remove existing tiles',
    proposalOptions: { steelGrade: 'colorzen', colour: 'Ironsand', profile: 'corrugate' },
    share: { token, status: 'sent', sentAt: now, sentTotal: 17002.04, events: [] },
  } } },
}, extra || {});

const db = {
  __missing: [],
  profiles: [
    { id: 'u-aron',  company_id: 'c1', name: 'Aron Flood',   email: 'aron@floodroofing.co.nz' },
    { id: 'u-matt',  company_id: 'c1', name: 'Matt Rewiti',  email: 'matt@floodroofing.co.nz' },
    { id: 'u-ethan', company_id: 'c1', name: 'Ethan Barr',   email: 'ethan@floodroofing.co.nz' },
    { id: 'u-paula', company_id: 'c1', name: 'Paula Ngawaka', email: 'paula@floodroofing.co.nz' },
  ],
  company_users: [
    { company_id: 'c1', user_id: 'u-aron',  role: 'owner' },
    { company_id: 'c1', user_id: 'u-matt',  role: 'member' },
    { company_id: 'c1', user_id: 'u-ethan', role: 'member' },
    { company_id: 'c1', user_id: 'u-paula', role: 'member' },
  ],
  user_settings: [{ user_id: 'u-aron', company_id: 'c1',
    branding: { company_name: 'Flood Roofing LTD', email: 'office@floodroofing.co.nz' },
    quote_defaults: {}, jms_keys: {}, price_book: {}, labour_pricing: {},
    invoicing: {}, updated_at: now }],
  jobs: [ mkJob('j-3206', 'tok3206'),
          // No client name — nothing to click on a board row, so it must not
          // create a blank one.
          mkJob('j-blank', 'tokblank', { client_name: '' }) ],
  invoices: [], platform_state: [], comms_tasks: [], schedule_rows: [], schedule_blocks: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34613';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn;
console.log = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const accept = (t, body) => fetch(BASE + '/q/' + t + '/event', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Object.assign({ type: 'accepted', name: 'Sharon Thomson', total: 17002.04 }, body || {})) });
const settle = () => new Promise(r => setTimeout(r, 350));

let r = await accept('tok3206');
check('the customer\'s accept is answered straight away', r.status === 200, 'status ' + r.status);
await settle();

// ── the schedule board ──
const rows = db.schedule_rows.filter(x => x.job_id === 'j-3206');
check('the accepted job lands on the schedule on its own', rows.length === 1, rows.length + ' rows');
const row = rows[0] || {};
check('…under the business that earned it, not nobody',
  row.company_id === 'c1' && row.user_id === 'u-aron', JSON.stringify({ c: row.company_id, u: row.user_id }));
check('…carrying the client and the site', row.client_name === 'Sharon Thomson' &&
  /Taheke/.test(row.site_address || ''), JSON.stringify({ n: row.client_name, s: row.site_address }));
check('…in the main list, not a folder', (row.folder || '') === '', row.folder);
check('…with nothing ticked off yet, and no delivery invented',
  !row.ordered && !row.handover_done && !row.confirmed_delivery && !row.requested_delivery,
  JSON.stringify(row));
check('…and no manual sort position, so it sorts by when it was accepted',
  row.sort_pos == null, String(row.sort_pos));

// ── the office checklist ──
const tasks = db.comms_tasks.filter(t => t.job_id === 'j-3206');
check('accepting raises the office checklist', tasks.length === 4, tasks.length + ' tasks');
const titled = (re) => tasks.find(t => re.test(t.title || ''));
const by = (id) => tasks.filter(t => t.assignee_user_id === id).map(t => t.title);
check('hand-over goes to Matt', (by('u-matt').length === 1) && /hand-over/i.test(by('u-matt')[0]),
  JSON.stringify(by('u-matt')));
check('ordering the roof goes to Ethan', (by('u-ethan').length === 1) && /Order the roof/i.test(by('u-ethan')[0]),
  JSON.stringify(by('u-ethan')));
check('Fergus and the deposit invoice go to Paula',
  !!titled(/Accept in Fergus/i) && titled(/Accept in Fergus/i).assignee_user_id === 'u-paula',
  JSON.stringify(by('u-paula')));
check('…as does checking the dates and sending the tentative schedule',
  !!titled(/tentative schedule/i) && titled(/tentative schedule/i).assignee_user_id === 'u-paula',
  JSON.stringify(by('u-paula')));
check('every task names the customer, so a list of four reads on its own',
  tasks.every(t => /Sharon Thomson/.test(t.title)), JSON.stringify(tasks.map(t => t.title)));
check('…and the quote reference with it',
  tasks.every(t => /3206/.test(t.title)), JSON.stringify(tasks.map(t => t.title)));
check('…all of it under the right company', tasks.every(t => t.company_id === 'c1'));
check('…none of them marked done, and none personal',
  tasks.every(t => !t.done && !t.personal));
// Undated, all four land at the bottom of a list competing with everything
// else on it, and ordering the roof is exactly as loud as a note to ring
// somebody back.
check('every task carries a due date, so the list sorts by what is urgent',
  tasks.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '')),
  JSON.stringify(tasks.map(t => t.due_date)));
check('…with Fergus and the deposit first and the schedule email last',
  (titled(/Accept in Fergus/i) || {}).due_date < (titled(/Order the roof/i) || {}).due_date &&
  (titled(/Order the roof/i) || {}).due_date < (titled(/tentative schedule/i) || {}).due_date,
  JSON.stringify(tasks.map(t => t.title.slice(0, 22) + ' ' + t.due_date)));

// ── a question reaches somebody ──
await accept('tokblank', { type: 'queried', message: 'Does that price include the spouting?' });
await settle();
const qt = db.comms_tasks.filter(t => /question/i.test(t.title || ''));
check('a customer question raises a task rather than only a status',
  qt.length === 1, qt.length + ' tasks');
check('…due today, because a question waiting is a job cooling off',
  /^\d{4}-\d{2}-\d{2}$/.test((qt[0] || {}).due_date || ''), (qt[0] || {}).due_date);
check('…carrying what they actually asked',
  /spouting/.test((qt[0] || {}).notes || ''), (qt[0] || {}).notes);
check('…left unassigned, so whoever picks it up owns it',
  (qt[0] || {}).assignee_user_id == null, String((qt[0] || {}).assignee_user_id));

// ── a replayed accept ──
r = await accept('tok3206');
await settle();
check('re-accepting the same quote does not raise the checklist twice',
  db.comms_tasks.filter(t => t.job_id === 'j-3206').length === 4,
  db.comms_tasks.filter(t => t.job_id === 'j-3206').length + ' tasks');
check('…nor a second board row',
  db.schedule_rows.filter(x => x.job_id === 'j-3206').length === 1);

// ── a job with no name ──
await accept('tokblank');
await settle();
check('a job with no client name is left off the board rather than added blank',
  db.schedule_rows.filter(x => x.job_id === 'j-blank').length === 0);
check('…but its checklist is still raised, so the work is not lost',
  db.comms_tasks.filter(t => t.job_id === 'j-blank' && /quote-accepted/.test(t.notes || '')).length === 4,
  JSON.stringify(db.comms_tasks.filter(t => t.job_id === 'j-blank').map(t => t.title)));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
