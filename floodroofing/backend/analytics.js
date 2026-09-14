// Live analytics: the daily activity report's numbers, kept fresh every hour
// and shown on a page instead of arriving once a morning.
//
// The collector IS the daily report's (daily.js collect) — run for today so
// far and for yesterday — so the page and the email can never disagree. Every
// hour a snapshot of the headline numbers is appended to a series in
// platform_state ('analytics_series'), and the full report for today and
// yesterday is stored under 'analytics_latest'. The page reads those two keys
// through /admin/analytics and re-fetches itself every hour; "Sync now"
// takes a snapshot on the spot.
const { nzParts, PLAN_PRICE } = require('./metrics');
const { shiftDate, nzMidnightUtc } = require('./daily');

const HOUR = 3600e3;
const KEEP_HOURS = 24 * 45;      // 45 days of hourly points
const PLAN_LABEL = { solo: 'Trade', team: 'Team', business: 'Business', monthly: 'Legacy' };

// The owner's own people: Flood Roofing's accounts, by email domain or by
// business name. The page offers a toggle that leaves them out of every
// number, so the owner can see what strangers did without his own team in it.
const INTERNAL = String(process.env.INTERNAL_ACCOUNTS || 'floodroofing.co.nz, Flood Roofing').split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
function isInternalEmail(email){ const e = String(email || '').toLowerCase(); return INTERNAL.some(function(t){ return t.indexOf(' ') < 0 && t.indexOf('.') >= 0 && (e.endsWith('@' + t) || e === t); }); }
function isInternalCompany(name){ const n = String(name || '').toLowerCase(); return !!n && INTERNAL.some(function(t){ return (t.indexOf(' ') >= 0 || t.indexOf('.') < 0) && n.indexOf(t) >= 0; }); }
function isInternalUser(u){ return isInternalEmail(u.email) || isInternalCompany(u.company); }
// The same report without the internal accounts in it.
function withoutInternal(rep){
  const notInt = c => !isInternalCompany(c.name) && !(c.owner && isInternalEmail(c.owner.email));
  const paid = {}; Object.keys(rep.paid || {}).forEach(k => { paid[k] = rep.paid[k].filter(notInt); });
  const users = rep.users.filter(u => !isInternalUser(u));
  const active = users.filter(u => u.logins || u.canvas || u.quotes || u.orders || u.feedback || u.minutes).length;
  const mrr = Object.keys(paid).reduce((s, k) => s + paid[k].reduce((t, c) => t + (c.mrr || 0), 0), 0);
  const intCos = new Set((rep.new_trials || []).concat(rep.trials || []).concat(Object.keys(rep.paid || {}).reduce((a, k) => a.concat(rep.paid[k]), [])).filter(c => !notInt(c)).map(c => c.id || c.name));
  return Object.assign({}, rep, { users, active_count: active, mrr, paid, new_trials: rep.new_trials.filter(notInt), trials: rep.trials.filter(notInt),
    businesses: Math.max(0, (rep.businesses || 0) - intCos.size), events: users.reduce((s, u) => s + u.logins + u.canvas + u.quotes + u.orders + u.feedback, 0) });
}

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }

