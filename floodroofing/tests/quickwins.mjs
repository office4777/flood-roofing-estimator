// Scott's "quick wins" batch, 2026-10-13 (info@wellingtonroof.co.nz, relayed
// by the owner). Four things a roofer could not do:
//
//  1. LABEL AN APRON FROM THE MAP. Clicking a line on the canvas opens
//     promptLineMeasurement's popup, whose type list held seven plain types —
//     no apron, no change of pitch, no subtypes — while the sidebar editor
//     offered all of them. A head apron the app had drawn read "Unknown" and
//     there was no way to say what it was without finding the sidebar.
//  2. FIND A SAVED JOB BY ITS NUMBER. Both search boxes matched client +
//     address only, and GET /jobs never sent a job number at all, so there
//     was nothing to match — though the Home box's placeholder has always
//     said "client, address or job number".
//  3. PRINT THE SHEET CALC CHECK WITH THE JOB PACK. It was only ever a
//     picture to place by hand from the Maps panel.
//  4. READ THE MAP'S DETAIL LABELS. A penetration's size (9px), its back-tray
//     (8px) and a clearlite's length (10px) were hard-coded, while the
//     measurements and the sheet lengths each had a slider.
//
// And SAVE IN EVERY VIEW: the left menu is on every tab, so Save is now.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report41.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// ── The server half: GET /jobs carries the job's own number ──────────
{
  const { startFakePostgrest } = await import('./fakepgrst.mjs');
  const { pathToFileURL } = await import('node:url');
  const { createRequire } = await import('node:module');
  const require = createRequire(_j(_ROOT, 'backend') + '/');
  const jwt = require('jsonwebtoken');
  const U = 'user-a', C = 'company-a';
  const job = (id, ref, upd) => ({
    id, user_id: U, company_id: C,
    client_name: id === 'j1' ? 'Beth Williamson' : 'No Ref',
    site_address: id === 'j1' ? '1 Test Rd' : '2 Test Rd',
    created_at: '2026-10-01T00:00:00.000Z', updated_at: upd, status: 'draft',
    order_sent: null,
    draw_state: { state: ref == null ? {} : { quote: { ref } } },
  });
  const { port } = await startFakePostgrest({
    profiles: [{ id: U, company_id: C }],
    company_users: [{ company_id: C, user_id: U, role: 'owner' }],
    user_settings: [], invoices: [],
    jobs: [ job('j1', '03287', '2026-10-02T00:00:00.000Z'),
            job('j2', null,    '2026-10-01T00:00:00.000Z') ],
  });
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
  process.env.SUPABASE_SERVICE_KEY = 'k';
  process.env.JWT_SECRET = 'test-secret';
  const PORT = process.env.TEST_PORT || '34731';
  process.env.PORT = PORT;
  delete process.env.DATABASE_URL;
  const log = console.log; console.log = () => {};
  await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
  console.log = log;
  await new Promise(r => setTimeout(r, 700));
  const tok = jwt.sign({ id: U, email: 'a@x.co.nz', cid: C }, 'test-secret');
  const rows = await (await fetch('http://127.0.0.1:' + PORT + '/jobs',
    { headers: { Authorization: 'Bearer ' + tok } })).json();
  const byId = {}; (Array.isArray(rows) ? rows : []).forEach(j => { byId[j.id] = j; });
  const r1 = byId['j1'] || {}, r2 = byId['j2'] || {};
  check('GET /jobs sends the job number off the quote ref',
    r1.job_no === '03287', JSON.stringify(r1.job_no));
  check('GET /jobs still sends the client and the address',
    r1.client_name === 'Beth Williamson' && r1.site_address === '1 Test Rd');
  check('the multi-megabyte draw_state is NOT dragged along with it',
    r1.draw_state === undefined, JSON.stringify(Object.keys(r1)));
  // The list PRINTS this value, so a job with no ref must read as a blank and
  // never as "null" or "undefined".
  check('a job with no quote ref reads as an empty string',
    r2.job_no === '', JSON.stringify(r2.job_no));
}

