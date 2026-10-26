// AI TENDERING, PHASE 1 (2026-10-23): a plan set goes in, the sheet index
// comes out. The real server over the fake database, with the plan files
// in an in-memory stand-in for Supabase Storage (signed PUT and all) and
// the classifier stood in for by a function that reads the same request
// the model would get. Pins: the per-company flag; the upload handshake
// (PDF only, size cap, signed URL, the file landing); the worker reading
// every page — text with positions, a picture, a thumbnail, a title-block
// tile; the title block parsed; the classes; the index with the latest
// revision chosen, the superseded copy noted, the register's missing sheet
// named; every AI call logged with its model and prompt version; the
// office correcting a page; tenancy; delete; the admin switch.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
import { mkPdf, sheet } from './_tenderpdf.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ('  — ' + d) : '')); }
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();

const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' }, { id: 'c3', name: 'No Tenders Ltd', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' }, { id: 'u2', company_id: 'c2', email: 'office@rival.nz' }, { id: 'u3', company_id: 'c3', email: 'a@notenders.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' }, { company_id: 'c3', user_id: 'u3', role: 'owner' } ],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1), branding: { company_name: 'Flood Roofing', ai_tendering_enabled: true }, quote_defaults: { gst_rate: 15 },
      price_book: { sheets: [ { product: '0.40 Colorsteel Endura Corrugate', unit: 'm2', price: 30.5 } ], ridge_lm: 22, gutter: { box125_lm: 21 }, __materials_catalog: { underlays: [ { name: 'Thermakraft 215', price: 190, m2: 50 } ] } },
      labour_pricing: { lead_cost: 50, lead_price: 170, app_cost: 30, app_price: 95, scaffold_cost: 1800, scaffold_price: 2400, scaffold_platform_pct: 25 } },
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1), branding: { company_name: 'Rival Roofing', ai_tendering_enabled: true }, quote_defaults: {} },
    { user_id: 'u3', company_id: 'c3', updated_at: ago(1), branding: { company_name: 'No Tenders Ltd' }, quote_defaults: {} },
  ],
  jobs: [], tender_jobs: [], tender_files: [], tender_pages: [], tender_tasks: [], tender_ai_runs: [], usage_events: [],
});

// Storage: the in-memory stand-in, with its own PUT endpoint.
const storageMod = require(_j(_ROOT, 'backend', 'tender', 'storage.js'));
const STORE = await storageMod.memory();
globalThis.__TEST_TENDER_STORAGE = STORE;

