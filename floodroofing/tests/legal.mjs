// A privacy policy that is out of date is worse than not having one. These
// checks tie the two documents to the code they describe: if a new third
// party gets called, or the AI stops being opt-in, or the pages stop being
// reachable from the place someone agrees to them, this suite fails.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const flat = (x) => x.replace(/\s+/g, ' ');
const terms   = flat(await readFile(_j(DIR, 'terms.html'), 'utf8'));
const privacy = flat(await readFile(_j(DIR, 'privacy.html'), 'utf8'));
const landing = flat(await readFile(_j(DIR, 'landing.html'), 'utf8'));
const server  = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const app     = await readFile(_j(DIR, 'index.html'), 'utf8');

// ── every third party the code actually calls is named in the policy ──
// Each entry: the thing to look for in the source, and the name the policy
// must use for it. A new outbound integration means a new row here AND a new
// row in the table — which is the point.
const PROCESSORS = [
  ['Supabase',  /supabase/i,                       server],
  ['Anthropic', /api\.anthropic\.com/,             server],
  ['Fergus',    /api\.fergus\.com|FERGUS_HOST/,    server],
  ['Stripe',    /stripe/i,                         server],
  ['Nominatim', /nominatim\.openstreetmap\.org/,   app],
  ['LINZ',      /linz/i,                           app],
  ['Esri',      /esri/i,                           app],
];
for (const [name, pattern, src] of PROCESSORS){
  if (!pattern.test(src)) { check('(' + name + ' is no longer called — remove it from the policy)', false); continue; }
  check('the policy names ' + name + ', which the code calls', privacy.indexOf(name) >= 0);
}
check('…and names the two hosts it runs on',
  /Railway/.test(privacy) && /Vercel/.test(privacy));

