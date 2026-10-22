// AI Tendering — the task worker.
//
// RoofMap has no queue and no second process, so this is the shape the rest
// of the server already uses for its sweeps: a row in tender_tasks is the
// job ticket, one in-process loop polls for the oldest queued one, claims it
// with a conditional update (status = 'queued' → 'running' on that row
// alone, so two server instances cannot both take it), and heartbeats while
// it works. A task left 'running' with a stale heartbeat is a crashed
// process and is taken again. Every stage is IDEMPOTENT — a page that is
// already in tender_pages is skipped — so a re-run after a crash picks up
// where it stopped rather than doubling the pages.
//
// One task type for now, `process`: ingest every file that has landed →
// classify every page → build the sheet index. Each page's text, picture,
// thumbnail and title-block tile go to storage; the row holds the facts.
'use strict';
const crypto = require('crypto');
const pdf = require('./pdf');
const sheets = require('./sheets');

const POLL_MS = +process.env.TENDER_POLL_MS || 4000;
const STALE_MS = 10 * 60 * 1000;
const TEXT_KEEP = 40000;          // chars of page text kept on the row
const PAGE_DPI = 150, PAGE_MAX_PX = 2000, TB_DPI = 300, TB_MAX_PX = 1600, THUMB_PX = 360;

function createWorker(deps){
  const { supabase, storage, ai, recordError, dispatchMail, warn } = deps;
  const log = (m) => { try { (warn || console.warn)('[tender] ' + m); } catch (e) {} };
  let timer = null, busy = false;
  const now = () => new Date().toISOString();

  async function enqueue(tender, type, userId){
    // One queued task of a type per tender: a second "run" press while one
    // waits simply rides the first.
    const { data: q } = await supabase.from('tender_tasks').select('id,status').eq('tender_id', tender.id).eq('type', type).in('status', ['queued', 'running']);
    const open = (q || []).filter(t => t.status === 'queued' || t.status === 'running');
    if (open.length) return open[0];
    const row = { id: crypto.randomUUID(), tender_id: tender.id, company_id: tender.company_id || null, user_id: userId || tender.user_id || null,
      type, status: 'queued', attempts: 0, error: '', progress: {}, heartbeat_at: null, created_at: now(), started_at: null, done_at: null };
    const { error } = await supabase.from('tender_tasks').insert(row);
    if (error) throw new Error(error.message || 'could not queue the task');
    return row;
  }

  async function claim(){
    const { data } = await supabase.from('tender_tasks').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
    let t = (data || [])[0];
    if (!t) {
      // A task somebody else was running when they died.
      const cut = new Date(Date.now() - STALE_MS).toISOString();
      const { data: stale } = await supabase.from('tender_tasks').select('*').eq('status', 'running').lt('heartbeat_at', cut).order('created_at', { ascending: true }).limit(1);
      t = (stale || [])[0];
      if (!t) return null;
      if ((t.attempts || 0) >= 3) { await supabase.from('tender_tasks').update({ status: 'failed', error: 'gave up after 3 attempts', done_at: now() }).eq('id', t.id); return null; }
    }
    const { data: got } = await supabase.from('tender_tasks')
      .update({ status: 'running', attempts: (t.attempts || 0) + 1, started_at: t.started_at || now(), heartbeat_at: now() })
      .eq('id', t.id).eq('status', t.status).select('*');
    if (!got || !got.length) return null;   // somebody else took it first
    return got[0];
  }

  async function progress(task, p){
    if (!task) return;
    task.progress = Object.assign({}, task.progress || {}, p);
    await supabase.from('tender_tasks').update({ progress: task.progress, heartbeat_at: now() }).eq('id', task.id);
  }

  async function tick(){
    if (busy) return;
    busy = true;
    try {
      const task = await claim();
      if (!task) return;
      try {
        await run(task);
        await supabase.from('tender_tasks').update({ status: 'done', done_at: now(), heartbeat_at: now(), progress: Object.assign({}, task.progress, { stage: 'done' }) }).eq('id', task.id);
      } catch (e) {
        const retry = (task.attempts || 1) < 3 && !(e && e.permanent);
        await supabase.from('tender_tasks').update({ status: retry ? 'queued' : 'failed', error: String(e && e.message || e).slice(0, 500), done_at: retry ? null : now() }).eq('id', task.id);
        if (!retry) await supabase.from('tender_jobs').update({ status: 'failed', updated_at: now() }).eq('id', task.tender_id);
        try { recordError('tender-task', e, { route: 'tender/' + task.type, company: task.company_id || '' }); } catch (e2) {}
      }
    } catch (e) {
      try { recordError('tender-worker', e, { route: 'tender/tick' }); } catch (e2) {}
    } finally { busy = false; }
  }

  async function run(task){
    const { data: tj } = await supabase.from('tender_jobs').select('*').eq('id', task.tender_id);
    const tender = (tj || [])[0];
    if (!tender) { const e = new Error('tender ' + task.tender_id + ' is gone'); e.permanent = true; throw e; }
    if (task.type !== 'process') { const e = new Error('unknown task type ' + task.type); e.permanent = true; throw e; }
    await supabase.from('tender_jobs').update({ status: 'processing', updated_at: now() }).eq('id', tender.id);
    await ingest(task, tender);
    await classify(task, tender);
    await index(task, tender);
    await supabase.from('tender_jobs').update({ status: 'indexed', updated_at: now() }).eq('id', tender.id);
    await notify(tender, task);
  }

  // ── stage 1: every landed file → pages ─────────────────────────────
  async function ingest(task, tender){
    const { data: files } = await supabase.from('tender_files').select('*').eq('tender_id', tender.id);
    const todo = (files || []).filter(f => f.status === 'landed' || f.status === 'ingesting');
    const { data: have } = await supabase.from('tender_pages').select('file_id,page_no').eq('tender_id', tender.id);
    const done = new Set((have || []).map(p => p.file_id + ':' + p.page_no));
    const totalKnown = (files || []).reduce((n, f) => n + (f.pages || 0), 0);
    await progress(task, { stage: 'ingest', files: todo.length, pagesDone: done.size, pagesTotal: totalKnown || null });
    for (const f of todo) {
      await supabase.from('tender_files').update({ status: 'ingesting' }).eq('id', f.id);
      let buf, doc;
      try { buf = await storage.download(f.storage_path); }
      catch (e) { await supabase.from('tender_files').update({ status: 'failed', error: 'could not read the upload: ' + e.message }).eq('id', f.id); continue; }
      try { doc = await pdf.open(buf); }
      catch (e) { await supabase.from('tender_files').update({ status: 'failed', error: 'not a PDF that can be opened: ' + String(e.message || e).slice(0, 200) }).eq('id', f.id); continue; }
      const n = doc.numPages;
      const info = await pdf.meta(doc);
      await supabase.from('tender_files').update({ pages: n, meta: { title: info.Title || '', producer: info.Producer || '', creator: info.Creator || '' } }).eq('id', f.id);
      for (let pageNo = 1; pageNo <= n; pageNo++) {
        if (done.has(f.id + ':' + pageNo)) continue;
        await progress(task, { stage: 'ingest', file: f.name, pageNo, pagesDone: done.size, pagesTotal: Math.max(totalKnown, done.size + (n - pageNo + 1)) });
        const row = await ingestPage(tender, f, doc, pageNo);
        const { error } = await supabase.from('tender_pages').insert(row);
        if (error) throw new Error('could not record page ' + pageNo + ' of ' + f.name + ': ' + error.message);
        done.add(f.id + ':' + pageNo);
      }
      try { await doc.destroy(); } catch (e) {}
      await supabase.from('tender_files').update({ status: 'ingested', error: '' }).eq('id', f.id);
    }
  }

  async function ingestPage(tender, f, doc, pageNo){
    const base = tender.company_id + '/' + tender.id + '/' + f.id + '/p' + pageNo;
    const ex = await pdf.extract(doc, pageNo);
    const tb = pdf.titleBlockRegion(ex.width, ex.height);
    const tbText = ex.lines.filter(l => l.x >= tb.x - 1 && l.y >= tb.y - 1).map(l => l.s).join('\n');
    const parsed = sheets.parseTitleBlock(ex);
    const heur = sheets.classifyHeuristic(parsed.title, ex.fullText);
    const paths = {};
    try {
      const img = await pdf.render(doc, pageNo, { dpi: PAGE_DPI, maxPx: PAGE_MAX_PX });
      await storage.upload(base + '.jpg', img.buf, 'image/jpeg'); paths.image = base + '.jpg';
      const th = await pdf.thumbnail(doc, pageNo, THUMB_PX);
      await storage.upload(base + '.thumb.jpg', th.buf, 'image/jpeg'); paths.thumb = base + '.thumb.jpg';
      const tile = await pdf.render(doc, pageNo, { dpi: TB_DPI, maxPx: TB_MAX_PX, region: tb });
      await storage.upload(base + '.tb.jpg', tile.buf, 'image/jpeg'); paths.tb = base + '.tb.jpg';
    } catch (e) {
      log('render failed on ' + f.name + ' p' + pageNo + ': ' + e.message);
    }
    try { await storage.upload(base + '.words.json', Buffer.from(JSON.stringify({ width: ex.width, height: ex.height, words: ex.words, lines: ex.lines })), 'application/json'); paths.words = base + '.words.json'; }
    catch (e) { log('words upload failed on ' + f.name + ' p' + pageNo + ': ' + e.message); }
    return {
      id: crypto.randomUUID(), tender_id: tender.id, file_id: f.id, company_id: tender.company_id || null, user_id: tender.user_id || null,
      page_no: pageNo, width: ex.width, height: ex.height, rotation: ex.rotation,
      sheet_id: parsed.sheetId, title: parsed.title, revision: parsed.revision, scale: parsed.scale, sheet_date: parsed.date,
      cls: heur.cls, cls_conf: heur.conf, cls_source: 'heuristic',
      text: ex.fullText.slice(0, TEXT_KEEP), text_chars: ex.fullText.length, tb_text: tbText.slice(0, 4000),
      image_path: paths.image || '', thumb_path: paths.thumb || '', tb_path: paths.tb || '', words_path: paths.words || '',
      meta: { parsed, heuristic: heur, lines: ex.lines.length, words: ex.words.length },
      created_at: now(),
    };
  }

  // ── stage 2: the classifier over every page not yet asked ──────────
  async function classify(task, tender){
    if (!ai.available()) { await progress(task, { stage: 'classify', skipped: 'no AI key on the server' }); return; }
    const { data: pages } = await supabase.from('tender_pages').select('*').eq('tender_id', tender.id).order('page_no', { ascending: true });
    // A page the model has answered, failed on, or the OFFICE has classed is
    // never asked again — their word outranks the model's.
    const todo = (pages || []).filter(p => p.cls_source !== 'ai' && p.cls_source !== 'ai-failed' && p.cls_source !== 'user');
    let i = 0;
    for (const p of todo) {
      i++;
      await progress(task, { stage: 'classify', pageNo: p.page_no, done: i - 1, total: todo.length });
      let img = '', tbi = '';
      try { if (p.image_path) img = (await storage.download(p.image_path)).toString('base64'); } catch (e) {}
      try { if (p.tb_path) tbi = (await storage.download(p.tb_path)).toString('base64'); } catch (e) {}
      const heur = (p.meta && p.meta.heuristic) || { cls: p.cls, conf: p.cls_conf };
      const parsed = (p.meta && p.meta.parsed) || {};
      const runRow = { id: crypto.randomUUID(), tender_id: tender.id, company_id: tender.company_id || null, user_id: tender.user_id || null,
        page_id: p.id, pass: 'classify', model: '', prompt_version: '', in_tokens: 0, out_tokens: 0, cache_read: 0, cache_write: 0,
        cost_usd: 0, ms: 0, ok: false, error: '', created_at: now() };
      try {
        const r = await ai.classifyPage({ titleBlockText: p.tb_text, text: p.text, imageBase64: img, tbBase64: tbi,
          heuristic: { cls: heur.cls, sheetId: parsed.sheetId, title: parsed.title, revision: parsed.revision } });
        const u = r.usage || {};
        Object.assign(runRow, { model: r.model, prompt_version: r.promptVersion, in_tokens: u.input_tokens || 0, out_tokens: u.output_tokens || 0,
          cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, cost_usd: +ai.costUsd(r.model, u).toFixed(5), ms: r.ms, ok: true });
        const res = r.result;
        // The model's read wins; the parser's stays in meta for the audit.
        // A field the model left blank keeps the parser's — "" from the
        // model means "not printed", and the parser found it printed.
        const upd = {
          cls: res.cls, cls_conf: res.conf, cls_source: 'ai',
          sheet_id: res.sheetId || p.sheet_id || '', title: res.title || p.title || '', revision: res.revision || p.revision || '', scale: res.scale || p.scale || '',
          meta: Object.assign({}, p.meta || {}, { ai: Object.assign({}, res, { model: r.model, promptVersion: r.promptVersion }), agree: res.cls === heur.cls }),
        };
        await supabase.from('tender_pages').update(upd).eq('id', p.id);
      } catch (e) {
        runRow.error = String(e && e.message || e).slice(0, 400);
        await supabase.from('tender_pages').update({ cls_source: 'ai-failed', meta: Object.assign({}, p.meta || {}, { aiError: runRow.error }) }).eq('id', p.id);
        log('classify failed on page ' + p.page_no + ': ' + runRow.error);
      }
      await supabase.from('tender_ai_runs').insert(runRow);
    }
    await progress(task, { stage: 'classify', done: todo.length, total: todo.length });
  }

  // ── stage 3: the sheet index ───────────────────────────────────────
  async function index(task, tender){
    await progress(task, { stage: 'index' });
    const { data: files } = await supabase.from('tender_files').select('id,name').eq('tender_id', tender.id);
    const fname = {}; (files || []).forEach(f => { fname[f.id] = f.name; });
    const { data: pages } = await supabase.from('tender_pages').select('id,file_id,page_no,sheet_id,title,revision,scale,sheet_date,cls,cls_conf,cls_source,words_path,meta').eq('tender_id', tender.id);
    const list = [];
    for (const p of (pages || [])) {
      const row = { pageId: p.id, fileId: p.file_id, fileName: fname[p.file_id] || '', pageNo: p.page_no, sheetId: p.sheet_id, title: p.title,
        revision: p.revision, date: p.sheet_date, scale: p.scale, cls: p.cls, conf: p.cls_conf, source: p.cls_source, lines: null };
      if ((p.cls === 'index' || p.cls === 'cover') && p.words_path) {
        try { row.lines = JSON.parse((await storage.download(p.words_path)).toString('utf8')).lines || []; } catch (e) {}
      }
      list.push(row);
    }
    const idx = sheets.buildIndex(list);
    idx.builtAt = now();
    idx.pages = list.length;
    await supabase.from('tender_jobs').update({ sheet_index: idx, updated_at: now() }).eq('id', tender.id);
    return idx;
  }

  async function notify(tender, task){
    if (!dispatchMail || process.env.TENDER_NOTIFY === 'false') return;
    try {
      const { data: prof } = await supabase.from('profiles').select('email').eq('id', tender.user_id);
      const to = (prof || [])[0] && prof[0].email;
      if (!to) return;
      const { data: tj } = await supabase.from('tender_jobs').select('sheet_index,name').eq('id', tender.id);
      const idx = ((tj || [])[0] || {}).sheet_index || {};
      const counts = idx.counts || {};
      const lines = Object.keys(counts).map(k => '  ' + k.replace(/_/g, ' ') + ': ' + counts[k]);
      const text = 'The plan set for "' + (tender.name || 'your tender') + '" has been read.\n\n' +
        (idx.sheets || []).length + ' sheets indexed' + ((idx.unnumbered || []).length ? (' (' + idx.unnumbered.length + ' pages without a sheet number)') : '') + ':\n' + lines.join('\n') + '\n' +
        ((idx.warnings || []).length ? ('\nWorth a look:\n' + idx.warnings.map(w => '  - ' + w.text).join('\n') + '\n') : '') +
        '\nOpen RoofMap → the job\'s AI Tendering tab to check the sheet index.\n';
      await dispatchMail({ to, subject: 'Plan set read: ' + (tender.name || 'tender'), text, platform: true });
    } catch (e) { log('notify failed: ' + e.message); }
  }

  function start(){
    if (timer || process.env.TENDER_WORKER === 'off') return;
    timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
    if (timer.unref) timer.unref();
  }
  function stop(){ if (timer) clearInterval(timer); timer = null; }

  return { enqueue, tick, start, stop, run, ingest, classify, index, POLL_MS };
}

module.exports = { createWorker };
