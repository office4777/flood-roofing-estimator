// THE CREW APP, on a phone (2026-11-13). The real crew.html against the real
// server (fakepgrst), on a phone-sized screen with its clock set to a working
// day: the day's job off the schedule, location asked for and kept on a
// booked day, the job's details (Maps, call, choices, scope, checklist), a
// clock-on that teaches the site, a press made with NO SIGNAL kept on the
// phone and sent when signal comes back, a photo uploaded to the job, the
// hours — and on a day the crew is not booked, no location asked for at all.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const crewLib = require('./crew.js');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const HOL = ['2026-10-26', '2026-12-25', '2026-12-28', '2027-01-01', '2027-01-04'];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
function weekdayBack(fromMs){ for (let t = fromMs; ; t -= 86400000) { const w = new Date(t).getUTCDay(); if (w > 0 && w < 6 && !HOL.includes(iso(t))) return iso(t); } }
const D = weekdayBack(Date.now() - 3 * 86400000);
const D2 = weekdayBack(Date.parse(D + 'T00:00:00Z') - 86400000);
function nzAt(date, h, m){
  for (const off of [13, 12]) { const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - off, m || 0);
    const p = crewLib.nzParts(new Date(t)); if (p.date === date && p.hour === h) return t; }
  throw new Error('no NZ time');
}