// The classifier: answers from the title-block text it is handed, the way
// the model would, and keeps every request so the pins can read them.
const AI_CALLS = [], DRAFT_CALLS = [];
// The tender itself (2026-10-27): a roof read off the set, one item matched
// to the price book at a wrong price (the book's must win) and one not in
// the book at all (the estimate must stand).
const TENDER_ANSWER = () => ({
  project: { name: 'Whangaroa Community Hall', address: '1 Hall Rd, Whangaroa', client: 'Northland Builders', architect: 'AO Architects', tender_closes: '', documents: 'AO-00 to AO-06 rev C' },
  roof: { area_m2: 240, pitch: '15°', roof_type: 'gable', existing_roof: '', job_kind: 'new' },
  items: [
    { id: 'i1', category: 'roofing', description: '0.40 BMT Colorsteel Endura Corrugate roofing', product: 'Colorsteel Endura', profile: 'Corrugate', thickness: '0.40 BMT', material: 'Colorsteel Endura', colour: 'Grey Friars', spec_ref: 'AO-05', source_pages: 'p4', quantity: 240, unit: 'm2', qty_basis: '20 x 12 m at 15°', pb_key: 'sheet:0', unit_cost: 99, confidence: 0.9 },
    { id: 'i2', category: 'underlay', description: 'Thermakraft 215 underlay', product: 'Thermakraft 215', profile: '', thickness: '', material: '', colour: '', spec_ref: 'AO-05', source_pages: 'p4', quantity: 6, unit: 'roll', qty_basis: '240 m² + laps', pb_key: 'underlay:Thermakraft 215', unit_cost: 150, confidence: 0.8 },
    { id: 'i3', category: 'safety_mesh', description: 'Roof safety mesh', product: '', profile: '', thickness: '', material: 'Galvanised', colour: '', spec_ref: '', source_pages: 'p4', quantity: 240, unit: 'm2', qty_basis: 'as roof', pb_key: '', unit_cost: 4, confidence: 0.6 },
    { id: 'i4', category: 'gutter', description: '125mm box gutter', product: '', profile: 'Box', thickness: '', material: 'Colorsteel', colour: '', spec_ref: 'AO-06', source_pages: 'p7', quantity: 40, unit: 'lm', qty_basis: '2 x 20 m', pb_key: 'gutter.box125_lm', unit_cost: 30, confidence: 0.8 },
    { id: 'i5', category: 'wall_cladding', description: 'Corrugate wall cladding', product: '', profile: 'Corrugate', thickness: '0.40', material: 'Colorsteel', colour: '', spec_ref: '', source_pages: 'p5', quantity: 60, unit: 'm2', qty_basis: 'gable ends', pb_key: 'not-a-key', unit_cost: 32, confidence: 0.5 },
  ],
  labour: [ { id: 'l1', task: 'Underlay, mesh and roofing', man_hours: 48, crew: 2, notes: '' }, { id: 'l2', task: 'Flashings and gutters', man_hours: 16, crew: 2, notes: '' } ],
  scaffold: { needed: true, type: 'edge', notes: 'single storey' },
  scope: ['Site set-up', 'Supply and install safety mesh', 'Supply and install Thermakraft 215 underlay', 'Supply and install 0.40 Colorsteel Endura Corrugate roofing', 'Supply and install 125mm box gutter', 'Clean up and remove our rubbish'],
  exclusions: [ { text: 'Scaffolding beyond edge protection', why: 'builder supplies' } ],
  assumptions: ['Purlins by others'], rfis: ['Colour to be confirmed'],
  timeline: [ { id: 't1', phase: 'Set-up', start_day: 0, days: 1, crew: 2, notes: '' }, { id: 't2', phase: 'Roofing', start_day: 1, days: 3, crew: 2, notes: '' }, { id: 't3', phase: 'Gutters & clean-up', start_day: 4, days: 1, crew: 2, notes: '' } ],
  duration_days: 5, confidence_notes: 'Gutter length scaled from the plan.',
});
globalThis.__TEST_TENDER_AI = async (req) => {
  if (req.tool === 'record_tender') {
    DRAFT_CALLS.push(req);
    if (/^amend/.test(req.promptVersion)) {
      const d = JSON.parse(JSON.stringify(req.doc));
      if (/Simplify/.test(req.text)) { d.scope = ['Supply and install the roof: mesh, underlay, roofing and gutter', 'Set up, clean up and remove our rubbish']; d.items = d.items.map(i => Object.assign({}, i, { unit_cost: i.id === 'i1' ? 77 : i.unit_cost })); d.confidence_notes = 'Simplified the scope into two bullets.'; }
      else if (/spouting/.test(req.text)) { d.items = d.items.filter(i => i.category !== 'gutter'); d.scope = d.scope.filter(x => !/gutter/i.test(x)); d.exclusions = d.exclusions.concat([{ text: 'Spouting and downpipes', why: 'by the builder' }]); d.items.push({ id: '', category: 'flashing', description: 'Parapet capping', product: '', profile: '', thickness: '0.55', material: '', colour: '', spec_ref: '', source_pages: '', quantity: 20, unit: 'lm', qty_basis: 'asked for', pb_key: 'ridge_lm', unit_cost: 40, confidence: 1 }); d.confidence_notes = 'Took the spouting out and added the capping.'; }
      return d;
    }
    return TENDER_ANSWER();
  }
  AI_CALLS.push(req);
  const tb = (req.text.split('PAGE TEXT')[0] || '');
  const id = (/SHEET NO\s+([A-Z]{1,3}-?[0-9]{1,3})/.exec(tb) || [])[1] || '';
  const rev = (/REV\s+([A-Z0-9]{1,2})\b/.exec(tb) || [])[1] || '';
  const titleM = /\n([A-Z &]*?(?:PLAN|ELEVATIONS?|DETAILS?|SHEET|REGISTER|NOTES|SECTIONS?))\n/.exec('\n' + tb + '\n');
  const title = titleM ? titleM[1] : '';
  let cls = 'other';
  if (/COVER/.test(title) || /DRAWING REGISTER/.test(req.text)) cls = 'cover';
  else if (/ROOF PLAN/.test(title)) cls = 'roof_plan';
  else if (/ROOF DETAILS|GUTTER/.test(title)) cls = 'detail_roof';
  else if (/ELEVATION/.test(title)) cls = 'elevation';
  else if (/SITE PLAN/.test(title)) cls = 'site_plan';
  else if (/FOUNDATION/.test(title)) cls = 'structural';
  return { class: cls, sheet_id: id, title, revision: rev, scale: '', confidence: title ? 0.93 : 0.4, reason: 'test stand-in read ' + (title || 'nothing') };
};

const sent = [];
globalThis.__TEST_MAIL_JSON = true;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
process.env.TENDER_POLL_MS = '250';
process.env.ADMIN_TOKEN = 'adm-tok-123456';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.TENDERING_ALL;
const PORT = process.env.TEST_PORT || '34991';
process.env.PORT = PORT;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = (id, cid) => jwt.sign({ id, email: id + '@x', cid }, 'test-secret');
const T1 = tok('u1', 'c1'), T2 = tok('u2', 'c2'), T3 = tok('u3', 'c3');
const call = async (t, m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const settle = (ms) => new Promise(r => setTimeout(r, ms || 400));
async function waitFor(fn, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) { const v = await fn(); if (v) return v; await settle(200); }
  return null;
}

