// RoofMap's labour calculator against the back-costed jobs.
//
// For every COMPLETED, non-pole-shed Fergus job this reads three things through the fergus-proxy
// (the same proxy and secret the nightly sync uses):
//   • the job's financial summary — revenue, the hours the crew actually logged, labour + material cost;
//   • the quote RoofMap pushed into Fergus — its "Roofing sheets" m², the ridge / hip / valley / barge /
//     apron lm, the pipe flashings, the gutter run, the Lead Roofer + Apprentice hours that were priced,
//     and the Scaffolding line (price, cost, edge protection or platform);
//   • the supplier invoices on the job (Fergus if the API exposes them, else Xero's supplier bills that
//     name the job number) — to see whether the scaffold was bought in or put up by the crew.
// Then it runs RoofMap's own labour auto-calc (`_labourCalcHours` in app.html: roof m² ÷ 14, sheet
// columns ÷ 6, cut lm ÷ 18, flashing lm ÷ 8, penetrations ÷ 6, rounded UP, both crew members at that
// figure, so man-hours = 2 × ceil(sum)) over the quote's quantities and compares it with what the crew
// logged — per job, per revenue band, and as a least-squares fit of what the rates WOULD need to be.
//
// Only a job quoted through RoofMap carries the quantities, so older jobs (quoted by hand in Fergus)
// are listed with their priced vs actual hours only. Prints the per-job table + aggregates to the log
// and writes labour-check.csv (uploaded as the run's artifact).
//
//   PROXY_URL, PROXY_SECRET   required (the fergus-proxy)
//   SINCE                     only jobs last modified on/after this date (YYYY-MM-DD; default: all)
//   MAX_JOBS                  cap for a quick trial run (default 0 = no cap)
//   CONCURRENCY               parallel Fergus reads (default 4)
//   XERO_PAGES                supplier-bill pages to read for the scaffold check (default 100 × 100 bills; 0 = skip)
const fs = require('fs');

const PROXY = (process.env.PROXY_URL || '').replace(/\/+$/, '');
const SECRET = process.env.PROXY_SECRET || '';
const SINCE = process.env.SINCE ? new Date(process.env.SINCE) : null;
const MAX_JOBS = parseInt(process.env.MAX_JOBS || '0', 10) || 0;
const CONC = parseInt(process.env.CONCURRENCY || '4', 10) || 4;
const XERO_PAGES = process.env.XERO_PAGES == null ? 100 : (parseInt(process.env.XERO_PAGES, 10) || 0);
if (!PROXY || !SECRET) { console.error('Need PROXY_URL and PROXY_SECRET.'); process.exit(2); }

// RoofMap's calculator, verbatim from app.html (LABOUR_CALC_DEFAULT_RATES, LABOUR_CALC_SHEET_WIDTH_M).
const RATES = { roof: 14, sheets: 6, cuts: 18, flash: 8, pen: 6 };
const SHEET_W = 0.762;
// The pushed flashing lines carry the ordering wastage (0.5 m a run + 0.1 m a join over 8 m stock);
// the calculator reads the DRAWN length. ~6% on a typical run.
const WASTE = 1.06;
const SCREWS_PER_M2 = 8;      // _ordCons default: the screw line is ceil(area × 8 / 100) × 100
const EST_SHEET_LEN = 5.5;    // used only when no gutter run is on the quote (columns are then an estimate)
const SCAFF_RE = /scaffold|\bscaff\b|layher|allscaff|upright|camelspace|intaks|safesmart|edge protection|height ?safe|kwikstage|quickstage|mobile tower/i;
const BANDS = [[0, 5000, '$0 – 5k'], [5000, 14000, '$5k – 14k'], [14000, 25000, '$14k – 25k'], [25000, 45000, '$25k – 45k'], [45000, Infinity, '$45k +']];

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arr = j => Array.isArray(j) ? j : ((j && (j.data || j.value || j.results || j.jobs || j.quotes || j.items || j.Invoices)) || []);
function fnum(o) {
  if (o == null) return 0;
  if (typeof o === 'number') return isNaN(o) ? 0 : o;
  if (typeof o === 'string') return num(o);
  if (typeof o === 'object') { for (const k of ['value', 'amount', 'total', 'incTax', 'exTax', 'cost']) if (o[k] != null) return fnum(o[k]); }
  return 0;
}
function fpick(obj) { for (let i = 1; i < arguments.length; i++) { const k = arguments[i]; if (obj && obj[k] != null) return obj[k]; } return undefined; }
function fergusName(x) { if (!x) return ''; if (typeof x === 'string') return x; return x.customerFullName || x.name || x.fullName || [x.firstName, x.lastName].filter(Boolean).join(' ') || x.companyName || x.customerName || ''; }
function fergusAddr(x) { if (!x) return ''; if (typeof x === 'string') return x; return [x.address1 || x.addressLine1 || x.line1 || x.street || x.address, x.addressSuburb || x.suburb, x.addressCity || x.city || x.town].filter(Boolean).join(', '); }

