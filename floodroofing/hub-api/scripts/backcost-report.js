// Back-costing by job size: what GP margin each revenue band needs to hit a GP-per-hour target.
//
// Runs where the hub's credentials already live (the GitHub Action, same secrets as the nightly
// sync): signs in to the team API, reads the shared state, and applies the SAME rules the hub's
// own Growth figures use (fergusProd in FloodRoofing_Financials.html) — completed jobs only, a
// crossed-out job is skipped, an "avg"-forced job is skipped (its own rate is not measurable), a
// sub-contract job is valued over its PRICED hours, and a job with no hours is left out.
//
// Prints aggregates only — counts, dollars and hours per band — never a job name or number, so the
// log is safe to leave in the private repo's run history.
//
//   HUB_API_URL, HUB_USER, HUB_PASS   as the nightly sync
//   GP_HR          the GP-per-hour target (default 100)
//   WINDOW_MONTHS  0 = every back-costed job (default); N = the last N calendar months only
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BANDS = [[0, 5000, '$0 – 5k'], [5000, 14000, '$5k – 14k'], [14000, 25000, '$14k – 25k'], [25000, 45000, '$25k – 45k'], [45000, Infinity, '$45k +']];

function jobNoKey(r) { const raw = r && (r.jobNo != null ? r.jobNo : r._jobNo); return String(raw == null ? '' : raw).replace(/\D/g, ''); }
function monthKeysBack(n) { const out = new Set(); const d = new Date(); d.setDate(1); for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.add(MONTHS[x.getMonth()] + '-' + x.getFullYear()); } return out; }
function parseKey(data, k, dflt) { try { const v = data[k]; if (v == null) return dflt; return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return dflt; } }
const money = v => '$' + Math.round(v).toLocaleString('en-NZ');
const pct = v => (v * 100).toFixed(1) + '%';
const pad = (s, w, right) => { s = String(s); return right ? s.padStart(w) : s.padEnd(w); };
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function analyse(rows, opts) {
  const { excl, avg, sub, target, window } = opts;
  const dropped = { inProgress: 0, excluded: 0, avgForced: 0, noHours: 0, noSales: 0, outsideWindow: 0 };
  const jobs = [];
  rows.forEach(r => {
    if (r._inProgress) { dropped.inProgress++; return; }
    const k = jobNoKey(r);
    if (k && excl[k]) { dropped.excluded++; return; }
    if (k && avg[k]) { dropped.avgForced++; return; }
    if (window && !window.has(r.month)) { dropped.outsideWindow++; return; }
    let h = Math.max(num(r.h_actual), num(r._loggedHrs));
    if (k && sub[k] && num(r.h_priced) > 0) h = num(r.h_priced);
    const sales = num(r.sales), gp = num(r.gp);
    if (sales <= 0) { dropped.noSales++; return; }
    if (h <= 0) { dropped.noHours++; return; }
    jobs.push({ sales, gp, h });
  });
  const bands = BANDS.map(([lo, hi, label]) => {
    const js = jobs.filter(j => j.sales >= lo && j.sales < hi);
    const rev = js.reduce((s, j) => s + j.sales, 0), gp = js.reduce((s, j) => s + j.gp, 0), hrs = js.reduce((s, j) => s + j.h, 0);
    const perJobTarget = js.map(j => target * j.h / j.sales);
    return { label, n: js.length, rev, gp, hrs,
      gpm: rev > 0 ? gp / rev : 0, gpHr: hrs > 0 ? gp / hrs : 0, hrsPerK: rev > 0 ? hrs / (rev / 1000) : 0,
      targetGpm: rev > 0 ? target * hrs / rev : 0, medianTargetGpm: median(perJobTarget),
      hitting: js.filter(j => j.h > 0 && j.gp / j.h >= target).length,
      avgJob: js.length ? rev / js.length : 0 };
  });
  const all = (() => { const rev = jobs.reduce((s, j) => s + j.sales, 0), gp = jobs.reduce((s, j) => s + j.gp, 0), hrs = jobs.reduce((s, j) => s + j.h, 0);
    return { label: 'ALL JOBS', n: jobs.length, rev, gp, hrs, gpm: rev > 0 ? gp / rev : 0, gpHr: hrs > 0 ? gp / hrs : 0, hrsPerK: rev > 0 ? hrs / (rev / 1000) : 0,
      targetGpm: rev > 0 ? target * hrs / rev : 0, medianTargetGpm: median(jobs.map(j => target * j.h / j.sales)), hitting: jobs.filter(j => j.gp / j.h >= target).length, avgJob: jobs.length ? rev / jobs.length : 0 }; })();
  return { bands, all, dropped, n: jobs.length };
}

