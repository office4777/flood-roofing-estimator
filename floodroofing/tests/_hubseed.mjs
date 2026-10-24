// A believable Finance Hub, without Fergus, Xero or the bank: the fr3_* keys
// the app reads at boot, built relative to today so every period has data.
// Used by tests/hubui.mjs and tools/hub-shots.mjs. Not a suite of its own.
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const mk = d => MON[d.getMonth()] + '-' + d.getFullYear();
const iso = d => d.toISOString();
const daysAgo = (n, h) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h == null ? 10 : h, 0, 0, 0); return d; };
const NAMES = ['M. Whitiora', 'B. Williamson', 'P. Harrington', 'D. Bolous', 'K. Tane', 'S. Rewi', 'A. Hemi', 'J. Parata',
  'L. Ngata', 'R. Kingi', 'T. Morgan', 'H. Walker', 'G. Smith', 'C. Brown', 'N. Wilson', 'F. Taylor'];
const STREETS = ['Kauri Rd', 'Bank St', 'Maunu Rd', 'Riverside Dr', 'Western Hills Dr', 'Kamo Rd', 'Tutukaka Hwy', 'Whau Valley Rd'];

export function hubSeed(){
  let r = 7;   // a fixed sequence, so every run is the same hub
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const site = i => (12 + i * 7) + ' ' + STREETS[i % STREETS.length] + ', Whangarei';

  // ── forward workflow: active jobs with priced and actual hours ──
  const fwJobs = [], cashJobs = [];
  for (let i = 0; i < 14; i++){
    const priced = Math.round(40 + rnd() * 260), actual = Math.round(priced * rnd() * 0.7);
    const sale = Math.round(priced * (95 + rnd() * 40));
    const row = { id: String(9100 + i), jobNo: String(3290 + i), job: NAMES[i] + ' — ' + site(i), priced, actual,
      remaining: Math.max(0, priced - actual), pMat: Math.round(sale * 0.38), pLab: 0, aMat: Math.round(sale * 0.38 * rnd()),
      aLab: Math.round(actual * 55), sale, quoted: sale, chg: 0, billed: Math.round(sale * rnd() * 0.5), status: 'Active' };
    fwJobs.push(row);
    cashJobs.push(Object.assign({}, row, { hActual: actual, hPriced: priced, fin: false, _lm: iso(daysAgo(i)) }));
  }

  // ── marketing: leads and quotes across the last four months ──
  const leads = [], quotes = [];
  for (let i = 0; i < 90; i++){
    const d = daysAgo(Math.floor(rnd() * 120), 9 + (i % 8));
    leads.push({ createdAt: iso(d), name: NAMES[i % NAMES.length], jobNo: String(3200 + i), site: site(i) });
    if (i % 3 !== 2){
      const sent = new Date(d.getTime() + 3 * 864e5), acc = rnd() < 0.38;
      quotes.push({ jobId: String(8000 + i), jobNo: String(3200 + i), job: NAMES[i % NAMES.length], site: site(i),
        total: Math.round(8000 + rnd() * 52000), quoteDate: iso(d), sentAt: iso(sent),
        acceptedAt: acc ? iso(new Date(sent.getTime() + 6 * 864e5)) : null, isSent: true, isAccepted: acc, versionNumber: 1 });
    }
  }
  const mkt = { leads, quotes, ts: '24 Oct 9:12 am', nE: leads.length, nQ: quotes.length,
    nSent: quotes.filter(q => q.isSent).length, nAcc: quotes.filter(q => q.isAccepted).length, enqErr: '' };

  // ── Xero monthly P&L for the last 14 months ──
  const xeroMonthly = {};
  for (let m = 1; m <= 14; m++){
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
    const rev = Math.round(110000 + rnd() * 90000), gp = Math.round(rev * (0.38 + rnd() * 0.14));
    const opex = Math.round(36000 + rnd() * 9000), wages = Math.round(rev * 0.22);
    xeroMonthly[mk(d)] = { rev, gp, opex, np: gp - opex, wages };
  }

  // ── bank and the balance sheet ──
  const bank = { ts: '24 Oct 8:40 am', tx: [], accounts: [
    { _id: 'acc_1', name: 'Business Cheque', type: 'CHECKING', balance: { current: 84213.55, available: 84213.55 } },
    { _id: 'acc_2', name: 'Business Savings', type: 'SAVINGS', balance: { current: 42000.00, available: 42000.00 } },
    { _id: 'acc_3', name: 'Tax Account', type: 'SAVINGS', balance: { current: 23518.20, available: 23518.20 } },
  ] };
  const ar = {}; fwJobs.slice(0, 6).forEach((j, i) => { ar[j.id] = { due: Math.round(4000 + i * 1800), inv: 'INV-' + (2100 + i) }; });
  const cash = { rows: [{ name: 'Accounts Receivable', val: 61240, sect: 'Current Assets' }, { name: 'Accounts Payable', val: -38810, sect: 'Current Liabilities' }],
    paidByJob: null, arByJob: ar, apByCode: null, apBills: [], apBillsTotal: 38810, accounts: null, ts: '24 Oct 8:41 am' };

  // ── back costing synced from Fergus: finished jobs over the last two months ──
  const bcFergus = [];
  for (let i = 0; i < 9; i++){
    const d = daysAgo(3 + i * 6), sales = Math.round(9000 + rnd() * 41000), gpm = 0.28 + rnd() * 0.2, gp = Math.round(sales * gpm);
    const hp = Math.round(sales / 120), ha = Math.round(hp * (0.8 + rnd() * 0.5));
    bcFergus.push({ month: mk(d), job: NAMES[(i + 3) % NAMES.length] + ' — ' + site(i + 20) + ', Northland 0110', date: iso(d).split('T')[0],
      job_type: i % 3 ? 'Re-Roof' : 'Re-Roof & Gutter', _title: 'Re-roof', _jobNo: String(3240 + i), _site: site(i + 20) + ', Northland 0110',
      p_lab: hp * 55, a_lab: ha * 55, p_mat: Math.round(sales * 0.35), a_mat: Math.round(sales * 0.36), sales, gp, gpm: Math.round(gpm * 1000) / 10,
      h_actual: ha, h_priced: hp, lead_src: 'Fergus', _fergus: true, _fergus_id: String(7700 + i), _lastModified: iso(d) });
  }

  // ── the start-of-month backlog snapshots behind the forward workflow trend ──
  const fwHist = {};
  [1320, 1480, 1610, 1390, 1540].forEach((h, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); fwHist[mk(d)] = { h, d: Math.round(h / 64 * 10) / 10 }; });

  return {
    fwJobs, fwHist, bcFergus, cashJobs, fwCfg: { teams: 4, size: 2, hrs: 8 }, fw_last_sync: '24 Oct 8:30 am',
    mkt, xeroMonthly, xero_last_sync: '24 Oct 8:35 am', bank, cash, theme: 'light',
  };
}

// The seed as an init script body: writes every key as fr3_<key>.
export function hubSeedScript(extra){
  const all = Object.assign(hubSeed(), extra || {});
  return 'try{' + Object.keys(all).map(k => 'localStorage.setItem(' + JSON.stringify('fr3_' + k) + ',' + JSON.stringify(JSON.stringify(all[k])) + ');').join('') + '}catch(e){}';
}
