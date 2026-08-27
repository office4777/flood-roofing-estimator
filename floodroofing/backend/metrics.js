// ══════════════════════════════════════════════════════════════════
// THE MONDAY EMAIL — what happened to the business last week
// ══════════════════════════════════════════════════════════════════
//
// One email, once a week, with the numbers that tell you whether RoofMap is
// growing. Not a dashboard nobody opens: a thing that arrives whether or not
// anybody remembered to look.
//
// The design rule that matters here is HONESTY ABOUT WHAT IS MEASURED. A
// weekly number that is quietly a guess is worse than no number, because you
// will make decisions on it. So:
//
//   • Everything in the first four sections comes out of our own database and
//     is exact. It needs no keys and cannot break.
//   • Everything after that is somebody else's API. Each one is behind its own
//     credential and, when that credential is missing, the section says
//     "not connected" and tells you the two lines it needs — it does NOT
//     silently render zeros that look like a bad week.
//   • AEO — whether ChatGPT, Claude and Perplexity are recommending RoofMap
//     when a roofer asks them — has no API to read, anywhere, from anybody.
//     Nobody sells that number honestly. So this measures the part that IS
//     measurable (are we readable and are they sending traffic) and says
//     plainly that the citations themselves have to be spot-checked by hand.
//
// A section that throws is caught and reported as an error inside the email.
// One dead API never costs you the other eight numbers.

'use strict';

const DAY = 864e5;

// ── Plan prices, for MRR ───────────────────────────────────────────
// NZD per month, excluding GST, matching what pricing.html promises. Overridable
// because the price on the page and the price in this file must never drift
// apart silently — if the tiers move, these move with an env var on the day
// rather than at the next deploy.
const PLAN_PRICE = {
  solo:     Number(process.env.PLAN_PRICE_SOLO     || 149),
  team:     Number(process.env.PLAN_PRICE_TEAM     || 299),
  business: Number(process.env.PLAN_PRICE_BUSINESS || 549),
  monthly:  Number(process.env.PLAN_PRICE_SOLO     || 149),   // legacy rows from before the tiers
};
const PLAN_LABEL = { solo:'Solo', team:'Team', business:'Business', monthly:'Solo (legacy)' };

const SITE = (process.env.METRICS_SITE_URL || process.env.PUBLIC_APP_URL || 'https://roofmap.co.nz').replace(/\/+$/, '');

// A fetch that cannot hang the weekly job. Every outbound call in this file
// goes through it.
async function _get(url, opts, ms){
  const ctl = new AbortController();
  const t = setTimeout(function(){ ctl.abort(); }, ms || 12000);
  try { return await fetch(url, Object.assign({ signal: ctl.signal }, opts || {})); }
  finally { clearTimeout(t); }
}
async function _json(url, opts, ms){
  const r = await _get(url, opts, ms);
  const body = await r.json().catch(function(){ return null; });
  if (!r.ok) {
    const msg = (body && (body.error_description || (body.error && (body.error.message || body.error)) || body.message)) || ('HTTP ' + r.status);
    throw new Error(String(msg).slice(0, 200));
  }
  return body;
}

