// THE EMAIL SWITCHES A SETTINGS BUG TURNED OFF COME BACK ON (2026-10-25, job
// 3334: "Aidan accepted job 3334 but it froze and i didn't get the acceptance
// email"). A Settings save made away from the Settings tab read an unfilled
// form and stored every "Send this email automatically" switch as false — the
// office's acceptance email, the customer's confirmation, the question and the
// decline. The app no longer does that (tests/settingssave.mjs); this pins the
// one-off server repair of the rows it already wrote, and that the acceptance
// those rows held back then goes out on the hourly net.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const OFF = { accept_office_on: false, accept_cust_on: false, question_on: false, decline_on: false };
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'team' }, { id: 'c2', name: 'Quiet Co', plan: 'team' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'owner@flood.nz' }, { id: 'u2', company_id: 'c2', email: 'owner@quiet.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  platform_state: [],
  user_settings: [
    // the bug's write: all of them off at once, the addresses kept
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1), branding: { company_name: 'Flood Roofing' },
      quote_defaults: { validity_days: 30, email: Object.assign({ accept_to: 'office@flood.nz', copy_all: 'office@flood.nz' }, OFF) } },
    // an office that switched ONE of them off on purpose
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1), branding: { company_name: 'Quiet Co' },
      quote_defaults: { email: { accept_to: 'office@quiet.nz', accept_cust_on: false } } },
  ],
  comms_tasks: [], job_messages: [],
  jobs: [
    // job 3334's shape: accepted yesterday, the office never told
    { id: 'j-3334', user_id: 'u1', company_id: 'c1', client_name: 'Double Two Dairies', site_address: '368 Dunn Road, Ruawai',
      created_at: ago(5), updated_at: ago(0),
      draw_state: { form: {}, state: { quote: { ref: '3334', client: 'Double Two Dairies', addr: '368 Dunn Road, Ruawai',
        accepted: { name: 'Double Two Dairies', at: ago(1), total: 34231.35 },
        share: { token: 'tok-3334', status: 'accepted', sentAt: ago(3), acceptedAt: ago(1),
                 sentTo: 'doubletwodairies@example.com', sentTotal: 34231.35, events: [] } } } } },
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'es-test-token';
process.env.ACCEPT_OFFICE_FROM = new Date(Date.now() - 5 * 86400000).toISOString();
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34981';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
const BASE = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++){ try { await fetch(BASE + '/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
const post = (p) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const em = id => ((db.user_settings.find(r => r.user_id === id) || {}).quote_defaults || {}).email || {};

// Before the repair the net holds the acceptance back: the switch says off.
let sw = await (await post('/admin/office-owed/run?token=es-test-token')).json();
await new Promise(r => setTimeout(r, 300));
check('before the repair, the switched-off row holds the acceptance email back', !sent.some(m => /3334/.test(m.subject || '')), JSON.stringify(sw));

const r1 = await (await post('/admin/email-switch-repair/run?token=es-test-token')).json();
const e1 = em('u1'), e2 = em('u2');
check('the row the bug wrote — all three switches off — has them back on', !('accept_office_on' in e1) && !('accept_cust_on' in e1) && !('question_on' in e1) && !('decline_on' in e1), JSON.stringify(e1));
check('…keeping its addresses and the rest of its settings', e1.accept_to === 'office@flood.nz' && e1.copy_all === 'office@flood.nz' &&
  db.user_settings.find(r => r.user_id === 'u1').quote_defaults.validity_days === 30, JSON.stringify(e1));
check('an office that switched ONE email off on purpose keeps its choice', e2.accept_cust_on === false && e2.accept_to === 'office@quiet.nz', JSON.stringify(e2));
check('…and the repair says what it did', r1.repaired === 1 && r1.checked >= 2, JSON.stringify(r1));

// ONCE: the marker means a later all-off is the office's own choice and stays.
Object.assign(db.user_settings.find(r => r.user_id === 'u1').quote_defaults.email, OFF);
const r2 = await (await post('/admin/email-switch-repair/run?token=es-test-token')).json();
check('it runs once — a second run touches nothing', r2.repaired === 0 && em('u1').accept_office_on === false, JSON.stringify(r2));
delete db.user_settings.find(r => r.user_id === 'u1').quote_defaults.email.accept_office_on;

// The acceptance the switch held back goes out on the hourly net.
sw = await (await post('/admin/office-owed/run?token=es-test-token')).json();
for (let i = 0; i < 30 && !sent.some(m => /3334/.test(m.subject || '')); i++) await new Promise(r => setTimeout(r, 100));
const m = sent.find(x => /3334/.test(x.subject || ''));
check('…and the acceptance it held back reaches the office on the next sweep', !!m && /office@flood\.nz/.test(JSON.stringify(m.to || m.recipient || m)) && /Double Two Dairies/.test(m.subject || ''), JSON.stringify(sw) + ' ' + (m ? m.subject : 'none'));

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
