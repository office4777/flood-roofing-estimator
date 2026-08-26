// The sign-up page exists for one reason: a button that says "Start free
// trial" should take somebody somewhere, and the form should be on screen
// when they arrive. Everything here defends that.
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

const posts = [];
let mode = 'ok';   // ok | invite | error

const TYPES = { '.html':'text/html', '.png':'image/png', '.jpg':'image/jpeg', '.css':'text/css', '.js':'text/javascript' };
const srv = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  // The app is 2.5 MB and irrelevant here — stub it, and record the hand-off.
  if (path === '/app' || path === '/app.html'){ res.writeHead(200,{'content-type':'text/html'}); return res.end('<title>app</title>'); }
  try {
    const buf = await readFile(_j(DIR, path));
    res.writeHead(200, {'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream'});
    res.end(buf);
  } catch(e){ res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const b = await chromium.launch();

async function open(page, w, h, signedIn){
  const ctx = await b.newContext({ viewport:{width:w,height:h}, isMobile:w<500, hasTouch:w<500 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request();
    if (/\/auth\/register/.test(q.url())){
      posts.push(q.postDataJSON());
      if (mode === 'invite') return r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Invite required'})});
      if (mode === 'error')  return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'A user with this email address has already been registered'})});
      return r.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({token:'tok',user:{id:'u1',email:'sam@acmeroofing.co.nz'},company:{id:'c1',name:'Acme Roofing Ltd',slug:null,role:'owner'}})});
    }
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  // An init script runs on EVERY navigation, including the hand-off to the
  // app — so clearing unconditionally would wipe the session the sign-up just
  // stored, which is the thing being checked. Clear once per context.
  if (signedIn) await pg.addInitScript(() => localStorage.setItem('fr_token','t'));
  else await pg.addInitScript(() => {
    if (!sessionStorage.getItem('__cleared')){ localStorage.clear(); sessionStorage.setItem('__cleared','1'); }
  });
  await pg.goto(`http://127.0.0.1:${PORT}/${page}`);
  await pg.waitForTimeout(800);
  return { ctx, pg };
}

// ── the whole point: the form is on screen when you arrive ──
for (const [w, h, label] of [[1360,900,'desktop'], [390,844,'a phone'], [375,667,'a small phone']]){
  const { ctx, pg } = await open('signup.html', w, h);
  const m = await pg.evaluate(() => {
    const btn = document.getElementById('suBtn').getBoundingClientRect();
    return { vh: innerHeight, bottom: Math.round(btn.bottom),
             over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             left: Math.round(document.querySelector('.card').getBoundingClientRect().left) };
  });
  check('the whole form fits on screen on ' + label + ', without scrolling',
    m.bottom <= m.vh, 'button ends at ' + m.bottom + ' of ' + m.vh);
  check('…and nothing runs off the sides',
    m.over === 0 && m.left >= 16, 'overflow ' + m.over + ', card ' + m.left + 'px from the edge');
  if (w === 1360) await pg.screenshot({ path: _j(S, 'signup_desktop.png'), fullPage: true });
  if (w === 390)  await pg.screenshot({ path: _j(S, 'signup_phone.png'), fullPage: true });
  await ctx.close();
}

// ── it is short, and it says what it needs to ──
let { ctx, pg } = await open('signup.html', 1360, 900);
let v = await pg.evaluate(() => ({
  words: (document.body.textContent||'').trim().split(/\s+/).length,
  fields: document.querySelectorAll('#suForm input:not([type=hidden])').length,
  visible: Array.from(document.querySelectorAll('#suForm input')).filter(i => i.offsetParent).length,
  title: document.title,
  fine: (document.querySelector('.fine')||{}).textContent.replace(/\s+/g,' ').trim(),
  // Every internal link, not just the .html ones — the legal pages are linked
  // by their clean URLs now.
  legal: Array.from(document.querySelectorAll('a[href^="/"]')).map(a=>a.getAttribute('href')),
  noindex: (document.querySelector('meta[name=robots]')||{}).content,
}));
check('it is a short page, not another sales pitch', v.words < 700, v.words + ' words');
check('…asking for four things', v.visible === 4, v.visible + ' visible fields');
check('…with the invite-code field kept out of the way until it is needed', v.fields === 5 && v.visible === 4);
check('…and says what you are agreeing to, next to the button',
  /By creating an account you agree/.test(v.fine) && /Terms of Service/.test(v.fine) && /Privacy Policy/.test(v.fine));
