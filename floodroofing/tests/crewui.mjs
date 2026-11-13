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
    req.on('end', () => { if (req.method === 'PUT') { store.set(decodeURIComponent(u.pathname.slice(7)), { buf: Buffer.concat(chunks), mime: req.headers['content-type'] }); res.writeHead(200); return res.end('{}'); } res.writeHead(404); res.end(); });
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
    crews: [ { id: 'crew1', name: 'Crew 1', colour: '#f87d20' }, { id: 'crew2', name: 'Crew 2', colour: '#22c55e' } ] } } ],
  jobs: [ { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', version_of: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', draw_state: { form: { jobPhone: '021 555 0101' }, state: { quote: {
      ref: '3351', proposalOptions: { steelGrade: 'maxam', profile: 'corrugate', colour: 'Ironsand' }, custDesc: ['Strip the old roof and take it away'], custExcl: ['Spouting'] } } } } ],
  job_files: [ { id: 'f1', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Job Pack 3351.pdf', mime: 'application/pdf', size: 1000, kind: 'export', source: 'job-pack', author: 'office', status: 'ready', storage_path: 'p', created_at: '2026-11-03T00:00:00Z' } ],
  schedule_rows: [ { id: 'r1', company_id: 'c1', user_id: 'u1', job_id: 'j1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', email: '', length_days: 1, notes: 'Key under the mat', archived: false, job_ref: '', created_at: '2026-11-01T00:00:00Z' } ],
  schedule_blocks: [ { id: 'b1', company_id: 'c1', user_id: 'u1', row_id: 'r1', kind: 'crew', crew_id: 'crew1', start_date: D, work_days: 1, created_at: '2026-11-01T00:00:00Z' } ],
  crew_members: [ { id: 'm1', company_id: 'c1', user_id: 'u3', crew_id: 'crew1', name: '', phone: '', updated_at: '2026-11-01T00:00:00Z' } ],
  crew_events: [], crew_points: [], crew_sites: [],
  crew_settings: [ { id: 's1', company_id: 'c1', user_id: 'u1', updated_at: '2026-11-01T00:00:00Z', data: { checklists: [ { id: 'start', name: 'Before we start', when: 'start', items: ['Scaffold tagged', 'Edge protection up'] } ] } } ],
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
check('the office’s checklist is on the job', /Before we start/.test(body) && /Scaffold tagged/.test(body));
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

// ── Chrome's "Desktop site" (the owner's phone, 2026-11-13): a 980 px page on a 412 px screen ──
{
  const c4 = await b.newContext({ viewport: { width: 980, height: 2180 }, screen: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await c4.clock.setFixedTime(new Date(nzAt(D, 10)));
  await c4.addInitScript(([api, tok]) => { window.CREW_API = api; localStorage.setItem('crew_token', tok); }, [API, TOKEN]);
  const p4 = await c4.newPage(); await p4.goto(ORIGIN + '/crew'); await wait(1200);
  const z = await p4.evaluate(() => ({ zoom: +document.documentElement.style.zoom || 1, w: document.querySelector('.job').getBoundingClientRect().width }));
  check('in Chrome\'s Desktop site mode the app is scaled up to fill the phone, not shown tiny', z.zoom > 2.2 && z.zoom < 2.5, JSON.stringify(z));
  await c4.close();
  const c5 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c5.addInitScript((api) => { window.CREW_API = api; }, API);
  const p5 = await c5.newPage(); await p5.goto(ORIGIN + '/crew'); await wait(300);
  check('…and on an ordinary phone it is left alone', !(await p5.evaluate(() => document.documentElement.style.zoom)));
  await c5.close();
}

await b.close(); site.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
