// The office side of invoicing: the settings that decide what happens to the
// money, the card on the Quote tab that lists what's been raised, and the
// printable tax invoice. The backend is faked at the network edge so this is
// purely about what the office sees and clicks.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.type() === 'prompt' ? d.accept(d.defaultValue() || '4600') : d.accept());

// In-memory invoice store behind the network fake, so create/send/paid flows
// round-trip like the real thing.
const invoices = [];
let invNo = 1000;
const sent = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = new URL(r.request().url());
  const m = r.request().method();
  const j = (x, code) => r.fulfill({ status: code || 200, contentType: 'application/json', body: JSON.stringify(x) });
  let mm;
  if ((mm = /^\/jobs\/([^/]+)\/invoices$/.exec(u.pathname))){
    if (m === 'GET') return j(invoices);
    if (m === 'POST'){
      const body = JSON.parse(r.request().postData() || '{}');
      const total = Number(body.total_incl), rate = Number(body.gst_rate) || 15;
      const amount = Math.round(total / (1 + rate/100) * 100) / 100;
      const row = { id: 'inv-' + (++invNo), number: 'INV-' + invNo, type: body.type, status: 'draft',
        percent: body.percent || null, amount, gst: Math.round((total - amount)*100)/100, total, gst_rate: rate,
        description: body.description || '', client_name: 'Mrs Hale', client_email: 'hale@example.com',
        site_address: '11 Morcom Lane', issued_at: '2026-08-21T00:00:00Z', due_at: '2026-08-28T00:00:00Z' };
      invoices.push(row); return j(row);
    }
  }
  if ((mm = /^\/invoices\/([^/]+)\/send$/.exec(u.pathname))){
    const row = invoices.find(x => x.id === mm[1]);
    sent.push(JSON.parse(r.request().postData() || '{}'));
    row.status = 'sent'; return j(row);
  }
  if ((mm = /^\/invoices\/([^/]+)$/.exec(u.pathname)) && m === 'PUT'){
    const row = invoices.find(x => x.id === mm[1]);
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.status) row.status = body.status;
    return j(row);
  }
  if (/\/settings/.test(u.pathname) && m === 'GET') return j({ user_id:'u1',
    branding:{ company_name:'Acme Roofing Ltd', gst_number:'111-222-333', address:'1 Test St' },
    quote_defaults:{ next_job_no:'00001',
      invoicing:{ deposit_percent: 40, auto_send_deposit: true, progress_enabled: true, due_days: 10,
                  bank_account: '02-9999-8888888-00', footer: 'Cheers.' } },
    jms_keys:{} });
  return j(/\/settings/.test(u.pathname) ? {} : []);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings'); });
await pg.goto('file://' + _j(DIR, 'index.html'));
await pg.waitForTimeout(2600);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });

// ── the Settings section round-trips ──────────────────────────────
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-invoicing'); });
await pg.waitForTimeout(600);
let v = await pg.evaluate(() => ({
  pct: document.getElementById('invDepositPct').value,
  auto: document.getElementById('invAutoSend').checked,
  prog: document.getElementById('invProgress').checked,
  due: document.getElementById('invDueDays').value,
  bank: document.getElementById('invBankAccount').value,
  visible: getComputedStyle(document.getElementById('set-invoicing')).display !== 'none',
}));
check('Settings → Invoicing shows the saved configuration',
  v.visible && v.pct === '40' && v.auto === true && v.prog === true && v.due === '10' && v.bank === '02-9999-8888888-00',
  JSON.stringify(v));
await pg.locator('#set-invoicing').screenshot({ path: S + '/invoicing_settings.png' });

v = await pg.evaluate(() => {
  document.getElementById('invDepositPct').value = '50';
  document.getElementById('invAutoSend').checked = false;
  var col = collectSettingsFromUI();
  return S.settings.quote_defaults.invoicing;
});
check('…and edits collect back into settings for saving',
  v.deposit_percent === 50 && v.auto_send_deposit === false && v.progress_enabled === true && v.bank_account === '02-9999-8888888-00',
  JSON.stringify(v));

// ── the card with no job open ─────────────────────────────────────
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({
  txt: document.getElementById('invList').textContent,
  btns: getComputedStyle(document.getElementById('invBtns')).display,
}));
check('with no saved job the card says so and offers no buttons',
  /Save the job first/.test(v.txt) && v.btns === 'none', JSON.stringify(v).slice(0,100));