function printTable(title, res, target) {
  console.log('\n' + title);
  console.log('='.repeat(title.length));
  const cols = [['Revenue band', 14], ['Jobs', 5], ['Avg job', 10], ['Revenue', 12], ['Hours', 8], ['Hrs/$1k', 8], ['Actual GPM', 11], ['Actual GP/hr', 13], ['TARGET GPM', 11], ['Median job', 11], ['At target', 10]];
  console.log(cols.map(([h, w], i) => pad(h, w, i > 0)).join('  '));
  console.log(cols.map(([h, w]) => '-'.repeat(w)).join('  '));
  res.bands.concat([res.all]).forEach(b => {
    const row = b.n ? [b.label, b.n, money(b.avgJob), money(b.rev), b.hrs.toFixed(0), b.hrsPerK.toFixed(1), pct(b.gpm), money(b.gpHr), pct(b.targetGpm), pct(b.medianTargetGpm), b.hitting + '/' + b.n]
                    : [b.label, 0, '—', '—', '—', '—', '—', '—', '—', '—', '—'];
    console.log(row.map((v, i) => pad(v, cols[i][1], i > 0)).join('  '));
  });
  console.log('\nTARGET GPM = the gross margin that band needs so GP ÷ hours = $' + target + '/hr, on the band\'s pooled hours and revenue');
  console.log('(' + target + ' × hours ÷ revenue). "Median job" is the same figure worked per job, middle value. "At target" = jobs already at');
  console.log('$' + target + '/hr or better. Hrs/$1k = crew hours logged per $1,000 of revenue — the number that drives the target.');
  const d = res.dropped;
  console.log('Left out: ' + d.inProgress + ' still in progress, ' + d.excluded + ' crossed out, ' + d.avgForced + ' avg-forced, ' + d.noHours + ' with no hours, ' + d.noSales + ' with no revenue' + (d.outsideWindow ? ', ' + d.outsideWindow + ' outside the window' : '') + '.');
}

async function main() {
  const api = (process.env.HUB_API_URL || '').replace(/\/+$/, '');
  const { HUB_USER, HUB_PASS } = process.env;
  const target = num(process.env.GP_HR) || 100;
  const months = Math.max(0, Math.round(num(process.env.WINDOW_MONTHS)));
  if (!api || !HUB_USER || !HUB_PASS) throw new Error('Missing env: need HUB_API_URL, HUB_USER, HUB_PASS.');
  const authRes = await fetch(api + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: HUB_USER, pass: HUB_PASS }) });
  const authJson = await authRes.json().catch(() => ({}));
  if (!authRes.ok || !authJson.token) throw new Error('Login failed: ' + (authJson.error || authRes.status));
  const stRes = await fetch(api + '/api/state', { headers: { Authorization: 'Bearer ' + authJson.token } });
  if (!stRes.ok) throw new Error('State read failed: ' + stRes.status);
  const sj = await stRes.json();
  const data = (sj && sj.data) || {};
  const rows = parseKey(data, 'fr3_bcFergus', []);
  const excl = parseKey(data, 'fr3_jobExcluded', {}), avg = parseKey(data, 'fr3_jobAvgRate', {}), sub = parseKey(data, 'fr3_jobSubK', {});
  console.log('Shared state updated ' + (sj.meta && sj.meta.updatedAt ? new Date(sj.meta.updatedAt).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) + ' NZ' : '(unknown)') + ' · ' + rows.length + ' back-costed Fergus rows · GP/hr target $' + target);
  printTable('EVERY BACK-COSTED JOB', analyse(rows, { excl, avg, sub, target, window: null }), target);
  printTable('LAST 12 MONTHS', analyse(rows, { excl, avg, sub, target, window: monthKeysBack(12) }), target);
  if (months) printTable('LAST ' + months + ' MONTHS', analyse(rows, { excl, avg, sub, target, window: monthKeysBack(months) }), target);
  // The same target at $80 and $120 so the sensitivity is on one page.
  [80, 120].forEach(t => { if (t !== target) { const r = analyse(rows, { excl, avg, sub, target: t, window: null }); console.log('\nAt $' + t + '/hr, every job: ' + r.bands.map(b => b.label + ' → ' + (b.n ? pct(b.targetGpm) : '—')).join(' · ')); } });
}
main().catch(e => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