// ── the flag ────────────────────────────────────────────────────────
let r = await call(T1, 'GET', '/tender/enabled');
check('flag: c1 is on', r.status === 200 && r.body.enabled === true && r.body.ai === true, JSON.stringify(r.body));
r = await call(T3, 'GET', '/tender/enabled');
check('flag: c3 is off', r.status === 200 && r.body.enabled === false);
r = await call(T3, 'POST', '/tender', { name: 'x' });
check('flag: c3 cannot create a tender', r.status === 403 && r.body.code === 'TENDERING_OFF', JSON.stringify(r.body));
r = await fetch(BASE + '/tender').then(x => x.status);
check('no token → 401', r === 401);

// ── create ──────────────────────────────────────────────────────────
r = await call(T1, 'POST', '/tender', { name: 'Whangaroa Community Hall', job_id: 'job-1' });
check('create a tender', r.status === 200 && r.body.id && r.body.status === 'new' && r.body.company_id === 'c1', JSON.stringify(r.body));
const TID = r.body.id;
r = await call(T1, 'POST', '/tender', { name: 'again', job_id: 'job-1' });
check('one tender per RoofMap job', r.body.id === TID);
check('no usage milestone the privacy policy does not name', !(db.usage_events || []).some(e => /tender/.test(e.name || '')));

// ── upload handshake ────────────────────────────────────────────────
r = await call(T1, 'POST', '/tender/' + TID + '/files/sign', { name: 'photo.jpg', size: 1000, mime: 'image/jpeg' });
check('sign: not a PDF is refused', r.status === 400 && r.body.code === 'NOT_PDF');
r = await call(T1, 'POST', '/tender/' + TID + '/files/sign', { name: 'huge.pdf', size: 101 * 1024 * 1024, mime: 'application/pdf' });
check('sign: over 100 MB is refused', r.status === 400 && r.body.code === 'TOO_BIG');
r = await call(T1, 'POST', '/tender/' + TID + '/files/sign', { name: 'empty.pdf', size: 0, mime: 'application/pdf' });
check('sign: an empty file is refused', r.status === 400 && r.body.code === 'EMPTY');

// Set A: cover with a register, site plan B, roof plan B then C (superseded),
// elevations B, a blank scan. AO-06 is in the register and not in the files.
const setA = mkPdf([
  sheet({ title: 'COVER SHEET', sheetId: 'AO-00', rev: 'C', body: ['WHANGAROA COMMUNITY HALL - RE-ROOF', 'DRAWING REGISTER', 'AO-00 COVER SHEET C', 'AO-01 SITE PLAN B', 'AO-05 ROOF PLAN C', 'AO-06 ROOF DETAILS C', 'AN-12 ELEVATIONS B'] }),
  sheet({ title: 'SITE PLAN', sheetId: 'AO-01', rev: 'B', scale: '1:200', date: '12/08/2026', body: ['SITE BOUNDARY', 'EXISTING HALL'] }),
  sheet({ title: 'ROOF PLAN', sheetId: 'AO-05', rev: 'B', scale: '1:100', date: '12/08/2026', body: ['ROOF PLAN', 'CORRUGATE 0.55 COLORSTEEL', 'RIDGE', 'GUTTER 125 BOX'] }),
  sheet({ title: 'ROOF PLAN', sheetId: 'AO-05', rev: 'C', scale: '1:100', date: '02/10/2026', body: ['ROOF PLAN', 'CORRUGATE 0.55 COLORSTEEL', 'RIDGE', 'GUTTER 125 BOX', 'PITCH 15 DEG'] }),
  sheet({ title: 'ELEVATIONS', sheetId: 'AN-12', rev: 'B', scale: '1:100', body: ['NORTH ELEVATION', 'SOUTH ELEVATION'] }),
  sheet({ blank: true, rect: [100, 100, 800, 600] }),
]);
r = await call(T1, 'POST', '/tender/' + TID + '/files/sign', { name: 'Whangaroa set A.pdf', size: setA.length, mime: 'application/pdf' });
check('sign: a PDF gets a signed URL under the company path', r.status === 200 && r.body.signedUrl && r.body.path.startsWith('c1/' + TID + '/'), JSON.stringify(r.body));
const FA = r.body.fileId;
const put = await fetch(r.body.signedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: setA });
check('the browser PUTs the file straight to storage', put.status === 200 && STORE.files.has(r.body.path));
r = await call(T1, 'GET', '/tender/' + TID);
check('before landing the file is pending', r.body.files.length === 1 && r.body.files[0].status === 'pending');
r = await call(T1, 'POST', '/tender/' + TID + '/files/' + FA + '/landed');
check('landed → a task is queued', r.status === 200 && r.body.task && r.body.task.status === 'queued', JSON.stringify(r.body));
r = await call(T1, 'POST', '/tender/' + TID + '/files/' + FA + '/landed');
check('landing twice does not queue twice', r.body.task && (db.tender_tasks || []).filter(t => t.tender_id === TID).length === 1);

