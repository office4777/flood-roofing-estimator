// THE OWNER'S BACK-TRAYS ARE BUILT-INS FOR EVERY BUSINESS (2026-11-09, the
// owner: "save all the back-trays as built in so all users have them"). The
// back-tray drawings a pipe penetration calls up by name were drawn once in
// the owner's own library; the server copies the owner's saved flashings whose
// names say back-tray into platform_state `builtin_flashings`, and every
// signed-in account reads them from GET /flashings/builtins.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const poly = (n) => [{ vertices: [[100,100],[300,100],[300,100 + n]], measurements: { '1': n } }];
const ownerLib = [
  { name: '800mm 5-Rib back-tray', profile: '5-Rib', flashingType: 'custom', polylines: poly(80), girthMm: 900, sketch: 'data:image/png;base64,AAAA', type: 'x', faces: [] },
  { name: '340mm Corrugate back-tray', profile: 'Corrugate', flashingType: 'custom', polylines: poly(34) },
  { name: 'Back Tray Wide Corro', profile: 'Corrugate', flashingType: 'custom', polylines: poly(50) },
  { name: 'My private valley', profile: 'Corrugate', flashingType: 'valley', polylines: poly(20) },
  { name: '420mm 5-Rib back-tray', profile: '5-Rib', flashingType: 'custom' },   // nothing drawn: skipped
];
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'team' }, { id: 'c2', name: 'Other Roofing', plan: 'team' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' }, { id: 'u2', company_id: 'c2', email: 'jo@other.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  platform_state: [],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: new Date().toISOString(), branding: { company_name: 'Flood Roofing' },
      price_book: { __materials_catalog: { savedFlashings: ownerLib } } },
    { user_id: 'u2', company_id: 'c2', updated_at: new Date().toISOString(), branding: { company_name: 'Other Roofing' },
      price_book: { __materials_catalog: { savedFlashings: [ { name: 'Their back-tray', profile: 'Corrugate', polylines: poly(10) } ] } } },
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'bf-test-token';
process.env.ANALYTICS_OWNERS = 'office@floodroofing.co.nz';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34987';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
const BASE = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++){ try { await fetch(BASE + '/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
const tokOther = jwt.sign({ id: 'u2', email: 'jo@other.nz', cid: 'c2' }, 'test-secret');
const tokOwner = jwt.sign({ id: 'u1', email: 'office@floodroofing.co.nz', cid: 'c1' }, 'test-secret');
const get = (p, t) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + t } });

let g0 = await get('/flashings/builtins', tokOther);
let j0 = await g0.json();
check('before any sync an account reads an empty list, not an error', g0.status === 200 && Array.isArray(j0.items) && j0.items.length === 0, JSON.stringify(j0));
check('the route needs a signed-in account', (await fetch(BASE + '/flashings/builtins')).status === 401);

const r1 = await (await fetch(BASE + '/admin/builtin-flashings/run?token=bf-test-token', { method: 'POST' })).json();
const st = (db.platform_state.find(r => r.key === 'builtin_flashings') || {}).value || {};
const names = (st.items || []).map(i => i.name);
check('the sync copies the owner\'s back-trays, and only them', r1.wrote === true && names.length === 3 &&
  names.includes('800mm 5-Rib back-tray') && names.includes('340mm Corrugate back-tray') && names.includes('Back Tray Wide Corro'), JSON.stringify({ r1, names }));
check('…never a flashing that is not a back-tray, nor one with nothing drawn', !names.includes('My private valley') && !names.includes('420mm 5-Rib back-tray'));
check('…never another business\'s back-tray', !names.includes('Their back-tray'));
const tray = (st.items || []).find(i => i.name === '800mm 5-Rib back-tray') || {};
check('each one carries its drawing and is marked built-in, without the legacy order fields', tray.isBuiltin === true && tray.platform === true &&
  Array.isArray(tray.polylines) && tray.girthMm === 900 && tray.sketch && !('faces' in tray) && !('type' in tray), JSON.stringify(Object.keys(tray)));

// the platform memo is 5 minutes; a fresh server read reaches the new list
const g1 = await (await get('/flashings/builtins', tokOther)).json();
check('another business reads them', Array.isArray(g1.items) && g1.items.length === 3 && !!g1.at, JSON.stringify(g1).slice(0, 120));
const g2 = await (await get('/flashings/builtins?since=' + encodeURIComponent(g1.at), tokOther)).json();
check('…and is told "same" when it already has this list', g2.same === true);

const r2 = await (await fetch(BASE + '/admin/builtin-flashings/run?token=bf-test-token', { method: 'POST' })).json();
check('a second sync with nothing changed writes nothing', r2.wrote === false && r2.items === 3, JSON.stringify(r2));

// The owner's library emptied (a bad read, a wipe) never empties everybody's built-ins.
db.user_settings.find(r => r.user_id === 'u1').price_book = { __materials_catalog: { savedFlashings: [] } };
const r3 = await (await fetch(BASE + '/admin/builtin-flashings/run?token=bf-test-token', { method: 'POST' })).json();
const st3 = (db.platform_state.find(r => r.key === 'builtin_flashings') || {}).value || {};
check('a sync that finds no back-trays leaves the stored list alone', r3.wrote === false && (st3.items || []).length === 3, JSON.stringify(r3));

// The owner saving Settings refreshes the list (debounced).
const lib2 = ownerLib.slice(0, 1).concat([{ name: '610mm 5-Rib back-tray', profile: '5-Rib', flashingType: 'custom', polylines: poly(61) }]);
const put = await fetch(BASE + '/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + tokOwner, 'Content-Type': 'application/json' },
  body: JSON.stringify({ branding: { company_name: 'Flood Roofing' }, price_book: { __materials_catalog: { savedFlashings: lib2 } } }) });
await new Promise(r => setTimeout(r, 2500));
const st4 = (db.platform_state.find(r => r.key === 'builtin_flashings') || {}).value || {};
check('the owner saving Settings refreshes the built-in back-trays', put.status === 200 && (st4.items || []).map(i => i.name).includes('610mm 5-Rib back-tray'),
  JSON.stringify((st4.items || []).map(i => i.name)));
// Another business saving Settings does not.
const before = JSON.stringify(st4);
await fetch(BASE + '/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + tokOther, 'Content-Type': 'application/json' },
  body: JSON.stringify({ branding: { company_name: 'Other Roofing' }, price_book: { __materials_catalog: { savedFlashings: [ { name: 'Huge back-tray', polylines: poly(9) } ] } } }) });
await new Promise(r => setTimeout(r, 2500));
check('another business saving Settings never changes them', JSON.stringify((db.platform_state.find(r => r.key === 'builtin_flashings') || {}).value) === before);
check('the admin run is refused without the token', (await fetch(BASE + '/admin/builtin-flashings/run', { method: 'POST' })).status === 404);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