// ── the proxy ──
function proxyUrl(svc, fullPath) {
  const qi = fullPath.indexOf('?');
  const p = qi >= 0 ? fullPath.slice(0, qi) : fullPath;
  let u = PROXY + '/api/proxy?svc=' + svc + '&path=' + encodeURIComponent(p);
  if (qi >= 0) fullPath.slice(qi + 1).split('&').forEach(pair => { if (!pair) return; const eq = pair.indexOf('='); const k = eq >= 0 ? pair.slice(0, eq) : pair; const v = eq >= 0 ? pair.slice(eq + 1) : ''; u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v); });
  return u;
}
let calls = 0;
async function viaProxy(svc, path, opts) {
  opts = opts || {};
  for (let tries = 0; ; tries++) {
    let res;
    try { res = await fetch(proxyUrl(svc, path), { headers: { Accept: 'application/json', 'X-Proxy-Secret': SECRET } }); }
    catch (e) { if (tries < 3) { await sleep(800 * (tries + 1)); continue; } throw e; }
    calls++;
    if ((res.status === 429 || res.status === 503 || res.status === 502) && tries < 7) {
      const ra = parseFloat(res.headers.get('Retry-After'));
      await sleep((isFinite(ra) && ra > 0) ? Math.min(30000, ra * 1000) : Math.min(20000, 600 * Math.pow(2, tries)) + Math.floor(Math.random() * 400));
      continue;
    }
    const body = await res.text();
    if (opts.probe) return { status: res.status, body };
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path.slice(0, 60) + ': ' + body.slice(0, 160));
    try { return body ? JSON.parse(body) : {}; } catch (e) { throw new Error('Bad JSON from ' + path.slice(0, 60)); }
  }
}
const fergus = p => viaProxy('fergus', p);
const xero = p => viaProxy('xero', p);
async function fergusPaginate(path, maxPages, onPage) {
  let all = [], url = path, pages = 0;
  while (url && pages < maxPages) {
    const json = await fergus(url);
    const got = arr(json);
    all = all.concat(got);
    if (onPage) onPage(all.length);
    let nx = json && json.paging && json.paging.links && json.paging.links.next;
    if (nx && /^https?:\/\//.test(nx)) nx = nx.replace(/^https?:\/\/[^/]+/, '');
    if (!nx && got.length && /pageSize=/.test(url)) {        // no next link: page by number until a short page
      if (got.length < 100) break;
      const m = url.match(/[?&]page=(\d+)/); const n = m ? parseInt(m[1], 10) + 1 : 2;
      nx = m ? url.replace(/([?&]page=)\d+/, '$1' + n) : url + '&page=' + n;
    }
    url = nx || null; pages++;
  }
  return all;
}
async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ── Fergus's financial summary → the back-costing figures (the hub's fsFig, trimmed) ──
function fsFig(s) {
  s = s || {};
  const ci = s.costsIncurred || s.currentCosts || s.spentCosts || s.costs || {};
  const qs = s.quoteSummary || s.priced || s.quote || {};
  const ca = s.chargeableAmount || s.billable || s.chargeable || {};
  const tb = s.totalBilled || s.invoiced || s.totalInvoiced || {};
  const lh = s.labourHours || s.hours || {};
  const priced = fnum(fpick(qs, 'quotedAmount', 'priced', 'billablePriced', 'pricedAmount', 'total', 'amount')) || fnum(fpick(ca, 'total', 'priced', 'billable', 'amount'));
  const claimed = fnum(fpick(tb, 'total', 'invoicedBillable', 'invoiced', 'claimed', 'totalClaimed'));
  const rev = (claimed > 0 ? claimed : priced) || priced || claimed;
  const lab = fnum(fpick(ci, 'labour', 'labor', 'labourCost', 'currentLabour')) || fnum(fpick(s, 'currentLabourCosts', 'labourCosts'));
  const mat = fnum(fpick(ci, 'materials', 'material', 'materialCost', 'currentMaterials')) || fnum(fpick(s, 'currentMaterialCosts', 'materialCosts'));
  const hours = Math.max(fnum(lh.total), fnum(lh.logged), fnum(lh.loggedHours), fnum(lh.incurred), fnum(lh.incurredHours), fnum(lh.actual), fnum(s.loggedHours), fnum(s.incurredHours)) || fnum(fpick(lh, 'billable'));
  return { rev, lab, mat, hours, billed: claimed, value: priced || claimed, hPriced: fnum(fpick(qs, 'quotedHours', 'pricedHours', 'hours')), pLab: fnum(fpick(qs, 'labour', 'labourPriced')) };
}

