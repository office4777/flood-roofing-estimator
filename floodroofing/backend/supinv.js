// SUPPLIER INVOICES + XERO (2026-11-13, the owner: "build the supplier invoices
// tab and give the user two options ... set up filters in their email ... so
// all supplier invoices get forwarded onto RoofMap, or ... give all their
// material suppliers their new invoicing email ... read the invoice and auto
// allocate to whichever specific job it is ... build a Xero connection so that
// the invoices can be allocated to a job and sent to Xero ... an assign to
// column with a search bar ... click to view summary ... click to open the PDF").
//
// THE ROUTE IN: every business has its own address on SUPINV_DOMAIN
// (<name>-<code>@invoices.roofmap.co.nz). Resend receives the mail (inbound,
// a catch-all on that domain) and calls POST /supinv/inbound with the email's
// metadata; the attachments are fetched from Resend's API, kept in the private
// 'supplier-invoices' bucket, read by Claude (supplier, number, dates, money,
// the references on it) and matched to a job by the job number, else the site
// address. Anything the match cannot be sure of waits in the tab for the
// office to assign. An upload in the tab takes the same path.
//
// ONLY THE NAMED LOGINS SEE IT FOR NOW (the owner, the same day: "only make
// these new changes go live on aaron@floodroofing.co.nz's account"):
// SUPINV_USERS (default his two spellings), SUPINV_ALL=true opens it for all.
//
// Seams: globalThis.__TEST_SUPINV_FETCH (fetch-like, every Resend / Xero call),
// __TEST_SUPINV_AI (async ({mime, bytes, name}) => record), __TEST_SUPINV_STORAGE.
'use strict';
const crypto = require('crypto');

const now = () => new Date().toISOString();
const COLS = 'id,company_id,user_id,source,email_id,from_addr,subject,received_at,file_name,mime,size,storage_path,status,error,read_via,' +
  'kind,supplier,inv_number,inv_date,due_date,subtotal,gst,total,currency,refs,site_address,description,lines,' +
  'job_id,job_label,alloc,alloc_why,suggest,xero,created_at,updated_at';
const LIST_COLS = COLS.replace(',lines', '');
const MAX_BYTES = 15 * 1024 * 1024;
const OK_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i;

