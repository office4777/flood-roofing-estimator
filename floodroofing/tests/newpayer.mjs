// A NEW PAYING SUBSCRIBER (2026-10-28, the owner: "I'm not getting any emails
// to say that somebody's started paying ... email me congratulations, new
// paying subscriber ... give their details"). The first payment stamps
// paid_since and emails the owner ONCE; a $0 invoice is not paying; the
// businesses that paid before this was kept get their date off Stripe, and a
// recent one gets the email it missed. Stripe is a local stand-in, the
// signatures are real HMACs, the mail goes to a fake relay.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const NOW = Date.now(), dAgo = n => new Date(NOW - n * 864e5).toISOString();
const C1 = 'cccccccc-2222-0000-0000-000000000001', C2 = 'cccccccc-2222-0000-0000-000000000002',
      C3 = 'cccccccc-2222-0000-0000-000000000003', C4 = 'cccccccc-2222-0000-0000-000000000004';
const db = {
  __missing: [],
  companies: [
    { id: C1, name: 'WLRR', plan: 'trial', created_at: dAgo(30) },
    { id: C2, name: 'Kauri Roofing', plan: 'trial', created_at: dAgo(10) },
    { id: C3, name: 'tgm-roofing', plan: 'measure', created_at: dAgo(50) },
    { id: C4, name: 'Signature Roofing', plan: 'measure', created_at: dAgo(80) },
  ],
  company_users: [
    { company_id: C1, user_id: 'u1', role: 'owner' }, { company_id: C2, user_id: 'u2', role: 'owner' },
    { company_id: C3, user_id: 'u3', role: 'owner' }, { company_id: C4, user_id: 'u4', role: 'owner' },
  ],
  profiles: [
    { id: 'u1', email: 'info@wellingtonroof.co.nz', name: 'Scott McKay', phone: '021324523', company: 'WLRR' },
    { id: 'u2', email: 'sam@kauri.co.nz', name: 'Sam Kauri', phone: '027 555', company: 'Kauri Roofing' },
    { id: 'u3', email: 'tyler@tgmroofing.co.nz', name: 'TGM Roofing', phone: '+64 22 072 8772', company: 'tgm-roofing' },
    { id: 'u4', email: 'baylee@signatureroofing.co.nz', name: 'Baylee', phone: '027 453', company: 'Signature Roofing' },
  ],
  subscriptions: [
    { user_id: 'u1', company_id: C1, status: 'trialing', plan: null, trial_ends_at: dAgo(-1), stripe_customer_id: null, stripe_subscription_id: null, paid_since: null, paid_alert_at: null },
    { user_id: 'u2', company_id: C2, status: 'trialing', plan: null, trial_ends_at: dAgo(-5), stripe_customer_id: null, stripe_subscription_id: null, paid_since: null, paid_alert_at: null },
    // Paying since before paid_since was kept: one five days ago, one two months ago.
    { user_id: 'u3', company_id: C3, status: 'active', plan: 'measure', trial_ends_at: null, stripe_customer_id: 'cus_tgm', stripe_subscription_id: 'sub_tgm', paid_since: null, paid_alert_at: null },
    { user_id: 'u4', company_id: C4, status: 'active', plan: 'measure', trial_ends_at: null, stripe_customer_id: 'cus_sig', stripe_subscription_id: 'sub_sig', paid_since: null, paid_alert_at: null },
  ],
  user_settings: [], usage_events: [], invoices: [], jobs: [], waitlist: [], company_invites: [],
};

const sec = n => Math.floor((NOW - n * 864e5) / 1000);
const stripeSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (/^\/v1\/invoices\?/.test(req.url)){
    const sub = new URL('http://x' + req.url).searchParams.get('subscription');
    const data = sub === 'sub_tgm'
      ? [{ id: 'in_t2', amount_paid: 9085, currency: 'nzd', created: sec(5), status_transitions: { paid_at: sec(5) } },
         { id: 'in_t0', amount_paid: 0, currency: 'nzd', created: sec(9), status_transitions: { paid_at: sec(9) } }]
      : sub === 'sub_sig' ? [{ id: 'in_s1', amount_paid: 9085, currency: 'nzd', created: sec(60), status_transitions: { paid_at: sec(60) } }] : [];
    return res.end(JSON.stringify({ object: 'list', data }));
  }
  res.end('{}');
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));
const mails = [];
const mailSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => { try { mails.push(JSON.parse(body)); } catch(e){ mails.push({ raw: body }); }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => mailSrv.listen(0, '127.0.0.1', r));

