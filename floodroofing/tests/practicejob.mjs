// The practice job's picture comes from the platform owner's own job
// numbered TEST-1 — the aerial, its scale and its view, and NOTHING else from
// that job: no lines, no photos, no quote, no customer. Any signed-in
// account may read it; nobody signed out can.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111', CO2 = 'cccccccc-2222-2222-2222-222222222222';
const ARON = 'aaaaaaaa-0000-0000-0000-000000000001', BOB = 'bbbbbbbb-0000-0000-0000-000000000002';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name: 'Flood Roofing', slug: null, plan: 'business' }, { id: CO2, name: 'Acme Roofing', slug: null, plan: 'trial' }],
  company_users: [{ company_id: CO, user_id: ARON, role: 'owner' }, { company_id: CO2, user_id: BOB, role: 'owner' }],
  profiles: [{ id: ARON, company_id: CO, name: 'Aron', email: 'aron@floodroofing.co.nz' }, { id: BOB, company_id: CO2, name: 'Bob', email: 'bob@acmeroofing.co.nz' }],
  company_invites: [], company_domains: [], subscriptions: [], user_settings: [], usage_events: [],
  jobs: [
    { id: 'j-old', user_id: ARON, company_id: CO, client_name: 'Old', site_address: 'x', status: 'draft', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      draw_state: { form: { jobNo: 'TEST-1', jobClient: 'Old' }, state: { img64: null }, draw: { bg: 'data:image/png;base64,OLD', bgW: 10, bgH: 10, scaleMetresPerPx: 0.01, outline: [[1,1]] } } },
    { id: 'j-test', user_id: ARON, company_id: CO, client_name: 'Test Person', site_address: '23 Don Buck Road', status: 'draft', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-16T00:00:00Z',
      draw_state: { form: { jobNo: 'TEST-1', jobClient: 'Test Person', jobPhone: '021 000' },
        state: { img64: null, photos: [{ src: 'data:image/png;base64,PHOTO' }], quote: { lineItems: [{ desc: 'Labour', unit: 9000 }] } },
        draw: { bg: 'data:image/png;base64,AERIAL', bgW: 1280, bgH: 640, imgView: { zoom: 1.2, offX: 3, offY: 4, rot: 1.5 }, scaleMetresPerPx: 0.031, scaleAuto: true, geoScale: { lat: -36.83, zoom: 20.05, retina: true },
                rotation: 0, outline: [[10,10],[200,10],[200,150]], lines: [{ kind: 'ridge', pts: [[1,1],[2,2]] }], roofs: [{ name: 'Main' }] } } },
    { id: 'j-other', user_id: ARON, company_id: CO, client_name: 'Someone', site_address: 'y', status: 'draft', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-17T00:00:00Z',
      draw_state: { form: { jobNo: '06200' }, state: {}, draw: { bg: 'data:image/png;base64,WRONG' } } },
  ],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34611';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwtLib.sign({ id: BOB, email: 'bob@acmeroofing.co.nz', cid: CO2 }, 'test-secret');

let r = await fetch(BASE + '/practice/job', { headers: { Authorization: 'Bearer ' + tok } });
let body = await r.json();
check('another business can read the practice picture', r.status === 200 && body.job_no === 'TEST-1', 'status ' + r.status);
const d = (body.draw_state || {}).draw || {}, st = (body.draw_state || {}).state || {};
check('…it is the NEWEST job numbered TEST-1, not an older one or another number', d.bg === 'data:image/png;base64,AERIAL', d.bg);
check('…with its scale, geo-scale and saved view', d.scaleMetresPerPx === 0.031 && d.scaleAuto === true && d.geoScale && d.geoScale.zoom === 20.05 && d.imgView && d.imgView.zoom === 1.2 && d.bgW === 1280, JSON.stringify(d));
check('…and nothing else from that job: no outline, lines, roofs, photos, quote, name or phone',
  !('outline' in d) && !('lines' in d) && !('roofs' in d) && !('photos' in st) && !('quote' in st) && !('form' in body.draw_state) && !/Test Person|021 000|PHOTO|9000/.test(JSON.stringify(body)),
  Object.keys(d).join(',') + ' / ' + Object.keys(st).join(','));
r = await fetch(BASE + '/practice/job');
check('a stranger cannot read it', r.status === 401 || r.status === 403, String(r.status));
// Nothing to serve → 404, and the app falls back to its drawn picture.
db.jobs.forEach(j => { if (j.draw_state.form.jobNo === 'TEST-1') j.draw_state.form.jobNo = 'GONE'; });
r = await fetch(BASE + '/practice/job', { headers: { Authorization: 'Bearer ' + tok } });
check('a cached answer keeps serving for a while once read', r.status === 200);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
