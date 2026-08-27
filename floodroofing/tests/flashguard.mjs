// "It just lost all saved flashings when I reloaded the app."
//
// The flashing library rides INSIDE price_book (as __materials_catalog,
// because user_settings has no catalog column), and settings saves are
// whole-document. So any writer that did not carry the library — an older
// build still cached on one machine, the setup wizard's direct save, a tab
// opened before the drawings existed — overwrote price_book wholesale and
// took the library with it. Nine hand-drawn flashings died exactly that way,
// and the reload then mirrored the gutted cloud copy over the one surviving
// local copy.
//
// The rule now lives in the backend, where every writer has to pass: a save
// carrying NO saved flashings does not get to destroy saved flashings that
// exist. Emptying the library on purpose requires the explicit __cleared
// flag the delete-last-one path sends.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = '11111111-1111-1111-1111-111111111111';
await startFakePostgrest({
  profiles: [{ id: 'u1', email: 'aron@test.nz', company_id: CO }],
  user_settings: [], company_users: [], jobs: [], invoices: [],
}).then(({ port }) => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
});
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34719';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
process.env.BILLING_ENABLED = 'false';

const jwt = require('jsonwebtoken');
const tok = () => jwt.sign({ id: 'u1', email: 'aron@test.nz', cid: CO }, 'test-secret', { expiresIn: '1h' });
const origLog = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = origLog;
await new Promise(r => setTimeout(r, 700));
const api = async (method, path, body) => {
  const r = await fetch('http://127.0.0.1:' + PORT + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const savedOf = (s) => (((s || {}).price_book || {}).__materials_catalog || {}).savedFlashings || [];

// The office draws its library — his nine, names as typed.
const NINE = [
  '"Boxed Penetration Side Apron Corro"', '"Boxed Penetration Side Apron 5-Rib"',
  '"Boxed Penetration Bottom Apron Corro"', '"Boxed Penetration Bottom Apron 5-Rib"',
  '"Boxed Penetration Top Apron Corro"', '"Boxed Penetration Top Apron 5-Rib"',
  '"Boxed Penetration Top Back-Tray Corro"', '"Boxed Penetration Top Back-Tray 5-Rib"',
  '"Boxed Penetration Chase Flashing"',
].map(n => ({ name: n, profile: /5-Rib/.test(n) ? '5-Rib' : 'Corrugate', sketch: 'data:image/png;base64,xx' }));

const SETTINGS = {
  branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz', phone: '09' },
  quote_defaults: {}, jms_keys: {},
  price_book: { ridge_lm: 21.97, __materials_catalog: { suppliers: [], savedFlashings: NINE } },
  labour_pricing: {},
};
let r = await api('PUT', '/settings', SETTINGS);
check('the office saves its drawn library', r.status === 200, 'HTTP ' + r.status);
r = await api('GET', '/settings');
check('…and it is really stored: nine flashings', savedOf(r.body).length === 9,
  savedOf(r.body).length + ' stored');

// ── the wipe, replayed ─────────────────────────────────────────────
// An old build (or the setup wizard) saves settings with a price_book that
// has never heard of the library.
r = await api('PUT', '/settings', {
  branding: { company_name: 'Flood Roofing Ltd', email: 'office@floodroofing.co.nz', phone: '09' },
  quote_defaults: { next_job_no: '06200' }, jms_keys: {},
  price_book: { ridge_lm: 22.10 },
  labour_pricing: {},
});
check('a writer that does not carry the library still saves fine', r.status === 200, 'HTTP ' + r.status);
r = await api('GET', '/settings');
check('…its own changes land: the new ridge rate', r.body.price_book.ridge_lm === 22.10,
  String(r.body.price_book.ridge_lm));
check('…and the company name', r.body.branding.company_name === 'Flood Roofing Ltd');
check('…but the nine flashings SURVIVE it', savedOf(r.body).length === 9,
  savedOf(r.body).length + ' — this is the write that destroyed them');

// A stale tab that loaded before the drawings existed: it KNOWS the catalog
// shape, but its copy of the library is empty.
r = await api('PUT', '/settings', Object.assign({}, SETTINGS, {
  price_book: { ridge_lm: 22.10, __materials_catalog: { suppliers: [{ name: 'RI' }], savedFlashings: [] } },
}));
check('an empty library from a stale tab is refused the overwrite', r.status === 200);
r = await api('GET', '/settings');
check('…the flashings are still all there', savedOf(r.body).length === 9, savedOf(r.body).length + '');
check('…while the rest of that save is honoured: its supplier landed',
  (r.body.price_book.__materials_catalog.suppliers || []).length === 1,
  JSON.stringify(r.body.price_book.__materials_catalog.suppliers));

// ── ordinary library edits still work ──────────────────────────────
r = await api('PUT', '/settings', Object.assign({}, SETTINGS, {
  price_book: { ridge_lm: 22.10, __materials_catalog: { suppliers: [], savedFlashings: NINE.slice(0, 8) } },
}));
r = await api('GET', '/settings');
check('deleting ONE flashing is respected — eight remain', savedOf(r.body).length === 8,
  savedOf(r.body).length + '');

// ── emptying on purpose needs the flag, and the flag works ─────────
r = await api('PUT', '/settings', Object.assign({}, SETTINGS, {
  price_book: { __materials_catalog: { suppliers: [], savedFlashings: [], __cleared: true } },
}));
r = await api('GET', '/settings');
check('Delete-all with its flag really empties the library', savedOf(r.body).length === 0,
  savedOf(r.body).length + '');
check('…and the flag itself is not stored',
  !(r.body.price_book.__materials_catalog || {}).__cleared, 'flag stripped');

// With the library now deliberately empty, a library-less save stays a plain save.
r = await api('PUT', '/settings', { branding: SETTINGS.branding, quote_defaults: {}, jms_keys: {},
  price_book: { ridge_lm: 23 }, labour_pricing: {} });
r = await api('GET', '/settings');
check('after a deliberate clear, nothing is resurrected', savedOf(r.body).length === 0);

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
process.exit(fails ? 1 : 0);