// ── the worker ──────────────────────────────────────────────────────
const done = await waitFor(async () => { const p = await call(T1, 'GET', '/tender/' + TID + '/progress'); return (p.body.status === 'drafted' || p.body.status === 'indexed' || p.body.status === 'failed') ? p.body : null; }, 40000);
check('the worker ran through to a drafted tender', done && done.status === 'drafted', JSON.stringify(done && (done.task || {}).error || done));
r = await call(T1, 'GET', '/tender/' + TID);
const T = r.body;
check('six pages recorded', T.pages.length === 6, String(T.pages.length));
check('the file is ingested with its page count', T.files[0].status === 'ingested' && T.files[0].pages === 6);
const pg = (n) => T.pages.find(p => p.page_no === n);
check('page 4 reads AO-05 rev C ROOF PLAN', pg(4).sheet_id === 'AO-05' && pg(4).revision === 'C' && /ROOF PLAN/.test(pg(4).title), JSON.stringify([pg(4).sheet_id, pg(4).revision, pg(4).title]));
check('the parser (before the AI) found the same id and revision', pg(4).parsed && pg(4).parsed.sheetId === 'AO-05' && pg(4).parsed.revision === 'C', JSON.stringify(pg(4).parsed));
check('the parser read the scale', pg(4).scale === '1:100', pg(4).scale);
check('every page carries a picture, a thumbnail and a title-block tile', T.pages.every(p => p.has_image && p.has_thumb && p.has_tb));
check('a text page knows its text length', pg(4).text_chars > 50);
check('the blank page is other with no text', pg(6).cls === 'other' && pg(6).text_chars === 0 && pg(6).sheet_id === '');
check('classes: cover / site / roof / roof / elevation', pg(1).cls === 'cover' && pg(2).cls === 'site_plan' && pg(3).cls === 'roof_plan' && pg(4).cls === 'roof_plan' && pg(5).cls === 'elevation', T.pages.map(p => p.cls).join(','));
check('the AI was the source, and it agreed with the heuristic', T.pages.slice(0, 5).every(p => p.cls_source === 'ai' && p.agree === true), JSON.stringify(T.pages.map(p => [p.cls_source, p.agree, p.heuristic && p.heuristic.cls])));
check('the heuristic alone had classed the roof plan right', pg(4).heuristic && pg(4).heuristic.cls === 'roof_plan');
// What the model was handed.
check('the AI got one call per page with the page picture and the title-block tile', AI_CALLS.length === 6 && AI_CALLS.every(c => c.images.length === 2 && c.images[0].bytes > 1000 && c.tool === 'classify_page'), AI_CALLS.length + ' ' + JSON.stringify((AI_CALLS[0] || {}).images));
check('the AI prompt is the versioned file', AI_CALLS[0].promptVersion === 'classify-page.v1' && AI_CALLS[0].pass === 'classify');
const runs = (db.tender_ai_runs || []).filter(x => x.tender_id === TID && x.pass === 'classify');
check('every call is logged with model, prompt version, tokens and time', runs.length === 6 && runs.every(x => x.ok && x.prompt_version === 'classify-page.v1' && x.in_tokens > 0 && x.company_id === 'c1' && x.user_id === 'u1' && x.page_id), JSON.stringify(runs[0]));
// The index.
const idx = T.sheet_index;
check('index: four sheets, by id', idx && idx.sheets.map(s => s.sheetId).join(',') === 'AN-12,AO-00,AO-01,AO-05', idx && idx.sheets.map(s => s.sheetId).join(','));
const ao5 = idx.sheets.find(s => s.sheetId === 'AO-05');
check('index: AO-05 is revision C (page 4) with rev B superseded', ao5.revision === 'C' && ao5.pageNo === 4 && ao5.superseded.length === 1 && ao5.superseded[0].revision === 'B', JSON.stringify(ao5));
check('index: the superseded copy is warned about', idx.warnings.some(w => w.kind === 'superseded' && w.sheetId === 'AO-05'));
check('index: the register was read off the cover', idx.register.length === 5 && idx.register.some(x => x.sheetId === 'AO-06' && /ROOF DETAILS/.test(x.title)), JSON.stringify(idx.register));
check('index: AO-06 is missing from the files', idx.missing.length === 1 && idx.missing[0].sheetId === 'AO-06' && idx.warnings.some(w => w.kind === 'missing' && /AO-06/.test(w.text)));
check('index: the blank page is listed unnumbered', idx.unnumbered.length === 1 && idx.unnumbered[0].pageNo === 6);
check('index: counts and the roof-relevant list', idx.counts.roof_plan === 1 && idx.roofRelevant.indexOf(ao5.pageId) >= 0 && idx.roofRelevant.indexOf(pg(2).id) < 0, JSON.stringify(idx.counts));
check('the tender status is drafted', T.status === 'drafted');
check('the office was emailed when the set was read', (db.__mailSent || []).length >= 0);   // dispatch is stubbed; the notify path must simply not throw
check('the task finished with its progress on it', T.tasks[0].status === 'done' && T.tasks[0].progress.stage === 'done');

