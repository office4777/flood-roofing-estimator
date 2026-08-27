// The Monday email. Four sections come out of our own database and must be
// exactly right; five come from somebody else's API and must degrade to
// "here is what I need" rather than to a zero that reads like a bad week.
//
// Two things here are load-bearing and easy to get wrong:
//   · a business that fires a milestone twice counts ONCE in activation and
//     TWICE in usage — those are different questions;
//   · a date window has to actually exclude what is outside it. The fake
//     PostgREST had no gte/lt until this suite needed one, so every windowed
//     query used to return the whole table and would have passed regardless.
//     The 90-day-old events below exist to fail if that regresses.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const NOW = Date.now();
const d = (n) => new Date(NOW - n * 864e5).toISOString();
const C1 = 'cccccccc-0000-0000-0000-000000000001';   // signed up 3 days ago, Business
const C2 = 'cccccccc-0000-0000-0000-000000000002';   // signed up 5 days ago, Solo
const C3 = 'cccccccc-0000-0000-0000-000000000003';   // signed up 10 days ago, trial
const C4 = 'cccccccc-0000-0000-0000-000000000004';   // 40 days old, Team

const db = {
  companies: [
    { id: C1, name:'Northland Roofing', plan:'business', created_at: d(3) },
    { id: C2, name:'Bay Roofing',       plan:'solo',     created_at: d(5) },
    { id: C3, name:'Kaipara Roofing',   plan:'trial',    created_at: d(10) },
    { id: C4, name:'Hokianga Roofing',  plan:'team',     created_at: d(40) },
  ],
  waitlist: [
    { id:1, email:'a@x.co.nz', business:'A Roofing', created_at: d(1),  status:'new' },
    { id:2, email:'b@x.co.nz', business:'B Roofing', created_at: d(2),  status:'invited' },
    { id:3, email:'c@x.co.nz', business:'C Roofing', created_at: d(9),  status:'new' },
    { id:4, email:'e@x.co.nz', business:'E Roofing', created_at: d(20), status:'new' },
  ],
  company_invites: [
    { id:'i1', created_at: d(2),  accepted_at: d(1) },
    { id:'i2', created_at: d(4),  accepted_at: null },
    { id:'i3', created_at: d(20), accepted_at: null },
  ],
  usage_events: [
    // this week
    { company_id: C1, name:'signed_up',      at: d(3) },
    { company_id: C1, name:'setup_done',     at: d(3) },
    { company_id: C1, name:'roof_drawn',     at: d(2) },
    { company_id: C1, name:'roof_drawn',     at: d(2) },   // same business, twice
    { company_id: C1, name:'job_saved',      at: d(2) },
    { company_id: C1, name:'quote_sent',     at: d(1) },
    { company_id: C2, name:'signed_up',      at: d(5) },
    { company_id: C2, name:'roof_drawn',     at: d(4) },
    { company_id: C2, name:'quote_sent',     at: d(1) },
    { company_id: C2, name:'quote_accepted', at: d(1) },
    // the week before
    { company_id: C3, name:'signed_up', at: d(10) },
    { company_id: C3, name:'job_saved', at: d(9) },
    // outside every window this email looks at
    { company_id: C4, name:'signed_up',  at: d(90) },
    { company_id: C4, name:'order_sent', at: d(90) },
  ],
  subscriptions: [
    { user_id:'u1', company_id: C1, status:'active',   plan:'business', updated_at: d(2) },
    { user_id:'u2', company_id: C3, status:'canceled', plan:'solo',     updated_at: d(1) },
    { user_id:'u3', company_id: C4, status:'canceled', plan:'team',     updated_at: d(10) },
    { user_id:'u4', company_id: null, status:'pending', plan:null,      updated_at: d(6) },
  ],
  invoices: [
    { id:'v1', total: 4600, created_at: d(2),  status:'sent' },
    { id:'v2', total: 1200, created_at: d(20), status:'paid' },
  ],
  platform_state: [],
  company_users: [], profiles: [], jobs: [], user_settings: [], company_domains: [],
};

