// AI TENDERING, THE TAB (Phase 1, 2026-10-23): the third job type behind
// the per-company flag, the nav entry that shows only on a tender job, the
// upload that goes straight to storage on a signed URL, the progress bar
// while the reader works, and the sheet index the office can correct.
// The real app.html + tender.js in Playwright, the API stubbed in-page.
import { chromium } from 'playwright';
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ('  — ' + d) : '')); }

const b = await chromium.launch();
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());

// The API, in memory. `calls` is what the pins read.
const calls = [];
const TENDER = { id: 'tn-1', company_id: 'c1', user_id: 'u1', job_id: null, name: 'Tender', status: 'new', settings: {}, sheet_index: null, files: [], pages: [], tasks: [], ai: true };
let progressTicks = 0;
let flagOn = true;
let liveOn = null;   // the server's per-login answer, when it differs from the business flag
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const req = r.request();
  const u = new URL(req.url());
  const p = u.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch (e) {}
  calls.push({ m, p, body });
  const j = (x, status) => r.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(p)) return j({ user_id: 'u1', branding: { company_name: 'Flood Roofing Ltd', ai_tendering_enabled: flagOn, phone: '09 430 1234', email: 'office@floodroofing.co.nz' }, quote_defaults: { next_job_no: '06121' }, jms_keys: {} });
  if (p === '/tender' && m === 'POST') { TENDER.name = body.name; TENDER.job_id = body.job_id; return j(TENDER); }
  if (p === '/tender/tn-1' && m === 'GET') return j(TENDER);
  if (p === '/tender/tn-1' && m === 'PUT') { Object.assign(TENDER, body); return j(TENDER); }
  if (p === '/tender/tn-1/files/sign') {
    if (!/\.pdf$/i.test(body.name)) return j({ error: 'Only PDF plan sets can be uploaded here.', code: 'NOT_PDF' }, 400);
    const fid = 'f-' + (TENDER.files.length + 1);
    TENDER.files.push({ id: fid, name: body.name, size: body.size, mime: body.mime, status: 'pending', pages: 0, error: '' });
    return j({ fileId: fid, signedUrl: 'https://stub.storage.test/obj/c1/tn-1/' + fid + '/' + encodeURIComponent(body.name) + '?token=t', token: 't', path: 'c1/tn-1/' + fid + '/' + body.name });
  }
  const lm = /^\/tender\/tn-1\/files\/(f-\d+)\/landed$/.exec(p);
  if (lm) { const f = TENDER.files.find(x => x.id === lm[1]); f.status = 'landed'; if (body.run) { TENDER.status = 'queued'; TENDER.tasks = [{ id: 't-1', status: 'queued', progress: {} }]; } return j({ ok: true, fileId: f.id, task: { id: 't-1', status: 'queued' } }); }
  if (p === '/tender/tn-1/progress') {
    progressTicks++;
    if (TENDER.status === 'queued' || TENDER.status === 'processing') {
      if (progressTicks === 1) { TENDER.status = 'processing'; TENDER.tasks = [{ id: 't-1', status: 'running', progress: { stage: 'ingest', file: 'Whangaroa set A.pdf', pageNo: 3, pagesDone: 2, pagesTotal: 6 } }]; }
      else if (progressTicks === 2) { TENDER.tasks = [{ id: 't-1', status: 'running', progress: { stage: 'classify', done: 4, total: 6 } }]; }
      else { finish(); }
    }
    return j({ status: TENDER.status, task: TENDER.tasks[0] || null, pages: TENDER.pages.length, classified: TENDER.pages.length, files: TENDER.files });
  }
  const im = /^\/tender\/tn-1\/pages\/(p-\d+)\/image$/.exec(p);
  if (im) return j({ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', expiresIn: 900 });
  const pm = /^\/tender\/tn-1\/pages\/(p-\d+)$/.exec(p);
  if (pm && m === 'PUT') {
    const pgx = TENDER.pages.find(x => x.id === pm[1]);
    Object.assign(pgx, body, { cls_source: 'user' });
    const s = TENDER.sheet_index.sheets.find(x => x.pageId === pgx.id); if (s) { s.cls = pgx.cls; s.title = pgx.title; }
    return j({ ok: true, page: pgx, sheet_index: TENDER.sheet_index });
  }
  if (p === '/tender/tn-1/run') { TENDER.status = 'queued'; progressTicks = 0; return j({ ok: true, task: { id: 't-2', status: 'queued' } }); }
  if (/^\/tender\/enabled/.test(p)) return j({ enabled: liveOn == null ? flagOn : liveOn, ai: true });
  return j([]);
});
function finish(){
  TENDER.status = 'indexed';
  TENDER.files.forEach(f => { f.status = 'ingested'; f.pages = 3; });
  const mk = (id, n, sid, title, rev, cls, src, conf, agree) => ({ id, file_id: 'f-1', page_no: n, sheet_id: sid, title, revision: rev, scale: '1:100', cls, cls_conf: conf, cls_source: src, text_chars: 120, has_image: true, has_thumb: true, has_tb: true, agree });
  TENDER.pages = [ mk('p-1', 1, 'AO-00', 'COVER SHEET', 'C', 'cover', 'ai', 0.95, true), mk('p-2', 2, 'AO-05', 'ROOF PLAN', 'C', 'roof_plan', 'ai', 0.93, true), mk('p-3', 3, 'AO-05', 'ROOF PLAN', 'B', 'roof_plan', 'ai', 0.9, true), mk('p-4', 4, '', '', '', 'other', 'heuristic', 0.3, true) ];
  TENDER.sheet_index = { builtAt: new Date().toISOString(),
    sheets: [ { pageId: 'p-1', sheetId: 'AO-00', title: 'COVER SHEET', revision: 'C', cls: 'cover', superseded: [] }, { pageId: 'p-2', sheetId: 'AO-05', title: 'ROOF PLAN', revision: 'C', cls: 'roof_plan', superseded: [{ pageId: 'p-3', revision: 'B' }] } ],
    unnumbered: [ { pageId: 'p-4', pageNo: 4, cls: 'other' } ], register: [ { sheetId: 'AO-06', title: 'ROOF DETAILS', revision: 'C' } ], missing: [ { sheetId: 'AO-06', title: 'ROOF DETAILS' } ],
    warnings: [ { kind: 'superseded', sheetId: 'AO-05', text: 'Sheet AO-05 is in the set at revisions C, B; revision C is used.' }, { kind: 'missing', text: 'The drawing register lists 1 sheet not in the files: AO-06.' } ],
    counts: { cover: 1, roof_plan: 1, other: 1 }, roofRelevant: ['p-2'] };
  TENDER.tasks = [{ id: 't-1', status: 'done', progress: { stage: 'done' } }];
}
// The storage stand-in the signed PUT lands on.
const puts = [];
await pg.route('**/stub.storage.test/**', async r => { puts.push({ url: r.request().url(), size: (r.request().postDataBuffer() || Buffer.alloc(0)).length, ct: r.request().headers()['content-type'] }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"x"}' }); });

await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'sam@floodroofing.co.nz', name: 'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'Flood Roofing Ltd' }));
  window.__TENDER_POLL_MS = 600; });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });

// ── the job type ────────────────────────────────────────────────────
let r = await pg.evaluate(() => { openJobDetailsModal('new'); const b = document.getElementById('jtBtn_tender'); return { avail: _tenderingAvailable(), shown: !!b && b.style.display !== 'none', nav: document.getElementById('navTenderBtn').style.display, pending: window._pendingJobType }; });
check('with the flag on, the job details offer AI Tendering as a third type', r.avail && r.shown && r.pending === 'roofing', JSON.stringify(r));
check('…and the nav entry is hidden on a roofing job', r.nav === 'none');
r = await pg.evaluate(() => { _setJobType('tender'); const b = document.getElementById('jtBtn_tender'); return { pending: window._pendingJobType, kind: S.quote && S.quote.quoteKind, lit: b.style.background !== 'transparent', nav: document.getElementById('navTenderBtn').style.display, roofingLit: document.getElementById('jtBtn_roofing').style.background !== 'transparent' }; });
// A new job has no quote yet, so the kind and the nav entry follow at Start; on an open job both move at once.
check('picking it lights the button and sets the pending kind', r.pending === 'tender' && r.lit && !r.roofingLit && (r.kind == null || (r.kind === 'tender' && r.nav !== 'none')), JSON.stringify(r));
await pg.evaluate(() => { document.getElementById('jobClient').value = 'Whangaroa Community Hall'; document.getElementById('jobAddr').value = '12 Hall Road, Kaeo'; jobDetailsPrimary(); });
await pg.waitForTimeout(900);
r = await pg.evaluate(() => ({ tab: document.body.getAttribute('data-tab'), tid: S.quote.tenderId, root: (document.getElementById('tenderRoot') || {}).innerText || '' }));
check('Start lands on the AI Tendering tab and the tender is made behind the job', r.tab === 'tender' && r.tid === 'tn-1' && /Drop the plan-set PDFs/.test(r.root), JSON.stringify([r.tab, r.tid]));
const made = calls.find(c => c.p === '/tender' && c.m === 'POST');
check('the tender is named for the job', made && /Whangaroa Community Hall/.test(made.body.name), JSON.stringify(made && made.body));
r = await pg.evaluate(() => { gotoTab('quote'); _qkMenuRender(); const b = document.getElementById('qkBtn_tender'); return { there: !!b, on: b && b.classList.contains('qk-on') }; });
check('the Quote tab\'s More menu carries the type too, ticked', r.there && r.on, JSON.stringify(r));
await pg.evaluate(() => gotoTab('tender'));
await pg.waitForTimeout(500);