function createAnalytics(deps){
  const supabase = deps.supabase;
  const daily = deps.daily;
  const warn = deps.warn || function(){};
  const buildSha = deps.buildSha || '';

  async function getState(key){
    const r = await supabase.from('platform_state').select('value').eq('key', key).maybeSingle();
    if (r.error) throw new Error('could not read ' + key + ': ' + r.error.message);
    return (r.data && r.data.value) || null;
  }
  async function setState(key, value){
    const r = await supabase.from('platform_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (r.error) throw new Error('could not write ' + key + ': ' + r.error.message);
  }

  // The headline numbers of one report, small enough to keep hourly.
  function summarise(rep, at){
    const sum = k => rep.users.reduce((s, u) => s + (Number(u[k]) || 0), 0);
    const paying = {};
    Object.keys(rep.paid || {}).forEach(k => { paying[k] = rep.paid[k].length; });
    return {
      at: at, date: rep.date, hour: nzParts(new Date(at)).hour,
      businesses: rep.businesses, new_trials: rep.new_trials.length, trials: rep.trials.length,
      paying: paying, paying_total: Object.keys(paying).reduce((s, k) => s + paying[k], 0), mrr: rep.mrr,
      people: rep.users.length, active: rep.active_count, events: rep.events,
      logins: sum('logins'), canvas: sum('canvas'), quotes: sum('quotes'), orders: sum('orders'),
      feedback: sum('feedback'), minutes: sum('minutes'),
    };
  }

  // The user table without anything the page does not show.
  function slimUsers(rep){
    return rep.users.map(u => ({ name: u.name, email: u.email, company: u.company, company_status: u.company_status,
      plan: u.plan, trial_days_left: u.trial_days_left, logins: u.logins, canvas: u.canvas, quotes: u.quotes,
      orders: u.orders, feedback: u.feedback, minutes: u.minutes }));
  }
  function slimCo(c){ return { name: c.name, plan: c.plan, status: c.status, trial_days_left: c.trial_days_left, mrr: c.mrr, owner: c.owner, created_at: c.created_at }; }

  async function snapshot(){
    const at = Date.now();
    const today = nzParts(new Date(at)).date;
    const [rep, yest] = await Promise.all([daily.collect(today), daily.collect(shiftDate(today, -1))]);
    if (!rep.businesses && !rep.users.length) throw new Error('the reads came back empty — not recording a snapshot');
    const point = summarise(rep, at);
    point.ext = summarise(withoutInternal(rep), at);   // the same hour without Flood Roofing's own accounts
    const pack = (r, full) => ({ date: r.date, nice: r.nice, summary: summarise(r, at), users: slimUsers(r), new_trials: r.new_trials.map(slimCo),
      trials: full ? r.trials.map(slimCo) : undefined, paid: full ? Object.keys(r.paid).reduce((o, k) => { o[k] = r.paid[k].map(slimCo); return o; }, {}) : undefined });
    const latest = {
      at: new Date(at).toISOString(), build: buildSha,
      today: Object.assign(pack(rep, true), { ext: pack(withoutInternal(rep), true) }),
      yesterday: Object.assign(pack(yest, false), { ext: pack(withoutInternal(yest), false) }),
    };
    let series = [];
    try { series = (await getState('analytics_series')) || []; } catch (e){ warn('[analytics] series unreadable, starting afresh: ' + e.message); }
    if (!Array.isArray(series)) series = [];
    series.push(point);
    if (series.length > KEEP_HOURS) series = series.slice(series.length - KEEP_HOURS);
    await setState('analytics_latest', latest);
    await setState('analytics_series', series);
    return { latest, series };
  }

  // Any one day, computed live from the stored events — the same collector
  // as the email, so a day picked on the page reads as that morning's report.
  async function day(dateStr){
    const rep = await daily.collect(dateStr), x = withoutInternal(rep), at = Date.now();
    return { date: rep.date, nice: rep.nice, summary: summarise(rep, at), users: slimUsers(rep), new_trials: rep.new_trials.map(slimCo),
      ext: { date: rep.date, nice: rep.nice, summary: summarise(x, at), users: slimUsers(x), new_trials: x.new_trials.map(slimCo) } };
  }

  // A run of days ending on `end` (inclusive): per day, the businesses that
  // signed up, and the logins, canvas uses, quotes, orders, feedback and
  // minutes across everyone — read once for the whole window and bucketed by
  // New Zealand calendar day. A read that fails is an error, not zeros.
  async function days(endDate, n){
    n = Math.min(31, Math.max(1, n || 7));
    const start = shiftDate(endDate, -(n - 1));
    const from = nzMidnightUtc(start), to = nzMidnightUtc(shiftDate(endDate, 1));
    const [ev, cos, profs, allCos, links] = await Promise.all([
      supabase.from('usage_events').select('name, user_id, props, at').gte('at', new Date(from).toISOString()).lt('at', new Date(to).toISOString()).limit(50000),
      supabase.from('companies').select('id, name, created_at').gte('created_at', new Date(from).toISOString()).lt('created_at', new Date(to).toISOString()).limit(5000),
      supabase.from('profiles').select('id, email, company_id').limit(20000),
      supabase.from('companies').select('id, name').limit(20000),
      supabase.from('company_users').select('company_id, user_id').limit(20000),
    ]);
    for (const r of [ev, cos, profs, allCos, links]) if (r.error) throw new Error('could not read the days: ' + r.error.message);
    // Who is internal: an internal email, or a member of an internal business.
    const intCo = new Set((allCos.data || []).filter(c => isInternalCompany(c.name)).map(c => c.id));
    const intUser = new Set();
    (profs.data || []).forEach(p => { if (isInternalEmail(p.email) || intCo.has(p.company_id)) intUser.add(p.id); });
    (links.data || []).forEach(l => { if (intCo.has(l.company_id)) intUser.add(l.user_id); });
    const blank = d => ({ date: d, dow: nzParts(new Date(nzMidnightUtc(d) + 12 * HOUR)).dow, signups: 0, logins: 0, canvas: 0, quotes: 0, orders: 0, feedback: 0, minutes: 0, people: {} });
    const byDay = {}, byDayExt = {};
    for (let i = 0; i < n; i++){ const d = shiftDate(start, i); byDay[d] = blank(d); byDayExt[d] = blank(d); }
    const KEY = { login: 'logins', canvas_used: 'canvas', quote_sent: 'quotes', order_sent: 'orders', feedback_sent: 'feedback' };
    const add = (b, e) => {
      if (KEY[e.name]) b[KEY[e.name]] += 1;
      else if (e.name === 'app_time') b.minutes += Number((e.props || {}).minutes) || 0;
      if (e.user_id) b.people[e.user_id] = 1;
    };
    (ev.data || []).forEach(function(e){
      const d = nzParts(new Date(e.at)).date; if (!byDay[d]) return;
      add(byDay[d], e);
      if (!intUser.has(e.user_id)) add(byDayExt[d], e);
    });
    (cos.data || []).forEach(function(c){ const d = nzParts(new Date(c.created_at)).date; if (!byDay[d]) return; byDay[d].signups += 1; if (!isInternalCompany(c.name)) byDayExt[d].signups += 1; });
    const finish = m => Object.keys(m).sort().map(function(k){ const b = m[k]; b.active = Object.keys(b.people).length; delete b.people; return b; });
    return { start, end: endDate, days: finish(byDay), days_ext: finish(byDayExt) };
  }

  // What the page reads. Takes the first snapshot itself if there is none.
  async function collect(){
    let latest = await getState('analytics_latest');
    let series = await getState('analytics_series');
    if (!latest || !Array.isArray(series)){
      const s = await snapshot();
      latest = s.latest; series = s.series;
    }
    let week = null;
    try { week = await days(latest.today.date, 7); } catch (e){ warn('[analytics] week read failed: ' + e.message); }
    return { latest, series, week, plan_price: PLAN_PRICE, plan_label: PLAN_LABEL, build: buildSha, now: new Date().toISOString() };
  }

  // Hourly: a snapshot once the last one is more than 55 minutes old. The
  // watermark is the stored snapshot's time, so a redeploy neither skips an
  // hour nor doubles up.
  let _lastAt = 0;
  async function due(nowMs){
    if (nowMs - _lastAt < 55 * 60e3) return false;
    let latest = null;
    try { latest = await getState('analytics_latest'); } catch (e){ return false; }   // cannot read → do not guess
    const at = latest && latest.at ? Date.parse(latest.at) : 0;
    if (isFinite(at) && at > _lastAt) _lastAt = at;
    return nowMs - _lastAt >= 55 * 60e3;
  }
  async function tick(){
    try {
      if (String(process.env.ANALYTICS_ENABLED || 'true') === 'false') return false;
      if (!(await due(Date.now()))) return false;
      await snapshot();
      _lastAt = Date.now();
      return true;
    } catch (e){ warn('[analytics] snapshot failed: ' + e.message); return false; }
  }
  function start(){
    setTimeout(function(){ tick().catch(function(){}); }, 20e3).unref();
    const h = setInterval(function(){ tick().catch(function(){}); }, 5 * 60e3);
    if (h && h.unref) h.unref();
    return h;
  }

  // ── The page ──────────────────────────────────────────────────────
  // Self-contained: the token in the URL is kept in the browser and taken off
  // the address bar; the page then asks /admin/analytics with a header, every
  // hour and whenever the tab comes back into view.
  function renderPage(){
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>RoofMap analytics</title>' +
    '<link rel="manifest" href="/admin/analytics/manifest.webmanifest"><link rel="icon" href="/admin/analytics/icon.png"><link rel="apple-touch-icon" href="/admin/analytics/icon.png">' +
    '<meta name="theme-color" content="#0a1628"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Analytics"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<style>' +
    ':root{--bg:#f3f5f8;--card:#fff;--line:#e3e8ef;--ink:#0a1628;--ink2:#52514e;--mute:#7b8a99;--blue:#2a78d6;--green:#008300;--orange:#eb6834;--grid:#eef1f5}' +
    '@media(prefers-color-scheme:dark){:root{--bg:#111214;--card:#1a1a19;--line:#2b2d31;--ink:#fff;--ink2:#c3c2b7;--mute:#8b9099;--blue:#3987e5;--orange:#d95926;--grid:#26282c}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}' +
    '.w{max-width:1080px;margin:0 auto;padding:18px 16px 40px}' +
    '.hd{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:#0a1628;color:#fff;border-radius:12px;padding:14px 18px;margin-bottom:14px}' +
    '.hd h1{margin:0;font-size:18px}.hd p{margin:2px 0 0;color:#9fb3c8;font-size:12px}' +
    '.hd button{background:#fff;color:#0a1628;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}.hd button:disabled{opacity:.6}' +
    '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}' +
    '.t{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.t .l{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}' +
    '.t .v{font-size:26px;font-weight:800;line-height:1.2;margin-top:2px}.t .s{font-size:12px;color:var(--ink2)}' +
    '.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:12px}.c h2{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}' +
    '.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}' +
    'svg{width:100%;height:auto;display:block}.ax{font-size:10px;fill:var(--mute)}.gl{stroke:var(--grid)}' +
    '.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;padding:5px 8px;border-radius:6px;display:none;z-index:9;white-space:nowrap}' +
    'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}' +
    'td.n,th.n{text-align:right;white-space:nowrap}tr.q td{color:var(--mute)}.p{color:var(--green);font-weight:700}.m{color:var(--mute)}ul{margin:0;padding-left:18px}li{margin:3px 0}' +
    '.tabs{display:flex;gap:6px;margin-bottom:8px}.tabs button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:20px;padding:4px 12px;cursor:pointer;font-size:12px}.tabs button.on{background:var(--blue);color:#fff;border-color:var(--blue)}' +
    '.wk td{position:relative}.wk .bar{position:absolute;right:0;top:4px;bottom:4px;background:var(--blue);opacity:.18;border-radius:3px}.wk .v{position:relative;font-variant-numeric:tabular-nums}.wk th.d{text-align:right;white-space:nowrap}.wk td.tot{font-weight:700}.tabs button:disabled{opacity:.4;cursor:default}' +
    '.tog{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#fff;background:rgba(255,255,255,.12);border-radius:8px;padding:7px 10px;cursor:pointer;user-select:none}.tog input{margin:0;accent-color:#fff}' +
    '.lg{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--ink2);margin:6px 0 2px}.lg span{display:inline-flex;align-items:center;gap:5px}.lg i{width:10px;height:10px;border-radius:2px;display:inline-block}' +
    '.gb{font-size:9.5px;fill:var(--ink);font-weight:700}.gd{font-size:11px;fill:var(--ink);font-weight:700}.gs{font-size:9.5px;fill:var(--ink2)}' +
    '.tw{overflow-x:auto}.ft{color:var(--mute);font-size:12px;text-align:center;padding:10px 0}.err{background:#fde8e8;color:#7f1d1d;border-radius:8px;padding:10px 14px;margin-bottom:12px}' +
    '</style></head><body><div class="w">' +
    '<div class="hd"><div><h1>RoofMap — live activity</h1><p id="sub">Loading…</p></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="tog" title="Leave Flood Roofing\'s own accounts out of every number"><input type="checkbox" id="exInt" onchange="setExcl(this.checked)"> Exclude Flood Roofing</label><button id="sync" onclick="syncNow()">Sync now</button><button id="out" onclick="signOut()" style="display:none;background:transparent;color:#9fb3c8;font-weight:400;padding:8px 6px">Sign out</button></div></div>' +
    '<div id="err" class="err" style="display:none"></div>' +
    '<div id="login" class="c" style="display:none;max-width:420px;margin:30px auto"><h2>Sign in</h2><p class="m" style="margin:0 0 10px">Your RoofMap login. Only the platform\'s own accounts can see this page.</p>' +
    '<form onsubmit="return signIn(event)"><input id="liEmail" type="email" autocomplete="username" placeholder="Email" required style="width:100%;font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:var(--card);color:var(--ink)">' +
    '<input id="liPass" type="password" autocomplete="current-password" placeholder="Password" required style="width:100%;font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--card);color:var(--ink)">' +
    '<button id="liBtn" style="width:100%;background:var(--blue);color:#fff;border:0;border-radius:8px;padding:10px;font-weight:700;font-size:14px;cursor:pointer">Sign in</button><p id="liErr" class="m" style="margin:8px 0 0;color:#b91c1c"></p></form></div>' +
    '<div id="main">' +
    '<div id="tiles" class="tiles"></div>' +
    '<div class="grid2"><div class="c"><h2>MRR, paying businesses combined</h2><div id="chMrr"></div></div>' +
    '<div class="c"><h2>Businesses on a trial</h2><div id="chTrials"></div></div>' +
    '<div class="c"><h2>People active, by day</h2><div id="chActive"></div></div>' +
    '<div class="c"><h2>Quotes sent, by day</h2><div id="chQuotes"></div></div>' +
    '<div class="c"><h2>Minutes in the app, by day</h2><div id="chMinutes"></div></div>' +
    '<div class="c"><h2>Activity today, hour by hour</h2><div id="chHours"></div></div></div>' +
    '<div class="c"><h2 id="wkH">Last 7 days</h2><div class="tabs" style="margin-bottom:10px"><button onclick="moveWeek(-7)">‹ Earlier</button><button id="wkNext" onclick="moveWeek(7)">Later ›</button><button onclick="moveWeek(0)">This week</button></div>' +
    '<div id="weekChart"></div><div class="lg" id="weekLegend"></div><details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;color:var(--mute)">The numbers as a table</summary><div class="tw" id="week"></div></details></div>' +
    '<div class="c"><div class="tabs"><button id="tabT" class="on" onclick="showDay(\'today\')">Today so far</button><button id="tabY" onclick="showDay(\'yesterday\')">Yesterday</button>' +
    '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--mute)">or a day <input type="date" id="dayPick" onchange="pickDay(this.value)" style="font:inherit;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)"></label></div>' +
    '<h2 id="actH"></h2><div class="tw"><table><thead><tr><th>Person</th><th>Business</th><th>Plan</th><th class="n">Logins</th><th class="n">Canvas</th><th class="n">Quotes</th><th class="n">Orders</th><th class="n">Feedback</th><th class="n">Minutes</th></tr></thead><tbody id="rows"></tbody></table></div></div>' +
    '<div class="grid2"><div class="c"><h2 id="ntH">New trials today</h2><div id="newTrials"></div></div>' +
    '<div class="c"><h2 id="trH">On a trial now</h2><div id="trials"></div></div>' +
    '<div class="c"><h2 id="pdH">Paying</h2><div id="paid"></div></div></div>' +
    '<p class="ft" id="ft"></p></div></div><div class="tip" id="tip"></div>' +
    '<script>' + PAGE_JS + '</script></body></html>';
  }

  function iconPng(){ return Buffer.from(ICON_B64, 'base64'); }
  // Network first, shell from cache when offline — the numbers are never cached.
  function serviceWorker(){
    return "const SHELL='rm-analytics-v1';" +
      "self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(SHELL).then(c=>c.addAll(['/admin/analytics/page','/admin/analytics/icon.png'])));});" +
      "self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});" +
      "self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||!/\\/admin\\/analytics\\/(page|icon\\.png)$/.test(u.pathname))return;" +
      "e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(SHELL).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));});";
  }
  return { collect, snapshot, tick, start, due, renderPage, summarise, day, days, isInternalUser, iconPng, serviceWorker };
}

const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAFV0lEQVR4nOzdvW8bdRzH8d/ZPj8maZ4TQmhC00jBICHEQyqhNgMSArGxM4BgQAz9IxhgYELqVAaQOsCGxFaVhQc1QCtERcoApYW0TWry/ODHOx+WKhCCxmffJ/Qu8fu1Jfd1Bufte5Dufk5kh2cMEFTCAAICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgI6ABInnw4MT0Y603f/dEr1pzf1soXfrFqdRM2i1Vao8zK2rk3nrHzI//d5N7e2jlzsb6ya0IVM4iw1Nyxe9bTEB/rybz8qAkbAUWafeJos61PPGhScRMqAoowOx4f7mqy3YpZ8aFmA/cBJ9ERVnMbifjM+A78zwgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICGh/DKesk8Px8ZwVs5rd4VX3vJu73hcF94+KZw4FAtoHzz8Qf+/J9JFkqzcHbla9t74tf1lwzcHHPdGq493W+0+3UU9DY/jsifR092F48wlI9dpUMpNo+8bkxktenbLNwcchTJU/EvC29qlDsQciIFUi6HMR2ZCf6NofBAQJAUFCQJAQECQEBAkBQUJAkBAQJAQECQFBQkCQEBAkBAQJAUFCQJAQECQEBEkHBdQ1/Vx3/sXUwDHfSWd3tby0sDr/gVfdMWiqIwKyEumhudPZidkW5xO5ga7jp9Kj+cLn71ZXfzXYW0c8lZHsn2y9nr8luga7Zl4waKoj9kCpkbwJJD3yiEFTnbEHGpg0gdg9o43Dn8HeOmIP5FWLJhArFvecssHeuIyHhIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEiiFVAs09uTfynZP+l7K7tX2ams/Ly58JlxawbhiVBA6bHHh+ZOxzO9Lc5nJ2dzU6cKF95xtu8YhCQyj/UkUgPPvtl6PXcl+472PfWKQXiiElCyb8LuHjbty07M8uhWiCITUNBn/6xY3O4eNQhJZM6BPOFLaGOH4pu3DiYu4yEhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKCJCorlDk7KyYod3fVZ6C0bgJxWnjhajXg0ljLpbrvjLtVbj5Q3yiZUEUloOradRNIZe13t7zRfKa0tGACKd+64jvzdcExgVxccX1nnKuFZltvbXpbFROqqARUL21sfP+Jad/6/Fnfmcryj8Ub35g21Wul9UvnfMc+vOZc2/bfl/xL4yXnrvuXV/p0wSvvuRB26eMfTNjidm7QRENp+SfjuemRvGW1lHXjH7zy1ZnS4qVWhouLlxO5wWT/pGlN45B65/zbztZt30nXM+eXnNnB+Eim1U/jdyvu6/PlzVZWSC87tasF+7ERK2P/89de2Sl+dLl2ZdmEzcoOz5hISaSSvQ+1slJ9df2GaZNl5+y+cStmNx9rnFQ520umTWMZazxrxSyr2V/2vMXd+rLPic09xIa6rL6/3pNizb25aaIhegHhQOEyHhICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIEgKChIAgISBICAgSAoKEgCAhIEgICBICgoSAICEgSAgIkj8BAAD//2LAKYUAAAAGSURBVAMAws8Ij0ULiCcAAAAASUVORK5CYII=';

const PAGE_JS = String.raw`
var TOKEN = (function(){
  var u = new URL(location.href), t = u.searchParams.get('token');
  if (t){ try { localStorage.setItem('rm_admin_token', t); } catch(e){} u.searchParams.delete('token'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); return t; }
  try { return localStorage.getItem('rm_admin_token') || ''; } catch(e){ return ''; }
})();
var API = location.pathname.replace(/\/page\/?$/, '');
var JWT = (function(){ try { return localStorage.getItem('rm_owner_jwt') || ''; } catch(e){ return ''; } })();
function authHeaders(){ var h = {}; if (TOKEN) h['x-admin-token'] = TOKEN; if (JWT) h['Authorization'] = 'Bearer ' + JWT; return h; }
function showLogin(msg){ $('login').style.display = ''; $('main').style.display = 'none'; $('liErr').textContent = msg || ''; }
function hideLogin(){ $('login').style.display = 'none'; $('main').style.display = ''; $('out').style.display = JWT ? '' : 'none'; }
async function signIn(ev){
  ev.preventDefault();
  var b = $('liBtn'); b.disabled = true; $('liErr').textContent = '';
  try {
    var r = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('liEmail').value.trim(), password: $('liPass').value }) });
    var j = await r.json().catch(function(){ return {}; });
    if (!r.ok || !j.token) throw new Error(j.error || 'Could not sign in');
    JWT = j.token; try { localStorage.setItem('rm_owner_jwt', JWT); } catch(e){}
    hideLogin(); await load();
  } catch (e){ $('liErr').textContent = e.message; }
  b.disabled = false; return false;
}
function signOut(){ JWT = ''; try { localStorage.removeItem('rm_owner_jwt'); } catch(e){} DATA = null; showLogin(); }
if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('/admin/analytics/sw.js', { scope: '/admin/analytics/' }); } catch(e){} }
var DATA = null, DAY = 'today';
var EXCL = (function(){ try { return localStorage.getItem('rm_excl_internal') === '1'; } catch(e){ return false; } })();
function setExcl(on){ EXCL = !!on; try { localStorage.setItem('rm_excl_internal', on ? '1' : '0'); } catch(e){} if (DATA) render(); }
// The view of a thing with or without Flood Roofing's accounts in it.
function V(o){ return (EXCL && o && o.ext) ? o.ext : o; }
function pt(p){ return (EXCL && p && p.ext) ? p.ext : p; }
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
function money(n){ return '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 }); }
function nz(iso, opts){ return new Intl.DateTimeFormat('en-NZ', Object.assign({ timeZone: 'Pacific/Auckland' }, opts)).format(new Date(iso)); }
function planWord(c){
  var L = DATA.plan_label || {};
  if (c.status === 'paying' || c.company_status === 'paying') return L[c.plan] || c.plan;
  if ((c.status || c.company_status) === 'trial') return 'trial' + (c.trial_days_left != null ? ', ' + c.trial_days_left + ' day' + (c.trial_days_left === 1 ? '' : 's') + ' left' : '');
  return 'trial ended';
}
function who(c){ return '<b>' + esc(c.name) + '</b>' + (c.owner ? ' <span class="m">— ' + esc([c.owner.name, c.owner.email, c.owner.phone].filter(Boolean).join(' · ')) + '</span>' : ''); }
function list(arr, extra){ return arr.length ? '<ul>' + arr.map(function(c){ return '<li>' + who(c) + (extra ? ' <span class="m">' + esc(extra(c)) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="m">None.</p>'; }

async function load(){
  try {
    if (!TOKEN && !JWT){ showLogin(); return; }
    var r = await fetch(API, { headers: authHeaders() });
    if (r.status === 404 || r.status === 401){ if (JWT){ signOut(); showLogin('That login is not allowed here, or has expired. Sign in again.'); } else showLogin(); return; }
    if (!r.ok) throw new Error('The server answered ' + r.status);
    DATA = await r.json();
    $('err').style.display = 'none';
    hideLogin();
    render();
  } catch (e){ $('err').style.display = ''; $('err').textContent = e.message; }
}
async function syncNow(){
  var b = $('sync'); b.disabled = true; b.textContent = 'Syncing…';
  try { var r = await fetch(API + '/refresh', { method: 'POST', headers: authHeaders() }); if (!r.ok) throw new Error('sync failed: ' + r.status); await load(); }
  catch (e){ $('err').style.display = ''; $('err').textContent = e.message; }
  b.disabled = false; b.textContent = 'Sync now';
}

// Last snapshot of each calendar day → one point per day.
function byDay(series){
  var m = {}; series.forEach(function(p){ m[p.date] = p; });
  return Object.keys(m).sort().map(function(k){ return m[k]; });
}
function tile(l, v, s){ return '<div class="t"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }

function render(){
  $('exInt').checked = EXCL;
  var L = DATA.latest, T = V(L.today), Y = V(L.yesterday), s = T.summary, ys = Y.summary, P = DATA.plan_label || {};
  var series = DATA.series.map(pt);
  $('sub').textContent = 'Synced ' + nz(L.at, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' NZ · refreshes every hour · today is ' + T.nice + (EXCL ? ' · without Flood Roofing' : '');
  var payingBits = Object.keys(s.paying).filter(function(k){ return k !== 'monthly' || s.paying[k]; }).map(function(k){ return s.paying[k] + ' ' + (P[k] || k); }).join(' · ');
  $('tiles').innerHTML =
    tile('MRR', money(s.mrr), '+ GST a month, list price') +
    tile('Paying businesses', s.paying_total, payingBits) +
    tile('On a trial', s.trials, s.new_trials + ' new today') +
    tile('Active today', s.active + ' <span class="m" style="font-size:14px;font-weight:400">of ' + s.people + '</span>', ys.active + ' yesterday') +
    tile('Quotes sent today', s.quotes, ys.quotes + ' yesterday') +
    tile('Minutes in the app', s.minutes, ys.minutes + ' yesterday') +
    tile('Logins today', s.logins, s.canvas + ' canvas · ' + s.orders + ' orders') +
    tile('Businesses', s.businesses, s.events + ' events today');
  var days = byDay(series);
  $('chMrr').innerHTML = lineChart(series, 'mrr', function(v){ return money(v); });
  $('chTrials').innerHTML = lineChart(series, 'trials', function(v){ return v + ' on a trial'; });
  $('chActive').innerHTML = barChart(days.slice(-21), 'active', function(p){ return p.active + ' of ' + p.people + ' active'; });
  $('chQuotes').innerHTML = barChart(days.slice(-21), 'quotes', function(p){ return p.quotes + ' quotes'; });
  $('chMinutes').innerHTML = barChart(days.slice(-21), 'minutes', function(p){ return p.minutes + ' min'; });
  var todayPts = series.filter(function(p){ return p.date === T.date; });
  $('chHours').innerHTML = barChart(todayPts, 'events', function(p){ return p.events + ' events by ' + p.hour + ':00'; }, function(p){ return p.hour + ':00'; });
  showDay(DAY === 'picked' && PICKED ? 'picked' : DAY);
  WEEK = DATA.week; renderWeek();
  $('ntH').textContent = 'New trials today — ' + T.new_trials.length + (Y.new_trials.length ? ' (' + Y.new_trials.length + ' yesterday)' : '');
  $('newTrials').innerHTML = list(T.new_trials);
  $('trH').textContent = 'On a trial now — ' + T.trials.length;
  $('trials').innerHTML = list(T.trials, planWord);
  var paidHtml = '';
  Object.keys(T.paid).forEach(function(k){ if (k === 'monthly' && !T.paid[k].length) return; paidHtml += '<h2 style="margin-top:8px">' + esc(P[k] || k) + ' · ' + money((DATA.plan_price || {})[k]) + '/mo — ' + T.paid[k].length + '</h2>' + list(T.paid[k]); });
  $('pdH').textContent = 'Paying — ' + s.paying_total;
  $('paid').innerHTML = paidHtml;
  $('ft').textContent = 'Same numbers as the morning email, taken hourly · logins and minutes count from the day they shipped · build ' + (DATA.build || '—');
}
var PICKED = null;   // { date, nice, summary, users } for a chosen day
async function pickDay(date){
  if (!date) return;
  if (date === DATA.latest.today.date) return showDay('today');
  if (date === DATA.latest.yesterday.date) return showDay('yesterday');
  $('actH').textContent = 'Loading ' + date + '…';
  try {
    var r = await fetch(API + '/day?date=' + encodeURIComponent(date), { headers: authHeaders() });
    if (!r.ok) throw new Error('could not read that day: ' + r.status);
    PICKED = await r.json();
    showDay('picked');
  } catch (e){ $('err').style.display = ''; $('err').textContent = e.message; }
}
function showDay(which){
  DAY = which;
  $('tabT').className = which === 'today' ? 'on' : ''; $('tabY').className = which === 'yesterday' ? 'on' : '';
  var D = V(which === 'picked' ? PICKED : DATA.latest[which]);
  if (!D) return;
  $('dayPick').value = D.date; $('dayPick').max = DATA.latest.today.date;
  var label = which === 'today' ? 'today so far' : which === 'yesterday' ? 'yesterday' : 'on ' + D.nice;
  $('actH').textContent = 'Activity ' + label + ' — ' + D.summary.active + ' of ' + D.users.length + ' people did something';
  $('rows').innerHTML = D.users.map(function(u){
    var quiet = !(u.logins || u.canvas || u.quotes || u.orders || u.feedback || u.minutes);
    var plan = u.company_status === 'paying' ? '<span class="p">' + esc((DATA.plan_label || {})[u.plan] || u.plan) + '</span>' : esc(planWord(u));
    return '<tr class="' + (quiet ? 'q' : '') + '"><td><b>' + esc(u.name || u.email) + '</b>' + (u.name ? '<br><span class="m">' + esc(u.email) + '</span>' : '') + '</td><td>' + esc(u.company) + '</td><td>' + plan + '</td>' +
      ['logins','canvas','quotes','orders','feedback','minutes'].map(function(k){ return '<td class="n">' + (u[k] || '·') + '</td>'; }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="9" class="m">Nobody yet.</td></tr>';
}

// ── the last 7 days, one row per thing, a bar in every cell ──
var WEEK = null;
var WEEK_ROWS = [['signups','New sign-ups'],['logins','Logins'],['canvas','Canvas'],['quotes','Quotes'],['orders','Orders'],['feedback','Feedback'],['minutes','Minutes'],['active','People active']];
var DOWN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
async function moveWeek(delta){
  var end = delta === 0 ? DATA.latest.today.date : shift(WEEK ? WEEK.end : DATA.latest.today.date, delta);
  if (end > DATA.latest.today.date) end = DATA.latest.today.date;
  try {
    var r = await fetch(API + '/days?end=' + end + '&n=7', { headers: authHeaders() });
    if (!r.ok) throw new Error('could not read those days: ' + r.status);
    WEEK = await r.json(); renderWeek();
  } catch (e){ $('err').style.display = ''; $('err').textContent = e.message; }
}
function shift(date, days){ var t = Date.parse(date + 'T12:00:00Z') + days * 864e5; return new Date(t).toISOString().slice(0, 10); }
// Grouped bars per day, the way the financials hub draws a month: one bar
// per thing in a fixed colour order, its value on top, and the day's other
// numbers written under the date.
var GROUP = [['signups','New sign-ups','#2a78d6'],['logins','Logins','#eb6834'],['canvas','Canvas','#1baf7a'],['quotes','Quotes','#eda100'],['orders','Orders','#e87ba4'],['feedback','Feedback','#4a3aa7']];
function groupedBars(D){
  var GW = 1000, GH = 300, L = 40, R = 10, T = 24, B = 62;
  var max = 1; D.forEach(function(d){ GROUP.forEach(function(g){ max = Math.max(max, d[g[0]]); }); });
  var y = function(v){ return T + (GH - T - B) * (1 - v / max); };
  var slot = (GW - L - R) / D.length, inner = slot * 0.82, bw = inner / GROUP.length, gap = 2;
  var grid = yTicks(max).map(function(v){ return '<line class="gl" x1="' + L + '" x2="' + (GW - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>'; }).join('');
  var bars = D.map(function(d, i){
    var x0 = L + slot * i + (slot - inner) / 2;
    var cells = GROUP.map(function(g, j){
      var v = d[g[0]], top = y(v), h = (GH - B) - top, x = x0 + j * bw;
      return '<rect x="' + (x + gap / 2) + '" y="' + top + '" width="' + (bw - gap) + '" height="' + h + '" rx="2" fill="' + g[2] + '" data-tip="' + esc(DOWN[d.dow] + ' ' + d.date.slice(5) + ' — ' + v + ' ' + g[1].toLowerCase()) + '"/>' +
        (v ? '<text class="gb" x="' + (x + bw / 2) + '" y="' + (top - 3) + '" text-anchor="middle">' + v + '</text>' : '');
    }).join('');
    var cx = x0 + inner / 2, base = GH - B;
    return cells +
      '<text class="gd" x="' + cx + '" y="' + (base + 16) + '" text-anchor="middle">' + esc(DOWN[d.dow] + ' ' + d.date.slice(5)) + '</text>' +
      '<text class="gs" x="' + cx + '" y="' + (base + 30) + '" text-anchor="middle">' + d.minutes + ' min in the app</text>' +
      '<text class="gs" x="' + cx + '" y="' + (base + 42) + '" text-anchor="middle">' + d.active + ' people active</text>' +
      '<text class="gs" x="' + cx + '" y="' + (base + 54) + '" text-anchor="middle">' + (d.logins ? Math.round(d.minutes / d.logins) + ' min per login' : '') + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + GW + ' ' + GH + '" onmousemove="tipMove(event)" onmouseleave="tipHide()">' + grid + bars + '</svg>';
}
function renderWeek(){
  if (!WEEK){ $('week').innerHTML = '<p class="m">The last seven days could not be read.</p>'; $('weekChart').innerHTML = ''; return; }
  var D = (EXCL && WEEK.days_ext) ? WEEK.days_ext : WEEK.days, today = DATA.latest.today.date;
  $('weekChart').innerHTML = groupedBars(D);
  $('weekLegend').innerHTML = GROUP.map(function(g){ return '<span><i style="background:' + g[2] + '"></i>' + g[1] + '</span>'; }).join('') + '<span class="m">· minutes and people active are written under each day</span>';
  $('wkH').textContent = (WEEK.end === today ? 'Last 7 days' : '7 days') + ' — ' + D[0].date + ' to ' + WEEK.end + (WEEK.end === today ? ' (today so far)' : '');
  $('wkNext').disabled = WEEK.end >= today;
  var head = '<tr><th></th>' + D.map(function(d){ return '<th class="d">' + DOWN[d.dow] + '<br><span class="m">' + d.date.slice(5) + '</span></th>'; }).join('') + '<th class="d">7 days</th></tr>';
  var body = WEEK_ROWS.map(function(rw){
    var k = rw[0], max = Math.max.apply(null, D.map(function(d){ return d[k]; })), tot = D.reduce(function(s, d){ return s + d[k]; }, 0);
    return '<tr><th>' + rw[1] + '</th>' + D.map(function(d){
      var w = max ? Math.round(100 * d[k] / max) : 0;
      return '<td class="n"><span class="bar" style="width:' + w + '%"></span><span class="v">' + (d[k] || '·') + '</span></td>';
    }).join('') + '<td class="n tot">' + (k === 'active' ? '' : tot) + '</td></tr>';
  }).join('');
  $('week').innerHTML = '<table class="wk"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

// ── charts: one hue, thin marks, hover tooltip ──
var W = 520, H = 170, PL = 44, PR = 10, PT = 12, PB = 26;
function scaleY(max){ var m = Math.max(1, max); return function(v){ return PT + (H - PT - PB) * (1 - v / m); }; }
function yTicks(max){ var m = Math.max(1, max), step = Math.pow(10, Math.floor(Math.log10(m))); if (m / step < 2) step /= 5; else if (m / step < 5) step /= 2; step = Math.max(1, step); var out = []; for (var v = 0; v <= m + 1e-9; v += step) out.push(Math.round(v)); return out; }
function frame(max, fmt){
  var y = scaleY(max);
  return yTicks(max).map(function(v){ return '<line class="gl" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (PL - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + esc(fmt ? fmt(v) : v) + '</text>'; }).join('');
}
function lineChart(series, key, fmt){
  if (!series.length) return '<p class="m">No snapshots yet.</p>';
  var pts = series.slice(-24 * 30), max = Math.max.apply(null, pts.map(function(p){ return p[key]; })), y = scaleY(max);
  var x = function(i){ return PL + (W - PL - PR) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); };
  var d = pts.map(function(p, i){ return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1); }).join(' ');
  var starts = []; pts.forEach(function(p, i){ if (i === 0 || p.date !== pts[i - 1].date) starts.push(i); });
  var every = Math.max(1, Math.ceil(starts.length / 6));
  var labels = starts.filter(function(_, k){ return k % every === 0; }).map(function(i){ return '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(pts[i].date.slice(5)) + '</text>'; }).join('');
  var hits = pts.map(function(p, i){ return '<rect x="' + (x(i) - (W - PL - PR) / pts.length / 2) + '" y="' + PT + '" width="' + ((W - PL - PR) / pts.length) + '" height="' + (H - PT - PB) + '" fill="transparent" data-tip="' + esc(p.date + ' ' + p.hour + ':00 — ' + fmt(p[key])) + '"/>'; }).join('');
  var last = pts[pts.length - 1];
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" onmousemove="tipMove(event)" onmouseleave="tipHide()">' + frame(max, key === 'mrr' ? function(v){ return '$' + v; } : null) +
    '<path d="' + d + '" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="' + x(pts.length - 1) + '" cy="' + y(last[key]) + '" r="4" fill="var(--blue)" stroke="var(--card)" stroke-width="2"/>' +
    '<text class="ax" x="' + Math.min(x(pts.length - 1), W - PR - 40) + '" y="' + Math.max(PT + 8, y(last[key]) - 8) + '" text-anchor="middle" style="fill:var(--ink);font-weight:700">' + esc(fmt(last[key])) + '</text>' +
    labels + hits + '</svg>';
}
function barChart(pts, key, tipOf, labelOf){
  if (!pts.length) return '<p class="m">Nothing yet today.</p>';
  var max = Math.max.apply(null, pts.map(function(p){ return p[key]; })), y = scaleY(max);
  var slot = (W - PL - PR) / pts.length, bw = Math.min(40, Math.max(3, slot - 2));
  var bars = pts.map(function(p, i){
    var x0 = PL + slot * i + (slot - bw) / 2, top = y(p[key]), h = Math.max(0, (H - PB) - top);
    var lab = labelOf ? labelOf(p) : p.date.slice(5);
    var show = pts.length <= 12 || i % Math.ceil(pts.length / 10) === 0;
    return '<rect x="' + x0 + '" y="' + top + '" width="' + bw + '" height="' + h + '" rx="3" fill="var(--blue)" data-tip="' + esc(lab + ' — ' + tipOf(p)) + '"/>' +
      (show ? '<text class="ax" x="' + (x0 + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + '</text>' : '');
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" onmousemove="tipMove(event)" onmouseleave="tipHide()">' + frame(max) + bars + '</svg>';
}
function tipMove(ev){ var t = ev.target.getAttribute && ev.target.getAttribute('data-tip'); var el = $('tip'); if (!t){ el.style.display = 'none'; return; } el.textContent = t; el.style.display = 'block'; el.style.left = (ev.clientX + 12) + 'px'; el.style.top = (ev.clientY + 12) + 'px'; }
function tipHide(){ $('tip').style.display = 'none'; }

load();
setInterval(load, 60 * 60e3);
document.addEventListener('visibilitychange', function(){ if (!document.hidden) load(); });
`;

module.exports = { createAnalytics, PAGE_JS };