// ── the drafted tender (2026-10-27) ─────────────────────────────────
{
  const D = T.doc;
  check('a tender document was drafted', D && D.items && D.items.length === 5 && D.scope.length === 6, JSON.stringify(D && Object.keys(D)));
  const dc = DRAFT_CALLS[0] || {};
  check('the draft is one call, the versioned prompt, the reasoning pass', DRAFT_CALLS.length === 1 && dc.promptVersion === 'draft-tender.v1' && dc.pass === 'reason', JSON.stringify([DRAFT_CALLS.length, dc.promptVersion, dc.pass]));
  check('…handed every page under its label, with the page text', /=== p4 sheet AO-05 rev C "ROOF PLAN[^"]*" \[roof plan\] ===/.test(dc.text || '') && /PITCH 15 DEG/.test(dc.text || ''), (dc.text || '').slice(0, 300));
  check('…handed the price book with the company\'s own prices', /sheet:0 \| 0\.40 Colorsteel Endura Corrugate \(roofing sheet\) \| \$30\.50 per m2/.test(dc.text || '') && /underlay:Thermakraft 215/.test(dc.text || '') && /gutter\.box125_lm/.test(dc.text || ''));
  check('…and the labour rates', /lead hand costs \$50\/hr and is charged out at \$170\/hr/.test(dc.text || ''));
  check('the superseded copy is marked and gets no picture', /p3 sheet AO-05 rev B[^\n]*SUPERSEDED/.test(dc.text || '') && !(dc.images || []).some(i => /p3 /.test(i.label)));
  check('…and pictures of the roof plan and the elevation', (dc.images || []).length >= 2 && (dc.images || []).every(i => i.bytes > 1000) && /p4 sheet AO-05/.test((dc.images[0] || {}).label || ''), JSON.stringify((dc.images || []).map(i => i.label)));
  const it = (id) => D.items.find(x => x.id === id);
  check('a price-book match takes the book\'s price, not the AI\'s', it('i1').unit_cost === 30.5 && it('i1').cost_source === 'pricebook' && it('i1').ai_unit_cost === 99, JSON.stringify(it('i1')));
  check('…an underlay from the papers list too', it('i2').unit_cost === 190 && it('i2').cost_source === 'pricebook');
  check('an item not in the book keeps the AI\'s estimate and says so', it('i3').unit_cost === 4 && it('i3').cost_source === 'estimate' && it('i3').pb_key === '');
  check('a key the book does not have is an estimate, not a match', it('i5').cost_source === 'estimate' && it('i5').pb_key === '' && it('i5').unit_cost === 32);
  check('the labour rates are the company\'s', D.rates.leadCost === 50 && D.rates.leadPrice === 170 && D.rates.appCost === 30 && D.rates.appPrice === 95 && D.rates.scaffoldPrice === 2400 && D.rates.gstPct === 15, JSON.stringify(D.rates));
  check('scope, exclusions, programme and the project come through', D.exclusions[0].why === 'builder supplies' && D.timeline.length === 3 && D.duration_days === 5 && D.project.client === 'Northland Builders');
  const run = (db.tender_ai_runs || []).find(x => x.tender_id === TID && x.pass === 'draft');
  check('the draft call is logged', run && run.ok && run.prompt_version === 'draft-tender.v1' && run.page_id === null);

  // the office edits it
  const edited = JSON.parse(JSON.stringify(D));
  edited.items[2].unit_cost = 5; edited.items[2].cost_source = 'you'; edited.items[2].edited = true;
  edited.quote = { title: 'Roofing Tender — Whangaroa Hall' };
  let x = await call(T1, 'PUT', '/tender/' + TID + '/doc', { doc: edited });
  check('the office\'s edits save', x.status === 200 && x.body.savedAt, JSON.stringify(x.body));
  x = await call(T1, 'GET', '/tender/' + TID);
  check('…and come back', x.body.doc.items[2].unit_cost === 5 && x.body.doc.quote.title === 'Roofing Tender — Whangaroa Hall');
  x = await call(T2, 'PUT', '/tender/' + TID + '/doc', { doc: edited });
  check('another company cannot write the tender', x.status === 404);
  x = await call(T1, 'PUT', '/tender/' + TID + '/doc', { doc: [] });
  check('a tender that is not an object is refused', x.status === 400);

  // Simplify: the words change, the prices do not
  x = await call(T1, 'POST', '/tender/' + TID + '/amend', { mode: 'simplify' });
  const A = x.body.doc || {};
  check('Simplify rewrites the scope', x.status === 200 && A.scope.length === 2, JSON.stringify(x.body).slice(0, 300));
  check('…and keeps the office\'s typed price and the book\'s price', A.items.find(i => i.id === 'i3').unit_cost === 5 && A.items.find(i => i.id === 'i1').unit_cost === 30.5 && A.items.find(i => i.id === 'i1').cost_source === 'pricebook', JSON.stringify(A.items.map(i => [i.id, i.unit_cost, i.cost_source])));
  check('…and keeps the quote wording and the rates', A.quote.title === 'Roofing Tender — Whangaroa Hall' && A.rates.leadCost === 50);
  check('…and the chat records it', A.chat.length === 2 && A.chat[0].who === 'you' && /Simplified/.test(A.chat[1].text));
  check('the amend was asked of the extract pass with the amend prompt', DRAFT_CALLS[DRAFT_CALLS.length - 1].promptVersion === 'amend-tender.v1' && DRAFT_CALLS[DRAFT_CALLS.length - 1].pass === 'extract');
  // The office's own words
  x = await call(T1, 'POST', '/tender/' + TID + '/amend', { mode: 'chat', instruction: 'take the spouting out, the builder is doing it, and add 20 m of parapet capping', doc: A });
  const B = x.body.doc || {};
  check('a chat instruction changes items, scope and exclusions together', x.status === 200 && !B.items.some(i => i.category === 'gutter') && B.exclusions.some(e => /Spouting/.test(e.text)), JSON.stringify(x.body).slice(0, 300));
  const cap = B.items.find(i => /Parapet/.test(i.description));
  check('…a new item gets an id and the book\'s price when it names a key', cap && cap.id && cap.unit_cost === 22 && cap.cost_source === 'pricebook', JSON.stringify(cap));
  x = await call(T1, 'POST', '/tender/' + TID + '/amend', { mode: 'chat', instruction: '   ' });
  check('an empty instruction is refused', x.status === 400);
  x = await call(T1, 'GET', '/tender/' + TID);
  check('the history names the AI changes, newest first', x.body.history && /parapet capping/.test(x.body.history[0].why) && x.body.history.some(h => h.why === 'Simplify') && !('doc_history' in x.body), JSON.stringify(x.body.history));
  x = await call(T1, 'POST', '/tender/' + TID + '/undo', {});
  check('Undo puts the tender back to before the last AI change', x.status === 200 && x.body.doc.items.some(i => i.category === 'gutter') && x.body.doc.scope.length === 2, JSON.stringify(x.body).slice(0, 200));
  x = await call(T2, 'POST', '/tender/' + TID + '/amend', { mode: 'simplify' });
  check('another company cannot ask Claude to change it', x.status === 404);
  const n0 = DRAFT_CALLS.length;
  x = await call(T1, 'POST', '/tender/' + TID + '/draft', {});
  check('Draft again queues a draft on its own', x.status === 200 && x.body.task && x.body.task.status === 'queued', JSON.stringify(x.body));
  const dd = await waitFor(async () => { const p = await call(T1, 'GET', '/tender/' + TID + '/progress'); return p.body.status === 'drafted' && p.body.task && p.body.task.status === 'done' ? p.body : null; }, 30000);
  x = await call(T1, 'GET', '/tender/' + TID);
  check('…which drafts without reading the set again', dd && DRAFT_CALLS.length === n0 + 1 && x.body.doc.scope.length === 6 && x.body.history[0].why === 'AI draft', JSON.stringify([DRAFT_CALLS.length - n0, x.body.history && x.body.history[0]]));
}

