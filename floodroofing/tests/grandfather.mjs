// The day billing switches on, who stops working?
//
// Every account is created as status:'pending' with no trial_ends_at, and
// _subscriptionLive() reads that as "not live". BILLING_ENABLED being false
// is the only reason the app feels open today — the moment a Stripe key is
// set, requireSubscription stops waving everyone through and every one of
// those accounts hits the wall at the same second, the owner's own business
// with them.
//
// /admin/grandfather is the way to see that coming and to comp the people it
// should not happen to. This suite pins the parts that would hurt to get
// wrong: the roster tells the truth, writing is opt-in, and a paying customer
// is never touched.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const SOON = new Date(Date.now() + 40 * 864e5).toISOString();
const GONE = new Date(Date.now() - 5 * 864e5).toISOString();

// Four businesses, one of each shape that matters.
const FLOOD = 'c0000000-0000-0000-0000-00000000f10d';   // the owner's own — pending, would break
const EARLY = 'c0000000-0000-0000-0000-0000000ea111';   // early access — pending, would break
const PAYER = 'c0000000-0000-0000-0000-00000000pa1d'.replace(/[^0-9a-f-]/g,'0');
const LAPSED = 'c0000000-0000-0000-0000-0000001a95ed'.replace(/[^0-9a-f-]/g,'0');

