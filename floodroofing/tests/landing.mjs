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
const TYPES = { '.html':'text/html', '.png':'image/png', '.jpg':'image/jpeg', '.js':'text/javascript', '.webmanifest':'application/manifest+json' };
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
}));
check('the page loads with a real title and description', /RoofMap/.test(v.title) && (v.desc||'').length > 60, v.title);
check('the headline says what it does', /Quote a re-roof/.test(v.h1||''), v.h1);
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

// ── the signup form validates before it bothers the server ──
const before = posts.length;
await pg.click('#suBtn');
await pg.waitForTimeout(250);
check('an empty form is caught here, not at the server',
  posts.length === before && /business and your name/.test(await pg.evaluate(() => document.getElementById('suMsg').textContent)));
await pg.fill('#suCompany','Acme Roofing Ltd'); await pg.fill('#suName','Sam');
await pg.fill('#suEmail','not-an-email'); await pg.fill('#suPass','abcdefgh');
await pg.click('#suBtn'); await pg.waitForTimeout(250);
check('…so is a bad email address',
  posts.length === before && /email address/.test(await pg.evaluate(() => document.getElementById('suMsg').textContent)));
await pg.fill('#suEmail','sam@acmeroofing.co.nz'); await pg.fill('#suPass','short');
await pg.click('#suBtn'); await pg.waitForTimeout(250);
check('…and a short password',
  posts.length === before && /8 characters/.test(await pg.evaluate(() => document.getElementById('suMsg').textContent)));

// ── invite-gated backend gets a useful answer, not a dead end ──
mode = 'invite';
await pg.fill('#suPass','a-good-password');
await pg.click('#suBtn'); await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({
  msg: document.getElementById('suMsg').textContent,
  inviteShown: getComputedStyle(document.getElementById('suInviteWrap')).display !== 'none',
  btnBack: !document.getElementById('suBtn').disabled }));
check('when registration is invite-only it says so and asks for the code',
  v.inviteShown && /invite-only/.test(v.msg) && /office@floodroofing/.test(v.msg), JSON.stringify(v));
check('…and the button comes back so they can try again', v.btnBack);

// ── a real server error is shown in the server's own words ──
mode = 'error';
await pg.click('#suBtn'); await pg.waitForTimeout(600);
check('a rejected signup shows the reason',
  /already been registered/.test(await pg.evaluate(() => document.getElementById('suMsg').textContent)),
  await pg.evaluate(() => document.getElementById('suMsg').textContent));

// ── the happy path ──
mode = 'ok';
await pg.click('#suBtn');
await pg.waitForURL(/index\.html/, { timeout: 5000 }).catch(()=>{});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  tok: localStorage.getItem('fr_token'),
  co: localStorage.getItem('fr_company'),
  url: location.pathname }));
const sent = posts[posts.length-1] || {};
check('a successful signup hands straight over to the app', /index\.html/.test(v.url), v.url);
check('signing up posts the business, name, email and password',
  sent.company === 'Acme Roofing Ltd' && sent.name === 'Sam' && sent.email === 'sam@acmeroofing.co.nz' && !!sent.password,
  JSON.stringify(Object.assign({}, sent, {password:'***'})));
check('…with the session and business stored, so the app opens signed in',
  v.tok === 'tok' && /Acme Roofing/.test(v.co||''), JSON.stringify({tok:v.tok, co:v.co}));
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
await pg.waitForURL(/index\.html/, { timeout: 5000 }).catch(()=>{});
check('at the site root, a signed-in visitor skips the pitch and opens the app',
  /index\.html/.test(pg.url()), pg.url());
await ctx.close();

// ── phone ──
({ ctx, pg } = await open(390, 844, { isMobile:true, hasTouch:true }));
v = await pg.evaluate(() => ({
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  ctaVisible: !!document.querySelector('.hero-cta a'),
  formVisible: !!document.getElementById('suForm'),
}));
check('the phone layout does not scroll sideways', !v.wide, 'overflow ' + v.overflow + 'px');
check('…and still leads with a call to action and carries the form', v.ctaVisible && v.formVisible);
await pg.screenshot({ path: S+'/landing_phone.png', fullPage: true });
await ctx.close();

await b.close();
srv.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