// ── the quote's line items, wherever Fergus nests them ──
function collectLines(node, out, section, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) { node.forEach(x => collectLines(x, out, section, depth + 1)); return; }
  if (typeof node.itemName === 'string' && (node.itemQuantity != null || node.itemPrice != null)) {
    out.push({ section, name: node.itemName, qty: num(node.itemQuantity), price: num(node.itemPrice), cost: num(node.itemCost), labour: node.isLabour === true });
    return;
  }
  const sec = (typeof node.name === 'string' && (node.lineItems || node.items || node.quoteLineItems)) ? node.name : section;
  Object.keys(node).forEach(k => { const v = node[k]; if (v && typeof v === 'object') collectLines(v, out, sec, depth + 1); });
}
// What the quote RoofMap pushed says about the roof.
function parseQuote(lines) {
  const q = { roofmap: false, leadHrs: 0, appHrs: 0, otherHrs: 0, gutterHrs: 0, pricedHrs: 0, sheetsQty: 0, sheetsUnit: '', screws: 0,
    area: 0, ridgeHip: 0, valley: 0, barge: 0, apron: 0, cp: 0, pens: 0, gutterLm: 0, scaffPrice: 0, scaffCost: 0, scaffType: '', labourPrice: 0, matPrice: 0 };
  const find = re => lines.filter(l => re.test(l.name));
  const sum = (re, f) => find(re).reduce((s, l) => s + (f ? f(l) : l.qty), 0);
  if (find(/^Roofing sheets/).length || (find(/^Lead Roofer$/).length && find(/^Apprentice$/).length)) q.roofmap = true;
  lines.forEach(l => {
    const gut = /^Gutter — /.test(l.name) || /^Gutter Labour$/i.test(l.section || '');
    if (l.labour || /labour/i.test(l.section || '')) {
      q.labourPrice += l.qty * l.price;
      if (/^Lead Roofer$/.test(l.name)) q.leadHrs += l.qty;
      else if (/^Apprentice$/.test(l.name)) q.appHrs += l.qty;
      else if (gut) q.gutterHrs += l.qty;
      else if (l.qty > 0 && l.qty < 400 && l.price > 20) q.otherHrs += l.qty;   // a named labourer, or a roof's "— roof labour" lump (qty 1, skipped by the price test? no: a lump is qty 1 at a big price) — see below
    } else q.matPrice += l.qty * l.price;
  });
  // A lump labour line ("Garage — roof labour", qty 1 at $3,000) is money, not hours: drop any
  // "hours" the loop above read off a qty-1 line priced over $400.
  q.otherHrs = find(/./).filter(l => (l.labour || /labour/i.test(l.section || '')) && !/^Lead Roofer$|^Apprentice$|^Gutter — /.test(l.name) && !(l.qty === 1 && l.price > 400)).reduce((s, l) => s + l.qty, 0);
  q.pricedHrs = q.leadHrs + q.appHrs + q.otherHrs + q.gutterHrs;
  if (!q.roofmap) {
    const isLab = l => l.labour || /labour|\bLL\b|\bLA\b|lead roofer|apprentice/i.test(l.name) || /labour/i.test(l.section || '');
    const hrsOf = l => (l.qty > 0 && l.qty <= 400 && !(l.qty === 1 && l.price > 400)) ? l.qty : 0;
    q.leadHrs = 0; q.appHrs = 0; q.otherHrs = 0; q.gutterHrs = 0;
    lines.forEach(l => { if (!isLab(l)) return; const h = hrsOf(l); if (/lead|\bLL\b/i.test(l.name)) q.leadHrs += h; else if (/apprentice|\bLA\b/i.test(l.name)) q.appHrs += h; else q.otherHrs += h; });
    q.pricedHrs = q.leadHrs + q.appHrs + q.otherHrs;
    // The office's template prices several lines "per m² of job" (sheets, underlay, screws), each carrying
    // the SAME area — so the area is the largest of them, never their sum (the first pass summed them and
    // read 420 m² for a 140 m² roof). The sheet line is preferred when there is one.
    const m2 = lines.filter(l => !isLab(l) && /\/\s*m2|\/\s*m\b|\bm2\b|sq\.?m|m²|sheets only/i.test(l.name) && l.qty >= 15 && l.qty <= 3000);
    if (m2.length) {
      const sheetL = m2.filter(l => /maxam|zinc|sheets only|corrugate|trimdek|rib|iron|multidek|colorsteel/i.test(l.name) && !/screw|underlay|\bru\d|insul|purlin|clip/i.test(l.name));
      q.area = Math.max.apply(null, (sheetL.length ? sheetL : m2).map(l => l.qty)); q.sheetsUnit = 'fergus-m2'; q.template = 'fergus';
    }
    // "FLA Colorsteel flashings (barges, ridges, …)" / "FLA Zinc flashing/gutter/ridge line" is the one
    // flashing figure; "FLA … extras" is a count, not metres. Dektites are the penetrations; a gutter
    // line in metres gives the eave, so the sheet columns.
    q.flaLm = lines.filter(l => !isLab(l) && !m2.includes(l) && /\bFLA\b|flashing|ridge|barge|apron|valley/i.test(l.name) && !/extra|dektite|clearlite|laserlite/i.test(l.name) && l.qty >= 3 && l.qty <= 1000).reduce((s, l) => s + l.qty, 0);
    q.pens = lines.filter(l => /dektite|penetration|pipe flash/i.test(l.name) && l.qty > 0 && l.qty <= 40).reduce((s, l) => s + l.qty, 0);
    const gl = lines.filter(l => !isLab(l) && /typhoon|gutter|spouting|box maxam|magnum|\$\/lm|\/lm/i.test(l.name) && !/downpipe|bracket|labour|price|clearlite|laserlite|leaf/i.test(l.name) && l.qty >= 5 && l.qty <= 400);
    if (gl.length) q.gutterLm = Math.max.apply(null, gl.map(l => l.qty));
    q.cutsEst = 0.5 * q.flaLm;   // ridge / hip / valley are inside the one flashing figure; half of it is assumed
    const sc2 = lines.filter(l => /scaffold/i.test(l.name));
    sc2.forEach(l => { q.scaffPrice += l.qty * l.price; q.scaffCost += l.qty * l.cost; });
    if (sc2.length) q.scaffType = /platform/i.test(sc2.map(l => l.name).join(' ')) ? 'platform' : 'edge';
    return q;
  }
  const sh = find(/^Roofing sheets/);
  q.sheetsQty = sh.reduce((s, l) => s + l.qty, 0);
  q.screws = sum(/Unitites|screws/i);
  const areaFromScrews = q.screws > 0 ? q.screws / SCREWS_PER_M2 : 0;
  if (q.sheetsQty > 0) {
    // the sheets row is m² or lm depending on how the office prices sheet — the screw count says which
    if (areaFromScrews > 0) q.sheetsUnit = Math.abs(q.sheetsQty - areaFromScrews) <= Math.abs(q.sheetsQty * SHEET_W - areaFromScrews) ? 'm2' : 'lm';
    else q.sheetsUnit = 'm2';
    q.area = q.sheetsUnit === 'm2' ? q.sheetsQty : q.sheetsQty * SHEET_W;
  } else if (areaFromScrews > 0) { q.area = areaFromScrews; q.sheetsUnit = 'screws'; }
  q.ridgeHip = sum(/^Ridge \/ Hip cap/) / WASTE;
  q.valley = sum(/^Valley iron/) / WASTE;
  q.barge = sum(/^Barge flashing/) / WASTE;
  q.apron = sum(/^Apron flashing/) / WASTE;
  q.cp = sum(/^Change-of-pitch/) / WASTE;
  q.pens = sum(/pipe flashing/i) + find(/^Boxed penetration/i).length;
  const spout = find(/^Gutter — /).filter(l => !/bracket|outlet|dropper|joiner|angle|stop end|downpipe|custom|adjustment|union|clip/i.test(l.name) && l.qty > 2);
  if (spout.length) q.gutterLm = Math.max.apply(null, spout.map(l => l.qty));
  const sc = find(/^Scaffolding|— scaffolding$/);
  sc.forEach(l => { q.scaffPrice += l.qty * l.price; q.scaffCost += l.qty * l.cost; });
  if (sc.length) q.scaffType = /platform/i.test(sc.map(l => l.name).join(' ')) ? 'platform' : 'edge';
  return q;
}
// RoofMap's calculator over those quantities.
function calc(q) {
  const colsKnown = q.gutterLm > 0;
  const cols = colsKnown ? Math.round(q.gutterLm / SHEET_W) : (q.area > 0 ? Math.round(q.area / (SHEET_W * EST_SHEET_LEN)) : 0);
  const approx = !q.roofmap;
  const d = approx ? { roof: q.area, sheets: cols, cuts: q.cutsEst || 0, flash: q.flaLm || 0, pen: q.pens || 0 }
                   : { roof: q.area, sheets: cols, cuts: q.ridgeHip + q.valley, flash: q.barge + q.apron + q.cp + q.ridgeHip, pen: q.pens };
  const h = {}; let raw = 0;
  Object.keys(d).forEach(k => { h[k] = d[k] / RATES[k]; raw += h[k]; });
  const h2 = Math.ceil(raw);
  return { drivers: d, hours: h, raw, crewHrs: h2, manHrs: 2 * h2, colsKnown, approx };
}
const bandOf = rev => BANDS.find(([lo, hi]) => rev >= lo && rev < hi);
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pad = (s, w, r) => { s = String(s == null ? '' : s); return r ? s.padStart(w) : s.padEnd(w); };
const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
const money = v => '$' + Math.round(v).toLocaleString('en-NZ');

