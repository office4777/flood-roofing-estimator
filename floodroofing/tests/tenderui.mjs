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
  if (im) {   // a stand-in A3 sheet, so the plans panel has something to show
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="1188" viewBox="0 0 1680 1188"><rect width="1680" height="1188" fill="#fff"/><rect x="30" y="30" width="1620" height="1128" fill="none" stroke="#222" stroke-width="4"/>' +
      '<rect x="320" y="260" width="760" height="520" fill="none" stroke="#111" stroke-width="6"/><line x1="320" y1="260" x2="580" y2="520" stroke="#111" stroke-width="3"/><line x1="1080" y1="260" x2="820" y2="520" stroke="#111" stroke-width="3"/><line x1="320" y1="780" x2="580" y2="520" stroke="#111" stroke-width="3"/><line x1="1080" y1="780" x2="820" y2="520" stroke="#111" stroke-width="3"/><line x1="580" y1="520" x2="820" y2="520" stroke="#111" stroke-width="4"/>' +
      '<rect x="1300" y="900" width="330" height="240" fill="none" stroke="#222" stroke-width="3"/><text x="1320" y="960" font-family="Arial" font-size="34" font-weight="bold">' + im[1].toUpperCase() + '</text><text x="1320" y="1010" font-family="Arial" font-size="24">ROOF PLAN 1:100</text><text x="560" y="230" font-family="Arial" font-size="28">12.00 m</text></svg>';
    return j({ url: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), expiresIn: 900 });
  }
  const pm = /^\/tender\/tn-1\/pages\/(p-\d+)$/.exec(p);
  if (pm && m === 'PUT') {
    const pgx = TENDER.pages.find(x => x.id === pm[1]);
    Object.assign(pgx, body, { cls_source: 'user' });
    const s = TENDER.sheet_index.sheets.find(x => x.pageId === pgx.id); if (s) { s.cls = pgx.cls; s.title = pgx.title; }
    return j({ ok: true, page: pgx, sheet_index: TENDER.sheet_index });
  }
  if (p === '/tender/tn-1/draft' && m === 'POST') { TENDER.doc = JSON.parse(JSON.stringify(SAMPLE_DOC)); TENDER.status = 'drafted'; TENDER.history = [{ at: new Date().toISOString(), why: 'AI draft' }]; return j({ ok: true, task: { id: 't-3', status: 'queued' } }); }
  if (p === '/tender/tn-1/doc' && m === 'PUT') { TENDER.doc = body.doc; return j({ ok: true, savedAt: new Date().toISOString() }); }
  if (p === '/tender/tn-1/amend' && m === 'POST') {
    const d = JSON.parse(JSON.stringify(body.doc));
    if (body.mode === 'chat' && !body.change && /\?\s*$/.test(body.instruction)) {
      d.chat = (d.chat || []).filter(c => !c.pending).concat([{ who: 'you', text: body.instruction, at: '' }, { who: 'ai', text: 'Yes — two buildings joined by a covered link.', pages: 'A201', kind: 'answer', at: '' }]);
      TENDER.doc = d;
      return j({ ok: true, doc: d, answered: true });
    }
    if (body.mode === 'simplify') d.scope = ['Supply and install the roof', 'Clean up'];
    else d.exclusions = d.exclusions.concat([{ text: 'Spouting', why: 'by the builder' }]);
    d.chat = (d.chat || []).filter(c => !c.pending).concat([{ who: 'you', text: body.mode === 'chat' ? (body.said || body.instruction) : 'Simplify the scope', at: '' }, { who: 'ai', text: 'Done: ' + body.mode, at: '' }]);
    TENDER.doc = d; TENDER.history = [{ at: '', why: body.mode }].concat(TENDER.history || []);
    return j({ ok: true, doc: d });
  }
  if (p === '/tender/tn-1/section' && m === 'POST') {
    const d = JSON.parse(JSON.stringify(body.doc));
    if (body.section === 'org') d.org = { people: [{ id: 'p1', role: 'Director', name: 'Aron Flood', reports_to: '', note: '' }, { id: 'p2', role: 'Project Manager', name: 'Ethan', reports_to: 'p1', note: '' }, { id: 'p3', role: 'Roofing crews', name: '', reports_to: 'p2', note: '4 crews' }], described: true };
    if (body.section === 'terms') { d.quote = d.quote || {}; d.quote.terms = '<p>Payment within 20 days.</p>'; }
    TENDER.doc = d;
    return j({ ok: true, doc: d, summary: 'Changed ' + body.section });
  }
  if (p === '/tender/tn-1/run') { TENDER.status = 'queued'; progressTicks = 0; return j({ ok: true, task: { id: 't-2', status: 'queued' } }); }
  if (/^\/tender\/enabled/.test(p)) return j({ enabled: liveOn == null ? flagOn : liveOn, ai: true });
  return j([]);
});
const SAMPLE_DOC = {
  v: 1, project: { name: 'Whangaroa Community Hall', address: '12 Hall Road, Kaeo', client: 'Northland Builders', architect: 'AO Architects', documents: 'Rev C' },
  roof: { area_m2: 100, pitch: '15°', roof_type: 'gable', job_kind: 'new' },
  items: [
    { id: 'i1', category: 'roofing', description: '0.40 Colorsteel Endura Corrugate', product: 'Colorsteel Endura', profile: 'Corrugate', thickness: '0.40 BMT', material: 'Endura', colour: 'Grey Friars', spec_ref: 'AO-05', source_pages: 'p2', quantity: 100, unit: 'm2', qty_basis: '10 x 10', pb_key: 'sheet:0', unit_cost: 30, cost_source: 'pricebook', pb_label: 'Corrugate' },
    { id: 'i2', category: 'safety_mesh', description: 'Safety mesh', product: '', profile: '', thickness: '', material: '', colour: '', spec_ref: '', source_pages: 'p2', quantity: 100, unit: 'm2', qty_basis: 'as roof', pb_key: '', unit_cost: 4, cost_source: 'estimate' },
  ],
  labour: [ { id: 'l1', task: 'Roofing', man_hours: 40, crew: 2, notes: '' } ],
  scaffold: { needed: true, type: 'edge', notes: '' },
  scope: ['Site set-up', 'Supply and install safety mesh', 'Supply and install the roofing'],
  exclusions: [ { text: 'Purlins', why: 'by the builder' } ], assumptions: ['Access from the street'], rfis: ['Colour to confirm'],
  timeline: [ { id: 't1', phase: 'Set-up', start_day: 0, days: 1, crew: 2 }, { id: 't2', phase: 'Roofing', start_day: 1, days: 3, crew: 2 } ],
  duration_days: 4, confidence_notes: 'Pitch read off the section.',
  rates: { bufferPct: 5, markupPct: 10, leadCost: 50, leadPrice: 170, appCost: 30, appPrice: 95, scaffoldCost: 1800, scaffoldPrice: 2400, platformPct: 25, gstPct: 15 },
  quote: {}, chat: [],
};
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

