// THE AUSTRALIAN SITE (2026-11-04). roofmap.com serves Australian versions of
// the core public pages from frontend/au/, built by tools/build-au-site.mjs
// out of the New Zealand pages; roofmap.co.nz is untouched apart from an
// hreflang pair. What this suite holds:
//   - frontend/au/ is EXACTLY what the generator makes from today's NZ pages
//     (rebuilt in memory) — nobody hand-edits it, and an NZ edit that a rule
//     no longer matches fails here instead of shipping half New Zealand;
//   - the pages speak Australian: AUD at the plan prices, no Colorsteel /
//     Marley / spouting / LINZ / RANZ / "+ GST", no link back to roofmap.co.nz
//     or to the NZ-only guides;
//   - vercel.json sends the roofmap.com host to them, ahead of the generic
//     rules, while /app and the /?q= / ?reset= / ?invite= links stay the app's
//     on both hosts;
//   - roofmap.com has its own sitemap and robots.txt;
//   - the pages render, and the sign-up form starts on Australia.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j, extname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const gen = await import(pathToFileURL(_j(_ROOT, 'tools', 'build-au-site.mjs')).href);
const { AU_PAGES, AU_SITE, NZ_SITE, AU_SITEMAP_PATH } = gen;
const read = f => readFileSync(_j(DIR, f), 'utf8');
const readAu = f => { try { return readFileSync(_j(DIR, 'au', f), 'utf8'); } catch (e) { return null; } };

// ── in sync with the generator ───────────────────────────────────────
let built = null, buildErr = null;
try { built = gen.buildAll(read); } catch (e) { buildErr = e; }
check('the generator still builds every Australian page from the NZ pages', !!built, buildErr && buildErr.message);
if (!built){ console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(1); }
check('…with no warnings (the sign-up form carries data-default-country)', built.warnings.length === 0, built.warnings.join(' | '));
const stale = Object.keys(built.au).filter(f => readAu(f) !== built.au[f]);
check('frontend/au/ is exactly what the generator makes — re-run node floodroofing/tools/build-au-site.mjs',
  stale.length === 0, stale.join(' ') || Object.keys(built.au).length + ' files');
const nzStale = Object.keys(built.nz).filter(f => read(f) !== built.nz[f]);
check('…and every NZ page with an Australian twin carries its en-NZ / en-AU hreflang pair', nzStale.length === 0, nzStale.join(' '));

const INDEXED = Object.entries(AU_PAGES).filter(([, p]) => p.index !== false);
const au = {}; for (const [path, p] of Object.entries(AU_PAGES)) au[path] = built.au[p.file];

// ── it speaks Australian ─────────────────────────────────────────────
const said = Object.entries(au).map(([path, h]) => [path, gen.auditAu(h)]).filter(([, b]) => b.length);
check('no Australian page says Colorsteel, Marley, spouting, Kiwi, LINZ, RANZ, NZD or "+ GST", or links to roofmap.co.nz or the NZ guides',
  said.length === 0, said.map(([p, b]) => p + ': ' + b.join(', ')).join(' | '));