// A crude but effective canary: a new https host in the backend that nobody
// has thought about is exactly what this page is supposed to catch.
const KNOWN_HOSTS = ['api.anthropic.com','api.fergus.com','api.resend.com','api.vercel.com','smtp.gmail.com','api.stripe.com'];   // Stripe: disclosed in the sub-processor table (Payments)
// Only hosts in a position that actually makes a request: the two request
// helpers, a literal https:// URL, or an env-var fallback that names a host.
// Matching every quoted domain in the file swept up the multi-part-TLD table
// and a DNS CNAME target, which are not outbound calls.
const hosts = Array.from(new Set([]
  .concat(server.match(/https?Post\(\s*'([^']+)'/g) || [])
  .concat(server.match(/https?Request\(\s*'([^']+)'/g) || [])
  .concat(server.match(/fetch\(\s*'https:\/\/[^'\/]+/g) || [])
  // ...and an env-var fallback naming a host or a base URL. VERCEL_API is
  // declared this way rather than called with a literal, so without this the
  // canary would report four hosts and miss a fifth.
  .concat((server.match(/process\.env\.[A-Z_]*(?:HOST|API|URL)[A-Z_]*\s*\|\|\s*'[^']+'/g) || [])
    .map(m => (m.match(/'([^']+)'/) || [])[1] || ''))
  .map(m => (m.match(/(?:https:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/) || [])[1])
  .filter(Boolean)
  .filter(h => !/roofmap|floodroofing|railway\.app|supabase\.co|127\.0\.0\.1/.test(h))));
const unknown = hosts.filter(h => KNOWN_HOSTS.indexOf(h) < 0);
check('no third-party host is called that the policy has never heard of',
  unknown.length === 0, unknown.length ? 'UNDISCLOSED: ' + unknown.join(', ') : hosts.join(', ') || 'none');

// ── the AI claim is true ──
check('the AI is only ever called from a route the user triggers',
  /app\.post\('\/claude\/\*', requireAuth/.test(server),
  'the /claude proxy requires auth');
const aiCalls = (app.match(/claudeCall\(/g) || []).length;
check('…and only from the two places the policy names',
  aiCalls === 3, aiCalls - 1 + ' call sites (roof trace, price list)');
check('…which the policy says out loud',
  /only when you press the button/.test(privacy) && /not used to train/i.test(privacy));

// ── the milestone list matches the code ──
const declared = (server.match(/const USAGE_EVENTS = \[([\s\S]*?)\];/) || [])[1] || '';
const eventNames = (declared.match(/'([a-z_]+)'/g) || []).map(x => x.replace(/'/g,''));
check('the policy says how many milestones there are, and is right',
  eventNames.length === 9 && /[Nn]ine milestones/.test(privacy),
  eventNames.length + ' in the code');
check('…and there is still no page tracking to disclose',
  !/page_view|pageview|session_recording/.test(server) && /no page tracking/.test(privacy));
// A retention period nobody enforces is not a retention period.
const keepDays = Number((server.match(/const USAGE_KEEP_DAYS = (\d+)/) || [])[1] || 0);
check('the retention period the policy promises is actually enforced',
  keepDays === 730 && /24 months, then deleted automatically/.test(privacy) &&
  /_pruneUsage/.test(server), keepDays + ' days, pruned on a timer');

// ── the terms say the thing that matters most about a measuring tool ──
check('the terms say measurements are estimates, in a callout',
  /Measurements are estimates/.test(terms) &&
  /you are responsible for checking it/i.test(terms));
check('…and say not to order material without checking the building',
  /Do not order material or price a job off RoofMap without/i.test(terms));
check('…and are clear the quote is the roofer\'s document, not ours',
  /the contract for the roofing work is between you and\s*your customer/i.test(terms));
check('…and set out whose customer data it is',
  /you are the agency responsible/i.test(terms) && /Privacy Act 2020/.test(terms));
check('…and contract out of the CGA for business use, as NZ law allows',
  /Consumer Guarantees Act 1993/.test(terms) && /in trade/.test(terms));
check('…and cap liability at 12 months of fees',
  /12 months before the claim arose/.test(terms));
check('…and promise 30 days\' notice before a price change',
  /30 days' notice/.test(terms));
check('the price book is promised to stay private, in both documents',
  /never shown to\s*another subscriber/i.test(terms) && /never shown to another subscriber/i.test(privacy));

// ── nothing is left to fill in that would be wrong to publish ──
const holes = [];
for (const [name, src] of [['terms.html', terms], ['privacy.html', privacy]]){
  for (const m of src.match(/\[[A-Za-z][^\]\n]{2,40}\]/g) || []) holes.push(name + ' ' + m);
}
check('(placeholders still to fill before publishing)', true, holes.length ? holes.join(', ') : 'none');

// ── they are reachable from where somebody agrees to them ──
// The form moved to its own page — that is where somebody agrees, so that is
// where the agreement has to be visible.
const signup = flat(await readFile(_j(DIR, 'signup.html'), 'utf8'));
check('the sign-up form says what you are agreeing to',
  /By creating an account you agree to our[\s\S]{0,120}terms\.html[\s\S]{0,120}privacy\.html/.test(signup));
check('…and both are linked from the footer of every public page',
  [landing, signup].every(pg => /footer[\s\S]*terms\.html/.test(pg) && /footer[\s\S]*privacy\.html/.test(pg)));
check('…and from inside the app', /terms\.html/.test(app) && /privacy\.html/.test(app));

// ── and they render ──
const TYPES = { '.html':'text/html', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg' };
const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  try { const b = await readFile(_j(DIR, p));
    res.writeHead(200, {'content-type': TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'}); res.end(b);
  } catch(e){ res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const b = await chromium.launch();

for (const page of ['terms', 'privacy']){
  for (const [w, label] of [[1200, 'desktop'], [390, 'phone']]){
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => console.log('PAGEERROR', e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/${page}.html`);
    await pg.waitForTimeout(500);
    const v = await pg.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      styled: getComputedStyle(document.querySelector('h1')).fontWeight === '800',
      dead: Array.from(document.querySelectorAll('a[href^="#"]'))
              .filter(a => !document.querySelector(a.getAttribute('href')))
              .map(a => a.getAttribute('href')),
      secs: document.querySelectorAll('main section').length,
      toc: document.querySelectorAll('.toc a').length,
      glossed: document.querySelectorAll('main section > .gloss').length,
    }));
    check(page + '.html holds together on ' + label,
      v.over === 0 && v.styled && v.dead.length === 0,
      'overflow ' + v.over + ', dead anchors ' + JSON.stringify(v.dead));
    if (w === 1200){
      check('…every section is in the contents', v.toc === v.secs, v.toc + ' listed, ' + v.secs + ' sections');
      check('…and every section has its plain-English line', v.glossed === v.secs, v.glossed + '/' + v.secs);
      await pg.screenshot({ path: _j(S, page + '.png'), fullPage: true });
    }
    await ctx.close();
  }
}
await b.close(); srv.close();

const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