// ── a saved, priced job ───────────────────────────────────────────
await pg.evaluate(() => {
  S.currentJobId = 'job-1';
  S.quote = S.quote || {};
  S.quote.gstRate = 15;
  S.quote.addr = '11 Morcom Lane';
  S.quote.accepted = { total: 23000, at: '2026-08-21T00:00:00Z' };   // the contract figure
  return _invLoad();
});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  empty: document.getElementById('invList').textContent,
  dep: document.getElementById('invBtnDeposit').textContent,
  prog: getComputedStyle(document.getElementById('invBtnProgress')).display,
}));
check('an invoice-less job explains the self-raising deposit', /deposit invoice raises itself/.test(v.empty), v.empty.slice(0,90));
check('…the deposit button carries the configured percent', /Deposit invoice \(50%\)/.test(v.dep), v.dep);
check('…and progress claims show because the setting is on', v.prog !== 'none', v.prog);

// raise the deposit: 50% of the accepted 23,000
await pg.click('#invBtnDeposit');
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ n: _INVOICES.rows.length, r: _INVOICES.rows[0], hint: document.getElementById('invCardHint').textContent,
  depBtn: getComputedStyle(document.getElementById('invBtnDeposit')).display }));
check('the deposit raises at half the ACCEPTED total', v.n === 1 && v.r.total === 11500 && v.r.type === 'deposit', JSON.stringify(v.r).slice(0,120));
check('…the card shows what is still to invoice', /11,500\.00/.test(v.hint), v.hint);
check('…and the deposit button retires — one deposit per job', v.depBtn === 'none', v.depBtn);

// progress claim via the prompt (dialog handler answers 4600)
await pg.click('#invBtnProgress');
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ n: _INVOICES.rows.length, r: _INVOICES.rows[1] }));
check('a progress claim takes the amount from the prompt', v.n === 2 && v.r.total === 4600 && v.r.type === 'progress', JSON.stringify(v.r).slice(0,100));

// final = the balance
await pg.click('#invBtnFinal');
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ n: _INVOICES.rows.length, r: _INVOICES.rows[2], hint: document.getElementById('invCardHint').textContent }));
check('the final invoice is exactly the un-invoiced balance', v.n === 3 && v.r.total === 6900, JSON.stringify((v.r||{}).total));
check('…leaving nothing still to invoice', /0\.00/.test(v.hint), v.hint);
await pg.locator('#jobInvoicesCard').screenshot({ path: S + '/invoices_card.png' });

// send + mark paid
await pg.evaluate(() => _invAction(_INVOICES.rows[0].id, 'send'));
await pg.waitForTimeout(400);
check('sending goes to the customer address by default', sent.length === 1 && sent[0].to === 'hale@example.com', JSON.stringify(sent));
v = await pg.evaluate(() => _INVOICES.rows[0].status);
check('…and the row flips to SENT', v === 'sent', v);
await pg.evaluate(() => _invAction(_INVOICES.rows[0].id, 'paid'));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ st: _INVOICES.rows[0].status, html: document.getElementById('invList').innerHTML }));
check('marking paid shows a PAID chip with no further actions', v.st === 'paid' && /PAID/.test(v.html) && !/Mark paid[\s\S]*?INV-1001|INV-1001[\s\S]*?Mark paid/.test(v.html.split('INV-1002')[0]), v.st);

// print view
const [pop] = await Promise.all([
  ctx.waitForEvent('page'),
  pg.evaluate(() => _invPrint(_INVOICES.rows[0].id)),
]);
await pop.waitForTimeout(600);
v = await pop.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
check('the printable invoice carries letterhead, GST split, bank and reference',
  /Acme Roofing Ltd/.test(v) && /GST 111-222-333/.test(v) && /\$10,000\.00/.test(v) && /\$1,500\.00/.test(v) &&
  /02-9999-8888888-00/.test(v) && /Reference: INV-1001/.test(v), v.slice(0, 160));
await pop.close();

// the sample job never invoices
await pg.evaluate(() => { S.isSampleJob = true; return _invLoad(); });
await pg.waitForTimeout(300);
v = await pg.evaluate(() => document.getElementById('invList').textContent);
check('the sample job carries no invoices', /sample job/.test(v), v.slice(0,80));

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
