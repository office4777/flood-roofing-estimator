// Whether the site can be found, and whether it can be quoted.
//
// The failure mode this suite exists for is silent rot. Every page carries
// the same twenty-odd head tags. One page gets added without a
// canonical, or a title gets edited past the length Google will render, or a
// new page never makes it into the sitemap — and nothing breaks. The site just
// quietly stops being fully indexed, and nobody finds out for a quarter.
//
// So the sitemap is checked for EQUALITY against the real page set, not just
// for being valid. A page nobody listed is a failure here.
//
// The other half is honesty. There are no customers yet, so any rating or
// review markup on this site would be fabricated — which is both a lie and a
// manual-action risk with Google. The suite refuses it outright.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const SITE = 'https://roofmap.co.nz';

// Every indexable page: clean URL → the file vercel.json rewrites it to.
// This list is the suite's idea of "the site", and the sitemap has to match it.
const PAGES = {
  '/':                              'landing.html',
  '/pricing':                       'pricing.html',
  '/early-access':                  'early-access.html',
  '/features/roof-measuring':       'features-measuring.html',
  '/features/job-pack':             'features-job-pack.html',
  '/features/quotes':               'features-quotes.html',
  '/roofmap-and-fergus':            'fergus.html',
  '/guides':                        'guides.html',
  '/guides/how-to-quote-a-re-roof': 'guides-quote-a-re-roof.html',
  '/guides/roof-flashings-explained':   'guides-roof-flashings-explained.html',
  '/guides/calculating-sheet-lengths':  'guides-calculating-sheet-lengths.html',
  '/guides/roof-pitch-explained':       'guides-roof-pitch-explained.html',
  '/guides/colorsteel-grades-compared': 'guides-colorsteel-grades-compared.html',
  '/guides/coastal-zones-and-warranties': 'guides-coastal-zones-and-warranties.html',
  '/guides/flashing-wastage':             'guides-flashing-wastage.html',
  '/guides/pipe-flashings-and-back-trays':'guides-pipe-flashings-and-back-trays.html',
  '/guides/re-roof-scope-of-work':        'guides-re-roof-scope-of-work.html',
  '/tools/roof-pitch-calculator':       'tools-roof-pitch-calculator.html',
  '/tools/roofing-sheet-calculator':    'tools-roofing-sheet-calculator.html',
  '/about':                         'about.html',
  '/terms':                         'terms.html',
  '/privacy':                       'privacy.html',
};
// Deliberately out of the sitemap: a form nobody should land on from a search,
// and the app.
const NOINDEX = { '/signup': 'signup.html', '/index.html': 'index.html' };

const TYPES = { '.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg',
                '.js':'text/javascript','.txt':'text/plain','.xml':'application/xml',
                '.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json' };
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (PAGES[p]) p = '/' + PAGES[p];
  else if (NOINDEX[p]) p = '/' + NOINDEX[p];
  try {
    const f = await readFile(DIR + p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });

// ── read every page once ──────────────────────────────────────────
const seen = {};
for (const [url, file] of Object.entries(PAGES)){
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(ORIGIN + url, { waitUntil: 'load' });
  seen[url] = await pg.evaluate(() => {
    const meta = (sel, attr) => { const e = document.querySelector(sel); return e ? (e.getAttribute(attr || 'content') || '') : null; };
    const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(h => +h.tagName[1]);
    return {
      lang: document.documentElement.lang,
      title: (document.title || '').trim(),
      desc: meta('meta[name="description"]'),
      canonical: meta('link[rel="canonical"]', 'href'),
      robots: meta('meta[name="robots"]'),
      ogType: meta('meta[property="og:type"]'),
      ogUrl: meta('meta[property="og:url"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDesc: meta('meta[property="og:description"]'),
      ogImage: meta('meta[property="og:image"]'),
      ogSite: meta('meta[property="og:site_name"]'),
      ogLocale: meta('meta[property="og:locale"]'),
      twCard: meta('meta[name="twitter:card"]'),
      twImage: meta('meta[name="twitter:image"]'),
      h1s: Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()),
      headings: hs,
      ld: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent),
      internal: Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
                  .filter(h => h && !/^(https?:)?\/\//.test(h) && !/^(mailto|tel|#)/.test(h)),
      html: document.documentElement.outerHTML,
    };
  });
  seen[url]._errs = errs;
  await pg.close();
}