// ── the tender: drafted, priced, edited, printed (2026-10-27) ──────
r = await pg.evaluate(() => { const b = [...document.querySelectorAll('#tenderRoot button')].find(x => /Draft the tender/.test(x.textContent)); return { there: !!b, text: document.getElementById('tenderRoot').innerText }; });
check('once the set is read the tab offers Draft the tender', r.there, r.text.slice(0, 200));
await pg.evaluate(() => [...document.querySelectorAll('#tenderRoot button')].find(x => /Draft the tender/.test(x.textContent)).click());
await pg.waitForTimeout(700);
const money = (t) => { const m = /\$([\d,]+\.\d\d)/.exec(t || ''); return m ? +m[1].replace(/,/g, '') : null; };
r = await pg.evaluate(() => {
  const root = document.getElementById('tenderRoot');
  const tot = [...root.querySelectorAll('.tn-totals tr')].map(tr => tr.innerText.replace(/\s+/g, ' '));
  return { pill: (root.querySelector('.tn-pill') || {}).textContent, tot, badges: [...root.querySelectorAll('.tn-badge')].map(b => b.textContent), fold: !!root.querySelector('details.tn-fold tr[data-page]'), foldOpen: (root.querySelector('details.tn-fold') || {}).open,
    spec: [...root.querySelectorAll('.tn-spec tbody tr')].length, page: (document.getElementById('tqPage') || {}).innerText || '', gantt: root.querySelectorAll('.tn-g-row').length };
});
check('the drafted tender shows: pill, spec rows, programme', /drafted/i.test(r.pill) && r.spec === 2 && r.gantt === 2, JSON.stringify([r.pill, r.spec, r.gantt]));
check('the sheet index is folded away under the tender', r.fold && !r.foldOpen);
check('each price says where it came from', r.badges.indexOf('Price book') >= 0 && r.badges.indexOf('AI estimate') >= 0, JSON.stringify(r.badges));
const line = (lbl) => money((r.tot.find(t => t.indexOf(lbl) === 0) || ''));
// 3400 cost × 1.05 × 1.10 = 3927; 40 h × (170+95)/2 = 5300; edge scaffold 2400
check('the pricing sheet adds up: materials, labour at the company rates, scaffold', line('Materials') === 3927 && line('Labour') === 5300 && line('Scaffolding') === 2400 && line('Tender price ex GST') === 11627 && line('Total incl GST') === 13371.05, JSON.stringify(r.tot));
check('the tender document carries the project, scope and price', /Whangaroa Community Hall/.test(r.page) && /Supply and install the roofing/.test(r.page) && /\$11,627\.00/.test(r.page) && /Purlins/.test(r.page) && /Set-up/.test(r.page), r.page.slice(0, 400));
// change a quantity in the pricing sheet
calls.length = 0;
await pg.evaluate(() => { const inp = [...document.querySelectorAll('.tn-price input')][0]; inp.value = '120'; inp.dispatchEvent(new Event('change')); });
await pg.waitForTimeout(1200);
r = await pg.evaluate(() => [...document.querySelectorAll('.tn-totals tr')].map(tr => tr.innerText.replace(/\s+/g, ' ')));
const putDoc = calls.filter(c => c.m === 'PUT' && /\/doc$/.test(c.p)).pop();
check('a quantity typed in moves the price', money(r.find(t => /^Tender price ex GST/.test(t))) === 12320, JSON.stringify(r));
check('…and the tender saves itself', putDoc && putDoc.body.doc.items[0].quantity === 120 && putDoc.body.doc.items[0].edited === true, JSON.stringify(putDoc && putDoc.body.doc.items[0]));
r = await pg.evaluate(() => (document.getElementById('tqPage') || {}).innerText);
check('the document follows the new price', /\$12,320\.00/.test(r));
// Simplify
await pg.evaluate(() => [...document.querySelectorAll('#tenderRoot button')].find(x => /Simplify/.test(x.textContent)).click());
await pg.waitForTimeout(600);
const am = calls.find(c => /\/amend$/.test(c.p));
r = await pg.evaluate(() => ({ scope: [...document.querySelectorAll('.tn-card ol.tn-list textarea')].map(t => t.value), undo: [...document.querySelectorAll('#tenderRoot button')].some(b => /Undo last AI change/.test(b.textContent)) }));
check('Simplify asks Claude with the tender on screen and shows the new scope', am && am.body.mode === 'simplify' && am.body.doc.items[0].quantity === 120 && r.scope.length === 2 && r.undo, JSON.stringify([am && am.body.mode, r]));
// the chat
await pg.fill('#tnChatIn', 'take the spouting out, the builder is doing it');
await pg.press('#tnChatIn', 'Enter');
await pg.waitForTimeout(600);
const am2 = calls.filter(c => /\/amend$/.test(c.p)).pop();
r = await pg.evaluate(() => ({ log: (document.getElementById('tnChatLog') || {}).innerText || '', page: document.getElementById('tqPage').innerText }));
check('the chat sends the office\'s own words and the reply shows', am2.body.mode === 'chat' && /spouting out/.test(am2.body.instruction) && /Done: chat/.test(r.log) && /Spouting/.test(r.page), JSON.stringify([am2.body.instruction, r.log]));
// edit the document itself
calls.length = 0;
await pg.evaluate(() => { const t = document.querySelector('#tqPage [data-qk="title"]'); t.focus(); t.textContent = 'Roofing Tender — Whangaroa Hall'; t.blur(); });
await pg.evaluate(() => { const li = document.querySelector('#tqPage [data-ql="scope"][data-qi="0"]'); li.focus(); li.textContent = 'Supply and install the whole roof'; li.blur(); });
await pg.waitForTimeout(1200);
const putDoc2 = calls.filter(c => c.m === 'PUT' && /\/doc$/.test(c.p)).pop();
r = await pg.evaluate(() => document.querySelector('.tn-card ol.tn-list textarea').value);
check('words typed on the document save, and a scope line goes back into the scope', putDoc2 && putDoc2.body.doc.quote.title === 'Roofing Tender — Whangaroa Hall' && putDoc2.body.doc.scope[0] === 'Supply and install the whole roof' && r === 'Supply and install the whole roof', JSON.stringify([putDoc2 && putDoc2.body.doc.quote, r]));
// hide a section and the PDF
await pg.evaluate(() => _tnQSection('assumptions', 'hide'));
r = await pg.evaluate(() => { _tnPdf(); const f = [...document.querySelectorAll('iframe')].pop(); const dd = f && f.contentDocument; return { title: dd && dd.title, text: dd && dd.body.innerText, editable: dd && dd.querySelectorAll('[contenteditable]').length, tools: dd && dd.querySelectorAll('.tq-tools').length }; });
check('Save as PDF prints the document alone, named for the project and the business, with nothing editable left on it', /^Whangaroa Community Hall.* - Flood Roofing Ltd$/.test(r.title) && /Roofing Tender — Whangaroa Hall/.test(r.text) && r.editable === 0 && r.tools === 0, JSON.stringify([r.title, r.editable, r.tools]));
check('…and a hidden section is left off the PDF', !/Access from the street/.test(r.text) && /Supply and install the whole roof/.test(r.text));

