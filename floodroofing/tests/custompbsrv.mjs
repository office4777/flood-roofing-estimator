// The Custom Price Book (2026-09-24) rides inside price_book, and settings
// saves are whole-document. The owner: "make sure any edit or save is
// properly saved, I can't be having users spend a lot of time setting up
// their settings for it to all be lost on an update/fix." Pinned here, on the
// server every writer passes through:
//   · a save that does not carry the book (an old build, the setup wizard)
//     keeps the stored book;
//   · a save carrying an OLDER book (another tab, another device) keeps the
//     stored, newer one — its other changes still land;
//   · a newer book replaces it; an empty one only with __cleared;
//   · the book it replaced is kept as an earlier version, and Restore puts
//     it back (keeping what it replaced too).
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
  user_settings: [], company_users: [], jobs: [], invoices: [], price_book_revisions: [],
}).then(({ port }) => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
});
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34733';
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
const cbOf = (s) => ((s || {}).price_book || {}).custom_book || null;
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const T0 = ago(3), T1 = ago(2), T2 = ago(1);   // all in the past: a restore is stamped NOW
const item = (id, desc, cost, replaces) => ({ id, code: id.toUpperCase(), desc, unit: 'ea', supplier: 'Steel & Tube', cost, markup: 10, replaces: replaces || '' });
const BOOK1 = { editedAt: T1, defaultMarkup: 10, items: [item('a', 'Dektite No 3', 31.4, 'aquaseal.no3'), item('b', 'Ridge capping', 14.2, 'ridge_lm'), item('c', 'Silicone', 12.9)] };
const base = (pb) => ({ branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz', phone: '09' },
  quote_defaults: {}, jms_keys: {}, price_book: pb, labour_pricing: {} });

let r = await api('PUT', '/settings', base({ ridge_lm: 15.62, custom_book: BOOK1 }));
check('the office saves its Custom Price Book', r.status === 200 && (cbOf(r.body) || {}).items.length === 3, 'HTTP ' + r.status);

// an old build / the setup wizard: no custom_book at all
r = await api('PUT', '/settings', base({ ridge_lm: 16 }));
r = await api('GET', '/settings');
check('a save that does not carry the book KEEPS it', (cbOf(r.body) || { items: [] }).items.length === 3, JSON.stringify(cbOf(r.body)));
check('…while the rest of that save lands', r.body.price_book.ridge_lm === 16, String(r.body.price_book.ridge_lm));

// another tab, opened this morning: an older copy with one item
r = await api('PUT', '/settings', base({ ridge_lm: 16, custom_book: { editedAt: T0, items: [item('a', 'Dektite No 3', 1, '')] } }));
r = await api('GET', '/settings');
check('a save carrying an OLDER book keeps the newer stored one', cbOf(r.body).items.length === 3 && cbOf(r.body).items[0].cost === 31.4, JSON.stringify(cbOf(r.body).items.map(i => i.cost)));

// an empty book without the flag
r = await api('PUT', '/settings', base({ custom_book: { editedAt: T2, items: [] } }));
r = await api('GET', '/settings');
check('an empty book does not wipe a full one without __cleared', cbOf(r.body).items.length === 3);

// a real edit: newer, one item re-priced and one deleted
const BOOK2 = { editedAt: T2, defaultMarkup: 10, items: [Object.assign(item('a', 'Dektite No 3', 33, 'aquaseal.no3')), item('b', 'Ridge capping', 14.2, 'ridge_lm')] };
r = await api('PUT', '/settings', base({ custom_book: BOOK2 }));
r = await api('GET', '/settings');
check('a newer book replaces it — the edit and the deletion both land', cbOf(r.body).items.length === 2 && cbOf(r.body).items[0].cost === 33, JSON.stringify(cbOf(r.body).items.map(i => i.cost)));

r = await api('GET', '/settings/custom-book/revisions');
check('the book it replaced is kept as an earlier version', r.status === 200 && Array.isArray(r.body) && r.body.length >= 1 && r.body[0].items === 3, JSON.stringify(r.body));
const revId = r.body && r.body[0] && r.body[0].id;

// restore it
r = await api('POST', '/settings/custom-book/restore', { id: revId });
check('Restore puts that version back', r.status === 200 && r.body.custom_book.items.length === 3, JSON.stringify(r.body && r.body.custom_book && r.body.custom_book.items.length));
r = await api('GET', '/settings');
check('…in the stored settings', cbOf(r.body).items.length === 3 && !!cbOf(r.body).restoredFrom, JSON.stringify(cbOf(r.body).items.length));
const restoredAt = cbOf(r.body).editedAt;
r = await api('GET', '/settings/custom-book/revisions');
check('…and what it replaced is kept too, so the restore can be undone', r.body.some(v => v.items === 2), JSON.stringify(r.body.map(v => v.items)));

// a stale writer after the restore must not undo it
r = await api('PUT', '/settings', base({ custom_book: BOOK2 }));
r = await api('GET', '/settings');
check('a tab still holding the pre-restore book cannot undo the restore', cbOf(r.body).items.length === 3, cbOf(r.body).items.length + ' items; restored at ' + restoredAt);

// deliberate clear
r = await api('PUT', '/settings', base({ custom_book: { editedAt: new Date().toISOString(), items: [], __cleared: true } }));
r = await api('GET', '/settings');
check('emptying the book on purpose (__cleared) empties it', cbOf(r.body).items.length === 0);
check('…and the flag is not stored', !cbOf(r.body).__cleared);

r = await api('POST', '/settings/custom-book/restore', { id: 999999 });
check('restoring a version that does not exist is a 404', r.status === 404, 'HTTP ' + r.status);

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
process.exit(fails ? 1 : 0);
