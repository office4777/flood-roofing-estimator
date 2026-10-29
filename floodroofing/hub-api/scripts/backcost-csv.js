// Every back-costed job in the hub's shared state, as a CSV — the owner's own export (2026-10-28: "give me a
// csv file of all back costing jobs in the last 20 months (only with added labour, don't add any without any
// actual labour on them)"). Reads the team API with the nightly sync's login (HUB_API_URL, HUB_USER, HUB_PASS).
//   WINDOW_MONTHS  calendar months back from this one, inclusive (default 20)
//   KEEP_ALL       1 = keep the jobs with no actual labour too, flagged 'no labour' (the full report wants every row)
// A job with no actual labour — no hours logged AND no actual labour cost — is left out. Writes
// backcost.csv beside this script's working directory and prints it between ===CSV=== markers so the run's
// log carries it too.
const fs = require('fs');
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthKeysBack = n => { const out = []; const d = new Date(); for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(MONTHS[x.getMonth()] + '-' + x.getFullYear()); } return out; };
const jobNoKey = r => String((r && (r.jobNo != null ? r.jobNo : r._jobNo)) || '').replace(/\D/g, '');
const parseKey = (data, k, dflt) => { try { const v = data[k]; if (v == null) return dflt; return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return dflt; } };
const csv = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const r2 = v => Math.round(num(v) * 100) / 100;

async function main() {
  const api = (process.env.HUB_API_URL || '').replace(/\/+$/, '');
  const { HUB_USER, HUB_PASS } = process.env;
  const months = Math.max(1, Math.round(num(process.env.WINDOW_MONTHS) || 20));
  const KEEP_ALL = /^(1|true|yes)$/i.test(String(process.env.KEEP_ALL || ''));   // keep the no-labour rows too, flagged 'no labour'
  if (!api || !HUB_USER || !HUB_PASS) throw new Error('Missing env: need HUB_API_URL, HUB_USER, HUB_PASS.');
  const a = await fetch(api + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: HUB_USER, pass: HUB_PASS }) });
  const aj = await a.json().catch(() => ({})); if (!a.ok || !aj.token) throw new Error('login failed: ' + (aj.error || a.status));
  const s = await fetch(api + '/api/state', { headers: { Authorization: 'Bearer ' + aj.token } });
  if (!s.ok) throw new Error('state read failed: ' + s.status);
  const sj = await s.json(); const data = (sj && sj.data) || {};
  const rows = parseKey(data, 'fr3_bcFergus', []);
  const excl = parseKey(data, 'fr3_jobExcluded', {}), avg = parseKey(data, 'fr3_jobAvgRate', {}), sub = parseKey(data, 'fr3_jobSubK', {});
  const win = monthKeysBack(months); const winSet = new Set(win);
  const dropped = { outsideWindow: 0, noLabour: 0 };
  const out = [];
  rows.forEach(r => {
    if (!winSet.has(r.month)) { dropped.outsideWindow++; return; }
    const hrs = Math.max(num(r.h_actual), num(r._loggedHrs));
    const noLabour = hrs <= 0 && num(r.a_lab) <= 0;
    if (noLabour && !KEEP_ALL) { dropped.noLabour++; return; }
    const k = jobNoKey(r);
    const sales = num(r.sales), aLab = num(r.a_lab), aMat = num(r.a_mat), gp = num(r.gp);
    out.push({
      month: r.month, date: r.date || '', jobNo: k || (r._jobNo || ''), job: r.job || '', site: r._site || '', title: r._title || '', type: r.job_type || '',
      status: r._inProgress ? 'in progress' : 'completed', lead: r.lead || '',
      sales: r2(sales), pLab: r2(r.p_lab), pMat: r2(r.p_mat), aLab: r2(aLab), aMat: r2(aMat), gp: r2(gp), gpm: sales > 0 ? Math.round(gp / sales * 1000) / 10 : '',
      hPriced: r2(r.h_priced), hActual: r2(hrs), labHr: hrs > 0 ? r2(aLab / hrs) : '', revHr: hrs > 0 ? r2(sales / hrs) : '', gpHr: hrs > 0 ? r2(gp / hrs) : '',
      pLabCost: r2(r.p_labCost), pMatCost: r2(r.p_matCost), pCost: r2(r.p_cost), hFergus: r2(r.h_actual), hLogged: r2(r._loggedHrs), fStatus: r._status || '', fid: r._fergus_id || '',
      flags: [k && excl[k] ? 'crossed out' : '', k && avg[k] ? 'avg-forced' : '', k && sub[k] ? 'sub-contract' : '', noLabour ? 'no labour' : ''].filter(Boolean).join('; ')
    });
  });
  const mi = m => { const [mm, yy] = m.split('-'); return num(yy) * 12 + MONTHS.indexOf(mm); };
  out.sort((x, y) => (mi(y.month) - mi(x.month)) || String(y.date).localeCompare(String(x.date)));
  const head = ['Month','Date','Job no','Customer & site','Site','Title','Job type','Status','Lead','Sales $','Priced labour $','Priced materials $','Actual labour $','Actual materials $','GP $','GPM %','Priced hrs','Actual hrs','Labour $/hr','Revenue $/hr','GP $/hr','Flags','Priced labour cost $','Priced materials cost $','Priced cost $','Fergus hrs','Timesheet hrs','Fergus status','Fergus id'];
  const lines = [head.map(csv).join(',')].concat(out.map(o => [o.month, o.date, o.jobNo, o.job, o.site, o.title, o.type, o.status, o.lead, o.sales, o.pLab, o.pMat, o.aLab, o.aMat, o.gp, o.gpm, o.hPriced, o.hActual, o.labHr, o.revHr, o.gpHr, o.flags, o.pLabCost, o.pMatCost, o.pCost, o.hFergus, o.hLogged, o.fStatus, o.fid].map(csv).join(',')));
  const text = lines.join('\n') + '\n';
  fs.writeFileSync('backcost.csv', text);
  console.log('Shared state updated ' + (sj.meta && sj.meta.updatedAt ? new Date(sj.meta.updatedAt).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) + ' NZ' : '(unknown)') + ' · ' + rows.length + ' back-costed rows · window ' + win[win.length - 1] + ' → ' + win[0] + ' (' + months + ' months)');
  console.log('Kept ' + out.length + ' jobs with actual labour · left out ' + dropped.outsideWindow + ' outside the window, ' + dropped.noLabour + ' with no actual labour');
  console.log('===CSV===');
  process.stdout.write(text);
  console.log('===END===');
}
main().catch(e => { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); });
