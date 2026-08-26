// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const posts = [];
let mode = 'ok';   // ok | invite | error

// Served over HTTP, not file://, so localStorage survives the hand-off into
// the app — which is the whole point of the last step of signing up.
// .css matters: a browser will not apply a stylesheet served as
// application/octet-stream, so a missing entry here renders the page naked
// and fails the layout checks for a reason that has nothing to do with the
// page. signup.mjs and legal.mjs already carry it.
const TYPES = { '.html':'text/html', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg',
                '.svg':'image/svg+xml', '.ico':'image/x-icon', '.js':'text/javascript',
                '.webmanifest':'application/manifest+json', '.txt':'text/plain', '.xml':'application/xml' };
const srv = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  // The app itself is 2.5 MB and irrelevant here — stub it, and record that we
  // were handed over to it.
  if (path === '/index.html' || path === '/app'){
    res.writeHead(200, {'Content-Type':'text/html'});
    return res.end('<!doctype html><title>App</title><body>APP STUB</body>');
  }
  try {
    const file = await readFile(DIR + (path === '/' ? '/landing.html' : path));
    res.writeHead(200, {'Content-Type': path === '/' ? 'text/html' : (TYPES[extname(path)] || 'application/octet-stream')});
    res.end(file);
  } catch(e){ res.writeHead(404); res.end('nope'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port;
async function open(w, h, opts){
  const ctx = await b.newContext(Object.assign({ viewport:{width:w,height:h} }, opts||{}));
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request();
    posts.push(q.postDataJSON());
    if (mode === 'invite') return r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Registration is invite-only — contact Flood Roofing for access.'})});
    if (mode === 'error')  return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'A user with this email address has already been registered'})});
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      token:'tok', user:{id:'u1',email:'sam@acmeroofing.co.nz',name:'Sam'},
      company:{id:'c1',name:'Acme Roofing Ltd',slug:null,role:'owner'} })});
  });
  await pg.goto(ORIGIN + ((opts && opts.at) || '/landing.html'));
  await pg.waitForTimeout(700);
  return { ctx, pg };
}

// ── it renders, and says what the product is ──
let { ctx, pg } = await open(1440, 1000);
let v = await pg.evaluate(() => ({
  title: document.title,
  h1: (document.querySelector('h1')||{}).textContent,
  desc: (document.querySelector('meta[name=description]')||{}).content,
  imgs: Array.from(document.images).map(i => i.getAttribute('src')),
  broken: Array.from(document.images).filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
  h2s: Array.from(document.querySelectorAll('h2')).map(x => x.textContent.trim()),
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  body: document.body.innerText.replace(/\s+/g, ' '),
}));
check('the page loads with a real title and description', /RoofMap/.test(v.title) && (v.desc||'').length > 60, v.title);
check('the headline says what it does', /One drawing/.test(v.h1||''), v.h1);
// The page sells three specific things a roofing business loses money on, and
// it used to sell speed instead. This is the guard against drifting back to a
// feature list: each of the three has to be NAMED, not implied.
const PAINS = [
  ['the crew gets a readable plan', /crew can (actually )?read|hand-drawn maps/i],
  ['the order goes with one button', /one button/i],
  ['the customer changes it themselves', /changes their own|change the options themselves|customer changes it/i],
];
const missing = PAINS.filter(([, re]) => !re.test(v.body || '')).map(([n]) => n);
check('…and the page names all three things it is actually for',
  missing.length === 0, missing.join(' | '));
check('every image resolves — no broken brand assets', v.broken.length === 0, JSON.stringify(v.broken));
check('the hero uses the real roof photo', v.imgs.some(s => /roof_aerial_multipitch/.test(s)), JSON.stringify(v.imgs));
check('it covers how it works, what it does, who built it and pricing',
  v.h2s.length >= 4, JSON.stringify(v.h2s));
check('nothing scrolls sideways on desktop', !v.wide);

// ── the onsite app and the tiers ──
const extra = await pg.evaluate(() => {
  const t = (document.body.textContent||'').replace(/\s+/g,' ');
  const tiers = Array.from(document.querySelectorAll('.tier')).map(x => ({
    name: (x.querySelector('h3')||{}).textContent,
    amt: (x.querySelector('.amt')||{}).textContent,
    per: (x.querySelector('.per')||{}).textContent,
    pick: x.classList.contains('pick'),
  }));
  return { t, tiers, phoneShot: !!document.querySelector('.phone img'),
    phoneOk: (function(){ const i = document.querySelector('.phone img'); return !!i && i.complete && i.naturalWidth > 0; })() };
});
check('the onsite measuring app gets a section of its own',
  /goes up the ladder with you/.test(extra.t), 'onsite headline');
check('…with a real screenshot of the app, not an illustration',
  extra.phoneShot && extra.phoneOk);