// ── the head, on every page ───────────────────────────────────────
const bad = (fn) => Object.entries(seen).filter(([u, p]) => !fn(p, u)).map(([u]) => u);

check('every page declares New Zealand English',
  bad(p => p.lang === 'en-NZ').length === 0, bad(p => p.lang === 'en-NZ').join(' '));
check('every page has exactly one h1',
  bad(p => p.h1s.length === 1).length === 0,
  Object.entries(seen).filter(([, p]) => p.h1s.length !== 1).map(([u, p]) => u + '=' + p.h1s.length).join(' '));
check('…and headings that never skip a level',
  bad(p => { let prev = 0; return p.headings.every(h => { const ok = h <= prev + 1 || prev === 0; prev = Math.max(prev, h); return ok; }); }).length === 0,
  bad(p => { let prev = 0; return p.headings.every(h => { const ok = h <= prev + 1 || prev === 0; prev = Math.max(prev, h); return ok; }); }).join(' '));

// Google renders roughly 60 characters of a title and 155 of a description.
// Longer is not an error, it is a truncation — and a truncated description is
// a sentence the searcher never finishes reading.
check('every title fits what a search result shows (30–65 chars)',
  bad(p => p.title.length >= 30 && p.title.length <= 65).length === 0,
  Object.entries(seen).filter(([, p]) => p.title.length < 30 || p.title.length > 65)
    .map(([u, p]) => u + '=' + p.title.length).join(' '));
check('every description does too (70–160 chars)',
  bad(p => p.desc && p.desc.length >= 70 && p.desc.length <= 160).length === 0,
  Object.entries(seen).filter(([, p]) => !p.desc || p.desc.length < 70 || p.desc.length > 160)
    .map(([u, p]) => u + '=' + (p.desc ? p.desc.length : 'none')).join(' '));
check('…and no two pages share a title',
  new Set(Object.values(seen).map(p => p.title)).size === Object.keys(seen).length);
check('…or a description',
  new Set(Object.values(seen).map(p => p.desc)).size === Object.keys(seen).length);

// The canonical is what stops /pricing and /pricing.html splitting their own
// ranking between them.
check('every page names its own canonical URL, absolutely',
  bad((p, u) => p.canonical === SITE + u).length === 0,
  Object.entries(seen).filter(([u, p]) => p.canonical !== SITE + u)
    .map(([u, p]) => u + ' → ' + p.canonical).join(' , '));