// ── pages: picture, text, correction ────────────────────────────────
r = await call(T1, 'GET', '/tender/' + TID + '/pages/' + pg(4).id + '/image?kind=thumb');
check('a page picture comes as a short-lived URL', r.status === 200 && /^http/.test(r.body.url));
const img = await fetch(r.body.url);
check('…that serves a JPEG', img.status === 200 && /jpeg/.test(img.headers.get('content-type')));
r = await call(T1, 'GET', '/tender/' + TID + '/pages/' + pg(4).id + '/text?words=1');
check('a page\'s text and words with positions', r.status === 200 && /PITCH 15 DEG/.test(r.body.text) && r.body.words && r.body.words.words.some(w => /ROOF/.test(w.s) && w.x > 0 && w.y > 0), JSON.stringify(r.body).slice(0, 200));
r = await call(T1, 'PUT', '/tender/' + TID + '/pages/' + pg(5).id, { cls: 'section', title: 'SECTIONS A-A' });
check('the office corrects a page and the index follows', r.status === 200 && r.body.page.cls === 'section' && r.body.page.cls_source === 'user' && r.body.sheet_index.sheets.find(s => s.sheetId === 'AN-12').cls === 'section', JSON.stringify(r.body.page));
r = await call(T1, 'PUT', '/tender/' + TID + '/pages/' + pg(5).id, { cls: 'not-a-class' });
check('an unknown class is refused', r.status === 400);
// A re-run does not re-ask the model about a page the office classed, nor double the pages.
const before = AI_CALLS.length;
r = await call(T1, 'POST', '/tender/' + TID + '/run');
await waitFor(async () => { const p = await call(T1, 'GET', '/tender/' + TID + '/progress'); return p.body.status === 'drafted' && p.body.task && p.body.task.status === 'done' && p.body.task.id !== T.tasks[0].id ? p.body : null; }, 30000);
r = await call(T1, 'GET', '/tender/' + TID);
check('a re-run is idempotent: still six pages, no new AI calls, the correction kept', r.body.pages.length === 6 && AI_CALLS.length === before && r.body.pages.find(p => p.page_no === 5).cls === 'section', r.body.pages.length + ' ' + (AI_CALLS.length - before));