function mount(app, deps){
  const { supabase, requireAuth, requireSubscription, scopeCompany, recordError, rateLimit, mailEnc, mailDec,
          publicApiUrl, publicAppUrl, companyName, localPart } = deps;

  // ── who may use it ──────────────────────────────────────────────
  const USERS = String(process.env.SUPINV_USERS || 'aron@floodroofing.co.nz, aaron@floodroofing.co.nz')
    .split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  async function enabledFor(req){
    if (process.env.SUPINV_ALL === 'true') return true;
    let em = String((req.user && req.user.email) || '').trim().toLowerCase();
    if (!em && req.user && req.user.id) {
      try { const p = await supabase.from('profiles').select('email').eq('id', req.user.id).maybeSingle();
        em = String((p && p.data && p.data.email) || '').trim().toLowerCase(); } catch (e) {}
    }
    return !!em && USERS.indexOf(em) >= 0;
  }
  async function requireSupinv(req, res, next){
    if (await enabledFor(req)) return next();
    return res.status(403).json({ error: 'Supplier invoices are not switched on for this account yet.', code: 'SUPINV_OFF' });
  }
  const gate = [requireAuth, requireSubscription, requireSupinv];
  const fetchX = (url, opts) => (globalThis.__TEST_SUPINV_FETCH || fetch)(url, opts);

  // ── storage ─────────────────────────────────────────────────────
  let _st = null;
  function storage(){
    if (globalThis.__TEST_SUPINV_STORAGE) return globalThis.__TEST_SUPINV_STORAGE;
    return _st || (_st = require('./tender/storage').create(supabase,
      { bucket: process.env.SUPINV_BUCKET || 'supplier-invoices', seam: '__TEST_SUPINV_STORAGE' }));
  }

  // ── the address ─────────────────────────────────────────────────
  const DOMAIN = String(process.env.SUPINV_DOMAIN || 'invoices.roofmap.co.nz').trim().toLowerCase();
  async function inboxOf(req, make){
    const r = await scopeCompany(supabase.from('supinv_inboxes').select('id,local,company_id'), req).limit(1);
    if (r.error) throw new Error(r.error.message);
    let row = (r.data && r.data[0]) || null;
    if (row || !make) return row;
    const base = (localPart(await companyName(req.companyId)) || 'roofer').slice(0, 20);
    for (let i = 0; i < 5 && !row; i++) {
      const local = base + '-' + crypto.randomBytes(3).toString('hex').slice(0, 4);
      const ins = { id: crypto.randomUUID(), company_id: req.companyId || null, user_id: req.user.id, local, created_at: now() };
      const w = await supabase.from('supinv_inboxes').insert(ins);
      if (!w.error) row = ins;
      else if (!/duplicate|unique/i.test(w.error.message || '')) throw new Error(w.error.message);
    }
    if (!row) throw new Error('Could not make an invoice address.');
    return row;
  }
  app.get('/supinv/enabled', requireAuth, async (req, res) => {
    res.json({ enabled: await enabledFor(req) });
  });
  app.get('/supinv/address', gate, async (req, res) => {
    try {
      const row = await inboxOf(req, true);
      res.json({ ok: true, address: row.local + '@' + DOMAIN, domain: DOMAIN,
        receiving: !!(process.env.RESEND_INBOUND_SECRET || globalThis.__TEST_SUPINV_FETCH) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // ── the inbound webhook (Resend, signed by Svix) ───────────────
  // Registered on the RAW body ahead of the JSON parser (server.js), because
  // the signature is over the exact bytes.
  function svixOk(req, raw){
    const secret = process.env.RESEND_INBOUND_SECRET;
    if (!secret) return !!globalThis.__TEST_SUPINV_FETCH;   // the suites, never production
    const id = req.get('svix-id') || req.get('webhook-id'), ts = req.get('svix-timestamp') || req.get('webhook-timestamp');
    const sig = String(req.get('svix-signature') || req.get('webhook-signature') || '');
    if (!id || !ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - (+ts || 0)) > 600) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const want = crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + raw).digest('base64');
    return sig.split(' ').some(p => { const v = p.split(',')[1] || ''; try {
      return v.length === want.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(want)); } catch (e) { return false; } });
  }
  async function resendGet(path){
    const key = process.env.RESEND_API_KEY;
    const r = await fetchX('https://api.resend.com' + path, { headers: { Authorization: 'Bearer ' + (key || 'test') } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Resend ' + r.status + ': ' + String((d && (d.message || d.error)) || '').slice(0, 160));
    return d;
  }
  async function inbound(req, res){
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    if (!svixOk(req, raw)) return res.status(401).json({ error: 'bad signature' });
    let ev = null; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'not JSON' }); }
    const type = String((ev && ev.type) || '');
    if (!/email\.received$/.test(type)) return res.json({ ok: true, ignored: type });
    const d = ev.data || {};
    const tos = [].concat(d.to || [], d.cc || []).map(a => String(a || '').toLowerCase());
    const locals = tos.map(a => { const m = /<?([^<>\s@]+)@([^<>\s]+?)>?$/.exec(a.trim()); return m && m[2] === DOMAIN ? m[1] : null; }).filter(Boolean);
    try {
      let inbox = null;
      for (const l of locals) {
        const r = await supabase.from('supinv_inboxes').select('id,local,company_id,user_id').eq('local', l).limit(1);
        if (r.error) throw new Error(r.error.message);
        if (r.data && r.data[0]) { inbox = r.data[0]; break; }
      }
      if (!inbox) return res.json({ ok: true, ignored: 'no such address' });
      const emailId = String(d.email_id || d.id || '');
      const from = String(d.from || '').slice(0, 200), subject = String(d.subject || '').slice(0, 300);
      let atts = [];
      if (emailId) {
        const a = await resendGet('/emails/receiving/' + encodeURIComponent(emailId) + '/attachments');
        atts = Array.isArray(a) ? a : (a.data || []);
      }
      const keep = atts.filter(x => OK_MIME.test(String(x.content_type || x.contentType || '')) &&
        !(/inline/i.test(String(x.content_disposition || '')) && /^image\//i.test(String(x.content_type || ''))));
      const ctx = { companyId: inbox.company_id, userId: inbox.user_id };
      const made = [];
      if (!keep.length) {
        made.push(await addRow(ctx, { source: 'email', email_id: emailId, from_addr: from, subject, file_name: '', mime: '', size: 0,
          status: 'no-file', error: 'The email had no PDF or picture attached.' }));
      }
      for (const x of keep) {
        const name = String(x.filename || x.name || 'invoice.pdf').slice(0, 160);
        const dupe = await supabase.from('supplier_invoices').select('id').eq('company_id', inbox.company_id).eq('email_id', emailId).eq('file_name', name).limit(1);
        if (dupe.data && dupe.data[0]) continue;              // Resend retried: already have it
        const url = x.download_url || x.downloadUrl;
        let buf = null;
        if (url) { const r = await fetchX(url, {}); if (!r.ok) throw new Error('attachment ' + r.status); buf = Buffer.from(await r.arrayBuffer()); }
        else if (x.content) buf = Buffer.from(String(x.content), 'base64');
        if (!buf) continue;
        made.push(await addFile(ctx, { source: 'email', email_id: emailId, from_addr: from, subject, name, mime: x.content_type || x.contentType, buf }));
      }
      res.json({ ok: true, made: made.length });
    } catch (e) {
      recordError('supinv-inbound', e, { route: 'POST /supinv/inbound' });
      res.status(500).json({ error: e.message });                // Resend retries
    }
  }

  async function addRow(ctx, f){
    const row = Object.assign({ id: crypto.randomUUID(), company_id: ctx.companyId || null, user_id: ctx.userId,
      received_at: now(), storage_path: '', read_via: '', kind: '', supplier: '', inv_number: '', inv_date: null, due_date: null,
      subtotal: null, gst: null, total: null, currency: '', refs: [], site_address: '', description: '', lines: [],
      job_id: null, job_label: '', alloc: '', alloc_why: '', suggest: [], xero: {}, error: '', created_at: now(), updated_at: now() }, f);
    const w = await supabase.from('supplier_invoices').insert(row);
    if (w.error) throw new Error(w.error.message);
    return row;
  }
  async function addFile(ctx, f){
    const id = crypto.randomUUID();
    const mime = String(f.mime || 'application/pdf').toLowerCase();
    const path = (ctx.companyId || ('u-' + ctx.userId)) + '/' + id + '/' + (String(f.name).replace(/[^\w.\-]+/g, '_') || 'invoice');
    const st = storage();
    await st.upload(path, f.buf, mime);
    const row = await addRow(ctx, { id, source: f.source, email_id: f.email_id || '', from_addr: f.from_addr || '', subject: f.subject || '',
      file_name: f.name, mime, size: f.buf.length, storage_path: path, status: 'reading' });
    setImmediate(() => { readAndMatch(row.id, ctx).catch(e => recordError('supinv-read', e, { route: 'read' })); });
    return row;
  }

  // ── reading ─────────────────────────────────────────────────────
  const TOOL = {
    name: 'record_invoice', description: 'Record what this supplier document says.',
    input_schema: { type: 'object', additionalProperties: false,
      required: ['kind', 'supplier', 'invoice_number', 'invoice_date', 'due_date', 'subtotal', 'gst', 'total', 'currency', 'references', 'site_address', 'description', 'lines'],
      properties: {
        kind: { type: 'string', enum: ['invoice', 'credit_note', 'statement', 'quote', 'other'] },
        supplier: { type: 'string' }, invoice_number: { type: 'string' },
        invoice_date: { type: 'string', description: 'YYYY-MM-DD or empty' }, due_date: { type: 'string', description: 'YYYY-MM-DD or empty' },
        subtotal: { type: 'number', description: 'excl GST; 0 if not shown' }, gst: { type: 'number' }, total: { type: 'number', description: 'incl GST' },
        currency: { type: 'string' },
        references: { type: 'array', items: { type: 'string' }, description: 'Every customer reference, order number, PO, job number, job name or "your ref" on the document, exactly as printed' },
        site_address: { type: 'string', description: 'Delivery / site address if shown' },
        description: { type: 'string', description: 'One short line: what was supplied' },
        lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['desc', 'qty', 'amount'],
          properties: { desc: { type: 'string' }, qty: { type: 'number' }, amount: { type: 'number', description: 'line total excl GST' } } } },
      } },
  };
  const SYS = 'You read supplier documents for a New Zealand / Australian roofing business. Call record_invoice once. ' +
    'Read the figures exactly as printed. "references" must include every customer reference, order number, purchase order, ' +
    'job number or job/site name the roofer put on the order (e.g. "3305", "Job 3305 Smith", "PO 3305"). Use empty strings and 0 when a value is not on the page. ' +
    'At most 40 lines; summarise if there are more.';
  // WHAT IS SENT, CHEAPEST FIRST (2026-11-13, the owner: "does it have to be
  // AI ... how much ... what if there's photos in that PDF ... could it lower
  // the resolution"). A supplier's PDF almost always carries its words as
  // text: those are read off it here (pdf.js, no A.I.) and only the TEXT is
  // sent — no pictures at all, a few thousand tokens. A scan (no text) has
  // its first pages drawn at no more than 1568 px and sent as JPEGs, and a
  // photo is shrunk the same way, so a supplier's high-resolution photo never
  // costs more than a small picture. The document block is the last resort.
  const READ_MAX_PX = 1568, READ_PAGES = 3;
  async function prepRead(buf, mime){
    if (/pdf/.test(mime)) {
      let doc = null;
      try {
        const pdf = require('./tender/pdf');
        doc = await pdf.open(buf);
        const n = Math.min(doc.numPages || 1, 4);
        let text = '';
        for (let p = 1; p <= n; p++) text += (await pdf.extract(doc, p)).fullText + (p < n ? '\n\n--- next page ---\n\n' : '');
        if (text.replace(/\s+/g, '').length >= 80) return { via: 'text', text: text.slice(0, 24000) };
        const images = [];
        for (let p = 1; p <= Math.min(doc.numPages || 1, READ_PAGES); p++) {
          const r = await pdf.render(doc, p, { dpi: 150, maxPx: READ_MAX_PX, quality: 75 });
          images.push({ mime: 'image/jpeg', buf: r.buf });
        }
        if (images.length) return { via: 'scan', images };
      } catch (e) {}
      return { via: 'pdf' };
    }
    try {
      const { loadImage, createCanvas } = require('@napi-rs/canvas');
      const img = await loadImage(buf);
      const k = Math.min(1, READ_MAX_PX / Math.max(img.width, img.height));
      if (k < 1 || buf.length > 1500000) {
        const cv = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        return { via: 'photo', images: [{ mime: 'image/jpeg', buf: cv.toBuffer('image/jpeg', 80) }] };
      }
    } catch (e) {}
    return { via: 'photo', images: [{ mime: mime === 'image/jpg' ? 'image/jpeg' : mime, buf }] };
  }
  async function aiRead(buf, mime, name){
    const prep = await prepRead(buf, mime);
    if (globalThis.__TEST_SUPINV_AI) {
      const a = await globalThis.__TEST_SUPINV_AI({ mime, bytes: buf.length, name, via: prep.via,
        text: prep.text != null ? prep.text : buf.toString('latin1').slice(0, 4000),
        images: (prep.images || []).map(i => ({ mime: i.mime, bytes: i.buf.length })) });
      return Object.assign({ _via: prep.via, _text: prep.text || '' }, a);
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('The A.I. key is not set on the server.');
    const content = [];
    if (prep.via === 'text') content.push({ type: 'text', text: 'The supplier document\'s text, read off the PDF:\n\n' + prep.text });
    else if (prep.images) prep.images.forEach(i => content.push({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.buf.toString('base64') } }));
    else content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
    content.push({ type: 'text', text: 'File: ' + name });
    const body = { model: process.env.SUPINV_MODEL || 'claude-haiku-5-5', max_tokens: 3000, system: SYS,
      tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content }] };
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && d.error.message) || ('AI ' + r.status));
    const tu = (d.content || []).find(b => b.type === 'tool_use');
    if (!tu) throw new Error('The A.I. did not answer.');
    const u = d.usage || {};
    return Object.assign({ _via: prep.via, _text: prep.text || '', _tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
      _usd: Math.round(((u.input_tokens || 0) * 0.10 + (u.output_tokens || 0) * 0.50) / 1e6 * 100000) / 100000 }, tu.input);
  }
  const num = v => { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; };
  const day = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;

  // ── matching ────────────────────────────────────────────────────
  async function companyJobs(companyId, userId){
    const sel = 'id, version_of, client_name, site_address, updated_at, job_no:draw_state->state->quote->ref, linked_no:draw_state->state->linkedJobNo';
    let q = supabase.from('jobs').select(sel);
    q = companyId ? q.or('company_id.eq.' + companyId + ',and(company_id.is.null,user_id.eq.' + userId + ')') : q.eq('user_id', userId);
    let r = await q.order('updated_at', { ascending: false }).limit(3000);
    if (r.error && /version_of/.test(r.error.message || '')) {
      let q2 = supabase.from('jobs').select(sel.replace('version_of, ', ''));
      q2 = companyId ? q2.or('company_id.eq.' + companyId + ',and(company_id.is.null,user_id.eq.' + userId + ')') : q2.eq('user_id', userId);
      r = await q2.limit(3000);
    }
    if (r.error) throw new Error(r.error.message);
    const seen = {}, out = [];
    for (const j of (r.data || [])) {
      const root = String(j.version_of || j.id);
      if (seen[root]) continue; seen[root] = 1;
      out.push({ id: root, no: String(j.job_no == null ? '' : j.job_no).replace(/^"|"$/g, ''), fno: String(j.linked_no == null ? '' : j.linked_no).replace(/^"|"$/g, ''),
        client: j.client_name || '', addr: j.site_address || '' });
    }
    return out;
  }
  const digits = s => String(s || '').replace(/^\D+/, '').replace(/\D.*$/, '').replace(/^0+/, '');
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function jobLabel(j){ return [j.no || j.fno, j.client, j.addr].filter(Boolean).join(' — ').slice(0, 200); }
  function match(jobs, inv){
    const text = [].concat(inv.refs || [], inv.description || '', inv.subject || '', inv.file_name || '').join(' ');
    const nums = {}; (String(text).match(/\d{3,6}[a-z]?/gi) || []).forEach(n => { nums[n.replace(/^0+/, '').toLowerCase()] = 1; });
    const hits = {};
    const add = (j, why, score) => { if (!hits[j.id] || hits[j.id].score < score) hits[j.id] = { job: j, why, score }; };
    for (const j of jobs) {
      const n = digits(j.no).toLowerCase(), f = digits(j.fno).toLowerCase();
      if (n && n.length >= 3 && nums[n]) add(j, 'Job number ' + j.no + ' is on the invoice', 3);
      else if (f && f.length >= 3 && nums[f]) add(j, 'Fergus job ' + j.fno + ' is on the invoice', 3);
    }
    const site = norm(inv.site_address) + ' ' + norm(text);
    for (const j of jobs) {
      const a = norm(j.addr).split(' ');
      if (a.length < 2 || !/^\d+[a-z]?$/.test(a[0])) continue;
      const street = a.slice(0, 3).join(' ');          // "12 smith street"
      if (street.length > 6 && site.indexOf(street) >= 0) add(j, 'The site address ' + j.addr + ' is on the invoice', 2);
    }
    for (const j of jobs) {
      const c = norm(j.client);
      if (c.length >= 6 && c.indexOf(' ') > 0 && norm(text).indexOf(c) >= 0) add(j, 'The customer ' + j.client + ' is named on the invoice', 1);
    }
    const list = Object.values(hits).sort((a, b) => b.score - a.score);
    const best = list[0], second = list[1];
    const sure = best && (!second || second.score < best.score) && best.score >= 2;
    return { job: sure ? best.job : null, why: sure ? best.why : '',
      suggest: list.slice(0, 5).map(h => ({ id: h.job.id, label: jobLabel(h.job), why: h.why })) };
  }
  async function readAndMatch(id, ctx){
    const one = await supabase.from('supplier_invoices').select(COLS).eq('id', id).limit(1);
    const row = one.data && one.data[0]; if (!row) return;
    let patch;
    try {
      const buf = await storage().download(row.storage_path);
      const a = await aiRead(buf, row.mime, row.file_name);
      patch = { status: 'read', error: '', read_via: String(a._via || '').slice(0, 12), kind: String(a.kind || 'invoice').slice(0, 20), supplier: String(a.supplier || '').slice(0, 160),
        inv_number: String(a.invoice_number || '').slice(0, 80), inv_date: day(a.invoice_date), due_date: day(a.due_date),
        subtotal: num(a.subtotal), gst: num(a.gst), total: num(a.total), currency: String(a.currency || '').slice(0, 8),
        refs: (Array.isArray(a.references) ? a.references : []).map(x => String(x).slice(0, 120)).slice(0, 20),
        site_address: String(a.site_address || '').slice(0, 200), description: String(a.description || '').slice(0, 300),
        lines: (Array.isArray(a.lines) ? a.lines : []).slice(0, 60).map(l => ({ desc: String(l.desc || '').slice(0, 200), qty: num(l.qty), amount: num(l.amount) })) };
      if (patch.subtotal == null && patch.total != null && patch.gst != null) patch.subtotal = num(patch.total - patch.gst);
      if (!row.job_id) {
        const m = match(await companyJobs(ctx.companyId || row.company_id, ctx.userId || row.user_id), Object.assign({}, row, patch));
        // A job number the A.I. left out of the references but printed on the
        // page still counts: the job's own number in the read text, by rule.
        if (!m.job && a._text) { const m2 = match(await companyJobs(ctx.companyId || row.company_id, ctx.userId || row.user_id), Object.assign({}, row, patch, { refs: [a._text.slice(0, 6000)] })); if (m2.job && /^Job number|^Fergus job/.test(m2.why)) Object.assign(m, m2); }
        patch.suggest = m.suggest;
        if (m.job) Object.assign(patch, { job_id: m.job.id, job_label: jobLabel(m.job), alloc: 'auto', alloc_why: m.why });
      }
    } catch (e) {
      patch = { status: 'failed', error: String((e && e.message) || e).slice(0, 300) };
    }
    patch.updated_at = now();
    const w = await supabase.from('supplier_invoices').update(patch).eq('id', id);
    if (w.error) throw new Error(w.error.message);
  }

  // ── the tab's routes ────────────────────────────────────────────
  const first = r => { if (r.error) throw new Error(r.error.message); return (r.data && r.data[0]) || null; };
  const mine = (req, id) => scopeCompany(supabase.from('supplier_invoices').select(COLS).eq('id', id), req).limit(1);
  app.get('/supinv', gate, async (req, res) => {
    try {
      let q = scopeCompany(supabase.from('supplier_invoices').select(LIST_COLS), req);
      if (req.query.job) q = q.eq('job_id', String(req.query.job));
      const r = await q.order('received_at', { ascending: false }).limit(1000);
      if (r.error) throw new Error(r.error.message);
      res.json({ ok: true, invoices: r.data || [], xero: await xeroStatusOf(req).catch(() => ({ connected: false })) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/supinv/:id', gate, async (req, res) => {
    try { const row = first(await mine(req, req.params.id)); if (!row) return res.status(404).json({ error: 'Not found' }); res.json({ ok: true, invoice: row }); }
    catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/supinv/:id/url', gate, async (req, res) => {
    try {
      const row = first(await mine(req, req.params.id));
      if (!row || !row.storage_path) return res.status(404).json({ error: 'No file' });
      res.json({ ok: true, url: await storage().signedUrl(row.storage_path, 900), name: row.file_name, mime: row.mime });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.post('/supinv/upload', gate, rateLimit(60, 60000), async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || 'invoice.pdf').replace(/[\\/\u0000-\u001f]+/g, ' ').trim().slice(0, 160);
      const mime = String(b.mime || '').toLowerCase();
      if (!OK_MIME.test(mime)) return res.status(400).json({ error: 'A PDF or a photo, please.', code: 'BAD_TYPE' });
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length) return res.status(400).json({ error: 'The file is empty.' });
      if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Over 15 MB.', code: 'TOO_BIG' });
      const row = await addFile({ companyId: req.companyId, userId: req.user.id }, { source: 'upload', name, mime, buf,
        from_addr: String((req.user && req.user.email) || '') });
      res.json({ ok: true, id: row.id });
    } catch (e) { recordError('supinv-upload', e, { route: 'POST /supinv/upload' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.put('/supinv/:id/assign', gate, async (req, res) => {
    try {
      const row = first(await mine(req, req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      const jid = (req.body || {}).jobId ? String(req.body.jobId) : null;
      let patch = { job_id: null, job_label: '', alloc: '', alloc_why: '', updated_at: now() };
      if (jid) {
        const jobs = await companyJobs(req.companyId, req.user.id);
        const j = jobs.find(x => x.id === jid);
        if (!j) return res.status(404).json({ error: 'Job not found' });
        patch = { job_id: j.id, job_label: jobLabel(j), alloc: 'manual', alloc_why: 'Assigned by ' + String((req.user && req.user.email) || 'the office'), updated_at: now() };
      }
      const w = await supabase.from('supplier_invoices').update(patch).eq('id', row.id);
      if (w.error) throw new Error(w.error.message);
      res.json({ ok: true, invoice: Object.assign(row, patch) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.post('/supinv/:id/reread', gate, async (req, res) => {
    try {
      const row = first(await mine(req, req.params.id));
      if (!row || !row.storage_path) return res.status(404).json({ error: 'Not found' });
      await supabase.from('supplier_invoices').update({ status: 'reading', error: '', updated_at: now() }).eq('id', row.id);
      await readAndMatch(row.id, { companyId: req.companyId, userId: req.user.id });
      res.json({ ok: true, invoice: first(await mine(req, row.id)) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.delete('/supinv/:id', gate, async (req, res) => {
    try {
      const row = first(await mine(req, req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.storage_path) { try { await storage().remove([row.storage_path]); } catch (e) {} }
      const w = await supabase.from('supplier_invoices').delete().eq('id', row.id);
      if (w.error) throw new Error(w.error.message);
      res.json({ ok: true });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  // Job costing's per-job sums, ex GST.
  app.get('/supinv-costs', gate, async (req, res) => {
    try {
      const r = await scopeCompany(supabase.from('supplier_invoices').select('job_id,subtotal,total,gst,kind,inv_date,received_at,supplier'), req).limit(5000);
      if (r.error) throw new Error(r.error.message);
      const by = {};
      (r.data || []).forEach(x => {
        if (!x.job_id || x.kind === 'statement' || x.kind === 'quote') return;
        const ex = x.subtotal != null ? +x.subtotal : (x.total != null ? +x.total - (+x.gst || 0) : 0);
        const sign = x.kind === 'credit_note' ? -1 : 1;
        const b = by[x.job_id] || (by[x.job_id] = { cost: 0, count: 0, last: '' });
        b.cost = Math.round((b.cost + sign * Math.abs(ex || 0)) * 100) / 100; b.count++;
        const d = x.inv_date || String(x.received_at || '').slice(0, 10); if (d > b.last) b.last = d;
      });
      res.json({ ok: true, byJob: by });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // Job costing's job list: every job (one row per job, its versions
  // folded) with what it was quoted / accepted at, and its supplier costs.
  app.get('/costing/jobs', gate, async (req, res) => {
    try {
      const sel = 'id, version_of, client_name, site_address, updated_at, created_at, job_no:draw_state->state->quote->ref, ' +
        'gst:draw_state->state->quote->gst, sent_total:draw_state->state->quote->share->sentTotal, sent_at:draw_state->state->quote->share->>sentAt, ' +
        'acc_total:draw_state->state->quote->accepted->total, acc_at:draw_state->state->quote->accepted->>at, kind:draw_state->state->quote->>quoteKind';
      const r = await scopeCompany(supabase.from('jobs').select(sel), req).order('updated_at', { ascending: false }).limit(3000);
      if (r.error) throw new Error(r.error.message);
      const c = await scopeCompany(supabase.from('supplier_invoices').select('job_id,subtotal,total,gst,kind,supplier,inv_date,inv_number,received_at,id'), req).limit(5000);
      if (c.error) throw new Error(c.error.message);
      const cost = {};
      (c.data || []).forEach(x => {
        if (!x.job_id || x.kind === 'statement' || x.kind === 'quote') return;
        const ex = x.subtotal != null ? +x.subtotal : (x.total != null ? +x.total - (+x.gst || 0) : 0);
        const v = (x.kind === 'credit_note' ? -1 : 1) * Math.abs(ex || 0);
        const b = cost[x.job_id] || (cost[x.job_id] = { cost: 0, invoices: [] });
        b.cost = Math.round((b.cost + v) * 100) / 100;
        b.invoices.push({ id: x.id, supplier: x.supplier, number: x.inv_number, date: x.inv_date || String(x.received_at || '').slice(0, 10), ex: Math.round(v * 100) / 100 });
      });
      const seen = {}, jobs = [];
      for (const j of (r.data || [])) {
        const root = String(j.version_of || j.id);
        const n = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
        const rate = n(j.gst); const div = 1 + ((rate != null && rate >= 0 && rate < 40) ? rate : 15) / 100;
        const accI = n(j.acc_total), sentI = n(j.sent_total);
        const prev = seen[root];
        const row = { id: root, no: String(j.job_no == null ? '' : j.job_no).replace(/^"|"$/g, ''), client: j.client_name || '', addr: j.site_address || '',
          kind: j.kind || 'roofing', sentAt: j.sent_at || '', acceptedAt: j.acc_at || '',
          quoteEx: sentI != null ? Math.round(sentI / div * 100) / 100 : null, acceptedEx: accI != null ? Math.round(accI / div * 100) / 100 : null,
          updated: j.updated_at };
        if (!prev) { seen[root] = row; jobs.push(row); }
        else { if (!prev.acceptedEx && row.acceptedEx) Object.assign(prev, { acceptedEx: row.acceptedEx, acceptedAt: row.acceptedAt });
          if (!prev.quoteEx && row.quoteEx) Object.assign(prev, { quoteEx: row.quoteEx, sentAt: row.sentAt }); }
      }
      jobs.forEach(j => { const b = cost[j.id]; j.cost = b ? b.cost : 0; j.invoices = b ? b.invoices : []; });
      res.json({ ok: true, jobs });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // ══ XERO ════════════════════════════════════════════════════════
  // OAuth 2.0 with RoofMap's own Xero app (XERO_CLIENT_ID / XERO_CLIENT_SECRET,
  // made at developer.xero.com, redirect = PUBLIC_API_URL/xero/callback). One
  // organisation per business; tokens AES-encrypted like the mail passwords.
  const XERO_ID = () => process.env.XERO_CLIENT_ID || (globalThis.__TEST_SUPINV_FETCH ? 'test-id' : '');
  const XERO_SECRET = () => process.env.XERO_CLIENT_SECRET || (globalThis.__TEST_SUPINV_FETCH ? 'test-secret' : '');
  const XERO_REDIRECT = () => process.env.XERO_REDIRECT_URI || (publicApiUrl + '/xero/callback');
  const XERO_SCOPES = () => process.env.XERO_SCOPES ||
    'openid profile email offline_access accounting.transactions accounting.contacts accounting.attachments accounting.reports.read accounting.settings.read';
  function stateSign(o){
    const body = Buffer.from(JSON.stringify(o)).toString('base64url');
    const mac = crypto.createHmac('sha256', 'xero-state:' + (process.env.JWT_SECRET || 'dev')).update(body).digest('base64url');
    return body + '.' + mac;
  }
  function stateRead(s){
    const [body, mac] = String(s || '').split('.');
    if (!body || !mac) return null;
    const want = crypto.createHmac('sha256', 'xero-state:' + (process.env.JWT_SECRET || 'dev')).update(body).digest('base64url');
    if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return (o.exp > Date.now()) ? o : null;
  }
  async function connOf(companyId, userId){
    let q = supabase.from('xero_connections').select('*');
    q = companyId ? q.eq('company_id', companyId) : q.eq('user_id', userId);
    const r = await q.order('updated_at', { ascending: false }).limit(1);
    if (r.error) throw new Error(r.error.message);
    return (r.data && r.data[0]) || null;
  }
  async function xeroStatusOf(req){
    const c = await connOf(req.companyId, req.user.id);
    return { configured: !!XERO_ID(), connected: !!(c && c.refresh_token), org: c ? c.tenant_name : '',
      account: (c && c.settings && c.settings.account) || '300', status: (c && c.settings && c.settings.status) || 'DRAFT' };
  }
  async function tokenPost(params){
    const r = await fetchX('https://identity.xero.com/connect/token', { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(XERO_ID() + ':' + XERO_SECRET()).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Xero sign-in: ' + String(d.error_description || d.error || r.status));
    return d;
  }
  async function accessFor(c){
    if (c.access_token && c.expires_at && Date.parse(c.expires_at) > Date.now() + 60000) return mailDec(c.access_token);
    const t = await tokenPost({ grant_type: 'refresh_token', refresh_token: mailDec(c.refresh_token) });
    const patch = { access_token: mailEnc(t.access_token), refresh_token: mailEnc(t.refresh_token || mailDec(c.refresh_token)),
      expires_at: new Date(Date.now() + (+t.expires_in || 1800) * 1000).toISOString(), updated_at: now() };
    await supabase.from('xero_connections').update(patch).eq('id', c.id);
    Object.assign(c, patch);
    return t.access_token;
  }
  async function xero(c, method, path, body, raw){
    const tok = await accessFor(c);
    const headers = { Authorization: 'Bearer ' + tok, 'xero-tenant-id': c.tenant_id, Accept: 'application/json' };
    const opts = { method, headers };
    if (raw) { headers['Content-Type'] = raw.mime; opts.body = raw.buf; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetchX('https://api.xero.com/api.xro/2.0' + path, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const ve = (((d.Elements || [])[0] || {}).ValidationErrors || []).map(v => v.Message).join('; ');
      throw new Error('Xero ' + r.status + ': ' + (ve || d.Detail || d.Message || d.Title || 'refused'));
    }
    return d;
  }
  app.get('/xero/status', gate, async (req, res) => {
    try { res.json(Object.assign({ ok: true }, await xeroStatusOf(req))); } catch (e) { res.status(503).json({ error: e.message }); }
  });
  app.post('/xero/connect', gate, async (req, res) => {
    if (!XERO_ID()) return res.status(400).json({ error: 'Xero is not set up on the server yet (XERO_CLIENT_ID).', code: 'XERO_UNCONFIGURED' });
    const state = stateSign({ c: req.companyId || null, u: req.user.id, exp: Date.now() + 15 * 60000, n: crypto.randomBytes(6).toString('hex') });
    const url = 'https://login.xero.com/identity/connect/authorize?' + new URLSearchParams({ response_type: 'code', client_id: XERO_ID(),
      redirect_uri: XERO_REDIRECT(), scope: XERO_SCOPES(), state }).toString();
    res.json({ ok: true, url });
  });
  app.get('/xero/callback', async (req, res) => {
    const back = (q) => res.redirect(publicAppUrl + '/app?xero=' + q);
    try {
      const st = stateRead(req.query.state);
      if (!st) return back('expired');
      if (req.query.error || !req.query.code) return back('cancelled');
      const t = await tokenPost({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: XERO_REDIRECT() });
      const cr = await fetchX('https://api.xero.com/connections', { headers: { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' } });
      const conns = await cr.json().catch(() => []);
      const org = (Array.isArray(conns) ? conns : []).find(x => x.tenantType === 'ORGANISATION') || (conns || [])[0];
      if (!org) return back('noorg');
      const old = await connOf(st.c, st.u);
      const row = { tenant_id: org.tenantId, tenant_name: String(org.tenantName || '').slice(0, 160), access_token: mailEnc(t.access_token),
        refresh_token: mailEnc(t.refresh_token), expires_at: new Date(Date.now() + (+t.expires_in || 1800) * 1000).toISOString(), updated_at: now() };
      const w = old ? await supabase.from('xero_connections').update(row).eq('id', old.id)
        : await supabase.from('xero_connections').insert(Object.assign({ id: crypto.randomUUID(), company_id: st.c, user_id: st.u, settings: {}, created_at: now() }, row));
      if (w.error) throw new Error(w.error.message);
      back('connected');
    } catch (e) { recordError('xero-callback', e, { route: 'GET /xero/callback' }); back('failed'); }
  });
  app.post('/xero/disconnect', gate, async (req, res) => {
    try {
      const c = await connOf(req.companyId, req.user.id);
      if (c) await supabase.from('xero_connections').delete().eq('id', c.id);
      res.json({ ok: true });
    } catch (e) { res.status(503).json({ error: e.message }); }
  });
  app.put('/xero/settings', gate, async (req, res) => {
    try {
      const c = await connOf(req.companyId, req.user.id);
      if (!c) return res.status(404).json({ error: 'Xero is not connected.' });
      const b = req.body || {};
      const settings = Object.assign({}, c.settings || {});
      if (b.account != null) settings.account = String(b.account).replace(/[^\w.-]/g, '').slice(0, 20) || '300';
      if (b.status != null) settings.status = b.status === 'AUTHORISED' ? 'AUTHORISED' : 'DRAFT';
      await supabase.from('xero_connections').update({ settings, updated_at: now() }).eq('id', c.id);
      res.json({ ok: true, settings });
    } catch (e) { res.status(503).json({ error: e.message }); }
  });
  // A supplier invoice as a Xero bill (ACCPAY), the job in its reference, the PDF attached.
  app.post('/supinv/:id/xero', gate, async (req, res) => {
    try {
      const row = first(await mine(req, req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.xero && row.xero.invoiceId) return res.json({ ok: true, already: true, xero: row.xero });
      const c = await connOf(req.companyId, req.user.id);
      if (!c) return res.status(400).json({ error: 'Connect Xero first.', code: 'XERO_NOT_CONNECTED' });
      const set = c.settings || {};
      const sup = row.supplier || 'Unknown supplier';
      let contact = null;
      try { const cs = await xero(c, 'GET', '/Contacts?searchTerm=' + encodeURIComponent(sup) + '&summaryOnly=true');
        contact = ((cs.Contacts || []).find(x => String(x.Name || '').toLowerCase() === sup.toLowerCase()) || (cs.Contacts || [])[0]) || null; } catch (e) {}
      const ex = row.subtotal != null ? +row.subtotal : (row.total != null ? +row.total - (+row.gst || 0) : 0);
      const ref = (row.job_label ? ('Job ' + row.job_label) : 'Not assigned to a job').slice(0, 250);
      const bill = { Type: row.kind === 'credit_note' ? 'ACCPAYCREDIT' : 'ACCPAY', Contact: contact ? { ContactID: contact.ContactID } : { Name: sup },
        Date: row.inv_date || String(row.received_at || now()).slice(0, 10), DueDate: row.due_date || undefined,
        InvoiceNumber: row.inv_number || undefined, Reference: ref, LineAmountTypes: 'Exclusive', Status: set.status || 'DRAFT',
        LineItems: [{ Description: (row.description || ('Supplier invoice ' + (row.inv_number || ''))).slice(0, 400) + (row.job_label ? (' — ' + row.job_label) : ''),
          Quantity: 1, UnitAmount: Math.abs(ex || 0), AccountCode: set.account || '300' }] };
      if (bill.Type === 'ACCPAYCREDIT') { delete bill.InvoiceNumber; bill.CreditNoteNumber = row.inv_number || undefined; }
      const path = bill.Type === 'ACCPAYCREDIT' ? '/CreditNotes' : '/Invoices';
      const d = await xero(c, 'POST', path, { [bill.Type === 'ACCPAYCREDIT' ? 'CreditNotes' : 'Invoices']: [bill] });
      const made = ((d.Invoices || d.CreditNotes || [])[0]) || {};
      const xid = made.InvoiceID || made.CreditNoteID;
      const info = { invoiceId: xid || '', at: now(), by: String((req.user && req.user.email) || ''), org: c.tenant_name, attached: false };
      if (xid && row.storage_path) {
        try {
          const buf = await storage().download(row.storage_path);
          await xero(c, 'PUT', path + '/' + xid + '/Attachments/' + encodeURIComponent(row.file_name || 'invoice.pdf'), undefined, { mime: row.mime || 'application/pdf', buf });
          info.attached = true;
        } catch (e) { info.attachError = String(e.message || e).slice(0, 200); }
      }
      await supabase.from('supplier_invoices').update({ xero: info, updated_at: now() }).eq('id', row.id);
      res.json({ ok: true, xero: info });
    } catch (e) { recordError('xero-bill', e, { route: 'POST /supinv/:id/xero' }); res.status(502).json({ error: e.message, code: 'XERO_FAILED' }); }
  });
  // The P&L month by month (for Job Costing): Xero's own report, its rows read
  // into income / cost of sales / expenses / net profit a month.
  app.get('/xero/pnl', gate, async (req, res) => {
    try {
      const c = await connOf(req.companyId, req.user.id);
      if (!c) return res.json({ ok: true, connected: false, months: [] });
      const want = Math.max(1, Math.min(36, parseInt(req.query.months, 10) || 24));
      const months = [];
      const end = new Date(); end.setUTCDate(1);
      for (let done = 0; done < want; done += 12) {
        const n = Math.min(12, want - done);
        const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - done, 1));
        const lastEnd = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0));
        const q = '?fromDate=' + last.toISOString().slice(0, 10) + '&toDate=' + lastEnd.toISOString().slice(0, 10) +
          (n > 1 ? ('&periods=' + (n - 1) + '&timeframe=MONTH') : '');
        const d = await xero(c, 'GET', '/Reports/ProfitAndLoss' + q);
        pnlRows(d, last, n).forEach(m => months.push(m));
      }
      months.sort((a, b) => a.month < b.month ? -1 : 1);
      res.json({ ok: true, connected: true, org: c.tenant_name, months });
    } catch (e) { res.status(502).json({ error: e.message, code: 'XERO_FAILED' }); }
  });
  function pnlRows(d, last, n){
    const rep = ((d && d.Reports) || [])[0] || {};
    const out = []; for (let i = 0; i < n; i++) { const m = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - i, 1));
      out.push({ month: m.toISOString().slice(0, 7), income: 0, cos: 0, gross: 0, expenses: 0, net: 0 }); }
    const val = (cells, i) => { const v = parseFloat(String(((cells || [])[i + 1] || {}).Value || '0').replace(/,/g, '')); return isFinite(v) ? v : 0; };
    (rep.Rows || []).forEach(sec => {
      const title = String(sec.Title || '').toLowerCase();
      (sec.Rows || []).forEach(r => {
        const label = String((((r.Cells || [])[0]) || {}).Value || '').toLowerCase();
        const isSum = r.RowType === 'SummaryRow';
        out.forEach((m, i) => {
          if (isSum && /income|revenue|trading/.test(title)) m.income = val(r.Cells, i);
          else if (isSum && /cost of sales|direct cost|cost of goods/.test(title)) m.cos = val(r.Cells, i);
          else if (isSum && /operating expenses|^expenses|overheads/.test(title)) m.expenses = val(r.Cells, i);
          else if (/^gross profit/.test(label)) m.gross = val(r.Cells, i);
          else if (/^net profit|^net loss|^net income/.test(label)) m.net = val(r.Cells, i);
        });
      });
    });
    out.forEach(m => { if (!m.gross) m.gross = Math.round((m.income - m.cos) * 100) / 100; if (!m.net) m.net = Math.round((m.gross - m.expenses) * 100) / 100; });
    return out;
  }

  return { inbound, match, pnlRows, enabledFor };
}
module.exports = { mount };
