// "Can you allow the default/template email to be changed in the email
//  settings" — the wording the Email-Quote window opens with was hard-coded,
// so every office sent Flood Roofing's phrasing or retyped its own on every
// single quote.
//
// Settings → Email now holds the subject and message. {placeholders} fill in
// per job at send time; blank (or untouched) means the standard wording, so
// nothing changes for an office that never visits the box.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// A job to fill the placeholders from.
await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.branding = Object.assign({}, S.settings.branding,
    { company_name: 'Kauri Roofing', phone: '0800 111 222', email: 'office@kauri.nz', website: 'www.kauri.nz' });
  S.quote = Object.assign(S.quote || {}, { client: 'Sam Customer', addr: '12 Rimu Rd',
    ref: 'FR-9001', validUntil: '30 days', email: 'sam@customer.nz' });
});

// ── the boxes exist and open showing the wording that will be used ─
await pg.evaluate(() => { gotoTab('settings'); if (typeof refreshSettingsUI === 'function') refreshSettingsUI(); });
await pg.waitForTimeout(400);
let ui = await pg.evaluate(() => ({
  subj: (document.getElementById('emQuoteSubject')||{}).value,
  body: (document.getElementById('emQuoteBody')||{}).value,
}));
check('Settings → Email carries the quote email wording', !!ui.subj && !!ui.body);
check('…opening pre-filled with the standard wording, not a blank box',
  /\{ref\}/.test(ui.subj) && /Thanks for the opportunity/.test(ui.body), ui.subj);

// ── untouched wording is stored as "no override" ───────────────────
let stored = await pg.evaluate(() => {
  collectSettingsFromUI();
  const em = (S.settings.quote_defaults || {}).email || {};
  return { subj: em.quote_subject, body: em.quote_body };
});
check('unedited text is stored as no-override, so it tracks improvements',
  stored.subj === '' && stored.body === '', JSON.stringify(stored));

// ── and the popup renders the standard wording with the job filled in ─
let mail = await pg.evaluate(() => _quoteEmailTemplate('https://roofmap.co.nz/q/abc'));
check('the standard subject fills in the ref and company',
  mail.subject === 'Your roofing quote FR-9001 — Kauri Roofing', mail.subject);
check('…the body greets the client at their address',
  /^Hi Sam Customer,/.test(mail.body) && / at 12 Rimu Rd\./.test(mail.body), mail.body.slice(0, 90));
check('…carries the link and the validity',
  mail.body.indexOf('https://roofmap.co.nz/q/abc') >= 0 && /Quote valid until: 30 days/.test(mail.body));
check('…and signs off with the business, not Flood Roofing',
  /Kind regards,\nKauri Roofing\n0800 111 222\noffice@kauri.nz\nwww\.kauri\.nz/.test(mail.body),
  mail.body.slice(-90));

// ── the office writes its own wording ──────────────────────────────
await pg.evaluate(() => {
  document.getElementById('emQuoteSubject').value = 'Quote {ref} for {client} — {company}';
  document.getElementById('emQuoteBody').value =
    'Kia ora {client},\n\nYour roof quote for{address} is here:\n{link}\nCall us on {phone}Cheers, {company}';
  collectSettingsFromUI();
});
mail = await pg.evaluate(() => _quoteEmailTemplate('LINK'));
check('a custom subject is used, placeholders filled',
  mail.subject === 'Quote FR-9001 for Sam Customer — Kauri Roofing', mail.subject);
check('…and the custom body, word for word',
  /^Kia ora Sam Customer,/.test(mail.body) && /Cheers, Kauri Roofing$/.test(mail.body) &&
  mail.body.indexOf('LINK') >= 0, mail.body);

// The real Email-Quote window opens with that wording.
const popup = await pg.evaluate(() => {
  gotoTab('quote');
  openQuoteEmail();
  return {
    subj: (document.getElementById('quoteEmailSubject')||{}).value,
    body: (document.getElementById('quoteEmailBody')||{}).value,
    to: (document.getElementById('quoteEmailTo')||{}).value,
  };
});
check('the Email-Quote window opens with the office\'s wording',
  /^Quote FR-9001 for Sam Customer/.test(popup.subj) && /^Kia ora Sam Customer,/.test(popup.body),
  popup.subj);
check('…addressed to the customer', popup.to === 'sam@customer.nz', popup.to);

// ── empty details collapse cleanly ─────────────────────────────────
mail = await pg.evaluate(() => {
  S.quote.validUntil = ''; S.quote.addr = '';
  const m = _quoteEmailTemplate('');
  S.quote.validUntil = '30 days'; S.quote.addr = '12 Rimu Rd';
  return m;
});
check('a job with no validity, address or link leaves no half-sentences',
  mail.body.indexOf('{') < 0 && !/valid/i.test(mail.body) && !/\n{3,}/.test(mail.body), mail.body);

// ── reset puts the standard wording back ───────────────────────────
const reset = await pg.evaluate(() => {
  gotoTab('settings');
  _resetQuoteEmailTemplate();
  return {
    subj: (document.getElementById('emQuoteSubject')||{}).value,
    isDefault: (document.getElementById('emQuoteBody')||{}).value === QUOTE_EMAIL_DEFAULT.body,
  };
});
check('Reset restores the standard wording in the boxes',
  reset.isDefault && /\{ref\}/.test(reset.subj), reset.subj);

check('no page errors', errs.length === 0, errs.join(' | '));
const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