// ── the document's shape, the menu, Edit [section], the org (2026-10-27) ──
r = await pg.evaluate(() => {
  const pgEl = document.getElementById('tqPage');
  const heads = [...pgEl.querySelectorAll('.tq-sec h2 [data-qk]')].map(h => h.textContent);
  return { heads, specTbl: pgEl.querySelectorAll('.tq-tbl').length, boxes: [...pgEl.querySelectorAll('.tq-ob b')].map(b => b.textContent), ask: !!pgEl.querySelector('.tq-orgask'),
    edits: [...pgEl.querySelectorAll('.tq-edit')].map(b => b.title + '|' + b.textContent), cardEdits: [...document.querySelectorAll('.tn-card-hd .tn-edit')].map(b => b.title + '|' + b.textContent),
    nav: [...document.querySelectorAll('#tnNav .tn-nav-i')].map(a => a.textContent), navSide: getComputedStyle(document.querySelector('.tn-side')).position, navW: document.getElementById('tnNav').getBoundingClientRect().width,
    chatPinned: !!document.querySelector('.tn-side #tnChat #tnChatIn') && !!document.getElementById('tnChatMic'), scopeChat: !!document.querySelector('#tn-a-scope .tn-chat') };
});
check('the roofing specification is no longer on the tender document', r.heads.indexOf('Roofing specification') < 0 && r.specTbl === 0, JSON.stringify(r.heads));
check('the organisation structure sits just above the programme', r.heads.indexOf('Organisation structure') >= 0 && r.heads.indexOf('Organisation structure') === r.heads.indexOf('Programme') - 1, JSON.stringify(r.heads));
check('…starting from a standard structure, and asking for theirs', r.boxes.indexOf('Director / Contract Manager') >= 0 && r.boxes.indexOf('Roofing crews') >= 0 && r.ask, JSON.stringify(r.boxes));
check('every section of the document carries ✨ Edit with A.I.', r.edits.length === 9 && r.edits.indexOf('Edit Organisation structure with A.I.|✨ Edit with A.I.') >= 0 && r.edits.indexOf('Edit Terms with A.I.|✨ Edit with A.I.') >= 0, JSON.stringify(r.edits));
check('…and so do the working sheet\'s cards', ['Specification', 'Scope of work', 'Exclusions', 'Pricing sheet', 'Programme'].every(x => r.cardEdits.indexOf('Edit ' + x + ' with A.I.|✨ Edit with A.I.') >= 0), JSON.stringify(r.cardEdits));
check('the menu is wider, with the A.I. chat and its Speak button pinned under it (and out of the scope card)', r.navW >= 250 && r.chatPinned && !r.scopeChat, JSON.stringify([r.navW, r.chatPinned, r.scopeChat]));
check('a menu down the side names every part, sticky like Settings', ['Overview', 'Specification & quantities', 'Pricing sheet', 'The document', 'Organisation structure', 'Terms', 'Sheet index'].every(x => r.nav.indexOf(x) >= 0) && r.navSide === 'sticky', JSON.stringify(r.nav));
await pg.evaluate(() => _tnNavGo('tq-sec-terms'));
await pg.waitForTimeout(900);
r = await pg.evaluate(() => ({ top: document.getElementById('tq-sec-terms').getBoundingClientRect().top, on: (document.querySelector('#tnNav .tn-nav-i.on') || {}).textContent }));
check('a click in the menu jumps to that part and lights it', r.top > 30 && r.top < 120 && r.on === 'Terms', JSON.stringify(r));
// Edit Organisation structure: describe it, Claude lays it out
calls.length = 0;
await pg.evaluate(() => _tnEdit('org'));
r = await pg.evaluate(() => ({ open: document.getElementById('tnEditModal').classList.contains('open'), title: document.getElementById('tnEditTitle').textContent, mic: !!document.getElementById('tnEditMic'), hint: document.getElementById('tnEditHint').textContent }));
check('Edit opens a window to describe the change, with a Speak button', r.open && r.title === '✨ Edit Organisation structure with A.I.' && r.mic && /crews/.test(r.hint), JSON.stringify(r));
await pg.fill('#tnEditIn', 'Aron Flood director, Ethan project manager, four two-man crews');
await pg.click('#tnEditGo');
await pg.waitForTimeout(700);
const sec = calls.find(c => /\/section$/.test(c.p));
r = await pg.evaluate(() => ({ open: document.getElementById('tnEditModal').classList.contains('open'), names: [...document.querySelectorAll('#tqPage .tq-ob span')].map(x => x.textContent), ask: !!document.querySelector('#tqPage .tq-orgask') }));
check('…which goes to Claude with the structure on screen, and the chart is redrawn', sec && sec.body.section === 'org' && /two-man crews/.test(sec.body.instruction) && Array.isArray(sec.body.current) && !r.open && r.names.indexOf('Aron Flood') >= 0 && !r.ask, JSON.stringify([sec && sec.body.section, r]));
// a section that moves the price goes through the whole-tender change
await pg.evaluate(() => _tnEdit('scope'));
await pg.fill('#tnEditIn', 'take the skylights out');
await pg.click('#tnEditGo');
await pg.waitForTimeout(700);
const am3 = calls.filter(c => /\/amend$/.test(c.p)).pop();
check('Edit Scope of work changes the tender whole, so the price follows', am3 && am3.body.mode === 'chat' && /^Change the Scope of work section: take the skylights out/.test(am3.body.instruction), JSON.stringify(am3 && am3.body.instruction));
// a person's name typed straight into the chart saves
calls.length = 0;
await pg.evaluate(() => { const el = [...document.querySelectorAll('#tqPage .tq-ob span')].find(x => x.textContent === 'Ethan'); el.focus(); el.textContent = 'Ethan Flood'; el.blur(); });
await pg.waitForTimeout(1200);
const putOrg = calls.filter(c => c.m === 'PUT' && /\/doc$/.test(c.p)).pop();
check('a name typed on the chart saves into the structure', putOrg && putOrg.body.doc.org.people.some(p => p.name === 'Ethan Flood'), JSON.stringify(putOrg && putOrg.body.doc.org));
// the PDF keeps the colours and the A4 layout
r = await pg.evaluate(() => { _tnPdf(); const f = [...document.querySelectorAll('iframe')].pop(); const dd = f.contentDocument; const css = [...dd.querySelectorAll('style')].map(x => x.textContent).join(''); return { exact: /print-color-adjust:exact!important/.test(css), phoneOnScreen: !/@media\(max-width:760px\)/.test(css) && /@media screen and \(max-width:760px\)/.test(css), org: dd.querySelectorAll('.tq-ob').length, ask: dd.querySelectorAll('.tq-orgask').length, edits: dd.querySelectorAll('.tq-edit').length }; });
check('the PDF prints the bands and bars (backgrounds kept) and never the phone layout', r.exact && r.phoneOnScreen, JSON.stringify(r));
check('…with the org chart on it and none of the office\'s buttons or prompts', r.org === 3 && r.ask === 0 && r.edits === 0, JSON.stringify(r));
// the section boxes: one height, scrolling inside; Expand, back to 8 lines, Minimise
r = await pg.evaluate(() => {
  const h = id => { const b = document.querySelector('.tn-box[data-box="' + id + '"]'); return b ? Math.round(b.getBoundingClientRect().height) : -1; };
  const out = { scope: h('w-scope'), terms: h('w-exclusions'), pricing: h('w-pricing'), docBoxes: document.querySelectorAll('#tqPage .tn-box').length, ctl: !!document.querySelector('.tn-bxs[data-bxfor="w-scope"] [data-bx="full"]') };
  _tnBox('w-pricing', 'full'); out.full = h('w-pricing'); out.back = !!document.querySelector('.tn-bxs[data-bxfor="w-pricing"] [data-bx="mid"]');
  _tnBox('w-pricing', 'min'); out.min = h('w-pricing'); out.open = !!document.querySelector('.tn-bxs[data-bxfor="w-pricing"] [data-bx="mid"]');
  _tnBox('w-pricing', 'mid'); out.mid = h('w-pricing');
  return out;
});
check('the working sheet\'s boxes are one height, scrolling inside (the document is whole sheets)', r.scope === 540 && r.terms === 540 && r.pricing === 540 && r.docBoxes === 0 && r.ctl, JSON.stringify(r));
check('…Expand shows it whole with a button back to 8 lines, Minimise folds it, Open brings it back', r.full > 540 && r.back && r.min === 0 && r.open && r.mid === 540, JSON.stringify(r));
r = await pg.evaluate(() => { _tnPdf(); const f = [...document.querySelectorAll('iframe')].pop(); const dd = f.contentDocument; const css = [...dd.querySelectorAll('style')].map(x => x.textContent).join(''); return { boxCssScreen: /@media screen\{\.tn-card \.tn-box\.mid\{height:540px/.test(css), bx: dd.querySelectorAll('.tn-bxs,.tq-pb').length }; });
check('…and the PDF still prints every section whole, without the box buttons or page lines', r.boxCssScreen && r.bx === 0, JSON.stringify(r));
// the page breaks: lengthen the scope until it runs onto a second page
await pg.evaluate(() => { window.__tnRerender(d => { for (let i = 0; i < 70; i++) d.scope.push('Scope line number ' + i + ' for the page break test'); }); });
await pg.waitForTimeout(1800);
r = await pg.evaluate(() => { const marks = [...document.querySelectorAll('#tqPage .tq-pb:not(.tq-pb-end)')].map(m => m.textContent); return { marks, pages: document.getElementById('tqPage').getAttribute('data-pages'), label: (document.getElementById('tqPages') || {}).textContent, sheets: [...document.querySelectorAll('#tqPage .tq-pb')].map(m => m.getBoundingClientRect().top), pgTop: document.getElementById('tqPage').getBoundingClientRect().top, rows: ['w-scope'].map(id => { const b = document.querySelector('.tn-box[data-box="' + id + '"]'), bb = b.getBoundingClientRect(); return [...b.querySelectorAll('li:not(.tq-pb)')].filter(l => { const r = l.getBoundingClientRect(); return r.top >= bb.top && r.bottom <= bb.bottom + 1; }).length; }), termsKey: document.querySelector('#tqPage [data-qk="terms"]') ? 1 : 0 }; });
check('a working-sheet box shows 8 rows of the scope', r.rows[0] === 8, JSON.stringify(r.rows));
check('the document is drawn as separate A4 sheets, each the height of a PDF page', r.sheets.length >= 2 && Math.abs((r.sheets[1] - r.sheets[0]) - 1148) < 3,  JSON.stringify(r.sheets));
check('…as many as the PDF prints', r.marks.length >= 2 && r.marks[0] === 'Page 2' && +r.pages === r.marks.length + 1 && /A4 PDF: \d+ pages/.test(r.label), JSON.stringify(r));

// ── the layout, the chat's questions, Tag out, the plans (2026-10-28) ──
await pg.evaluate(() => window.scrollTo(0, 0));
await pg.waitForTimeout(200);
r = await pg.evaluate(async () => {
  const side = document.querySelector('.tn-side'), chat = document.getElementById('tnChat');
  const a = side.getBoundingClientRect();
  window.scrollTo(0, 900); await new Promise(res => setTimeout(res, 150));
  const b = side.getBoundingClientRect(), c = chat.getBoundingClientRect();
  window.scrollTo(0, 2600); await new Promise(res => setTimeout(res, 150));
  const b2 = side.getBoundingClientRect();
  return { top0: Math.round(a.top), top1: Math.round(b.top), top2: Math.round(b2.top), w: Math.round(a.width), chatBottom: Math.round(c.bottom), vh: innerHeight, chatH: Math.round(c.height), inH: Math.round(document.getElementById('tnChatIn').getBoundingClientRect().height),
    planInMain: !!document.querySelector('.tn-main #tnPlanSet'), mainW: Math.round(document.querySelector('.tn-main').getBoundingClientRect().width), rootW: Math.round(document.getElementById('tenderRoot').getBoundingClientRect().width) };
});
check('the menu starts at the top beside the Plan set and never moves as the page scrolls', r.planInMain && Math.abs(r.top0 - r.top1) <= 2 && Math.abs(r.top1 - r.top2) <= 2, JSON.stringify(r));
check('…wider (360px), with the chat running to the bottom of the screen and a bigger box to type in', r.w >= 355 && r.vh - r.chatBottom <= 16 && r.chatH >= 300 && r.inH >= 90, JSON.stringify(r));
check('the page uses the width of the screen, not a 1180px column', r.rootW > 1180 || r.rootW >= (await pg.evaluate(() => document.getElementById('tab-tender').getBoundingClientRect().width)) - 30, JSON.stringify(r));
// a question is answered in the chat and changes nothing
calls.length = 0;
const histN = await pg.evaluate(() => document.querySelectorAll('.tn-bar2 button').length);
await pg.fill('#tnChatIn', 'Are blocks 1 and 5/6 separate buildings?');
await pg.press('#tnChatIn', 'Enter');
await pg.waitForTimeout(700);
const amQ = calls.filter(c => /\/amend$/.test(c.p)).pop();
r = await pg.evaluate(() => ({ log: document.getElementById('tnChatLog').innerText, hd: document.querySelector('.tn-chat-hd').textContent, ph: document.getElementById('tnChatIn').placeholder }));
check('the chat answers a question, naming the sheet it came from', amQ && !amQ.body.change && /two buildings/.test(r.log) && /From: A201/.test(r.log) && /questions or changes/.test(r.hd) && /question/.test(r.ph), JSON.stringify([amQ && amQ.body.change, r]));
// Tag out: the line moves to the exclusions at once and Claude takes its items out
calls.length = 0;
r = await pg.evaluate(() => { const b = [...document.querySelectorAll('#tn-a-scope .tn-tagout')]; return { n: b.length, rows: document.querySelectorAll('#tn-a-scope .tn-list > li').length, first: (document.querySelector('#tn-a-scope .tn-list textarea') || {}).value }; });
const tagLine = r.first;
check('every scope line has a Tag out button', r.n > 0 && r.n === r.rows, JSON.stringify(r));
await pg.click('#tn-a-scope .tn-tagout');
await pg.waitForTimeout(700);
const amT = calls.filter(c => /\/amend$/.test(c.p)).pop();
r = await pg.evaluate(() => ({ scope: [...document.querySelectorAll('#tn-a-scope .tn-list textarea')].map(t => t.value), ex: [...document.querySelectorAll('#tn-a-exclusions textarea')].map(t => t.value), log: document.getElementById('tnChatLog').innerText }));
check('Tag out moves the line to the exclusions and asks Claude to take its items out of the price', amT && amT.body.change === true && amT.body.instruction.indexOf(tagLine) >= 0 && /tagged this line OUT/.test(amT.body.instruction) && amT.body.doc.exclusions.some(e => e.text === tagLine) && !amT.body.doc.scope.includes(tagLine) && r.ex.indexOf(tagLine) >= 0 && r.scope.indexOf(tagLine) < 0 && /Tag out: /.test(amT.body.said), JSON.stringify([amT && amT.body.said, r.scope.slice(0, 2), r.ex]));
// the plans slide-out
r = await pg.evaluate(() => { const el = document.getElementById('tnPlansPop'); return { shown: getComputedStyle(el).display, open: el.classList.contains('is-open'), tab: getComputedStyle(document.getElementById('tnPlansTab')).display }; });
check('a PLANS tab sits on the right edge of the tendering page', r.shown === 'flex' && !r.open && r.tab !== 'none', JSON.stringify(r));
await pg.click('#tnPlansTab');
await pg.waitForTimeout(500);
r = await pg.evaluate(() => { const el = document.getElementById('tnPlansPop'), s = [...el.querySelectorAll('.tnpv-slot')], L = el.querySelector('#tnpvList').getBoundingClientRect(), s0 = s[0].getBoundingClientRect(); return { open: el.classList.contains('is-open'), slots: s.length, img: !!s[0].querySelector('img').getAttribute('src'), at: document.getElementById('tnpvAt').textContent, fit: s0.height / L.height, x: Math.round(el.getBoundingClientRect().right) }; });
check('…which slides out with every page of the set, one page to a slot', r.open && r.slots >= 4 && r.img && new RegExp('Page 1 of ' + r.slots + '\\b').test(r.at) && r.fit > 0.8 && r.fit < 1, JSON.stringify(r));
const slotBox = await pg.evaluate(() => { const b = document.querySelector('#tnpvList .tnpv-slot').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await pg.mouse.move(slotBox.x, slotBox.y);
await pg.mouse.wheel(0, 120);
await pg.waitForTimeout(700);
r = await pg.evaluate(() => window.__tnPlansState());
check('…a plain wheel turns one page', r.at === 1, JSON.stringify(r));
await pg.mouse.wheel(0, 120);
await pg.waitForTimeout(700);
await pg.mouse.wheel(0, -120);
await pg.waitForTimeout(700);
r = await pg.evaluate(() => window.__tnPlansState());
check('…and back, one a notch', r.at === 1, JSON.stringify(r));
const slot2 = await pg.evaluate(() => { const b = document.querySelector('#tnpvList .tnpv-slot[data-i="1"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await pg.mouse.move(slot2.x, slot2.y);
await pg.keyboard.down('Control');
await pg.mouse.wheel(0, -300);
await pg.keyboard.up('Control');
await pg.waitForTimeout(200);
const z1 = await pg.evaluate(() => window.__tnPlansState());
await pg.mouse.down();
await pg.mouse.move(slot2.x + 80, slot2.y + 60, { steps: 4 });
await pg.mouse.up();
const z2 = await pg.evaluate(() => window.__tnPlansState());
check('Ctrl + wheel zooms the page on screen, and a press-and-drag moves around it', z1.at === 1 && z1.z.s > 1.5 && (z2.z.x !== z1.z.x || z2.z.y !== z1.z.y) && z2.z.s === z1.z.s, JSON.stringify([z1, z2]));
await pg.evaluate(() => _tnPlans(false));

if (process.env.SHOTS) {   // pictures for the owner: the page, the phone and the PDF as Chrome prints it
  const dir = process.env.SHOTS;
  await pg.evaluate(() => { document.querySelectorAll('iframe').forEach(f => f.remove()); _tnQSection('assumptions', 'hide'); window.scrollTo(0, 0); });
  await pg.setViewportSize({ width: 1400, height: 900 });
  await pg.evaluate(() => _tnNavGo('tn-a-overview')); await pg.waitForTimeout(900);
  await pg.screenshot({ path: dir + '/c1.png' });
  await pg.evaluate(() => _tnNavGo('tn-a-doc')); await pg.waitForTimeout(900);
  await pg.screenshot({ path: dir + '/c2.png' });
  await pg.evaluate(() => _tnNavGo('tq-sec-org')); await pg.waitForTimeout(900);
  await pg.screenshot({ path: dir + '/c3.png' });
  await pg.evaluate(() => { _tnBox('q-scope', 'full'); const m = document.querySelector('#tqPage .tq-pb'); if (m) m.scrollIntoView({ block: 'center' }); }).catch(() => 0);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: dir + '/c5.png' });
  await pg.evaluate(() => _tnBox('q-scope', 'mid'));
  await pg.evaluate(() => _tnEdit('org')); await pg.fill('#tnEditIn', 'Aron Flood is director, Ethan project manager, four two-man crews'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: dir + '/c4.png' });
  await pg.evaluate(() => _tnEditClose());
  const html = await pg.evaluate(() => { _tnPdf(); const f = [...document.querySelectorAll('iframe')].pop(); return f.contentDocument.documentElement.outerHTML; });
  const pp = await pg.context().newPage();
  await pp.setContent('<!doctype html>' + html, { waitUntil: 'load' });
  await pp.emulateMedia({ media: 'print' });
  await pp.pdf({ path: dir + '/tender.pdf', format: 'A4', printBackground: false, preferCSSPageSize: true });
  await pp.close();
  await pg.evaluate(() => { window.scrollTo(0, 0); _tnPlans(true); }); await pg.waitForTimeout(700);
  await pg.screenshot({ path: dir + '/c6.png' });
  await pg.evaluate(() => { _tnPlansZoom(1.25); _tnPlansZoom(1.25); _tnPlansZoom(1.25); }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: dir + '/c7.png' });
  await pg.evaluate(() => _tnPlans(false)); await pg.waitForTimeout(400);
  await pg.evaluate(() => _tnNavGo('tn-a-scope')); await pg.waitForTimeout(900);
  await pg.screenshot({ path: dir + '/c8.png' });
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(600);
  await pg.evaluate(() => _tnNavGo('tq-sec-org')); await pg.waitForTimeout(1600);
  await pg.screenshot({ path: dir + '/m1.png' });
  await pg.setViewportSize({ width: 1280, height: 900 });
}

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
// A stored profile with no email (one sign-in path keeps the profile row as
// it is) must not stop the check, and opening the window asks by itself.
liveOn = true;
r = await pg.evaluate(async () => { window.__tenderingLive = null; localStorage.setItem('fr_user', JSON.stringify({ id: 'u-1', name: 'Sam' }));
  openJobDetailsModal('new'); await new Promise(res => setTimeout(res, 500)); const b = document.getElementById('jtBtn_tender');
  const out = { avail: _tenderingAvailable(), shown: b.style.display !== 'none' }; closeJobDetailsModal(); return out; });
check('a login whose stored profile has no email still gets the type, and opening the job window asks', r.avail && r.shown, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