// ── The app half ─────────────────────────────────────────────────────
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

await pg.evaluate((g) => {
  gotoTab('roof');
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map((r, i) => Object.assign({}, r, {
    name: i === 0 ? 'Main Roof' : 'Roof ' + (i + 1),
    lines: (r.lines || []).map(l => Object.assign({}, l))
  }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); _renderRoofMenuBar(); } catch(e){}
  try { _fergusPanelClose(); } catch(e){}
}, GEOM);
await pg.waitForTimeout(500);

// ── 1. The map popup can say "apron" ────────────────────────────────
{
  const r = await pg.evaluate(() => {
    // A line the app drew and could not name: give it the type an auto barge
    // has and open the popup the canvas opens.
    DRAW.lines.push({ type:'unknown', pts:[[100,100],[300,100]], planM:4.0 });
    const i = DRAW.lines.length - 1;
    promptLineMeasurement(i);
    const sel = document.getElementById('lineMeasTypeSelect');
    const vals = sel ? Array.from(sel.options).map(o => o.value) : [];
    const labels = sel ? Array.from(sel.options).map(o => o.textContent) : [];
    // The sidebar's own list, for comparison — the two must offer the same
    // things or the roofer's answer depends on where they clicked.
    const side = document.getElementById('editLineType');
    const sideVals = side ? Array.from(side.options).map(o => o.value) : [];
    return { i, vals, labels, sideVals };
  });
  check('the map popup offers a head apron', r.vals.includes('apron|head'), r.vals.join(','));
  check('the map popup offers a side apron', r.vals.includes('apron|side'));
  check('the map popup offers a change of pitch', r.vals.includes('changepitch'));
  check('the map popup offers the barge subtypes',
    ['barge|side','barge|starter','barge|finish','barge|head'].every(v => r.vals.includes(v)));
  check('the map popup reads "Head apron", not "Apron|head"',
    r.labels.includes('Head apron') && r.labels.includes('Side apron'));
  // Every type the sidebar offers, the map offers.
  const missing = r.sideVals.filter(v => !r.vals.includes(v));
  check('the map offers every type the sidebar does', missing.length === 0, 'missing ' + missing.join(','));

  const saved = await pg.evaluate((i) => {
    const sel = document.getElementById('lineMeasTypeSelect');
    sel.value = 'apron|head';
    document.getElementById('lineMeasInput').value = '';   // type only, no figure
    confirmLineMeas();
    const l = DRAW.lines[i];
    return { type:l.type, subtype:l.subtype, measM:l.measM };
  }, r.i);
  check('picking a head apron writes the type', saved.type === 'apron', saved.type);
  check('picking a head apron writes the SUBTYPE the cut list splits on',
    saved.subtype === 'head', String(saved.subtype));
  // An apron lies level, so a 4.00 m plan length is 4.00 m of flashing — not
  // the raked length a barge would have had.
  check('the metres are re-derived at the new type’s slope factor',
    Math.abs((saved.measM || 0) - 4.0) < 0.02, String(saved.measM));

  // ...and a plain type still clears the subtype rather than leaving a stale one.
  const plain = await pg.evaluate((i) => {
    promptLineMeasurement(i);
    document.getElementById('lineMeasTypeSelect').value = 'ridge';
    document.getElementById('lineMeasInput').value = '';
    confirmLineMeas();
    const l = DRAW.lines[i];
    return { type:l.type, hasSub:('subtype' in l) };
  }, r.i);
  check('a plain type clears the subtype', plain.type === 'ridge' && !plain.hasSub);

  // Re-opening shows what the line IS, subtype and all.
  const reopen = await pg.evaluate((i) => {
    DRAW.lines[i].type = 'apron'; DRAW.lines[i].subtype = 'head';
    promptLineMeasurement(i);
    return document.getElementById('lineMeasTypeSelect').value;
  }, r.i);
  check('re-opening a head apron shows it selected', reopen === 'apron|head', reopen);
  await pg.evaluate(() => { closeLineMeasPopup(); DRAW.lines.pop(); redrawAll(); });
}

