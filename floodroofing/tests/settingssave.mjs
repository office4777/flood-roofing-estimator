// A SETTINGS SAVE NEVER READS AN UNFILLED FORM, AND AN ACCEPTANCE NEVER LEAVES
// THE CUSTOMER STUCK (2026-10-25, job 3334: "Aidan accepted job 3334 but it
// froze and i didn't get the acceptance email, please fix").
// Two faults behind one message:
//   • the office heard nothing because a Settings save made from OUTSIDE the
//     Settings tab (a price saved as the default, a template, the condition
//     wording, a profile picture…) read the Settings form before it had ever
//     been filled — and stored every "Send this email automatically" switch as
//     OFF, the branding words blank with them;
//   • the customer's phone froze because the background PDF copy of his
//     acceptance put a veil over the page and the capture never came back.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(settings){
  const ctx = await b.newContext({ viewport:{ width:1400, height:950 } });
  const pg = await ctx.newPage();
  pg.on('dialog', d => d.accept());
  const puts = [], posts = [];
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    if (/\/settings(\?|$)/.test(u) && m === 'GET') return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(settings) });
    if (/\/settings(\?|$)/.test(u) && m === 'PUT'){ puts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status:200, contentType:'application/json', body: r.request().postData() }); }
    if (/accept-email/.test(u)){ posts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }); }
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForFunction(() => window.__settingsLive === true, null, { timeout: 30000 });
  await pg.waitForTimeout(600);
  return { ctx, pg, puts, posts };
}
const SET = { branding: { company_name: 'Flood Roofing', phone: '0800 435 663', email: 'office@floodroofing.co.nz' },
  quote_defaults: { validity_days: 30, email: { accept_to: 'office@floodroofing.co.nz', copy_all: 'office@floodroofing.co.nz', reminder_enabled: true, reminder_days: 4 } },
  price_book: {}, selectables: {}, labour_pricing: {} };

// ── a save from another tab, Settings never opened ──
let t = await boot(SET);
let r = await t.pg.evaluate(async () => {
  const tab = document.body.dataset.tab, wasFilled = !!window.__settingsUiFilled;
  await saveSettings(true);
  return { tab, wasFilled };
});
await t.pg.waitForTimeout(300);
let put = t.puts[t.puts.length - 1] || {}, em = ((put.quote_defaults || {}).email) || {};
check('a Settings save made away from the Settings tab (its form never opened)', !r.wasFilled && r.tab !== 'settings' && t.puts.length === 1, JSON.stringify(r));
check('…switches NO automatic email off', !['accept_office_on','accept_cust_on','question_on','decline_on'].some(k => em[k] === false), JSON.stringify(em).slice(0, 300));
check('…keeps where acceptances go, the copy-all and the follow-up', em.accept_to === 'office@floodroofing.co.nz' && em.copy_all === 'office@floodroofing.co.nz' && em.reminder_enabled === true && em.reminder_days === 4, JSON.stringify(em).slice(0, 300));
check('…and keeps the branding words', (put.branding || {}).company_name === 'Flood Roofing' && put.branding.phone === '0800 435 663' && put.branding.email === 'office@floodroofing.co.nz', JSON.stringify(put.branding));
await t.ctx.close();

// ── an email the office DID switch off stays off ──
t = await boot(Object.assign({}, SET, { quote_defaults: { email: { accept_to: 'office@floodroofing.co.nz', accept_cust_on: false } } }));
await t.pg.evaluate(() => saveSettings(true)); await t.pg.waitForTimeout(300);
em = (((t.puts[t.puts.length - 1] || {}).quote_defaults || {}).email) || {};
check('an email the office switched off on purpose stays off', em.accept_cust_on === false && !('accept_office_on' in em && em.accept_office_on === false), JSON.stringify(em).slice(0, 200));
// …and the Settings tab still writes what is typed there
await t.pg.evaluate(async () => { gotoTab('settings'); await new Promise(r => setTimeout(r, 300));
  const c = document.getElementById('emAcceptOfficeOn'); c.checked = false;
  document.getElementById('brPhone').value = '09 111 2222'; await saveSettings(true); });
await t.pg.waitForTimeout(300);
put = t.puts[t.puts.length - 1] || {}; em = ((put.quote_defaults || {}).email) || {};
check('…and the Settings tab still saves what is changed on it', em.accept_office_on === false && (put.branding || {}).phone === '09 111 2222', JSON.stringify({ em, ph: (put.branding || {}).phone }).slice(0, 200));
await t.ctx.close();

