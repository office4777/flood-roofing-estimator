// A quote priced on Armorsteel ColorZen was shown to the customer as
// "Colorsteel® MAXAM — STANDARD · INCLUDED", at the ColorZen price. She
// accepted, and her signed PDF promised a grade the price did not cover.
// The same job then pushed to Fergus at $18,118.05 against the $17,002.04
// she had accepted.
//
// Two causes, one theme — the grade the quote was PRICED at was being
// replaced by a fixed 'maxam' on the way out:
//   1. the customer view deleted proposalOptions.steelGrade and pinned
//      baseGrade to 'maxam', so the standard row moved;
//   2. the Fergus builder itemised MAXAM prices and expected the grade
//      difference to arrive as a "selection change" — but a selection change
//      is measured against the base grade, which on that job WAS ColorZen,
//      so the delta was zero and the discount vanished. It also sent raw
//      quantities where the quote prices order quantities.
//
// The last check is the backstop: whatever else drifts, the lines pushed to
// Fergus must add up to the quote the customer accepted.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

// ── 1. the customer's page anchors to the grade the quote was priced at ──
const sent = (grade) => ({
  ref:'FR-3206', client:'Sharon Thomson', accepted:false,
  extraRoofs:[], proposalOptions:{ extraRoofsSel:{}, steelGrade:grade, profile:'corrugate' },
  baseGrade: grade,
  roofMapGeom:{ bbox:{minX:0,minY:0,maxX:100,maxY:80}, roofs:[
    { name:'Main Roof', area:100, mode:'main', idx:0, lines:[], gutters:[], pts:[[0,0],[100,0],[100,80],[0,80]] },
  ]},
  options:[{id:'a',selected:true}],
  lineItems:[{desc:'Roof replacement', qty:1, price:14784.38}], total:17002.04,
});
async function openCustomer(grade){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    if (/\/q\/[^/]+\/event/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    if (/\/q\//.test(u)) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ quote: sent(grade), branding:{} })});
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.goto('file://'+DIR+'/app.html?q=tok&j=FR-3206');
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs };
}

let c = await openCustomer('colorzen');
let v = await c.pg.evaluate(() => ({ base: S.quote.baseGrade,
  sel: S.quote.proposalOptions && S.quote.proposalOptions.steelGrade }));
check('a ColorZen-priced quote opens the customer on ColorZen, not MAXAM',
  v.base === 'colorzen', JSON.stringify(v));
check('…and nothing reads as a chosen upgrade away from it',
  v.sel === 'colorzen', JSON.stringify(v));
// The rendered document is what she signs, so assert the page itself: the
// row carrying "standard" must be the grade the quote was priced on.
let card = await c.pg.evaluate(() => {
  const txt = (document.getElementById('customerView') || document.body).innerText || '';
  const line = txt.split('\n').map(s => s.trim());
  const iZen = line.findIndex(s => /Armorsteel ColorZen/i.test(s));
  const iMax = line.findIndex(s => /Colorsteel.{0,3} MAXAM/i.test(s));
  const near = (i) => i < 0 ? '' : line.slice(i, i + 3).join(' ');
  return { zen: near(iZen), max: near(iMax) };
});
check('the Selections page marks ColorZen as the standard, not MAXAM',
  /STANDARD/i.test(card.zen) && !/STANDARD/i.test(card.max),
  JSON.stringify(card));
check('no page errors on the customer view', c.errs.length === 0, c.errs.join(' | '));
await c.ctx.close();

// A MAXAM-priced quote is unchanged — the old behaviour was right for the
// common case, and this must not move it.
c = await openCustomer('maxam');
v = await c.pg.evaluate(() => ({ base: S.quote.baseGrade,
  sel: S.quote.proposalOptions && S.quote.proposalOptions.steelGrade }));
check('a MAXAM-priced quote still opens on MAXAM', v.base === 'maxam', JSON.stringify(v));
await c.ctx.close();

// ── 2. the Fergus push ──
// Driven on the built-in sample job, which is a real L-shaped hip-and-valley
// with a full material take-off — the blank app has no materials at all, and
// a push with nothing in it cannot show this bug.
const TYPES = { '.html':'text/html', '.json':'application/json', '.png':'image/png',
                '.jpg':'image/jpeg', '.js':'text/javascript', '.webmanifest':'application/manifest+json' };
const srv = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const buf = await readFile(DIR + (path === '/' ? '/app.html' : path));
    res.writeHead(200, {'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream'});
    res.end(buf);
  } catch(e){ res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const ctx2 = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx2.newPage();
const errs2 = []; pg.on('pageerror', e => errs2.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/settings/.test(r.request().url())) return j({ user_id:'u1',
    branding:{ company_name:'Flood Roofing LTD' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'aron@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing LTD', role:'owner' })); });
await pg.goto(`http://127.0.0.1:${PORT}/app.html`);
await pg.waitForTimeout(3000);
await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
await pg.click('#sampleJobBanner .sj-go');
await pg.waitForTimeout(2500);

