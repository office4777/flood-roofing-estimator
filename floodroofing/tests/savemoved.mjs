// Two people on one job, from the roofer's side of the screen.
//
// The office opens a job on the desktop; someone opens the same job onsite.
// Both autosave. The last save used to win, silently, and the other person
// found out at quoting time. Now a save carries the updated_at the job was
// opened with; when the server says the row has moved, the app stops and
// asks — load theirs, or write over it — and autosave stands down until the
// roofer has answered rather than asking the same thing every two seconds.
//
// The same suite holds the other half of the save path: once the server has
// the aerial and the photos, later saves leave them out and name them, so a
// roofer drawing on a phone at the site is not uploading twenty megabytes
// every time a line moves.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const AERIAL = 'data:image/jpeg;base64,' + 'A'.repeat(300000);   // a believable aerial
const PHOTO  = 'data:image/jpeg;base64,' + 'P'.repeat(120000);
const JOB = { id: 'job-77', client_name: 'Nikki Barrett', site_address: '11 Morcom Lane', status: 'draft',
  updated_at: '2026-09-02T08:00:00.000+00:00',
  draw_state: { form: { jobClient: 'Nikki Barrett', jobAddr: '11 Morcom Lane' },
    state: { img64: AERIAL, photos: [{ src: PHOTO, caption: 'front' }] },
    draw: { outline: [[100,100],[400,100],[400,300],[100,300]], outlineDone: true, lines: [], scaleMetresPerPx: 0.03 } } };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const puts = [];               // every PUT body, in order
let serverStamp = JOB.updated_at;
let refuse = false;            // when true the next PUT answers 409
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async (r) => {
  const u = r.request().url(), m = r.request().method();
  const j = (status, x) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  if (/\/jobs\/job-77$/.test(u) && m === 'GET')
    return j(200, Object.assign({}, JOB, { updated_at: serverStamp, client_name: refuse ? 'Nikki Barrett' : 'Nikki Barrett' }));
  if (/\/jobs\/job-77$/.test(u) && m === 'PUT'){
    const body = r.request().postDataJSON();
    puts.push(body);
    if (refuse){ refuse = false; return j(409, { error: 'This job was changed on another device since you opened it.',
      code: 'JOB_MOVED', current: { id: 'job-77', updated_at: '2026-09-02T08:05:00.000+00:00', client_name: 'Nikki Barrett' } }); }
    serverStamp = new Date(Date.parse(serverStamp) + 60000).toISOString();
    return j(200, { id: 'job-77', client_name: body.client_name, site_address: body.site_address, updated_at: serverStamp });
  }
  if (/\/jobs\/?$/.test(u) && m === 'GET') return j(200, [JOB]);
  return j(200, []);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
});
await pg.evaluate(() => openJob('job-77'));
await pg.waitForTimeout(800);

check('opening a job remembers when the server last saved it',
  (await pg.evaluate(() => S._jobLoaded && S._jobLoaded.updatedAt)) === JOB.updated_at,
  await pg.evaluate(() => JSON.stringify(S._jobLoaded)));

// ── the first save carries everything ────────────────────────────
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
check('the first save sends the aerial and the photos up', puts.length === 1 &&
  puts[0].draw_state.state.img64 === AERIAL && puts[0].draw_state.state.photos.length === 1 && !puts[0].draw_state_keep,
  puts.length + ' saves, keep=' + JSON.stringify(puts[0] && puts[0].draw_state_keep));
check('…and says what it loaded, so the server can tell if the job has moved',
  puts[0].base_updated_at === JOB.updated_at, puts[0].base_updated_at);
const bigBytes = JSON.stringify(puts[0]).length;

// ── the next save, with only a line moved, leaves them out ───────
await pg.evaluate(() => { DRAW.lines.push({ type:'ridge', pts:[[120,200],[380,200]] }); });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
const light = puts[1];
check('a save after moving a line leaves the aerial and photos out', !!light &&
  light.draw_state_keep && light.draw_state_keep.indexOf('img64') >= 0 && light.draw_state_keep.indexOf('photos') >= 0 &&
  !('img64' in light.draw_state.state) && !('photos' in light.draw_state.state),
  light ? 'keep=' + JSON.stringify(light.draw_state_keep) : '(no second save)');
