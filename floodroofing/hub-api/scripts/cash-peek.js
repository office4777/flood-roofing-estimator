// What the hub's shared Cash state holds right now — the Xero supplier bills by due month, and the ones due
// this month — so a Command Centre figure can be checked against Xero without a screen. Reads the team
// API with the nightly sync's login (HUB_API_URL, HUB_USER, HUB_PASS). Suppliers and amounts only.
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
async function main() {
  const api = (process.env.HUB_API_URL || '').replace(/\/+$/, '');
  const { HUB_USER, HUB_PASS } = process.env;
  const a = await fetch(api + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: HUB_USER, pass: HUB_PASS }) });
  const aj = await a.json(); if (!a.ok || !aj.token) throw new Error('login failed: ' + (aj.error || a.status));
  const s = await fetch(api + '/api/state', { headers: { Authorization: 'Bearer ' + aj.token } });
  const sj = await s.json(); const data = (sj && sj.data) || {};
  const get = k => { try { const v = data[k]; return v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return null; } };
  const cash = get('fr3_cash') || {};
  console.log('Cash synced: ' + (cash.ts || '—') + ' · apBillsTotal ' + num(cash.apBillsTotal).toFixed(2) + ' · bills in list: ' + ((cash.apBills || []).length));
  const by = {};
  (cash.apBills || []).forEach(b => { const k = String(b.due || '').slice(0, 7) || 'no date'; const v = by[k] || (by[k] = { n: 0, amt: 0 }); v.n++; v.amt += num(b.amt); });
  Object.keys(by).sort().forEach(k => console.log('  due ' + k + ': ' + by[k].n + ' bills, $' + by[k].amt.toFixed(2)));
  const now = new Date(); const cur = now.toISOString().slice(0, 7);
  console.log('Due this month or earlier (' + cur + '):');
  (cash.apBills || []).filter(b => String(b.due || '').slice(0, 7) <= cur).sort((x, y) => String(x.due).localeCompare(String(y.due))).forEach(b => console.log('  ' + b.due + '  ' + String(b.supplier || '').slice(0, 28).padEnd(28) + ' $' + num(b.amt).toFixed(2)));
  const cj = get('fr3_cashJobs') || []; console.log('cashJobs: ' + cj.length + ' · hub state keys: ' + Object.keys(data).length);
}
main().catch(e => { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); });