const all = Object.values(au).join('\n');
check('…and the only roofmap.co.nz URL left on a page is its en-NZ alternate',
  (all.match(/https?:\/\/(?:www\.)?roofmap\.co\.nz/g) || []).length === (all.match(/hreflang="en-NZ" href="https:\/\/roofmap\.co\.nz/g) || []).length);
check('…and it says COLORBOND / ZINCALUME and the Lysaght profiles, with the trade-mark note beside them',
  /COLORBOND®/.test(au['/features/quotes']) && /CUSTOM ORB®/.test(au['/features/quotes']) && /BlueScope Steel Limited/.test(au['/features/quotes']) &&
  /BlueScope Steel Limited/.test(au['/']) && /BlueScope Steel Limited/.test(au['/about']));

// ── prices: AUD at the plan numbers ──────────────────────────────────
const server = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const priceRow = /NEW_PAYER_PLAN_PRICE\s*=\s*\{([^}]*)\}/.exec(server);
const price = k => priceRow ? Number((new RegExp('\\b' + k + ':\\s*(\\d+)').exec(priceRow[1]) || [])[1]) : NaN;
const P = { Measure: price('measure'), Trade: price('solo'), Team: price('team') };
check('the server prices Measure, Trade and Team at 79, 149 and 299', P.Measure === 79 && P.Trade === 149 && P.Team === 299, JSON.stringify(P));
const card = (html, name) => { const i = html.indexOf('<h3>' + name + '</h3>'); return i < 0 ? '' : html.slice(i, html.indexOf('</ul>', i)); };
for (const [path, label] of [['/', 'homepage'], ['/pricing', 'pricing page']]){
  const h = au[path];
  check('the Australian ' + label + ' sells every plan in AUD at the server\'s numbers, with no GST added',
    Object.entries(P).every(([n, v]) => card(h, n).includes('<div class="amt">A$' + v + '</div>') && /AUD per month/.test(card(h, n))),
    Object.keys(P).map(n => n + ': ' + (/<div class="amt">([^<]*)<\/div>/.exec(card(h, n)) || [])[1]).join(' '));
  check('…its structured data offers AUD only, at the same numbers',
    !/"priceCurrency":\s*"NZD"/.test(h) && Object.entries(P).every(([n, v]) => new RegExp('"name": "' + n + '", "price": "' + v + '(\\.00)?", "priceCurrency": "AUD"').test(h)));
  check('…and says the AUD prices are billed from New Zealand, GST-free for an ABN', /Prices in AUD, billed from New Zealand\. No GST for ABN-registered businesses\./.test(h));
  check('…and still sells the trial as 3 real roofs or 30 days', /3 real roofs or 30 days/.test(h));
}
check('the yearly prices are ten months of each', au['/pricing'].includes('Measure A$' + (P.Measure * 10) + ', Trade A$1,490, Team A$2,990 a year.'));

// ── the head of every indexable page ─────────────────────────────────
const meta = (h, re) => (re.exec(h) || [])[1];
const heads = INDEXED.map(([path]) => {
  const h = au[path];
  return { path,
    lang: meta(h, /<html lang="([^"]+)"/), canonical: meta(h, /<link rel="canonical" href="([^"]+)"/),
    ogUrl: meta(h, /<meta property="og:url" content="([^"]+)"/), ogLocale: meta(h, /<meta property="og:locale" content="([^"]+)"/),
    nzAlt: meta(h, /<link rel="alternate" hreflang="en-NZ" href="([^"]+)"/), auAlt: meta(h, /<link rel="alternate" hreflang="en-AU" href="([^"]+)"/),
    title: (meta(h, /<title>([^<]*)<\/title>/) || '').trim(), desc: meta(h, /<meta name="description" content="([^"]*)"/) || '',
    ld: Array.from(h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map(m => m[1]) };
});
const badHead = heads.filter(x => !(x.lang === 'en-AU' && x.canonical === AU_SITE + x.path && x.ogUrl === x.canonical &&
  x.ogLocale === 'en_AU' && x.auAlt === x.canonical && x.nzAlt === NZ_SITE + x.path));
check('every indexable Australian page is en-AU, canonical on roofmap.com, and names its NZ twin with hreflang',
  badHead.length === 0, badHead.map(x => x.path + ' ' + JSON.stringify(x).slice(0, 160)).join(' | '));
check('…with a title a search result shows whole (30–65 chars)', heads.every(x => x.title.length >= 30 && x.title.length <= 65),
  heads.filter(x => x.title.length < 30 || x.title.length > 65).map(x => x.path + '=' + x.title.length).join(' '));
check('…a description that fits too (70–160 chars)', heads.every(x => x.desc.length >= 70 && x.desc.length <= 160),
  heads.filter(x => x.desc.length < 70 || x.desc.length > 160).map(x => x.path + '=' + x.desc.length).join(' '));
check('…no two the same', new Set(heads.map(x => x.title)).size === heads.length && new Set(heads.map(x => x.desc)).size === heads.length);
const badLd = heads.filter(x => x.ld.some(s => { try { JSON.parse(s); return /roofmap\.co\.nz\//.test(s); } catch (e) { return true; } }));
check('…and structured data that parses and points at roofmap.com', badLd.length === 0, badLd.map(x => x.path).join(' '));
const nzHeads = INDEXED.filter(([path, p]) => !read(p.file).includes('<link rel="canonical" href="' + NZ_SITE + path + '">\n' + gen.hreflangBlock(path)));
check('every NZ twin keeps its own canonical, with the hreflang pair right under it', nzHeads.length === 0, nzHeads.map(([p]) => p).join(' '));
const su = au['/signup'];
check('the Australian sign-up form starts on Australia, and stays noindex',
  /<form id="suForm"[^>]*data-default-country="AU"/.test(su) && /<meta name="robots" content="noindex/.test(su));
check('…while the NZ one still starts on New Zealand', /<form id="suForm"[^>]*data-default-country="NZ"/.test(read('signup.html')));

// ── links stay on the Australian site ────────────────────────────────
const OK_PATHS = new Set([...Object.keys(AU_PAGES), '/terms', '/privacy', '/security', '/app']);
const strays = [];
for (const [path, h] of Object.entries(au)){
  for (const m of h.matchAll(/\bhref="([^"]*)"/g)){
    const href = m[1];
    if (/^(https?:)?\/\//.test(href) || /^(mailto|tel):|^#/.test(href)) continue;
    const clean = href.split(/[?#]/)[0];
    if (!clean.startsWith('/')) { if (/^brand\//.test(clean)) continue; strays.push(path + ' → ' + href); continue; }
    if (OK_PATHS.has(clean) || /^\/(brand|media)\/|^\/site\.css$/.test(clean)) continue;
    strays.push(path + ' → ' + href);
  }
}
check('every internal link on an Australian page goes to an Australian page, the shared legal pages, the app or an asset',
  strays.length === 0, strays.slice(0, 6).join(' , '));
const leaving = Object.entries(au).flatMap(([p, h]) => Array.from(h.matchAll(/<a\b[^>]*\bhref="(https?:\/\/(?:www\.)?roofmap\.[^"]*)"/g))
  .map(m => [p, m[1]])).filter(([, u]) => !u.startsWith(AU_SITE + '/'));
check('…and no link on an Australian page leaves roofmap.com for another RoofMap site', leaving.length === 0, leaving.map(x => x.join(' → ')).slice(0, 4).join(' , '));

// ── vercel.json: roofmap.com is routed to them ───────────────────────
const cfg = JSON.parse(read('vercel.json'));
const rw = cfg.rewrites || [];
const isAuHost = r => (r.has || []).some(h => h.type === 'host' && h.value === 'roofmap.com');
const routeBad = [];
for (const [path, p] of Object.entries(AU_PAGES)){
  const i = rw.findIndex(r => r.source === path && isAuHost(r));
  const g = rw.findIndex(r => r.source === path && !r.has);
  if (i < 0 || rw[i].destination !== '/au/' + p.file) routeBad.push(path + ' has no roofmap.com rewrite to /au/' + p.file);
  else if (g < 0 || i > g) routeBad.push(path + ' rewrite is not ahead of the generic one');
  if (!existsSync(_j(DIR, 'au', p.file))) routeBad.push('au/' + p.file + ' missing');
}
check('vercel.json sends each roofmap.com page to its au/ file, ahead of the NZ rule for the same path', routeBad.length === 0, routeBad.join(' | '));
const auRoot = rw.findIndex(r => r.source === '/' && isAuHost(r));
const qIdx = ['q', 'reset', 'invite'].map(k => rw.findIndex(r => r.source === '/' && (r.has || []).some(h => h.type === 'query' && h.key === k)));
check('…but a quote link, a reset link and an invite on roofmap.com still open the app (those rules come first)',
  qIdx.every(i => i >= 0 && i < auRoot && rw[i].destination === '/app.html'), qIdx.join(',') + ' vs ' + auRoot);
const appRw = rw.filter(r => r.source === '/app');
check('…and /app is the app on both hosts (one rule, no host condition)',
  appRw.length === 1 && !appRw[0].has && appRw[0].destination === '/app.html', JSON.stringify(appRw));
check('…and the shared legal pages are not given a host rule (one NZ copy for both)',
  ['/terms', '/privacy', '/security'].every(s => rw.filter(r => r.source === s).length === 1 && !rw.find(r => r.source === s).has));
const rd = cfg.redirects || [];
const robotsRd = rd.find(r => r.source === '/robots.txt' && isAuHost(r));
const smRd = rd.find(r => r.source === '/sitemap.xml' && isAuHost(r));
const smRw = rw.find(r => r.source === AU_SITEMAP_PATH && isAuHost(r));
// robots.txt and sitemap.xml exist as files, and Vercel serves a file before
// any rewrite — so the host is sent elsewhere with a redirect, which runs first.
check('roofmap.com\'s /robots.txt and /sitemap.xml are redirected to its own (files outrank rewrites)',
  robotsRd && robotsRd.destination === '/au/robots.txt' && robotsRd.permanent === false &&
  smRd && smRd.destination === AU_SITEMAP_PATH && smRw && smRw.destination === '/au/sitemap.xml');
check('…and roofmap.com is the only host given a rule', [...rw, ...rd].every(r => !(r.has || []).some(h => h.type === 'host') || isAuHost(r)));

// ── the sitemap and robots.txt ───────────────────────────────────────
const sm = readAu('sitemap.xml') || '';
const locs = Array.from(sm.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);
const want = INDEXED.map(([p]) => AU_SITE + p).sort();
check('au/sitemap.xml lists every indexable Australian page, on roofmap.com, and nothing else',
  JSON.stringify([...locs].sort()) === JSON.stringify(want) && locs.every(u => u.startsWith(AU_SITE + '/')), locs.length + ' listed');
const nzSm = read('sitemap.xml');
const dateOf = (xml, loc) => (new RegExp('<loc>' + loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</loc>\\s*<lastmod>([^<]+)</lastmod>').exec(xml) || [])[1];
check('…each dated as its NZ twin is', INDEXED.every(([p]) => dateOf(sm, AU_SITE + p) && dateOf(sm, AU_SITE + p) === dateOf(nzSm, NZ_SITE + p)));
const robots = readAu('robots.txt') || '';
check('au/robots.txt points at the Australian sitemap and keeps the app out',
  robots.includes('Sitemap: ' + AU_SITE + AU_SITEMAP_PATH) && !/roofmap\.co\.nz/.test(robots.replace(/^# GENERATED.*$/m, '')) &&
  /Disallow: \/app/.test(robots) && /Disallow: \/signup/.test(robots));

// ── they render ──────────────────────────────────────────────────────
const TYPES = { '.html':'text/html', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.js':'text/javascript', '.svg':'image/svg+xml', '.mp4':'video/mp4' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/app' || p === '/app.html'){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>app</title>'); }
  if (AU_PAGES[p]) p = '/au/' + AU_PAGES[p].file;
  try { const b = readFileSync(_j(DIR, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch (e) { res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
// Nothing leaves the machine: the API, the CDN, the video.
await ctx.route(/^(?!http:\/\/127\.0\.0\.1)/, r => r.abort());
const renderBad = [];
for (const path of Object.keys(AU_PAGES)){
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(ORIGIN + path, { waitUntil: 'load' });
  const v = await pg.evaluate(() => ({ h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  if (errs.length || v.h1 !== 1 || v.lang !== 'en-AU' || v.over > 0) renderBad.push(path + ' ' + JSON.stringify(v) + ' ' + errs.join(';'));
  await pg.close();
}
check('every Australian page renders: no script error, one h1, en-AU, no sideways scroll', renderBad.length === 0, renderBad.join(' | '));
{
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + '/signup', { waitUntil: 'load' });
  const v = await pg.evaluate(() => {
    const sel = document.getElementById('suCountry');
    const radio = document.querySelector('input[name=country]:checked');
    return { country: sel ? sel.value : (radio ? radio.value : null), email: document.getElementById('suEmail').placeholder };
  });
  check('the Australian sign-up form opens with Australia picked and an Australian example address', v.country === 'AU' && /\.com\.au$/.test(v.email), JSON.stringify(v));
  await pg.close();
}
for (const path of Object.keys(AU_PAGES).filter(p => /^\/tools\//.test(p))){
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + path, { waitUntil: 'load' });
  const same = await pg.evaluate(() => {
    const read = () => Array.from(document.querySelectorAll('.calc-row b')).map(e => e.textContent.trim());
    const before = read(), inp = document.querySelector('.calc input'), was = inp.value;
    inp.value = String(parseFloat(was) + 1); inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = was; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return before.length >= 5 && JSON.stringify(before) === JSON.stringify(read());
  });
  check(path + ' (Australian) still recomputes to what its HTML says', same);
  await pg.close();
}
await ctx.close(); await b.close(); await new Promise(r => srv.close(r));

const failed = results.filter(x => !x).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