const db = {
  __missing: [],
  companies: [
    { id: FLOOD,  name: 'Flood Roofing',   plan: 'trial',    created_at: '2026-01-05T00:00:00Z' },
    { id: EARLY,  name: 'Kaitaia Roofing', plan: 'trial',    created_at: '2026-06-01T00:00:00Z' },
    { id: PAYER,  name: 'Paying Roofers',  plan: 'business', created_at: '2026-07-01T00:00:00Z' },
    { id: LAPSED, name: 'Lapsed Roofers',  plan: 'team',     created_at: '2026-02-01T00:00:00Z' },
  ],
  company_users: [
    { company_id: FLOOD, user_id: 'u-flood-1', role: 'owner' },
    { company_id: FLOOD, user_id: 'u-flood-2', role: 'member' },
    { company_id: FLOOD, user_id: 'u-flood-3', role: 'member' },
    { company_id: EARLY, user_id: 'u-early-1', role: 'owner' },
    { company_id: PAYER, user_id: 'u-payer-1', role: 'owner' },
    { company_id: LAPSED, user_id: 'u-lapsed-1', role: 'owner' },
  ],
  subscriptions: [
    { user_id: 'u-flood-1',  company_id: FLOOD,  status: 'pending', trial_ends_at: null, created_at: '2026-01-05T00:00:00Z' },
    // Kaitaia has no subscription row at all — the other way to be locked out.
    { user_id: 'u-payer-1',  company_id: PAYER,  status: 'active',  trial_ends_at: null, created_at: '2026-07-01T00:00:00Z' },
    { user_id: 'u-lapsed-1', company_id: LAPSED, status: 'trialing', trial_ends_at: GONE, created_at: '2026-02-01T00:00:00Z' },
  ],
  profiles: [], jobs: [], user_settings: [], company_invites: [], company_domains: [],
};

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'admin-secret-for-tests';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34762';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const TOK = 'admin-secret-for-tests';
const get = (q) => fetch(BASE + '/admin/grandfather?token=' + (q === undefined ? TOK : q));
const post = (body, tok) => fetch(BASE + '/admin/grandfather?token=' + (tok === undefined ? TOK : tok), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const row = (list, id) => list.find(r => r.company_id === id) || {};

// ── the roster tells the truth ────────────────────────────────────
let r = await get(); let b = await r.json();
check('the roster counts the businesses that would stop working',
  b.summary.would_be_locked_out === 3 && b.summary.already_safe === 1,
  JSON.stringify(b.summary));
check('…and the people caught in it', b.summary.people_affected === 5, String(b.summary.people_affected));
check('a pending account is named as locked out', row(b.companies, FLOOD).survives_billing === false,
  row(b.companies, FLOOD).verdict);
check('…so is one with no subscription row at all',
  row(b.companies, EARLY).survives_billing === false && /no subscription row/.test(row(b.companies, EARLY).verdict),
  row(b.companies, EARLY).verdict);
check('…and one whose trial has already run out', row(b.companies, LAPSED).survives_billing === false,
  row(b.companies, LAPSED).verdict);
check('a paying customer is shown as safe and untouched',
  row(b.companies, PAYER).survives_billing === true && /paying/.test(row(b.companies, PAYER).verdict),
  row(b.companies, PAYER).verdict);
check('the ones that break are listed first, biggest first',
  b.companies[0].company_id === FLOOD && b.companies[b.companies.length - 1].company_id === PAYER,
  b.companies.map(c => c.name).join(' · '));

// ── the door is shut without the token ────────────────────────────
check('no admin token, no roster', (await get('')).status === 404);
check('…and no writing either', (await post({ company_ids: [FLOOD] }, 'wrong-token')).status === 404);

// ── writing is opt-in ─────────────────────────────────────────────
r = await post({ company_ids: [FLOOD, EARLY], days: 400 }); b = await r.json();
check('a call without dry_run:false only reports', b.dry_run === true && b.applied.length === 2,
  JSON.stringify({ dry: b.dry_run, n: b.applied.length }));
check('…and writes nothing', db.subscriptions.find(s => s.company_id === FLOOD).trial_ends_at === null);

// ── a nonsense comp window is refused rather than applied ─────────
check('a comp that ends in the past is refused', (await post({ company_ids: [FLOOD], until: GONE })).status === 400);
check('…and one a century out reads as a typo', (await post({ company_ids: [FLOOD], until: '2199-01-01' })).status === 400);
check('an unknown plan is refused', (await post({ company_ids: [FLOOD], plan: 'platinum' })).status === 400);
check('an empty list is refused', (await post({ company_ids: [] })).status === 400);

// ── applying it for real ──────────────────────────────────────────
r = await post({ company_ids: [FLOOD, EARLY, PAYER, LAPSED], plan: 'business', until: SOON, dry_run: false });
b = await r.json();
check('applying comps the three that needed it', b.applied.length === 3, JSON.stringify(b.applied.map(a => a.name)));
check('…and refuses to touch the one that is paying',
  b.skipped.length === 1 && b.skipped[0].company_id === PAYER && /paying/.test(b.skipped[0].why),
  JSON.stringify(b.skipped));
check('the pending account now carries a live comp date',
  db.subscriptions.find(s => s.company_id === FLOOD).trial_ends_at === SOON);
check('…the one with no row at all was given one',
  !!db.subscriptions.find(s => s.company_id === EARLY && s.trial_ends_at === SOON));
check('…the lapsed trial was extended, not left behind',
  db.subscriptions.find(s => s.company_id === LAPSED).trial_ends_at === SOON);
check('…and the payer\'s row is exactly as it was',
  db.subscriptions.find(s => s.company_id === PAYER).trial_ends_at === null &&
  db.subscriptions.find(s => s.company_id === PAYER).status === 'active');
check('the named plan lands on the comped businesses',
  db.companies.find(c => c.id === FLOOD).plan === 'business' &&
  db.companies.find(c => c.id === EARLY).plan === 'business');

// ── and now nobody is locked out ──────────────────────────────────
r = await get(); b = await r.json();
check('the roster reads all clear afterwards',
  b.summary.would_be_locked_out === 0 && b.summary.already_safe === 4, JSON.stringify(b.summary));

// ── running it twice changes nothing further ──────────────────────
// updated_at is meant to move on every write; what must not move is who is
// comped, until when, and on which plan.
const state = () => JSON.stringify(db.subscriptions.map(s => [s.company_id, s.status, s.trial_ends_at])
  .concat(db.companies.map(c => [c.id, c.plan])));
const before = state();
await post({ company_ids: [FLOOD, EARLY], plan: 'business', until: SOON, dry_run: false });
check('running it again is a no-op — safe to re-run', state() === before);

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
