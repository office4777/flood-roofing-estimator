// The grandfather page, actually clicked.
//
// The suite next door checks the HTML that comes off the server. That is not
// enough: the page's behaviour is inline JavaScript, and a single misplaced
// quote in it produces a page that loads, looks perfect, and does nothing at
// all when the button is pressed. The person relying on this is not going to
// open a console to find out why. So this drives the real page in a real
// browser: type the password, read the table, tick a box, press the button.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import { startFakePostgrest } from './fakepgrst.mjs';

const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const A = 'c0000000-0000-0000-0000-0000000000a1';   // pending — would break
const B = 'c0000000-0000-0000-0000-0000000000b2';   // paying — must be left alone
const db = {
  __missing: [],
  companies: [
    { id: A, name: 'Kaitaia Roofing', plan: 'trial', created_at: '2026-06-01T00:00:00Z' },
    { id: B, name: 'Paying Roofers', plan: 'business', created_at: '2026-07-01T00:00:00Z' },
  ],
  company_users: [
    { company_id: A, user_id: 'u-a1', role: 'owner' },
    { company_id: A, user_id: 'u-a2', role: 'member' },
    { company_id: B, user_id: 'u-b1', role: 'owner' },
  ],
  subscriptions: [
    { user_id: 'u-a1', company_id: A, status: 'pending', trial_ends_at: null, created_at: '2026-06-01T00:00:00Z' },
    { user_id: 'u-b1', company_id: B, status: 'active',  trial_ends_at: null, created_at: '2026-07-01T00:00:00Z' },
  ],
  profiles: [], jobs: [], user_settings: [], company_invites: [], company_domains: [],
};

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'the-admin-password';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34771';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const b = await chromium.launch();
const pg = await (await b.newContext()).newPage();
const jsErrors = [];
pg.on('pageerror', e => jsErrors.push(e.message));
await pg.goto('http://127.0.0.1:' + PORT + '/admin/grandfather');

// ── the wrong password says so, in words ──────────────────────────
await pg.fill('#tok', 'not-the-password');
await pg.click('#go');
await pg.waitForTimeout(400);
check('a wrong password is refused in plain words',
  /not accepted/i.test(await pg.textContent('#loginErr')), await pg.textContent('#loginErr'));
check('…and the list stays hidden', await pg.isHidden('#main'));

// ── the right one shows the list ──────────────────────────────────
await pg.fill('#tok', 'the-admin-password');
await pg.click('#go');
await pg.waitForSelector('#main:visible', { timeout: 4000 });
check('the right password opens the list', await pg.isVisible('#main'));
check('the headline counts the damage in a sentence, not a field name',
  /1 business would stop working, covering 2 people\./.test(await pg.textContent('#sumBig')),
  await pg.textContent('#sumBig'));

let rows = await pg.evaluate(() => [...document.querySelectorAll('#rows tr')].map(tr => ({
  text: tr.innerText.replace(/\s+/g, ' ').trim(),
  box: !!tr.querySelector('[data-id]'),
  ticked: (tr.querySelector('[data-id]') || {}).checked === true,
})));
check('the one that breaks is listed, ticked ready to fix',
  /Kaitaia Roofing/.test(rows[0].text) && /Will stop working/.test(rows[0].text) && rows[0].ticked,
  rows[0].text);
check('…and the paying one has no tick box at all, so it cannot be touched by accident',
  /Paying/.test(rows[1].text) && rows[1].box === false, rows[1].text);

// ── "check first" writes nothing ──────────────────────────────────
await pg.click('#preview');
await pg.waitForTimeout(500);
check('Check first explains what would happen and saves nothing',
  /Nothing saved yet/.test(await pg.textContent('#msg')) &&
  db.subscriptions.find(s => s.company_id === A).trial_ends_at === null,
  await pg.textContent('#msg'));

// ── the dark button does it for real ──────────────────────────────
await pg.click('#apply');
await pg.waitForTimeout(700);
const saved = db.subscriptions.find(s => s.company_id === A).trial_ends_at;
check('pressing the button keeps that account working', !!saved && new Date(saved) > new Date(), String(saved));
check('…and says so, with the date, in plain words',
  /^Done\. These are now kept working until/.test(await pg.textContent('#msg')), await pg.textContent('#msg'));
check('…the payer was not touched',
  db.subscriptions.find(s => s.company_id === B).trial_ends_at === null &&
  db.subscriptions.find(s => s.company_id === B).status === 'active');
check('…and the list refreshes to show it is now sorted',
  /Everyone is sorted/.test(await pg.textContent('#sumBig')), await pg.textContent('#sumBig'));

check('the page threw no JavaScript errors at any point', jsErrors.length === 0, jsErrors.join(' | '));

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