async function build(grade){
  return pg.evaluate((g) => {
    S.quote = S.quote || {};
    S.quote.gstRate = 15;
    S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { steelGrade: g });
    S.quote.baseGrade = g;
    try { calcLabour(); } catch(e){}
    const b = _buildFergusItemisedSections();
    const lines = [];
    b.sections.forEach(s => s.lineItems.forEach(li => lines.push(
      { section:s.name, name:li.itemName, qty:li.itemQuantity, price:li.itemPrice })));
    const sum = lines.reduce((a, li) => a + (li.qty || 0) * (li.price || 0), 0);
    return { lines, sum, quoteSub: quoteSubtotal(), reconciled: b.reconciled };
  }, grade);
}

let built = await build('colorzen');
check('the sample job really has materials to push',
  built.lines.filter(l => /sheet/i.test(l.name)).length > 0,
  JSON.stringify(built.lines.map(l => l.name).slice(0, 6)));
const grade = built.lines.filter(l => /Steel grade/i.test(l.name));
check('a ColorZen quote sends the steel-grade difference to Fergus',
  grade.length === 1, JSON.stringify(built.lines.map(l => l.name)));
check('…as a credit, not a charge',
  grade.length === 1 && grade[0].price < 0, JSON.stringify(grade[0] || null));
check('…naming the grade, so the roofer can read the Fergus quote',
  grade.length === 1 && /ColorZen/i.test(grade[0].name), grade.length ? grade[0].name : '');
// The backstop: whatever else drifts, what Fergus is sent must equal the
// quote. This is the check that would have caught $18,118.05 vs $17,002.04.
check('what is pushed to Fergus adds up to the quote, to the cent',
  built.quoteSub > 0 && Math.abs(built.sum - built.quoteSub) < 0.011,
  'pushed ' + built.sum.toFixed(2) + ' vs quote ' + Number(built.quoteSub).toFixed(2));

// Material quantities are the ones the quote is priced on, not raw metres.
const panelQty = await pg.evaluate(() => {
  const rows = _buildMaterialPriceRows() || [];
  const out = {};
  rows.forEach(r => {
    const ov = (MATERIAL_OVERRIDES || {})[r.key] || {};
    const vv = (ov.variant != null) ? ov.variant : r.defaultVariant;
    const picked = (r.variants || []).find(v => v.value === vv) || (r.variants || [])[0];
    const unit = picked ? picked.unit : r.autoUnit;
    const raw = (ov.qty != null && ov.qty !== '') ? parseFloat(ov.qty) : r.autoQty;
    out[r.label] = _matOrderQty(raw, unit);
  });
  return out;
});
const mism = built.lines.filter(l => panelQty[String(l.name).split(' — ')[0]] != null &&
  Math.abs(panelQty[String(l.name).split(' — ')[0]] - l.qty) > 0.001);
check('every material line carries the ordered quantity the quote prices',
  mism.length === 0, JSON.stringify(mism.slice(0, 3)));
// When the quote's material figure and the live price rows agree — an
// ordinary job priced on today's price book — the balancing line has nothing
// to do and must not appear. (The sample job deliberately ships a stored
// material total from its own price book, which is why it needs one.)
const agreed = await pg.evaluate(() => {
  S.materials = _materialsTotalFromRows(_buildMaterialPriceRows(), 0);
  // Let the quote re-derive itself from that, the way the Pricing panel does
  // — poking S.materials alone leaves the quote's own line items behind.
  try { _autoSyncLabourMaterials(); } catch(e){}
  const b = _buildFergusItemisedSections();
  const sum = b.sections.reduce((a, s) => a + s.lineItems.reduce(
    (x, li) => x + (li.itemQuantity || 0) * (li.itemPrice || 0), 0), 0);
  return { reconciled: b.reconciled, sum, quoteSub: quoteSubtotal() };
});
check('a job priced on the current price book needs no balancing line at all',
  agreed.reconciled == null, 'adjustment of ' + agreed.reconciled);
check('…and its lines still add to the quote',
  Math.abs(agreed.sum - agreed.quoteSub) < 0.011,
  'pushed ' + agreed.sum.toFixed(2) + ' vs quote ' + Number(agreed.quoteSub).toFixed(2));

// And a MAXAM job, the common case, still balances and carries no grade line.
built = await build('maxam');
check('a MAXAM quote sends no grade adjustment',
  built.lines.filter(l => /Steel grade/i.test(l.name)).length === 0,
  JSON.stringify(built.lines.map(l => l.name)));
check('…and it too adds up to the quote',
  built.quoteSub > 0 && Math.abs(built.sum - built.quoteSub) < 0.011,
  'pushed ' + built.sum.toFixed(2) + ' vs quote ' + Number(built.quoteSub).toFixed(2));
check('no page errors on the office view', errs2.length === 0, errs2.join(' | '));
await ctx2.close();
srv.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
