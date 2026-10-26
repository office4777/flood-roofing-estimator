// AI Tendering — the HTTP surface. Mounted from server.js with the helpers
// it needs handed in; nothing here reaches into the rest of the server.
//
// Every route is behind requireAuth + requireSubscription + requireTendering
// (the per-company flag), and every read is scoped IN THE QUERY with
// _scopeCompany — a tender names a customer's project and carries their
// drawings. Files never pass through here: `files/sign` hands the browser a
// signed URL for one exact path under {company}/{tender}/ and the browser
// PUTs the PDF straight to storage; `landed` is how it says it did.
'use strict';
const crypto = require('crypto');
const sheets = require('./sheets');

const MAX_FILES = 40;
const now = () => new Date().toISOString();
const PAGE_COLS = 'id,file_id,page_no,width,height,sheet_id,title,revision,scale,sheet_date,cls,cls_conf,cls_source,text_chars,image_path,thumb_path,tb_path,meta,created_at';

function mount(app, deps){
  const { supabase, storage, worker, ai, requireAuth, requireSubscription, scopeCompany, settingsRow, adminOk, recordError, recordUsage, rateLimit } = deps;

  // ── the flag ──────────────────────────────────────────────────────
  // branding.ai_tendering_enabled on the company's settings. Unknown is
  // OFF here (the server is where a "no" is cheap and safe); the app hides
  // the picker on the same key. TENDERING_ALL=true opens it for every
  // account on a dev server and nowhere else.
  // Who has it: named logins first (TENDERING_USERS; the owner asked on
  // 2026-10-23 for his three Flood Roofing logins only, so it is a list of
  // PEOPLE, not the company — the rest of that business does not see it),
  // then a business switched on whole (branding.ai_tendering_enabled).
  const TENDER_USERS = String(process.env.TENDERING_USERS || 'office@floodroofing.co.nz, aron@floodroofing.co.nz, ethan@floodroofing.co.nz')
    .split(/[\s,]+/).map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
  async function enabledFor(req){
    if (process.env.TENDERING_ALL === 'true') return true;
    let em = String((req.user && req.user.email) || '').trim().toLowerCase();
    // A token minted without an email still names the person: read theirs.
    if (!em && req.user && req.user.id) {
      try { const p = await supabase.from('profiles').select('email').eq('id', req.user.id).maybeSingle();
        em = String((p && p.data && p.data.email) || '').trim().toLowerCase(); } catch (e) {}
    }
    if (em && TENDER_USERS.indexOf(em) >= 0) return true;
    try {
      const row = await settingsRow(req, 'branding,company_id,user_id');
      return !!(row && row.branding && row.branding.ai_tendering_enabled);
    } catch (e) { return false; }
  }
  async function requireTendering(req, res, next){
    if (await enabledFor(req)) return next();
    return res.status(403).json({ error: 'AI Tendering is not switched on for this business yet.', code: 'TENDERING_OFF' });
  }
  const gate = [requireAuth, requireSubscription, requireTendering];

  async function tenderFor(req, id){
    const { data, error } = await scopeCompany(supabase.from('tender_jobs').select('*').eq('id', id), req).limit(1);
    if (error) throw new Error(error.message);
    return (data && data[0]) || null;
  }
  const bad = (res, msg, code) => res.status(400).json({ error: msg, code: code || 'BAD_REQUEST' });
  const oops = (res, e, route) => { try { recordError('tender', e, { route }); } catch (e2) {} res.status(500).json({ error: String(e && e.message || e) }); };

  // Is it on? The app asks once at boot to decide whether to show the type.
  app.get('/tender/enabled', requireAuth, async (req, res) => {
    const on = await enabledFor(req);
    if (on) { try { await storage.ensureBucket(); } catch (e) {} }
    res.json({ enabled: on, ai: ai.available(), models: ai.MODELS, maxMb: Math.floor(storage.maxBytes / 1048576) });
  });

  app.get('/tender', ...gate, async (req, res) => {
    try {
      const { data, error } = await scopeCompany(supabase.from('tender_jobs').select('id,name,job_id,status,created_at,updated_at,sheet_index'), req).order('updated_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      res.json((data || []).map(t => ({ id: t.id, name: t.name, job_id: t.job_id, status: t.status, created_at: t.created_at, updated_at: t.updated_at,
        sheets: t.sheet_index && t.sheet_index.sheets ? t.sheet_index.sheets.length : 0, warnings: t.sheet_index && t.sheet_index.warnings ? t.sheet_index.warnings.length : 0 })));
    } catch (e) { oops(res, e, 'GET /tender'); }
  });

  app.post('/tender', ...gate, async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 200);
      const jobId = b.job_id ? String(b.job_id).slice(0, 80) : null;
      // One tender per RoofMap job: a second press on the same job opens it.
      if (jobId) {
        const { data: ex } = await scopeCompany(supabase.from('tender_jobs').select('*').eq('job_id', jobId), req).limit(1);
        if (ex && ex[0]) return res.json(ex[0]);
      }
      const row = { id: crypto.randomUUID(), company_id: req.companyId || null, user_id: req.user.id, job_id: jobId, name: name || 'Tender',
        status: 'new', settings: {}, sheet_index: null, created_at: now(), updated_at: now() };
      const { error } = await supabase.from('tender_jobs').insert(row);
      if (error) throw new Error(error.message);
      // No usage milestone: the privacy policy lists every one it records
      // (tests/legal.mjs counts them), and this is not one of them yet.
      res.json(row);
    } catch (e) { oops(res, e, 'POST /tender'); }
  });

  app.get('/tender/:id', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const [files, pages, tasks] = await Promise.all([
        supabase.from('tender_files').select('id,name,size,mime,status,pages,error,meta,created_at').eq('tender_id', t.id).order('created_at', { ascending: true }),
        supabase.from('tender_pages').select(PAGE_COLS).eq('tender_id', t.id).order('page_no', { ascending: true }),
        supabase.from('tender_tasks').select('id,type,status,attempts,error,progress,created_at,started_at,done_at,heartbeat_at').eq('tender_id', t.id).order('created_at', { ascending: false }).limit(5),
      ]);
      res.json(Object.assign({}, t, { files: files.data || [], pages: (pages.data || []).map(_pageOut), tasks: tasks.data || [], ai: ai.available() }));
    } catch (e) { oops(res, e, 'GET /tender/:id'); }
  });

  app.put('/tender/:id', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const b = req.body || {};
      const patch = { updated_at: now() };
      if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 200) || t.name;
      if (b.job_id !== undefined) patch.job_id = b.job_id ? String(b.job_id).slice(0, 80) : null;
      if (b.settings && typeof b.settings === 'object') patch.settings = Object.assign({}, t.settings || {}, b.settings);
      const { error } = await supabase.from('tender_jobs').update(patch).eq('id', t.id);
      if (error) throw new Error(error.message);
      res.json(Object.assign({}, t, patch));
    } catch (e) { oops(res, e, 'PUT /tender/:id'); }
  });

  app.delete('/tender/:id', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const { data: files } = await supabase.from('tender_files').select('id,storage_path').eq('tender_id', t.id);
      const { data: pages } = await supabase.from('tender_pages').select('image_path,thumb_path,tb_path,words_path').eq('tender_id', t.id);
      const paths = [];
      (files || []).forEach(f => f.storage_path && paths.push(f.storage_path));
      (pages || []).forEach(p => ['image_path', 'thumb_path', 'tb_path', 'words_path'].forEach(k => p[k] && paths.push(p[k])));
      try { await storage.remove(paths); } catch (e) { recordError('tender', e, { route: 'DELETE /tender/:id storage' }); }
      for (const tbl of ['tender_ai_runs', 'tender_pages', 'tender_files', 'tender_tasks']) await supabase.from(tbl).delete().eq('tender_id', t.id);
      await supabase.from('tender_jobs').delete().eq('id', t.id);
      res.json({ ok: true });
    } catch (e) { oops(res, e, 'DELETE /tender/:id'); }
  });

  // ── files ─────────────────────────────────────────────────────────
  app.post('/tender/:id/files/sign', ...gate, rateLimit(120, 60000), async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 200);
      const size = +b.size || 0;
      const mime = String(b.mime || 'application/pdf').slice(0, 80);
      if (!/\.pdf$/i.test(name) && !/pdf/i.test(mime)) return bad(res, 'Only PDF plan sets can be uploaded here (' + (name || 'this file') + ').', 'NOT_PDF');
      if (size <= 0) return bad(res, 'The file is empty.', 'EMPTY');
      try { await storage.ensureBucket(); } catch (e) { throw new Error('File storage is not ready (' + (e.message || e) + ').'); }
      if (size > storage.maxBytes) return bad(res, 'That file is ' + (size / 1048576).toFixed(0) + ' MB; the limit is ' + (storage.maxBytes / 1048576) + ' MB.', 'TOO_BIG');
      const { data: have } = await supabase.from('tender_files').select('id,name,size,status').eq('tender_id', t.id);
      if ((have || []).length >= MAX_FILES) return bad(res, 'A tender holds at most ' + MAX_FILES + ' files.', 'TOO_MANY');
      const dup = (have || []).find(f => f.name === name && f.size === size && f.status !== 'failed' && f.status !== 'pending');
      if (dup) return res.json({ fileId: dup.id, duplicate: true });
      const fid = crypto.randomUUID();
      const path = (req.companyId || 'u-' + req.user.id) + '/' + t.id + '/' + fid + '/' + name.replace(/[^\w.\-]+/g, '_');
      const signed = await storage.signUpload(path);
      const row = { id: fid, tender_id: t.id, company_id: req.companyId || null, user_id: req.user.id, name, size, mime, storage_path: path,
        status: 'pending', pages: 0, error: '', meta: {}, created_at: now() };
      const { error } = await supabase.from('tender_files').insert(row);
      if (error) throw new Error(error.message);
      res.json({ fileId: fid, signedUrl: signed.signedUrl, token: signed.token, path, maxBytes: storage.maxBytes });
    } catch (e) { oops(res, e, 'POST /tender/:id/files/sign'); }
  });

  app.post('/tender/:id/files/:fid/landed', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const { data: fs } = await supabase.from('tender_files').select('*').eq('id', req.params.fid).eq('tender_id', t.id);
      const f = (fs || [])[0];
      if (!f) return res.status(404).json({ error: 'File not found' });
      if (f.status === 'pending') await supabase.from('tender_files').update({ status: 'landed' }).eq('id', f.id);
      const run = (req.body && req.body.run === false) ? false : true;
      let task = null;
      if (run) { task = await worker.enqueue(t, 'process', req.user.id); await supabase.from('tender_jobs').update({ status: 'queued', updated_at: now() }).eq('id', t.id); }
      res.json({ ok: true, fileId: f.id, task: task && { id: task.id, status: task.status } });
    } catch (e) { oops(res, e, 'POST /tender/:id/files/:fid/landed'); }
  });

  app.delete('/tender/:id/files/:fid', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const { data: fs } = await supabase.from('tender_files').select('*').eq('id', req.params.fid).eq('tender_id', t.id);
      const f = (fs || [])[0];
      if (!f) return res.status(404).json({ error: 'File not found' });
      const { data: pages } = await supabase.from('tender_pages').select('id,image_path,thumb_path,tb_path,words_path').eq('file_id', f.id);
      const paths = [f.storage_path].filter(Boolean);
      (pages || []).forEach(p => ['image_path', 'thumb_path', 'tb_path', 'words_path'].forEach(k => p[k] && paths.push(p[k])));
      try { await storage.remove(paths); } catch (e) { recordError('tender', e, { route: 'DELETE file storage' }); }
      await supabase.from('tender_ai_runs').delete().eq('tender_id', t.id).in('page_id', (pages || []).map(p => p.id).concat(['-']));
      await supabase.from('tender_pages').delete().eq('file_id', f.id);
      await supabase.from('tender_files').delete().eq('id', f.id);
      // The index no longer describes the set: rebuild it from what is left.
      try { await worker.index(null, t); } catch (e) { recordError('tender', e, { route: 'DELETE file reindex' }); }
      res.json({ ok: true });
    } catch (e) { oops(res, e, 'DELETE /tender/:id/files/:fid'); }
  });

  // ── running and watching ──────────────────────────────────────────
  app.post('/tender/:id/run', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const { data: fs } = await supabase.from('tender_files').select('id,status').eq('tender_id', t.id);
      const ready = (fs || []).filter(f => f.status !== 'pending' && f.status !== 'failed');
      if (!ready.length) return bad(res, 'Upload a plan set first.', 'NO_FILES');
      if (req.body && req.body.reclassify) {
        // Ask the model again about every page (a new prompt version, say).
        await supabase.from('tender_pages').update({ cls_source: 'heuristic' }).eq('tender_id', t.id);
      }
      const task = await worker.enqueue(t, 'process', req.user.id);
      await supabase.from('tender_jobs').update({ status: 'queued', updated_at: now() }).eq('id', t.id);
      res.json({ ok: true, task: { id: task.id, status: task.status } });
    } catch (e) { oops(res, e, 'POST /tender/:id/run'); }
  });

  app.get('/tender/:id/progress', ...gate, async (req, res) => {
    try {
      const t = await tenderFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Tender not found' });
      const { data: tasks } = await supabase.from('tender_tasks').select('id,type,status,attempts,error,progress,created_at,started_at,done_at,heartbeat_at').eq('tender_id', t.id).order('created_at', { ascending: false }).limit(1);
      const { data: pages } = await supabase.from('tender_pages').select('id,cls_source').eq('tender_id', t.id);
      const { data: files } = await supabase.from('tender_files').select('id,status,pages').eq('tender_id', t.id);
      res.json({ status: t.status, task: (tasks || [])[0] || null, pages: (pages || []).length, classified: (pages || []).filter(p => p.cls_source === 'ai' || p.cls_source === 'user').length,
        files: (files || []).map(f => ({ id: f.id, status: f.status, pages: f.pages })), indexedAt: t.sheet_index && t.sheet_index.builtAt || null });
    } catch (e) { oops(res, e, 'GET /tender/:id/progress'); }
  });

  // ── pages ─────────────────────────────────────────────────────────
  async function pageFor(req, res){
    const t = await tenderFor(req, req.params.id);
    if (!t) { res.status(404).json({ error: 'Tender not found' }); return null; }
    const { data } = await supabase.from('tender_pages').select('*').eq('id', req.params.pid).eq('tender_id', t.id);
    const p = (data || [])[0];
    if (!p) { res.status(404).json({ error: 'Page not found' }); return null; }
    return { t, p };
  }
  // A short-lived signed URL for the page's picture — the app puts it on an
  // <img>, which cannot carry the session token.
  app.get('/tender/:id/pages/:pid/image', ...gate, async (req, res) => {
    try {
      const x = await pageFor(req, res); if (!x) return;
      const kind = String(req.query.kind || 'image');
      const path = kind === 'thumb' ? x.p.thumb_path : kind === 'tb' ? x.p.tb_path : x.p.image_path;
      if (!path) return res.status(404).json({ error: 'No picture of this page' });
      res.json({ url: await storage.signedUrl(path, 900), expiresIn: 900 });
    } catch (e) { oops(res, e, 'GET page image'); }
  });
  app.get('/tender/:id/pages/:pid/text', ...gate, async (req, res) => {
    try {
      const x = await pageFor(req, res); if (!x) return;
      let words = null;
      if (String(req.query.words || '') === '1' && x.p.words_path) {
        try { words = JSON.parse((await storage.download(x.p.words_path)).toString('utf8')); } catch (e) {}
      }
      res.json({ id: x.p.id, text: x.p.text || '', tb_text: x.p.tb_text || '', words });
    } catch (e) { oops(res, e, 'GET page text'); }
  });
  // The office corrects a page: class, sheet id, title, revision. Theirs
  // wins over the model's from then on (cls_source 'user') and the index is
  // rebuilt at once.
  app.put('/tender/:id/pages/:pid', ...gate, async (req, res) => {
    try {
      const x = await pageFor(req, res); if (!x) return;
      const b = req.body || {};
      const patch = {};
      if (typeof b.cls === 'string') { if (sheets.CLASSES.indexOf(b.cls) < 0) return bad(res, 'Unknown page class ' + b.cls); patch.cls = b.cls; patch.cls_conf = 1; patch.cls_source = 'user'; }
      if (typeof b.sheet_id === 'string') patch.sheet_id = b.sheet_id.trim().toUpperCase().slice(0, 30);
      if (typeof b.title === 'string') patch.title = b.title.trim().slice(0, 120);
      if (typeof b.revision === 'string') patch.revision = b.revision.trim().toUpperCase().slice(0, 10);
      if (!Object.keys(patch).length) return bad(res, 'Nothing to change');
      if (!patch.cls_source) patch.cls_source = 'user';
      patch.meta = Object.assign({}, x.p.meta || {}, { userEdit: Object.assign({}, (x.p.meta || {}).userEdit || {}, patch, { at: now() }) });
      const { error } = await supabase.from('tender_pages').update(patch).eq('id', x.p.id);
      if (error) throw new Error(error.message);
      const idx = await worker.index(null, x.t);
      res.json({ ok: true, page: _pageOut(Object.assign({}, x.p, patch)), sheet_index: idx });
    } catch (e) { oops(res, e, 'PUT page'); }
  });

  // ── admin: the switch ─────────────────────────────────────────────
  app.post('/admin/tendering/enable', async (req, res) => {
    if (!adminOk(req)) return res.status(404).json({ error: 'Not found' });
    try {
      const cid = String((req.body && req.body.company_id) || '');
      const on = !(req.body && req.body.on === false);
      if (!cid) return bad(res, 'company_id required');
      const { data: rows } = await supabase.from('user_settings').select('user_id,company_id,branding').eq('company_id', cid);
      if (!rows || !rows.length) return res.status(404).json({ error: 'No settings row for that company' });
      for (const r of rows) {
        const br = Object.assign({}, r.branding || {}, { ai_tendering_enabled: on });
        await supabase.from('user_settings').update({ branding: br }).eq('user_id', r.user_id).eq('company_id', cid);
      }
      res.json({ ok: true, company_id: cid, enabled: on, rows: rows.length });
    } catch (e) { oops(res, e, 'POST /admin/tendering/enable'); }
  });
}

function _pageOut(p){
  const m = p.meta || {};
  return { id: p.id, file_id: p.file_id, page_no: p.page_no, width: p.width, height: p.height,
    sheet_id: p.sheet_id || '', title: p.title || '', revision: p.revision || '', scale: p.scale || '', sheet_date: p.sheet_date || '',
    cls: p.cls || 'other', cls_conf: p.cls_conf, cls_source: p.cls_source || '', text_chars: p.text_chars || 0,
    has_image: !!p.image_path, has_thumb: !!p.thumb_path, has_tb: !!p.tb_path,
    parsed: m.parsed ? { sheetId: m.parsed.sheetId, title: m.parsed.title, revision: m.parsed.revision, confidence: m.parsed.confidence, from: m.parsed.from } : null,
    heuristic: m.heuristic || null, ai: m.ai || null, agree: m.agree, aiError: m.aiError || '', userEdit: m.userEdit || null, created_at: p.created_at };
}

module.exports = { mount };