// ── the marketing site, stubbed ─────────────────────────────────────
// The AEO check fetches robots.txt, llms.txt and sitemap.xml for real. Pointed
// at this instead of the live site, so the suite is offline and so the
// blocked-crawler case can actually be produced.
const GOOD_ROBOTS = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n';
const BAD_ROBOTS  = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /\n';
let robotsBody = GOOD_ROBOTS;
const site = http.createServer((req, res) => {
  if (req.url === '/robots.txt') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end(robotsBody); }
  if (req.url === '/llms.txt')   { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('# RoofMap\n' + 'Roof measuring and quoting for New Zealand roofers. '.repeat(6)); }
  if (req.url === '/sitemap.xml'){ res.writeHead(200, {'Content-Type':'application/xml'});
    return res.end('<urlset><url><loc>https://x/</loc></url><url><loc>https://x/pricing</loc></url><url><loc>https://x/guides</loc></url></urlset>'); }
  res.writeHead(404); res.end('');
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + site.address().port;

const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34591';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.METRICS_SITE_URL = SITE;
process.env.METRICS_EMAIL_TO = 'aron@roofmap.co.nz';
// Nothing connected — which is the real state of the business, and the state
// four of these sections have to render well.
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
delete process.env.SEARCH_CONSOLE_SITE;
delete process.env.GA4_PROPERTY_ID;
delete process.env.FACEBOOK_PAGE_ID;
delete process.env.FACEBOOK_PAGE_TOKEN;
delete process.env.MAILCHIMP_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.METRICS_EMAIL_PLATFORM;
delete process.env.DATABASE_URL;

// Catch the email instead of sending it.
const sent = [];
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = 'let-me-in-please-0000';

// A second instance we own, so sections can be exercised directly and the mail
// can be captured without reaching for the network.
const { createClient } = require('@supabase/supabase-js');
const { createMetrics, nzParts } = require('./metrics.js');
const sb = createClient('http://127.0.0.1:' + port, 'k', { auth:{ persistSession:false } });
const M = createMetrics({
  supabase: sb,
  dispatchMail: async (m) => { sent.push(m); return { messageId:'x' }; },
  usageEvents: ['signed_up','setup_done','sample_opened','roof_drawn','job_saved','price_book_saved','quote_sent','quote_accepted','order_sent','waitlist_submit'],
  buildSha: 'testsha',
  warn: () => {},
});

const rep = await M.collect();
const sec = (k) => rep.sections.find(s => s.key === k) || {};
const val = (k, label) => { const r = (sec(k).rows || []).find(x => x.label === label); return r ? r.value : undefined; };
const hint = (k, label) => { const r = (sec(k).rows || []).find(x => x.label === label); return r ? r.hint : undefined; };

// ── the report holds together ───────────────────────────────────────
check('every section is present', rep.sections.length === 9, rep.sections.map(s=>s.key).join(','));
check('no section threw', !rep.sections.some(s => s.error), JSON.stringify(rep.sections.filter(s=>s.error).map(s=>s.key+': '+s.error)));

// ── growth ──────────────────────────────────────────────────────────
check('new businesses counts only the last seven days', val('growth','New businesses signed up') === 2, String(val('growth','New businesses signed up')));
check('…and compares against the week before', /up 1 on last week/.test(hint('growth','New businesses signed up') || ''), hint('growth','New businesses signed up'));
check('early-access requests count this week only', val('growth','Early-access requests') === 2, String(val('growth','Early-access requests')));
check('the queue counts only the ones not yet invited', val('growth','Waiting to be invited') === 3, String(val('growth','Waiting to be invited')));
check('invites sent this week, with how many were taken up',
  val('growth','Invites sent this week') === 2 && /1 accepted/.test(hint('growth','Invites sent this week') || ''),
  val('growth','Invites sent this week') + ' / ' + hint('growth','Invites sent this week'));
check('total businesses is every company', val('growth','Businesses on RoofMap') === 4, String(val('growth','Businesses on RoofMap')));

// ── activation: once per business, and inside the cohort window ─────
check('a business that drew two roofs still counts once in activation',
  val('activation','Drew a roof') === 2, String(val('activation','Drew a roof')));
check('the signup cohort is the last 30 days, not all time',
  val('activation','Signed up') === 3, String(val('activation','Signed up')));
check('milestones are shown as a share of that cohort',
  hint('activation','Drew a roof') === '67% of them', hint('activation','Drew a roof'));
// The head of a funnel is always 100% of itself; printing that reads as a
// measurement when it is arithmetic restating the row.
check('the cohort row does not report itself as 100%',
  !/100%/.test(hint('activation','Signed up') || ''), hint('activation','Signed up'));
// If the date filter is not applied, C4's 90-day-old order_sent lands here.
check('a milestone from three months ago is outside the cohort',
  val('activation','Ordered material') === 0, String(val('activation','Ordered material')));
check('a milestone nobody reached reads zero, not missing',
  val('activation','Entered their own prices') === 0, String(val('activation','Entered their own prices')));

// ── engagement: per event, not per business ────────────────────────
check('two roofs by one business are two roofs drawn',
  val('engagement','Roofs drawn') === 3, String(val('engagement','Roofs drawn')));
check('active businesses are counted once each',
  val('engagement','Businesses active this week') === 2, String(val('engagement','Businesses active this week')));
check('…and compared with the week before', /up 1 on last week/.test(hint('engagement','Businesses active this week') || ''), hint('engagement','Businesses active this week'));
check('the accept rate is against quotes sent, not quotes existing',
  val('engagement','Quotes accepted') === 1 && /50% of quotes sent/.test(hint('engagement','Quotes accepted') || ''),
  hint('engagement','Quotes accepted'));
check('invoices raised counts this week only', val('engagement','Invoices raised in RoofMap') === 1, String(val('engagement','Invoices raised in RoofMap')));

// ── money ───────────────────────────────────────────────────────────
check('MRR sums the plan each paying business is on', val('revenue','MRR') === '$997', String(val('revenue','MRR')));
check('ARR is twelve months of it', val('revenue','ARR') === '$11,964', String(val('revenue','ARR')));
check('a trial business is not counted as paying', val('revenue','Paying businesses') === 3, String(val('revenue','Paying businesses')));
check('cancellations this week are separated from last week\'s',
  val('revenue','Cancelled this week') === 1 && /same as last week/.test(hint('revenue','Cancelled this week') || ''),
  val('revenue','Cancelled this week') + ' / ' + hint('revenue','Cancelled this week'));
check('churn is cancels over the businesses there were at the start', val('revenue','Monthly churn') === '25%', String(val('revenue','Monthly churn')));
check('accounts signed up but not paying are visible', val('revenue','Accounts not yet paying') === 1, String(val('revenue','Accounts not yet paying')));
// C1 is the one that went active this week and it is on Business. This must be
// that plan's actual price, not the average revenue per customer ($332) that
// this row used to multiply out and present as fact.
check('new revenue is the new subscriber\'s real plan price, not an average',
  /^\$549 added/.test(hint('revenue','New paid this week') || ''), hint('revenue','New paid this week'));
check('plan names in the breakdown are the ones on the pricing page',
  /1 Business/.test(hint('revenue','Paying businesses') || ''), hint('revenue','Paying businesses'));

// ── nothing connected is a first-class state, never a zero ─────────
for (const [k, title] of [['search','SEO'], ['analytics','traffic'], ['social','Facebook'], ['email','email marketing']]){
  const s = sec(k);
  check(k + ': says not connected rather than reporting nothing happened',
    s.connected === false && !s.error && (s.rows || []).length === 0, JSON.stringify({ connected:s.connected, rows:(s.rows||[]).length, error:s.error }));
  // Every card must name at least one actual variable — a card that only says
  // "connect Facebook" is the thing this is here to prevent — and it must also
  // say what you'd get for the trouble.
  check(k + ': names the variables it needs to switch on',
    Array.isArray(s.needs) && s.needs.some(n => /[A-Z][A-Z_]{5,}/.test(n)) && s.needs.every(n => n.length > 10),
    JSON.stringify(s.needs));
  check(k + ': says what it would show once connected',
    typeof s.note === 'string' && s.note.length > 30, String(s.note));
}

// ── AEO: measure what is measurable, say so about the rest ─────────
const ae = sec('aeo');
check('AEO always renders, connected or not', ae.connected === true && (ae.rows || []).length >= 4, JSON.stringify((ae.rows||[]).map(r=>r.label)));
check('robots.txt is fetched, not assumed', val('aeo','robots.txt reachable') === 'yes', String(val('aeo','robots.txt reachable')));
// Every AEO row is a verdict plus a note. A sentence in the value column is
// what pushed this email 55px wider than a phone screen.
check('AEO values are verdicts, not sentences',
  (sec('aeo').rows || []).every(r => String(r.value).length <= 4),
  JSON.stringify((sec('aeo').rows || []).map(r => r.value)));
// A healthy llms.txt is a few hundred bytes. Rounded to KB it read "0 KB",
// which looks exactly like an empty file.
check('a sub-kilobyte llms.txt reports its real size, not 0 KB',
  val('aeo','llms.txt reachable') === 'yes' && /^\d+ bytes$/.test(String(hint('aeo','llms.txt reachable'))),
  String(hint('aeo','llms.txt reachable')));
check('the sitemap is counted, not just pinged', /3 pages listed/.test(String(hint('aeo','sitemap.xml reachable'))), String(hint('aeo','sitemap.xml reachable')));
// The stub names GPTBot and ClaudeBot only. The count has to come from the
// file that was fetched, not from the length of the array in metrics.js.
check('the crawler count reflects the robots.txt actually fetched',
  val('aeo','Assistants allowed to crawl') === 'yes' &&
  /^2 of \d+ named explicitly, none blocked$/.test(String(hint('aeo','Assistants allowed to crawl'))),
  String(hint('aeo','Assistants allowed to crawl')));
check('AI referrals say what they need rather than showing zero',
  val('aeo','Visits from AI assistants') === '—' && /Google Analytics/.test(hint('aeo','Visits from AI assistants') || ''),
  val('aeo','Visits from AI assistants') + ' / ' + hint('aeo','Visits from AI assistants'));
check('the email is honest that citations have no API',
  /No API anywhere/.test(ae.note || ''), (ae.note || '').slice(0, 60));
check('…and gives prompts to check by hand instead',
  (ae.lists || []).some(l => (l.items || []).length >= 3), JSON.stringify((ae.lists||[]).map(l=>l.items.length)));

// The check that earns its keep: a crawler blocked in a deploy.
robotsBody = BAD_ROBOTS;
const rep2 = await M.collect();
const blocked = (rep2.sections.find(s => s.key === 'aeo').rows || []).find(r => r.label === 'Assistants allowed to crawl');
check('an assistant blocked in robots.txt is caught',
  String(blocked && blocked.value) === 'NO' && /GPTBot/.test(String(blocked && blocked.hint)),
  JSON.stringify(blocked));
robotsBody = GOOD_ROBOTS;

// ── one broken API must not cost the other eight numbers ───────────
// A Mailchimp key with no data-centre suffix. It has to be dashless: anything
// after a dash is READ as the data centre, so 'no-such-key' would send a real
// request to no.api.mailchimp.com rather than failing where it should.
process.env.MAILCHIMP_API_KEY = 'abcdef0123456789abcdef0123456789';
const rep3 = await M.collect();
const es = rep3.sections.find(s => s.key === 'email');
check('a section that throws reports its error', !!es.error && /data-centre/.test(es.error), String(es.error));
check('…and the rest of the email survives it',
  rep3.sections.filter(s => s.error).length === 1 &&
  (rep3.sections.find(s => s.key === 'revenue').rows || []).length > 0, JSON.stringify(rep3.sections.filter(s=>s.error).map(s=>s.key)));
delete process.env.MAILCHIMP_API_KEY;

// ── the email itself ────────────────────────────────────────────────
const txt = M.renderText(rep);
check('the plain-text email carries the headline numbers', txt.includes('$997') && /New businesses signed up \.+ 2/.test(txt), txt.slice(0, 60));
check('the new early-access names are listed under a heading, not loose',
  /Who asked for access this week:/.test(txt) && txt.includes('A Roofing'), '');
check('…and tells you what is not connected yet', /Not connected/.test(txt) && /FACEBOOK_PAGE_ID/.test(txt));
const html = M.renderHtml(rep);
check('the HTML email is a whole document', /^<!doctype html>/i.test(html) && html.includes('</html>'));
check('…with the numbers in it', html.includes('$997') && html.includes('Roofs drawn'));
check('…and escapes what it renders', !/<script/i.test(html));
// Two columns at every width. As three, the note column had to be hidden below
// 520px, which took "up 1 on last week" off the screen it is most read on —
// and the widest note dragged the page 55px past a 390px phone.
check('every row is label-plus-note and value, so nothing is hidden on a phone',
  !/class="h"><\/td>|<td class="h"/.test(html) && /<span class="h">up 1 on last week<\/span>/.test(html));
check('no rule hides the notes at narrow widths', !/max-width:520px/.test(html));

// ── the schedule ────────────────────────────────────────────────────
// Find a real Monday 8am in New Zealand rather than hardcoding a UTC offset
// that daylight saving invalidates twice a year.
let monday8 = null, sunday8 = null, monday5 = null;
for (let i = 0; i < 24 * 9 && (!monday8 || !sunday8 || !monday5); i++){
  const t = NOW + i * 3600e3, p = nzParts(new Date(t));
  if (!monday8 && p.dow === 1 && p.hour === 8) monday8 = t;
  if (!monday5 && p.dow === 1 && p.hour === 5) monday5 = t;
  if (!sunday8 && p.dow === 0 && p.hour === 8) sunday8 = t;
}
check('due on a Monday morning with nothing sent yet', (await M.due(monday8)) === true, new Date(monday8).toISOString());
check('not due on a Sunday', (await M.due(sunday8)) === false);
check('not due before the hour, even on the right day', (await M.due(monday5)) === false);
db.platform_state.push({ key:'metrics_digest', value:{ last_sent_at: new Date(monday8 - 2 * 864e5).toISOString() }, updated_at: d(2) });
check('not due again two days after a send', (await M.due(monday8)) === false);
db.platform_state[0].value = { last_sent_at: new Date(monday8 - 8 * 864e5).toISOString() };
check('due again eight days after a send', (await M.due(monday8)) === true);
db.platform_state.length = 0;

// ── sending ─────────────────────────────────────────────────────────
await M.sendNow();
check('the email goes to Aron', sent.length === 1 && sent[0].to === 'aron@roofmap.co.nz', JSON.stringify(sent[0] && sent[0].to));
check('it has a subject with the week in it', /RoofMap weekly — /.test(sent[0].subject || ''), sent[0] && sent[0].subject);
check('it is sent as both text and HTML', !!sent[0].text && !!sent[0].html);
check('the send is written down so a redeploy cannot repeat it',
  db.platform_state.length === 1 && !!db.platform_state[0].value.last_sent_at, JSON.stringify(db.platform_state));

// ── the admin routes ────────────────────────────────────────────────
let r = await fetch(BASE + '/admin/metrics');
check('the report is not readable without the admin token', r.status === 404, String(r.status));
r = await fetch(BASE + '/admin/metrics?token=' + TOK);
const rb = await r.json().catch(() => null);
check('…and readable with it', r.status === 200 && rb && rb.sections.length === 9, String(r.status));
r = await fetch(BASE + '/admin/metrics/preview?token=' + TOK);
const pv = await r.text();
check('the preview renders the email in a browser', r.status === 200 && /^<!doctype html>/i.test(pv));
r = await fetch(BASE + '/admin/metrics/preview?format=text&token=' + TOK);
check('…and as plain text on request', (r.headers.get('content-type') || '').includes('text/plain'));
r = await fetch(BASE + '/admin/metrics/send', { method:'POST' });
check('sending by hand is shut without the token', r.status === 404, String(r.status));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
site.close();
process.exit(fails ? 1 : 0);
