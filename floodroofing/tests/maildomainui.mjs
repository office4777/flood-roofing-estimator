// Settings → Email → "Send from your own email address", in each of its
// states: Business with nothing set up (the input), pending (the DNS records
// table, verbatim from the server), verified (the green badge), removed
// (back to the input), and Solo (the upgrade lock, no input).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const RECS = [
  { record: 'SPF', name: 'send.hemisroofing.co.nz', type: 'MX', value: 'feedback-smtp.ap-northeast-1.amazonses.com', priority: 10 },
  { record: 'SPF', name: 'send.hemisroofing.co.nz', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all' },
  { record: 'DKIM', name: 'resend._domainkey.hemisroofing.co.nz', type: 'TXT', value: 'p=MIGfMA0GCSq' },
];
const ROW = (status) => ({ id: 'md1', domain: 'hemisroofing.co.nz', from_email: 'office@hemisroofing.co.nz',
  status, records: RECS, error: status === 'pending' ? 'The DNS records aren\'t all visible yet.' : '',
  provider: { name: 'Cloudflare', url: 'https://dash.cloudflare.com',
    path: 'pick the domain → DNS → Records → Add record (set Proxy status to "DNS only" — the grey cloud)' } });

async function boot(allowed, state){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const srv = { state, calls: [] };   // state: null | 'pending' | 'verified'
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const url = r.request().url(), method = r.request().method();
    const j = (x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/\/email\/domain\/verify/.test(url) && method === 'POST'){
      srv.calls.push('verify'); srv.state = 'verified';
      return j({ domain: ROW('verified') });
    }
    if (/\/email\/domain\/instructions/.test(url) && method === 'POST'){
      srv.calls.push('instr:' + (JSON.parse(r.request().postData() || '{}').to || ''));
      return j({ ok: true, sent_to: JSON.parse(r.request().postData() || '{}').to });
    }
    if (/\/email\/domain/.test(url)){
      if (method === 'GET')  return j({ enabled: true, allowed, domain: srv.state ? ROW(srv.state) : null });
      if (method === 'POST'){ srv.calls.push('add:' + (JSON.parse(r.request().postData() || '{}').email || '')); srv.state = 'pending'; return j({ domain: ROW('pending') }); }
      if (method === 'DELETE'){ srv.calls.push('delete'); srv.state = null; return j({ ok: true }); }
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript(() => {
    localStorage.setItem('fr_token', 't');
    localStorage.setItem('fr_setup_done', '1'); localStorage.setItem('fr_settings', 'null');
  });
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2200);
  return { ctx, pg, errs, srv };
}
const bodyOf = (pg) => pg.evaluate(() => {
  const el = document.getElementById('emDomainBody');
  return { html: el ? el.innerHTML : null, text: el ? el.textContent : '' };
});

// ── Business, nothing set up yet: the offer and the input ─────────
const t = await boot(true, null);
await t.pg.evaluate(() => _mailDomainLoad());
await t.pg.waitForTimeout(400);
let v = await bodyOf(t.pg);
check('the block itself explains what it does', await t.pg.evaluate(() =>
  /Send from your own email address/.test((document.getElementById('emDomainBlock') || {}).textContent || '')), '');
check('Business with nothing set up gets the address input', /emDomainEmail/.test(v.html || ''), '');

// ── setting it up renders the DNS records verbatim ────────────────
await t.pg.evaluate(() => {
  document.getElementById('emDomainEmail').value = 'office@hemisroofing.co.nz';
  return _mailDomainAdd();
});
await t.pg.waitForTimeout(400);
v = await bodyOf(t.pg);
check('the typed address went to the server', t.srv.calls.includes('add:office@hemisroofing.co.nz'),
  JSON.stringify(t.srv.calls));
check('a pending domain shows "Waiting for DNS"', /Waiting for DNS/.test(v.text), v.text.slice(0, 120));
check('…with all three DNS records, values intact',
  /send\.hemisroofing\.co\.nz/.test(v.text) && /resend\._domainkey\.hemisroofing\.co\.nz/.test(v.text) &&
  /v=spf1 include:amazonses\.com ~all/.test(v.text) && /feedback-smtp/.test(v.text), '');