const WH = 'whsec_newpayer';
const { port } = await startFakePostgrest(db);
Object.assign(process.env, {
  SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_SERVICE_KEY: 'k', JWT_SECRET: 'test-secret',
  PORT: process.env.TEST_PORT || '34671', STRIPE_SECRET_KEY: 'sk_test_np', STRIPE_API_BASE: 'http://127.0.0.1:' + stripeSrv.address().port,
  STRIPE_WEBHOOK_SECRET: WH, ADMIN_TOKEN: 'admin-np', GAS_MAIL_URL: 'http://127.0.0.1:' + mailSrv.address().port,
  GAS_MAIL_TOKEN: 't', GAS_RELAY_IS_PLATFORM: 'true', NEW_PAYER_ALERT_TO: 'owner@roofmap.test', PLAN_CACHE_MS: '0',
  STRIPE_PRICE_SOLO: 'price_solo_149', STRIPE_PRICE_MEASURE: 'price_measure_79',
});
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const B = 'http://127.0.0.1:' + process.env.PORT;
const sign = p => { const t = Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', WH).update(t + '.' + p).digest('hex'); };
const hook = async (obj) => { const p = JSON.stringify(obj); const r = await fetch(B + '/billing/webhook', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(p) }, body: p }); await new Promise(r => setTimeout(r, 250)); return r.status; };
const alerts = () => mails.filter(m => /new paying subscriber/i.test(String(m.subject || '')));
const sub = u => db.subscriptions.find(s => s.user_id === u);

// ── a checkout that is paid: the owner hears, with their details ──
let st = await hook({ type: 'checkout.session.completed', data: { object: {
  id: 'cs_1', customer: 'cus_wlrr', subscription: 'sub_wlrr', client_reference_id: C1, payment_status: 'paid',
  amount_total: 17135, currency: 'nzd', created: sec(0), metadata: { company_id: C1, user_id: 'u1', plan: 'solo' } } } });
let a = alerts();
check('a paid checkout emails the owner "Congratulations — new paying subscriber"', st === 200 && a.length === 1 && a[0].to === 'owner@roofmap.test', JSON.stringify(mails.map(m => [m.to, m.subject])));
const body = a[0] ? String(a[0].text || a[0].body || '') : '';
check('…naming the business, the person, their email and phone', /WLRR/.test(a[0] && a[0].subject) && /Scott McKay/.test(body) && /info@wellingtonroof\.co\.nz/.test(body) && /021324523/.test(body), body.slice(0, 400));
check('…the plan and its price, the first payment and the date they started paying',
  /Plan: Trade \(\$149 \+ GST a month\)/.test(body) && /\$171\.35 NZD incl\. GST/.test(body) && /Paying since: \d+ \w+ \d{4}/.test(body), body);
check('…when they signed up, and how many businesses pay now', /Signed up: .* 30 days before paying/.test(body) && /Paying businesses now: \d/.test(body), body);
check('…and a reply goes straight to them', a[0] && (a[0].replyTo === 'info@wellingtonroof.co.nz' || a[0].reply_to === 'info@wellingtonroof.co.nz'), JSON.stringify(a[0] && { r: a[0].replyTo, r2: a[0].reply_to }));
check('paid_since and the claim are stamped on the subscription', !!sub('u1').paid_since && !!sub('u1').paid_alert_at, JSON.stringify(sub('u1')));