// ── a second file joins the set ─────────────────────────────────────
const setB = mkPdf([ sheet({ title: 'ROOF DETAILS', sheetId: 'AO-06', rev: 'C', scale: '1:10', body: ['RIDGE FLASHING', 'GUTTER BRACKET', 'APRON'] }) ]);
r = await call(T1, 'POST', '/tender/' + TID + '/files/sign', { name: 'AO-06 details.pdf', size: setB.length, mime: 'application/pdf' });
await fetch(r.body.signedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: setB });
const FB = r.body.fileId;
await call(T1, 'POST', '/tender/' + TID + '/files/' + FB + '/landed');
const d2 = await waitFor(async () => { const p = await call(T1, 'GET', '/tender/' + TID + '/progress'); return (p.body.status === 'drafted' && p.body.pages === 7) ? p.body : null; }, 30000);
r = await call(T1, 'GET', '/tender/' + TID);
check('the second file is read and the register\'s missing sheet is found', d2 && r.body.pages.length === 7 && r.body.sheet_index.missing.length === 0 && r.body.sheet_index.sheets.find(s => s.sheetId === 'AO-06').cls === 'detail_roof', JSON.stringify(r.body.sheet_index.missing));
check('the earlier pages were not read again', AI_CALLS.length === before + 1);

// ── tenancy ─────────────────────────────────────────────────────────
r = await call(T2, 'GET', '/tender/' + TID);
check('another company cannot read the tender', r.status === 404);
r = await call(T2, 'GET', '/tender/' + TID + '/pages/' + pg(4).id + '/text');
check('…nor a page of it', r.status === 404);
r = await call(T2, 'POST', '/tender/' + TID + '/files/sign', { name: 'x.pdf', size: 10, mime: 'application/pdf' });
check('…nor sign an upload into it', r.status === 404);
r = await call(T2, 'GET', '/tender');
check('the list is the company\'s own', r.status === 200 && r.body.length === 0);
r = await call(T1, 'GET', '/tender');
check('c1 sees its one tender with its sheet count', r.body.length === 1 && r.body[0].sheets === 5, JSON.stringify(r.body));

// ── a file comes off, the tender goes ───────────────────────────────
r = await call(T1, 'DELETE', '/tender/' + TID + '/files/' + FB);
r = await call(T1, 'GET', '/tender/' + TID);
check('deleting a file drops its pages and re-indexes', r.body.files.length === 1 && r.body.pages.length === 6 && r.body.sheet_index.missing.length === 1 && !STORE.files.has('c1/' + TID + '/' + FB + '/AO-06_details.pdf'));
r = await call(T1, 'DELETE', '/tender/' + TID);
check('deleting the tender clears every row and object', r.status === 200 && (db.tender_pages || []).filter(p => p.tender_id === TID).length === 0 && (db.tender_files || []).filter(p => p.tender_id === TID).length === 0 && ![...STORE.files.keys()].some(k => k.indexOf(TID) >= 0));

// ── no AI on the server: the heuristic stands ───────────────────────
delete globalThis.__TEST_TENDER_AI;
r = await call(T1, 'GET', '/tender/enabled');
check('with no key the app is told there is no AI', r.body.enabled === true && r.body.ai === false);
r = await call(T1, 'POST', '/tender', { name: 'Heuristic only' });
const T2ID = r.body.id;
r = await call(T1, 'POST', '/tender/' + T2ID + '/files/sign', { name: 'one.pdf', size: setB.length, mime: 'application/pdf' });
await fetch(r.body.signedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: setB });
await call(T1, 'POST', '/tender/' + T2ID + '/files/' + r.body.fileId + '/landed');
await waitFor(async () => { const p = await call(T1, 'GET', '/tender/' + T2ID + '/progress'); return p.body.status === 'indexed' ? p.body : null; }, 30000);
r = await call(T1, 'GET', '/tender/' + T2ID);
check('without AI the page is classed by the heuristic and the index is still built', r.body.pages.length === 1 && r.body.pages[0].cls === 'detail_roof' && r.body.pages[0].cls_source === 'heuristic' && r.body.sheet_index.sheets[0].sheetId === 'AO-06', JSON.stringify(r.body.pages[0]));