// ── 2. A saved job is found by its number ───────────────────────────
{
  const r = await pg.evaluate(() => {
    const J = { id:'j1', client_name:'Beth Williamson', site_address:'1 Test Rd', job_no:'03287' };
    return {
      byNumber:      _savedJobMatches(J, '3287'),
      byPaddedNumber:_savedJobMatches(J, '03287'),
      byClient:      _savedJobMatches(J, 'beth'),
      byAddress:     _savedJobMatches(J, 'test rd'),
      blankMatchesAll:_savedJobMatches(J, ''),
      wrongNumber:   _savedJobMatches(J, '9999'),
      wrongName:     _savedJobMatches(J, 'phyllis'),
      noNumberOnJob: _savedJobMatches({ client_name:'X', site_address:'Y' }, '3287')
    };
  });
  check('a saved job is found by its job number', r.byNumber);
  check('...and by the number with its leading zero', r.byPaddedNumber);
  check('the client still finds it', r.byClient);
  check('the address still finds it', r.byAddress);
  check('an empty search still lists everything', r.blankMatchesAll);
  check('another job’s number does not find it', !r.wrongNumber);
  check('another client’s name does not find it', !r.wrongName);
  check('a job with no number is not found by a number', !r.noNumberOnJob);

  // The Home type-ahead and the Select Job table both run through it, and both
  // SHOW the number they can now be searched by.
  const painted = await pg.evaluate(() => {
    window._selectJobsCache = [
      { id:'j1', client_name:'Beth Williamson', site_address:'1 Test Rd', job_no:'03287' },
      { id:'j2', client_name:'Phyllis Jones',   site_address:'2 Other St', job_no:'03288' }
    ];
    _hbPaintSearch('3287');
    const drop = document.getElementById('homeJobSearchDrop');
    const html = drop ? drop.innerHTML : '';
    return { hasBeth: html.includes('Beth Williamson'), hasPhyllis: html.includes('Phyllis'),
             showsNo: html.includes('#03287') };
  });
  check('typing a job number into Home finds that job', painted.hasBeth);
  check('...and only that job', !painted.hasPhyllis);
  check('the Home result shows the job number', painted.showsNo);

  const table = await pg.evaluate(() => {
    window._jobsCache = {
      jobs: [
        { id:'j1', client_name:'Beth Williamson', site_address:'1 Test Rd', job_no:'03287', updated_at:'2026-10-02' },
        { id:'j2', client_name:'Phyllis Jones',   site_address:'2 Other St', job_no:'03288', updated_at:'2026-10-01' }
      ], actById:{}
    };
    const host = document.createElement('div'); host.id = 'jobsTableWrap';
    document.body.appendChild(host);
    _renderJobsTable('3288');
    const one = host.innerHTML;
    _renderJobsTable('');
    const all = host.innerHTML;
    host.remove();
    return { one, hasHeader: all.includes('Job N°'), showsNo: all.includes('03287') };
  });
  check('the Select Job table finds a job by its number',
    table.one.includes('Phyllis') && !table.one.includes('Beth'));
  check('the Select Job table has a Job N° column', table.hasHeader);
  check('...and prints the number in it', table.showsNo);
}

