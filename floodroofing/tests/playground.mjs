// The homepage playground: roofmap.co.nz/app?try=1 — the canvas for a
// stranger, with no account. Pick a picture (the practice roof's aerial, a
// photo, a PDF plan), turn it square with the rotate bar, zoom, move,
// trace the building, pick the roof type and pitch; the roof is drawn and
// every measurement and the area are blurred behind a Start-free wall.
// Measure, Add items and Calibrate are greyed out. Nothing is saved, no API
// call is made. The homepage carries it in a frame, loaded on request;
// on a phone the video and an "email me the link" box instead.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the backend: the picture without a login, the link email ─────
const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#6f8f5a"/><rect x="250" y="150" width="400" height="300" fill="#5d6970"/></svg>';
const BG = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
const db = {
  __missing: [], __fail500: '',
  profiles: [{ id: OWNER, email: 'aron@floodroofing.co.nz', name: 'Aron', company: 'Flood Roofing' }],
  jobs: [{ id: 'j-test1', user_id: OWNER, company_id: null, client_name: 'John Smith', site_address: '23 Don Buck Road', draw_state: { form: { jobNo: 'TEST-1' }, state: { img64: null }, draw: { bg: BG, bgW: 900, bgH: 600, imgView: { zoom: 1, offX: 0, offY: 0, rot: 0 }, scaleMetresPerPx: 0.03, scaleAuto: false, geoScale: null, rotation: 0 } } }],
  companies: [], company_users: [], subscriptions: [], usage_events: [], platform_state: [], waitlist: [], user_settings: [],
};
const { port } = await startFakePostgrest(db);
const sent = [];
const relay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch (e) { sent.push({ raw: b }); } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));
Object.assign(process.env, { GAS_MAIL_URL: 'http://127.0.0.1:' + relay.address().port, GAS_MAIL_TOKEN: 'tok', SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_SERVICE_KEY: 'k',
  JWT_SECRET: 'test-secret', BILLING_ENABLED: 'false', PLAN_CACHE_MS: '0', ADMIN_TOKEN: 'let-me-in-please-0000', PUBLIC_APP_URL: 'https://roofmap.co.nz', PRACTICE_JOB_OWNER: 'aron@floodroofing.co.nz' });
delete process.env.DATABASE_URL;
const PORT = process.env.TEST_PORT || '34647';
process.env.PORT = PORT;
const log = console.log, cerr = console.error; console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

