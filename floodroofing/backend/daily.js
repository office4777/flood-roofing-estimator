// The daily activity report: who started a trial yesterday, who is on a
// trial, who is on which paid plan and what that adds up to a month, and a
// line per person — trial or paying, and what they did yesterday: logins,
// canvas use, quotes sent, orders, feedback, minutes in the app.
//
// Built the same way as the weekly digest (metrics.js): a cheap timed check
// against a watermark in platform_state, evaluated in New Zealand local time,
// so a redeploy can neither skip a morning nor send twice.
const { PLAN_PRICE, nzParts } = require('./metrics');

const DAY = 86400e3;
const PLAN_LABEL = { measure: 'Measure', solo: 'Trade', team: 'Team', business: 'Business' };

// 00:00 on a New Zealand calendar day, as a UTC timestamp — found by asking
// Intl rather than by doing offset arithmetic that breaks twice a year.
function nzMidnightUtc(dateStr){
  const guess = Date.parse(dateStr + 'T00:00:00Z');
  for (const off of [12, 13, 11, 14]){
    const t = guess - off * 3600e3;
    const p = nzParts(new Date(t));
    if (p.date === dateStr && p.hour === 0) return t;
  }
  return guess - 12 * 3600e3;
}
function shiftDate(dateStr, days){
  const t = Date.parse(dateStr + 'T12:00:00Z') + days * DAY;
  return new Date(t).toISOString().slice(0, 10);
}
function nzNice(dateStr){
  return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(nzMidnightUtc(dateStr) + 12 * 3600e3));
}
function money(n){ return '$' + Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }

function createDaily(deps){
  const supabase = deps.supabase;
  const dispatchMail = deps.dispatchMail;
  const warn = deps.warn || function(){};
  const buildSha = deps.buildSha || '';
  const TO = (process.env.DAILY_REPORT_TO || deps.defaultTo || 'support@roofmap.co.nz').trim();
  const FROM = (process.env.METRICS_EMAIL_FROM || process.env.ACCOUNTS_EMAIL || 'accounts@roofmap.co.nz').trim();
  const SEND_HOUR = Math.min(23, Math.max(0, parseInt(process.env.DAILY_REPORT_HOUR, 10) >= 0 ? parseInt(process.env.DAILY_REPORT_HOUR, 10) : 3));
  const SUBJECT = 'Activity daily report';

  async function rows(table, select, build){
    try {
      let q = supabase.from(table).select(select || '*').limit(20000);
      if (build) q = build(q);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    } catch (e){
      // A read that fails is not an empty table. The 6:44 report of the 10th
      // went out during a database outage as "0 of 0 people did something",
      // because every table came back empty and the report believed it.
      warn('[daily] ' + table + ': ' + e.message);
      throw new Error('could not read ' + table + ': ' + e.message);
    }
  }

  // The report for one New Zealand calendar day (yesterday, unless asked).
  async function collect(dateStr){
    const now = Date.now();
    const today = nzParts(new Date(now)).date;
    const date = dateStr || shiftDate(today, -1);
    const from = nzMidnightUtc(date), to = nzMidnightUtc(shiftDate(date, 1));

    const [cos, profs, links, subs, evs, allEvs] = await Promise.all([
      rows('companies', 'id, name, plan, created_at'),
      rows('profiles', 'id, email, name, phone, company_id, verify_pending'),
      rows('company_users', 'company_id, user_id, role'),
      rows('subscriptions', 'company_id, user_id, status, trial_ends_at, stripe_customer_id, plan'),
      rows('usage_events', 'name, company_id, user_id, props, at', q => q.gte('at', new Date(from).toISOString()).lt('at', new Date(to).toISOString())),
      // Everything up to the end of the day, for each person's all-time line.
      rows('usage_events', 'name, user_id, props, at', q => q.lt('at', new Date(to).toISOString()).limit(200000)),
    ]);
    const profById = new Map(profs.map(p => [p.id, p]));

    // What each business is: a trial with days left, expired, or paying on a plan.
    const companies = cos.map(function(c){
      // Membership is company_users, plus anyone whose profile says they
      // belong here — the founding accounts predate company_users, and the
      // owner's own activity was missing from his own report for that.
      const members = links.filter(l => l.company_id === c.id);
      profs.forEach(function(p){
        if (p.company_id === c.id && !members.some(m => m.user_id === p.id)) members.push({ company_id: c.id, user_id: p.id, role: 'member' });
      });
      const owner = members.find(m => m.role === 'owner') || members[0] || null;
      const sub = subs.find(x => x.company_id === c.id) || (owner && subs.find(x => x.user_id === owner.user_id)) || null;
      const paidPlan = c.plan && PLAN_PRICE[c.plan] != null ? c.plan : null;
      const paying = !!(sub && sub.stripe_customer_id && /^(active|past_due|trialing)$/.test(String(sub.status || '')) && paidPlan);
      const trialEnds = sub && sub.trial_ends_at ? Date.parse(sub.trial_ends_at) : NaN;
      const onTrial = !paying && sub && sub.status === 'trialing' && isFinite(trialEnds) && trialEnds > now;
      const expired = !paying && !onTrial && !!sub;
      const ownerProf = owner ? profById.get(owner.user_id) : null;
      return {
        id: c.id, name: c.name || '(unnamed)', created_at: c.created_at || '',
        plan: paying ? paidPlan : (onTrial ? 'trial' : (expired ? 'expired' : 'trial')),
        status: paying ? 'paying' : (onTrial ? 'trial' : (expired ? 'expired' : 'trial')),
        trial_days_left: onTrial ? Math.ceil((trialEnds - now) / DAY) : null,
        mrr: paying ? PLAN_PRICE[paidPlan] : 0,
        owner: ownerProf ? { name: ownerProf.name || '', email: ownerProf.email || '', phone: ownerProf.phone || '' } : null,
        people: members.length,
        members: members.map(m => m.user_id),
      };
    });
    const byId = new Map(companies.map(c => [c.id, c]));
    const newTrials = companies.filter(c => { const t = Date.parse(c.created_at || ''); return isFinite(t) && t >= from && t < to; });
    const trials = companies.filter(c => c.status === 'trial').sort((a, b) => (a.trial_days_left || 0) - (b.trial_days_left || 0));
    const paid = {};
    Object.keys(PLAN_PRICE).forEach(k => { paid[k] = companies.filter(c => c.status === 'paying' && c.plan === k); });
    const mrr = companies.reduce((s, c) => s + (c.mrr || 0), 0);

    // A line per person: what they did yesterday.
    const count = (uid, name) => evs.filter(e => e.user_id === uid && e.name === name).length;
    const minutes = uid => evs.filter(e => e.user_id === uid && e.name === 'app_time')
      .reduce((s, e) => s + (Number((e.props || {}).minutes) || 0), 0);
    // Where the minutes went: { roof: 12, jobpack: 3 } — the "did the sheet
    // calculation scare them off" question is answered by a Job Pack column
    // that is tiny next to Map Roof, and by where they were when they left.
    const screens = uid => {
      const out = {};
      evs.filter(e => e.user_id === uid && e.name === 'app_time').forEach(e => {
        const sc = (e.props || {}).screen || 'unknown';
        out[sc] = (out[sc] || 0) + (Number((e.props || {}).minutes) || 0);
      });
      return out;
    };
    // The last screen they were on before the tab was hidden or closed.
    const leftAt = uid => {
      const l = evs.filter(e => e.user_id === uid && e.name === 'screen_left').sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      return l ? { screen: (l.props || {}).screen || 'unknown', seconds: Number((l.props || {}).seconds) || 0, example: !!(l.props || {}).example } : null;
    };
    // How far the practice walkthrough got: the last step shown, and whether
    // it finished, was stopped, or is just where they left it.
    const walkthrough = uid => {
      const w = evs.filter(e => e.user_id === uid && e.name === 'walkthrough').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      if (!w.length) return null;
      const last = w[w.length - 1], p = last.props || {};
      const shown = w.filter(e => (e.props || {}).action === 'shown').map(e => (e.props || {}).step);
      return { step: shown[shown.length - 1] || p.step || '', steps: shown.length,
               outcome: p.action === 'finished' ? 'finished' : (p.action === 'stopped' ? 'stopped at ' + (p.step || '?') : 'left at ' + (shown[shown.length - 1] || '?')) };
    };
    const path = uid => { const e = evs.find(x => x.user_id === uid && x.name === 'onboarding_path'); return e ? ((e.props || {}).path || '') : ''; };
    const helps = uid => evs.filter(e => e.user_id === uid && e.name === 'help_requested').map(e => (e.props || {}).step || '?');
    // Real milestones, and the example ones kept apart: an order sent from
    // the practice job is the tutorial working, not a merchant order.
    const realCount = (uid, name) => evs.filter(e => e.user_id === uid && e.name === name && !(e.props || {}).example).length;
    const exampleCount = (uid, name) => evs.filter(e => e.user_id === uid && e.name === name && (e.props || {}).example).length;
    const detail = uid => ({ screens: screens(uid), left_at: leftAt(uid), walkthrough: walkthrough(uid), path: path(uid), helps: helps(uid),
                             example_orders: exampleCount(uid, 'order_sent'), example_roofs: exampleCount(uid, 'roof_drawn') });
    // All time, per person: every login, canvas use, quote, order and
    // feedback report, every minute and where it went, the days they were
    // active and the day they first appeared — so the report can rank people
    // by how much they have used the product, not just by yesterday.
    const lifeBy = {};
    allEvs.forEach(function(e){
      if (!e.user_id) return;
      const t = lifeBy[e.user_id] || (lifeBy[e.user_id] = { logins: 0, canvas: 0, quotes: 0, orders: 0, feedback: 0, minutes: 0, screens: {}, days: {}, first: null });
      const K = { login: 'logins', canvas_used: 'canvas', quote_sent: 'quotes', order_sent: 'orders', feedback_sent: 'feedback' };
      if (K[e.name] && !(e.name === 'order_sent' && (e.props || {}).example)) t[K[e.name]] += 1;
      else if (e.name === 'app_time'){ const m = Number((e.props || {}).minutes) || 0; t.minutes += m; const sc = (e.props || {}).screen; if (sc) t.screens[sc] = (t.screens[sc] || 0) + m; }
      if (e.at){ t.days[nzParts(new Date(e.at)).date] = 1; if (!t.first || e.at < t.first) t.first = e.at; }
    });
    const lifetime = uid => {
      const t = lifeBy[uid];
      if (!t) return { logins: 0, canvas: 0, quotes: 0, orders: 0, feedback: 0, minutes: 0, screens: {}, active_days: 0, first_seen: null };
      return { logins: t.logins, canvas: t.canvas, quotes: t.quotes, orders: t.orders, feedback: t.feedback, minutes: t.minutes, screens: t.screens,
               active_days: Object.keys(t.days).length, first_seen: t.first ? nzParts(new Date(t.first)).date : null };
    };
    const users = [];
    companies.forEach(function(c){
      c.members.forEach(function(uid){
        const p = profById.get(uid);
        users.push({
          company: c.name, company_status: c.status, plan: c.plan, trial_days_left: c.trial_days_left,
          name: (p && p.name) || '', email: (p && p.email) || uid,
          logins: count(uid, 'login'), canvas: count(uid, 'canvas_used'), quotes: count(uid, 'quote_sent'),
          orders: realCount(uid, 'order_sent'), feedback: count(uid, 'feedback_sent'), minutes: minutes(uid),
          ...detail(uid), total: lifetime(uid),
        });
      });
    });
    // Somebody who did something yesterday but is on no business's list is
    // still shown — a row that says "not on any business" beats a row that
    // is silently missing.
    const listed = new Set(users.map(u => u.email));
    const seen = new Set();
    evs.forEach(function(e){
      if (!e.user_id || seen.has(e.user_id)) return;
      seen.add(e.user_id);
      const p = profById.get(e.user_id);
      const email = (p && p.email) || e.user_id;
      if (listed.has(email) || users.some(u => u.email === email)) return;
      const co = e.company_id ? byId.get(e.company_id) : null;
      users.push({
        company: co ? co.name : '(not on any business)', company_status: co ? co.status : 'unknown', plan: co ? co.plan : 'unknown', trial_days_left: co ? co.trial_days_left : null,
        name: (p && p.name) || '', email,
        logins: count(e.user_id, 'login'), canvas: count(e.user_id, 'canvas_used'), quotes: count(e.user_id, 'quote_sent'),
        orders: realCount(e.user_id, 'order_sent'), feedback: count(e.user_id, 'feedback_sent'), minutes: minutes(e.user_id),
        ...detail(e.user_id), total: lifetime(e.user_id),
      });
    });
    users.sort((a, b) => (b.minutes + b.logins * 5) - (a.minutes + a.logins * 5) || a.company.localeCompare(b.company));
    const active = users.filter(u => u.logins || u.canvas || u.quotes || u.orders || u.feedback || u.minutes);
    // Where people stopped, across everyone: the screen they were on when
    // they closed the app, counted. One line answers "at what point are
    // people closing out".
    const stops = {};
    evs.filter(e => e.name === 'screen_left').forEach(e => { const sc = (e.props || {}).screen || 'unknown'; stops[sc] = (stops[sc] || 0) + 1; });
    const wsteps = {};
    evs.filter(e => e.name === 'walkthrough' && (e.props || {}).action === 'shown').forEach(e => { const st = (e.props || {}).step || '?'; wsteps[st] = (wsteps[st] || 0) + 1; });

    return { date, nice: nzNice(date), stops, walkthrough_steps: wsteps, range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      new_trials: newTrials, trials, paid, mrr, users, active_count: active.length, events: evs.length, businesses: cos.length, build: buildSha };
  }

  const SCREEN_LABEL = { home: 'Home', roof: 'Map Roof', jobpack: 'Job Pack', quote: 'Quote', settings: 'Settings', feedback: 'Feedback', inbox: 'Inbox', schedule: 'Schedule',
                         setup: 'setup wizard', order: 'order popup', roofsetup: 'roof type popup', aerial: 'satellite finder', 'quote-send': 'quote email', unknown: '?' };
  function screensWord(u){
    const s = u.screens || {}; const ks = Object.keys(s).sort((a, b) => s[b] - s[a]);
    return ks.length ? ks.map(k => (SCREEN_LABEL[k] || k) + ' ' + s[k]).join(', ') : '';
  }
  function leftWord(u){
    if (!u.left_at) return '';
    return (SCREEN_LABEL[u.left_at.screen] || u.left_at.screen) + (u.left_at.seconds ? ' after ' + Math.round(u.left_at.seconds / 60) + ' min' : '') + (u.left_at.example ? ' (on a demo)' : '');
  }
  function walkWord(u){
    const bits = [];
    if (u.path) bits.push(u.path === 'practice' ? 'started the practice job' : u.path === 'sample' || u.path === 'sample-instead' ? 'opened the sample' : 'skipped the walkthrough');
    if (u.walkthrough) bits.push(u.walkthrough.outcome + ' (' + u.walkthrough.steps + ' steps seen)');
    if (u.helps && u.helps.length) bits.push('asked for help at ' + u.helps.join(', '));
    if (u.example_orders) bits.push(u.example_orders + ' test order' + (u.example_orders > 1 ? 's' : ''));
    return bits.join('; ');
  }
  function planWord(c){
    if (c.status === 'paying') return PLAN_LABEL[c.plan] || c.plan;
    if (c.status === 'trial') return 'trial' + (c.trial_days_left != null ? ', ' + c.trial_days_left + ' day' + (c.trial_days_left === 1 ? '' : 's') + ' left' : '');
    return 'trial ended';
  }
  function who(c){ return c.name + (c.owner ? ' — ' + [c.owner.name, c.owner.email, c.owner.phone].filter(Boolean).join(', ') : ''); }

  // All-time score: minutes plus five a login, the same weighting as the day.
  function totalScore(u){ const t = u.total || {}; return (t.minutes || 0) + (t.logins || 0) * 5 + (t.quotes || 0) * 10; }
  function byTotal(users){ return users.slice().sort((a, b) => totalScore(b) - totalScore(a) || a.company.localeCompare(b.company)); }
  function screensWordOf(m){
    const ks = Object.keys(m || {}).filter(k => m[k] > 0 && k !== 'unknown').sort((a, b) => m[b] - m[a]);
    return ks.map(k => (SCREEN_LABEL[k] || k) + ' ' + m[k]).join(', ');
  }
  function renderText(rep){
    const L = [];
    L.push('RoofMap — activity for ' + rep.nice);
    L.push('');
    L.push('NEW TRIALS YESTERDAY: ' + rep.new_trials.length);
    rep.new_trials.forEach(c => L.push('  • ' + who(c)));
    L.push('');
    L.push('ON A TRIAL NOW: ' + rep.trials.length);
    rep.trials.forEach(c => L.push('  • ' + who(c) + ' (' + planWord(c) + ')'));
    L.push('');
    Object.keys(PLAN_PRICE).forEach(k => {
      L.push((PLAN_LABEL[k] || k).toUpperCase() + ' (' + money(PLAN_PRICE[k]) + '/mo): ' + rep.paid[k].length);
      rep.paid[k].forEach(c => L.push('  • ' + who(c)));
    });
    L.push('');
    L.push('MRR, paying businesses combined: ' + money(rep.mrr) + ' + GST a month (list price; a founding discount is not netted off)');
    L.push('');
    L.push('ACTIVITY YESTERDAY — ' + rep.active_count + ' of ' + rep.users.length + ' people did something');
    L.push('person | business | plan | logins | canvas | quotes | orders | feedback | minutes | where the minutes went | left at | practice job');
    rep.users.forEach(u => L.push([ (u.name || u.email), u.company, (u.company_status === 'paying' ? 'paying ' + (PLAN_LABEL[u.plan] || u.plan) : planWord({ status: u.company_status, plan: u.plan, trial_days_left: u.trial_days_left })),
      u.logins, u.canvas, u.quotes, u.orders, u.feedback, u.minutes, screensWord(u), leftWord(u), walkWord(u) ].join(' | ')));
    L.push('');
    L.push('ALL-TIME ACTIVITY — every person, highest first');
    L.push('person | business | plan | logins | canvas | quotes | orders | feedback | minutes | days active | since | where the minutes went');
    byTotal(rep.users).forEach(u => { const t = u.total || {}; L.push([ (u.name || u.email), u.company, (u.company_status === 'paying' ? 'paying ' + (PLAN_LABEL[u.plan] || u.plan) : planWord({ status: u.company_status, plan: u.plan, trial_days_left: u.trial_days_left })),
      t.logins || 0, t.canvas || 0, t.quotes || 0, t.orders || 0, t.feedback || 0, t.minutes || 0, t.active_days || 0, t.first_seen || '—', screensWordOf(t.screens) ].join(' | ')); });
    L.push('');
    const stopKeys = Object.keys(rep.stops || {}).sort((a, b) => rep.stops[b] - rep.stops[a]);
    if (stopKeys.length){
      L.push('WHERE PEOPLE CLOSED THE APP: ' + stopKeys.map(k => SCREEN_LABEL[k] || k).map((k, i) => k + ' ' + rep.stops[stopKeys[i]]).join(', '));
      L.push('');
    }
    L.push('Logins and minutes count from the day this report shipped; earlier days show zero. Build ' + (rep.build || '—') + '.');
    return L.join('\n');
  }

  function renderHtml(rep){
    const h = esc;
    const li = c => '<li><b>' + h(c.name) + '</b>' + (c.owner ? ' — ' + h([c.owner.name, c.owner.email, c.owner.phone].filter(Boolean).join(' · ')) : '') + '</li>';
    const sec = (title, body) => '<div class="c"><h2>' + h(title) + '</h2>' + body + '</div>';
    const list = arr => arr.length ? '<ul>' + arr.map(li).join('') + '</ul>' : '<p class="m">None.</p>';
    const rowsHtml = rep.users.map(u => {
      const quiet = !(u.logins || u.canvas || u.quotes || u.orders || u.feedback || u.minutes);
      const plan = u.company_status === 'paying' ? '<span class="p">' + h(PLAN_LABEL[u.plan] || u.plan) + '</span>' : h(planWord({ status: u.company_status, plan: u.plan, trial_days_left: u.trial_days_left }));
      return '<tr class="' + (quiet ? 'q' : '') + '"><td><b>' + h(u.name || u.email) + '</b>' + (u.name ? '<br><span class="m">' + h(u.email) + '</span>' : '') + '</td><td>' + h(u.company) + '</td><td>' + plan + '</td>' +
        ['logins','canvas','quotes','orders','feedback','minutes'].map(k => '<td class="n">' + (u[k] || '·') + '</td>').join('') +
        '<td class="s">' + h(screensWord(u) || '·') + '</td><td class="s">' + h(leftWord(u) || '·') + '</td><td class="s">' + h(walkWord(u) || '·') + '</td></tr>';
    }).join('');
    const totalHtml = byTotal(rep.users).map(u => {
      const t = u.total || {};
      const plan = u.company_status === 'paying' ? '<span class="p">' + h(PLAN_LABEL[u.plan] || u.plan) + '</span>' : h(planWord({ status: u.company_status, plan: u.plan, trial_days_left: u.trial_days_left }));
      return '<tr class="' + (totalScore(u) ? '' : 'q') + '"><td><b>' + h(u.name || u.email) + '</b>' + (u.name ? '<br><span class="m">' + h(u.email) + '</span>' : '') + '</td><td>' + h(u.company) + '</td><td>' + plan + '</td>' +
        ['logins','canvas','quotes','orders','feedback','minutes','active_days'].map(k => '<td class="n">' + (t[k] || '·') + '</td>').join('') +
        '<td class="s">' + h(t.first_seen || '·') + '</td><td class="s">' + h(screensWordOf(t.screens) || '·') + '</td></tr>';
    }).join('');
    const stopKeys = Object.keys(rep.stops || {}).sort((a, b) => rep.stops[b] - rep.stops[a]);
    const stopsHtml = stopKeys.length
      ? '<p>' + stopKeys.map(k => '<b>' + h(SCREEN_LABEL[k] || k) + '</b> ' + rep.stops[k]).join(' · ') + '</p><p class="m">The screen that was open when someone closed the app or put it in the background, counted over the day. A big number on Job Pack next to a small one on Quote is people stopping at the cut list.</p>'
      : '<p class="m">Nobody closed the app on a named screen yesterday (or the build that records it was not live yet).</p>';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + h(SUBJECT) + '</title><style>' +
      'body{margin:0;background:#f3f5f8;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0a1628}.w{max-width:760px;margin:0 auto;padding:18px}' +
      '.hd{background:#0a1628;color:#fff;border-radius:12px;padding:16px 20px;margin-bottom:12px}.hd h1{margin:0;font-size:18px}.hd p{margin:4px 0 0;color:#9fb3c8;font-size:13px}' +
      '.c{background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:14px 18px;margin-bottom:12px}.c h2{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5f6b7a}' +
      'ul{margin:0;padding-left:18px}li{margin:3px 0}.m{color:#7b8a99}.big{font-size:26px;font-weight:800;margin:0}' +
      'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eef1f5;vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5f6b7a}' +
      'td.n{text-align:right;white-space:nowrap}td.s{font-size:12px;color:#334155;max-width:180px}tr.q td{color:#9aa5b1}.p{color:#15803d;font-weight:700}.ft{color:#7b8a99;font-size:12px;text-align:center;padding:6px 0 18px}' +
      '</style></head><body><div class="w">' +
      '<div class="hd"><h1>RoofMap — activity for ' + h(rep.nice) + '</h1><p>Who started, who is trialling, who pays, and what everyone did.</p></div>' +
      sec('New trials yesterday — ' + rep.new_trials.length, list(rep.new_trials)) +
      sec('On a trial now — ' + rep.trials.length, rep.trials.length ? '<ul>' + rep.trials.map(c => '<li><b>' + h(c.name) + '</b> <span class="m">' + h(planWord(c)) + '</span>' + (c.owner ? ' — ' + h([c.owner.name, c.owner.email, c.owner.phone].filter(Boolean).join(' · ')) : '') + '</li>').join('') + '</ul>' : '<p class="m">None.</p>') +
      Object.keys(PLAN_PRICE).map(k => sec((PLAN_LABEL[k] || k) + ' · ' + money(PLAN_PRICE[k]) + '/mo — ' + rep.paid[k].length, list(rep.paid[k]))).join('') +
      sec('MRR, paying businesses combined', '<p class="big">' + h(money(rep.mrr)) + ' <span class="m" style="font-size:13px;font-weight:400">+ GST a month · list price, a founding discount is not netted off</span></p>') +
      sec('Activity yesterday — ' + rep.active_count + ' of ' + rep.users.length + ' people did something',
        '<table><thead><tr><th>Person</th><th>Business</th><th>Plan</th><th>Logins</th><th>Canvas</th><th>Quotes</th><th>Orders</th><th>Feedback</th><th>Minutes</th><th>Where the minutes went</th><th>Left at</th><th>Practice job</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>') +
      sec('Where people closed the app', stopsHtml) +
      sec('All-time activity — every person, highest first',
        '<table><thead><tr><th>Person</th><th>Business</th><th>Plan</th><th>Logins</th><th>Canvas</th><th>Quotes</th><th>Orders</th><th>Feedback</th><th>Minutes</th><th>Days active</th><th>Since</th><th>Where the minutes went</th></tr></thead><tbody>' + totalHtml + '</tbody></table>' +
        '<p class="m">Everything recorded for each person since they first appeared, ranked by minutes, logins and quotes. Logins and minutes count from the day they started being recorded.</p>') +
      '<p class="ft">Sent every morning at ' + SEND_HOUR + ':00 NZ time · logins and minutes count from the day this report shipped · build ' + h(rep.build || '—') + '</p></div></body></html>';
  }

  async function getState(key, strict){
    try { const r = await supabase.from('platform_state').select('value').eq('key', key).maybeSingle(); if (r.error) return strict ? undefined : null; return (r.data && r.data.value) || null; }
    catch (e){ return strict ? undefined : null; }
  }
  async function setState(key, value){
    try { const r = await supabase.from('platform_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }); if (r.error) throw new Error(r.error.message); }
    catch (e){ warn('[daily] could not record the send: ' + e.message); }
  }
  let _sentFor = null;   // the date this process last sent for — survives a failed watermark write
  async function sendNow(dateStr){
    const rep = await collect(dateStr);
    if (!rep.businesses && !rep.users.length) throw new Error('nothing to report on — the reads came back empty, not sending');
    await dispatchMail({ to: TO, subject: SUBJECT, text: renderText(rep), html: renderHtml(rep), fromName: 'RoofMap', fromAddress: FROM, replyTo: FROM });
    _sentFor = rep.date;
    await setState('daily_report', { last_sent_at: new Date().toISOString(), for_date: rep.date, to: TO });
    return rep;
  }
  // Due once the New Zealand clock has passed SEND_HOUR today and today's
  // report has not gone. The watermark is the date it was FOR, so a container
  // asleep at six sends at seven and never sends twice.
  async function due(nowMs){
    const t = nzParts(new Date(nowMs));
    if (t.hour < SEND_HOUR) return false;
    const forDate = shiftDate(t.date, -1);
    if (_sentFor === forDate) return false;
    const st = await getState('daily_report', true);
    if (st === undefined) return false;          // could not read the watermark — do not guess
    return !st || st.for_date !== forDate;
  }
  async function tick(){
    try {
      if (String(process.env.DAILY_REPORT_ENABLED || 'true') === 'false') return false;
      if (!(await due(Date.now()))) return false;
      await sendNow();
      warn('[daily] activity report sent to ' + TO);
      return true;
    } catch (e){ warn('[daily] activity report failed: ' + e.message); return false; }
  }
  function start(){
    const h = setInterval(function(){ tick().catch(function(){}); }, 10 * 60e3);
    if (h && h.unref) h.unref();
    return h;
  }
  return { collect, renderText, renderHtml, sendNow, tick, start, due, config: { to: TO, from: FROM, hour: SEND_HOUR, subject: SUBJECT } };
}
module.exports = { createDaily, nzMidnightUtc, shiftDate };