check('…so it is a fraction of the size', !!light && JSON.stringify(light).length < bigBytes / 10,
  (light ? JSON.stringify(light).length : 0) + ' bytes vs ' + bigBytes);
check('…but still carries the drawing', !!light && light.draw_state.draw.lines.length === 1,
  light ? light.draw_state.draw.lines.length + ' lines' : '');
check('…and the timestamp the save before it came back with', !!light &&
  light.base_updated_at === '2026-09-02T08:01:00.000Z', light && light.base_updated_at);

// ── an identical save is not sent at all ─────────────────────────
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(400);
check('saving again with nothing changed sends nothing', puts.length === 2, puts.length + ' saves');

// ── a changed photo goes up again ────────────────────────────────
await pg.evaluate(() => { S.photos.push({ src: 'data:image/jpeg;base64,NEW', caption: 'gutter' }); });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
check('adding a photo sends the photos again, and only the photos',
  puts.length === 3 && puts[2].draw_state.state.photos && puts[2].draw_state.state.photos.length === 2 &&
  puts[2].draw_state_keep && puts[2].draw_state_keep.join() === 'img64',
  puts[2] ? 'keep=' + JSON.stringify(puts[2].draw_state_keep) : '');

// ── the job moves under us ───────────────────────────────────────
refuse = true;
await pg.evaluate(() => { DRAW.lines.push({ type:'hip', pts:[[100,100],[120,200]] }); });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
const modal = await pg.evaluate(() => {
  const m = document.getElementById('jobMovedModal');
  return { there: !!m, text: m ? m.textContent.replace(/\s+/g, ' ') : '' };
});
check('THE FIX: a refused save asks instead of writing over the other version', modal.there, modal.text.slice(0, 80));
check('…saying who and when', /another device/i.test(modal.text) && /Nikki Barrett/.test(modal.text) && /08:05|8:05/.test(modal.text),
  modal.text.slice(0, 160));
check('…with both ways out on offer', await pg.isVisible('#jobMovedReload') && await pg.isVisible('#jobMovedOverwrite'));
check('…and autosave stands down while it is open', await pg.evaluate(() => S._jobConflict === true));
const before = puts.length;
await pg.evaluate(() => _runAutosave());
await pg.waitForTimeout(500);
check('…so the same question is not asked again two seconds later', puts.length === before, (puts.length - before) + ' more saves');

// ── keep mine ────────────────────────────────────────────────────
await pg.click('#jobMovedOverwrite');
await pg.waitForTimeout(800);
const forced = puts[puts.length - 1];
check('"Keep mine" saves again without the timestamp, so it goes through', puts.length === before + 1 &&
  !('base_updated_at' in forced), forced ? Object.keys(forced).join(',') : '');
check('…and sends everything fresh, photos included — their photos are not mixed into mine',
  !!forced && !forced.draw_state_keep && forced.draw_state.state.img64 === AERIAL && forced.draw_state.state.photos.length === 2,
  forced ? 'keep=' + JSON.stringify(forced.draw_state_keep) : '');
check('…and the question is gone', !(await pg.evaluate(() => !!document.getElementById('jobMovedModal'))) &&
  await pg.evaluate(() => S._jobConflict === false));

// ── load theirs ──────────────────────────────────────────────────
refuse = true;
await pg.evaluate(() => { DRAW.lines.push({ type:'valley', pts:[[400,100],[380,200]] }); });
const mine = await pg.evaluate(() => DRAW.lines.length);
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
check('a second refusal asks again', await pg.evaluate(() => !!document.getElementById('jobMovedModal')));
const n0 = puts.length;
await pg.click('#jobMovedReload');
await pg.waitForTimeout(800);
check('"Load their version" loads the server\'s copy in place of mine',
  (await pg.evaluate(() => DRAW.lines.length)) === 0 && mine > 0, 'had ' + mine + ' lines, now ' + (await pg.evaluate(() => DRAW.lines.length)));
check('…without saving mine over the top on the way', puts.length === n0, (puts.length - n0) + ' saves');
check('…and remembers the new timestamp, so the next save is against THEIR version',
  (await pg.evaluate(() => S._jobLoaded && S._jobLoaded.updatedAt)) === serverStamp,
  await pg.evaluate(() => S._jobLoaded && S._jobLoaded.updatedAt));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