let r = await fetch(BASE + '/practice/picture');
let j = await r.json().catch(() => null);
check('the practice picture is served with no login', r.status === 200 && j && j.job_no === 'TEST-1' && j.draw_state.draw.bg === BG && j.draw_state.draw.scaleMetresPerPx === 0.03, r.status + ' ' + JSON.stringify(j).slice(0, 80));
check('…and carries nothing but the picture and its scale', j && !j.draw_state.draw.outline && !j.draw_state.draw.lines && Object.keys(j).join() === 'job_no,draw_state', Object.keys(j || {}).join());
check('…while the signed-in route still wants a login', (await fetch(BASE + '/practice/job')).status === 401);
r = await fetch(BASE + '/try/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'not an address' }) });
check('a bad address is refused', r.status === 400);
r = await fetch(BASE + '/try/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Sam@Roofer.co.nz' }) });
await sleep(300);
const m = sent[0];
check('"email me the link" sends one email from support@ with the homepage playground link', r.status === 200 && m && m.to === 'sam@roofer.co.nz' && /support@roofmap\.co\.nz/.test(m.fromAddress || m.from || '') && /roofmap\.co\.nz\/#try/.test(m.text) && /computer/.test(m.text), JSON.stringify(m && { to: m.to, from: m.fromAddress || m.from, subject: m.subject }));
check('…and keeps the address as a lead', db.waitlist.length === 1 && db.waitlist[0].email === 'sam@roofer.co.nz' && db.waitlist[0].source === 'try-link', JSON.stringify(db.waitlist));

// ── the page: framed by the site, by nothing else ────────────────
const vercel = JSON.parse(readFileSync(_j(DIR, 'vercel.json'), 'utf8'));
const appH = (vercel.headers || []).find(x => x.source === '/app');
const hv = k => ((appH && appH.headers) || []).find(x => x.key === k);
check('/app may be framed by roofmap.co.nz itself and nobody else', appH && (hv('X-Frame-Options') || {}).value === 'SAMEORIGIN' && /frame-ancestors 'self'/.test((hv('Content-Security-Policy') || {}).value || ''), JSON.stringify(appH));
check('…and keeps every other header the site sets', hv('X-Content-Type-Options') && hv('Referrer-Policy') && hv('Strict-Transport-Security'));
const allH = (vercel.headers || []).find(x => x.source === '/(.*)');
check('…the rest of the site still refuses to be framed', ((allH.headers || []).find(x => x.key === 'X-Frame-Options') || {}).value === 'DENY');
check('the playground header entry comes after the catch-all, so it wins', vercel.headers.indexOf(allH) < vercel.headers.indexOf(appH));

// ── the homepage ─────────────────────────────────────────────────
const landing = readFileSync(_j(DIR, 'landing.html'), 'utf8');
check('the homepage has a Try it section straight under the opening, above the video', landing.indexOf('<section id="try"') > landing.indexOf('<div class="hero">') && landing.indexOf('<section id="try"') < landing.indexOf('<section class="demo"'));
check('…with a nav link to it', /<a href="#try">Try it<\/a>/.test(landing));
check('…that loads the app in a frame as the section comes into view, no button first', /IntersectionObserver/.test(landing) && /f\.src = '\/app\?try=1'/.test(landing) && !/<iframe[^>]*src="\/app/.test(landing) && !/id="tryOpen"/.test(landing));
check('…behind the traced-roof picture until the frame reports in, with the page as the fallback', /brand\/try-bg\.jpg/.test(landing) && /roofmap-try/.test(landing) && /id="tryOpenPage" href="\/app\?try=1"/.test(landing));
check('the practice roof stand-in is the owner\u2019s own aerial, shipped with the app at its calibrated scale', existsSync(_j(DIR, 'brand', 'practice-aerial.jpg')) && /PRACTICE_AERIAL = \{ src: 'brand\/practice-aerial\.jpg', scaleMetresPerPx: 0\.0639223 \}/.test(readFileSync(_j(DIR, 'app.html'), 'utf8')));
check('…and the chooser inside wears the same picture', /url\(\/brand\/try-bg\.jpg\)/.test(readFileSync(_j(DIR, 'app.html'), 'utf8')) && existsSync(_j(DIR, 'brand', 'try-bg.jpg')));
check('…and on a phone offers the video and an "email me the link" box instead', /max-width: 799px/.test(landing) && /id="tryLinkForm"/.test(landing) && /\/try\/link/.test(landing));
check('…and says it saves nothing and sends nothing', /saves nothing and sends nothing/.test(landing));

// ── the playground in a browser ───────────────────────────────────
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const calls = [];
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(); calls.push(r.request().method() + ' ' + u.replace(/^.*railway\.app/, ''));
  if (/\/practice\/picture/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"no"}' });
});
// An old token in the browser must not turn the playground into a session.
await pg.addInitScript(() => { localStorage.setItem('fr_token', 'stale-token'); });
await pg.goto('file://' + DIR + '/app.html?try=1');
await sleep(1200);
let v = await pg.evaluate(() => ({
  login: document.getElementById('login-screen').style.display, app: document.querySelector('.app').style.display, cls: document.documentElement.className,
  tab: document.body.getAttribute('data-tab'), chooser: !!document.getElementById('tryStart'),
  sidebar: getComputedStyle(document.querySelector('.sidebar')).display, top: getComputedStyle(document.getElementById('globalTopBar')).display,
  bgcard: getComputedStyle(document.getElementById('roofBgCard')).display,
  opts: Array.from(document.querySelectorAll('#tryStart button')).map(x => x.textContent.trim().slice(0, 18)),
  demo: !!(S.isSampleJob && S.demoKind === 'try'),
}));
check('?try=1 opens the app with no sign-in, on Map Roof, dressed down', v.login === 'none' && v.app !== 'none' && /playground/.test(v.cls) && v.tab === 'roof' && v.sidebar === 'none' && v.top === 'none' && v.bgcard === 'none', JSON.stringify(v));
check('…as a demo job that saves nothing', v.demo);
check('…with the three sources to choose from', v.chooser && v.opts.length === 3 && /Satellite/.test(v.opts[0]) && /Upload/.test(v.opts[1]) && /PDF/.test(v.opts[2]), JSON.stringify(v.opts));
check('…and no call to the API on the way in', !calls.some(c => !/practice\/picture/.test(c)), calls.join(' | '));
v = await pg.evaluate(() => ['btn-select', 'rlDropBtn', 'btn-calibrate', 'btn-outline', 'btn-move'].map(id => { const el = document.getElementById(id); return id + ':' + (el.classList.contains('try-off') ? 'off' : 'on'); }));
check('Measure, Add items and Calibrate are greyed out; Move and Building outline are not', v.join() === 'btn-select:off,rlDropBtn:off,btn-calibrate:off,btn-outline:on,btn-move:on', v.join());

await pg.evaluate(() => document.getElementById('tryPickSat').click());
await sleep(1500);
v = await pg.evaluate(() => ({ img: !!DRAW.bgImg, w: DRAW.bgImg && DRAW.bgImg.naturalWidth, scale: DRAW.scaleMetresPerPx, chooser: !!document.getElementById('tryStart'),
  menu: document.getElementById('viewMenu').style.display, slider: !!document.getElementById('fineRotateSlider') && document.getElementById('fineRotateSlider').getBoundingClientRect().width > 0,
  step: document.getElementById('stepTitle').textContent, tool: DRAW.tool }));
check('Satellite view puts the practice picture on the canvas at its scale', v.img && v.w === 900 && v.scale === 0.03 && !v.chooser, JSON.stringify(v));
check('…with the rotate bar already open, the zoom in reach, Move / Edit selected', v.menu === 'block' && v.slider && v.tool === 'select' && /Square it up/.test(v.step), JSON.stringify(v));
check('…and the picture was fetched from the public route', calls.some(c => /GET \/practice\/picture/.test(c)));