// ── 3. The Sheet calc check is a page of the job pack ───────────────
{
  const r = await pg.evaluate(() => {
    const types = _jpPageTypes().map(t => t.value);
    const defaults = _jpDefaultPages().map(p => p.type);
    return { types, defaults };
  });
  check('Sheet calc check is a page type', r.types.includes('calccheck'), r.types.join(','));
  check('a new job pack carries it', r.defaults.includes('calccheck'), r.defaults.join(','));
  check('...after the cut lists it checks',
    r.defaults.indexOf('calccheck') > r.defaults.indexOf('cutlists'));

  // An existing pack still on the shipped shape gets it; one the office has
  // arranged, or one already showing the check, is left exactly as it is.
  const mig = await pg.evaluate(() => {
    const run = (pages, version) => {
      S.jobPack = { pages: JSON.parse(JSON.stringify(pages)), pagesVersion: version };
      const st = _jpState();
      return { types: st.pages.map(p => p.type), v: st.pagesVersion };
    };
    return {
      untouched: run([{ type:'header', images:[] }, { type:'cutlists' }], 6),
      arranged:  run([{ type:'header', images:[] }, { type:'notes' }, { type:'cutlists' }], 6),
      placed:    run([{ type:'header', images:[{ id:'i1', mapKey:'calccheck:all' }] }, { type:'cutlists' }], 6),
      already:   run([{ type:'header', images:[] }, { type:'cutlists' }, { type:'calccheck' }], 6),
      again:     run([{ type:'header', images:[] }, { type:'cutlists' }], 7)
    };
  });
  check('an untouched pack gains the check',
    mig.untouched.types.join(',') === 'header,cutlists,calccheck', mig.untouched.types.join(','));
  check('a pack the office arranged is left alone',
    mig.arranged.types.join(',') === 'header,notes,cutlists', mig.arranged.types.join(','));
  check('a pack already showing the check as a picture is left alone',
    mig.placed.types.join(',') === 'header,cutlists', mig.placed.types.join(','));
  check('a pack that already has the page does not get a second one',
    mig.already.types.filter(t => t === 'calccheck').length === 1);
  check('the migration runs once', mig.again.types.join(',') === 'header,cutlists');
  check('the pack is stamped v7', mig.untouched.v === 7, String(mig.untouched.v));

  // The page renders the SAME picture the Maps panel places, which is what
  // keeps the two from disagreeing — including the engine's own "nothing to
  // check yet" card when no sheets have been worked out, so the page never
  // prints a blank box. The HTML note is the guard for a capture that FAILS.
  const drawn = await pg.evaluate(() => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const secs = window._lastSheetSections;

    window._lastSheetSections = [];
    _jpRenderCalcCheck(host, { type:'calccheck' }, 0);
    const empty = host.innerHTML;

    window._lastSheetSections = [
      { roof:'Main Roof', x:0, y:0, w:4, h:6, sheets:5, lenM:6, color:'#dc2626' }
    ];
    _jpRenderCalcCheck(host, { type:'calccheck' }, 0);
    const full = host.innerHTML;

    // A capture that throws (a tainted canvas, say) costs the picture, never
    // the page.
    const real = window._renderCalcCheckCanvas;
    window._renderCalcCheckCanvas = function(){ throw new Error('tainted'); };
    let threw = false, broke = '';
    try { _jpRenderCalcCheck(host, { type:'calccheck' }, 0); broke = host.innerHTML; }
    catch(e){ threw = true; }
    window._renderCalcCheckCanvas = real;

    host.remove();
    window._lastSheetSections = secs;
    return {
      emptyImg: /<img/.test(empty),
      fullImg: /<img[^>]+src="data:image\/png/.test(full),
      titled: /Sheet calc check/.test(full),
      threw, brokeSays: /Nothing to check yet/.test(broke), brokeImg: /<img/.test(broke)
    };
  });
  check('a roof with sections renders the diagram', drawn.fullImg);
  check('nothing worked out yet still renders the engine\u2019s own check card',
    drawn.emptyImg);
  check('the page is titled', drawn.titled);
  check('a capture that throws does not throw out of the page', !drawn.threw);
  check('...it says there is nothing to show instead',
    drawn.brokeSays && !drawn.brokeImg);
}