// Non-negative least squares (projected gradient) of man-hours on the five drivers → implied rates.
function fitRates(rows, keys) {
  keys = keys || ['roof', 'sheets', 'cuts', 'flash', 'pen'];
  // Fitted on RELATIVE error (each row divided by its own hours), so a small job counts as much as a big one.
  const X = rows.map(r => keys.map(k => r.calc.drivers[k] / r.actual)), y = rows.map(() => 1);
  const Xraw = rows.map(r => keys.map(k => r.calc.drivers[k])), yraw = rows.map(r => r.actual);
  if (X.length < 8) return null;
  const n = keys.length; let c = keys.map(k => 2 / RATES[k]);
  const scale = X[0].map((_, j) => Math.max(1e-9, Math.sqrt(X.reduce((s, x) => s + x[j] * x[j], 0) / X.length)));
  const Xs = X.map(x => x.map((v, j) => v / scale[j])); let cs = c.map((v, j) => v * scale[j]);
  const lr = 0.5 / Math.max.apply(null, Xs[0].map((_, j) => Xs.reduce((s, x) => s + x[j] * x[j], 0) / X.length));
  for (let it = 0; it < 20000; it++) {
    const g = new Array(n).fill(0);
    Xs.forEach((x, i) => { const e = x.reduce((s, v, j) => s + v * cs[j], 0) - y[i]; for (let j = 0; j < n; j++) g[j] += 2 * e * x[j] / X.length; });
    for (let j = 0; j < n; j++) cs[j] = Math.max(0, cs[j] - lr * g[j]);
  }
  c = cs.map((v, j) => v / scale[j]);
  const pred = Xraw.map(x => x.reduce((s, v, j) => s + v * c[j], 0));
  const mape = pred.reduce((s, p, i) => s + Math.abs(p - yraw[i]) / yraw[i], 0) / yraw.length;
  const ratios = pred.map((p, i) => yraw[i] / p).filter(v => isFinite(v));
  return { keys, rates: c.map(v => v > 1e-9 ? 2 / v : Infinity), mape, pred, medianRatio: median(ratios), within20: ratios.filter(v => v >= 0.8 && v <= 1.2).length / ratios.length };
}