// Trace the building: four corners, Enter.
await pg.evaluate(() => { setTool('outline'); });
await sleep(200);
await pg.evaluate(() => { DRAW.currentPts = [[200, 120], [700, 120], [700, 480], [200, 480]]; redrawAll(); });
await sleep(500);
v = await pg.evaluate(() => document.getElementById('stepTitle').textContent + ' / ' + document.getElementById('stepHint').textContent);
check('tracing counts the corners and says how to finish', /Trace the building/.test(v) && /4 corners/.test(v), v);
await pg.evaluate(() => finishCurrent());
await sleep(600);
check('finishing the outline asks the roof type and pitch', await pg.evaluate(() => !!document.getElementById('_rsModal') && !!document.querySelector('#_rsTypes [data-rstype="hip"]')));
await pg.evaluate(() => document.querySelector('#_rsTypes [data-rstype="hip"]').click());
await pg.evaluate(() => { document.getElementById('_rsPitch').value = '20'; document.getElementById('_rsOk').click(); });
await sleep(1500);
v = await pg.evaluate(() => ({
  lines: DRAW.lines.length, types: Array.from(new Set(DRAW.lines.map(l => l.type))).sort().join(','), drawn: !!(window.TRY && TRY.drawn), cls: document.documentElement.className,
  wall: !!document.getElementById('tryWall'), link: (document.getElementById('tryStartFree') || {}).href || '', target: (document.getElementById('tryStartFree') || {}).target || '',
  area: document.getElementById('roofAreaVal').textContent, areaShown: getComputedStyle(document.getElementById('roofAreaBox')).display !== 'none',
  areaBlur: getComputedStyle(document.getElementById('roofAreaVal')).filter, blurred: window.__tryBlurred || 0, step: document.getElementById('stepTitle').textContent,
}));
check('the roof is drawn — ridges, hips, gutters — from the outline and the pitch', v.lines >= 6 && /hip/.test(v.types) && /ridge/.test(v.types) && /gutter/.test(v.types), JSON.stringify({ lines: v.lines, types: v.types }));
check('…and the playground calls it measured', v.drawn && /try-drawn/.test(v.cls) && /measured/.test(v.step), v.step);
check('…every measurement label is drawn through a blur', v.blurred > 4, String(v.blurred));
check('the roof-area box is on the Map Roof tab with the total, blurred here', v.areaShown && /^\d+\.\d m²$/.test(v.area) && /blur/.test(v.areaBlur), JSON.stringify({ area: v.area, blur: v.areaBlur }));
check('the wall offers Start free, opening the sign-up in the top window', v.wall && /\/signup\?from=try$/.test(v.link) && v.target === '_top', JSON.stringify({ link: v.link, target: v.target }));
check('nothing was saved or sent: no API call but the picture', !calls.some(c => !/practice\/picture/.test(c)) && !(await pg.evaluate(() => S.currentJobId)), calls.join(' | '));
check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));

// The area box in the real app: shown for a signed-in roofer too, not blurred.
const pg2 = await ctx.newPage();
await pg2.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /\/settings/.test(r.request().url()) ? '{"branding":{},"ui_flags":{"first_roof":"has-work"}}' : '[]' }));
await pg2.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_user', JSON.stringify({ email: 'me@acme.co.nz' })); localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Acme', role: 'owner', plan: 'trial' })); localStorage.setItem('fr_first_roof', 'done'); });
await pg2.goto('file://' + DIR + '/app.html');
await sleep(1200);
await pg2.evaluate(() => { gotoTab('roof'); });
v = await pg2.evaluate(() => ({ cls: document.documentElement.className, before: getComputedStyle(document.getElementById('roofAreaBox')).display }));
await pg2.evaluate(() => { DRAW.scaleMetresPerPx = 0.03; setTool('outline'); DRAW.currentPts = [[200, 120], [700, 120], [700, 480], [200, 480]]; finishCurrent(); });
await sleep(500);
await pg2.evaluate(() => { document.querySelector('#_rsTypes [data-rstype="hip"]').click(); document.getElementById('_rsPitch').value = '20'; document.getElementById('_rsOk').click(); });
await sleep(1200);
v.after = await pg2.evaluate(() => ({ shown: getComputedStyle(document.getElementById('roofAreaBox')).display !== 'none', val: document.getElementById('roofAreaVal').textContent, blur: getComputedStyle(document.getElementById('roofAreaVal')).filter }));
check('in the app the area box is hidden until there is a roof, then shows the total unblurred', !/playground/.test(v.cls) && v.before === 'none' && v.after.shown && /m²/.test(v.after.val) && !/blur/.test(v.after.blur), JSON.stringify(v));
await pg2.evaluate(() => clearAll(true));
await sleep(300);
check('…and goes away again when the drawing is cleared', await pg2.evaluate(() => getComputedStyle(document.getElementById('roofAreaBox')).display === 'none'));

await ctx.close(); await b.close(); relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
