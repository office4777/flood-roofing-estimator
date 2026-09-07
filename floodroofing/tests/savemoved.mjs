// Two people on one job, from the roofer's side of the screen.
//
// The office opens a job on the desktop; someone opens the same job onsite.
// Both autosave. The last save used to win, silently, and the other person
// found out at quoting time. Now a save carries the updated_at the job was
// opened with; when the server says the row has moved, the app stops and
// decides: this screen's version is saved over the top, an empty canvas never
// writes over a drawn one, and a customer acceptance is carried across.
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
  // The quote's own save moves the job's stamp and hands the new one back.
  if (/\/jobs\/job-77\/quote$/.test(u) && m === 'PUT'){
    serverStamp = '2026-09-02T09:30:00.000Z';
    return j(200, { ok: true, id: 'job-77', updated_at: serverStamp });
  }
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
// A saved job opens locked (tests/joblock.mjs); this suite is about saving.
await pg.evaluate(() => { S.jobLocked = false; _jobLockRender(); });

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
// It used to stop and ask ("This job was changed on another device"), and the
// question came up on nearly every quote — the "other device" was the
// roofer's own phone, or the customer opening the quote. Now the app decides:
// what is on THIS screen wins and is saved over the top, with two rules.
refuse = true;
await pg.evaluate(() => { DRAW.lines.push({ type:'hip', pts:[[100,100],[120,200]] }); });
const nM = puts.length;
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(900);
check('THE FIX: a refused save no longer asks', !(await pg.evaluate(() => !!document.getElementById('jobMovedModal'))));
const forced = puts[puts.length - 1];
check('…it saves again straight away, against the server\'s own stamp, so it goes through',
  puts.length === nM + 2 && forced.base_updated_at === new Date(Date.parse(serverStamp) - 60000).toISOString(),
  puts.length - nM + ' saves, base=' + (forced && forced.base_updated_at) + ' vs ' + serverStamp);
check('…keeping the drawing on this screen', !!forced && forced.draw_state.draw.lines.length === 2,
  forced ? forced.draw_state.draw.lines.length + ' lines' : '');
check('…and autosave carries on', await pg.evaluate(() => !S._jobConflict));

// Rule 1: what the customer did to the quote in the meantime is carried, not
// lost — an autosave from the office cannot un-accept a quote.
JOB.draw_state.state.quote = { ref: 'Q-1', share: { token: 'tok9', status: 'accepted', events: [{ kind: 'accept', at: '2026-09-02T08:04:00Z' }] },
  accepted: { at: '2026-09-02T08:04:00Z', by: 'Nikki' } };
refuse = true;
await pg.evaluate(() => { S.quote = S.quote || {}; S.quote.share = { token: 'tok9', status: 'sent', events: [] }; DRAW.lines.push({ type:'valley', pts:[[400,100],[380,200]] }); });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(900);
const carried = puts[puts.length - 1];
check('a customer acceptance that landed meanwhile is carried into the save',
  !!carried && carried.draw_state.state.quote && carried.draw_state.state.quote.accepted && carried.draw_state.state.quote.accepted.by === 'Nikki' &&
  carried.draw_state.state.quote.share.status === 'accepted',
  carried ? JSON.stringify(carried.draw_state.state.quote).slice(0, 160) : '');
check('…with the drawing still mine', !!carried && carried.draw_state.draw.lines.length === 3);
delete JOB.draw_state.state.quote;

// Rule 2: an empty canvas never writes over a drawn one. The server has a
// roof; this screen has nothing — theirs is loaded instead.
refuse = true;
await pg.evaluate(() => { DRAW.outline = []; DRAW.lines = []; DRAW.roofs = []; });
const nE = puts.length;
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(900);
check('an empty canvas does not write over the drawn one on the server',
  puts.length === nE + 1, (puts.length - nE) + ' saves after the refusal');
check('…the drawn one is loaded in its place', (await pg.evaluate(() => DRAW.outline.length)) === 4,
  'outline now ' + (await pg.evaluate(() => DRAW.outline.length)) + ' corners');
check('…and the next save is against that version',
  (await pg.evaluate(() => S._jobLoaded && S._jobLoaded.updatedAt)) === serverStamp);

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
// ── the quote's own save must not turn the next job save into a "conflict" ──
// Sending a quote saves it through its own route, which stamps the job. The
// office then got "This job was changed on another device — someone saved
// Sharon Thomson at 01:08 pm" on every job they opened and quoted: the
// someone was their own quote save, and the job save was still carrying the
// stamp from when the job was opened.
const nQ = puts.length;
await pg.evaluate(async () => { S.quote = S.quote || {}; S.quote.client = 'Nikki Barrett'; await _publishQuoteOnly(); });
await pg.waitForTimeout(300);
check('the quote save hands the app the job\'s new stamp',
  (await pg.evaluate(() => S._jobLoaded && S._jobLoaded.updatedAt)) === '2026-09-02T09:30:00.000Z',
  await pg.evaluate(() => JSON.stringify(S._jobLoaded)));
await pg.evaluate(() => { DRAW.lines.push({ type:'ridge', pts:[[130,240],[390,240]] }); });
await pg.evaluate(() => saveCurrentJob());
await pg.waitForTimeout(600);
const afterQuote = puts[puts.length - 1];
check('…and the next job save carries that stamp, so it is not refused as a conflict with yourself',
  puts.length === nQ + 1 && afterQuote.base_updated_at === '2026-09-02T09:30:00.000Z',
  puts.length + ' saves, base=' + (afterQuote && afterQuote.base_updated_at));

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
