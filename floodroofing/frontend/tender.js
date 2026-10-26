// AI TENDERING — the tab (Phase 1, 2026-10-23): upload a plan set, watch it
// being read, check the sheet index and correct a page.
//
// A plain global script loaded after app.html's own (like sheet-plan.js),
// so it reads S, api(), gotoTab and _scheduleAutosave and nothing in
// app.html reads it except through the two hooks on window:
//   _tenderTabOpen()  — gotoTab('tender') calls it
//   _tenderTabSync()  — _tenderNavSync calls it when the job's kind changes
// The tender's id rides on the quote (S.quote.tenderId), so it is saved with
// the job and follows it from device to device. Files go straight from the
// browser to storage on a URL the server signs; nothing passes through the
// API but the facts about the file.
(function(){
  'use strict';
  var T = { id: null, data: null, poll: null, uploads: [], err: '', thumbs: {} };
  var CLASSES = ['cover','index','site_plan','floor_plan','roof_plan','roof_framing','elevation','section','detail_roof','detail_other','spec','schedule','structural','services','other'];
  var CLASS_LABEL = { cover: 'Cover sheet', index: 'Drawing register', site_plan: 'Site plan', floor_plan: 'Floor plan', roof_plan: 'Roof plan', roof_framing: 'Roof framing',
    elevation: 'Elevations', section: 'Sections', detail_roof: 'Roofing details', detail_other: 'Other details', spec: 'Specification / notes', schedule: 'Schedule',
    structural: 'Structural', services: 'Services', other: 'Other' };
  var ROOFY = { roof_plan: 1, roof_framing: 1, detail_roof: 1, spec: 1, elevation: 1, section: 1 };
  function esc(v){ return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function root(){ return document.getElementById('tenderRoot'); }
  function onTab(){ return document.body.getAttribute('data-tab') === 'tender'; }
  function fmtBytes(n){ n = +n || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function jobName(){
    var c = '', a = '';
    try { c = (document.getElementById('jobClient') || {}).value || ''; a = (document.getElementById('jobAddr') || {}).value || ''; } catch (e) {}
    var ref = (window.S && S.quote && S.quote.ref) || '';
    return [ref, c, a].map(function(x){ return String(x || '').trim(); }).filter(Boolean).join(' — ') || 'Tender';
  }

  // ── css, once ───────────────────────────────────────────────────────
  (function css(){
    if (document.getElementById('tenderCss')) return;
    var st = document.createElement('style'); st.id = 'tenderCss';
    st.textContent = [
      '.tn-hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 0 14px}',
      '.tn-hd h2{margin:0;font-size:20px;font-weight:800;color:#0a1628}',
      '.tn-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}',
      '.tn-pill.new{background:#eef2f7;color:#475569}.tn-pill.queued,.tn-pill.processing{background:#fff4d6;color:#92400e}.tn-pill.indexed{background:#dcfce7;color:#166534}.tn-pill.failed{background:#fee2e2;color:#991b1b}',
      '.tn-card{background:#fff;border:1px solid #dbe3ec;border-radius:12px;margin-bottom:14px;overflow:hidden}',
      '.tn-card-hd{background:#0a1628;color:#fff;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:9px 14px;display:flex;align-items:center;gap:10px}',
      '.tn-card-hd .tn-r{margin-left:auto;font-weight:600;letter-spacing:0;text-transform:none;opacity:.85}',
      '.tn-card-bd{padding:14px}',
      '.tn-drop{border:2px dashed #9fb3c8;border-radius:12px;padding:26px 16px;text-align:center;color:#475569;background:#f8fafc;cursor:pointer;transition:background .15s,border-color .15s}',
      '.tn-drop.over{background:#e6f4fb;border-color:#0099cc}.tn-drop b{color:#0a1628;font-size:15px}.tn-drop small{display:block;margin-top:6px;color:#64748b}',
      '.tn-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:none;border-radius:8px;background:#0099cc;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}',
      '.tn-btn.sec{background:#fff;color:#0a1628;border:1px solid #cbd5e1}.tn-btn.danger{background:#fff;color:#b91c1c;border:1px solid #fecaca}.tn-btn:disabled{opacity:.5;cursor:default}',
      '.tn-files{list-style:none;margin:12px 0 0;padding:0}.tn-files li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #eef2f7;font-size:13px}',
      '.tn-files li:first-child{border-top:none}.tn-files .nm{flex:1;min-width:160px;font-weight:600;color:#0a1628;word-break:break-all}.tn-files .st{color:#64748b;font-size:12px;white-space:nowrap}',
      '.tn-files .er{color:#b91c1c;font-size:12px}',
      '.tn-bar{height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden;flex:1;min-width:80px}.tn-bar i{display:block;height:100%;background:#0099cc;transition:width .3s}',
      '.tn-prog{display:flex;align-items:center;gap:12px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin-bottom:14px;font-size:13px;color:#78350f}',
      '.tn-prog .tn-bar i{background:#f59e0b}',
      '.tn-warn{margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;font-size:13px}',
      '.tn-warn ul{margin:6px 0 0 18px;padding:0}.tn-warn li{margin:3px 0}',
      '.tn-tbl{width:100%;border-collapse:collapse;font-size:13px}.tn-tbl th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#64748b;padding:6px 8px;border-bottom:2px solid #e2e8f0;white-space:nowrap}',
      '.tn-tbl td{padding:7px 8px;border-bottom:1px solid #eef2f7;vertical-align:middle}.tn-tbl tr.roofy td{background:#f3faf5}',
      '.tn-tbl input,.tn-tbl select{font:inherit;font-size:13px;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;min-width:0}',
      '.tn-tbl input.id{width:84px;font-weight:700}.tn-tbl input.rev{width:46px;text-align:center}.tn-tbl input.ttl{width:100%;min-width:160px}',
      '.tn-th{width:64px;height:46px;object-fit:cover;border:1px solid #cbd5e1;border-radius:4px;background:#f1f5f9;cursor:zoom-in;display:block}',
      '.tn-src{font-size:10.5px;color:#64748b;white-space:nowrap}.tn-src b{color:#0a1628}.tn-src.user b{color:#7c3aed}.tn-src.ai b{color:#0369a1}',
      '.tn-conf{display:inline-block;width:44px;height:6px;border-radius:999px;background:#e2e8f0;vertical-align:middle;overflow:hidden}.tn-conf i{display:block;height:100%;background:#16a34a}.tn-conf.low i{background:#f59e0b}',
      '.tn-sup{font-size:11px;color:#92400e;background:#fff4d6;border-radius:6px;padding:2px 6px;white-space:nowrap}',
      '.tn-note{font-size:12.5px;color:#64748b;margin:0 0 10px}.tn-err{padding:12px 14px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:13px;margin-bottom:14px}',
      '.tn-empty{color:#64748b;font-size:13px;padding:8px 0}',
      '@media(max-width:760px){.tn-tbl .hide-sm{display:none}}',
    ].join('\n');
    document.head.appendChild(st);
  })();

  // ── the tender behind the job ───────────────────────────────────────
  async function ensure(){
    if (!window.S) return null;
    if (!S.quote) { try { S.quote = defaultQuote(); } catch (e) { S.quote = {}; } }
    if (S.quote.tenderId) return S.quote.tenderId;
    var t = await api('POST', '/tender', { name: jobName(), job_id: S.currentJobId || null });
    S.quote.tenderId = t.id;
    try { _scheduleAutosave(); } catch (e) {}
    return t.id;
  }
  async function load(){
    T.data = await api('GET', '/tender/' + T.id);
    // A tender made before the job was saved learns its job id now.
    try {
      if (window.S && S.currentJobId && !T.data.job_id) { api('PUT', '/tender/' + T.id, { job_id: S.currentJobId }).catch(function(){}); }
      if (T.data.name === 'Tender' && jobName() !== 'Tender') { api('PUT', '/tender/' + T.id, { name: jobName() }).catch(function(){}); }
    } catch (e) {}
    return T.data;
  }
  window._tenderTabOpen = async function(){
    var r = root(); if (!r) return;
    T.err = '';
    if (!(window.S && S.quote && S.quote.quoteKind === 'tender')) {
      r.innerHTML = '<div class="tn-card"><div class="tn-card-bd"><div class="tn-empty">This job is not an AI Tendering job. Set the job type to AI Tendering in the job details (or the Quote tab’s More menu) to use the plan-set reader on it.</div></div></div>';
      return;
    }
    if (!T.data || T.id !== S.quote.tenderId) { T.data = null; T.thumbs = {}; }
    if (!T.data) r.innerHTML = '<div class="tn-empty">Opening the tender…</div>';
    try {
      T.id = await ensure();
      await load();
    } catch (e) {
      T.err = (e && e.code === 'TENDERING_OFF') ? 'AI Tendering is not switched on for this business yet.' : ('Could not open the tender: ' + (e && e.message || e));
      T.data = null;
    }
    render();
    syncPoll();
  };
  window._tenderTabSync = function(){ if (onTab()) window._tenderTabOpen(); };

  // ── rendering ───────────────────────────────────────────────────────
  function busy(){ var d = T.data; return !!(d && (d.status === 'queued' || d.status === 'processing')) || T.uploads.some(function(u){ return !u.done; }); }
  function render(){
    var r = root(); if (!r) return;
    if (T.err) { r.innerHTML = '<div class="tn-err">' + esc(T.err) + '</div>'; return; }
    var d = T.data; if (!d) return;
    var h = '';
    h += '<div class="tn-hd"><h2>AI Tendering</h2><span class="tn-pill ' + esc(d.status) + '">' + esc(statusWord(d.status)) + '</span>' +
      '<span style="color:#64748b;font-size:13px">' + esc(d.name || '') + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:8px">' +
      (d.files && d.files.length ? '<button type="button" class="tn-btn sec" onclick="_tenderRun()" ' + (busy() ? 'disabled' : '') + '>↻ Read the set again</button>' : '') +
      '</span></div>';
    if (!d.ai) h += '<p class="tn-note">The AI classifier is not available on the server (no API key), so pages are classed by their title blocks alone. Check the classes below.</p>';
    h += progressHtml(d);
    h += '<div class="tn-card"><div class="tn-card-hd">Plan set<span class="tn-r">' + (d.files || []).length + ' file' + ((d.files || []).length === 1 ? '' : 's') + '</span></div><div class="tn-card-bd">' +
      '<div class="tn-drop" id="tnDrop" onclick="document.getElementById(\'tnFile\').click()"><b>Drop the plan-set PDFs here</b> or click to choose them<small>PDF only, up to 100 MB a file. Architect’s and engineer’s sets together is fine — every page is read and sorted.</small></div>' +
      '<input type="file" id="tnFile" accept="application/pdf,.pdf" multiple style="display:none" onchange="_tenderFilesPicked(this.files)">' +
      filesHtml(d) + '</div></div>';
    h += indexHtml(d);
    r.innerHTML = h;
    wireDrop();
    loadThumbs();
  }
  function statusWord(s){ return { new: 'No files yet', queued: 'Waiting to be read', processing: 'Reading the set', indexed: 'Indexed', failed: 'Failed' }[s] || s; }
  function progressHtml(d){
    var up = T.uploads.filter(function(u){ return !u.done; });
    var h = '';
    up.forEach(function(u){
      h += '<div class="tn-prog"><span>Uploading <b>' + esc(u.name) + '</b></span><span class="tn-bar"><i style="width:' + Math.round(u.pct) + '%"></i></span><span>' + Math.round(u.pct) + '%</span></div>';
    });
    var t = (d.tasks || [])[0];
    if (d.status === 'queued' || d.status === 'processing') {
      var p = (t && t.progress) || {};
      var words = 'Waiting for the reader…', pct = 0;
      if (p.stage === 'ingest') { words = 'Reading ' + (p.file ? esc(p.file) + ', ' : '') + 'page ' + (p.pageNo || '?') + (p.pagesTotal ? ' of ' + p.pagesTotal : ''); pct = p.pagesTotal ? 50 * (p.pagesDone || 0) / p.pagesTotal : 5; }
      else if (p.stage === 'classify') { words = 'Working out what each page is — ' + (p.done || 0) + ' of ' + (p.total || '?'); pct = 50 + (p.total ? 45 * (p.done || 0) / p.total : 0); }
      else if (p.stage === 'index') { words = 'Building the sheet index'; pct = 96; }
      h += '<div class="tn-prog"><span>' + words + '</span><span class="tn-bar"><i style="width:' + Math.round(pct) + '%"></i></span></div>';
    }
    if (d.status === 'failed' && t && t.error) h += '<div class="tn-err">The reader stopped: ' + esc(t.error) + ' — press “Read the set again”; if it stops again, send feedback with this job open.</div>';
    return h;
  }
  function filesHtml(d){
    var fs = d.files || [];
    if (!fs.length) return '';
    return '<ul class="tn-files">' + fs.map(function(f){
      var st = { pending: 'uploading', landed: 'waiting to be read', ingesting: 'being read', ingested: (f.pages || 0) + ' page' + (f.pages === 1 ? '' : 's'), failed: 'failed' }[f.status] || f.status;
      return '<li><span class="nm">' + esc(f.name) + '</span><span class="st">' + esc(fmtBytes(f.size)) + ' · ' + esc(st) + '</span>' +
        (f.error ? '<span class="er">' + esc(f.error) + '</span>' : '') +
        '<button type="button" class="tn-btn danger" style="padding:4px 9px;font-size:12px" onclick="_tenderFileDelete(\'' + esc(f.id) + '\')" ' + (busy() ? 'disabled' : '') + '>Remove</button></li>';
    }).join('') + '</ul>';
  }
  function indexHtml(d){
    var idx = d.sheet_index;
    var pages = d.pages || [];
    if (!pages.length) return '<div class="tn-card"><div class="tn-card-hd">Sheet index</div><div class="tn-card-bd"><div class="tn-empty">' + (busy() ? 'The index appears here once the set has been read.' : 'Upload a plan set to build the sheet index.') + '</div></div></div>';
    var byId = {}; pages.forEach(function(p){ byId[p.id] = p; });
    var h = '<div class="tn-card"><div class="tn-card-hd">Sheet index<span class="tn-r">' + ((idx && idx.sheets) || []).length + ' sheets · ' + pages.length + ' pages' + (idx && idx.builtAt ? ' · built ' + esc(new Date(idx.builtAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })) : '') + '</span></div><div class="tn-card-bd">';
    if (idx && idx.warnings && idx.warnings.length) h += '<div class="tn-warn"><b>Worth a look</b><ul>' + idx.warnings.map(function(w){ return '<li>' + esc(w.text) + '</li>'; }).join('') + '</ul></div>';
    h += '<p class="tn-note">Rows shaded green are the sheets the roofing take-off reads. Change a class, sheet number, title or revision and the index follows; your word outranks the reader’s.</p>';
    h += '<table class="tn-tbl"><thead><tr><th></th><th>Sheet</th><th>Title</th><th class="hide-sm">Rev</th><th>Class</th><th class="hide-sm">Read by</th><th class="hide-sm">Page</th></tr></thead><tbody>';
    var rows = [];
    if (idx && idx.sheets) idx.sheets.forEach(function(s){ var p = byId[s.pageId]; if (p) rows.push({ p: p, s: s }); });
    if (idx && idx.unnumbered) idx.unnumbered.forEach(function(s){ var p = byId[s.pageId]; if (p) rows.push({ p: p, s: s }); });
    // A superseded copy of a sheet sits under its latest revision's note, not as a row of its own.
    var sup = {};
    if (idx && idx.sheets) idx.sheets.forEach(function(s){ (s.superseded || []).forEach(function(x){ if (x.pageId) sup[x.pageId] = 1; }); });
    // Pages not in the index yet (the index is older than the pages): list them plain.
    pages.forEach(function(p){ if (!sup[p.id] && !rows.some(function(r){ return r.p.id === p.id; })) rows.push({ p: p, s: null }); });
    rows.forEach(function(r){ h += rowHtml(r.p, r.s, d); });
    h += '</tbody></table>';
    if (idx && idx.missing && idx.missing.length) h += '<p class="tn-note" style="margin-top:10px"><b>In the drawing register but not in the files:</b> ' + idx.missing.map(function(m){ return esc(m.sheetId) + (m.title ? ' ' + esc(m.title) : ''); }).join(', ') + '.</p>';
    h += '</div></div>';
    return h;
  }
  function rowHtml(p, s, d){
    var f = (d.files || []).find(function(x){ return x.id === p.file_id; });
    var src = p.cls_source === 'user' ? '<span class="tn-src user"><b>you</b></span>' : p.cls_source === 'ai' ? '<span class="tn-src ai"><b>AI</b>' + (p.agree === false ? ' · title block read differently' : '') + '</span>' : p.cls_source === 'ai-failed' ? '<span class="tn-src"><b>title block</b> (AI failed)</span>' : '<span class="tn-src"><b>title block</b></span>';
    var conf = p.cls_conf == null ? '' : '<span class="tn-conf' + (p.cls_conf < 0.6 ? ' low' : '') + '" title="' + Math.round(p.cls_conf * 100) + '% sure"><i style="width:' + Math.round(p.cls_conf * 100) + '%"></i></span>';
    var sup = s && s.superseded && s.superseded.length ? ' <span class="tn-sup" title="Older copies of this sheet in the set">supersedes rev ' + esc(s.superseded.map(function(x){ return x.revision || '?'; }).join(', ')) + '</span>' : '';
    var cls = '<select onchange="_tenderPageSet(\'' + esc(p.id) + '\',\'cls\',this.value)">' + CLASSES.map(function(c){ return '<option value="' + c + '"' + (c === p.cls ? ' selected' : '') + '>' + esc(CLASS_LABEL[c]) + '</option>'; }).join('') + '</select>';
    return '<tr class="' + (ROOFY[p.cls] ? 'roofy' : '') + '" data-page="' + esc(p.id) + '">' +
      '<td><img class="tn-th" data-thumb="' + esc(p.id) + '" alt="" title="Open the page" onclick="_tenderPageOpen(\'' + esc(p.id) + '\')"></td>' +
      '<td><input class="id" value="' + esc(p.sheet_id) + '" placeholder="—" onchange="_tenderPageSet(\'' + esc(p.id) + '\',\'sheet_id\',this.value)">' + sup + '</td>' +
      '<td><input class="ttl" value="' + esc(p.title) + '" placeholder="(no title read)" onchange="_tenderPageSet(\'' + esc(p.id) + '\',\'title\',this.value)"></td>' +
      '<td class="hide-sm"><input class="rev" value="' + esc(p.revision) + '" onchange="_tenderPageSet(\'' + esc(p.id) + '\',\'revision\',this.value)"></td>' +
      '<td>' + cls + ' ' + conf + '</td>' +
      '<td class="hide-sm">' + src + '</td>' +
      '<td class="hide-sm" style="color:#64748b;font-size:12px;white-space:nowrap">' + esc(f ? f.name.replace(/\.pdf$/i, '') : '') + ' p' + p.page_no + '</td></tr>';
  }
  function loadThumbs(){
    var r = root(); if (!r || !T.data) return;
    r.querySelectorAll('img[data-thumb]').forEach(function(img){
      var id = img.getAttribute('data-thumb');
      if (T.thumbs[id]) { img.src = T.thumbs[id]; return; }
      api('GET', '/tender/' + T.id + '/pages/' + id + '/image?kind=thumb').then(function(x){ T.thumbs[id] = x.url; img.src = x.url; }).catch(function(){});
    });
  }

  // ── actions ─────────────────────────────────────────────────────────
  window._tenderPageOpen = async function(pid){
    try { var x = await api('GET', '/tender/' + T.id + '/pages/' + pid + '/image'); window.open(x.url, '_blank', 'noopener'); }
    catch (e) { alert('Could not open the page: ' + (e && e.message || e)); }
  };
  window._tenderPageSet = async function(pid, field, value){
    var b = {}; b[field] = value;
    try {
      var x = await api('PUT', '/tender/' + T.id + '/pages/' + pid, b);
      if (T.data) {
        T.data.pages = (T.data.pages || []).map(function(p){ return p.id === pid ? x.page : p; });
        T.data.sheet_index = x.sheet_index;
      }
      render();
    } catch (e) { alert('Not saved: ' + (e && e.message || e)); }
  };
  window._tenderRun = async function(){
    try { await api('POST', '/tender/' + T.id + '/run', {}); await load(); render(); syncPoll(); }
    catch (e) { alert(e && e.message || e); }
  };
  window._tenderFileDelete = async function(fid){
    var f = (T.data && T.data.files || []).find(function(x){ return x.id === fid; });
    if (!f) return;
    if (!confirm('Remove ' + f.name + ' and the pages read from it?')) return;
    try { await api('DELETE', '/tender/' + T.id + '/files/' + fid); await load(); render(); }
    catch (e) { alert(e && e.message || e); }
  };
  window._tenderFilesPicked = function(list){ var arr = Array.prototype.slice.call(list || []); if (arr.length) upload(arr); };
  function wireDrop(){
    var z = document.getElementById('tnDrop'); if (!z) return;
    ['dragenter', 'dragover'].forEach(function(ev){ z.addEventListener(ev, function(e){ e.preventDefault(); z.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function(ev){ z.addEventListener(ev, function(e){ e.preventDefault(); z.classList.remove('over'); }); });
    z.addEventListener('drop', function(e){ var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) upload(fs); });
  }
  // Sign → PUT straight to storage (XHR, for the progress) → landed. The
  // reader is started on the LAST file only, so one task covers the lot.
  async function upload(files){
    var pdfs = files.filter(function(f){ return /\.pdf$/i.test(f.name) || /pdf/i.test(f.type); });
    var skipped = files.length - pdfs.length;
    if (skipped) alert(skipped + ' file' + (skipped === 1 ? ' was' : 's were') + ' skipped — only PDF plan sets can be read.');
    if (!pdfs.length) return;
    var me = pdfs.map(function(f){ return { name: f.name, pct: 0, done: false }; });
    T.uploads = T.uploads.concat(me);
    render();
    for (var i = 0; i < pdfs.length; i++) {
      var f = pdfs[i], u = me[i];
      try {
        var sg = await api('POST', '/tender/' + T.id + '/files/sign', { name: f.name, size: f.size, mime: f.type || 'application/pdf' });
        if (sg.duplicate) { u.done = true; u.pct = 100; continue; }
        await putFile(sg.signedUrl, f, function(pct){ u.pct = pct; renderProgressOnly(); });
        await api('POST', '/tender/' + T.id + '/files/' + sg.fileId + '/landed', { run: i === pdfs.length - 1 });
      } catch (e) {
        alert('Upload of ' + f.name + ' failed: ' + (e && e.message || e));
      }
      u.done = true; u.pct = 100;
    }
    T.uploads = T.uploads.filter(function(x){ return !x.done; });
    try { await load(); } catch (e) {}
    render();
    syncPoll();
  }
  function putFile(url, file, onPct){
    return new Promise(function(res, rej){
      var x = new XMLHttpRequest();
      x.open('PUT', url, true);
      x.setRequestHeader('content-type', file.type || 'application/pdf');
      x.setRequestHeader('x-upsert', 'false');
      x.upload.onprogress = function(e){ if (e.lengthComputable) onPct(100 * e.loaded / e.total); };
      x.onload = function(){ if (x.status >= 200 && x.status < 300) res(); else rej(new Error('storage answered ' + x.status)); };
      x.onerror = function(){ rej(new Error('the upload did not reach storage (network)')); };
      x.send(file);
    });
  }
  function renderProgressOnly(){
    // Cheap: redraw the bars without rebuilding the table under a select.
    var r = root(); if (!r || !T.data) return;
    var old = r.querySelectorAll('.tn-prog');
    var tmp = document.createElement('div'); tmp.innerHTML = progressHtml(T.data);
    if (old.length && tmp.children.length === old.length) { for (var i = 0; i < old.length; i++) old[i].replaceWith(tmp.children[0]); }
    else render();
  }

  // ── polling while the reader works ──────────────────────────────────
  function syncPoll(){
    if (busy() && !T.poll) {
      T.poll = setInterval(async function(){
        if (!onTab() || !T.id) { clearInterval(T.poll); T.poll = null; return; }
        try {
          var p = await api('GET', '/tender/' + T.id + '/progress');
          if (T.data) { T.data.status = p.status; T.data.tasks = p.task ? [p.task] : T.data.tasks; }
          if (p.status === 'indexed' || p.status === 'failed' || p.status === 'new') { clearInterval(T.poll); T.poll = null; await load(); render(); }
          else renderProgressOnly();
        } catch (e) {}
      }, window.__TENDER_POLL_MS || 2500);
    }
    if (!busy() && T.poll) { clearInterval(T.poll); T.poll = null; }
  }

  // Is it on for whoever is signed in? The SERVER decides, from the session
  // token, so this asks whenever there is a token — it never waits on
  // fr_user carrying an email (a sign-in path that stored a profile without
  // one left the check silently skipped and the type never offered). Asked
  // after load (retrying until the app's api() is up), again on a sign-in,
  // and every time the job details window opens. The last answer is kept
  // per login so a reload shows the type straight away.
  function _who(){
    try {
      var u = JSON.parse(localStorage.getItem('fr_user') || 'null') || {};
      if (u.email) return String(u.email).toLowerCase();
      if (u.id) return 'id:' + u.id;
    } catch (e) {}
    try {
      var t = localStorage.getItem('fr_token') || '';
      var pl = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (pl.email) return String(pl.email).toLowerCase();
      if (pl.id || pl.sub) return 'id:' + (pl.id || pl.sub);
    } catch (e) {}
    return '';
  }
  function _applyLive(on){
    window.__tenderingLive = !!on;
    // An edit window opened before the answer came read a tender job as roofing.
    try { if (on && window._jobDetailsMode === 'edit' && window.S && S.quote && S.quote.quoteKind === 'tender') window._pendingJobType = 'tender'; } catch (e) {}
    try { if (typeof _syncJobTypeToggle === 'function') _syncJobTypeToggle(); } catch (e) {}
    try { if (typeof _qkMenuRender === 'function') _qkMenuRender(); } catch (e) {}
    try { if (typeof _tenderNavSync === 'function') _tenderNavSync(); } catch (e) {}
  }
  var _askTries = 0;
  window._tenderEnabledCheck = async function(){
    if (!localStorage.getItem('fr_token')) return false;
    if (typeof api !== 'function') {   // app.html still parsing: try again shortly
      if (++_askTries < 30) setTimeout(window._tenderEnabledCheck, 1500);
      return false;
    }
    var who = _who();
    try {
      var r = await api('GET', '/tender/enabled');
      try { localStorage.setItem('fr_tender_on', JSON.stringify({ who: who, on: !!(r && r.enabled) })); } catch (e) {}
      _applyLive(r && r.enabled);
      return true;
    } catch (e) {   // unknown stays as it was; one more try in a while
      if (++_askTries < 30) setTimeout(window._tenderEnabledCheck, 5000);
      return false;
    }
  };
  try {
    var kept = JSON.parse(localStorage.getItem('fr_tender_on') || 'null');
    if (kept && kept.who && kept.who === _who()) window.__tenderingLive = !!kept.on;
  } catch (e) {}
  setTimeout(function(){ window._tenderEnabledCheck(); }, 1500);
})();