// ── the upload ──────────────────────────────────────────────────────
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
await pg.setInputFiles('#tnFile', [ { name: 'Whangaroa set A.pdf', mimeType: 'application/pdf', buffer: pdfBytes }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } ]);
await pg.waitForTimeout(900);
const sign = calls.filter(c => /files\/sign$/.test(c.p));
check('a PDF is signed for, a .txt is not sent at all', sign.length === 1 && sign[0].body.name === 'Whangaroa set A.pdf' && sign[0].body.size === pdfBytes.length, JSON.stringify(sign.map(s => s.body)));
check('the file is PUT straight to the signed storage URL with its bytes', puts.length === 1 && /stub\.storage\.test\/obj\/c1\/tn-1\/f-1\//.test(puts[0].url) && puts[0].size === pdfBytes.length && /pdf/.test(puts[0].ct), JSON.stringify(puts));
const landed = calls.find(c => /landed$/.test(c.p));
check('then the server is told it landed, and to start reading', landed && landed.body.run === true, JSON.stringify(landed));
r = await pg.evaluate(() => (document.getElementById('tenderRoot') || {}).innerText || '');
check('the file is listed and the reader\'s progress is on screen', /Whangaroa set A\.pdf/.test(r) && /(Waiting|Reading|Working out)/.test(r), r.slice(0, 300).replace(/\n/g, ' | '));
await pg.waitForTimeout(1400);
r = await pg.evaluate(() => (document.getElementById('tenderRoot') || {}).innerText || '');
check('progress reads page-by-page, then the classifier', progressTicks >= 2, String(progressTicks));
await pg.waitForTimeout(1200);
r = await pg.evaluate(() => {
  const root = document.getElementById('tenderRoot');
  const rows = [...root.querySelectorAll('tr[data-page]')].map(tr => ({ id: tr.getAttribute('data-page'), sid: tr.querySelector('input.id').value, title: tr.querySelector('input.ttl').value, cls: tr.querySelector('select').value, roofy: tr.classList.contains('roofy'), sup: !!tr.querySelector('.tn-sup') }));
  return { text: root.innerText, rows, pill: (root.querySelector('.tn-pill') || {}).textContent, thumbs: [...root.querySelectorAll('img[data-thumb]')].filter(i => i.src).length };
});
check('once indexed the table lists the latest sheet per id, then unnumbered pages', r.rows.length === 3 && r.rows[0].sid === 'AO-00' && r.rows[1].sid === 'AO-05' && r.rows[1].cls === 'roof_plan' && r.rows[2].sid === '', JSON.stringify(r.rows));
check('the roof plan row is shaded as roof-relevant and notes the superseded revision', r.rows[1].roofy && r.rows[1].sup && !r.rows[0].roofy);
check('the warnings and the missing sheet are said', /revisions C, B/.test(r.text) && /not in the files: AO-06/.test(r.text) && /In the drawing register but not in the files/.test(r.text) && /AO-06 ROOF DETAILS/.test(r.text));
check('the status pill reads Indexed and the thumbnails were fetched', /Indexed/.test(r.pill) && r.thumbs === 3, r.pill + ' ' + r.thumbs);

// ── correcting a page ───────────────────────────────────────────────
await pg.selectOption('tr[data-page="p-1"] select', 'index');
await pg.waitForTimeout(400);
const put = calls.find(c => c.m === 'PUT' && /pages\/p-1$/.test(c.p));
check('changing a class PUTs the correction', put && put.body.cls === 'index', JSON.stringify(put && put.body));
r = await pg.evaluate(() => { const tr = document.querySelector('tr[data-page="p-1"]'); return { cls: tr.querySelector('select').value, src: tr.querySelector('.tn-src').textContent }; });
check('…and the row shows it as yours', r.cls === 'index' && /you/.test(r.src), JSON.stringify(r));
await pg.fill('tr[data-page="p-2"] input.ttl', 'ROOF PLAN - PROPOSED');
await pg.press('tr[data-page="p-2"] input.ttl', 'Tab');
await pg.waitForTimeout(400);
const put2 = calls.find(c => c.m === 'PUT' && /pages\/p-2$/.test(c.p));
check('a retyped title is sent', put2 && put2.body.title === 'ROOF PLAN - PROPOSED', JSON.stringify(put2 && put2.body));

// ── the flag off: nothing offered, a tender job falls back ──────────
flagOn = false;
r = await pg.evaluate(() => { window.__TENDERING_ON = false; openJobDetailsModal('new'); const b = document.getElementById('jtBtn_tender'); const r = { shown: b.style.display !== 'none', pending: window._pendingJobType }; closeJobDetailsModal(); _setJobType('tender'); r.kindAfter = S.quote.quoteKind; _tenderNavSync(); r.nav = document.getElementById('navTenderBtn').style.display; r.tab = document.body.getAttribute('data-tab'); return r; });
check('with the flag off the type is not offered and cannot be set', !r.shown && r.kindAfter === 'roofing' && r.nav === 'none' && r.tab !== 'tender', JSON.stringify(r));
// A login let in by name: the business flag is off, the server says yes for this person.
liveOn = true;
r = await pg.evaluate(async () => { window.__TENDERING_ON = null; if (S.settings && S.settings.branding) S.settings.branding.ai_tendering_enabled = false;
  await window._tenderEnabledCheck(); openJobDetailsModal('new'); const b = document.getElementById('jtBtn_tender');
  const out = { avail: _tenderingAvailable(), shown: b.style.display !== 'none', kept: JSON.parse(localStorage.getItem('fr_tender_on') || 'null') }; closeJobDetailsModal(); return out; });
check('a login the server names gets the type with its business switched off, and the answer is kept for a reload', r.avail && r.shown && r.kept && r.kept.on === true && r.kept.who === 'sam@floodroofing.co.nz', JSON.stringify(r));
liveOn = false;
r = await pg.evaluate(async () => { await window._tenderEnabledCheck(); return { avail: _tenderingAvailable(), kept: JSON.parse(localStorage.getItem('fr_tender_on') || 'null') }; });
check('…and a login the server says no to does not', !r.avail && r.kept.on === false, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