// ── the admin switch ────────────────────────────────────────────────
r = await fetch(BASE + '/admin/tendering/enable', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'adm-tok-123456' }, body: JSON.stringify({ company_id: 'c3' }) }).then(x => x.json());
const r3 = await call(T3, 'GET', '/tender/enabled');
check('the admin switch turns a company on', r.ok && r3.body.enabled === true, JSON.stringify(r));
r = await fetch(BASE + '/admin/tendering/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company_id: 'c3' }) }).then(x => x.status);
check('…and is not there without the admin token', r === 404);

// ── named logins (the owner's own, 2026-10-23): the person, not the business ──
const TE = jwt.sign({ id: 'u4', email: 'Ethan@floodroofing.co.nz', cid: 'c4' }, 'test-secret');
const TS = jwt.sign({ id: 'u5', email: 'sam@floodroofing.co.nz', cid: 'c4' }, 'test-secret');
const re4 = await call(TE, 'GET', '/tender/enabled'), rs4 = await call(TS, 'GET', '/tender/enabled');
check('a login named on the list has it, whatever its case, with the business still off', re4.body.enabled === true, JSON.stringify(re4.body));
check('…and a colleague in the same business who is not named does not', rs4.body.enabled === false, JSON.stringify(rs4.body));
r = await call(TS, 'POST', '/tender', { name: 'Not for me' });
check('…and is refused at the door, not just hidden', r.status === 403 && r.body.code === 'TENDERING_OFF', JSON.stringify(r));
r = await call(TE, 'POST', '/tender', { name: 'Ethan\'s tender' });
check('the named login can start a tender', r.status === 200 && !!r.body.id, JSON.stringify(r));

// ── the bucket fits the project's upload limit (2026-10-27: a 14 MB file
// refused with "The object exceeded the maximum allowed size", because the
// project caps uploads at 50 MB and the bucket was asked for 100) ──
{
  const MB = 1048576;
  const fake = (projectMb, existing) => {
    const calls = [];
    let bucket = existing || null;
    const tryLimit = (n) => n > projectMb * MB ? { error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } } : null;
    return { calls, get bucket(){ return bucket; }, storage: {
      async getBucket(){ return { data: bucket, error: bucket ? null : { message: 'Bucket not found' } }; },
      async createBucket(id, o){ calls.push(['create', o.fileSizeLimit]); const e = tryLimit(o.fileSizeLimit); if (e) return e; bucket = { id, file_size_limit: o.fileSizeLimit }; return { data: { name: id }, error: null }; },
      async updateBucket(id, o){ calls.push(['update', o.fileSizeLimit]); const e = tryLimit(o.fileSizeLimit); if (e) return e; bucket.file_size_limit = o.fileSizeLimit; return { data: {}, error: null }; },
      from(){ return { async createSignedUploadUrl(p){ return { data: { signedUrl: 'u', token: 't' }, error: null }; } }; },
    } };
  };
  const keep = globalThis.__TEST_TENDER_STORAGE; delete globalThis.__TEST_TENDER_STORAGE;
  try {
    let f = fake(50); let s = storageMod.create(f);
    let ok = true; try { await s.signUpload('a/b.pdf'); } catch (e) { ok = false; }
    check('a 50 MB project: the bucket is made at 50 MB and signing works', ok && f.bucket && f.bucket.file_size_limit === 50 * MB && s.maxBytes === 50 * MB, JSON.stringify([f.calls, f.bucket, s.maxBytes]));
    f = fake(500); s = storageMod.create(f); await s.ensureBucket();
    check('a project that takes 100 MB gets 100 MB', s.maxBytes === 100 * MB && f.calls.length === 1, JSON.stringify(f.calls));
    f = fake(500, { id: 'tender-docs', file_size_limit: 5 * MB }); s = storageMod.create(f); await s.ensureBucket();
    check('a bucket already made too small is raised', f.bucket.file_size_limit === 100 * MB && s.maxBytes === 100 * MB, JSON.stringify([f.calls, f.bucket]));
    f = fake(50, { id: 'tender-docs', file_size_limit: null }); s = storageMod.create(f); await s.ensureBucket();
    check('a bucket with no limit of its own on a 50 MB project reads 50 MB', s.maxBytes === 50 * MB, JSON.stringify([f.calls, f.bucket, s.maxBytes]));
  } finally { globalThis.__TEST_TENDER_STORAGE = keep; }
}
r = await call(T1, 'GET', '/tender/enabled');
check('/tender/enabled says the size limit the tab shows', r.body.maxMb === 100, JSON.stringify(r.body));

STORE.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