// The clean URLs, not the .html ones — those 301 now, and an internal link
// should never spend a redirect.
check('…links to both documents', v.legal.indexOf('/terms') >= 0 && v.legal.indexOf('/privacy') >= 0);
check('…and is kept out of search results, since the landing page is the front door',
  /noindex/.test(v.noindex || ''), v.noindex);

// ── validation happens here, not at the server ──
posts.length = 0;
await pg.click('#suBtn'); await pg.waitForTimeout(150);
check('an empty form is caught before it reaches the server',
  posts.length === 0 && /business and your name/.test(await pg.evaluate(()=>document.getElementById('suMsg').textContent)));
await pg.fill('#suCompany','Acme Roofing Ltd'); await pg.fill('#suName','Sam');
await pg.fill('#suEmail','not-an-email'); await pg.fill('#suPass','longenough');
await pg.click('#suBtn'); await pg.waitForTimeout(150);
check('…so is a bad email address', posts.length === 0 && /email address/.test(await pg.evaluate(()=>document.getElementById('suMsg').textContent)));
await pg.fill('#suEmail','sam@acmeroofing.co.nz'); await pg.fill('#suPass','short');
await pg.click('#suBtn'); await pg.waitForTimeout(150);
check('…and a short password', posts.length === 0 && /8 characters/.test(await pg.evaluate(()=>document.getElementById('suMsg').textContent)));
await ctx.close();

// ── invite-only says so instead of dead-ending ──
mode = 'invite'; posts.length = 0;
({ ctx, pg } = await open('signup.html', 1360, 900));
await pg.fill('#suCompany','Acme Roofing Ltd'); await pg.fill('#suName','Sam');
await pg.fill('#suEmail','sam@acmeroofing.co.nz'); await pg.fill('#suPass','longenough');
await pg.click('#suBtn'); await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ msg: document.getElementById('suMsg').textContent,
  invite: !!document.getElementById('suInviteWrap').offsetParent,
  btn: document.getElementById('suBtn').textContent, disabled: document.getElementById('suBtn').disabled }));
check('an invite-only refusal explains itself and shows the code field',
  v.invite && /invite-only/.test(v.msg), v.msg.slice(0,70));
check('…and lets them try again', !v.disabled && /Create my account/.test(v.btn));
await ctx.close();

// ── a rejection shows the server's own reason ──
mode = 'error';
({ ctx, pg } = await open('signup.html', 1360, 900));
await pg.fill('#suCompany','Acme Roofing Ltd'); await pg.fill('#suName','Sam');
await pg.fill('#suEmail','sam@acmeroofing.co.nz'); await pg.fill('#suPass','longenough');
await pg.click('#suBtn'); await pg.waitForTimeout(400);
check('a rejected signup shows the reason, not a status code',
  /already been registered/.test(await pg.evaluate(()=>document.getElementById('suMsg').textContent)));
await ctx.close();

// ── success hands straight over to the app ──
mode = 'ok'; posts.length = 0;
({ ctx, pg } = await open('signup.html', 1360, 900));
await pg.fill('#suCompany','Acme Roofing Ltd'); await pg.fill('#suName','Sam');
await pg.fill('#suEmail','sam@acmeroofing.co.nz'); await pg.fill('#suPass','longenough');
await pg.click('#suBtn'); await pg.waitForTimeout(900);
check('signing up posts the business, the person and the password',
  posts.length === 1 && posts[0].company === 'Acme Roofing Ltd' && posts[0].name === 'Sam' &&
  posts[0].email === 'sam@acmeroofing.co.nz' && !!posts[0].password,
  JSON.stringify(Object.assign({}, posts[0], { password:'***' })));
check('…then opens the app, signed in', /\/app$/.test(pg.url()), pg.url());
v = await pg.evaluate(() => ({ tok: localStorage.getItem('fr_token'), co: localStorage.getItem('fr_company') }));
check('…with the session and the business stored', v.tok === 'tok' && /Acme Roofing/.test(v.co || ''));
await ctx.close();