// og:image was relative before this suite existed, which meant every link
// shared to Facebook, LinkedIn or Slack rendered no preview at all.
check('every og:image is an absolute URL',
  bad(p => /^https:\/\//.test(p.ogImage || '')).length === 0,
  Object.entries(seen).filter(([, p]) => !/^https:\/\//.test(p.ogImage || '')).map(([u]) => u).join(' '));
check('…and every twitter:image too',
  bad(p => /^https:\/\//.test(p.twImage || '')).length === 0);
check('the full Open Graph set is on every page',
  bad(p => p.ogType && p.ogUrl && p.ogTitle && p.ogDesc && p.ogSite === 'RoofMap' && p.ogLocale === 'en_NZ').length === 0,
  bad(p => p.ogType && p.ogUrl && p.ogTitle && p.ogDesc && p.ogSite === 'RoofMap' && p.ogLocale === 'en_NZ').join(' '));
check('…with og:url matching the canonical',
  bad((p, u) => p.ogUrl === SITE + u).length === 0);
check('…and a large-image Twitter card',
  bad(p => p.twCard === 'summary_large_image').length === 0);

// ── structured data ───────────────────────────────────────────────
let ldTypes = {};
for (const [url, p] of Object.entries(seen)){
  ldTypes[url] = [];
  for (const raw of p.ld){
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = 'BROKEN'; }
    if (parsed === 'BROKEN'){ ldTypes[url].push('BROKEN'); continue; }
    const nodes = parsed['@graph'] || [parsed];
    nodes.forEach(n => ldTypes[url].push(n['@type']));
  }
}
check('every structured-data block is valid JSON',
  !Object.values(ldTypes).some(t => t.includes('BROKEN')),
  Object.entries(ldTypes).filter(([, t]) => t.includes('BROKEN')).map(([u]) => u).join(' '));
check('the home page describes the software and who publishes it',
  ldTypes['/'].includes('SoftwareApplication') && ldTypes['/'].includes('Organization'),
  ldTypes['/'].join(','));
check('the pricing page carries a Product with real Offers',
  ldTypes['/pricing'].includes('Product') &&
  /"priceCurrency":\s*"NZD"/.test(seen['/pricing'].ld.join('')) &&
  /"price":\s*"149/.test(seen['/pricing'].ld.join('')), ldTypes['/pricing'].join(','));
check('the guide is an Article with an author and a review date',
  ldTypes['/guides/how-to-quote-a-re-roof'].includes('Article') &&
  /"dateModified"/.test(seen['/guides/how-to-quote-a-re-roof'].ld.join('')),
  ldTypes['/guides/how-to-quote-a-re-roof'].join(','));
const faqPages = Object.entries(ldTypes).filter(([, t]) => t.includes('FAQPage')).map(([u]) => u);
check('the pages that answer questions say so with FAQPage', faqPages.length >= 5, faqPages.join(' '));
const crumbed = Object.entries(ldTypes).filter(([u, t]) => u === '/' || t.includes('BreadcrumbList')).map(([u]) => u);
check('…and every page below the home page has breadcrumbs',
  crumbed.length === Object.keys(PAGES).length - 2,   // terms and privacy predate this and have none
  crumbed.join(' '));

// ── the honesty guard ─────────────────────────────────────────────
const everything = Object.values(seen).map(p => p.html).join('\n');
check('nothing on the site claims a rating it has not earned',
  !/aggregateRating|reviewCount|ratingValue/i.test(everything));
// A discount stated without its duration is the kind of half-sentence that
// reads as permanent and turns into an argument at month 13. Every page that
// mentions the 30% has to say how long it lasts, in the same breath.
const discountPages = Object.entries(seen).filter(([, p]) => /30\s*%|30 per cent/i.test(p.html));
const undated = discountPages.filter(([, p]) =>
  !/12\s*months|twelve months/i.test(p.html));
check('the founding discount never appears without its 12-month term',
  discountPages.length > 0 && undated.length === 0,
  undated.length ? undated.map(([u]) => u).join(' ') : discountPages.length + ' pages mention it');
check('…and every one of them says what happens afterwards',
  discountPages.every(([, p]) => /standard rate|then the standard/i.test(p.html)),
  discountPages.filter(([, p]) => !/standard rate|then the standard/i.test(p.html)).map(([u]) => u).join(' '));
check('…or a customer count',
  !/(trusted by|used by|join)\s+[\d,]+\s*(\+)?\s*(roofers|businesses|companies)/i.test(everything));

// ── robots.txt ────────────────────────────────────────────────────
const robots = await readFile(_j(DIR, 'robots.txt'), 'utf8');
check('robots.txt points at the sitemap', robots.includes('Sitemap: ' + SITE + '/sitemap.xml'));
const BOTS = ['GPTBot','OAI-SearchBot','ClaudeBot','PerplexityBot','Google-Extended','Applebot-Extended','cohere-ai'];
check('…and names every answer engine explicitly, so a blanket block is a deliberate act',
  BOTS.every(x => new RegExp('User-agent: ' + x + '\\s*\\nAllow: /').test(robots)),
  BOTS.filter(x => !new RegExp('User-agent: ' + x + '\\s*\\nAllow: /').test(robots)).join(' ') || 'all present');
check('…and keeps crawlers out of the 2.9 MB app',
  /Disallow: \/index\.html/.test(robots) && /Disallow: \/sheet-plan\.js/.test(robots));

// ── the sitemap must equal the site ───────────────────────────────
const sitemap = await readFile(_j(DIR, 'sitemap.xml'), 'utf8');
check('the sitemap uses the schema a validator expects',
  sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
const listed = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);
const expected = Object.keys(PAGES).map(u => SITE + u).sort();
const missing = expected.filter(u => !listed.includes(u));
const extra = listed.filter(u => !expected.includes(u));
check('every indexable page is in the sitemap', missing.length === 0, missing.join(' '));
check('…and nothing is in it that should not be', extra.length === 0, extra.join(' '));
check('…including the app and the signup form, which are not',
  !listed.some(u => /index\.html|\/signup/.test(u)));

// ── llms.txt ──────────────────────────────────────────────────────
const llms = await readFile(_j(DIR, 'llms.txt'), 'utf8');
check('llms.txt says what RoofMap is in its first lines', /^# RoofMap/.test(llms) && /^> /m.test(llms));
const llmsMissing = Object.keys(PAGES).filter(u => !['/terms', '/privacy'].includes(u) && !llms.includes(SITE + u));
check('…and links every page worth reading', llmsMissing.length === 0, llmsMissing.join(' '));
check('…and states plainly that there are no testimonials to quote',
  /no customer testimonials|review scores or user counts/i.test(llms));

// ── noindex where it belongs ──────────────────────────────────────
for (const [url, file] of Object.entries(NOINDEX)){
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + url, { waitUntil: 'domcontentloaded' });
  const r = await pg.evaluate(() => {
    const m = document.querySelector('meta[name="robots"]');
    return m ? m.getAttribute('content') : null;
  });
  check((url === '/index.html' ? 'the app' : 'the signup form') + ' is noindex',
    /noindex/.test(r || ''), url + ' → ' + r);
  await pg.close();
}

// ── internal links go to the real URLs ────────────────────────────
const dotHtml = [];
for (const [url, p] of Object.entries(seen)){
  p.internal.forEach(h => {
    // /index.html is the app and is meant to be linked as-is.
    if (/\.html($|[?#])/.test(h) && !h.startsWith('/index.html')) dotHtml.push(url + ' → ' + h);
  });
}
check('no internal link takes a redirect hop through a .html URL',
  dotHtml.length === 0, dotHtml.slice(0, 4).join(' , '));

const unknown = [];
for (const [url, p] of Object.entries(seen)){
  p.internal.forEach(h => {
    const clean = h.split(/[?#]/)[0];
    if (!clean || clean === '/') return;
    if (PAGES[clean] || NOINDEX[clean]) return;
    if (/^\/(brand|site\.css|legal\.css|robots\.txt|llms\.txt|sitemap\.xml)/.test(clean)) return;
    unknown.push(url + ' → ' + clean);
  });
}
check('…and every internal link points at a page that exists',
  unknown.length === 0, unknown.slice(0, 4).join(' , '));

// ── nothing fell over ─────────────────────────────────────────────
const jsErrs = Object.entries(seen).filter(([, p]) => p._errs.length);
check('no page throws a script error', jsErrs.length === 0,
  jsErrs.map(([u, p]) => u + ': ' + p._errs[0]).join(' | '));

// ── the pages are actually readable ───────────────────────────────
// A page can pass every check above and still be a stub. The guide is the
// flagship, and its whole job is to be worth quoting.
const guide = seen['/guides/how-to-quote-a-re-roof'];
check('the guide answers the question in its first block',
  /class="answer"/.test(guide.html) && /six steps/i.test(guide.html));
check('…and carries the specific numbers that get quoted',
  /1\.103/.test(guide.html) && /762/.test(guide.html) && /Colorsteel MAXAM/.test(guide.html));

// Everything under /guides and /tools is a written page, and the whole reason
// it exists is to be readable and quotable. These are the checks that a page
// is not a stub with good metadata.
const LIBRARY = Object.keys(PAGES).filter(u => /^\/(guides|tools)\//.test(u));
const noAnswer = LIBRARY.filter(u => !/class="answer"/.test(seen[u].html));
check('every guide and tool leads with an answer block', noAnswer.length === 0, noAnswer.join(' '));
const thin = LIBRARY.filter(u => (seen[u].html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length) < 4000);
check('…and none of them is a stub', thin.length === 0, thin.join(' '));
const noByline = LIBRARY.filter(u => !/class="byline"/.test(seen[u].html) || !/Last reviewed/.test(seen[u].html));
check('…and each says who wrote it and when it was last reviewed',
  noByline.length === 0, noByline.join(' '));
// A visible review date that disagrees with dateModified is worse than none:
// the page tells a person one thing and a crawler another.
const dateMismatch = LIBRARY.filter(u => {
  const m = /Last reviewed ([0-9]{1,2}) ([A-Za-z]+) ([0-9]{4})/.exec(seen[u].html);
  if (!m) return true;
  const months = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
  const mm = String(months.indexOf(m[2]) + 1).padStart(2, '0');
  const iso = m[3] + '-' + mm + '-' + String(m[1]).padStart(2, '0');
  return !new RegExp('"dateModified":\\s*"' + iso + '"').test(seen[u].ld.join(''));
});
check('…and the visible date matches the one in the markup',
  dateMismatch.length === 0, dateMismatch.join(' '));
const noArticle = LIBRARY.filter(u => !JSON.stringify(ldTypes[u]).includes('Article'));
check('…and every one of them is marked up as an Article', noArticle.length === 0, noArticle.join(' '));

// The guides index has to actually list the guides, in markup as well as in
// prose, or it is a page that exists only for a nav link.
check('the guides index is a CollectionPage with an ItemList',
  ldTypes['/guides'].includes('CollectionPage') &&
  /"@type":\s*"ItemList"/.test(seen['/guides'].ld.join('')), ldTypes['/guides'].join(','));
const indexLinks = seen['/guides'].internal.map(h => h.split(/[?#]/)[0]);
const unlisted = LIBRARY.filter(u => !indexLinks.includes(u));
check('…and links every guide and tool on the site', unlisted.length === 0, unlisted.join(' '));

// The numbers these pages will be quoted for. Getting one wrong is worse than
// not having written the page, because it will be repeated.
const pitch = seen['/guides/roof-pitch-explained'].html;
check('the pitch guide carries both multipliers, and they differ',
  /1\.103/.test(pitch) && /1\.053/.test(pitch) && /1 \/ cos/.test(pitch));
const sheets = seen['/guides/calculating-sheet-lengths'].html;
check('the sheet guide carries the cover width, not the sheet width',
  /762/.test(sheets) && /860/.test(sheets));
const grades = seen['/guides/colorsteel-grades-compared'].html;
check('the grades guide carries all four coastal zones',
  /5 km/.test(grades) && /500 m/.test(grades) && /100/.test(grades) && /25/.test(grades) &&
  /MAXAM/.test(grades) && /Zincalume/.test(grades));

// A tool page whose explanation only appears after a script runs is a tool
// page no crawler and no answer engine can read. The interactive part is a
// convenience; the page has to answer the question without it.
for (const [url, file] of Object.entries(PAGES)){
  if (!/^\/tools\//.test(url)) continue;
  const nojs = await b.newContext({ viewport: { width: 1400, height: 900 }, javaScriptEnabled: false });
  const pg = await nojs.newPage();
  await pg.goto(ORIGIN + url, { waitUntil: 'load' });
  const v = await pg.evaluate(() => ({
    words: document.body.innerText.replace(/\s+/g, ' ').trim().split(' ').length,
    tables: document.querySelectorAll('table.data').length,
    // Every output cell must already hold the answer for the default inputs.
    blanks: Array.from(document.querySelectorAll('.calc-row b'))
              .filter(el => !el.textContent.trim()).length,
    filled: Array.from(document.querySelectorAll('.calc-row b')).map(el => el.textContent.trim()),
  }));
  await nojs.close();
  check(url + ' explains itself with scripting off',
    v.words > 700 && v.tables >= 2, v.words + ' words, ' + v.tables + ' tables');
  check('…and shows its worked answer rather than empty boxes',
    v.blanks === 0 && v.filled.length >= 5, v.filled.join(' | '));
}

// …and with scripting ON, the values it computes must be the ones already in
// the markup. A default that recomputes to something different means the
// static page and the live page disagree, and one of them is wrong.
for (const [url, file] of Object.entries(PAGES)){
  if (!/^\/tools\//.test(url)) continue;
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + url, { waitUntil: 'load' });
  const before = await pg.evaluate(() =>
    Array.from(document.querySelectorAll('.calc-row b')).map(el => el.textContent.trim()));
  // Nudge the first input and put it back: that forces a full recompute.
  const after = await pg.evaluate(() => {
    const inp = document.querySelector('.calc input');
    const was = inp.value;
    inp.value = String(parseFloat(was) + 1);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = was;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return Array.from(document.querySelectorAll('.calc-row b')).map(el => el.textContent.trim());
  });
  await pg.close();
  check('…and recomputes to exactly what the HTML already said',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(before) + ' vs ' + JSON.stringify(after));
}

await ctx.close();
await b.close();
await new Promise(r => srv.close(r));
const failed = results.filter(x => !x).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
