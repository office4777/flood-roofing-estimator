// The numbers behind the notification feed: of the quotes SENT in the last
// 30 or 90 days, how many were opened, accepted, declined — and how long
// acceptance takes. Team and up, tenant-scoped, and computed server-side from
// MORE rows than the bell feed truncates to, so a rate can't be quietly wrong.
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

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const job = (id, co, user, share) => ({ id, user_id: user, company_id: co, client_name: 'C ' + id,
  created_at: daysAgo(110), updated_at: daysAgo(0),
  draw_state: { state: { quote: { ref: 'R-' + id, client: 'C', share } } } });

const { port } = await startFakePostgrest({
  companies: [
    { id: 'cA', name: 'A Roofing', plan: 'team' },
    { id: 'cB', name: 'B Roofing', plan: 'team' },
    { id: 'cS', name: 'S Roofing', plan: 'solo' },
  ],
  jobs: [
    // Company A: accepted (40d ago, accepted 35d ago) · opened (10d) · silent (5d) · ancient (100d)
    job('a1', 'cA', 'ua', { token: 't-a1', sentAt: daysAgo(40), status: 'accepted',
      acceptedAt: daysAgo(35), events: [{ type: 'opened', at: daysAgo(39) }, { type: 'accepted', at: daysAgo(35) }] }),
    job('a2', 'cA', 'ua', { token: 't-a2', sentAt: daysAgo(10), status: 'opened', openCount: 2,
      lastOpenedAt: daysAgo(9), events: [{ type: 'opened', at: daysAgo(9) }] }),
    job('a3', 'cA', 'ua', { token: 't-a3', sentAt: daysAgo(5), status: 'sent', events: [] }),
    job('a4', 'cA', 'ua', { token: 't-a4', sentAt: daysAgo(100), status: 'sent', events: [] }),
    // Company B: one of its own
    job('b1', 'cB', 'ub', { token: 't-b1', sentAt: daysAgo(3), status: 'sent', events: [] }),
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34632';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.GAS_MAIL_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tokFor = (uid, cid) => jwt.sign({ id: uid, email: uid + '@x.nz', cid }, 'test-secret');
const get = async (path, tok) => {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } });
  return { status: r.status, body: await r.json() };
};

// ── 30-day window: only the recent cohort counts ──────────────────
let r = await get('/quote-analytics?days=30', tokFor('ua', 'cA'));
check('30 days: two quotes sent', r.status === 200 && r.body.sent === 2, JSON.stringify(r.body));
check('…one opened (50%), none accepted',
  r.body.opened === 1 && r.body.open_rate === 50 && r.body.accepted === 0 && r.body.accept_rate === 0,
  JSON.stringify(r.body));
check('…no median when nothing accepted', r.body.median_days_to_accept === null, '');

// ── 90-day window widens the cohort ───────────────────────────────
r = await get('/quote-analytics?days=90', tokFor('ua', 'cA'));
check('90 days: three sent (the 100-day quote stays out)', r.body.sent === 3, JSON.stringify(r.body));
check('…two opened, one accepted',
  r.body.opened === 2 && r.body.accepted === 1 && r.body.accept_rate === 33, JSON.stringify(r.body));
check('…acceptance took ~5 days', Math.abs((r.body.median_days_to_accept || 0) - 5) < 0.3,
  String(r.body.median_days_to_accept));

// ── junk window falls back to 30 ──────────────────────────────────
r = await get('/quote-analytics?days=7000', tokFor('ua', 'cA'));
check('an unsupported window is clamped to 30 days', r.body.days === 30 && r.body.sent === 2, JSON.stringify(r.body));

// ── tenancy: B sees only B ────────────────────────────────────────
r = await get('/quote-analytics?days=90', tokFor('ub', 'cB'));
check('company B sees only its own single quote', r.body.sent === 1 && r.body.accepted === 0, JSON.stringify(r.body));

// ── the plan gate ─────────────────────────────────────────────────
// Being told a quote was opened or accepted moved down to Trade: a one-person
// business has no office watching the folder, so it needs this most. Both the
// feed and the numbers behind it come with the smallest plan now.
r = await get('/quote-activity', tokFor('us', 'cS'));
check('Trade gets its notification feed', r.status === 200 && Array.isArray(r.body),
  'status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
r = await get('/quote-analytics?days=30', tokFor('us', 'cS'));
check('…and the numbers that go with it', r.status === 200 && typeof r.body.sent === 'number',
  'status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
r = await get('/quote-activity', tokFor('ua', 'cA'));
check('Team still gets its feed', r.status === 200 && Array.isArray(r.body) && r.body.length === 4,
  'status ' + r.status + ', ' + (Array.isArray(r.body) ? r.body.length : '—') + ' rows');

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