// ── THE PRODUCTS AND THE EMAIL WORDING SURVIVE A RELOAD (2026-10-28) ──
// "the gutter profile pictures i upload ... disappear after an app reload";
// "my custom email quote template keeps reverting back to default".
const PIC = 'data:image/png;base64,iVBORw0KGgo=';
t = await boot(Object.assign({}, SET, { selectables: { grades: [], profiles: [], extras: [], gutters: [{ id:'box125', name:'125mm Colorsteel box gutter', img: PIC }] },
  quote_defaults: { email: { accept_to: 'office@floodroofing.co.nz', quote_subject: 'Our quote {ref}', quote_body: 'Kia ora {client}, our own words.' } } }));
r = await t.pg.evaluate(() => ({ sel: !!(S.settings.selectables && S.settings.selectables.gutters), img: (_selGutterOf('box125') || {}).img || null }));
check('a reload keeps the products the server holds, the gutter picture with them', r.sel && r.img === 'data:image/png;base64,iVBORw0KGgo=', JSON.stringify(r).slice(0, 160));
await t.pg.evaluate(() => saveSettings(true)); await t.pg.waitForTimeout(300);
put = t.puts[t.puts.length - 1] || {}; em = ((put.quote_defaults || {}).email) || {};
check('…and a save from elsewhere sends that list back, picture and all', ((put.selectables || {}).gutters || [])[0] && put.selectables.gutters[0].img === PIC, JSON.stringify(put.selectables || null).slice(0, 120));
check('…with the custom quote email as typed, nothing marked for reset', em.quote_body === 'Kia ora {client}, our own words.' && !em.__reset, JSON.stringify({ b: em.quote_body, r: em.__reset }));
await t.pg.evaluate(async () => { gotoTab('settings'); await new Promise(r => setTimeout(r, 300)); _emxReset('quote'); await saveSettings(true); });
await t.pg.waitForTimeout(300);
put = t.puts[t.puts.length - 1] || {}; em = ((put.quote_defaults || {}).email) || {};
check('Reset to the standard wording names the quote email in __reset, so the server takes it', !em.quote_body && Array.isArray(em.__reset) && em.__reset.includes('quote_body'), JSON.stringify(em.__reset));
r = await t.pg.evaluate(() => !!(S.settings.quote_defaults.email || {}).__reset);
check('…and the mark goes once the save has landed', r === false);
await t.ctx.close();

// ── the acceptance's background PDF can never leave the customer stuck ──
t = await boot(SET);
const v = await t.pg.evaluate(async () => {
  // the customer's page, a capture that never comes back (a CDN that hangs, a
  // phone's canvas that gives up), and short waits for the test
  window.__CUSTOMER_MODE = true; window.__CUSTOMER_TOKEN = 'tok-3334';
  document.documentElement.classList.add('qp-desk');
  window._loadPdfLibs = function(){ return new Promise(function(){}); };
  window.__QP_VEIL_ESCAPE_MS = 250; window.__QP_ACCEPT_PDF_MAX_MS = 1500;
  const p = _emailAcceptedQuoteToOffice();
  await new Promise(r => setTimeout(r, 600));
  const veil = document.getElementById('qpPdfVeil');
  const mid = { veil: !!veil, txt: veil ? veil.innerText : '', btn: !!(veil && veil.querySelector('.qp-veil-go')), pdfLayout: document.documentElement.classList.contains('pdf-modern') };
  await p;
  return { mid, after: { veil: !!document.getElementById('qpPdfVeil'), pdfLayout: document.documentElement.classList.contains('pdf-modern'), desk: document.documentElement.classList.contains('qp-desk') } };
});
await t.pg.waitForTimeout(300);
check('while the copy is being made the cover says the acceptance IS recorded', v.mid.veil && /acceptance is recorded/i.test(v.mid.txt), JSON.stringify(v.mid));
check('…and offers "Continue to my quote" after a few seconds', v.mid.btn, JSON.stringify(v.mid));
check('a capture that never comes back is given up: the cover comes off and the page is the quote again', !v.after.veil && !v.after.pdfLayout && v.after.desk, JSON.stringify(v.after));
check('…and the office is still emailed, without the PDF', t.posts.length === 1 && t.posts[0].pdfBase64 == null, JSON.stringify(t.posts).slice(0, 200));
const c = await t.pg.evaluate(async () => {
  window.__QP_ACCEPT_PDF_MAX_MS = 60000;
  _emailAcceptedQuoteToOffice();
  await new Promise(r => setTimeout(r, 500));
  const btn = document.querySelector('#qpPdfVeil .qp-veil-go'); if (btn) btn.click();
  await new Promise(r => setTimeout(r, 100));
  return { clicked: !!btn, veil: !!document.getElementById('qpPdfVeil'), pdfLayout: document.documentElement.classList.contains('pdf-modern') };
});
check('"Continue to my quote" takes the cover off straight away', c.clicked && !c.veil && !c.pdfLayout, JSON.stringify(c));
await t.ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