// The site: crew.html on a real origin, and the storage the photos go to.
const FRONT = _j(_ROOT, 'frontend');
const store = new Map();
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/store/')) {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { if (req.method === 'PUT') { store.set(decodeURIComponent(u.pathname.slice(7)), { buf: Buffer.concat(chunks), mime: req.headers['content-type'] }); res.writeHead(200); return res.end('{}'); }
      // GET: what was put there, else a little picture (the fixture's photos and roof map)
      const got = store.get(decodeURIComponent(u.pathname.slice(7)));
      res.writeHead(200, { 'content-type': got ? got.mime : 'image/png', 'access-control-allow-origin': '*' });
      res.end(got ? got.buf : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); });
    return;
  }
  const name = u.pathname === '/crew' ? 'crew.html' : u.pathname.replace(/^\/+/, '');
  const file = _j(FRONT, name);
  if (!file.startsWith(FRONT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': /\.html$/.test(name) ? 'text/html' : (/\.png$/.test(name) ? 'image/png' : 'text/plain') });
  res.end(fs.readFileSync(file));
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + site.address().port;
globalThis.__TEST_JOBFILES_STORAGE = { bucket: 't', maxBytes: 50 << 20, async ensureBucket(){ return true; },
  async signUpload(path){ return { signedUrl: ORIGIN + '/store/' + encodeURIComponent(path), token: 't', path }; },
  async signedUrl(path){ return ORIGIN + '/store/' + encodeURIComponent(path); }, async remove(){} };

const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing Ltd', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'aron@floodroofing.co.nz', name: 'Aron' }, { id: 'u3', company_id: 'c1', email: 'nick@floodroofing.co.nz', name: 'Nick Example' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c1', user_id: 'u3', role: 'member' } ],
  user_settings: [ { user_id: 'u1', company_id: 'c1', updated_at: '2026-11-01T00:00:00Z', schedule_cfg: { feed_secret: 'x',
    crews: [ { id: 'crew1', name: 'Crew 1', colour: '#f87d20' }, { id: 'crew2', name: 'Crew 2', colour: '#22c55e' } ] },
    branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz' },
    price_book: { __materials_catalog: { savedFlashings: [ { name: 'My Barge', profile: 'Corrugate', polylines: [{ vertices: [[0, 0], [0, 100], [200, 100], [200, 80]], measurements: { 0: 100, 1: 200, 2: 20 } }],
      paintedSide: { x: 100, y: 100, dirX: 0, dirY: -1 } } ], suppliers: [ { name: 'Roofing Industries', email: 'orders@ri.example', category: 'roofing' } ] } } } ],
  jobs: [ { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', version_of: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', draw_state: { form: { jobPhone: '021 555 0101' }, state: { quote: {
      ref: '3351', proposalOptions: { steelGrade: 'maxam', profile: 'corrugate', colour: 'Ironsand' }, custDesc: ['Strip the old roof and take it away', 'Install New {grade} Roofing Sheets'], custExcl: ['Spouting'],
      inclExtras: [ { id: 'x1', name: 'Leaf Diverters', price: 782 } ],
      crewHours: { items: [ { label: 'Main Roof', guys: 2, total: 50 }, { label: 'Scaffolding (own crew)', guys: 2, total: 8 } ] } } } } } ],
  job_files: [ { id: 'f1', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Job Pack 3351.pdf', mime: 'application/pdf', size: 1000, kind: 'export', source: 'job-pack', author: 'office', status: 'ready', storage_path: 'p', created_at: '2026-11-03T00:00:00Z' },
    { id: 'f2', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Sent - Quote 3351 - Roofing.pdf', mime: 'application/pdf', size: 1000, kind: 'export', source: 'sent-quote', author: 'office', status: 'ready', storage_path: 'q', created_at: '2026-11-03T00:00:00Z' },
    { id: 'f3', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Order_-_SO_H042880.pdf', mime: 'application/pdf', size: 1000, kind: 'upload', source: 'upload', author: 'office', status: 'ready', storage_path: 'o', created_at: '2026-11-03T00:00:00Z' },
    { id: 'f4', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Roof map Job 3351.jpg', mime: 'image/jpeg', size: 1000, kind: 'export', source: 'roof-map-auto', author: 'office', status: 'ready', storage_path: 'map', created_at: '2026-11-03T00:00:00Z' },
    { id: 'f5', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Site photo 1.png', mime: 'image/png', size: 1000, kind: 'upload', source: 'site', author: 'office', status: 'ready', storage_path: 'ph1', created_at: '2026-11-03T00:00:00Z' } ],
  schedule_rows: [ { id: 'r1', company_id: 'c1', user_id: 'u1', job_id: 'j1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', email: '', length_days: 1, notes: 'Key under the mat', archived: false, job_ref: '', created_at: '2026-11-01T00:00:00Z' } ],
  schedule_blocks: [ { id: 'b1', company_id: 'c1', user_id: 'u1', row_id: 'r1', kind: 'crew', crew_id: 'crew1', start_date: D, work_days: 1, created_at: '2026-11-01T00:00:00Z' } ],
  crew_members: [ { id: 'm1', company_id: 'c1', user_id: 'u3', crew_id: 'crew1', name: '', phone: '', updated_at: '2026-11-01T00:00:00Z' } ],
  crew_events: [], crew_points: [], crew_sites: [], crew_flash_orders: [],
  crew_settings: [ { id: 's1', company_id: 'c1', user_id: 'u1', updated_at: '2026-11-01T00:00:00Z', data: { clockMode: 'button', clockModeSet: true, checklists: [ { id: 'start', name: 'Before we start', when: 'start', items: ['Scaffold tagged', 'Edge protection up'] } ] } } ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
process.env.FRONTEND_URL = ORIGIN;
delete process.env.CREW_USERS; delete process.env.CREW_ALL; delete process.env.SUPINV_USERS;
const PORT = process.env.TEST_PORT || '35131';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await wait(700);
const API = 'http://127.0.0.1:' + PORT;
const TOKEN = jwt.sign({ id: 'u3', email: 'nick@floodroofing.co.nz', cid: 'c1' }, 'test-secret');

const SITE_LAT = -35.2269, SITE_LNG = 173.9481;
const b = await chromium.launch();
async function phone(atMs){
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: SITE_LAT, longitude: SITE_LNG, accuracy: 9 } });
  await ctx.clock.setFixedTime(new Date(atMs));
  await ctx.addInitScript(([api, tok]) => { window.CREW_API = api; if (tok && !localStorage.getItem('crew_signed_out')) localStorage.setItem('crew_token', tok); }, [API, TOKEN]);
  const pg = await ctx.newPage();
  pg.__errs = []; pg.on('pageerror', e => pg.__errs.push(e.message)); pg.on('dialog', d => d.accept());
  return { ctx, pg };
}

// ── not signed in ──
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((api) => { window.CREW_API = api; }, API);
  const pg = await ctx.newPage(); await pg.goto(ORIGIN + '/crew'); await wait(300);
  check('signed out, the app asks for the RoofMap login', await pg.locator('#em').count() === 1 && /Sign in with your RoofMap login/.test(await pg.textContent('body')));
  await ctx.close();
}

// ── a booked day, 10 am ──
const { ctx, pg } = await phone(nzAt(D, 10));
await pg.goto(ORIGIN + '/crew'); await wait(1500);
let body = await pg.textContent('#main');
check('Today shows his crew’s job off the schedule', /Arran Simpson/.test(body) && /12 Kauri Lane/.test(body), body.slice(0, 200));
check('…and asks him to turn location on (it is a booked day, inside 7–7)', /Turn on location/.test(body) && /only used 7 am – 7 pm/.test(body));
await pg.click('text=Turn on location'); await wait(1500);
check('a position is kept and sent', db.crew_points.length >= 1 && Math.abs(db.crew_points[0].lat - SITE_LAT) < 1e-6, String(db.crew_points.length));
check('…and the banner says location is on until 7 pm', /Location on until 7 pm/.test(await pg.textContent('#main')));

// ── the job ──
await pg.click('.job'); await wait(1200);
body = await pg.textContent('#main');
check('the job opens with the address, the office’s note and what the customer chose',
  /12 Kauri Lane, Kerikeri/.test(body) && /Key under the mat/.test(body) && /Colour: Ironsand/.test(body) && /Strip the old roof/.test(body) && /Spouting/.test(body), body.slice(0, 400));
const gm = await pg.getAttribute('a:has-text("Google Maps")', 'href');
check('Google Maps opens directions to the site', /google\.com\/maps\/dir\/\?api=1&destination=12%20Kauri%20Lane/.test(gm || ''), gm);
check('one tap rings the customer', await pg.locator('a[href="tel:0215550101"]').count() >= 1);
check('the job pack is there', /Job Pack 3351\.pdf/.test(body));
check('no quote, order or price reaches the crew', !/Quote 3351|SO_H042880|\$782|782\.00/.test(body), body.match(/.{40}(Quote 3351|SO_H|782).{40}/) + '');
check('the scope says the steel grade, not {grade}', /Install New Colorsteel MAXAM/i.test(body) && !/\{grade\}/.test(body), (body.match(/Install New.{30}/) || [''])[0]);
check('the scope of work is folded behind its own row', await pg.evaluate(() => { const d = document.querySelector('details.tool[data-k="scope"]'); return !!d && !d.open && /Scope of work/.test(d.querySelector('summary').textContent); }));
check('allocated hours (58h) and hours used are near the top', /Allocated/.test(body) && /58h/.test(body) && /Used so far/.test(body));
check('the job menu has its rows, like Fergus Go', await pg.evaluate(() => ['scope', 'photos', 'pack', 'checks', 'notes'].every(k => document.querySelector('details.tool[data-k="' + k + '"]'))));
check('the roof map sits at the top of the job', await pg.locator('#rmap img').count() === 1);
await pg.click('details.tool[data-k="photos"] summary'); await wait(1200);
check('Photos drops down a strip of the job\'s photos to swipe', await pg.evaluate(() => { const st = document.getElementById('phStrip'); const r = st && st.getBoundingClientRect();
  return !!st && st.querySelectorAll('.slide img').length === 1 && r.height > 200 && r.height < 0.45 * innerHeight && getComputedStyle(st).overflowX === 'auto'; }));
check('the office’s checklist is on the job', /Before we start/.test(body) && /Scaffold tagged/.test(body));
await pg.click('details.tool[data-k="checks"] summary'); await wait(300);
await pg.locator('label.chk:has-text("Scaffold tagged") input').check(); await wait(1200);
check('a tick reaches the job', db.crew_events.some(e => e.kind === 'check' && e.row_id === 'r1' && e.data && e.data.done === true && e.data.item === 0));
await pg.click('text=Clock on at this job'); await wait(1500);
const on = db.crew_events.find(e => e.kind === 'on');
check('clocking on is kept with where it was made', on && on.row_id === 'r1' && Math.abs(on.lat - SITE_LAT) < 1e-6, JSON.stringify(on || {}).slice(0, 200));
check('…and teaches the job where its site is', db.crew_sites.some(s => s.row_id === 'r1'));
check('the button turns to Clock off', await pg.locator('text=Clock off this job').count() >= 1);

// ── a photo ──
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await pg.setInputFiles('#camIn', { name: 'IMG_0001.png', mimeType: 'image/png', buffer: png }); await wait(2500);
const jf = db.job_files.find(f => f.source === 'site');
check('a photo taken on site lands in the job’s Files & Photos', jf && jf.status === 'ready' && /^Site photo /.test(jf.name) && jf.job_id === 'j1', JSON.stringify(jf || {}).slice(0, 200));
check('…its bytes reached storage', [...store.values()].some(v => v.buf.length === png.length));

// ── ORDER FLASHING (2026-11-13): a saved one with its lengths changed, then one drawn by hand ──
await pg.evaluate(() => { location.hash = '#/job/r1'; }); await wait(1200);
check('the job\'s menu has Order flashing', await pg.locator('#flashRow').count() === 1);
await pg.click('#flashRow'); await wait(600);
body = await pg.textContent('#main');
check('…which starts with the two ways in: a saved flashing, or draw one', /Saved flashing/.test(body) && /Draw a custom flashing/.test(body), body.slice(0, 200));
await pg.click('text=Saved flashing'); await wait(1500);
body = await pg.textContent('#main');
check('the office\'s own flashings come first, then the built-ins', /My Barge/.test(body) && /Head Barge/.test(body) && body.indexOf('My Barge') < body.indexOf('Head Barge'), body.slice(0, 200));
await pg.click('.fl-lib:has-text("My Barge")'); await wait(700);
// a point of the drawing, on the screen
const scr = (x, y) => pg.evaluate(([x, y]) => { const sv = document.querySelector('#flPad svg'), rc = sv.getBoundingClientRect(), vb = sv.viewBox.baseVal;
  const sc = Math.min(rc.width / vb.width, rc.height / vb.height), ox = (rc.width - vb.width * sc) / 2, oy = (rc.height - vb.height * sc) / 2;
  return [rc.left + ox + (x - vb.x) * sc, rc.top + oy + (y - vb.y) * sc]; }, [x, y]);
const tapAt = async (x, y) => { const q = await scr(x, y); await pg.mouse.click(q[0], q[1]); await wait(250); };
const fb = await pg.locator('#flFull').boundingBox();
check('the drawing opens full screen, with the tools along the bottom and no rows of boxes', fb && fb.height > 800 && fb.width >= 389 &&
  await pg.locator('#flFull [data-tool]').count() === 8 && await pg.locator('input[data-seg]').count() === 0, JSON.stringify(fb));
check('a saved flashing opens drawn, its lengths on it', await pg.locator('#flPad [data-hit^="seg:"]').count() === 3 && /Colour side/.test(await pg.textContent('#flPad')));
await pg.click('#flPad [data-hit="seg:0:1"]'); await wait(300);
check('a tap on a length asks for it in a big box', await pg.locator('#flAsk').count() === 1 && (await pg.inputValue('#flAskIn')) === '200');
await pg.fill('#flAskIn', '250'); await pg.click('#flAsk [data-a="ok"]'); await wait(250);
check('…and the drawing and the girth change', (await pg.locator('#flPad [data-hit="seg:0:1"]').textContent()).includes('250') && /Girth 370 mm/.test(await pg.textContent('#flfStats')));
await pg.click('#flFull [data-tool="angle"]'); await tapAt(2, 98);
await pg.fill('#flAskIn', '30'); await pg.click('#flAsk [data-a="ok"]'); await wait(250);
check('Angle: a tap at a bend asks its angle and puts "∠ 30°" by it', /∠ 30°/.test(await pg.textContent('#flPad')) && (await pg.evaluate(() => JSON.parse(localStorage.getItem('crew_fdraft')).polylines[0].angleMarkers[1].deg)) === 30);
await pg.click('#flFull [data-tool="crush"]'); await tapAt(200, 82);
check('Crush fold: a tap at a bend marks it, as the office does', /Crush/.test(await pg.textContent('#flPad')) && /1 hem/.test(await pg.textContent('#flfStats')));
await pg.click('#flFull [data-tool="guard"]'); await tapAt(120, 40);
check('Flash guard: a tap drops its label', /Flash guard/.test(await pg.textContent('#flPad')) && /flash guard/.test(await pg.textContent('#flfStats')));
await pg.click('#flFull [data-tool="undo"]'); await wait(200);
check('Undo takes the last mark off', !/Flash guard/.test(await pg.textContent('#flPad')));
await pg.click('#flFull [data-tool="guard"]'); await tapAt(120, 40);
await pg.click('#flNext'); await wait(600);
await pg.click('.stepper button:has-text("+")'); await pg.click('.stepper button:has-text("+")');
await pg.click('text=Finish flashing'); await wait(300);
check('Next goes to the order: it asks for the length of each piece', /length of each piece/.test(await pg.textContent('#flErr')) && await pg.locator('#flFull').count() === 0);
await pg.fill('#flLen', '6'); await pg.click('text=Finish flashing'); await wait(600);
body = await pg.textContent('#main');
check('Finish puts it on the order summary: 3 × 6.00 m, girth 370 mm', /My Barge/.test(body) && /3 × 6\.00 m/.test(body) && /girth 370 mm/.test(body) && /Ironsand/.test(body), body.slice(0, 300));
await pg.click('text=Draw a custom flashing'); await wait(700);
check('a custom flashing starts on the drawing tool', await pg.locator('#flFull [data-tool="draw"].on').count() === 1);
const pb = await pg.locator('#flPad svg').boundingBox();
for (const [fx, fy] of [[0.2, 0.2], [0.2, 0.6], [0.75, 0.6]]) { await pg.mouse.click(pb.x + pb.width * fx, pb.y + pb.height * fy); await wait(250); }
check('a custom flashing is drawn bend by bend', (await pg.evaluate(() => JSON.parse(localStorage.getItem('crew_fdraft')).polylines[0].vertices.length)) === 3 && await pg.locator('#flPad [data-hit^="seg:"]').count() === 2);
await pg.click('#flFull [data-tool="paint"]'); await pg.mouse.click(pb.x + pb.width * 0.45, pb.y + pb.height * 0.52); await wait(250);
check('Colour side: tapped beside a side, the arrow goes on that side', await pg.evaluate(() => { const d = JSON.parse(localStorage.getItem('crew_fdraft')); return !!d.paintedSide && d.paintedSide.dirY < -0.9; }));
await pg.click('#flNext'); await wait(400);
check('Next with sides unmeasured says so and asks nothing (the owner: no box until a side is tapped)', await pg.locator('#flAsk').count() === 0 && await pg.locator('#flFull').count() === 1);
// a thumb on a phone: down, a moment, up — the box must still be there after the click lands
const thumb = async (sel) => { const bb = await pg.locator(sel).boundingBox(); await pg.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await wait(450); };
await pg.click('#flFull [data-tool="tap"]'); await wait(150);
await thumb('#flPad [data-hit="seg:0:0"]');
check('a side tapped for its length keeps its box open (it flashed and vanished)', await pg.locator('#flAsk').count() === 1 && /Side 1/.test(await pg.textContent('#flAsk')));
await pg.fill('#flAskIn', '60'); await pg.click('#flAsk [data-a="ok"]'); await wait(400);
check('…OK closes it and does not ask for the next side', await pg.locator('#flAsk').count() === 0);
await thumb('#flPad [data-hit="seg:0:1"]');
await pg.fill('#flAskIn', '140'); await pg.click('#flAsk [data-a="ok"]'); await wait(400);
await pg.click('#flNext'); await wait(500);
await pg.fill('#flLen', '3.2');
await pg.click('text=Finish flashing'); await wait(600);
body = await pg.textContent('#main');
check('…and joins the order: two flashings, then Add another or send', /Custom flashing/.test(body) && /Flashingstoorder2/.test(body.replace(/\s+/g, '')) && /Add another flashing/.test(body) && /Send to the office to order/.test(body), body.slice(0, 300));
await pg.fill('#flNote', 'Thursday please');
await pg.click('#flSend'); await wait(1800);
const fo = db.crew_flash_orders[0];
check('not ticked to order: it goes to the office with both flashings', fo && fo.status === 'office' && fo.items.length === 2 && fo.items[0].girthMm === 370 && fo.items[0].qty === 3 &&
  fo.items[1].lengthM === 3.2 && fo.note === 'Thursday please' && fo.items[1].paintedSide, JSON.stringify(fo || {}).slice(0, 300));
check('…the phone says so and the order list is cleared', /Sent to the office|saved for the office/.test(await pg.textContent('#main')) && (await pg.evaluate(() => window.__crew.flCart('r1').length)) === 0);
await pg.evaluate(() => { location.hash = '#/job/r1'; }); await wait(1200);

// ── no signal ──
await ctx.clock.setFixedTime(new Date(nzAt(D, 12)));
await ctx.setOffline(true); await wait(200);
await pg.click('text=Clock off this job'); await wait(800);
check('with no signal the press is kept on the phone', !db.crew_events.some(e => e.kind === 'off') &&
  /No signal · 1 waiting/.test(await pg.textContent('#sync')), await pg.textContent('#sync'));
await ctx.setOffline(false); await pg.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(1800);
check('…and sent when signal comes back', db.crew_events.some(e => e.kind === 'off' && e.row_id === 'r1') && /Up to date/.test(await pg.textContent('#sync')), await pg.textContent('#sync'));

// ── offline, the job still opens ──
await ctx.setOffline(true);
await pg.goto(ORIGIN + '/crew#/today').catch(() => {});
await ctx.setOffline(false);
await pg.evaluate(() => { location.hash = '#/job/r1'; }); await ctx.setOffline(true); await wait(800);
check('a job opened before reads from the phone with no signal', /Arran Simpson/.test(await pg.textContent('#main')));
await ctx.setOffline(false);

// ── hours ──
await pg.evaluate(() => { location.hash = '#/hours'; }); await wait(1200);
body = await pg.textContent('#main');
check('Hours shows two hours on site at the job (clocked on 10, off 12)', /Arran Simpson/.test(body) && /2h 00m/.test(body), body.slice(0, 300));
check('no page errors on the booked day', !pg.__errs.length, pg.__errs.join(' | '));
await ctx.close();

// ── a day his crew is not booked ──
const before = db.crew_points.length;
const p2 = await phone(nzAt(D2, 10));
await p2.pg.goto(ORIGIN + '/crew'); await wait(1500);
body = await p2.pg.textContent('#main');
check('on an unbooked day it says location is off and never asks', /Location is off — your crew isn’t booked today/.test(body) && !/Turn on location/.test(body), body.slice(0, 200));
await p2.pg.evaluate(() => window.__crew.onFix({ timestamp: Date.now(), coords: { latitude: -35.2, longitude: 173.9, accuracy: 5, speed: null } }));
await wait(300);
check('…and a position handed to it is not kept', (await p2.pg.evaluate(() => window.__crew.S.q.points.length)) === 0 && db.crew_points.length === before);
await p2.ctx.close();

// ── after 7 pm on a booked day ──
const p3 = await phone(nzAt(D, 20));
await p3.pg.goto(ORIGIN + '/crew'); await wait(1500);
check('after 7 pm location is off', /Location is off outside 7 am – 7 pm/.test(await p3.pg.textContent('#main')));
await p3.ctx.close();

// ── the office's "type in start and finish" setting ──
{
  db.crew_settings[0].data.clockMode = 'times';
  const p6 = await phone(nzAt(D, 17));
  await p6.pg.goto(ORIGIN + '/crew'); await wait(1500);
  const tb = await p6.pg.textContent('#main');
  check('with typed hours set, Today asks for today\'s hours instead of clock buttons', /Enter today’s hours/.test(tb) && !/Travelling/.test(tb), tb.slice(0, 200));
  await p6.pg.click('text=Enter today’s hours'); await wait(500);
  await p6.pg.fill('#dStart', '07:00'); await p6.pg.fill('#dEnd', '16:00'); await p6.pg.fill('#dBreak', '30');
  check('…the form adds it up (8h 30m)', /8h 30m/.test(await p6.pg.textContent('#dTot')));
  await p6.pg.click('text=Save hours'); await wait(1500);
  const de = db.crew_events.find(e => e.kind === 'day');
  check('…and the day is kept for that job', de && de.data.start === '07:00' && de.data.end === '16:00' && de.data.breakMin === 30 && de.row_id === 'r1', JSON.stringify(de || {}));
  await p6.pg.evaluate(() => { location.hash = '#/week'; }); await wait(1500);
  const wb = await p6.pg.textContent('#main');
  check('the Week tab shows the hours put in on each day', /8h 30m/.test(wb), wb.slice(0, 300));
  check('…and each job’s number (the quote’s, Job 3351)', /Job 3351/.test(wb), wb.slice(0, 300));
  check('the crew app wears its own icon (drill and hammer under the RoofMap pin)', await p6.pg.evaluate(() => /crew-192\.png/.test(document.querySelector('link[rel="apple-touch-icon"]').href) && /crew-mark\.png/.test(document.querySelector('#topMark img').src)));
  db.crew_settings[0].data.clockMode = 'button';
  await p6.ctx.close();
}

// ── the team map (2026-11-14, the owner: "add a map tab to see the company map to see where everyone is") ──
{
  db.crew_points.push({ id: 'pt-map', company_id: 'c1', user_id: 'u3', at: new Date().toISOString(), lat: -35.2271, lng: 173.9533, acc: 6, speed: null, row_id: 'r1', created_at: new Date().toISOString() });
  const pm = await phone(nzAt(D, 10));
  const mapReqs = [];
  await pm.pg.route('https://api.mapbox.com/**', r => { mapReqs.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }); });
  await pm.pg.goto(ORIGIN + '/crew#/today'); await wait(1200);
  check('the bottom bar carries a Map tab', await pm.pg.locator('#nav button[data-v="map"]').count() === 1);
  await pm.pg.click('#nav button[data-v="map"]'); await wait(1500);
  const src0 = await pm.pg.getAttribute('#teamImg', 'src');
  check('the Map tab draws the team on a map: a star for you where you were last seen, the job sites, framed to fit', /pin-l-star\+f87d20\(173\.95330,-35\.22710\)/.test(src0 || '') && /\/auto\//.test(src0 || '') && /pin-s\+/.test(src0 || ''), (src0 || '').slice(0, 200));
  const tb = await pm.pg.textContent('#main');
  check('…and lists the team under it, when each was seen', /The team/.test(tb) && /\(you\)/.test(tb) && /Seen (just now|\d+ min ago)/.test(tb) && /Crew 1/.test(tb), tb.slice(0, 300));
  await pm.pg.click('.tm-row'); await wait(300);
  const src1 = await pm.pg.getAttribute('#teamImg', 'src');
  check('a tap on a person centres the map on them', /173\.95330,-35\.22710,15\//.test(src1 || '') && await pm.pg.locator('text=Show everyone').count() === 1, (src1 || '').slice(-200));
  await pm.ctx.close();
}

// ── Chrome's "Desktop site" (the owner's phone, 2026-11-13): a 980 px page on a 412 px screen ──
{
  const c4 = await b.newContext({ viewport: { width: 980, height: 2180 }, screen: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await c4.clock.setFixedTime(new Date(nzAt(D, 10)));
  await c4.addInitScript(([api, tok]) => { window.CREW_API = api; localStorage.setItem('crew_token', tok); }, [API, TOKEN]);
  const p4 = await c4.newPage(); await p4.goto(ORIGIN + '/crew'); await wait(1200);
  const z = await p4.evaluate(() => ({ zoom: +document.documentElement.style.zoom || 1, w: document.querySelector('.job').getBoundingClientRect().width }));
  check('in Chrome\'s Desktop site mode the app is scaled up to fill the phone, not shown tiny (a fifth smaller since 14 Nov)', z.zoom > 1.75 && z.zoom < 2.0, JSON.stringify(z));
  // the owner's next screenshot: the photos a whole screen tall and the page scrolling on into nothing —
  // vh is not scaled by the zoom, so heights go through --vh1
  await p4.evaluate(() => { location.hash = '#/job/r1'; }); await wait(1500);
  await p4.click('details.tool[data-k="photos"] summary'); await wait(800);
  const sh = await p4.evaluate(() => { const zz = +document.documentElement.style.zoom || 1, st = document.getElementById('phStrip');
    return { frac: parseFloat(getComputedStyle(st).height) * zz / window.innerHeight, minH: getComputedStyle(document.body).minHeight }; });
  check('…where the photos take about a quarter of the screen, not all of it', sh.frac > 0.15 && sh.frac < 0.34, JSON.stringify(sh));
  check('…and the page does not run on past its last item', !/^\d{4,}/.test(sh.minH) && parseFloat(sh.minH || 0) < 1000, JSON.stringify(sh));
  await c4.close();
  const c5 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c5.addInitScript((api) => { window.CREW_API = api; }, API);
  const p5 = await c5.newPage(); await p5.goto(ORIGIN + '/crew'); await wait(300);
  check('…and on an ordinary phone everything is a fifth smaller (the owner: "about 20% smaller")', Math.abs((+(await p5.evaluate(() => document.documentElement.style.zoom))) - 0.8) < 0.01);
  await c5.close();
}

await b.close(); site.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
