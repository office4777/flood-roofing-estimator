// MY DAY — the real page, driven the way he will drive it.
//
// The backend suite (dayplan.mjs) pins the post box. This one pins the part
// he actually touches, and the three things that would make it useless:
//
//   1. Plan tonight → it is there tomorrow. The whole point of the app.
//   2. One tap ticks a big one off — anywhere on the row, not a 20px circle.
//   3. A tick on the phone shows up on the computer, and the computer adding
//      a task does not wipe the tick. Two devices, nothing lost.
//
// It drives the real MyDay.html against the real Express server over a real
// HTTP origin (not file://), because that is the only way the service worker,
// the fetches and localStorage behave as they will on his phone.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { chromium } from 'playwright';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The hub folder, served on a real origin. It goes up FIRST because the
// /day routes sit behind the usual CORS allowlist (in production the origin
// is office4777.github.io, already trusted) — so the server has to be told
// about this one before it boots.
const HUB = _j(_ROOT, 'hub');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const site = http.createServer((req, res) => {
  const name = (req.url.split('?')[0] || '/').replace(/^\/+/, '') || 'MyDay.html';
  const file = _j(HUB, name);
  if (!file.startsWith(HUB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': TYPES[name.slice(name.lastIndexOf('.'))] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + site.address().port;
const SITE = ORIGIN + '/MyDay.html';

const db = { __missing: [], __fail500: '', day_plans: [] };
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34741';
process.env.PORT = PORT;
process.env.FRONTEND_URL = ORIGIN;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const API = 'http://127.0.0.1:' + PORT;

const browser = await chromium.launch();
// A phone, and a computer. Separate contexts = separate localStorage, which
// is exactly what two of his devices are.
// The phone keeps its service worker, because the offline check at the end
// is a check on that worker: without it a reload on a roof with no signal is
// the browser's dinosaur, which is the whole reason it exists.
async function device(width, height, sw){
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: sw ? 'allow' : 'block' });
  await ctx.addInitScript(a => { window.__MYDAY_API = a; }, API);
  const pg = await ctx.newPage();
  return { ctx, pg };
}
const phone = await device(390, 844, true);
const comp  = await device(1280, 900, false);
const settle = (pg, ms=450) => pg.waitForTimeout(ms);

await phone.pg.goto(SITE);
await settle(phone.pg);
// Let the worker take control, so the shell is genuinely in the cache.
await phone.pg.evaluate(() => navigator.serviceWorker.ready.then(() => null)).catch(() => {});
await settle(phone.pg, 600);

// ── Sync on ───────────────────────────────────────────────────────────
await phone.pg.click('#btnGear');
await phone.pg.click('[data-x=mk]');
await phone.pg.waitForTimeout(900);
const KEY = await phone.pg.evaluate(() => localStorage.getItem('fr_myday_key'));
check('turning on sync mints a key', /^[a-f0-9]{32}$/.test(KEY || ''), String(KEY));
await phone.pg.keyboard.press('Escape');
await phone.pg.evaluate(() => { const s = document.querySelector('.scrim'); if (s) s.remove(); });

// ── 1. Plan tomorrow tonight ──────────────────────────────────────────
await phone.pg.click('#segPlan');
await settle(phone.pg);
const slots = await phone.pg.locator('.bigslot').count();
check('the planning screen offers three big things', slots === 3, String(slots));
for (const [i, t] of [[0,'Price the Kerikeri re-roof'],[1,'Order steel for 3302'],[2,'Ring Sharon back']]){
  await phone.pg.locator('.bigslot').nth(i).fill(t);
  await phone.pg.locator('.bigslot').nth(i).press('Enter');
}
await phone.pg.locator('#addFillPlan').fill('Tidy the van');
await phone.pg.locator('#addFillPlan').press('Enter');
await settle(phone.pg, 1800);
const tomorrowKey = await phone.pg.evaluate(() => {
  const d = new Date(); d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
});
const stored = (db.day_plans[0] || {}).doc || { days: {} };
const sBig = ((stored.days[tomorrowKey] || {}).big || []).filter(t => !t.deleted);
check('the three land on TOMORROW, on the server', sBig.length === 3 && sBig[0].text === 'Price the Kerikeri re-roof',
  sBig.map(t => t.text).join(' | '));
check('…and the fill-in with them, kept separate', (((stored.days[tomorrowKey]||{}).fill)||[]).length === 1);

// ── 2. Tomorrow arrives: it is today's plan, and one tap ticks it ─────
// Move the day on by pretending yesterday is when it was planned.
await phone.pg.evaluate(k => {
  const raw = JSON.parse(localStorage.getItem('fr_myday_v1'));
  const t = new Date();
  const today = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
  raw.doc.days[today] = raw.doc.days[k];     // the plan made last night is now today's
  delete raw.doc.days[k];
  localStorage.setItem('fr_myday_v1', JSON.stringify(raw));
}, tomorrowKey);
await phone.pg.reload();
await settle(phone.pg, 700);
await phone.pg.click('#segToday');
await settle(phone.pg);
check('tomorrow morning, last night\'s plan IS the day', await phone.pg.locator('.big').count() === 3,
  String(await phone.pg.locator('.big').count()));
check('…counted as a day, not a pile', /0 of 3 done/.test(await phone.pg.locator('.lab').first().innerText()));

// A tap on the ROW, not the little circle — the whole card is the target.
const box = await phone.pg.locator('.big').first().boundingBox();
await phone.pg.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
await settle(phone.pg);
check('one tap anywhere on the row ticks it off', await phone.pg.locator('.big.done').count() === 1);
check('…and the count says so', /1 of 3 done/.test(await phone.pg.locator('.lab').first().innerText()));
await settle(phone.pg, 1800);

// ── 3. The computer sees it, and does not wipe it ─────────────────────
await comp.pg.goto(SITE + '#k=' + KEY);
await settle(comp.pg, 1500);
check('the computer, opened on the link, shows the same day', await comp.pg.locator('.big').count() === 3,
  String(await comp.pg.locator('.big').count()));
check('…with the phone\'s tick already on it', await comp.pg.locator('.big.done').count() === 1);

await comp.pg.locator('#addFill').fill('Chase the Fergus invoice');
await comp.pg.locator('#addFill').press('Enter');
await settle(comp.pg, 1800);
// Meanwhile the phone ticks a second one.
const box2 = await phone.pg.locator('.big').nth(1).boundingBox();
await phone.pg.mouse.click(box2.x + box2.width * 0.55, box2.y + box2.height / 2);
await settle(phone.pg, 2200);
await phone.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(phone.pg, 1600);

check('the phone\'s second tick survived the computer saving', await phone.pg.locator('.big.done').count() === 2,
  String(await phone.pg.locator('.big.done').count()));
check('…and the computer\'s task survived the phone saving',
  /Chase the Fergus invoice/.test(await phone.pg.locator('#app').innerText()));

await comp.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(comp.pg, 1600);
check('both devices end up on the same day', await comp.pg.locator('.big.done').count() === 2,
  String(await comp.pg.locator('.big.done').count()));

// ── It still works with nothing to talk to ────────────────────────────
await phone.ctx.setOffline(true);
const box3 = await phone.pg.locator('.big').nth(2).boundingBox();
await phone.pg.mouse.click(box3.x + box3.width * 0.55, box3.y + box3.height / 2);
await settle(phone.pg, 900);
check('a tick with no signal still ticks', await phone.pg.locator('.big.done').count() === 3);
// The app itself has to come BACK with no signal — that is the service
// worker's one job, and a checklist you cannot open on a roof is no use.
let reopened = true;
try { await phone.pg.reload({ timeout: 15000 }); } catch (e) { reopened = false; }
await settle(phone.pg, 900);
check('the app still opens with no signal at all', reopened && await phone.pg.locator('#app').count() === 1);
check('…with every tick still on it', await phone.pg.locator('.big.done').count() === 3);
await phone.ctx.setOffline(false);
await phone.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(phone.pg, 2200);
const final = (db.day_plans[0] || {}).doc || { days: {} };
const todayKey = await phone.pg.evaluate(() => { const t = new Date();
  return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); });
check('…and reaches the server once the signal comes back',
  ((final.days[todayKey]||{}).big||[]).filter(t => t.done).length === 3,
  JSON.stringify(((final.days[todayKey]||{}).big||[]).map(t => t.done)));

await browser.close();
site.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
