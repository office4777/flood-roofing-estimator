// The customer quote link, and the email that carries it.
//
// The link has always been <host>/?q=<token>, and the quote itself lives in
// app.html. When the app moved off the site root — so the homepage could be
// the marketing page instead of a 3 MB noindex'd app — the root started
// serving landing.html, and every quote link ever emailed landed on the
// marketing page. Vercel resolves rewrites in order and matches `has`
// conditions, so the repair is a rewrite that catches `/?q=` BEFORE the plain
// `/` rewrite: links already in customers' inboxes keep working, with no
// client-side hop for the customer to see.
//
// This is a config-ordering bug, so the guard has to read the config. The
// belt-and-braces bail-out in landing.html covers the case the config can't:
// a landing page already cached in someone's browser.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// ── the rewrite that keeps sent links alive ────────────────────────
const VC = JSON.parse(readFileSync(_j(DIR, 'vercel.json'), 'utf8'));
const rewrites = VC.rewrites || [];
const idxQ = rewrites.findIndex(r => r.source === '/' &&
  (r.has || []).some(h => h.type === 'query' && h.key === 'q'));
const idxRoot = rewrites.findIndex(r => r.source === '/' && !r.has);

check('there is a rewrite for the root carrying a ?q= token', idxQ >= 0,
  idxQ < 0 ? 'no { source:"/", has:[{type:"query",key:"q"}] } rewrite' : 'at index ' + idxQ);
check('…and it sends the customer to the app, not the landing page',
  idxQ >= 0 && rewrites[idxQ].destination === '/app.html',
  idxQ >= 0 ? rewrites[idxQ].destination : 'n/a');
// Vercel takes the FIRST matching rewrite. Behind the bare `/` rule it would
// never run, and the config would still look correct.
check('…and it is ordered before the plain / rewrite, so it actually matches',
  idxQ >= 0 && idxRoot >= 0 && idxQ < idxRoot,
  '?q= at ' + idxQ + ', plain / at ' + idxRoot);
check('the plain / rewrite still serves the landing page',
  idxRoot >= 0 && rewrites[idxRoot].destination === '/landing.html',
  idxRoot >= 0 ? rewrites[idxRoot].destination : 'missing');

// ── the landing page hands a quote link on rather than eating it ───
const landing = readFileSync(_j(DIR, 'landing.html'), 'utf8');
check('landing.html bails out to the app when it sees a ?q= token',
  /[?&'"\s]q['"\s]*\)?/.test(landing) && /app\.html/.test(landing) &&
  /location\.replace|location\.href/.test(landing),
  'looks for q in the query string and forwards to app.html');
// It has to run before the page paints, or the customer sees the marketing
// page flash up before their quote.
const bailAt = landing.search(/__CUSTOMER_BAILOUT|searchParams[\s\S]{0,40}['"]q['"]/);
check('…early enough that the marketing page never flashes up',
  bailAt >= 0 && bailAt < landing.indexOf('<body'),
  bailAt < 0 ? 'not found' : 'at ' + bailAt + ', <body> at ' + landing.indexOf('<body'));

// ── the app still reads the token it is handed ─────────────────────
const app = readFileSync(_j(DIR, 'app.html'), 'utf8');
check('app.html still reads ?q= into the customer token',
  /__CUSTOMER_TOKEN/.test(app) && /get\('q'\)/.test(app));

// ── the default email that carries the link ────────────────────────
// "can you remove the quote total from this default email" — the quote is a
// document the customer opens and changes; a number in the covering email is
// stale the moment they pick a different steel grade.
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
await pg.waitForTimeout(2500);

const mail = await pg.evaluate(async () => {
  // openQuoteEmail() re-reads the quote from the form, so the fixture has to
  // go in through the form the office actually types into.
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('qdRef', '3173');
  set('qdClient', 'Hinekeia Reardon');
  set('qdAddr', '4 Hillcrest Road, Kaikohe');
  set('qdValidUntil', '25/09/2026');
  set('qdGstRate', '15');
  S.quote = S.quote || {};
  S.quote.share = { token: 'tok123' };
  S.quote.lineItems = [{ desc:'Labour', qty:1, unit:20000 },
                       { desc:'Materials', qty:1, unit:17000 }];
  await openQuoteEmail();
  return { body: (document.getElementById('quoteEmailBody')||{}).value || '',
           subject: (document.getElementById('quoteEmailSubject')||{}).value || '',
           tot: (typeof _quoteMoney === 'function') ? _quoteMoney().tot : 0 };
});

check('the email is composed with a total worth hiding', mail.tot > 1000,
  '$' + mail.tot);
check('the default email carries no dollar figure at all',
  !/\$\s?[\d,]/.test(mail.body),
  (mail.body.match(/\$\s?[\d,][\d,.]*/g) || []).join(', ') || 'none');
check('…and says nothing about a total', !/total/i.test(mail.body),
  (mail.body.match(/.{0,30}total.{0,30}/i) || [])[0] || 'none');
// What it must still do.
check('it still carries the customer link', /\?q=tok123/.test(mail.body),
  (mail.body.match(/https?:\/\/\S+/) || [])[0] || 'no link');
check('…still names the customer and the address',
  /Hinekeia Reardon/.test(mail.body) && /Hillcrest Road/.test(mail.body));
check('…still gives the expiry, which is not a price',
  /25\/09\/2026/.test(mail.body));
check('…and the subject still carries the quote reference',
  /3173/.test(mail.subject), mail.subject);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