function pct(n, d){ return d ? Math.round((n / d) * 100) : 0; }
function money(n){
  return '$' + Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
// "up 3" / "down 1" / "same" against the week before. The point of a weekly
// email is the direction, not the number.
function delta(now, was){
  const d = (now || 0) - (was || 0);
  if (!d) return 'same as last week';
  return (d > 0 ? 'up ' : 'down ') + Math.abs(d) + ' on last week';
}

// ── When is it Monday in Whangarei? ────────────────────────────────
// Railway runs in UTC. A weekly email that fires on UTC Monday lands at 1pm
// Sunday in New Zealand for half the year and 12pm the other half, which is
// both wrong and inconsistent. So the schedule is evaluated in NZ local time,
// daylight saving included, by asking Intl rather than by doing offset
// arithmetic that breaks twice a year.
function nzParts(d){
  const f = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', weekday: 'short', hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = {};
  f.formatToParts(d).forEach(function(x){ p[x.type] = x.value; });
  const DOW = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return { dow: DOW[p.weekday], hour: parseInt(p.hour, 10) % 24, date: p.year + '-' + p.month + '-' + p.day };
}
function nzDate(d){
  return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function createMetrics(deps){
  const supabase = deps.supabase;
  const dispatchMail = deps.dispatchMail;
  const usageNames = deps.usageEvents || [];
  const buildSha = deps.buildSha || '';
  const warn = deps.warn || function(){};

  const TO = (process.env.METRICS_EMAIL_TO || 'aron@roofmap.co.nz').trim();
  const FROM = (process.env.METRICS_EMAIL_FROM || process.env.ACCOUNTS_EMAIL || 'accounts@roofmap.co.nz').trim();
  const SEND_DOW  = Math.min(6, Math.max(0, parseInt(process.env.METRICS_DAY, 10) >= 0 ? parseInt(process.env.METRICS_DAY, 10) : 1));
  const SEND_HOUR = Math.min(23, Math.max(0, parseInt(process.env.METRICS_HOUR, 10) >= 0 ? parseInt(process.env.METRICS_HOUR, 10) : 7));

  // Rows out of a table, or an empty list. A table that hasn't been migrated
  // yet must not take the whole email down with it.
  async function rows(table, select, build){
    try {
      let q = supabase.from(table).select(select || '*').limit(20000);
      if (build) q = build(q);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    } catch (e){ warn('[metrics] ' + table + ': ' + e.message); return []; }
  }
  const since = (d, ms) => new Date(d - ms).toISOString();
  const within = (v, from, to) => { const t = Date.parse(v || ''); return isFinite(t) && t >= from && t < to; };

  // ════════════════════════════════════════════════════════════════
  // 1–4. OUR OWN NUMBERS — exact, no credentials, cannot break
  // ════════════════════════════════════════════════════════════════

  // How many roofing businesses arrived, and how many are queued to.
  async function growth(now){
    const wk = now - 7 * DAY, prev = now - 14 * DAY;
    const cos = await rows('companies', 'id, name, created_at, plan');
    const wl  = await rows('waitlist', 'id, email, business, created_at, status');
    const inv = await rows('company_invites', 'id, created_at, accepted_at');
    const newCo   = cos.filter(function(c){ return within(c.created_at, wk, now); });
    const prevCo  = cos.filter(function(c){ return within(c.created_at, prev, wk); });
    const newWl   = wl.filter(function(w){ return within(w.created_at, wk, now); });
    const prevWl  = wl.filter(function(w){ return within(w.created_at, prev, wk); });
    return { key:'growth', title:'Growth', connected:true, rows:[
      { label:'New businesses signed up', value:newCo.length, hint:delta(newCo.length, prevCo.length) },
      { label:'Early-access requests',    value:newWl.length, hint:delta(newWl.length, prevWl.length) },
      { label:'Waiting to be invited',    value:wl.filter(function(w){ return (w.status || 'new') === 'new'; }).length,
        hint:'of ' + wl.length + ' on the list all up' },
      { label:'Invites sent this week',   value:inv.filter(function(i){ return within(i.created_at, wk, now); }).length,
        hint:inv.filter(function(i){ return within(i.accepted_at, wk, now); }).length + ' accepted' },
      { label:'Businesses on RoofMap',    value:cos.length, hint:'all time' },
    ], lists: newWl.length ? [{ title:'Who asked for access this week',
      items: newWl.slice(0, 10).map(function(w){ return (w.business || w.email) + (w.business ? ' — ' + w.email : ''); }) }] : [] };
  }

  // Of the businesses that signed up recently, how far into the product did
  // they actually get? This is the single most useful number in the email:
  // it separates "nobody is signing up" from "they sign up and never draw a
  // roof", which are different problems with different fixes.
  async function activation(now){
    const ev = await rows('usage_events', 'company_id, name, at', function(q){ return q.gte('at', since(now, 60 * DAY)); });
    const cohortFrom = now - 30 * DAY;
    const reached = new Map();
    ev.forEach(function(e){
      if (!within(e.at, cohortFrom, now)) return;
      if (!reached.has(e.name)) reached.set(e.name, new Set());
      reached.get(e.name).add(e.company_id || 'anon');
    });
    const signed = (reached.get('signed_up') || new Set()).size;
    const steps = ['signed_up', 'setup_done', 'price_book_saved', 'roof_drawn', 'job_saved', 'quote_sent', 'quote_accepted', 'order_sent']
      .filter(function(n){ return !usageNames.length || usageNames.indexOf(n) >= 0; });
    const LABEL = {
      signed_up:'Signed up', setup_done:'Put their own details in', price_book_saved:'Entered their own prices',
      roof_drawn:'Drew a roof', job_saved:'Saved a job', quote_sent:'Sent a quote to a customer',
      quote_accepted:'Had a quote accepted', order_sent:'Ordered material',
    };
    return { key:'activation', title:'Activation — last 30 days of signups', connected:true,
      note: signed ? null : 'No signups in the last 30 days, so there is no cohort to follow yet.',
      rows: steps.map(function(n){
        const c = (reached.get(n) || new Set()).size;
        // The head of a funnel is always 100% of itself. Printing that reads
        // like a measurement and is really just arithmetic restating the row.
        const h = n === 'signed_up' ? 'the cohort everything below is measured against'
                : signed ? pct(c, signed) + '% of them' : '—';
        return { label:LABEL[n] || n, value:c, hint:h };
      }) };
  }

  // Are the businesses already here using it? Counted per business, not per
  // event, so one busy subscriber can't make a quiet week look busy.
  async function engagement(now){
    const wk = now - 7 * DAY, prev = now - 14 * DAY;
    const ev = await rows('usage_events', 'company_id, name, at', function(q){ return q.gte('at', since(now, 30 * DAY)); });
    const inWin = function(from, to){ return ev.filter(function(e){ return within(e.at, from, to); }); };
    const thisWk = inWin(wk, now), lastWk = inWin(prev, wk);
    const biz = function(list){ return new Set(list.map(function(e){ return e.company_id || 'anon'; })).size; };
    const count = function(list, n){ return list.filter(function(e){ return e.name === n; }).length; };
    const invoices = await rows('invoices', 'id, total, created_at, status');
    return { key:'engagement', title:'Are they using it', connected:true, rows:[
      { label:'Businesses active this week', value:biz(thisWk), hint:delta(biz(thisWk), biz(lastWk)) },
      { label:'Roofs drawn',    value:count(thisWk, 'roof_drawn'),    hint:delta(count(thisWk, 'roof_drawn'), count(lastWk, 'roof_drawn')) },
      { label:'Jobs saved',     value:count(thisWk, 'job_saved'),     hint:delta(count(thisWk, 'job_saved'), count(lastWk, 'job_saved')) },
      { label:'Quotes sent',    value:count(thisWk, 'quote_sent'),    hint:delta(count(thisWk, 'quote_sent'), count(lastWk, 'quote_sent')) },
      { label:'Quotes accepted', value:count(thisWk, 'quote_accepted'),
        hint: count(thisWk, 'quote_sent') ? pct(count(thisWk, 'quote_accepted'), count(thisWk, 'quote_sent')) + '% of quotes sent' : 'none sent' },
      { label:'Material orders sent', value:count(thisWk, 'order_sent'), hint:delta(count(thisWk, 'order_sent'), count(lastWk, 'order_sent')) },
      { label:'Invoices raised in RoofMap', value:invoices.filter(function(i){ return within(i.created_at, wk, now); }).length,
        hint:'by subscribers, to their own customers' },
    ] };
  }

  // The money. MRR is computed from the plan each paying business is on
  // rather than read back from Stripe, so it works before billing is live and
  // keeps working if a Stripe call fails on a Monday morning.
  async function revenue(now){
    const wk = now - 7 * DAY, prev = now - 14 * DAY;
    const subs = await rows('subscriptions', 'user_id, company_id, status, plan, trial_ends_at, current_period_end, updated_at');
    const cos  = await rows('companies', 'id, plan, created_at');
    const paying = cos.filter(function(c){ return PLAN_PRICE[String(c.plan || '').toLowerCase()] > 0; });
    const mrr = paying.reduce(function(s, c){ return s + PLAN_PRICE[String(c.plan).toLowerCase()]; }, 0);
    const byPlan = {};
    paying.forEach(function(c){ const p = String(c.plan).toLowerCase(); byPlan[p] = (byPlan[p] || 0) + 1; });
    const cancelled = subs.filter(function(s){ return s.status === 'canceled' && within(s.updated_at, wk, now); });
    const cancelledPrev = subs.filter(function(s){ return s.status === 'canceled' && within(s.updated_at, prev, wk); });
    const newPaid = subs.filter(function(s){ return s.status === 'active' && within(s.updated_at, wk, now); });
    const pending = subs.filter(function(s){ return s.status === 'pending'; });
    // What the new subscriptions are ACTUALLY worth — each one looked up
    // against the plan its business is on. This used to be the average revenue
    // per customer multiplied by the count, which is a plausible-looking number
    // that is wrong whenever the tiers aren't evenly spread, and this email has
    // no business printing an estimate next to four exact figures.
    const planOf = {};
    cos.forEach(function(c){ planOf[c.id] = String(c.plan || '').toLowerCase(); });
    let newMrr = 0, newUnknown = 0;
    newPaid.forEach(function(s){
      const p = PLAN_PRICE[planOf[s.company_id]];
      if (p > 0) newMrr += p; else newUnknown++;
    });
    const rowsOut = [
      { label:'MRR', value:money(mrr), hint:'excl GST, from ' + paying.length + ' paying business' + (paying.length === 1 ? '' : 'es') },
      { label:'ARR', value:money(mrr * 12), hint:'MRR × 12' },
      { label:'Paying businesses', value:paying.length,
        hint:Object.keys(byPlan).length ? Object.keys(byPlan).map(function(p){ return byPlan[p] + ' ' + (PLAN_LABEL[p] || p); }).join(', ') : 'none yet' },
      { label:'New paid this week', value:newPaid.length,
        hint: !newPaid.length ? 'none'
          : money(newMrr) + ' added' + (newUnknown ? ' (' + newUnknown + ' on an unknown plan)' : '') },
      { label:'Cancelled this week', value:cancelled.length, hint:delta(cancelled.length, cancelledPrev.length) },
      { label:'Monthly churn', value: paying.length ? pct(cancelled.length, paying.length + cancelled.length) + '%' : '—',
        hint: paying.length ? 'cancels ÷ businesses at the start of the week' : 'no paying businesses yet' },
      { label:'Accounts not yet paying', value:pending.length, hint:'signed up, no subscription' },
    ];
    return { key:'revenue', title:'Money', connected:true,
      note: paying.length ? null : 'Nobody is on a paid plan yet, so MRR is $0 by fact rather than by error.',
      rows: rowsOut };
  }

  // ════════════════════════════════════════════════════════════════
  // 5–9. SOMEBODY ELSE'S API — each behind its own credential
  // ════════════════════════════════════════════════════════════════

  // A "not connected" section. This is deliberately a first-class result and
  // not an error: not having hooked Facebook up yet is a normal state, and the
  // email's job in that state is to tell you exactly what it needs.
  function offline(key, title, needs, why){
    return { key:key, title:title, connected:false, needs:needs, note:why || null, rows:[] };
  }

  // Google service-account auth, shared by Search Console and GA4. Signs the
  // assertion ourselves with the key already in the dependency list — no new
  // package for one JWT.
  let _googleTok = null;   // { token, exp }
  async function googleToken(scope){
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
    if (!raw) return null;
    if (_googleTok && _googleTok.exp > Date.now() + 60e3 && _googleTok.scope === scope) return _googleTok.token;
    // Accept the JSON either raw or base64'd — pasting a multi-line private key
    // into a hosting panel mangles the newlines often enough to be worth it.
    let sa;
    try { sa = JSON.parse(/^\s*\{/.test(raw) ? raw : Buffer.from(raw, 'base64').toString('utf8')); }
    catch (e){ throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
    if (!sa.client_email || !sa.private_key) throw new Error('service account JSON has no client_email/private_key');
    const jwt = require('jsonwebtoken');
    const iat = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({
      iss: sa.client_email, scope: scope, aud: 'https://oauth2.googleapis.com/token', iat: iat, exp: iat + 3600,
    }, String(sa.private_key).replace(/\\n/g, '\n'), { algorithm: 'RS256' });
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion });
    const out = await _json('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    _googleTok = { token: out.access_token, exp: Date.now() + (out.expires_in || 3600) * 1000, scope: scope };
    return _googleTok.token;
  }

  // What people searched for and whether they clicked. Search Console lags
  // about two days, so the window ends two days back — comparing a fresh week
  // against a settled one is how you invent a decline that isn't there.
  async function searchConsole(now){
    const site = (process.env.SEARCH_CONSOLE_SITE || '').trim();
    if (!site || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return offline('search', 'SEO — Google Search', [
        'GOOGLE_SERVICE_ACCOUNT_JSON — a Google Cloud service account key, as JSON',
        'SEARCH_CONSOLE_SITE — e.g. sc-domain:roofmap.co.nz',
        'Then add that service account\'s email as a user in Search Console.',
      ], 'Clicks, impressions, average position and the queries RoofMap is being found for.');
    }
    const tok = await googleToken('https://www.googleapis.com/auth/webmasters.readonly');
    const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(site) + '/searchAnalytics/query';
    const day = function(ms){ return new Date(now - ms).toISOString().slice(0, 10); };
    const ask = function(dims, start, end){
      return _json(url, { method:'POST', headers:{ Authorization:'Bearer ' + tok, 'Content-Type':'application/json' },
        body: JSON.stringify({ startDate:start, endDate:end, dimensions:dims || [], rowLimit:10 }) });
    };
    const cur  = await ask([], day(9 * DAY), day(2 * DAY));
    const prevW = await ask([], day(16 * DAY), day(9 * DAY));
    const q = await ask(['query'], day(9 * DAY), day(2 * DAY));
    const p = await ask(['page'],  day(9 * DAY), day(2 * DAY));
    const c = (cur.rows && cur.rows[0]) || {}, b = (prevW.rows && prevW.rows[0]) || {};
    return { key:'search', title:'SEO — Google Search', connected:true,
      note:'Seven days ending ' + day(2 * DAY) + '. Search Console runs about two days behind, so the window stops there.',
      rows:[
        { label:'Clicks',        value:Math.round(c.clicks || 0),      hint:delta(Math.round(c.clicks || 0), Math.round(b.clicks || 0)) },
        { label:'Impressions',   value:Math.round(c.impressions || 0), hint:delta(Math.round(c.impressions || 0), Math.round(b.impressions || 0)) },
        { label:'Click-through', value:((c.ctr || 0) * 100).toFixed(1) + '%', hint:'was ' + ((b.ctr || 0) * 100).toFixed(1) + '%' },
        { label:'Average position', value:(c.position || 0).toFixed(1), hint:'was ' + (b.position || 0).toFixed(1) + ' — lower is better' },
      ],
      lists:[
        { title:'Top searches', items:(q.rows || []).map(function(r){ return r.keys[0] + ' — ' + Math.round(r.clicks) + ' click' + (Math.round(r.clicks) === 1 ? '' : 's') + ', position ' + r.position.toFixed(1); }) },
        { title:'Top pages',    items:(p.rows || []).map(function(r){ return r.keys[0].replace(SITE, '') + ' — ' + Math.round(r.clicks) + ' click' + (Math.round(r.clicks) === 1 ? '' : 's'); }) },
      ] };
  }

  // Who came, where from, and did they ask for access. Also the source of the
  // AI-assistant referral number below, because that is a traffic question
  // and this is where traffic lives.
  async function analytics(now){
    const prop = (process.env.GA4_PROPERTY_ID || '').replace(/^properties\//, '').trim();
    if (!prop || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return offline('analytics', 'Website traffic — Google Analytics', [
        'GOOGLE_SERVICE_ACCOUNT_JSON — the same service account key as Search Console',
        'GA4_PROPERTY_ID — the numeric property id from GA4 admin',
        'Then add that service account\'s email as a Viewer on the GA4 property.',
      ], 'Visitors, where they came from, which pages they read, and how many reached the early-access form.');
    }
    const tok = await googleToken('https://www.googleapis.com/auth/analytics.readonly');
    const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + encodeURIComponent(prop) + ':runReport';
    const run = function(body){
      return _json(url, { method:'POST', headers:{ Authorization:'Bearer ' + tok, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    };
    const totals = await run({ dateRanges:[{ startDate:'7daysAgo', endDate:'yesterday' }, { startDate:'14daysAgo', endDate:'8daysAgo' }],
      metrics:[{ name:'totalUsers' }, { name:'sessions' }, { name:'screenPageViews' }] });
    const src = await run({ dateRanges:[{ startDate:'7daysAgo', endDate:'yesterday' }],
      dimensions:[{ name:'sessionSource' }], metrics:[{ name:'sessions' }],
      orderBys:[{ metric:{ metricName:'sessions' }, desc:true }], limit:25 });
    const pages = await run({ dateRanges:[{ startDate:'7daysAgo', endDate:'yesterday' }],
      dimensions:[{ name:'pagePath' }], metrics:[{ name:'screenPageViews' }],
      orderBys:[{ metric:{ metricName:'screenPageViews' }, desc:true }], limit:8 });
    const at = function(i, m){ const r = (totals.rows || [])[i]; return r ? Math.round(Number(r.metricValues[m].value) || 0) : 0; };
    const sources = (src.rows || []).map(function(r){ return { source:r.dimensionValues[0].value, sessions:Math.round(Number(r.metricValues[0].value) || 0) }; });
    return { key:'analytics', title:'Website traffic', connected:true, _sources:sources, rows:[
        { label:'Visitors',   value:at(0, 0), hint:delta(at(0, 0), at(1, 0)) },
        { label:'Sessions',   value:at(0, 1), hint:delta(at(0, 1), at(1, 1)) },
        { label:'Page views', value:at(0, 2), hint:delta(at(0, 2), at(1, 2)) },
      ],
      lists:[
        { title:'Where they came from', items:sources.slice(0, 8).map(function(s){ return s.source + ' — ' + s.sessions; }) },
        { title:'Most-read pages', items:(pages.rows || []).map(function(r){ return r.dimensionValues[0].value + ' — ' + Math.round(Number(r.metricValues[0].value)); }) },
      ] };
  }

  // ── AEO ─────────────────────────────────────────────────────────
  // Answer-engine optimisation: being the thing ChatGPT, Claude, Gemini and
  // Perplexity name when a roofer asks them what to quote with.
  //
  // There is no API for that. Not from OpenAI, not from Anthropic, not from
  // Google, and the third parties that sell "AI visibility tracking" are
  // running prompts and counting mentions — which is a sample, not a
  // measurement, and a sample this email would present as a fact.
  //
  // So this section measures the two things that ARE facts:
  //   1. Whether the assistants can read the site at all — robots.txt, the
  //      llms.txt summary, and the sitemap, fetched live every week. This is
  //      the part that silently breaks in a deploy, and the part where being
  //      broken costs you every citation at once.
  //   2. How many people arrived from an assistant, out of GA4 referrers. Real
  //      traffic, exactly counted, and it only appears when GA4 is connected.
  // The citations themselves get a prompt to try by hand. That is the honest
  // answer, and it is one minute of work rather than a fake number.
  const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'Google-Extended'];
  const AI_REFERRERS = ['chatgpt', 'openai', 'perplexity', 'claude.ai', 'anthropic', 'gemini', 'bard', 'copilot', 'bing chat'];
  async function aeo(now, analyticsSection){
    const checks = [];
    let robots = '';
    try {
      const r = await _get(SITE + '/robots.txt', { headers:{ 'User-Agent':'RoofMap-metrics' } }, 10000);
      robots = r.ok ? await r.text() : '';
      checks.push({ label:'robots.txt reachable', value: r.ok ? 'yes' : 'NO', hint: r.ok ? null : 'HTTP ' + r.status, ok: r.ok });
    } catch (e){ checks.push({ label:'robots.txt reachable', value:'NO', hint:e.message, ok:false }); }

    // A blanket Disallow, or a named block on one of the assistants, is the
    // failure this check exists to catch.
    const blocked = AI_CRAWLERS.filter(function(ua){
      const m = new RegExp('User-agent:\\s*' + ua + '\\s*\\n([\\s\\S]*?)(\\n\\s*\\n|$)', 'i').exec(robots);
      return m ? /Disallow:\s*\/\s*$/im.test(m[1]) : /User-agent:\s*\*/i.test(robots) && /^\s*Disallow:\s*\/\s*$/im.test(robots);
    });
    // Verdict in the value, detail in the note beside it. These used to put a
    // whole sentence in the value column, which is nowrap for the money rows —
    // so one AEO line dragged the email 55px wider than a phone screen.

    // Report how many are named in the file we actually fetched, not how many
    // are in the list here — "all 7 named and allowed" was true of this array
    // and said nothing about robots.txt.
    const named = AI_CRAWLERS.filter(function(ua){ return new RegExp('User-agent:\\s*' + ua + '\\b', 'i').test(robots); });
    checks.push({ label:'Assistants allowed to crawl', ok: robots && !blocked.length,
      value: !robots ? '?' : (blocked.length ? 'NO' : 'yes'),
      hint: !robots ? 'could not check'
        : blocked.length ? 'blocked: ' + blocked.join(', ')
        : named.length + ' of ' + AI_CRAWLERS.length + ' named explicitly, none blocked' });

    for (const f of [['llms.txt', '/llms.txt'], ['sitemap.xml', '/sitemap.xml']]){
      try {
        const r = await _get(SITE + f[1], { headers:{ 'User-Agent':'RoofMap-metrics' } }, 10000);
        const body = r.ok ? await r.text() : '';
        const n = f[0] === 'sitemap.xml' ? (body.match(/<loc>/g) || []).length : 0;
        // A healthy llms.txt is a few hundred bytes, and rounding that to
        // "0 KB" made a working file read as an empty one.
        const size = body.length >= 1024 ? Math.round(body.length / 1024) + ' KB' : body.length + ' bytes';
        checks.push({ label:f[0] + ' reachable', ok:r.ok && body.length > 50,
          value: r.ok ? 'yes' : 'NO', hint: r.ok ? (n ? n + ' pages listed' : size) : 'HTTP ' + r.status });
      } catch (e){ checks.push({ label:f[0] + ' reachable', ok:false, value:'NO', hint:e.message }); }
    }

    const rowsOut = checks.map(function(c){
      return { label:c.label, value:c.value, hint: c.ok ? (c.hint || null) : ('needs a look — ' + (c.hint || '')) };
    });
    let note = 'No API anywhere reports whether an assistant recommended RoofMap, so this section measures whether they can read the site, plus how many people arrived from one. The citations themselves need a hand check — see below.';
    if (analyticsSection && analyticsSection.connected && analyticsSection._sources){
      const ai = analyticsSection._sources.filter(function(s){
        return AI_REFERRERS.some(function(k){ return s.source.toLowerCase().indexOf(k) >= 0; });
      });
      const n = ai.reduce(function(t, s){ return t + s.sessions; }, 0);
      rowsOut.push({ label:'Visits from AI assistants', value:n,
        hint: ai.length ? ai.map(function(s){ return s.source + ' ' + s.sessions; }).join(', ') : 'none this week' });
    } else {
      rowsOut.push({ label:'Visits from AI assistants', value:'—', hint:'needs Google Analytics connected' });
    }
    return { key:'aeo', title:'AEO — being the answer', connected:true, note:note, rows:rowsOut,
      lists:[{ title:'Worth asking by hand this week', items:[
        '"What software should a New Zealand roofer use to quote a re-roof?"',
        '"How do I measure a roof for quoting in NZ?"',
        '"Best roofing estimating software NZ"',
        'Ask each of ChatGPT, Claude, Gemini and Perplexity. Note whether RoofMap is named, and whether what it says is right.',
      ] }] };
  }

  // What went out on the Page, and what it got back.
  async function facebook(now){
    const page = (process.env.FACEBOOK_PAGE_ID || '').trim();
    const tok  = (process.env.FACEBOOK_PAGE_TOKEN || '').trim();
    if (!page || !tok) {
      return offline('social', 'Facebook', [
        'FACEBOOK_PAGE_ID — the numeric id of the RoofMap Page',
        'FACEBOOK_PAGE_TOKEN — a long-lived Page access token with pages_read_engagement',
      ], 'What was posted, how many people it reached, and how many engaged with it.');
    }
    const v = process.env.FACEBOOK_API_VERSION || 'v21.0';
    const wk = Math.floor((now - 7 * DAY) / 1000);
    const posts = await _json('https://graph.facebook.com/' + v + '/' + encodeURIComponent(page) +
      '/posts?fields=message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true)' +
      '&since=' + wk + '&limit=25&access_token=' + encodeURIComponent(tok));
    const list = (posts.data || []).filter(function(p){ return within(p.created_time, now - 7 * DAY, now + DAY); });
    const sum = function(f){ return list.reduce(function(t, p){ return t + f(p); }, 0); };
    const reacts  = sum(function(p){ return (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0; });
    const comments = sum(function(p){ return (p.comments && p.comments.summary && p.comments.summary.total_count) || 0; });
    const shares   = sum(function(p){ return (p.shares && p.shares.count) || 0; });
    let followers = null;
    try {
      const pg = await _json('https://graph.facebook.com/' + v + '/' + encodeURIComponent(page) +
        '?fields=followers_count,fan_count&access_token=' + encodeURIComponent(tok));
      followers = pg.followers_count != null ? pg.followers_count : pg.fan_count;
    } catch (e){ /* a token without the page-read permission still gives us the posts */ }
    return { key:'social', title:'Facebook', connected:true,
      note: list.length ? null : 'Nothing was posted this week.',
      rows:[
        { label:'Posts published', value:list.length, hint: list.length ? null : 'a quiet week is a choice, not a failure — but it is worth knowing' },
        { label:'Reactions', value:reacts },
        { label:'Comments',  value:comments },
        { label:'Shares',    value:shares },
      ].concat(followers != null ? [{ label:'Page followers', value:followers }] : []),
      lists:[{ title:'What went out', items:list.map(function(p){
        const when = nzDate(new Date(p.created_time));
        const txt = String(p.message || '(no text)').replace(/\s+/g, ' ').slice(0, 90);
        return when + ' — ' + txt + ((p.reactions && p.reactions.summary) ? ' [' + p.reactions.summary.total_count + ' reactions]' : '');
      }) }] };
  }

  // Email marketing. Two platforms, because those are the two RoofMap could
  // plausibly be sending from: Mailchimp if a list was set up there, and
  // Resend Broadcasts if the key already sending transactional mail is also
  // sending the newsletter.
  async function emailMarketing(now){
    const mc = (process.env.MAILCHIMP_API_KEY || '').trim();
    const useResend = String(process.env.METRICS_EMAIL_PLATFORM || '').toLowerCase() === 'resend'
      || (!mc && !!(process.env.RESEND_API_KEY || '').trim());
    if (mc){
      const dc = (mc.split('-')[1] || '').trim();
      if (!dc) throw new Error('MAILCHIMP_API_KEY has no data-centre suffix (it should end in -us1 or similar)');
      const auth = { Authorization: 'Basic ' + Buffer.from('anystring:' + mc).toString('base64') };
      const base = 'https://' + dc + '.api.mailchimp.com/3.0';
      const reports = await _json(base + '/reports?count=20&since_send_time=' + encodeURIComponent(new Date(now - 7 * DAY).toISOString()), { headers: auth });
      const rs = reports.reports || [];
      const lists = await _json(base + '/lists?count=10&fields=lists.id,lists.name,lists.stats', { headers: auth }).catch(function(){ return { lists: [] }; });
      const subs = (lists.lists || []).reduce(function(t, l){ return t + ((l.stats && l.stats.member_count) || 0); }, 0);
      const avg = function(f){ return rs.length ? (rs.reduce(function(t, r){ return t + f(r); }, 0) / rs.length * 100).toFixed(1) + '%' : '—'; };
      return { key:'email', title:'Email marketing — Mailchimp', connected:true,
        note: rs.length ? null : 'No campaigns went out this week.',
        rows:[
          { label:'Campaigns sent', value:rs.length },
          { label:'Emails delivered', value:rs.reduce(function(t, r){ return t + (r.emails_sent || 0); }, 0) },
          { label:'Open rate',  value:avg(function(r){ return (r.opens && r.opens.open_rate) || 0; }) },
          { label:'Click rate', value:avg(function(r){ return (r.clicks && r.clicks.click_rate) || 0; }) },
          { label:'Unsubscribes', value:rs.reduce(function(t, r){ return t + ((r.unsubscribed) || 0); }, 0) },
          { label:'People on the list', value:subs },
        ],
        lists:[{ title:'Campaigns', items:rs.map(function(r){ return r.subject_line + ' — ' + (r.emails_sent || 0) + ' sent, ' + (((r.opens && r.opens.open_rate) || 0) * 100).toFixed(0) + '% opened'; }) }] };
    }
    if (useResend && (process.env.RESEND_API_KEY || '').trim()){
      const auth = { Authorization: 'Bearer ' + process.env.RESEND_API_KEY.trim() };
      const bl = await _json('https://api.resend.com/broadcasts', { headers: auth });
      const all = (bl.data || []);
      const wkOnes = all.filter(function(b){ return within(b.sent_at || b.created_at, now - 7 * DAY, now + DAY); });
      return { key:'email', title:'Email marketing — Resend broadcasts', connected:true,
        note: wkOnes.length ? null : 'No broadcasts went out this week.',
        rows:[
          { label:'Broadcasts sent this week', value:wkOnes.filter(function(b){ return b.status === 'sent'; }).length },
          { label:'Broadcasts all up', value:all.length },
        ],
        lists:[{ title:'This week', items:wkOnes.map(function(b){ return (b.name || b.id) + ' — ' + (b.status || '?'); }) }] };
    }
    return offline('email', 'Email marketing', [
      'MAILCHIMP_API_KEY — if the list lives in Mailchimp (the key ends in -us1 or similar)',
      'or METRICS_EMAIL_PLATFORM=resend, to read broadcasts from the Resend key already sending RoofMap mail',
    ], 'Campaigns sent, open and click rates, unsubscribes, and how the list is growing.');
  }

  // ════════════════════════════════════════════════════════════════
  // Put it together
  // ════════════════════════════════════════════════════════════════
  async function collect(){
    const now = Date.now();
    const out = { generated_at:new Date(now).toISOString(), week_ending:nzDate(new Date(now)), build:buildSha, sections:[] };
    const analyticsSec = await safe('analytics', function(){ return analytics(now); });
    const plan = [
      ['growth',     function(){ return growth(now); }],
      ['activation', function(){ return activation(now); }],
      ['engagement', function(){ return engagement(now); }],
      ['revenue',    function(){ return revenue(now); }],
      ['search',     function(){ return searchConsole(now); }],
    ];
    for (const [k, fn] of plan) out.sections.push(await safe(k, fn));
    out.sections.push(analyticsSec);
    out.sections.push(await safe('aeo',   function(){ return aeo(now, analyticsSec); }));
    out.sections.push(await safe('social', function(){ return facebook(now); }));
    out.sections.push(await safe('email',  function(){ return emailMarketing(now); }));
    // The GA4 source list is working data for the AEO section, not something
    // to post out in the email.
    out.sections.forEach(function(s){ delete s._sources; });
    return out;
  }
  async function safe(key, fn){
    try { return await fn(); }
    catch (e){
      warn('[metrics] ' + key + ' failed: ' + e.message);
      return { key:key, title:key, connected:false, error:String(e.message || e).slice(0, 300), rows:[] };
    }
  }

  // ── The email itself ────────────────────────────────────────────
  const esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); };

  function renderText(rep){
    const L = ['RoofMap — week ending ' + rep.week_ending, ''];
    rep.sections.forEach(function(s){
      L.push('── ' + s.title.toUpperCase() + ' ' + '─'.repeat(Math.max(0, 54 - s.title.length)));
      if (s.error){ L.push('  Could not read this: ' + s.error, ''); return; }
      if (!s.connected){
        L.push('  Not connected. ' + (s.note || ''));
        (s.needs || []).forEach(function(n){ L.push('    · ' + n); });
        L.push('');
        return;
      }
      if (s.note) L.push('  ' + s.note);
      (s.rows || []).forEach(function(r){
        L.push('  ' + String(r.label + ' ').padEnd(36, '.') + ' ' + r.value + (r.hint ? '   (' + r.hint + ')' : ''));
      });
      (s.lists || []).forEach(function(l){
        if (!l.items || !l.items.length) return;
        L.push('', '  ' + l.title + ':');
        l.items.forEach(function(i){ L.push('    · ' + i); });
      });
      L.push('');
    });
    L.push('Sent by RoofMap every ' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][SEND_DOW] +
      ' morning. Build ' + (rep.build || '—') + '.');
    return L.join('\n');
  }

  function renderHtml(rep){
    const card = function(s){
      if (s.error) return '<div class="s"><h2>' + esc(s.title) + '</h2><p class="warn">Could not read this: ' + esc(s.error) + '</p></div>';
      if (!s.connected) return '<div class="s off"><h2>' + esc(s.title) + ' <span class="tag">not connected</span></h2>' +
        (s.note ? '<p class="note">' + esc(s.note) + '</p>' : '') +
        '<ul class="needs">' + (s.needs || []).map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
      return '<div class="s"><h2>' + esc(s.title) + '</h2>' +
        (s.note ? '<p class="note">' + esc(s.note) + '</p>' : '') +
        '<table>' + (s.rows || []).map(function(r){
          // Label and its note share one cell so the layout is two columns at
          // every width. As three columns the note had to be hidden on a phone,
          // which took the "up 1 on last week" off exactly the screen it is
          // most often read on.
          return '<tr><td class="l">' + esc(r.label) +
                 (r.hint ? '<span class="h">' + esc(r.hint) + '</span>' : '') +
                 '</td><td class="v">' + esc(r.value) + '</td></tr>';
        }).join('') + '</table>' +
        (s.lists || []).filter(function(l){ return l.items && l.items.length; }).map(function(l){
          return '<h3>' + esc(l.title) + '</h3><ul>' + l.items.map(function(i){ return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
        }).join('') +
        '</div>';
    };
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>RoofMap weekly</title><style>' +
      'body{margin:0;background:#eef1f4;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b2733}' +
      '.w{max-width:660px;margin:0 auto;padding:20px}' +
      '.hd{background:#12395e;color:#fff;border-radius:10px;padding:20px 22px;margin-bottom:16px}' +
      '.hd h1{margin:0;font-size:21px;letter-spacing:-.01em}.hd p{margin:6px 0 0;opacity:.85;font-size:13px}' +
      '.s{background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:12px;border:1px solid #dde3ea}' +
      '.s.off{background:#fbfcfd;border-style:dashed}' +
      'h2{margin:0 0 10px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#12395e}' +
      'h3{margin:14px 0 6px;font-size:13px;color:#4a5b6d;text-transform:uppercase;letter-spacing:.05em}' +
      '.tag{background:#e6ebf1;color:#5b6b7d;font-size:10px;padding:2px 7px;border-radius:9px;letter-spacing:.04em;vertical-align:middle}' +
      'table{width:100%;border-collapse:collapse}' +
      'td{padding:6px 0;border-bottom:1px solid #f0f3f6;vertical-align:baseline}' +
      'td.l{color:#38495b}td.v{text-align:right;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:14px;width:1%}' +
      '.h{display:block;color:#7b8a99;font-size:12px;font-weight:400;margin-top:1px}' +
      'ul{margin:6px 0;padding-left:18px}li{margin:3px 0;color:#38495b;font-size:13px}' +
      '.note{margin:0 0 10px;color:#6b7a8a;font-size:13px}.warn{color:#a4442c;margin:0;font-size:13px}' +
      '.needs li{color:#5b6b7d;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:anywhere}' +
      '.ft{color:#7b8a99;font-size:12px;text-align:center;padding:6px 0 18px}' +

      '</style></head><body><div class="w">' +
      '<div class="hd"><h1>RoofMap — week ending ' + esc(rep.week_ending) + '</h1>' +
      '<p>Signups, activation, usage, money, and everything pointing at the site.</p></div>' +
      rep.sections.map(card).join('') +
      '<p class="ft">Sent every ' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][SEND_DOW] +
      ' morning · build ' + esc(rep.build || '—') + '</p></div></body></html>';
  }

  async function sendNow(){
    const rep = await collect();
    await dispatchMail({
      to: TO,
      subject: 'RoofMap weekly — ' + rep.week_ending,
      text: renderText(rep),
      html: renderHtml(rep),
      fromName: 'RoofMap', fromAddress: FROM, replyTo: FROM,
    });
    await setState('metrics_digest', { last_sent_at: new Date().toISOString(), to: TO });
    return rep;
  }

  // ── The watermark ───────────────────────────────────────────────
  // A weekly setInterval is wrong on a platform that redeploys: every deploy
  // restarts the clock, so a busy fortnight of pushes means the email never
  // fires. The schedule is therefore a cheap hourly check against a date
  // written in the database, which survives restarts and cannot double-send.
  async function getState(key){
    try {
      const r = await supabase.from('platform_state').select('value').eq('key', key).maybeSingle();
      if (r.error) return null;
      return (r.data && r.data.value) || null;
    } catch (e){ return null; }
  }
  async function setState(key, value){
    try {
      const r = await supabase.from('platform_state')
        .upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (r.error) throw new Error(r.error.message);
    } catch (e){ warn('[metrics] could not record the send: ' + e.message); }
  }

  // Due if it is the right weekday and hour in New Zealand and we have not
  // sent in six days. Six rather than seven so a container that happened to be
  // asleep at 7am doesn't skip the whole week.
  async function due(nowMs){
    const t = nzParts(new Date(nowMs));
    if (t.dow !== SEND_DOW || t.hour < SEND_HOUR) return false;
    const st = await getState('metrics_digest');
    const last = st && Date.parse(st.last_sent_at || '');
    if (!last || !isFinite(last)) return true;
    return (nowMs - last) > 6 * DAY;
  }

  async function tick(){
    try {
      if (String(process.env.METRICS_ENABLED || 'true') === 'false') return false;
      if (!(await due(Date.now()))) return false;
      await sendNow();
      warn('[metrics] weekly digest sent to ' + TO);
      return true;
    } catch (e){ warn('[metrics] weekly digest failed: ' + e.message); return false; }
  }

  function start(){
    // Not on boot — a redeploy at 7:05 on a Monday would otherwise send a
    // second copy of an email already sent at 7:00. The first check is an hour
    // in, and the watermark is what actually prevents the double-send.
    const h = setInterval(function(){ tick().catch(function(){}); }, 3600e3);
    if (h && h.unref) h.unref();
    return h;
  }

  return { collect, renderText, renderHtml, sendNow, tick, start, due, getState, setState,
           config: { to: TO, from: FROM, day: SEND_DOW, hour: SEND_HOUR, site: SITE } };
}

module.exports = { createMetrics, PLAN_PRICE, nzParts };