check('…the MX priority is shown', />10</.test(v.html || ''), '');
check('…and a "Check now" button', /_mailDomainCheck/.test(v.html || ''), '');
check('…the card NAMES the DNS host with its login door',
  /managed at/.test(v.text) && /Cloudflare/.test(v.text) && /dash\.cloudflare\.com/.test(v.text),
  v.text.slice(0, 160));

// ── "not your department" — the forwardable instructions ──────────
check('the email-my-web-person form is on the card',
  /emDomainInstrTo/.test(v.html || '') && /Email these instructions/.test(v.text), '');
await t.pg.evaluate(() => {
  document.getElementById('emDomainInstrTo').value = 'webguy@agency.co.nz';
  return _mailDomainSendInstr();
});
await t.pg.waitForTimeout(400);
v = await bodyOf(t.pg);
check('…sending posts the address and confirms with the CC promise',
  t.srv.calls.includes('instr:webguy@agency.co.nz') && /Sent to webguy@agency\.co\.nz/.test(v.text),
  JSON.stringify(t.srv.calls));

// ── the in-depth guide behind one button ──────────────────────────
await t.pg.evaluate(() => _mailDomainGuideToggle());
v = await t.pg.evaluate(() => {
  const g = document.getElementById('emDomainGuide');
  return { open: g && g.style.display !== 'none', text: g ? g.textContent : '' };
});
check('the step-by-step guide opens', v.open, '');
check('…walking through login, the example form, and Check now',
  /Step 1/.test(v.text) && /Step 2/.test(v.text) && /Step 3/.test(v.text) &&
  /Example — a typical/.test(v.text) && /Check now/.test(v.text), '');
check('…with the example form filled from THIS domain\'s real records',
  /feedback-smtp/.test(v.text) && /send/.test(v.text), '');
check('…and the top troubleshooting gotchas',
  /doubled domain/.test(v.text) && /DNS only/.test(v.text) && /grey cloud/.test(v.text), '');
await t.pg.evaluate(() => { document.getElementById('emDomainBlock').scrollIntoView(); });
await t.pg.locator('#emDomainBlock').screenshot({ path: '/tmp/claude-0/-home-user-flood-roofing-estimator/95c9b7c4-d3b6-5762-8e5f-b394802141f5/scratchpad/maildomain-guide.png' }).catch(() => {});
await t.pg.evaluate(() => _mailDomainGuideToggle());

// ── checking flips it to verified ─────────────────────────────────
await t.pg.evaluate(() => _mailDomainCheck());
await t.pg.waitForTimeout(400);
v = await bodyOf(t.pg);
check('once verified the badge goes green and the records table goes away',
  /✓ Verified/.test(v.text) && !/Waiting for DNS/.test(v.text) && !/feedback-smtp/.test(v.text), v.text.slice(0, 160));
check('…saying which address the mail now sends from',
  /now send from/.test(v.text) && /office@hemisroofing\.co\.nz/.test(v.text), '');

// ── removing puts the input back ──────────────────────────────────
await t.pg.evaluate(() => _mailDomainRemove());
await t.pg.waitForTimeout(400);
v = await bodyOf(t.pg);
check('removing it goes to the server and restores the input',
  t.srv.calls.includes('delete') && /emDomainEmail/.test(v.html || ''), JSON.stringify(t.srv.calls));
check('no page errors on the Business side', t.errs.length === 0, t.errs.join(' | ') || 'clean');
await t.ctx.close();

// ── Solo: the lock, honestly, with the upgrade path ───────────────
const so = await boot(false, null);
await so.pg.evaluate(() => _mailDomainLoad());
await so.pg.waitForTimeout(400);
v = await bodyOf(so.pg);
check('Solo sees the Team lock, not the input',
  /Team plan/.test(v.text) && /_billingOpen/.test(v.html || '') && !/emDomainEmail/.test(v.html || ''),
  v.text.slice(0, 140));
check('no page errors on the Solo side', so.errs.length === 0, so.errs.join(' | ') || 'clean');
await so.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
