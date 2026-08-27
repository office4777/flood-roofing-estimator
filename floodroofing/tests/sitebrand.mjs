// The marketing header, at the widths a roofer actually holds.
//
// "roof map logo and name seem very small?" — the lockup was 38px mark and a
// 20px wordmark against 15px nav links, only 1.33x the links beside it, which
// is thin for the one element on the page that says whose product this is.
//
// The reason this is its own suite rather than an assertion bolted onto
// seo.mjs: the marketing pages link the stylesheet as an ABSOLUTE /site.css,
// so a file:// load resolves it to the filesystem root, silently gets nothing,
// and every measurement comes back as unstyled defaults that look plausible
// and mean nothing. The pages have to be served.
//
// What this is really guarding is the small phone. Going one step further than
// 44/24 — to 52/28 — overflows the header horizontally at 320px, which is a
// real Android width, and nothing else in the suite would have caught it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j, extname } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const TYPES = { '.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg',
                '.js':'text/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const ROUTES = { '/': 'landing.html', '/pricing': 'pricing.html', '/guides': 'guides.html' };
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (ROUTES[p]) p = '/' + ROUTES[p];
  try {
    const f = await readFile(DIR + p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port;

const b = await chromium.launch();
async function look(path, w){
  const ctx = await b.newContext({ viewport:{ width:w, height:820 } });
  const pg = await ctx.newPage();
  await pg.goto(ORIGIN + path, { waitUntil:'load' });
  await pg.waitForTimeout(250);
  const v = await pg.evaluate(() => {
    const img = document.querySelector('header .brand img');
    const span = document.querySelector('header .brand span');
    const cta = document.querySelector('header .nav-cta');
    const foot = document.querySelector('footer .brand img');
    const footSpan = document.querySelector('footer .brand span');
    const r = e => e ? e.getBoundingClientRect() : null;
    const ib = r(img), sb = r(span), cb = r(cta), brand = r(document.querySelector('header .brand'));
    return {
      mark: ib ? Math.round(ib.width) : null,
      word: span ? parseFloat(getComputedStyle(span).fontSize) : null,
      navLink: (function(){ const a = document.querySelector('header .nav-links a:not(.nav-cta)');
                            return a ? parseFloat(getComputedStyle(a).fontSize) : null; })(),
      // The check that matters on a small phone.
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      clearOfCta: (cb && brand) ? Math.round(cb.left - brand.right) : null,
      footMark: foot ? Math.round(foot.getBoundingClientRect().width) : null,
      footWord: footSpan ? parseFloat(getComputedStyle(footSpan).fontSize) : null,
    };
  });
  await ctx.close();
  return v;
}

// ── the lockup is the size it is meant to be ──────────────────────
let v = await look('/pricing', 1440);
check('the brand mark is the bigger 44px', v.mark === 44, v.mark + 'px');
check('…and the wordmark 24px', v.word === 24, v.word + 'px');
// The point of the change: it has to out-weigh the links beside it clearly.
check('…so the brand clearly out-weighs the nav links beside it',
  v.navLink && v.word / v.navLink >= 1.5,
  v.word + 'px brand vs ' + v.navLink + 'px links = ' + (v.word / v.navLink).toFixed(2) + 'x');

// ── the small phone, which is what caps the size ───────────────────
for (const w of [320, 360, 390]){
  for (const path of ['/', '/pricing']){
    const g = await look(path, w);
    check('the header does not overflow at ' + w + 'px on ' + path,
      !g.overflow, g.scrollW + 'px of content in ' + g.innerW + 'px');
    check('…and the brand still clears the Early access pill',
      g.clearOfCta === null || g.clearOfCta >= 0,
      g.clearOfCta === null ? 'no pill' : g.clearOfCta + 'px clear');
  }
}

// ── the footer lockup is a different, smaller thing ────────────────
// It re-uses .brand and stays small through its own inline width/font-size.
// Bumping the header must not have dragged it up with it.
v = await look('/', 1440);
check('the footer lockup is still the small one',
  v.footMark === 28 && v.footWord === 16,
  v.footMark + 'px mark / ' + v.footWord + 'px word');

await b.close();
srv.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