async function main() {
  const t0 = Date.now();
  // 1. every completed job
  let jobs = await fergusPaginate('/jobs?pageSize=100&sortField=lastModified&sortOrder=desc&filterJobStatus=Completed&page=1', 80, n => process.stdout.write('\r  completed jobs read: ' + n + '   '));
  console.log('\nCompleted jobs in Fergus: ' + jobs.length);
  const nCompleted = jobs.length;
  const active = await fergusPaginate('/jobs?pageSize=100&sortField=lastModified&sortOrder=desc&filterJobStatus=Active&page=1', 20, n => process.stdout.write('\r  active jobs read: ' + n + '   ')).catch(() => []);
  active.forEach(j => { j._active = true; });
  jobs = jobs.concat(active);
  console.log('\nActive jobs in Fergus: ' + active.length + ' (kept below only when 80%+ invoiced — the hub\'s own back-costing rule)');
  const seen = new Set();
  jobs = jobs.filter(j => { const id = String(j.id != null ? j.id : j.jobId); if (!id || seen.has(id)) return false; seen.add(id); return true; });
  const describe = j => [j.jobType, j.type, j.brief, j.title, j.jobDescription, j.description, j.summary].filter(Boolean).join(' | ');
  const sheds = jobs.filter(j => /pole\s*shed|\bshed\b|kitset|barn/i.test(describe(j)));
  jobs = jobs.filter(j => !sheds.includes(j));
  if (SINCE) jobs = jobs.filter(j => { const d = new Date(j.lastModified || j.dateModified || j.createdAt || 0); return !isNaN(d) && d >= SINCE; });
  if (MAX_JOBS) jobs = jobs.slice(0, MAX_JOBS);
  if (jobs[0]) console.log('Job fields: ' + Object.keys(jobs[0]).join(', ') + (jobs[0].siteAddress && typeof jobs[0].siteAddress === 'object' ? ' · siteAddress: ' + Object.keys(jobs[0].siteAddress).join(', ') : ''));
  console.log('Pole sheds left out: ' + sheds.length + (SINCE ? ' · since ' + SINCE.toISOString().slice(0, 10) : '') + ' · checking ' + jobs.length + ' jobs');

  // 2. every quote, once (not per job) — accepted beats the rest, then the highest version
  const quotes = await fergusPaginate('/jobs/quotes?pageSize=100&sortField=createdAt&sortOrder=desc', 80, n => process.stdout.write('\r  quotes read: ' + n + '   ')).catch(e => { console.log('\n  quote list failed (' + e.message + ') — falling back to per-job lists'); return null; });
  const quoteByJob = {};
  if (quotes) {
    console.log('\nQuotes in Fergus: ' + quotes.length + (quotes[0] ? ' · list fields: ' + Object.keys(quotes[0]).slice(0, 30).join(', ') : ''));
    quotes.forEach(q => {
      if (q.isDraft || q.voidedAt) return;
      const cur = quoteByJob[q.jobId]; let better;
      if (!cur) better = true; else if (!!q.isAccepted !== !!cur.isAccepted) better = !!q.isAccepted; else better = (q.versionNumber || 0) > (cur.versionNumber || 0);
      if (better) quoteByJob[q.jobId] = q;
    });
  }

  // 3. probe for a supplier-invoice endpoint once, on the first job
  const probeJob = jobs[0] && (jobs[0].id != null ? jobs[0].id : jobs[0].jobId);
  let supplierPath = null;
  if (probeJob != null) {
    const cands = ['/jobs/{id}/supplierInvoices', '/jobs/{id}/supplier-invoices', '/supplierInvoices?jobId={id}&pageSize=50', '/supplier-invoices?jobId={id}', '/jobs/{id}/purchaseOrders', '/purchaseOrders?jobId={id}&pageSize=50', '/jobs/{id}/bills', '/jobs/{id}/costs', '/jobs/{id}/materials', '/jobs/{id}/expenses'];
    console.log('\nSupplier-invoice endpoint probe (job ' + probeJob + '):');
    for (const c of cands) {
      const p = c.replace('{id}', encodeURIComponent(probeJob));
      const r = await viaProxy('fergus', p, { probe: true });
      let keys = ''; try { const j = JSON.parse(r.body); keys = Array.isArray(j) ? '[array ' + j.length + ']' : Object.keys(j).slice(0, 8).join(','); } catch (e) { keys = r.body.slice(0, 60).replace(/\s+/g, ' '); }
      console.log('  ' + pad(r.status, 4, true) + '  ' + pad(c, 46) + ' ' + keys);
      if (r.status === 200 && !supplierPath) { try { const j = JSON.parse(r.body); if (Array.isArray(arr(j))) supplierPath = c; } catch (e) {} }
    }
    console.log('  → ' + (supplierPath ? 'using ' + supplierPath : 'none answered; scaffold check falls back to Xero supplier bills'));
  }

  // 4. per job: financial summary, the quote's lines, supplier invoices
  let done = 0;
  let rows = await pool(jobs, CONC, async job => {
    const id = job.id != null ? job.id : job.jobId;
    const jobNo = String(job.jobNo || job.jobNumber || '');
    const sa = job.siteAddress || {};
    const site = fergusAddr(job.siteAddress);
    const streetM = /^\s*(?:\d+[a-z]?[\s,]+)?([a-z][a-z']{4,})/i.exec(site || '');
    const row = { id, jobNo, site, street: streetM ? streetM[1].toLowerCase() : '', suburb: sa.addressSuburb || sa.suburb || sa.addressCity || sa.city || (site.split(',')[0] || ''), type: job.jobType || job.type || '',
      title: job.brief || job.title || '', date: String(job.completedAt || job.completedDate || job.dateCompleted || job.endDate || job.finishDate || job.lastModified || '').slice(0, 10), hasDone: !!(job.completedAt || job.completedDate || job.dateCompleted || job.endDate || job.finishDate), fs: null, q: null, lines: [], supplierScaff: [], err: '' };
    row.active = !!job._active;
    try { row.fs = fsFig(await fergus('/jobs/' + encodeURIComponent(id) + '/financialSummary').then(j => j.data || j)); } catch (e) { row.err += 'summary: ' + e.message.slice(0, 80) + '; '; }
    if (row.active) { const f = row.fs; if (!(f && f.value > 0 && f.billed >= 0.8 * f.value)) { row.skip = true; done++; return row; } }
    try {
      let pick = quotes ? quoteByJob[id] : null;
      if (!pick && !quotes) {
        const list = arr(await fergus('/jobs/' + encodeURIComponent(id) + '/quotes'));
        list.forEach(q => { if (q.isDraft || q.voidedAt) return; if (!pick || (!!q.isAccepted && !pick.isAccepted) || ((q.versionNumber || 0) > (pick.versionNumber || 0) && !!q.isAccepted === !!pick.isAccepted)) pick = q; });
      }
      const readLines = async q => { let lines = []; collectLines(q, lines, '', 0); if (!lines.length) { const det = await fergus('/jobs/quotes/' + encodeURIComponent(q.id)); collectLines(det.data || det, lines, '', 0); } return lines; };
      if (pick) {
        let lines = await readLines(pick);
        row.lines = lines; row.q = parseQuote(lines); row.quoteAccepted = !!pick.isAccepted; row.quoteTotal = num(pick.totals && pick.totals.total);
        row.pickedHrs = row.q.pricedHrs;
        // The quote that WON may be one the office wrote in Fergus; RoofMap's own push (with the m² and
        // the flashings) can be an earlier or later version on the same job. Look at up to four others.
        if (!row.q.roofmap && quotes) {
          const others = quotes.filter(q => String(q.jobId) === String(id) && q !== pick).sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0)).slice(0, 6);
          for (const o of others) {
            const l2 = await readLines(o); const q2 = parseQuote(l2);
            if (q2.roofmap) { row.q = q2; row.lines = l2; row.quoteFromOtherVersion = true; break; }
          }
        }
      }
    } catch (e) { row.err += 'quote: ' + e.message.slice(0, 80) + '; '; }
    if (supplierPath) {
      try {
        const items = arr(await fergus(supplierPath.replace('{id}', encodeURIComponent(id))));
        items.forEach(it => { const txt = JSON.stringify(it); if (SCAFF_RE.test(txt)) row.supplierScaff.push({ supplier: fergusName(it.supplier || it.contact || it.supplierName) || (it.supplierName || it.supplier || '?'), amt: fnum(fpick(it, 'total', 'amount', 'totalAmount', 'subtotal', 'cost')), src: 'fergus' }); });
      } catch (e) { row.err += 'supplier: ' + e.message.slice(0, 60) + '; '; }
    }
    done++; if (done % 10 === 0 || done === jobs.length) process.stdout.write('\r  jobs read: ' + done + '/' + jobs.length + ' (' + calls + ' calls)   ');
    return row;
  });
  console.log('');
  const nActiveKept = rows.filter(r => r.active && !r.skip).length;
  rows = rows.filter(r => !r.skip);

  // 5. Xero supplier bills from scaffold companies, matched to a job number in the reference or a line
  const byNo = {}; rows.forEach(r => { if (r.jobNo) byNo[r.jobNo.replace(/\D/g, '')] = r; });
  let xeroBills = 0, xeroScaff = 0, xeroMatched = 0, xeroUnmatched = [];
  if (XERO_PAGES > 0) {
    const oldest = rows.reduce((m, r) => (r.date && (!m || r.date < m)) ? r.date : m, '');
    const cut = (oldest && rows.every(r => r.hasDone)) ? new Date(new Date(oldest).getTime() - 90 * 86400000) : null;
    for (let page = 1; page <= XERO_PAGES; page++) {
      let inv;
      try { inv = arr(await xero('/Invoices?where=Type=="ACCPAY"&order=Date DESC&page=' + page)); }
      catch (e) { console.log('  Xero bills page ' + page + ' failed: ' + e.message.slice(0, 120)); break; }
      let stop = false;
      inv.forEach(v => {
        const d = new Date(v.DateString || v.Date); if (!isNaN(d) && cut && d < cut) { stop = true; return; }
        xeroBills++;
        const sup = (v.Contact && v.Contact.Name) || '';
        const lines = v.LineItems || [];
        const txt = sup + ' ' + lines.map(l => l.Description || '').join(' ');
        if (!SCAFF_RE.test(txt)) return;
        xeroScaff++;
        const amt = num(v.SubTotal) || num(v.Total);
        const hay = String(v.Reference || '') + ' ' + lines.map(l => l.Description || '').join(' ');
        // a job number in the reference or a line: 4–5 digits that ARE a job (a bare year — 2024…2027 — only
        // counts when written as "job 2026" / "#2026", since a date in the text would otherwise match a job)
        const nos = new Set();
        const re = /(job\s*#?|#)?\s*\b(\d{4,5})[a-z]?\b/gi; let mm;
        while ((mm = re.exec(hay))) { const n = mm[2]; if (!byNo[n]) continue; if (/^20(2[4-9]|3\d)$/.test(n) && !mm[1]) continue; nos.add(n); }
        if (!nos.size) {   // try the site: "12 Kamo" (number + street), else the street's name alone when only
          // one job on that street finished within five months of the bill ("Mountain Road", "Hillcrest")
          const words = ' ' + hay.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
          rows.forEach(r => { const m2 = /^\s*(\d+[a-z]?)[\s,]+([a-z]+)/i.exec(r.site || ''); if (m2 && words.includes(' ' + m2[1].toLowerCase() + ' ' + m2[2].toLowerCase() + ' ')) nos.add(r.jobNo.replace(/\D/g, '')); });
          if (!nos.size) {
            const bd = d.getTime();
            const cands = rows.filter(r => r.street && words.includes(' ' + r.street + ' ') && Math.abs(new Date(r.date).getTime() - bd) < 150 * 86400000);
            if (cands.length === 1) nos.add(cands[0].jobNo.replace(/\D/g, ''));
          }
        }
        if (!nos.size) { xeroUnmatched.push({ sup, date: (v.DateString || v.Date || '').slice(0, 10), amt, ref: v.Reference || '' }); return; }
        xeroMatched++;
        // One bill naming several jobs (a site split into jobs) is shared between them by revenue, never counted whole on each.
        const named = [...nos].map(n => byNo[n]); const revSum = named.reduce((t, r) => t + ((r.fs && r.fs.rev) || 0), 0);
        named.forEach(r => { const share = revSum > 0 ? ((r.fs && r.fs.rev) || 0) / revSum : 1 / named.length; r.supplierScaff.push({ supplier: sup + (named.length > 1 ? ' (1/' + named.length + ' share)' : ''), amt: amt * share, date: (v.DateString || v.Date || '').slice(0, 10), src: 'xero' }); });
      });
      process.stdout.write('\r  Xero bills read: ' + xeroBills + ' (scaffold: ' + xeroScaff + ')   ');
      if (stop || inv.length < 100) break;
    }
    console.log('');
  }

  // 6. the table
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  rows.forEach(r => {
    r.rev = r.fs ? r.fs.rev : 0; r.actual = r.fs ? r.fs.hours : 0;
    r.calc = r.q && r.q.area > 0 ? calc(r.q) : null;
    r.priced = r.pickedHrs > 0 ? r.pickedHrs : (r.q && r.q.pricedHrs > 0 ? r.q.pricedHrs : (r.fs ? r.fs.hPriced : 0));
    r.manual = r.q && r.calc && r.q.roofmap ? Math.abs(r.q.leadHrs - r.calc.crewHrs) > 0.51 : null;
    r.scaffInv = r.supplierScaff.reduce((s, x) => s + x.amt, 0);
  });
  const cols = [['Job', 6], ['Done', 10], ['Suburb', 14], ['Revenue', 9], ['m²', 6], ['Cols', 5], ['Cuts', 6], ['Flash', 6], ['Pen', 4], ['Calc h', 8], ['Priced h', 8], ['Actual h', 8], ['Act/Calc', 8], ['Act/Prcd', 8], ['Scaffold priced', 16], ['Scaffold bought in', 30]];
  console.log('\nPER JOB (hours are crew MAN-hours: the calculator\'s 2 × ceil(sum); Priced = the hours on the Fergus quote; Actual = hours logged in Fergus)');
  console.log(cols.map(([h, w], i) => pad(h, w, i >= 3 && i <= 13)).join(' '));
  console.log(cols.map(([h, w]) => '-'.repeat(w)).join(' '));
  rows.forEach(r => {
    const c = r.calc, q = r.q;
    const line = [r.jobNo, r.date, (r.suburb || '').slice(0, 14), money(r.rev),
      c ? r1(q.area) : (q && q.roofmap ? '?' : '—'), c ? (c.drivers.sheets + (c.colsKnown ? '' : '~')) : '', c ? r1(c.drivers.cuts) + (c.approx ? '*' : '') : '', c ? r1(c.drivers.flash) + (c.approx ? '*' : '') : '', c ? c.drivers.pen : '',
      c ? (c.manHrs + (c.approx ? '≈' : '')) : '—', r.priced ? r1(r.priced) : '—', r.actual ? r1(r.actual) : '—',
      c && r.actual ? (r.actual / c.manHrs).toFixed(2) : '', r.priced && r.actual ? (r.actual / r.priced).toFixed(2) : '',
      q && q.scaffPrice ? money(q.scaffPrice) + ' ' + q.scaffType + (q.scaffCost ? ' (cost ' + money(q.scaffCost) + ')' : '') : (q ? 'none on quote' : ''),
      r.supplierScaff.length ? r.supplierScaff.map(s => money(s.amt) + ' ' + s.supplier.slice(0, 18)).join('; ') : (q && q.scaffPrice ? 'no scaffold bill found' : '')];
    console.log(line.map((v, i) => pad(v, cols[i][1], i >= 3 && i <= 13)).join(' ') + (r.err ? '  ⚠ ' + r.err : '') + (r.manual ? '  (hours typed over)' : '') + (r.quoteFromOtherVersion ? '  (quantities from another quote version)' : ''));
  });

  // what a quote that is NOT RoofMap's looks like (the first five with lines), so a renamed line is caught
  rows.filter(r => r.lines.length && !(r.q && r.q.roofmap)).slice(0, 5).forEach(r => console.log('  non-RoofMap quote lines, job ' + r.jobNo + ': ' + r.lines.slice(0, 10).map(l => (l.section ? '[' + l.section + '] ' : '') + l.name.slice(0, 40) + ' ×' + l.qty).join(' | ')));
  // 7. aggregates
  const usableAll = rows.filter(r => r.calc && r.actual > 0 && r.rev > 0);
  const usable = usableAll.filter(r => !r.calc.approx), usableApprox = usableAll.filter(r => r.calc.approx);
  const withPriced = rows.filter(r => r.priced > 0 && r.actual > 0 && r.rev > 0);
  console.log('\nCOVERAGE: ' + rows.length + ' back-costed non-shed jobs (' + (rows.length - nActiveKept) + ' completed + ' + nActiveKept + ' active and 80%+ invoiced) · ' + rows.filter(r => r.q && r.q.roofmap).length + ' with RoofMap\'s itemised quote · ' + usable.length + ' of those with logged hours (the EXACT calculator test) · ' + usableApprox.length + ' more with m² on an office-written Fergus quote (APPROXIMATE: roof m² + one flashing figure, no cuts / penetrations) · ' + withPriced.length + ' with priced AND logged hours · ' + rows.filter(r => r.err).length + ' with a read error');
  function agg(title, set, pick) {
    console.log('\n' + title); console.log('='.repeat(title.length));
    const c2 = [['Revenue band', 13], ['Jobs', 5], ['Σ est h', 9], ['Σ actual h', 10], ['Act/Est', 8], ['Median', 7], ['±20%', 6], ['Under-est', 9], ['Act h/m²', 9], ['Act h/$1k', 9]];
    console.log(c2.map(([h, w], i) => pad(h, w, i > 0)).join('  ')); console.log(c2.map(([h, w]) => '-'.repeat(w)).join('  '));
    BANDS.map(b => [b[2], set.filter(r => bandOf(r.rev) === b)]).concat([['ALL', set]]).forEach(([label, js]) => {
      if (!js.length) { console.log(pad(label, 13) + '  ' + pad(0, 5, true)); return; }
      const est = js.reduce((s, r) => s + pick(r), 0), act = js.reduce((s, r) => s + r.actual, 0), rat = js.map(r => r.actual / pick(r));
      const withArea = js.filter(r => r.q && r.q.area > 0);
      const area = withArea.reduce((s, r) => s + r.q.area, 0), actA = withArea.reduce((s, r) => s + r.actual, 0), rev = js.reduce((s, r) => s + r.rev, 0);
      console.log([label, js.length, est.toFixed(0), act.toFixed(0), (act / est).toFixed(2), median(rat).toFixed(2), Math.round(100 * rat.filter(x => x >= 0.8 && x <= 1.2).length / js.length) + '%', Math.round(100 * rat.filter(x => x > 1.2).length / js.length) + '%', area > 0 ? (actA / area).toFixed(2) : '—', (act / (rev / 1000)).toFixed(1)].map((v, i) => pad(v, c2[i][1], i > 0)).join('  '));
    });
  }
  agg('CALCULATOR vs ACTUAL — EXACT (RoofMap\'s own quantities)', usable, r => r.calc.manHrs);
  agg('CALCULATOR vs ACTUAL — APPROXIMATE (m² + flashing lm off an office-written Fergus quote; cuts and penetrations unknown, so the estimate reads LOW)', usableApprox, r => r.calc.manHrs);
  agg('PRICED vs ACTUAL (every job with hours on the quote)', withPriced, r => r.priced);
  console.log('\nAct/Est > 1 = the crew took LONGER than the estimate. "Under-est" = share of jobs where actual ran more than 20% over.');
  const showFit = (title, set, keys) => {
    const fit = fitRates(set, keys);
    if (!fit) { if (set.length) console.log('\n' + title + ': only ' + set.length + ' jobs — too few to fit rates (needs 8+). Median Act/Calc = ' + median(set.map(r => r.actual / r.calc.manHrs)).toFixed(2)); return; }
    console.log('\n' + title + ' (least-squares fit of logged man-hours, ' + set.length + ' jobs):');
    console.log('  driver        RoofMap now   fitted      (units per crew-hour, 2-man crew; higher = faster)');
    fit.keys.forEach((k, i) => console.log('  ' + pad(k, 12) + '  ' + pad(RATES[k], 11, true) + '   ' + pad(isFinite(fit.rates[i]) ? fit.rates[i].toFixed(1) : '∞ (no time)', 10, true)));
    const mapeNow = set.reduce((s, r) => s + Math.abs(r.calc.manHrs - r.actual) / r.actual, 0) / set.length;
    const r20 = set.filter(r => { const v = r.actual / r.calc.manHrs; return v >= 0.8 && v <= 1.2; }).length / set.length;
    console.log('  mean error per job: RoofMap now ' + Math.round(mapeNow * 100) + '% · fitted ' + Math.round(fit.mape * 100) + '%  ·  within ±20%: now ' + Math.round(r20 * 100) + '% · fitted ' + Math.round(fit.within20 * 100) + '%  ·  median Act/Est fitted ' + fit.medianRatio.toFixed(2));
    console.log('  Simplest fix: scale factor (median Act/Calc) = ' + median(set.map(r => r.actual / r.calc.manHrs)).toFixed(2) + ' → divide every rate by it.');
  };
  showFit('WHAT THE RATES WOULD NEED TO BE — exact jobs', usable);
  showFit('WHAT THE RATES WOULD NEED TO BE — approximate jobs (roof m², columns, the one flashing figure, dektites; cuts assumed half the flashing so left out)', usableApprox, ['roof', 'sheets', 'flash', 'pen']);
  // and the plainest model of all: man-hours per m², by band
  console.log('\nMAN-HOURS PER m² ACTUALLY LOGGED (every job with an area, exact or approximate):');
  BANDS.map(b => [b[2], usableAll.filter(r => bandOf(r.rev) === b)]).concat([['ALL', usableAll]]).forEach(([label, js]) => { if (!js.length) return; const v = js.map(r => r.actual / r.q.area); console.log('  ' + pad(label, 12) + pad(js.length, 5, true) + ' jobs · median ' + median(v).toFixed(2) + ' h/m² · quartiles ' + median(v.filter(x => x <= median(v))).toFixed(2) + ' – ' + median(v.filter(x => x >= median(v))).toFixed(2) + ' · RoofMap\'s roof driver alone is ' + (2 / RATES.roof).toFixed(2) + ' h/m² before cuts, flashings and penetrations'); });
  // every line name the office writes on its own Fergus quotes, so the next run can read more of them
  const vocab = {};
  rows.filter(r => r.lines.length && !(r.q && r.q.roofmap)).forEach(r => r.lines.forEach(l => { const k = l.name.toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 48); const v = vocab[k] || (vocab[k] = { n: 0, q: 0, lab: 0 }); v.n++; v.q += l.qty; if (l.labour) v.lab++; }));
  const vk = Object.keys(vocab).sort((a, b) => vocab[b].n - vocab[a].n).slice(0, 70);
  console.log('\nLINE NAMES ON OFFICE-WRITTEN FERGUS QUOTES (top ' + vk.length + ', count × name, avg qty, L = labour flag):');
  vk.forEach(k => console.log('  ' + pad(vocab[k].n, 4, true) + ' × ' + pad(k, 50) + ' avg qty ' + (vocab[k].q / vocab[k].n).toFixed(1) + (vocab[k].lab ? '  L' : '')));
  // 8. scaffold
  const sp = rows.filter(r => r.q && r.q.scaffPrice > 0);
  const bought = sp.filter(r => r.scaffInv > 0), own = sp.filter(r => !r.scaffInv);
  console.log('\nSCAFFOLD: ' + sp.length + ' RoofMap-quoted jobs priced scaffolding · ' + bought.length + ' have a scaffold supplier invoice (bought in; ' + money(bought.reduce((s, r) => s + r.scaffInv, 0)) + ' invoiced vs ' + money(bought.reduce((s, r) => s + r.q.scaffPrice, 0)) + ' charged) · ' + own.length + ' have none (own crew, or the bill is not on the job) · ' + rows.filter(r => !(r.q && r.q.scaffPrice) && r.scaffInv > 0).length + ' jobs have a scaffold invoice with no scaffold priced');
  if (bought.length) { const ratios = bought.map(r => r.scaffInv / r.q.scaffPrice); console.log('  bought-in scaffold cost as a share of what was charged: median ' + Math.round(median(ratios) * 100) + '% · ' + bought.filter(r => r.scaffInv > r.q.scaffPrice).length + ' jobs paid more for the scaffold than they charged'); }
  if (XERO_PAGES > 0) console.log('  Xero: ' + xeroBills + ' supplier bills read, ' + xeroScaff + ' from scaffold suppliers, ' + xeroMatched + ' matched to a job' + (xeroUnmatched.length ? ' · ' + xeroUnmatched.length + ' scaffold bills with no job number in the reference (' + money(xeroUnmatched.reduce((s, b) => s + b.amt, 0)) + '): ' + xeroUnmatched.slice(0, 12).map(b => b.date + ' ' + b.sup.slice(0, 16) + ' ' + money(b.amt) + (b.ref ? ' "' + b.ref.slice(0, 20) + '"' : '')).join(' · ') : ''));

  // 9. CSV
  const H = ['jobNo', 'date', 'type', 'title', 'site', 'revenue', 'quotedThroughRoofMap', 'quoteAccepted', 'sheetsUnit', 'area_m2', 'columns', 'columnsEstimated', 'ridgeHip_lm', 'valley_lm', 'barge_lm', 'apron_lm', 'changePitch_lm', 'gutter_lm', 'penetrations', 'calc_h_roof', 'calc_h_sheets', 'calc_h_cuts', 'calc_h_flash', 'calc_h_pen', 'calc_crew_h', 'calc_man_h', 'calc_approximate', 'fergus_flashing_lm', 'priced_lead_h', 'priced_app_h', 'priced_other_h', 'priced_gutter_h', 'priced_man_h', 'hoursTypedOver', 'actual_man_h', 'actual_over_calc', 'actual_over_priced', 'labour_cost', 'material_cost', 'scaffold_type', 'scaffold_price', 'scaffold_cost_priced', 'scaffold_invoiced', 'scaffold_suppliers', 'errors'];
  const csv = [H.join(',')].concat(rows.map(r => { const q = r.q || {}, c = r.calc; return [r.jobNo, r.date, r.type, r.title, r.site, r.rev.toFixed(2), q.roofmap ? 1 : 0, r.quoteAccepted ? 1 : 0, q.sheetsUnit || '', c ? q.area.toFixed(1) : '', c ? c.drivers.sheets : '', c ? (c.colsKnown ? 0 : 1) : '', q.ridgeHip != null ? q.ridgeHip.toFixed(1) : '', q.valley != null ? q.valley.toFixed(1) : '', q.barge != null ? q.barge.toFixed(1) : '', q.apron != null ? q.apron.toFixed(1) : '', q.cp != null ? q.cp.toFixed(1) : '', q.gutterLm || '', q.pens || '', c ? c.hours.roof.toFixed(2) : '', c ? c.hours.sheets.toFixed(2) : '', c ? c.hours.cuts.toFixed(2) : '', c ? c.hours.flash.toFixed(2) : '', c ? c.hours.pen.toFixed(2) : '', c ? c.crewHrs : '', c ? c.manHrs : '', c ? (c.approx ? 1 : 0) : '', q.flaLm || '', q.leadHrs || '', q.appHrs || '', q.otherHrs || '', q.gutterHrs || '', r.priced || '', r.manual == null ? '' : (r.manual ? 1 : 0), r.actual || '', c && r.actual ? (r.actual / c.manHrs).toFixed(3) : '', r.priced && r.actual ? (r.actual / r.priced).toFixed(3) : '', r.fs ? r.fs.lab.toFixed(2) : '', r.fs ? r.fs.mat.toFixed(2) : '', q.scaffType || '', q.scaffPrice || '', q.scaffCost || '', r.scaffInv || '', r.supplierScaff.map(s => s.supplier + ' ' + Math.round(s.amt)).join(' | '), r.err].map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }));
  fs.writeFileSync('labour-check.csv', csv.join('\n'));
  console.log('\nWrote labour-check.csv (' + rows.length + ' rows) · ' + calls + ' proxy calls · ' + Math.round((Date.now() - t0) / 1000) + 's');
}
main().catch(e => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