// ── 4. Save is in every view ────────────────────────────────────────
{
  const r = await pg.evaluate(() => {
    const btn = document.getElementById('navJobSaveBtn');
    if (!btn) return { there:false };
    const box = document.getElementById('navJobBox');
    const nav = document.querySelector('aside');
    const cs = getComputedStyle(btn);
    return {
      there:true,
      inTheMenu: !!(nav && nav.contains(btn)) && !!(box && box.contains(btn)),
      shown: cs.display !== 'none' && cs.visibility !== 'hidden',
      // Every Save button in the app goes through _saveClick, which is what
      // shows the spinner and the green tick.
      viaSaveClick: (btn.getAttribute('onclick') || '').indexOf("_saveClick(this,'job')") >= 0
    };
  });
  check('there is a Save button in the left menu', r.there);
  check('...inside the job box, so it is on every tab', r.inTheMenu);
  check('...and it is shown, even with no job saved yet', r.shown);
  check('it goes through _saveClick like every other Save', r.viaSaveClick);

  // The left menu is one element, so it really is on every tab — walk them.
  const everywhere = await pg.evaluate(() => {
    const out = {};
    ['roof','materials','quote','select'].forEach(function(t){
      try { gotoTab(t); } catch(e){}
      const btn = document.getElementById('navJobSaveBtn');
      out[t] = !!(btn && getComputedStyle(btn).display !== 'none');
    });
    try { gotoTab('roof'); } catch(e){}
    return out;
  });
  check('Save is on Map Roof', everywhere.roof);
  check('Save is on the Job Pack', everywhere.materials);
  check('Save is on the Quote tab', everywhere.quote);
  check('Save is on Home', everywhere.select);
}

// ── 5. The map's detail labels have a size ──────────────────────────
{
  const r = await pg.evaluate(() => {
    const inp = document.getElementById('detailTextScale');
    _setDetailTextScale(2.5);
    const got = _detailTextScale();
    _setDetailTextScale(9);      // out of range
    const capped = _detailTextScale();
    _setDetailTextScale(0.1);
    const floored = _detailTextScale();
    _setDetailTextScale(1);
    return { there: !!inp, got, capped, floored, back: _detailTextScale(),
             stored: localStorage.getItem('fr_detail_text_scale') };
  });
  check('the View menu has a Details text slider', r.there);
  check('it takes a size', Math.abs(r.got - 2.5) < 1e-6, String(r.got));
  check('it is capped at 4×', r.capped === 4, String(r.capped));
  check('it will not go below 0.5×', r.floored === 0.5, String(r.floored));
  check('it is remembered on the device', r.stored === '1', String(r.stored));

  // What it actually sizes: the penetration labels the roofer could not read.
  const fonts = await pg.evaluate(() => {
    const cv = document.getElementById('roofCanvas');
    const ctx = cv.getContext('2d');
    const seen = [];
    const real = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ctx), 'font') ||
      Object.getOwnPropertyDescriptor(ctx, 'font');
    const grab = () => {
      const got = [];
      const origFill = ctx.fillText.bind(ctx);
      ctx.fillText = function(t, x, y){ got.push({ t:String(t), font:ctx.font }); return origFill(t, x, y); };
      try { redrawAll(); } catch(e){}
      ctx.fillText = origFill;
      return got;
    };
    DRAW.penetrations = [{ cx: DRAW.outline[0][0] + 40, cy: DRAW.outline[0][1] + 40,
                           sizeLabel:'100', kind:'pipe' }];
    _setDetailTextScale(1);
    const one = grab().filter(g => g.t === '100')[0];
    _setDetailTextScale(3);
    const three = grab().filter(g => g.t === '100')[0];
    _setDetailTextScale(1);
    DRAW.penetrations = [];
    try { redrawAll(); } catch(e){}
    const px = s => s ? parseFloat(String(s.font).match(/([\d.]+)px/)[1]) : 0;
    return { at1: px(one), at3: px(three) };
  });
  check('a penetration’s size label is drawn', fonts.at1 > 0, String(fonts.at1));
  check('...and the slider makes it bigger',
    fonts.at3 > fonts.at1 * 2.5, fonts.at1 + ' → ' + fonts.at3);
}

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(r => !r).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