check('…and covers what actually matters on a roof',
  /gloves on/i.test(extra.t) && /Lock the screen/i.test(extra.t) && /No signal/i.test(extra.t));
check('there are three pricing tiers', extra.tiers.length === 3, JSON.stringify(extra.tiers.map(x=>x.name)));
check('…each with a price and what you get for it',
  extra.tiers.every(x => /^\$\d/.test(x.amt||'') && /per month/.test(x.per||'')),
  JSON.stringify(extra.tiers.map(x=>x.amt+' '+x.per)));
check('…one is picked out as the usual choice',
  extra.tiers.filter(x=>x.pick).length === 1, JSON.stringify(extra.tiers.map(x=>x.pick)));
check('…and prices are shown ex GST, as a trade customer expects',
  /\+ GST/.test(extra.t));
await pg.screenshot({ path: S+'/landing_top.png' });
await pg.locator('.onsite').screenshot({ path: S+'/landing_onsite.png' });
await pg.locator('#pricing').screenshot({ path: S+'/landing_pricing.png' });
await pg.screenshot({ path: S+'/landing_full.png', fullPage: true });

// ── the page's job is to send people to the sign-up page ──
// The form itself moved to signup.html and is covered by signup.mjs. What
// matters here is that every button that offers a trial is a real link to it
// rather than an anchor that scrolls ten screens on a phone.
v = await pg.evaluate(() => {
  const ctas = Array.from(document.querySelectorAll('a.btn, a.nav-cta'));
  return {
    hrefs: Array.from(new Set(ctas.map(a => a.getAttribute('href')))),
    labels: Array.from(new Set(ctas.filter(a => (a.getAttribute('href')||'') === '/early-access')
                                   .map(a => a.textContent.trim()))),
    scrollers: ctas.filter(a => (a.getAttribute('href')||'').startsWith('#') &&
                                /trial|sign ?up|account|access/i.test(a.textContent)).length,
    toSignup: ctas.filter(a => (a.getAttribute('href')||'') === '/early-access').length,
    form: !!document.getElementById('suForm'),
  };
});
// Registration is invite-gated, so every conversion button goes to the
// early-access form. A button saying "start free trial" that lands on a signup
// page which then refuses you is worse than no button.
check('every conversion button leads to early access',
  v.toSignup >= 4 && v.scrollers === 0, v.toSignup + ' links, ' + v.scrollers + ' scrollers');
// Two wordings, deliberately: the full ask everywhere, and the shorter
// "Request access" inside each pricing tier where the column is narrow.
check('…all asking for the same thing',
  v.labels.length <= 2 && v.labels.every(l => /request/i.test(l) && /access/i.test(l)),
  JSON.stringify(v.labels));
check('…and the form is not duplicated here', v.form === false);
check('…with only the "see how it works" jump left as an anchor',
  v.hrefs.filter(h => (h||'').startsWith('#')).length <= 1, JSON.stringify(v.hrefs));
await ctx.close();

// ── an existing session is offered the app, not the sales pitch ──
({ ctx, pg } = await open(1440, 900));
await pg.evaluate(() => localStorage.setItem('fr_token','already'));
await pg.reload(); await pg.waitForTimeout(600);
check('a signed-in visitor is offered "Open RoofMap" instead of "Sign in"',
  (await pg.evaluate(() => document.getElementById('signInLink').textContent)) === 'Open RoofMap');
check('…and is not dragged away from /landing.html while it is being worked on',
  /landing\.html/.test(pg.url()), pg.url());
// …but at the site root, which is where it will live, they go straight in
await pg.goto(ORIGIN + '/');
await pg.waitForURL(/\/app$/, { timeout: 5000 }).catch(()=>{});
check('at the site root, a signed-in visitor skips the pitch and opens the app',
  /\/app$/.test(pg.url()), pg.url());
await ctx.close();

// ── phone ──
({ ctx, pg } = await open(390, 844, { isMobile:true, hasTouch:true }));
v = await pg.evaluate(() => ({
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  ctaVisible: !!document.querySelector('.hero-cta a'),
  ctaHref: (document.querySelector('.hero-cta a')||{}).getAttribute
             ? document.querySelector('.hero-cta a').getAttribute('href') : null,
  screens: +(document.documentElement.scrollHeight / innerHeight).toFixed(1),
}));
check('the phone layout does not scroll sideways', !v.wide, 'overflow ' + v.overflow + 'px');
check('…and leads with a call to action that goes somewhere',
  v.ctaVisible && v.ctaHref === '/early-access', v.ctaHref);
check('…on a page that is shorter now the form has its own', v.screens < 12, v.screens + ' screens');
await pg.screenshot({ path: S+'/landing_phone.png', fullPage: true });
await ctx.close();

await b.close();
srv.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
