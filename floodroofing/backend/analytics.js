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
const { shiftDate } = require('./daily');

const HOUR = 3600e3;
const KEEP_HOURS = 24 * 45;      // 45 days of hourly points
const PLAN_LABEL = { solo: 'Trade', team: 'Team', business: 'Business', monthly: 'Legacy' };

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
    const latest = {
      at: new Date(at).toISOString(), build: buildSha,
      today: { date: rep.date, nice: rep.nice, summary: point, users: slimUsers(rep),
               new_trials: rep.new_trials.map(slimCo), trials: rep.trials.map(slimCo),
               paid: Object.keys(rep.paid).reduce((o, k) => { o[k] = rep.paid[k].map(slimCo); return o; }, {}) },
      yesterday: { date: yest.date, nice: yest.nice, summary: summarise(yest, at), users: slimUsers(yest), new_trials: yest.new_trials.map(slimCo) },
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

  // What the page reads. Takes the first snapshot itself if there is none.
  async function collect(){
    let latest = await getState('analytics_latest');
    let series = await getState('analytics_series');
    if (!latest || !Array.isArray(series)){
      const s = await snapshot();
      latest = s.latest; series = s.series;
    }
    return { latest, series, plan_price: PLAN_PRICE, plan_label: PLAN_LABEL, build: buildSha, now: new Date().toISOString() };
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
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>RoofMap analytics</title><style>' +
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
    '.tw{overflow-x:auto}.ft{color:var(--mute);font-size:12px;text-align:center;padding:10px 0}.err{background:#fde8e8;color:#7f1d1d;border-radius:8px;padding:10px 14px;margin-bottom:12px}' +
    '</style></head><body><div class="w">' +
    '<div class="hd"><div><h1>RoofMap — live activity</h1><p id="sub">Loading…</p></div><div><button id="sync" onclick="syncNow()">Sync now</button></div></div>' +
    '<div id="err" class="err" style="display:none"></div>' +
    '<div id="tiles" class="tiles"></div>' +
    '<div class="grid2"><div class="c"><h2>MRR, paying businesses combined</h2><div id="chMrr"></div></div>' +
    '<div class="c"><h2>Businesses on a trial</h2><div id="chTrials"></div></div>' +
    '<div class="c"><h2>People active, by day</h2><div id="chActive"></div></div>' +
    '<div class="c"><h2>Quotes sent, by day</h2><div id="chQuotes"></div></div>' +
    '<div class="c"><h2>Minutes in the app, by day</h2><div id="chMinutes"></div></div>' +
    '<div class="c"><h2>Activity today, hour by hour</h2><div id="chHours"></div></div></div>' +
    '<div class="c"><div class="tabs"><button id="tabT" class="on" onclick="showDay(\'today\')">Today so far</button><button id="tabY" onclick="showDay(\'yesterday\')">Yesterday</button></div>' +
    '<h2 id="actH"></h2><div class="tw"><table><thead><tr><th>Person</th><th>Business</th><th>Plan</th><th class="n">Logins</th><th class="n">Canvas</th><th class="n">Quotes</th><th class="n">Orders</th><th class="n">Feedback</th><th class="n">Minutes</th></tr></thead><tbody id="rows"></tbody></table></div></div>' +
    '<div class="grid2"><div class="c"><h2 id="ntH">New trials today</h2><div id="newTrials"></div></div>' +
    '<div class="c"><h2 id="trH">On a trial now</h2><div id="trials"></div></div>' +
    '<div class="c"><h2 id="pdH">Paying</h2><div id="paid"></div></div></div>' +
    '<p class="ft" id="ft"></p></div><div class="tip" id="tip"></div>' +
    '<script>' + PAGE_JS + '</script></body></html>';
  }

  return { collect, snapshot, tick, start, due, renderPage, summarise };
}

const PAGE_JS = String.raw`
var TOKEN = (function(){
  var u = new URL(location.href), t = u.searchParams.get('token');
  if (t){ try { localStorage.setItem('rm_admin_token', t); } catch(e){} u.searchParams.delete('token'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); return t; }
  try { return localStorage.getItem('rm_admin_token') || ''; } catch(e){ return ''; }
})();
var API = location.pathname.replace(/\/page\/?$/, '');
var DATA = null, DAY = 'today';
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
    var r = await fetch(API, { headers: { 'x-admin-token': TOKEN } });
    if (r.status === 404) throw new Error('Not signed in: open this page from the link with your admin token once, and it remembers it.');
    if (!r.ok) throw new Error('The server answered ' + r.status);
    DATA = await r.json();
    $('err').style.display = 'none';
    render();
  } catch (e){ $('err').style.display = ''; $('err').textContent = e.message; }
}
async function syncNow(){
  var b = $('sync'); b.disabled = true; b.textContent = 'Syncing…';
  try { var r = await fetch(API + '/refresh', { method: 'POST', headers: { 'x-admin-token': TOKEN } }); if (!r.ok) throw new Error('sync failed: ' + r.status); await load(); }
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
  var L = DATA.latest, T = L.today, Y = L.yesterday, s = T.summary, ys = Y.summary, P = DATA.plan_label || {};
  $('sub').textContent = 'Synced ' + nz(L.at, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' NZ · refreshes every hour · today is ' + T.nice;
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
  var days = byDay(DATA.series);
  $('chMrr').innerHTML = lineChart(DATA.series, 'mrr', function(v){ return money(v); });
  $('chTrials').innerHTML = lineChart(DATA.series, 'trials', function(v){ return v + ' on a trial'; });
  $('chActive').innerHTML = barChart(days.slice(-21), 'active', function(p){ return p.active + ' of ' + p.people + ' active'; });
  $('chQuotes').innerHTML = barChart(days.slice(-21), 'quotes', function(p){ return p.quotes + ' quotes'; });
  $('chMinutes').innerHTML = barChart(days.slice(-21), 'minutes', function(p){ return p.minutes + ' min'; });
  var todayPts = DATA.series.filter(function(p){ return p.date === T.date; });
  $('chHours').innerHTML = barChart(todayPts, 'events', function(p){ return p.events + ' events by ' + p.hour + ':00'; }, function(p){ return p.hour + ':00'; });
  showDay(DAY);
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
function showDay(which){
  DAY = which;
  $('tabT').className = which === 'today' ? 'on' : ''; $('tabY').className = which === 'yesterday' ? 'on' : '';
  var D = DATA.latest[which];
  $('actH').textContent = 'Activity ' + (which === 'today' ? 'today so far' : 'yesterday') + ' — ' + D.summary.active + ' of ' + D.users.length + ' people did something';
  $('rows').innerHTML = D.users.map(function(u){
    var quiet = !(u.logins || u.canvas || u.quotes || u.orders || u.feedback || u.minutes);
    var plan = u.company_status === 'paying' ? '<span class="p">' + esc((DATA.plan_label || {})[u.plan] || u.plan) + '</span>' : esc(planWord(u));
    return '<tr class="' + (quiet ? 'q' : '') + '"><td><b>' + esc(u.name || u.email) + '</b>' + (u.name ? '<br><span class="m">' + esc(u.email) + '</span>' : '') + '</td><td>' + esc(u.company) + '</td><td>' + plan + '</td>' +
      ['logins','canvas','quotes','orders','feedback','minutes'].map(function(k){ return '<td class="n">' + (u[k] || '·') + '</td>'; }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="9" class="m">Nobody yet.</td></tr>';
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
