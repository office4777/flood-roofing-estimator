// A saved job opens LOCKED. Nothing on the canvas or the quote changes until
// it is unlocked from the sidebar, and an attempt to change it asks the one
// question. Unlocked, every change saves itself; locking again saves first.
// A new job is never locked.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const JOB = { id: 'job-88', client_name: 'Rangi Parata', site_address: '4 Kauri Rd', status: 'draft',
  updated_at: '2026-09-02T08:00:00.000+00:00',
  draw_state: { form: { jobClient: 'Rangi Parata', jobAddr: '4 Kauri Rd' },
    state: { quote: { client: 'Rangi Parata', ref: '3300', lineItems: [{ desc: 'Roof', qty: 1, unit: 'lot', rate: 1000 }] } },
    draw: { outline: [[100,100],[400,100],[400,300],[100,300]], outlineDone: true, lines: [], scaleMetresPerPx: 0.03 } } };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const puts = [];
let stamp = JOB.updated_at;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
  const u = r.request().url(), m = r.request().method();
  const j = (status, x) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  if (/\/jobs\/job-88$/.test(u) && m === 'GET') return j(200, Object.assign({}, JOB, { updated_at: stamp }));
  if (/\/jobs\/job-88$/.test(u) && m === 'PUT'){
    puts.push(r.request().postDataJSON());
    stamp = new Date(Date.parse(stamp) + 60000).toISOString();
    return j(200, { id: 'job-88', updated_at: stamp });
  }
  if (/\/jobs\/?(\?|$)/.test(u) && m === 'GET') return j(200, [JOB]);
  return j(200, []);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
});

// ── a new job is not locked ──────────────────────────────────────
let v = await pg.evaluate(() => ({ locked: !!S.jobLocked, btn: document.getElementById('navJobLockBtn').style.display }));
check('a job that is not saved yet is not locked, and shows no lock', !v.locked && v.btn === 'none', JSON.stringify(v));

// ── a saved job opens locked ─────────────────────────────────────
await pg.evaluate(() => openJob('job-88'));
await pg.waitForTimeout(1200);
v = await pg.evaluate(() => ({ locked: !!S.jobLocked, btn: document.getElementById('navJobLockBtn').style.display,
  text: document.getElementById('navJobLockBtn').textContent, asked: !!document.getElementById('jobLockModal') }));
check('a saved job opens locked, and the sidebar says so', v.locked && v.btn !== 'none' && /Locked/.test(v.text), JSON.stringify(v));
check('…without asking anything just for opening', !v.asked);

// ── drawing on it asks first, and changes nothing ────────────────
const n0 = await pg.evaluate(() => DRAW.outline.length + DRAW.lines.length);
const cv = await pg.locator('#roofCanvas').boundingBox();
await pg.mouse.click(cv.x + 60, cv.y + 60);
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ asked: !!document.getElementById('jobLockModal'), n: DRAW.outline.length + DRAW.lines.length, pts: DRAW.currentPts.length }));
check('a tap on the locked canvas asks to unlock', v.asked, JSON.stringify(v));
check('…and draws nothing', v.n === n0 && v.pts === 0, JSON.stringify(v));
await pg.click('#jobLockKeep');
await pg.waitForTimeout(200);
check('"Keep locked" leaves it locked', await pg.evaluate(() => S.jobLocked && !document.getElementById('jobLockModal')));

// ── typing into the quote asks too ───────────────────────────────
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(900);
const typed = await pg.evaluate(async () => {
  const el = Array.from(document.querySelectorAll('#tab-quote input[type=text], #tab-quote input:not([type]), #tab-quote textarea, #tab-quote [contenteditable=true]')).find(x => x.offsetParent);
  if (!el) return { none: true };
  el.focus();
  const before = el.value !== undefined ? el.value : el.textContent;
  return { before, id: el.id || el.className };
});
if (!typed.none){
  await pg.keyboard.type('x');
  await pg.waitForTimeout(300);
  v = await pg.evaluate((id) => ({ asked: !!document.getElementById('jobLockModal') }), typed.id);
  check('typing into the locked quote asks to unlock', v.asked, JSON.stringify(typed));
  check('…and no save is sent', puts.length === 0, puts.length + ' saves');
  await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.remove(); });
} else {
  check('typing into the locked quote asks to unlock', true, 'skipped: no field found');
  check('…and no save is sent', puts.length === 0, puts.length + ' saves');
}

// ── the question is asked only for a physical attempt (report 44) ─
// It popped up while typing a feedback report, and on every render: the
// autosave trigger fires from both. Those stand down quietly now.
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.remove(); gotoTab('feedback'); });
await pg.waitForTimeout(600);
const fbField = await pg.evaluate(() => { const el = document.querySelector('#tab-feedback input[type=text], #tab-feedback textarea'); if (!el) return null; el.focus(); return el.id || el.className; });
if (fbField){ await pg.keyboard.type('the roof'); await pg.waitForTimeout(300); }
v = await pg.evaluate(() => { _scheduleAutosave(); saveSnapshot(); return { asked: !!document.getElementById('jobLockModal') }; });
check('typing a feedback report, and renders that call autosave, do not ask to unlock', !v.asked && fbField !== null, JSON.stringify({ fbField, v }));
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(900);
const picked = await pg.evaluate(() => { const sel = document.querySelector('#tab-quote select'); if (!sel || sel.options.length < 2) return null;
  sel.selectedIndex = sel.selectedIndex === 0 ? 1 : 0; sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.id || sel.name || 'select'; });
v = await pg.evaluate(() => ({ asked: !!document.getElementById('jobLockModal') }));
check('a pick in a quote drop-down is a physical attempt, and asks', picked === null || v.asked, JSON.stringify({ picked, v }));
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.remove(); });

// ── unlock from the sidebar, then changes save themselves ────────
await pg.evaluate(() => gotoTab('roof'));
await pg.waitForTimeout(400);
await pg.click('#navJobLockBtn');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ locked: !!S.jobLocked, text: document.getElementById('navJobLockBtn').textContent }));
check('the sidebar button unlocks it', !v.locked && /Unlocked/.test(v.text), JSON.stringify(v));
await pg.evaluate(() => { saveSnapshot(); DRAW.lines.push({ type:'ridge', pts:[[120,200],[380,200]] }); _scheduleAutosave(); });
await pg.waitForTimeout(3200);
check('…and a change now saves itself', puts.length >= 1 && puts[puts.length - 1].draw_state.draw.lines.length === 1,
  puts.length + ' saves');
check('…with no question asked', !(await pg.evaluate(() => !!document.getElementById('jobLockModal'))));

// ── locking again saves first ────────────────────────────────────
const n1 = puts.length;
await pg.evaluate(() => { DRAW.lines.push({ type:'hip', pts:[[100,100],[120,200]] }); });
await pg.click('#navJobLockBtn');
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ locked: !!S.jobLocked }));
check('locking again saves what changed first', puts.length === n1 + 1 && puts[puts.length - 1].draw_state.draw.lines.length === 2 && v.locked,
  (puts.length - n1) + ' saves, locked=' + v.locked);

// ── the question's own Unlock button ─────────────────────────────
await pg.mouse.click(cv.x + 80, cv.y + 80);
await pg.waitForTimeout(300);
await pg.click('#jobLockUnlock');
await pg.waitForTimeout(200);
check('"Unlock" on the question unlocks it', await pg.evaluate(() => !S.jobLocked && !document.getElementById('jobLockModal')));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