// ── somebody already signed in is not asked to sign up again ──
({ ctx, pg } = await open('signup.html', 1360, 900, true));
await pg.waitForTimeout(400);
check('a signed-in visitor is sent to the app instead', /\/app$/.test(pg.url()), pg.url());
await ctx.close();

// …unless they asked to LOOK at the page — the owner checking their own
// marketing must not be bounced into the app.
({ ctx, pg } = await open('signup.html?preview', 1360, 900, true));
await pg.waitForTimeout(400);
check('?preview lets a signed-in owner inspect the sign-up page',
  /signup\.html/.test(pg.url()) && await pg.evaluate(() => !!document.getElementById('suForm')), pg.url());
await ctx.close();

// ── and the landing page now points here ──
({ ctx, pg } = await open('landing.html', 390, 844));
v = await pg.evaluate(() => ({
  ctas: Array.from(new Set(Array.from(document.querySelectorAll('a.btn, a.nav-cta'))
          .map(a => a.getAttribute('href') + ' "' + a.textContent.trim() + '"'))),
  anchorCtas: Array.from(document.querySelectorAll('a.btn, a.nav-cta'))
          .filter(a => (a.getAttribute('href')||'').startsWith('#') && /trial|account|start/i.test(a.textContent)).length,
  form: !!document.getElementById('suForm'),
  screens: +(document.documentElement.scrollHeight / innerHeight).toFixed(1),
}));
check('every "start a trial" button on the landing page is a real link, not a scroll',
  v.anchorCtas === 0, JSON.stringify(v.ctas));
// Registration is invite-gated, so the landing page sends people to the
// early-access form rather than to a signup page that would refuse them.
// This page is where they land once they have a code.
check('…they all point at early access', v.ctas.some(c => c.startsWith('/early-access')));
// Two wordings by design: the full ask everywhere, and a shorter one inside
// each pricing tier where the column is narrow. Both have to be the same ask.
check('…they all ask for the same thing',
  (function(){
    const labels = Array.from(new Set(v.ctas.filter(c => c.startsWith('/early-access')).map(c => c.split('"')[1])));
    return labels.length > 0 && labels.length <= 2 && labels.every(l => /request/i.test(l) && /access/i.test(l));
  })(),
  JSON.stringify(v.ctas.filter(c => c.startsWith('/early-access'))));
check('…and the form no longer lives on the landing page too', v.form === false);
check('…which is shorter for it', v.screens < 12, v.screens + ' screens on a phone');
await ctx.close();

// ── the front door ──
// The root now serves the landing page, so a stranger typing the bare domain
// gets the pitch rather than a login screen. Everything that assumed "/" was
// the app has to have moved with it.
const { readFile: rf } = await import('node:fs/promises');
const vercel = JSON.parse(await rf(_j(DIR, 'vercel.json'), 'utf8'));
const rw = Object.fromEntries((vercel.rewrites || []).map(r => [r.source, r.destination]));
check('the site root serves the landing page, not the app',
  rw['/'] === '/landing.html', JSON.stringify(rw));
check('…and /signup, /terms and /privacy are addresses you can say out loud',
  rw['/signup'] === '/signup.html' && rw['/terms'] === '/terms.html' && rw['/privacy'] === '/privacy.html');

const manifest = JSON.parse(await rf(_j(DIR, 'manifest.webmanifest'), 'utf8'));
check('an installed RoofMap still launches the app, not the sales pitch',
  manifest.start_url === '/app', manifest.start_url);
const sw = await rf(_j(DIR, 'sw.js'), 'utf8');
const precache = (sw.match(/var PRECACHE = \[([\s\S]*?)\];/) || [])[1] || '';
check('…and the offline shell caches the app, not the landing page',
  /'\/app'/.test(precache) && !/^\s*'\/',/m.test(precache),
  precache.replace(/\/\/[^\n]*/g,'').split(',').map(x=>x.trim()).filter(Boolean).join(' '));

// A signed-in person arriving at the root is forwarded into the app by the
// landing page itself — that logic predates this change and has to still work.
({ ctx, pg } = await open('landing.html', 1360, 900, true));
await pg.waitForTimeout(500);
check('a signed-in visitor at /landing.html is offered the app rather than the pitch',
  (await pg.evaluate(() => (document.getElementById('signInLink')||{}).textContent)) === 'Open RoofMap');
await ctx.close();

await b.close(); srv.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