// ── the same payment again, as Stripe's invoice events: no second email ──
st = await hook({ type: 'invoice.paid', data: { object: { id: 'in_w1', customer: 'cus_wlrr', subscription: 'sub_wlrr', amount_paid: 17135, currency: 'nzd', created: sec(0), status_transitions: { paid_at: sec(0) } } } });
await hook({ type: 'invoice.payment_succeeded', data: { object: { id: 'in_w1', customer: 'cus_wlrr', parent: { subscription_details: { subscription: 'sub_wlrr' } }, amount_paid: 17135, currency: 'nzd', created: sec(0) } } });
check('the invoice events for that payment do not send it twice', st === 200 && alerts().length === 1, alerts().length + '');
const since1 = sub('u1').paid_since;
await hook({ type: 'invoice.paid', data: { object: { id: 'in_w2', customer: 'cus_wlrr', subscription: 'sub_wlrr', amount_paid: 17135, currency: 'nzd', created: sec(-30), status_transitions: { paid_at: sec(-30) } } } });
check('a renewal a month on is not a new subscriber, and paid_since stays the first payment', alerts().length === 1 && sub('u1').paid_since === since1, sub('u1').paid_since + ' ' + since1);

// ── an invoice that lands BEFORE the checkout, and a $0 one ──
await hook({ type: 'invoice.paid', data: { object: { id: 'in_k0', customer: 'cus_kauri', subscription: 'sub_kauri', amount_paid: 0, currency: 'nzd', created: sec(0) } } });
check('a $0 invoice is not paying: no email, no date', alerts().length === 1 && !sub('u2').paid_since, JSON.stringify(sub('u2')));
await hook({ type: 'invoice.paid', data: { object: { id: 'in_k1', customer: 'cus_kauri', subscription: 'sub_kauri', amount_paid: 9085, currency: 'nzd', created: sec(0) } } });
check('an invoice for a subscription not written yet is let go, not an error', alerts().length === 1, alerts().length + '');
await hook({ type: 'checkout.session.completed', data: { object: {
  id: 'cs_2', customer: 'cus_kauri', subscription: 'sub_kauri', client_reference_id: C2, payment_status: 'paid',
  amount_total: 9085, currency: 'nzd', created: sec(0), metadata: { company_id: C2, user_id: 'u2', plan: 'measure' } } } });
check('…and the checkout that follows tells the owner once', alerts().length === 2 && /Kauri Roofing/.test(alerts()[1].subject) && /Measure/.test(alerts()[1].subject), alerts().map(m => m.subject).join(' | '));

// ── the businesses that paid before this existed ──
const before = alerts().length;
let r = await fetch(B + '/admin/paid-since/run', { method: 'POST', headers: { 'x-admin-token': 'admin-np', Authorization: 'Bearer admin-np' } });
let j = await r.json().catch(() => ({}));
check('the backfill fills the paid dates off Stripe', r.status === 200 && j.filled === 2, JSON.stringify(j));
const tgm = sub('u3'), sig = sub('u4');
check('…from the first invoice that charged something, not the $0 one', Math.abs(Date.parse(tgm.paid_since) - sec(5) * 1000) < 2000 && Math.abs(Date.parse(sig.paid_since) - sec(60) * 1000) < 2000, tgm.paid_since + ' ' + sig.paid_since);
const late = alerts().slice(before);
check('one who started paying in the last fortnight gets the congratulations they missed', late.length === 1 && /tgm-roofing/.test(late[0].subject) && /found when the paid dates were filled in/.test(String(late[0].text || '')), late.map(m => m.subject).join(' | '));
check('…one from two months ago is marked told without an email', !!sig.paid_alert_at && !late.some(m => /Signature/.test(m.subject)), JSON.stringify(sig));
r = await fetch(B + '/admin/paid-since/run', { method: 'POST', headers: { 'x-admin-token': 'admin-np', Authorization: 'Bearer admin-np' } });
j = await r.json().catch(() => ({}));
check('run again it does nothing', j.filled === 0 && alerts().length === before + 1, JSON.stringify(j));

// ── the daily report carries the date ──
r = await fetch(B + '/admin/daily/preview?format=text', { headers: { 'x-admin-token': 'admin-np', Authorization: 'Bearer admin-np' } });
const txt = await r.text();
check('the daily report lists each paying business with the date it started paying', /tgm-roofing — .*paying since \d+ \w+ \d{4}/.test(txt) && /WLRR — .*paying since/.test(txt), txt.split('\n').filter(l => /paying since/.test(l)).join(' / ') || txt.slice(0, 300));

await new Promise(r => setTimeout(r, 100));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
