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
      '@media screen and (max-width:760px){.tn-tbl .hide-sm{display:none}}',
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
      var pp = document.getElementById('tnPlansPop'); if (pp) pp.classList.remove('has-pages');
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
    h += '<div class="tn-card" id="tnPlanSet"><div class="tn-card-hd">Plan set<span class="tn-r">' + (d.files || []).length + ' file' + ((d.files || []).length === 1 ? '' : 's') + '</span></div><div class="tn-card-bd">' +
      '<div class="tn-drop" id="tnDrop" onclick="document.getElementById(\'tnFile\').click()"><b>Drop the plan-set PDFs here</b> or click to choose them<small>PDF only, up to ' + (window.__tenderMaxMb || 50) + ' MB a file. Architect’s and engineer’s sets together is fine — every page is read and sorted.</small></div>' +
      '<input type="file" id="tnFile" accept="application/pdf,.pdf" multiple style="display:none" onchange="_tenderFilesPicked(this.files)">' +
      filesHtml(d) + '</div></div>';
    var af = d.aiFailed;
    if (af && af.pages) h += '<div class="tn-warn">The AI could not read ' + af.pages + ' page' + (af.pages === 1 ? '' : 's') + (af.error ? ': ' + esc(af.error) : '') + '. Those pages are sorted by their title blocks only.</div>';
    var dt = (d.tasks || [])[0], derr = dt && dt.progress && dt.progress.error;
    if (!d.doc && derr && !busy()) h += '<div class="tn-err">Drafting the tender did not work: ' + esc(derr) + '. Press “Draft the tender” to try again.</div>';
    if (!d.doc && (d.status === 'indexed' || d.status === 'failed') && d.ai && (d.pages || []).length) h += '<div class="tn-next"><span>The set is read. Next, Claude reads the specification and the drawings and prices the tender.</span><button type="button" class="tn-btn" onclick="_tnDraft()">✨ Draft the tender</button></div>';
    h += '<div id="tnDocHost">' + docHtml(d) + '</div>';
    if (d.doc) h += '<details class="tn-fold" id="tnSheetIdx"><summary class="tn-card-hd" style="border-radius:12px;margin-bottom:10px">Sheet index — ' + (d.pages || []).length + ' pages (click to open)</summary>' + indexHtml(d) + '</details>';
    else h += indexHtml(d);
    // With a tender drafted, the menu runs down the far left and the A.I.
    // chat down the right, both from the very top, with the tender full
    // width between them (2026-10-28, the owner).
    if (d.doc) h = '<div class="tn-lay"><aside class="tn-side" id="tnSide">' + sideHtml(d) + '</aside><div class="tn-main">' + h + '</div><aside class="tn-side tn-chatside" id="tnChatSide">' + chatHtml(d.doc) + '</aside></div>';
    r.innerHTML = h;
    sidePin();
    wireDrop();
    loadThumbs();
    afterDocRender();
    plansSync();
  }

  // The menu sticks exactly where it starts, so it never moves at all as the
  // page scrolls, and runs to the foot of the screen.
  // Three columns when there is room for the tender between them (menu far
  // left, chat on the right); on a narrower screen the chat goes back under
  // the menu so the tender keeps a width it can be read at.
  var LAY3_MIN = 1300;
  var LAY1_MAX = 1000;   // narrower than this, the menu and the chat leave the side
  function layMode(){
    var lay = document.querySelector('#tenderRoot .tn-lay'), side = document.getElementById('tnSide'), cs = document.getElementById('tnChatSide'), main = lay && lay.querySelector('.tn-main');
    if (!lay || !side || !cs || !main || !lay.offsetParent) return;
    var wide = window.innerWidth > 900 && lay.clientWidth >= LAY3_MIN;
    lay.classList.toggle('tn-3', wide);
    lay.classList.toggle('tn-1', window.innerWidth > 900 && lay.clientWidth < LAY1_MAX);
    if (wide && cs.parentNode !== lay) lay.appendChild(cs);
    else if (!wide && cs.parentNode !== side) side.appendChild(cs);
  }
  function sidePin(){
    layMode();
    var side = document.getElementById('tnSide'), lay = side && side.parentNode; if (!side || !lay.offsetParent) return;
    var cs = document.getElementById('tnChatSide');
    var both = [side, cs && cs.parentNode === lay ? cs : null].filter(Boolean);
    if (cs && cs.parentNode !== lay) { cs.style.top = ''; cs.style.height = ''; }
    var chat = document.getElementById('tnChat'); if (chat) chat.style.left = '';
    if (window.innerWidth <= 900) { both.forEach(function(el){ el.style.top = ''; el.style.height = ''; }); return; }
    var y = Math.max(0, Math.round(lay.getBoundingClientRect().top + window.scrollY));
    if (lay.classList.contains('tn-1')) {   // the strip of links stays at the top; the chat runs along the foot of the tender's column
      side.style.top = y + 'px'; side.style.height = '';
      if (chat) chat.style.left = Math.round(lay.getBoundingClientRect().left + 8) + 'px';
      return;
    }
    both.forEach(function(el){ el.style.top = y + 'px'; el.style.height = 'calc(100vh - ' + (y + 10) + 'px)'; });
  }
  window.addEventListener('resize', function(){ sidePin(); });
  // drawn while the tab was hidden: pin it the first time it is seen
  window.addEventListener('scroll', function(){ var sd = document.getElementById('tnSide'); if (sd && !sd.style.top && window.scrollY < 40) sidePin(); }, { passive: true });

  // ── THE PLANS SLIDE-OUT (2026-10-28, the owner: "a slide out window just
  // like the quote photos ... each scroll changes a page, and then if I zoom
  // in, it zooms in on that page and I can click and hold the mouse to drag
  // around"). A tab on the right edge of the tendering page; one plan page
  // per slot, a plain wheel turns one page, Ctrl + wheel (or − +) zooms the
  // page on screen towards the pointer, a press-and-drag moves a zoomed page.
  var PV = { open: false, list: [], at: 0, z: {}, wheelAcc: 0, lockUntil: 0, urls: {}, drag: null };
  try { PV.open = sessionStorage.getItem('fr_tn_plans') === '1'; } catch (e) {}
  (function(){
    var st = document.createElement('style');
    st.textContent = [
      '#tnPlansPop{position:fixed;top:70px;right:0;bottom:16px;width:var(--tnpv-w,clamp(360px,42vw,980px));min-width:260px;max-width:96vw;z-index:76;background:#fff;border:1px solid #dbe3ec;border-right:none;border-radius:12px 0 0 12px;box-shadow:-6px 8px 24px rgba(0,0,0,.12);transform:translateX(100%);transition:transform .28s ease;display:none;flex-direction:column}',
      'body[data-tab="tender"] #tnPlansPop.has-pages{display:flex}#tnPlansPop.is-open{transform:translateX(0)}#tnPlansPop.is-resizing{transition:none;user-select:none}',
      '#tnPlansTab{position:absolute;left:-46px;top:16px;width:46px;height:150px;background:#0099cc;color:#fff;border:none;border-radius:10px 0 0 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.05em;padding:8px 0 10px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:6px;box-shadow:-3px 4px 12px rgba(0,153,204,.35)}',
      '#tnPlansTab:hover{background:#007bab}#tnPlansTab .a{font-size:16px;line-height:1;transition:transform .28s ease}#tnPlansPop.is-open #tnPlansTab .a{transform:rotate(180deg)}#tnPlansTab .t{writing-mode:vertical-rl;text-orientation:mixed}',
      '#tnPlansResize{position:absolute;left:0;top:0;bottom:0;width:12px;cursor:ew-resize;z-index:3;display:flex;align-items:center;justify-content:center;touch-action:none}#tnPlansResize::after{content:"";width:4px;height:52px;border-radius:3px;background:rgba(10,22,40,.18)}#tnPlansResize:hover::after{background:#0099cc;height:80px}',
      '.tnpv-hd{display:flex;align-items:center;gap:6px;padding:9px 12px 9px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0a1628}.tnpv-hd b{font-weight:800}.tnpv-hd .tnpv-at{color:#64748b;font-size:12px;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tnpv-b{width:30px;height:30px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;cursor:pointer;font-size:14px;line-height:1;color:#0a1628;flex:0 0 auto}.tnpv-b:hover{background:#f1f5f9}',
      '.tnpv-list{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:10px 12px 10px 20px;background:#eef2f6}',
      '.tnpv-slot{position:relative;height:var(--tnpv-slot,74vh);margin:0 0 12px;background:#fff;border:1px solid #d5dde7;border-radius:8px;overflow:hidden;cursor:default}',
      '.tnpv-slot.zoomed{cursor:grab}.tnpv-slot.grabbing{cursor:grabbing}',
      '.tnpv-slot img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;transform-origin:0 0;user-select:none;-webkit-user-drag:none;pointer-events:none}',
      '.tnpv-cap{position:absolute;left:8px;bottom:8px;z-index:2;background:rgba(10,22,40,.78);color:#fff;font-size:11.5px;padding:3px 8px;border-radius:6px;max-width:80%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tnpv-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px}',
      '@media screen and (max-width:900px){#tnPlansPop{width:92vw}}',
      '@media print{#tnPlansPop{display:none!important}}',
    ].join('\n');
    document.head.appendChild(st);
  })();
  function plansList(){
    var d = T.data || {}, files = d.files || [], fno = {};
    files.forEach(function(f, i){ fno[f.id] = i; });
    return (d.pages || []).filter(function(p){ return p.has_image !== false; }).slice().sort(function(a, b){ return (fno[a.file_id] || 0) - (fno[b.file_id] || 0) || a.page_no - b.page_no; });
  }
  function plansEl(){
    var el = document.getElementById('tnPlansPop');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tnPlansPop';
    el.innerHTML = '<div id="tnPlansResize" title="Drag to make the plans wider or narrower"></div>' +
      '<button type="button" id="tnPlansTab" onclick="_tnPlans()" title="The plan set"><span class="a">◀</span><span class="t">PLANS</span><span></span></button>' +
      '<div class="tnpv-hd"><b>Plans</b><span class="tnpv-at" id="tnpvAt"></span>' +
      '<button type="button" class="tnpv-b" title="Previous page" onclick="_tnPlansStep(-1)">▲</button><button type="button" class="tnpv-b" title="Next page" onclick="_tnPlansStep(1)">▼</button>' +
      '<button type="button" class="tnpv-b" title="Zoom out" onclick="_tnPlansZoom(1/1.25)">−</button><button type="button" class="tnpv-b" title="Zoom in (or Ctrl + wheel)" onclick="_tnPlansZoom(1.25)">+</button>' +
      '<button type="button" class="tnpv-b" title="Fit the page" onclick="_tnPlansZoom(0)">↺</button></div>' +
      '<div class="tnpv-list" id="tnpvList"></div>';
    document.body.appendChild(el);
    var list = el.querySelector('#tnpvList');
    list.addEventListener('wheel', plansWheel, { passive: false });
    list.addEventListener('scroll', function(){ var i = plansIndexAt(); if (i !== PV.at) { PV.at = i; plansHead(); plansLoadNear(); } });
    list.addEventListener('mousedown', plansDown);
    window.addEventListener('mousemove', plansMove);
    window.addEventListener('mouseup', plansUp);
    el.querySelector('#tnPlansResize').addEventListener('pointerdown', plansResizeStart);
    try { var w = localStorage.getItem('fr_tn_plans_w'); if (w) el.style.setProperty('--tnpv-w', w); } catch (e) {}
    return el;
  }
  function plansSync(){
    var el = plansEl(), L = plansList();
    var sig = L.map(function(p){ return p.id; }).join(',');
    el.classList.toggle('has-pages', L.length > 0);
    el.classList.toggle('is-open', PV.open && L.length > 0);
    plansFit();
    if (sig === PV.sig) return;
    PV.sig = sig; PV.list = L; PV.z = {}; PV.at = Math.min(PV.at, Math.max(0, L.length - 1));
    var list = el.querySelector('#tnpvList');
    list.innerHTML = L.map(function(p, i){
      var cap = (p.sheet_id ? p.sheet_id + ' · ' : '') + (p.title || ('Page ' + p.page_no));
      return '<div class="tnpv-slot" data-i="' + i + '"><div class="tnpv-load">Loading…</div><img alt="" data-pid="' + esc(p.id) + '"><span class="tnpv-cap">' + esc(cap) + '</span></div>';
    }).join('');
    plansHead(); plansLoadNear();
  }
  // One page to a slot, the next one peeking under it.
  function plansFit(){
    var el = document.getElementById('tnPlansPop'), list = el && el.querySelector('#tnpvList');
    if (list && list.clientHeight > 100) el.style.setProperty('--tnpv-slot', Math.round(list.clientHeight - 20 - 48) + 'px');
  }
  window.addEventListener('resize', function(){ plansFit(); });
  function plansHead(){
    var at = document.getElementById('tnpvAt'), p = PV.list[PV.at];
    if (at) at.textContent = PV.list.length ? ('Page ' + (PV.at + 1) + ' of ' + PV.list.length + (p && p.sheet_id ? ' · ' + p.sheet_id : '') + (p && p.title ? ' ' + p.title : '')) : '';
  }
  function plansSlot(i){ return document.querySelector('#tnpvList .tnpv-slot[data-i="' + i + '"]'); }
  function plansIndexAt(){
    var list = document.getElementById('tnpvList'), s0 = plansSlot(0); if (!list || !s0) return 0;
    var pitch = s0.offsetHeight + 12;
    return Math.max(0, Math.min(PV.list.length - 1, Math.round(list.scrollTop / pitch)));
  }
  function plansLoadNear(){
    if (!PV.open) return;
    for (var i = PV.at - 1; i <= PV.at + 2; i++) {
      var p = PV.list[i]; if (!p) continue;
      (function(p, i){
        var slot = plansSlot(i); if (!slot) return;
        var img = slot.querySelector('img'); if (img.getAttribute('src')) return;
        var put = function(u){ img.onload = function(){ var l = slot.querySelector('.tnpv-load'); if (l) l.remove(); }; img.src = u; plansApply(i); };
        if (PV.urls[p.id]) return put(PV.urls[p.id]);
        img.setAttribute('src', '');
        api('GET', '/tender/' + T.id + '/pages/' + p.id + '/image').then(function(x){ PV.urls[p.id] = x.url; put(x.url); }).catch(function(){ img.removeAttribute('src'); var l = slot.querySelector('.tnpv-load'); if (l) l.textContent = 'This page could not be loaded.'; });
      })(p, i);
    }
  }
  function plansApply(i){
    var slot = plansSlot(i); if (!slot) return;
    var z = PV.z[i] || { s: 1, x: 0, y: 0 };
    var img = slot.querySelector('img'); if (img) img.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
    slot.classList.toggle('zoomed', z.s > 1.001);
  }
  // Keep a zoomed page from being dragged right off its slot.
  function plansClamp(i){
    var slot = plansSlot(i), z = PV.z[i]; if (!slot || !z) return;
    var W = slot.clientWidth, H = slot.clientHeight;
    if (z.s <= 1.001) { PV.z[i] = { s: 1, x: 0, y: 0 }; return; }
    z.x = Math.min(0, Math.max(W - W * z.s, z.x)); z.y = Math.min(0, Math.max(H - H * z.s, z.y));
  }
  function plansZoomAt(i, f, px, py){
    var slot = plansSlot(i); if (!slot) return;
    var z = PV.z[i] || { s: 1, x: 0, y: 0 };
    if (px == null) { px = slot.clientWidth / 2; py = slot.clientHeight / 2; }
    var s2 = f === 0 ? 1 : Math.max(1, Math.min(8, z.s * f));
    z.x = px - (px - z.x) * (s2 / z.s); z.y = py - (py - z.y) * (s2 / z.s); z.s = s2;
    PV.z[i] = z; plansClamp(i); plansApply(i);
  }
  window._tnPlansZoom = function(f){ plansZoomAt(PV.at, f); };
  window._tnPlansStep = function(dir){
    var list = document.getElementById('tnpvList'), i = Math.max(0, Math.min(PV.list.length - 1, PV.at + dir)), slot = plansSlot(i);
    if (!list || !slot) return;
    PV.at = i; plansHead(); plansLoadNear();
    list.scrollTo({ top: slot.offsetTop - 10, behavior: 'smooth' });
  };
  window._tnPlans = function(open){
    PV.open = open == null ? !PV.open : !!open;
    try { sessionStorage.setItem('fr_tn_plans', PV.open ? '1' : '0'); } catch (e) {}
    var el = plansEl(); el.classList.toggle('is-open', PV.open);
    if (PV.open) plansLoadNear();
  };
  function plansWheel(e){
    var slot = e.target.closest && e.target.closest('.tnpv-slot');
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!slot) return;
      var i = +slot.getAttribute('data-i'), r = slot.getBoundingClientRect();
      plansZoomAt(i, Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    // A plain wheel turns one page a notch; a flick never skips pages.
    e.preventDefault();
    var now = Date.now(); if (now < PV.lockUntil) return;
    PV.wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(PV.wheelAcc) < 40) return;
    var dir = PV.wheelAcc > 0 ? 1 : -1; PV.wheelAcc = 0; PV.lockUntil = now + 380;
    window._tnPlansStep(dir);
  }
  function plansDown(e){
    if (e.button !== 0) return;
    var slot = e.target.closest && e.target.closest('.tnpv-slot'); if (!slot) return;
    var i = +slot.getAttribute('data-i'), z = PV.z[i];
    if (!z || z.s <= 1.001) return;
    e.preventDefault();
    PV.drag = { i: i, x0: e.clientX, y0: e.clientY, zx: z.x, zy: z.y, slot: slot };
    slot.classList.add('grabbing');
  }
  function plansMove(e){
    var g = PV.drag; if (!g) return;
    var z = PV.z[g.i]; z.x = g.zx + (e.clientX - g.x0); z.y = g.zy + (e.clientY - g.y0);
    plansClamp(g.i); plansApply(g.i);
  }
  function plansUp(){ if (PV.drag) { PV.drag.slot.classList.remove('grabbing'); PV.drag = null; } }
  function plansResizeStart(e){
    var el = plansEl(); e.preventDefault(); el.classList.add('is-resizing');
    var mv = function(ev){ var w = Math.max(260, Math.min(window.innerWidth * 0.96, window.innerWidth - ev.clientX)); el.style.setProperty('--tnpv-w', w + 'px'); };
    var up = function(){ window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); el.classList.remove('is-resizing');
      try { localStorage.setItem('fr_tn_plans_w', el.style.getPropertyValue('--tnpv-w')); } catch (e) {}
      Object.keys(PV.z).forEach(function(i){ plansClamp(+i); plansApply(+i); }); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }
  window.__tnPlansState = function(){ return { open: PV.open, at: PV.at, n: PV.list.length, z: PV.z[PV.at] || { s: 1, x: 0, y: 0 } }; };

  function statusWord(s){ return { new: 'No files yet', queued: 'Waiting to be read', processing: 'Reading the set', indexed: 'Indexed', drafted: 'Tender drafted', failed: 'Failed' }[s] || s; }
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
      else if (p.stage === 'draft') { words = 'Claude is reading the specification and drawings and pricing the tender — this takes a few minutes'; pct = 97; }
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

  // ══════════════════════════════════════════════════════════════════
  // THE TENDER (2026-10-27, the owner: "a very automated process where i
  // just upload the pdf plans and the AI auto works out everything").
  // T.data.doc is the drafted tender — the roofing spec with quantities,
  // the pricing sheet, scope, exclusions, programme and the quote
  // document — and every figure and word on it is the office's to change.
  // Changes save to the server on their own (PUT /tender/:id/doc).
  // ══════════════════════════════════════════════════════════════════
  var CAT_LABEL = { roofing: 'Roofing', underlay: 'Underlay', cavity_vent: 'Cavity vent', membrane: 'Membrane', gutter: 'Gutter / spouting', downpipe: 'Downpipes',
    flashing: 'Flashings', safety_mesh: 'Safety mesh', wall_cladding: 'Wall cladding', fascia: 'Fascia', insulation: 'Insulation', fixings: 'Fixings', other: 'Other' };
  var CAT_ORDER = ['roofing', 'underlay', 'cavity_vent', 'membrane', 'safety_mesh', 'flashing', 'gutter', 'downpipe', 'wall_cladding', 'fascia', 'insulation', 'fixings', 'other'];
  var UNITS = ['m2', 'lm', 'each', 'roll', 'set', 'lot'];
  var UNIT_WORD = { m2: 'm²', lm: 'lm', each: 'ea', roll: 'roll', set: 'set', lot: 'lot' };
  var QSECTIONS = [
    ['intro', 'Introduction'], ['scope', 'Scope of work'], ['exclusions', 'Exclusions'],
    ['assumptions', 'Assumptions & clarifications'], ['price', 'Tender price'], ['org', 'Organisation structure'], ['programme', 'Programme'], ['terms', 'Terms'], ['accept', 'Acceptance'],
  ];
  // The roofing specification is the office's working sheet, not part of the
  // document (2026-10-27, the owner: "remove the Roofing specification from
  // the tender document"). A quote saved with it in its order simply drops it.
  // A section edited by describing the change: these go to /section (words,
  // lists, the org); the rest move the price and go to /amend.
  var SEC_TEXT = { price: 1, intro: 1, terms: 1, accept: 1, priceNote: 1, progNote: 1, exclusions: 1, assumptions: 1, rfis: 1, org: 1 };
  var SEC_LABEL = { intro: 'Introduction', scope: 'Scope of work', exclusions: 'Exclusions', assumptions: 'Assumptions & clarifications', rfis: 'Questions for the builder',
    price: 'Tender price', priceNote: 'Price note', org: 'Organisation structure', programme: 'Programme', terms: 'Terms', accept: 'Acceptance',
    spec: 'Specification', pricing: 'Pricing sheet' };
  // A roofing company's usual shape, shown until the office describes theirs.
  var ORG_DEFAULT = [
    { id: 'p1', role: 'Director / Contract Manager', name: '', reports_to: '', note: '' },
    { id: 'p2', role: 'Project Manager', name: '', reports_to: 'p1', note: '' },
    { id: 'p3', role: 'Health & Safety', name: '', reports_to: 'p1', note: '' },
    { id: 'p4', role: 'Office & Accounts', name: '', reports_to: 'p1', note: '' },
    { id: 'p5', role: 'Site Supervisor', name: '', reports_to: 'p2', note: '' },
    { id: 'p6', role: 'Roofing crews', name: '', reports_to: 'p5', note: 'Lead roofer + apprentice' },
  ];
  function orgOf(d){
    var doc = d.doc || {};
    if (doc.org && (doc.org.people || []).length) return doc.org;
    if (d.orgDefault && (d.orgDefault.people || []).length) return { people: d.orgDefault.people, described: true, fromOther: true };
    return { people: ORG_DEFAULT, described: false };
  }
  var DOC = { saveT: null, saving: false, dirty: false, chatBusy: false, openSheet: false };
  function money(n){ n = +n || 0; return '$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n){ n = +n || 0; return '$' + Math.round(n).toLocaleString('en-NZ'); }
  function num(v, d){ var n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : (d == null ? 0 : d); }
  function brand(){ return (window.S && S.settings && S.settings.branding) || {}; }
  function catSort(a, b){ return CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category); }

  function calc(doc){
    var r = doc.rates || {};
    var b = num(r.bufferPct, 5) / 100, m = num(r.markupPct, 10) / 100;
    var lines = (doc.items || []).filter(function(i){ return !i.off; }).map(function(i){
      var cost = num(i.quantity) * num(i.unit_cost);
      return { id: i.id, cost: cost, sell: cost * (1 + b) * (1 + m) };
    });
    var matCost = 0, matSell = 0;
    lines.forEach(function(l){ matCost += l.cost; matSell += l.sell; });
    var hrs = 0; (doc.labour || []).forEach(function(l){ hrs += num(l.man_hours); });
    var cHr = (num(r.leadCost, 45) + num(r.appCost, 25)) / 2, pHr = (num(r.leadPrice, 180) + num(r.appPrice, 90)) / 2;
    var sc = doc.scaffold || {};
    var scOn = !!sc.needed && sc.type !== 'none';
    var up = sc.type === 'platform' ? (1 + num(r.platformPct, 25) / 100) : 1;
    var scCost = scOn ? (sc.cost != null && sc.cost !== '' ? num(sc.cost) : num(r.scaffoldCost, 2000) * up) : 0;
    var scPrice = scOn ? (sc.price != null && sc.price !== '' ? num(sc.price) : num(r.scaffoldPrice, 2500) * up) : 0;
    var extras = 0; (doc.extraLines || []).forEach(function(x){ extras += num(x.amount); });
    var sub = matSell + hrs * pHr + scPrice + extras;
    var gst = sub * num(r.gstPct, 15) / 100;
    var costAll = matCost * (1 + b) + hrs * cHr + scCost;
    var byId = {}; lines.forEach(function(l){ byId[l.id] = l; });
    return { lines: byId, matCost: matCost, matCostBuf: matCost * (1 + b), matSell: matSell, hrs: hrs, labCost: hrs * cHr, labSell: hrs * pHr, cHr: cHr, pHr: pHr,
      scOn: scOn, scCost: scCost, scPrice: scPrice, extras: extras, sub: sub, gst: gst, total: sub + gst, gp: sub - costAll, gpPct: sub ? 100 * (sub - costAll) / sub : 0,
      gpHr: hrs ? (sub - costAll) / hrs : 0 };
  }

  function saveSoon(){
    DOC.dirty = true;
    clearTimeout(DOC.saveT);
    DOC.saveT = setTimeout(saveNow, 700);
    var el = document.getElementById('tnSaved'); if (el) el.textContent = 'Saving…';
  }
  async function saveNow(){
    if (!T.data || !T.data.doc || DOC.saving) { if (DOC.saving) saveSoon(); return; }
    DOC.saving = true; DOC.dirty = false;
    var el;
    try {
      var x = await api('PUT', '/tender/' + T.id + '/doc', { doc: T.data.doc });
      T.data.doc.savedAt = x.savedAt;
      el = document.getElementById('tnSaved'); if (el) { el.textContent = '✓ Saved ' + new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }); el.style.color = '#166534'; }
    } catch (e) {
      el = document.getElementById('tnSaved'); if (el) { el.textContent = 'Not saved — ' + (e && e.message || e); el.style.color = '#b91c1c'; }
      DOC.dirty = true;
    } finally { DOC.saving = false; }
  }
  window._tenderSaveNow = saveNow;
  window.__tnRerender = function(fn){ if (fn && T.data && T.data.doc) fn(T.data.doc); docRerender(); };   // a test seam
  function docRerender(){
    var host = document.getElementById('tnDocHost');
    if (!host || !T.data) { render(); return; }
    var y = window.scrollY;
    hostFill(host);
    window.scrollTo(0, y);
  }
  // Redraw the working sheet without losing where each box was scrolled to,
  // or what was half typed into the chat.
  function hostFill(host){
    var sc = {}, ci = document.getElementById('tnChatIn'), typed = ci && !ci.disabled ? ci.value : '', chatFocus = ci && document.activeElement === ci;
    host.querySelectorAll('.tn-box').forEach(function(b){ sc[b.getAttribute('data-box')] = b.scrollTop; });
    host.innerHTML = docHtml(T.data);
    var side = document.getElementById('tnSide');
    // the nav alone: on a narrower screen the chat lives inside the same aside
    if (side && T.data.doc) { var nv = document.getElementById('tnNav'), ns = nv ? nv.scrollTop : 0; if (nv) nv.outerHTML = sideHtml(T.data); else side.insertAdjacentHTML('afterbegin', sideHtml(T.data)); nv = document.getElementById('tnNav'); if (nv) nv.scrollTop = ns; }
    var cs = document.getElementById('tnChatSide');
    if (cs && T.data.doc) { layMode(); var lg = document.getElementById('tnChatLog'), ls = lg ? lg.scrollTop : 0, atEnd = !lg || lg.scrollTop + lg.clientHeight >= lg.scrollHeight - 4; cs.innerHTML = chatHtml(T.data.doc); lg = document.getElementById('tnChatLog'); if (lg) lg.scrollTop = atEnd ? lg.scrollHeight : ls; }
    host.querySelectorAll('.tn-box').forEach(function(b){ var v = sc[b.getAttribute('data-box')]; if (v) b.scrollTop = v; });
    var ci2 = document.getElementById('tnChatIn');
    if (ci2 && typed && !ci2.disabled) { ci2.value = typed; if (chatFocus) ci2.focus(); }
    afterDocRender();
  }

  // ── edits ──────────────────────────────────────────────────────────
  var NUMF = { quantity: 1, unit_cost: 1, man_hours: 1, crew: 1, start_day: 1, days: 1, amount: 1 };
  window._tnSet = function(list, idx, field, value, keep){
    var d = T.data && T.data.doc; if (!d) return;
    var arr = d[list]; if (!arr || !arr[idx]) return;
    var v = NUMF[field] ? num(value) : value;
    if (typeof arr[idx] === 'string') arr[idx] = String(value);
    else {
      arr[idx][field] = v;
      if (list === 'items' && field === 'unit_cost') { arr[idx].cost_source = 'you'; arr[idx].edited = true; }
      if (list === 'items' && (field === 'quantity')) arr[idx].edited = true;
    }
    saveSoon();
    if (!keep) docRerender();
  };
  window._tnRate = function(field, value){
    var d = T.data && T.data.doc; if (!d) return;
    d.rates = d.rates || {}; d.rates[field] = num(value);
    saveSoon(); docRerender();
  };
  window._tnScaffold = function(field, value){
    var d = T.data && T.data.doc; if (!d) return;
    d.scaffold = d.scaffold || {};
    if (field === 'type') { d.scaffold.type = value; d.scaffold.needed = value !== 'none'; d.scaffold.price = null; d.scaffold.cost = null; }
    else d.scaffold[field] = (value === '' ? null : num(value));
    saveSoon(); docRerender();
  };
  window._tnAdd = function(list){
    var d = T.data && T.data.doc; if (!d) return;
    d[list] = d[list] || [];
    var id = list.charAt(0) + Date.now().toString(36);
    if (list === 'items') d.items.push({ id: id, category: 'other', description: 'New item', product: '', profile: '', thickness: '', material: '', colour: '', spec_ref: '', source_pages: '', quantity: 1, unit: 'each', qty_basis: 'added by hand', pb_key: '', unit_cost: 0, cost_source: 'you', edited: true, confidence: 1 });
    else if (list === 'labour') d.labour.push({ id: id, task: 'New task', man_hours: 8, crew: 2, notes: '' });
    else if (list === 'timeline') { var last = (d.timeline || []).reduce(function(m, t){ return Math.max(m, num(t.start_day) + num(t.days)); }, 0); d.timeline.push({ id: id, phase: 'New phase', start_day: last, days: 1, crew: 2, notes: '' }); }
    else if (list === 'exclusions') d.exclusions.push({ text: 'New exclusion', why: '' });
    else if (list === 'extraLines') d.extraLines.push({ desc: 'Other line', amount: 0 });
    else d[list].push(list === 'scope' ? 'New scope item' : 'New line');
    saveSoon(); docRerender();
  };
  window._tnDel = function(list, idx){
    var d = T.data && T.data.doc; if (!d || !d[list]) return;
    d[list].splice(idx, 1);
    saveSoon(); docRerender();
  };
  window._tnMove = function(list, idx, dir){
    var d = T.data && T.data.doc; if (!d || !d[list]) return;
    var j = idx + dir; if (j < 0 || j >= d[list].length) return;
    var t = d[list][idx]; d[list][idx] = d[list][j]; d[list][j] = t;
    saveSoon(); docRerender();
  };
  window._tnToggleItem = function(idx){
    var d = T.data && T.data.doc; if (!d) return;
    d.items[idx].off = !d.items[idx].off; saveSoon(); docRerender();
  };
  window._tnQuoteSet = function(key, value){
    var d = T.data && T.data.doc; if (!d) return;
    d.quote = d.quote || {};
    d.quote[key] = value; saveSoon();
  };
  window._tnQSection = function(sec, what){
    var d = T.data && T.data.doc; if (!d) return;
    var q = d.quote = d.quote || {};
    q.hide = q.hide || {};
    var order = qOrder(d);
    var i = order.indexOf(sec);
    if (what === 'hide') q.hide[sec] = !q.hide[sec];
    else if (what === 'up' && i > 0) { order.splice(i, 1); order.splice(i - 1, 0, sec); q.order = order; }
    else if (what === 'down' && i >= 0 && i < order.length - 1) { order.splice(i, 1); order.splice(i + 1, 0, sec); q.order = order; }
    saveSoon(); docRerender();
  };
  window._tnQToggle = function(key){
    var d = T.data && T.data.doc; if (!d) return;
    d.quote = d.quote || {}; d.quote[key] = !d.quote[key]; saveSoon(); docRerender();
  };
  function qOrder(d){
    var q = (d.quote = d.quote || {});
    var all = QSECTIONS.map(function(s){ return s[0]; });
    var o = (q.order || []).filter(function(k){ return all.indexOf(k) >= 0; });
    all.forEach(function(k){ if (o.indexOf(k) < 0) o.push(k); });
    return o;
  }

  // ── Claude ─────────────────────────────────────────────────────────
  window._tnAmend = async function(mode, extra){
    var d = T.data && T.data.doc; if (!d || DOC.chatBusy) return;
    var instr = '', change = false;
    if (mode === 'tagout') {
      // A scope line tagged out (2026-10-28): it moves to the exclusions at
      // once, then Claude takes out the items, labour and time only it needed.
      var line = (d.scope || [])[extra]; if (line == null) return;
      d.scope.splice(extra, 1);
      d.exclusions = (d.exclusions || []).concat([{ text: line, why: 'Tagged out of our scope' }]);
      DOC.dirty = true;
      instr = 'The estimator has tagged this line OUT of our scope of work, and it is now in the exclusions: "' + line + '". Take out the items, labour and programme time that were only for that work, and keep the exclusion. Change nothing else.';
      mode = 'chat'; change = true;
    } else if (mode === 'chat') {
      var inp = document.getElementById('tnChatIn');
      instr = inp ? inp.value.trim() : '';
      if (!instr) { if (inp) inp.focus(); return; }
    }
    DOC.chatBusy = mode;
    d.chat = d.chat || [];
    var pending = { who: 'you', text: change ? ('Tag out: ' + d.exclusions[d.exclusions.length - 1].text) : mode === 'chat' ? instr : (mode === 'simplify' ? 'Simplify the scope' : 'Minimise the scope'), at: new Date().toISOString(), pending: true };
    d.chat.push(pending);
    docRerender();
    try {
      if (DOC.dirty) await saveNow();
      var x = await api('POST', '/tender/' + T.id + '/amend', { mode: mode, instruction: instr, change: change, said: change ? pending.text : '', doc: d });
      T.data.doc = x.doc;
      if (!x.answered) T.data.history = [{ at: new Date().toISOString(), why: mode }].concat(T.data.history || []);
    } catch (e) {
      d.chat = d.chat.filter(function(m){ return m !== pending; });
      d.chat.push({ who: 'ai', text: 'Sorry — that did not work: ' + (e && e.message || e), at: new Date().toISOString(), err: true });
    } finally { DOC.chatBusy = false; docRerender(); }
  };
  window._tnUndo = async function(){
    try { var x = await api('POST', '/tender/' + T.id + '/undo', {}); T.data.doc = x.doc; T.data.history = x.history; docRerender(); }
    catch (e) { alert(e && e.message || e); }
  };
  window._tnDraft = async function(){
    if (T.data && T.data.doc && !confirm('Draft the whole tender again from the plans? Your changes are kept as a version you can go back to with Undo.')) return;
    try { await api('POST', '/tender/' + T.id + '/draft', {}); await load(); render(); syncPoll(); }
    catch (e) { alert(e && e.message || e); }
  };

  // ── the page ───────────────────────────────────────────────────────
  function inp(list, i, f, v, cls, type){
    return '<input class="' + (cls || '') + '" ' + (type === 'n' ? 'inputmode="decimal" ' : '') + 'value="' + esc(v == null ? '' : v) + '" onchange="_tnSet(\'' + list + '\',' + i + ',\'' + f + '\',this.value)">';
  }
  function docHtml(d){
    var doc = d.doc;
    if (!doc) return '';
    var c = calc(doc);
    var h = '';
    // summary
    var p = doc.project || {}, rf = doc.roof || {};
    h += '<div class="tn-sum tn-anchor" id="tn-a-overview">' +
      '<div><small>Project</small><b>' + esc(p.name || d.name || 'Tender') + '</b>' + (p.address ? '<span>' + esc(p.address) + '</span>' : '') + '</div>' +
      '<div><small>Roof</small><b>' + (rf.area_m2 ? Math.round(rf.area_m2) + ' m²' : '—') + '</b><span>' + esc([rf.roof_type, rf.pitch, rf.job_kind && rf.job_kind !== 'unknown' ? rf.job_kind : ''].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div><small>Tender price</small><b>' + money0(c.sub) + ' <em>+ GST</em></b><span>' + money0(c.total) + ' incl GST · GP ' + c.gpPct.toFixed(0) + '%</span></div>' +
      '<div><small>Programme</small><b>' + (num(doc.duration_days) ? num(doc.duration_days) + ' working days' : '—') + '</b><span>' + c.hrs.toFixed(0) + ' man-hours</span></div>' +
      '</div>';
    h += '<div class="tn-bar2"><span id="tnSaved" class="tn-saved">' + (doc.savedAt ? ('✓ Saved') : '') + '</span>' +
      '<button type="button" class="tn-btn sec" onclick="_tnDraft()">↻ Draft again from the plans</button>' +
      ((d.history || []).length ? '<button type="button" class="tn-btn sec" onclick="_tnUndo()" title="Go back to before: ' + esc((d.history[0] || {}).why || '') + '">↶ Undo last AI change</button>' : '') +
      '<button type="button" class="tn-btn" onclick="_tnPdf()">⬇ Save tender as PDF</button></div>';
    if (doc.confidence_notes || (doc.rfis || []).length) {
      h += '<div class="tn-warn"><b>Check these before you send it</b>' + (doc.confidence_notes ? '<div style="margin-top:4px">' + esc(doc.confidence_notes) + '</div>' : '') + '</div>';
    }
    var A = function(id, html){ return '<div class="tn-anchor" id="tn-a-' + id + '">' + html + '</div>'; };
    h += A('spec', specCard(doc, c));
    h += A('scope', scopeCard(doc));
    h += A('exclusions', listCard(doc, 'exclusions', 'Exclusions', 'What we are not pricing. These print on the tender.'));
    h += A('assumptions', listCard(doc, 'assumptions', 'Assumptions & clarifications', 'What the price is based on. These print on the tender.'));
    h += A('rfis', listCard(doc, 'rfis', 'Questions for the builder (RFIs)', 'Not printed — ask these before you commit.'));
    h += A('pricing', pricingCard(doc, c));
    h += A('programme', programmeCard(doc));
    h += A('doc', quoteCard(d, doc, c));
    return h;
  }
  function sideHtml(d){ return '<nav class="tn-nav" id="tnNav">' + navHtml(d, d.doc) + '</nav>'; }
  // The menu down the left, like Settings': a click scrolls to that part.
  function navHtml(d, doc){
    var q = doc.quote || {}, hide = q.hide || {};
    var it = function(id, label, cls){ return '<a href="#" class="tn-nav-i ' + (cls || '') + '" data-nav="' + id + '" onclick="_tnNavGo(\'' + id + '\');return false">' + esc(label) + '</a>'; };
    var h = '<div class="tn-nav-g">Working sheet</div>' + it('tn-a-overview', 'Overview') + it('tn-a-spec', 'Specification & quantities') + it('tn-a-scope', 'Scope of work') +
      it('tn-a-exclusions', 'Exclusions') + it('tn-a-assumptions', 'Assumptions') + it('tn-a-rfis', 'Questions (RFIs)') + it('tn-a-pricing', 'Pricing sheet') + it('tn-a-programme', 'Programme');
    h += '<div class="tn-nav-g">Tender document</div>' + it('tn-a-doc', 'The document');
    qOrder(doc).forEach(function(k){
      var lab = (q['h_' + k] != null && q['h_' + k] !== '') ? q['h_' + k] : (QSECTIONS.find(function(s){ return s[0] === k; }) || [k, k])[1];
      h += it('tq-sec-' + k, lab, 'sub' + (hide[k] ? ' off' : ''));
    });
    h += '<div class="tn-nav-g">Plans</div>' + it('tnPlanSet', 'Plan set') + it('tnSheetIdx', 'Sheet index');
    return h;
  }
  window._tnNavGo = function(id){
    var el = document.getElementById(id); if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    navMark(id);
    _spyHold = Date.now() + 1500;   // the smooth scroll must not re-light another entry
  };
  function navMark(id){
    var nav = document.getElementById('tnNav'); if (!nav) return;
    nav.querySelectorAll('.tn-nav-i').forEach(function(a){ a.classList.toggle('on', a.getAttribute('data-nav') === id); });
  }
  // Which part is on screen: the last one whose top has passed a line near the top.
  var _spyT = null, _spyHold = 0;
  function navSpy(){
    var nav = document.getElementById('tnNav'); if (!nav || !nav.offsetParent || Date.now() < _spyHold) return;
    var cur = null, best = -1e9;
    nav.querySelectorAll('.tn-nav-i').forEach(function(a){
      var id = a.getAttribute('data-nav'), el = document.getElementById(id); if (!el) return;
      var t = el.getBoundingClientRect().top;
      if (t < 140 && t > best) { best = t; cur = id; }
    });
    navMark(cur || 'tn-a-overview');
  }
  window.addEventListener('scroll', function(){ clearTimeout(_spyT); _spyT = setTimeout(navSpy, 60); }, true);

  // ── "Edit [section]": describe the change, typed or spoken ─────────
  function editBtn(sec, cls){
    return '<button type="button" class="tn-edit ' + (cls || '') + '" title="Edit ' + esc(SEC_LABEL[sec] || sec) + ' with A.I." onclick="event.stopPropagation();_tnEdit(\'' + sec + '\')">✨ Edit with A.I.</button>';
  }
  var EDIT = { sec: '', busy: false, rec: null };
  var EDIT_HINT = {
    org: 'Describe how your company is set up, e.g. “Aron Flood is the director, Ethan Smith is project manager, Mike runs the site, and we have four crews of a lead roofer and an apprentice”. It is kept for your next tenders too.',
    price: 'Change the words under the price, or the lines added on top (P&G, travel, a provisional sum). To change the materials or labour, use Edit Pricing sheet.',
    spec: 'e.g. “change the roofing to 0.48 Colorsteel Endura”, “add 40 lm of parapet capping”.',
    scope: 'e.g. “take out the skylights, the builder supplies them”. The items, the price and the programme follow.',
    pricing: 'e.g. “allow 20% more labour for the access”, “use $38/m² for the Styleline”.',
    programme: 'e.g. “we can only start the canopies after the main roof”, “two crews, so halve the sheeting time”.',
  };
  function editModal(){
    var m = document.getElementById('tnEditModal'); if (m) return m;
    m = document.createElement('div'); m.id = 'tnEditModal'; m.className = 'tn-modal';
    m.innerHTML = '<div class="tn-modal-card" role="dialog" aria-modal="true" aria-labelledby="tnEditTitle"><div class="tn-modal-hd"><b id="tnEditTitle"></b><button type="button" class="tn-x" onclick="_tnEditClose()" aria-label="Close">✕</button></div>' +
      '<p class="tn-note" id="tnEditHint" style="margin:0 0 8px"></p><label class="tn-modal-lbl" for="tnEditIn">Describe your change</label>' +
      '<textarea id="tnEditIn" rows="4" placeholder="Type it, or press Speak and say it"></textarea>' +
      '<div class="tn-modal-ft"><button type="button" class="tn-btn sec tn-mic" id="tnEditMic" onclick="_tnMic()">🎤 Speak</button><span id="tnEditMsg" class="tn-edit-msg"></span>' +
      '<button type="button" class="tn-btn sec" onclick="_tnEditClose()">Cancel</button><button type="button" class="tn-btn" id="tnEditGo" onclick="_tnEditGo()">Make the change</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('mousedown', function(e){ if (e.target === m && !EDIT.busy) window._tnEditClose(); });
    m.querySelector('#tnEditIn').addEventListener('keydown', function(e){ if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window._tnEditGo(); } if (e.key === 'Escape' && !EDIT.busy) window._tnEditClose(); });
    return m;
  }
  window._tnEdit = function(sec){
    if (!T.data || !T.data.doc) return;
    var m = editModal();
    EDIT.sec = sec;
    m.querySelector('#tnEditTitle').textContent = '✨ Edit ' + (SEC_LABEL[sec] || sec) + ' with A.I.';
    m.querySelector('#tnEditHint').textContent = EDIT_HINT[sec] || 'Say what you want changed in this section, in your own words.';
    var inp = m.querySelector('#tnEditIn'); inp.value = ''; inp.disabled = false;
    m.querySelector('#tnEditMsg').textContent = '';
    m.querySelector('#tnEditMic').style.display = speechCtor() ? '' : 'none';
    editBusy(false);
    m.classList.add('open');
    setTimeout(function(){ inp.focus(); }, 30);
  };
  window._tnEditClose = function(){ micStop(); var m = document.getElementById('tnEditModal'); if (m) m.classList.remove('open'); };
  function editBusy(on){
    EDIT.busy = on;
    var m = document.getElementById('tnEditModal'); if (!m) return;
    var go = m.querySelector('#tnEditGo'); go.disabled = on; go.textContent = on ? 'Working on it…' : 'Make the change';
    m.querySelector('#tnEditIn').disabled = on; m.querySelector('#tnEditMic').disabled = on;
  }
  // What the section says now, as plain text, for the words-only sections.
  function secCurrent(sec){
    if (sec === 'org') return orgOf(T.data).people;
    var key = sec === 'price' ? 'priceNote' : sec;
    var el = document.querySelector('#tqPage [data-qk="' + key + '"]');
    if (!el) return '';
    var t = '';
    el.querySelectorAll('p:not(.tq-pb),li:not(.tq-pb)').forEach(function(n){ t += (n.tagName === 'LI' ? '- ' : '') + n.textContent.trim() + '\n'; });
    return t || el.textContent.trim();
  }
  window._tnEditGo = async function(){
    var m = document.getElementById('tnEditModal'); if (!m || EDIT.busy) return;
    var inp = m.querySelector('#tnEditIn'), msg = m.querySelector('#tnEditMsg');
    var instr = inp.value.trim();
    if (!instr) { msg.textContent = 'Say what to change first.'; inp.focus(); return; }
    micStop();
    var sec = EDIT.sec;
    editBusy(true); msg.textContent = SEC_TEXT[sec] ? 'Claude is rewriting the section…' : 'Claude is changing the tender — this can take a minute…';
    try {
      if (DOC.dirty) await saveNow();
      var d = T.data.doc, x;
      if (SEC_TEXT[sec]) x = await api('POST', '/tender/' + T.id + '/section', { section: sec, instruction: instr, current: secCurrent(sec), doc: d });
      else x = await api('POST', '/tender/' + T.id + '/amend', { mode: 'chat', change: true, instruction: 'Change the ' + (SEC_LABEL[sec] || sec) + ' section: ' + instr, doc: d });
      T.data.doc = x.doc;
      T.data.history = [{ at: new Date().toISOString(), why: 'Edit ' + (SEC_LABEL[sec] || sec) }].concat(T.data.history || []);
      editBusy(false);
      window._tnEditClose();
      docRerender();
      var target = document.getElementById(SEC_TEXT[sec] && sec !== 'exclusions' && sec !== 'assumptions' && sec !== 'rfis' ? 'tq-sec-' + sec : 'tn-a-' + sec) || document.getElementById('tq-sec-' + sec);
      if (target) { target.classList.add('tn-flash'); setTimeout(function(){ target.classList.remove('tn-flash'); }, 1800); }
    } catch (e) {
      editBusy(false);
      msg.textContent = 'That did not work: ' + (e && e.message || e);
    }
  };
  // Speech to text: the browser's own recogniser (Chrome, Edge, Safari).
  function speechCtor(){ return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function micStop(){
    if (EDIT.rec) { try { EDIT.rec.stop(); } catch (e) {} EDIT.rec = null; }
    ['tnEditMic', 'tnChatMic'].forEach(function(id){ var b = document.getElementById(id); if (b) { b.classList.remove('on'); b.textContent = '🎤 Speak'; } });
    var cm = document.getElementById('tnChatMsg'); if (cm && cm.textContent === 'Listening…') cm.textContent = '';
  }
  window._tnMic = function(where){
    if (EDIT.rec) { micStop(); return; }
    var C = speechCtor(); if (!C) return;
    var chat = where === 'chat';
    var inp = document.getElementById(chat ? 'tnChatIn' : 'tnEditIn'), b = document.getElementById(chat ? 'tnChatMic' : 'tnEditMic'), msg = document.getElementById(chat ? 'tnChatMsg' : 'tnEditMsg');
    if (!inp || !b || !msg) return;
    var rec = new C();
    rec.lang = 'en-NZ'; rec.continuous = true; rec.interimResults = true;
    var base = inp.value ? inp.value.replace(/\s*$/, ' ') : '';
    rec.onresult = function(e){
      var fin = '', tmp = '';
      for (var i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript; else tmp += e.results[i][0].transcript; }
      inp.value = base + fin + tmp;
    };
    rec.onerror = function(e){ msg.textContent = e && e.error === 'not-allowed' ? 'The microphone is blocked for this site — allow it in the address bar.' : 'Could not hear that (' + (e && e.error || 'error') + ').'; micStop(); };
    rec.onend = function(){ if (EDIT.rec === rec) micStop(); };
    try { rec.start(); } catch (e) { msg.textContent = 'Could not start the microphone.'; return; }
    EDIT.rec = rec; b.classList.add('on'); b.textContent = '■ Stop'; msg.textContent = 'Listening…';
  };

  // ── the organisation structure ──────────────────────────────────────
  function orgHtml(d){
    var org = orgOf(d), ppl = org.people || [];
    var ids = {}; ppl.forEach(function(p){ ids[p.id] = p; });
    var kids = {}; var roots = [];
    ppl.forEach(function(p){ if (p.reports_to && ids[p.reports_to] && p.reports_to !== p.id) (kids[p.reports_to] = kids[p.reports_to] || []).push(p); else roots.push(p); });
    var seen = {};
    var li = function(p){
      if (seen[p.id]) return ''; seen[p.id] = 1;
      var e = function(f, v, tag, ph){ return '<' + tag + ' class="tq-ed" contenteditable="true" data-oid="' + esc(p.id) + '" data-of="' + f + '" data-ph="' + ph + '">' + esc(v || '') + '</' + tag + '>'; };
      var ch = (kids[p.id] || []).map(li).join('');
      return '<li><div class="tq-ob">' + e('role', p.role, 'b', 'Role') + e('name', p.name, 'span', 'Name') + e('note', p.note, 'small', '') +
        '<button type="button" class="tq-ox no-print" title="Remove" onclick="_tnOrgDel(\'' + esc(p.id) + '\')">✕</button></div>' + (ch ? '<ul>' + ch + '</ul>' : '') + '</li>';
    };
    var h = '';
    if (!org.described) h += '<div class="tq-orgask no-print">This is a standard structure. Press <b>✎ Edit Organisation structure</b> and describe yours (who does what, and how many crews) — it is kept for your next tenders.</div>';
    h += ce('orgNote', qText(d.doc, 'orgNote', '<p>Our team for this project:</p>'));
    h += '<div class="tq-org"><ul>' + roots.map(li).join('') + '</ul></div>';
    h += '<div class="no-print" style="margin-top:6px"><button type="button" class="tn-btn sec tn-add" onclick="_tnOrgAdd()">+ Add a role</button></div>';
    return h;
  }
  function orgWritable(){
    var d = T.data.doc, o = orgOf(T.data);
    if (!d.org || !(d.org.people || []).length || o.fromOther) d.org = { people: JSON.parse(JSON.stringify(o.people)), described: !!o.described };
    return d.org;
  }
  window._tnOrgSet = function(id, f, v){
    var org = orgWritable(); var p = org.people.find(function(x){ return x.id === id; }); if (!p || p[f] === v) return;
    p[f] = v; org.described = true; saveSoon();
  };
  window._tnOrgDel = function(id){
    var org = orgWritable(); var gone = org.people.find(function(x){ return x.id === id; }); if (!gone) return;
    org.people.forEach(function(x){ if (x.reports_to === id) x.reports_to = gone.reports_to || ''; });
    org.people = org.people.filter(function(x){ return x.id !== id; });
    org.described = true; saveSoon(); docRerender();
  };
  window._tnOrgAdd = function(){
    var org = orgWritable();
    var top = org.people.find(function(x){ return !x.reports_to; });
    org.people.push({ id: 'p' + Date.now().toString(36), role: 'New role', name: '', reports_to: top ? top.id : '', note: '' });
    org.described = true; saveSoon(); docRerender();
  };

  function specCard(doc, c){
    var items = (doc.items || []).map(function(it, i){ return { it: it, i: i }; }).sort(function(a, b){ return catSort(a.it, b.it) || a.i - b.i; });
    var h = '<div class="tn-card"><div class="tn-card-hd">Roofing specification &amp; quantities' + editBtn('spec') + boxCtl('w-spec') + '<span class="tn-r">' + items.length + ' items</span></div><div class="tn-card-bd">' + boxOpen('w-spec') + '';
    h += '<p class="tn-note">Read from the plans. Every box can be changed; quantities here are the ones priced below. Hover “From” for where on the plans it came from.</p>';
    h += '<div class="tn-scroll"><table class="tn-tbl tn-spec"><thead><tr><th>Type</th><th>Item</th><th>Profile</th><th>Thickness</th><th>Grade / material</th><th>Colour</th><th class="r">Qty</th><th>Unit</th><th>From</th><th></th></tr></thead><tbody>';
    items.forEach(function(x){
      var it = x.it, i = x.i;
      h += '<tr class="' + (it.off ? 'off' : '') + '"><td><select onchange="_tnSet(\'items\',' + i + ',\'category\',this.value)">' + CAT_ORDER.map(function(k){ return '<option value="' + k + '"' + (k === it.category ? ' selected' : '') + '>' + CAT_LABEL[k] + '</option>'; }).join('') + '</select></td>' +
        '<td>' + inp('items', i, 'description', it.description, 'wide') + '</td>' +
        '<td>' + inp('items', i, 'profile', it.profile, 'mid') + '</td>' +
        '<td>' + inp('items', i, 'thickness', it.thickness, 'sm') + '</td>' +
        '<td>' + inp('items', i, 'material', it.material, 'mid') + '</td>' +
        '<td>' + inp('items', i, 'colour', it.colour, 'mid') + '</td>' +
        '<td class="r">' + inp('items', i, 'quantity', it.quantity, 'sm r', 'n') + '</td>' +
        '<td><select onchange="_tnSet(\'items\',' + i + ',\'unit\',this.value)">' + UNITS.map(function(u){ return '<option value="' + u + '"' + (u === it.unit ? ' selected' : '') + '>' + UNIT_WORD[u] + '</option>'; }).join('') + '</select></td>' +
        '<td class="tn-from" title="' + esc([it.qty_basis, it.spec_ref, it.source_pages].filter(Boolean).join(' — ')) + '">' + esc(it.source_pages || it.spec_ref || '') + '</td>' +
        '<td class="nw"><button type="button" class="tn-x" title="' + (it.off ? 'Put back in the price' : 'Leave out of the price') + '" onclick="_tnToggleItem(' + i + ')">' + (it.off ? '↺' : '⊘') + '</button><button type="button" class="tn-x" title="Delete" onclick="_tnDel(\'items\',' + i + ')">✕</button></td></tr>';
    });
    h += '</tbody></table></div><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'items\')">+ Add item</button></div></div></div>';
    return h;
  }

  function scopeCard(doc){
    var h = '<div class="tn-card"><div class="tn-card-hd">Scope of work' + editBtn('scope') + boxCtl('w-scope') + '<span class="tn-r">' + (doc.scope || []).length + ' items</span></div><div class="tn-card-bd">' + boxOpen('w-scope') + '';
    h += '<div class="tn-ai-row"><button type="button" class="tn-btn sec" onclick="_tnAmend(\'simplify\')" ' + (DOC.chatBusy ? 'disabled' : '') + '>' + (DOC.chatBusy === 'simplify' ? 'Simplifying…' : '✂ Simplify') + '</button>' +
      '<button type="button" class="tn-btn sec" onclick="_tnAmend(\'minimise\')" ' + (DOC.chatBusy ? 'disabled' : '') + '>' + (DOC.chatBusy === 'minimise' ? 'Minimising…' : '⇣ Minimise scope') + '</button>' +
      '<span class="tn-note" style="margin:0">Simplify rewrites it shorter and plainer. Minimise cuts it to the core roofing and moves the rest to exclusions (and out of the price).</span></div>';
    h += '<ol class="tn-list">' + (doc.scope || []).map(function(s, i){
      return '<li><textarea rows="1" oninput="this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onchange="_tnSet(\'scope\',' + i + ',\'\',this.value)">' + esc(s) + '</textarea>' +
        '<button type="button" class="tn-tagout" title="Take this out of our scope: it moves to the exclusions and its items come out of the price" onclick="_tnAmend(\'tagout\',' + i + ')" ' + (DOC.chatBusy ? 'disabled' : '') + '>Tag out</button>' + rowTools('scope', i) + '</li>';
    }).join('') + '</ol><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'scope\')">+ Add scope item</button>';
    h += '</div></div></div>';
    return h;
  }
  // The A.I. chat, pinned down the right so it is there wherever the page is.
  function chatHtml(doc){
    var chat = doc.chat || [];
    return '<div class="tn-chat" id="tnChat"><div class="tn-chat-hd">✨ Ask A.I. — questions or changes</div><div class="tn-chat-log" id="tnChatLog">' +
      (chat.length ? chat.filter(function(m){ return !m.pending || DOC.chatBusy; }).map(function(m){ return '<div class="tn-msg ' + (m.who === 'you' ? 'you' : 'ai') + (m.err ? ' err' : '') + '">' + esc(m.text) + (m.pages ? '<span class="tn-msg-src">From: ' + esc(m.pages) + '</span>' : '') + (m.pending ? ' <i>— working on it…</i>' : '') + '</div>'; }).join('')
        : '<div class="tn-note" style="margin:0">Ask about the plans or the tender — “are Blocks 1 and 5/6 separate buildings?” — or ask for a change — “take the spouting out, the builder is doing it”.</div>') +
      '</div><textarea id="tnChatIn" rows="2" placeholder="Ask a question or say what to change — type, or press Speak…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();_tnAmend(\'chat\')}" ' + (DOC.chatBusy ? 'disabled' : '') + '></textarea>' +
      '<div class="tn-chat-in"><button type="button" class="tn-btn sec tn-mic" id="tnChatMic" onclick="_tnMic(\'chat\')" ' + (DOC.chatBusy ? 'disabled' : '') + '>🎤 Speak</button><span id="tnChatMsg" class="tn-edit-msg"></span>' +
      '<button type="button" class="tn-btn" onclick="_tnAmend(\'chat\')" ' + (DOC.chatBusy ? 'disabled' : '') + '>' + (DOC.chatBusy === 'chat' ? 'Working…' : 'Send') + '</button></div>' +
      '<div class="tn-note tn-chat-nt" style="margin:6px 0 0;font-size:11.5px">A question changes nothing. A change updates the scope, items, price and programme together — Undo puts it back.</div></div>';
  }
  // ── the section boxes: 8 lines tall and scrolling, opened out, or folded ──
  var BOX = (function(){ try { return JSON.parse(localStorage.getItem('fr_tn_box') || '{}') || {}; } catch (e) { return {}; } })();
  function boxMode(id){ var m = BOX[id]; return m === 'full' || m === 'min' ? m : 'mid'; }
  function boxCtl(id){
    var m = boxMode(id);
    var b = function(to, lab, t){ return '<button type="button" class="tn-bx" data-bx="' + to + '" title="' + t + '" onclick="event.stopPropagation();_tnBox(\'' + id + '\',\'' + to + '\')">' + lab + '</button>'; };
    return '<span class="tn-bxs no-print" data-bxfor="' + id + '">' +
      (m === 'full' ? b('mid', '▭ 8 lines', 'Back to the 8-line view') : b('full', '⤢ Expand', 'Show the whole section')) +
      (m === 'min' ? b('mid', '▾ Open', 'Open it to the 8-line view') : b('min', '– Minimise', 'Fold this section away')) + '</span>';
  }
  function boxOpen(id){ return '<div class="tn-box ' + boxMode(id) + '" data-box="' + id + '">'; }
  window._tnBox = function(id, to){
    BOX[id] = to; try { localStorage.setItem('fr_tn_box', JSON.stringify(BOX)); } catch (e) {}
    document.querySelectorAll('.tn-box[data-box="' + id + '"]').forEach(function(el){ el.className = 'tn-box ' + boxMode(id); if (to !== 'mid') el.scrollTop = 0; });
    document.querySelectorAll('.tn-bxs[data-bxfor="' + id + '"]').forEach(function(el){ el.outerHTML = boxCtl(id); });
  };
  function rowTools(list, i){
    return '<span class="tn-tools"><button type="button" class="tn-x" title="Up" onclick="_tnMove(\'' + list + '\',' + i + ',-1)">↑</button><button type="button" class="tn-x" title="Down" onclick="_tnMove(\'' + list + '\',' + i + ',1)">↓</button><button type="button" class="tn-x" title="Delete" onclick="_tnDel(\'' + list + '\',' + i + ')">✕</button></span>';
  }
  function listCard(doc, key, title, note){
    var arr = doc[key] || [];
    var h = '<div class="tn-card"><div class="tn-card-hd">' + esc(title) + editBtn(key) + boxCtl('w-' + key) + '<span class="tn-r">' + arr.length + '</span></div><div class="tn-card-bd">' + boxOpen('w-' + key) + '<p class="tn-note">' + esc(note) + '</p><ul class="tn-list">';
    arr.forEach(function(x, i){
      if (key === 'exclusions') h += '<li><div style="flex:1"><textarea rows="1" onchange="_tnSet(\'exclusions\',' + i + ',\'text\',this.value)">' + esc(x.text) + '</textarea>' + (x.why ? '<div class="tn-why">' + esc(x.why) + '</div>' : '') + '</div>' + rowTools(key, i) + '</li>';
      else h += '<li><textarea rows="1" onchange="_tnSet(\'' + key + '\',' + i + ',\'\',this.value)">' + esc(x) + '</textarea>' + rowTools(key, i) + '</li>';
    });
    return h + '</ul><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'' + key + '\')">+ Add</button></div></div></div>';
  }

  function pricingCard(doc, c){
    var r = doc.rates || {};
    var rate = function(f, label, v, suf){ return '<label>' + label + '<span><input inputmode="decimal" value="' + esc(v) + '" onchange="_tnRate(\'' + f + '\',this.value)">' + (suf || '') + '</span></label>'; };
    var h = '<div class="tn-card"><div class="tn-card-hd">Pricing sheet' + editBtn('pricing') + boxCtl('w-pricing') + '<span class="tn-r">' + money(c.sub) + ' + GST</span></div><div class="tn-card-bd">' + boxOpen('w-pricing') + '';
    h += '<div class="tn-rates">' + rate('bufferPct', 'Waste allowance', num(r.bufferPct, 5), '%') + rate('markupPct', 'Material mark-up', num(r.markupPct, 10), '%') +
      rate('leadPrice', 'Lead charge-out', num(r.leadPrice, 180), '/hr') + rate('leadCost', 'Lead cost', num(r.leadCost, 45), '/hr') +
      rate('appPrice', 'Apprentice charge-out', num(r.appPrice, 90), '/hr') + rate('appCost', 'Apprentice cost', num(r.appCost, 25), '/hr') + rate('gstPct', 'GST', num(r.gstPct, 15), '%') + '</div>';
    h += '<h4 class="tn-h4">Materials</h4><div class="tn-scroll"><table class="tn-tbl tn-price"><thead><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit cost</th><th>Priced from</th><th class="r">Cost</th><th class="r">Sell</th></tr></thead><tbody>';
    (doc.items || []).map(function(it, i){ return { it: it, i: i }; }).sort(function(a, b){ return catSort(a.it, b.it) || a.i - b.i; }).forEach(function(x){
      var it = x.it, i = x.i, l = c.lines[it.id] || { cost: 0, sell: 0 };
      var src = it.cost_source === 'pricebook' ? '<span class="tn-badge pb" title="' + esc(it.pb_label || '') + '">Price book</span>' : it.cost_source === 'you' ? '<span class="tn-badge you">You</span>' : '<span class="tn-badge est" title="Not in your price book — Claude’s estimate of the 2026 NZ trade price">AI estimate</span>';
      h += '<tr class="' + (it.off ? 'off' : '') + '"><td>' + esc(it.description) + '</td><td class="r">' + inp('items', i, 'quantity', it.quantity, 'sm r', 'n') + '</td><td>' + esc(UNIT_WORD[it.unit] || it.unit) + '</td>' +
        '<td class="r">' + inp('items', i, 'unit_cost', it.unit_cost, 'sm r', 'n') + '</td><td>' + src + '</td><td class="r">' + (it.off ? '—' : money(l.cost)) + '</td><td class="r">' + (it.off ? 'left out' : money(l.sell)) + '</td></tr>';
    });
    h += '<tr class="tot"><td colspan="5">Materials (sell = cost + ' + num(r.bufferPct, 5) + '% waste + ' + num(r.markupPct, 10) + '% mark-up)</td><td class="r">' + money(c.matCost) + '</td><td class="r">' + money(c.matSell) + '</td></tr>';
    h += '</tbody></table></div><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'items\')">+ Add material</button>';
    h += '<h4 class="tn-h4">Labour <span class="tn-note" style="font-weight:400">— man-hours, a lead and an apprentice: cost ' + money(c.cHr) + '/hr, charged ' + money(c.pHr) + '/hr</span></h4><div class="tn-scroll"><table class="tn-tbl tn-price"><thead><tr><th>Task</th><th class="r">Man-hours</th><th class="r">Crew</th><th class="r">Days</th><th class="r">Cost</th><th class="r">Sell</th><th></th></tr></thead><tbody>';
    (doc.labour || []).forEach(function(l, i){
      var hrs = num(l.man_hours), crew = Math.max(1, num(l.crew) || 2);
      h += '<tr><td>' + inp('labour', i, 'task', l.task, 'wide') + '</td><td class="r">' + inp('labour', i, 'man_hours', l.man_hours, 'sm r', 'n') + '</td><td class="r">' + inp('labour', i, 'crew', l.crew, 'xs r', 'n') + '</td>' +
        '<td class="r">' + (hrs / crew / 8).toFixed(1) + '</td><td class="r">' + money(hrs * c.cHr) + '</td><td class="r">' + money(hrs * c.pHr) + '</td><td class="nw"><button type="button" class="tn-x" onclick="_tnDel(\'labour\',' + i + ')">✕</button></td></tr>';
    });
    h += '<tr class="tot"><td>Labour</td><td class="r">' + c.hrs.toFixed(1) + '</td><td></td><td></td><td class="r">' + money(c.labCost) + '</td><td class="r">' + money(c.labSell) + '</td><td></td></tr></tbody></table></div>';
    h += '<button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'labour\')">+ Add labour</button>';
    var sc = doc.scaffold || {};
    h += '<h4 class="tn-h4">Scaffolding</h4><div class="tn-rates"><label>Type<span><select onchange="_tnScaffold(\'type\',this.value)">' +
      [['none', 'None (builder supplies)'], ['edge', 'Edge protection'], ['platform', 'Full working platform']].map(function(o){ return '<option value="' + o[0] + '"' + ((sc.needed ? sc.type : 'none') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></span></label>' +
      (c.scOn ? '<label>Price<span><input inputmode="decimal" value="' + c.scPrice.toFixed(2) + '" onchange="_tnScaffold(\'price\',this.value)"></span></label><label>Cost<span><input inputmode="decimal" value="' + c.scCost.toFixed(2) + '" onchange="_tnScaffold(\'cost\',this.value)"></span></label>' : '') +
      (sc.notes ? '<span class="tn-why" style="align-self:center">' + esc(sc.notes) + '</span>' : '') + '</div>';
    h += '<h4 class="tn-h4">Other lines</h4><ul class="tn-list">' + (doc.extraLines || []).map(function(x, i){
      return '<li>' + inp('extraLines', i, 'desc', x.desc, 'wide') + inp('extraLines', i, 'amount', x.amount, 'sm r', 'n') + rowTools('extraLines', i) + '</li>';
    }).join('') + '</ul><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'extraLines\')">+ Add a line (P&amp;G, travel, PS3…)</button>';
    h += '<table class="tn-totals"><tr><td>Materials</td><td>' + money(c.matSell) + '</td></tr><tr><td>Labour (' + c.hrs.toFixed(0) + ' h)</td><td>' + money(c.labSell) + '</td></tr>' +
      (c.scOn ? '<tr><td>Scaffolding</td><td>' + money(c.scPrice) + '</td></tr>' : '') + (c.extras ? '<tr><td>Other lines</td><td>' + money(c.extras) + '</td></tr>' : '') +
      '<tr class="b"><td>Tender price ex GST</td><td>' + money(c.sub) + '</td></tr><tr><td>GST ' + num(r.gstPct, 15) + '%</td><td>' + money(c.gst) + '</td></tr><tr class="b"><td>Total incl GST</td><td>' + money(c.total) + '</td></tr>' +
      '<tr class="gp"><td>Gross profit</td><td>' + money(c.gp) + ' · ' + c.gpPct.toFixed(1) + '% · ' + money(c.gpHr) + '/hr</td></tr></table>';
    return h + '</div></div></div>';
  }

  function programmeCard(doc){
    var tl = doc.timeline || [];
    var end = tl.reduce(function(m, t){ return Math.max(m, num(t.start_day) + Math.max(0.5, num(t.days))); }, 0) || 1;
    var h = '<div class="tn-card"><div class="tn-card-hd">Programme' + editBtn('programme') + boxCtl('w-programme') + '<span class="tn-r">' + (Math.ceil(end) || 0) + ' working days</span></div><div class="tn-card-bd">' + boxOpen('w-programme') + '';
    h += '<div class="tn-gantt">' + tl.map(function(t, i){
      var l = 100 * num(t.start_day) / end, w = Math.max(1.5, 100 * Math.max(0.5, num(t.days)) / end);
      return '<div class="tn-g-row"><div class="tn-g-lbl">' + inp('timeline', i, 'phase', t.phase, 'wide') + '</div>' +
        '<div class="tn-g-num">Day ' + inp('timeline', i, 'start_day', t.start_day, 'xs r', 'n') + ' for ' + inp('timeline', i, 'days', t.days, 'xs r', 'n') + '</div>' +
        '<div class="tn-g-track"><i style="left:' + l.toFixed(2) + '%;width:' + w.toFixed(2) + '%"></i></div>' + rowTools('timeline', i) + '</div>';
    }).join('') + '</div><button type="button" class="tn-btn sec tn-add" onclick="_tnAdd(\'timeline\')">+ Add phase</button>';
    return h + '</div></div></div>';
  }

  // ── the tender document: an editable page that prints as the PDF ───
  function qText(doc, key, def){ var q = doc.quote || {}; return q[key] != null ? q[key] : def; }
  function ce(key, html, tag, cls){
    tag = tag || 'div';
    return '<' + tag + ' class="tq-ed ' + (cls || '') + '" contenteditable="true" data-qk="' + key + '">' + html + '</' + tag + '>';
  }
  function ceList(list, i, field, text){
    return '<span class="tq-ed" contenteditable="true" data-ql="' + list + '" data-qi="' + i + '" data-qf="' + (field || '') + '">' + esc(text) + '</span>';
  }
  function quoteCard(d, doc, c){
    var b = brand(), p = doc.project || {}, q = doc.quote || {};
    var ref = (window.S && S.quote && S.quote.ref) || '';
    var today = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
    var dep = (window.S && S.settings && S.settings.invoicing && S.settings.invoicing.deposit_percent != null) ? S.settings.invoicing.deposit_percent : 50;
    var h = '<div class="tn-card"><div class="tn-card-hd">Tender document<span class="tn-r"><span id="tqPages"></span>click any text on the page to change it</span></div><div class="tn-card-bd">';
    h += '<div class="tn-ai-row"><button type="button" class="tn-btn" onclick="_tnPdf()">⬇ Save tender as PDF</button>' +
      '<label class="tn-chk"><input type="checkbox" ' + (q.showBreakdown ? 'checked' : '') + ' onchange="_tnQToggle(\'showBreakdown\')"> Show the price breakdown</label></div>';
    var order = qOrder(doc), hide = q.hide || {};
    var page = '<div class="tq-page" id="tqPage">';
    page += '<div class="tq-head">' + (b.logo_data_url ? '<img class="tq-logo" src="' + esc(b.logo_data_url) + '" alt="">' : '<div class="tq-co">' + esc(b.company_name || '') + '</div>') +
      '<div class="tq-cod">' + esc(b.company_name || '') + (b.address ? '<br>' + esc(b.address) : '') + (b.phone ? '<br>' + esc(b.phone) : '') + (b.email ? '<br>' + esc(b.email) : '') + (b.gst_number ? '<br>GST ' + esc(b.gst_number) : '') + '</div></div>';
    page += ce('title', esc(qText(doc, 'title', 'Roofing Tender')), 'h1', 'tq-title');
    page += '<table class="tq-meta"><tr><td>Project</td><td>' + ce('m_project', esc(qText(doc, 'm_project', p.name || d.name || '')), 'span') + '</td></tr>' +
      '<tr><td>Site</td><td>' + ce('m_site', esc(qText(doc, 'm_site', p.address || '')), 'span') + '</td></tr>' +
      '<tr><td>To</td><td>' + ce('m_to', esc(qText(doc, 'm_to', p.client || '')), 'span') + '</td></tr>' +
      '<tr><td>Documents</td><td>' + ce('m_docs', esc(qText(doc, 'm_docs', [p.architect, p.documents].filter(Boolean).join(' — '))), 'span') + '</td></tr>' +
      '<tr><td>Date</td><td>' + ce('m_date', esc(qText(doc, 'm_date', today)), 'span') + '</td></tr>' +
      '<tr><td>Our ref</td><td>' + ce('m_ref', esc(qText(doc, 'm_ref', ref)), 'span') + '</td></tr></table>';
    order.forEach(function(sec){
      var label = (QSECTIONS.find(function(s){ return s[0] === sec; }) || [sec, sec])[1];
      var tools = '<span class="tq-tools no-print"><button type="button" class="tq-edit" title="Edit ' + esc(label) + ' with A.I." onclick="_tnEdit(\'' + sec + '\')">✨ Edit with A.I.</button><button type="button" onclick="_tnQSection(\'' + sec + '\',\'up\')" title="Move up">↑</button><button type="button" onclick="_tnQSection(\'' + sec + '\',\'down\')" title="Move down">↓</button><button type="button" onclick="_tnQSection(\'' + sec + '\',\'hide\')">' + (hide[sec] ? 'Show on the tender' : 'Hide') + '</button></span>';
      if (hide[sec]) { page += '<div class="tq-sec tq-hidden no-print" id="tq-sec-' + sec + '"><h2>' + esc(label) + ' <i>(hidden)</i>' + tools + '</h2></div>'; return; }
      var body = '';
      if (sec === 'intro') body = ce('intro', qText(doc, 'intro', '<p>Thank you for the opportunity to tender for the roofing on this project. We are pleased to submit our price below for the supply and installation of the roofing as described, based on the documents listed above.</p>'));
      else if (sec === 'scope') body = '<ul class="tq-ul">' + (doc.scope || []).map(function(s, i){ return '<li>' + ceList('scope', i, '', s) + '</li>'; }).join('') + '</ul>';
      else if (sec === 'exclusions') body = '<ul class="tq-ul">' + (doc.exclusions || []).map(function(x, i){ return '<li>' + ceList('exclusions', i, 'text', x.text) + '</li>'; }).join('') + '</ul>';
      else if (sec === 'assumptions') body = (doc.assumptions || []).length ? '<ul class="tq-ul">' + doc.assumptions.map(function(s, i){ return '<li>' + ceList('assumptions', i, '', s) + '</li>'; }).join('') + '</ul>' : '<p class="tq-sub">None.</p>';
      else if (sec === 'price') {
        body = '<table class="tq-price">' + (q.showBreakdown ? ('<tr><td>Materials</td><td>' + money(c.matSell) + '</td></tr><tr><td>Labour</td><td>' + money(c.labSell) + '</td></tr>' +
          (c.scOn ? '<tr><td>Scaffolding / edge protection</td><td>' + money(c.scPrice) + '</td></tr>' : '') +
          (doc.extraLines || []).filter(function(x){ return num(x.amount); }).map(function(x){ return '<tr><td>' + esc(x.desc) + '</td><td>' + money(x.amount) + '</td></tr>'; }).join('')) : '') +
          '<tr class="b"><td>Tender price (excluding GST)</td><td>' + money(c.sub) + '</td></tr><tr><td>GST</td><td>' + money(c.gst) + '</td></tr><tr class="b"><td>Total including GST</td><td>' + money(c.total) + '</td></tr></table>' +
          ce('priceNote', qText(doc, 'priceNote', '<p>This price is valid for 30 days from the date above.</p>'));
      }
      else if (sec === 'org') body = orgHtml(d);
      else if (sec === 'programme') {
        var tl = doc.timeline || [];
        var end = tl.reduce(function(m, t){ return Math.max(m, num(t.start_day) + Math.max(0.5, num(t.days))); }, 0) || 1;
        body = ce('progNote', qText(doc, 'progNote', '<p>Our programme for the roofing works, in working days from our start on site (weather permitting):</p>')) +
          '<div class="tq-gantt">' + tl.map(function(t){
            return '<div class="tq-g"><span>' + esc(t.phase) + '</span><span class="tq-g-d">' + (num(t.days) ? num(t.days) + (num(t.days) === 1 ? ' day' : ' days') : '') + '</span><span class="tq-g-t"><i style="left:' + (100 * num(t.start_day) / end).toFixed(2) + '%;width:' + Math.max(1.5, 100 * Math.max(0.5, num(t.days)) / end).toFixed(2) + '%"></i></span></div>';
          }).join('') + '</div><p class="tq-sub">Total: ' + Math.ceil(end) + ' working days on site.</p>';
      }
      else if (sec === 'terms') body = ce('terms', qText(doc, 'terms', '<ul><li>Payment: ' + dep + '% deposit on acceptance where materials are ordered for this project; progress claims monthly; balance on completion.</li><li>Variations are charged at our standard rates and agreed before the work is done.</li><li>Our work is guaranteed for workmanship, with manufacturer warranties on materials as issued.</li><li>A Producer Statement (PS3) and the manufacturer’s warranty are issued on completion and final payment.</li></ul>'));
      else if (sec === 'accept') body = ce('accept', qText(doc, 'accept', '<p>To accept this tender please sign and return, or reply by email.</p><p>Name: ______________________ &nbsp; Signed: ______________________ &nbsp; Date: __________</p>'));
      page += '<div class="tq-sec' + (sec === 'org' || sec === 'programme' ? ' tq-keep' : '') + '" id="tq-sec-' + sec + '"><h2>' + ce('h_' + sec, esc(qText(doc, 'h_' + sec, label)), 'span') + tools + '</h2><div class="tq-body">' + body + '</div></div>';
    });
    page += '<div class="tq-foot">' + esc(b.company_name || '') + (b.website ? ' · ' + esc(b.website) : '') + '</div></div>';
    h += '<div class="tq-wrap">' + page + '</div></div></div>';
    return h;
  }
  // A word changed on the page goes back where it came from: a list line
  // into its list (so the scope on the page and the scope above are one),
  // anything else into doc.quote.
  // The sheet is always laid out at A4's own width, the PDF's, and shrunk to
  // fit a narrower column rather than reflowed or run off the right
  // (2026-10-28, the owner: "it's falling off to the right hand side").
  var PG_W = 794 + 2 * Math.round(49 / (695 / 794)), _pgRO = null;   // the content's 794 + its margins, all at the PDF's scale
  function pageFitScale(){
    var pg = document.getElementById('tqPage'); return pg ? (+pg.getAttribute('data-scale') || 1) : 1;
  }
  function pageFit(){
    var pg = document.getElementById('tqPage'), wrap = pg && pg.parentNode; if (!pg || !wrap || !wrap.offsetParent) return;
    var cs = getComputedStyle(wrap), avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var s = window.innerWidth <= 760 ? 1 : Math.min(PB_K, avail / PG_W);
    if (s > 0.9999) {
      if (pg.getAttribute('data-scale')) { pg.removeAttribute('data-scale'); pg.style.transform = ''; pg.style.transformOrigin = ''; pg.style.marginLeft = ''; wrap.style.height = ''; }
      return;
    }
    pg.setAttribute('data-scale', s.toFixed(4));
    pg.style.transformOrigin = '0 0'; pg.style.transform = 'scale(' + s.toFixed(4) + ')'; pg.style.marginLeft = '0';
    wrap.style.height = Math.ceil(pg.offsetHeight * s + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
  }
  function pageFitWatch(){
    var pg = document.getElementById('tqPage'); if (!pg || !window.ResizeObserver) return;
    if (_pgRO) _pgRO.disconnect();
    _pgRO = new ResizeObserver(function(){ pageFit(); });
    _pgRO.observe(pg); _pgRO.observe(pg.parentNode);
  }
  // a new window size can change how the live sheet lays out (the app's own
  // narrow-screen rules), so the sheets are measured again once it settles
  var _pgRsT = null;
  window.addEventListener('resize', function(){ pageFit(); clearTimeout(_pgRsT); _pgRsT = setTimeout(function(){ if (document.getElementById('tqPage')) pageBreaks(); }, 350); });
  function afterDocRender(){
    var pg = document.getElementById('tqPage'); if (!pg) return;
    pageFit(); pageFitWatch();
    pg.querySelectorAll('[contenteditable]').forEach(function(el){
      el.addEventListener('blur', function(){
        var d = T.data && T.data.doc; if (!d) return;
        if (el.hasAttribute('data-oid')) { window._tnOrgSet(el.getAttribute('data-oid'), el.getAttribute('data-of'), el.textContent.trim()); return; }
        if (el.hasAttribute('data-qk')) {
          var k = el.getAttribute('data-qk');
          var v = /^(intro|terms|accept|priceNote|progNote|orgNote)$/.test(k) ? pbStripped(el) : el.textContent.trim();
          if ((d.quote || {})[k] === v) return;
          window._tnQuoteSet(k, v);
          return;
        }
        var list = el.getAttribute('data-ql'), i = +el.getAttribute('data-qi'), f = el.getAttribute('data-qf');
        var t = el.textContent.trim();
        var arr = d[list]; if (!arr || arr[i] == null) return;
        var cur = f ? arr[i][f] : arr[i];
        if (cur === t) return;
        window._tnSet(list, i, f, t, true);
        // the cards above show the same words: redraw them, not the page under the caret
        var y = window.scrollY; var host = document.getElementById('tnDocHost');
        if (host && !host.contains(document.activeElement)) { hostFill(host); window.scrollTo(0, y); }
      });
      el.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !el.hasAttribute('data-qk')) { e.preventDefault(); el.blur(); } });
    });
    pg.addEventListener('focusout', function(){ clearTimeout(_pbT); _pbT = setTimeout(function(){ if (!pg.contains(document.activeElement)) pageBreaks(); }, 250); });
    pageBreaks();
    if (!_pbFonts && document.fonts && document.fonts.ready) { _pbFonts = 1; document.fonts.ready.then(function(){ pageBreaks(); }); }
    navSpy();
    document.querySelectorAll('#tnDocHost textarea').forEach(function(t){ if (t.id !== 'tnChatIn') { t.style.height = 'auto'; t.style.height = Math.max(34, t.scrollHeight) + 'px'; } });
    var log = document.getElementById('tnChatLog'); if (log) log.scrollTop = log.scrollHeight;
  }

  // ── where the PDF's pages will break, drawn on the page as dashed lines ──
  // The page is copied into a hidden frame exactly as the PDF copies it (the
  // tender's own styles, none of the app's, every box opened) at the PDF's
  // width — A4 less the 13 mm margins — and walked block by block as Chrome
  // paginates: a section kept whole stays whole, a heading keeps its first
  // line. The lines then go on the live page against the same elements.
  // the app's own fonts, in the app's order (Google's Inter, then rsms.me's,
  // which wins), so the PDF wraps every line where the screen does
  var PDF_FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"><style>@import url("https://rsms.me/inter/inter.css");</style>';
  // THE PDF IS LAID OUT 794px WIDE AND PRINTED AT 87.5% (2026-10-28). The
  // sheet's content is 794px, A4's printable width is 184 mm = 695px, so
  // Chrome shrank it to fit — and the app, laying it out at 695px, wrapped
  // lines sooner and broke every page early (the owner: "the page break on
  // the app is too high"). Now it is explicit everywhere: the content is laid
  // out at PB_W and drawn at PB_K, on screen (the sheet's own scale) and on
  // paper (zoom), so a page holds PB_H of it.
  var PB_K = 695 / 794, PB_W = 794, PB_H = 1016 / PB_K, _pbT = null, _pbFonts = 0, _pbGen = 0, _pbFrame = null;
  function pbStripped(el){
    if (!el.querySelector('.tq-pb')) return el.innerHTML;
    var c = el.cloneNode(true); c.querySelectorAll('.tq-pb').forEach(function(n){ n.remove(); }); return c.innerHTML;
  }
  function pbLeaves(el, out){
    var kids = el.children;
    if (el.matches('li,tr,p,h1,h2,h3,.tq-g,.tq-org,.tq-orgask,.tq-head,.tq-foot,.tq-title') || !kids.length) { out.push(el); return; }
    for (var i = 0; i < kids.length; i++) pbLeaves(kids[i], out);
  }
  // every element of the page the PDF keeps, in order: the same list in the
  // live page and in its printed copy, so an index in one is the other's
  function pbKept(root){
    var out = [];
    (function walk(el){ for (var i = 0; i < el.children.length; i++) { var k = el.children[i]; if (k.classList.contains('no-print')) continue; out.push(k); walk(k); } })(root);
    return out;
  }
  function pbPrintHtml(pg, extra){
    var clone = pg.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach(function(n){ n.remove(); });
    clone.querySelectorAll('[contenteditable]').forEach(function(n){ n.removeAttribute('contenteditable'); });
    var css = document.getElementById('tenderCss');
    return { clone: clone, css: (css ? css.textContent : '') };
  }
  function pageBreaks(){
    var pg = document.getElementById('tqPage'); if (!pg) return;
    pg.querySelectorAll('.tq-pb').forEach(function(n){ n.remove(); });
    if (!pg.offsetParent) return;
    var gen = ++_pbGen;
    var pc = pbPrintHtml(pg);
    // Measured in this page, in the fonts this page has loaded, on a copy at
    // the PDF's width — the PDF loads the same fonts (PDF_FONTS), so the
    // breaks drawn here are the PDF's (2026-10-28, the owner: "the page break
    // on the app is too high"; an iframe of its own measured before its font
    // had arrived, and the app's Inter is not Google's).
    if (!_pbFrame || !_pbFrame.isConnected) {
      _pbFrame = document.createElement('div');
      _pbFrame.id = 'tqMeasure'; _pbFrame.setAttribute('aria-hidden', 'true');
      _pbFrame.style.cssText = 'position:absolute;left:-30000px;top:0;width:' + PB_W + 'px;visibility:hidden;pointer-events:none;contain:layout';
      document.body.appendChild(_pbFrame);
    }
    pc.clone.removeAttribute('id'); pc.clone.querySelectorAll('[id]').forEach(function(n){ n.removeAttribute('id'); });
    _pbFrame.innerHTML = '';
    _pbFrame.appendChild(pc.clone);
    var measure = function(){
      if (gen !== _pbGen) return;
      var cp = _pbFrame.querySelector('.tq-page'); if (!cp) return;
      var live = pbKept(pg), copy = pbKept(cp);
      if (live.length !== copy.length) return;   // changed under us; the next pass will do it
      var ix = new Map(); copy.forEach(function(el, i){ ix.set(el, i); });
      var top0 = cp.getBoundingClientRect().top, blocks = [];
      var add = function(el, a, b){ var r1 = a.getBoundingClientRect(), r2 = (b || a).getBoundingClientRect(); if (r2.bottom - r1.top > 0) blocks.push({ el: el, end: b || a, top: r1.top - top0, bot: r2.bottom - top0 }); };
      Array.prototype.forEach.call(cp.children, function(ch){
        if (!ch.classList.contains('tq-sec')) { add(ch, ch); return; }
        if (ch.classList.contains('tq-keep') && ch.getBoundingClientRect().height <= PB_H) { add(ch, ch); return; }
        var h2 = ch.querySelector('h2'), leaves = [], box = ch.querySelector('.tq-body');
        if (box) pbLeaves(box, leaves);
        if (h2) add(ch, h2, leaves[0] || h2);
        leaves.slice(h2 ? 1 : 0).forEach(function(l){ add(l, l); });
      });
      // where each sheet ends: how much of it the content fills, and the
      // element that content ends on
      var pageTop = 0, page = 1, marks = [], prev = null;
      blocks.forEach(function(b){
        if (b.bot - pageTop > PB_H && b.top > pageTop + 1 && prev) { marks.push({ el: b.el, page: page + 1, used: prev.bot - pageTop, endEl: prev.end }); page++; pageTop = b.top; }
        while (b.bot - pageTop > PB_H) { pageTop += PB_H; page++; }
        prev = b;
      });
      var lastUsed = prev ? prev.bot - pageTop : 0, lastEnd = prev && prev.end;
      pg.querySelectorAll('.tq-pb').forEach(function(n){ n.remove(); });
      // On a computer the page is laid out at the PDF's own width, so each
      // sheet is drawn to A4's height: the content, white to the foot of the
      // sheet, a gap, the next sheet's top margin. On a phone the width is
      // not the PDF's, so only the gap is drawn.
      var sc = pageFitScale(), pgR = pg.getBoundingClientRect(), cs = getComputedStyle(pg);
      var exact = Math.abs(pgR.width / sc - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - PB_W) < 6;
      var padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
      var liveOf = function(cel){ var i = ix.get(cel); return i == null ? null : live[i]; };
      var startY = pgR.top + padT * sc;
      marks.forEach(function(m){
        var el = liveOf(m.el); if (!el || !el.parentNode) return;
        if (el.tagName === 'TR') el = el.closest('table') || el;
        var mk = document.createElement(el.tagName === 'LI' ? 'li' : 'div');
        mk.className = 'tq-pb no-print'; mk.setAttribute('contenteditable', 'false'); mk.setAttribute('data-page', m.page);
        mk.innerHTML = '<div class="tq-pb-f"></div><div class="tq-pb-g"><span>Page ' + m.page + '</span></div><div class="tq-pb-t"></div>';
        el.parentNode.insertBefore(mk, el);
        var r = mk.getBoundingClientRect();
        mk.style.marginLeft = ((pgR.left - r.left) / sc) + 'px'; mk.style.width = (pgR.width / sc) + 'px';
        // the sheet is filled out to A4's height from where it starts on
        // screen, not from the copy's figure: the live page carries the
        // editing buttons the PDF leaves out, so its content runs a little
        // longer, and the sheets must still be drawn one height
        var fill = exact ? Math.max(0, PB_H - (mk.getBoundingClientRect().top - startY) / sc) : 0;
        mk.querySelector('.tq-pb-f').style.height = (exact ? fill + padB : 14) + 'px';
        mk.querySelector('.tq-pb-t').style.height = (exact ? padT : 14) + 'px';
        startY = mk.getBoundingClientRect().bottom;
      });
      if (exact && lastEnd) {   // the last sheet is a whole sheet too
        var tail = document.createElement('div'); tail.className = 'tq-pb tq-pb-end no-print';
        pg.appendChild(tail);
        tail.style.height = Math.max(0, PB_H - (tail.getBoundingClientRect().top - startY) / sc) + 'px';
      }
      pageFit();
      var n = document.getElementById('tqPages'); if (n) n.textContent = 'A4 PDF: ' + page + (page === 1 ? ' page' : ' pages') + ' · ';
      pg.setAttribute('data-pages', page);
    };
    var done = false, once = function(){ if (done) return; done = true; measure(); };
    try { if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ setTimeout(once, 0); }); setTimeout(once, 1500); return; } } catch (e) {}
    setTimeout(once, 0);
  }

  // The PDF: the page above, alone, through the browser's own Save as PDF —
  // real text, real page breaks, nothing re-drawn as a picture.
  window._tnPdf = function(){
    var pg = document.getElementById('tqPage'); if (!pg) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var clone = pg.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach(function(n){ n.remove(); });
    clone.querySelectorAll('[contenteditable]').forEach(function(n){ n.removeAttribute('contenteditable'); });
    var css = document.getElementById('tenderCss');
    var dc = T.data.doc || {}, p = dc.project || {}, bz = brand();
    // The file is named for the job and the business: Chrome takes the name
    // from the printed page's title (2026-10-27, the owner).
    var proj = String(qText(dc, 'm_project', p.name || T.data.name || '') || '').replace(/<[^>]*>/g, '').trim() || 'Tender';
    var title = [proj, bz.company_name || ''].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    var w = f.contentWindow, dd = w.document;
    dd.open();
    // print-color-adjust: Chrome leaves out every background when printing
    // unless told otherwise — the navy section bands and the programme's bars
    // were simply missing from the PDF (2026-10-27, the owner: "the pdf
    // doesn't look as good as the app").
    dd.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      PDF_FONTS + '<style>' + (css ? css.textContent : '') + '.tq-page{width:794px!important;zoom:' + PB_K.toFixed(5) + '}' +
      '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
      '@page{size:A4;margin:14mm 13mm}body{margin:0;background:#fff;font-family:Inter,Segoe UI,Arial,sans-serif}.tq-org,.tq-sec h2,.tq-sec.tq-keep{break-inside:avoid}.tq-ob{break-inside:avoid}.tq-page{box-shadow:none!important;border:none!important;margin:0!important;padding:0!important;max-width:none!important}.tq-sec{break-inside:auto}.tq-sec h2{break-after:avoid}.tq-tbl tr,.tq-g,.tq-price tr{break-inside:avoid}</style></head><body>' + clone.outerHTML + '</body></html>');
    dd.close();
    var go = function(){ var was = document.title; document.title = title; try { w.focus(); w.print(); } catch (e) {} setTimeout(function(){ document.title = was; }, 1500); setTimeout(function(){ f.remove(); }, 60000); };
    var started = false; var go1 = function(){ if (started) return; started = true; go(); };
    // Wait for the font as well as the logo, or the PDF prints in the fallback face.
    // the stylesheets first, then every weight the tender uses, so nothing
    // prints in a stand-in face
    var whenFonts = function(cb){ try { if (dd.fonts && dd.fonts.load) { var t = setTimeout(cb, 4000), fin = function(){ clearTimeout(t); cb(); }; var links = [].slice.call(dd.querySelectorAll('link[rel=stylesheet]')), n = links.length; var loadAll = function(){ Promise.all(['400', '500', '600', '700', '800'].map(function(wt){ return dd.fonts.load(wt + ' 12.5px Inter').catch(function(){}); })).then(function(){ return dd.fonts.ready; }).then(fin, fin); }; if (!n) { loadAll(); return; } links.forEach(function(l){ if (l.sheet) { if (--n === 0) loadAll(); } else l.onload = l.onerror = function(){ if (--n === 0) loadAll(); }; }); return; } } catch (e) {} cb(); };
    var go0 = go; go = function(){ whenFonts(function(){ go0(); }); };
    var imgs = dd.images; var left = imgs.length;
    if (!left) setTimeout(go1, 150);
    else Array.prototype.forEach.call(imgs, function(im){ if (im.complete) { if (--left === 0) setTimeout(go1, 150); } else im.onload = im.onerror = function(){ if (--left === 0) setTimeout(go1, 150); }; });
  };

  // ── the tender's css, added to the tab's own sheet (the PDF copies it) ──
  (function(){
    var st = document.getElementById('tenderCss'); if (!st || st.__doc) return; st.__doc = 1;
    st.textContent += '\n' + [
      '.tn-pill.drafted{background:#dbeafe;color:#1e3a8a}',
      '.tn-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}',
      '.tn-sum>div{background:#fff;border:1px solid #dbe3ec;border-radius:12px;padding:12px 14px;min-width:0}',
      '.tn-sum small{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;font-weight:700}',
      '.tn-sum b{display:block;font-size:18px;color:#0a1628;margin-top:2px;overflow:hidden;text-overflow:ellipsis}.tn-sum b em{font-style:normal;font-size:12px;color:#64748b;font-weight:600}',
      '.tn-sum span{display:block;font-size:12px;color:#64748b;margin-top:2px}',
      '.tn-bar2{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.tn-saved{margin-right:auto;font-size:12.5px;color:#64748b}',
      '.tn-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '.tn-tbl td.r,.tn-tbl th.r,.tn-tbl input.r{text-align:right}.tn-tbl .nw,.nw{white-space:nowrap}',
      '.tn-tbl input.wide{width:100%;min-width:200px}.tn-tbl input.mid{width:110px}.tn-tbl input.sm{width:78px}.tn-tbl input.xs{width:48px}',
      '.tn-tbl tr.off td{opacity:.45;text-decoration:line-through}.tn-tbl tr.off td:last-child{opacity:1;text-decoration:none}',
      '.tn-tbl tr.tot td{font-weight:800;border-top:2px solid #e2e8f0;background:#f8fafc}',
      '.tn-spec select{min-width:118px}',
      '.tn-from{font-size:11.5px;color:#64748b;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help}',
      '.tn-x{border:none;background:none;color:#64748b;cursor:pointer;font-size:14px;padding:2px 5px;border-radius:5px;font-family:inherit}.tn-x:hover{background:#f1f5f9;color:#0a1628}',
      '.tn-add{margin-top:10px}',
      '.tn-ai-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
      '.tn-list{list-style:none;margin:0;padding:0;counter-reset:tn}ol.tn-list li::before{counter-increment:tn;content:counter(tn) ".";font-weight:700;color:#64748b;min-width:22px;padding-top:7px;font-size:13px}',
      '.tn-list li{display:flex;gap:6px;align-items:flex-start;padding:4px 0}',
      '.tn-list textarea,.tn-list input{flex:1;font:inherit;font-size:13.5px;line-height:1.4;padding:6px 8px;border:1px solid #e2e8f0;border-radius:7px;resize:none;min-height:34px;width:100%;box-sizing:border-box;background:#fff}',
      '.tn-list textarea:focus,.tn-list input:focus{border-color:#0099cc;outline:none}',
      '.tn-list input.sm{flex:0 0 110px;text-align:right}',
      '.tn-tools{display:flex;flex:0 0 auto;padding-top:4px}',
      '.tn-why{font-size:11.5px;color:#64748b;margin:3px 2px 0}',
      '.tn-chat{margin-top:16px;border:1px solid #c7d2fe;background:#f5f7ff;border-radius:12px;padding:12px}',
      '.tn-chat-hd{font-weight:800;color:#312e81;font-size:13px;margin-bottom:8px}',
      '.tn-chat-log{max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px}',
      '.tn-msg{padding:7px 10px;border-radius:10px;font-size:13px;max-width:85%;white-space:pre-wrap}.tn-msg.you{align-self:flex-end;background:#0099cc;color:#fff}',
      '.tn-msg.ai{align-self:flex-start;background:#fff;border:1px solid #dbe3ec;color:#0a1628}.tn-msg.err{border-color:#fecaca;color:#991b1b}',
      '.tn-chat-in{display:flex;gap:8px;align-items:flex-end}.tn-chat-in textarea{flex:1;font:inherit;font-size:13.5px;padding:8px;border:1px solid #c7d2fe;border-radius:8px;resize:vertical}',
      '.tn-rates{display:flex;flex-wrap:wrap;gap:10px 16px;margin-bottom:12px}',
      '.tn-rates label{display:flex;flex-direction:column;font-size:11px;color:#64748b;font-weight:700;letter-spacing:.03em;text-transform:uppercase;gap:3px}',
      '.tn-rates label span{display:flex;align-items:center;gap:3px;text-transform:none;font-weight:600;color:#475569;font-size:12px}',
      '.tn-rates input,.tn-rates select{font:inherit;font-size:13px;width:84px;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;text-align:right}.tn-rates select{width:auto;text-align:left}',
      '.tn-h4{margin:16px 0 8px;font-size:13px;color:#0a1628;font-weight:800}',
      '.tn-badge{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 8px;white-space:nowrap}',
      '.tn-badge.pb{background:#dcfce7;color:#166534}.tn-badge.est{background:#fef3c7;color:#92400e}.tn-badge.you{background:#ede9fe;color:#5b21b6}',
      '.tn-totals{margin:16px 0 0 auto;border-collapse:collapse;font-size:13.5px;min-width:300px}.tn-totals td{padding:5px 8px}.tn-totals td:last-child{text-align:right;white-space:nowrap}',
      '.tn-totals tr.b td{font-weight:800;border-top:1px solid #e2e8f0}.tn-totals tr.gp td{color:#166534;font-weight:700;font-size:12.5px}',
      '.tn-gantt{display:flex;flex-direction:column;gap:6px}',
      '.tn-g-row{display:grid;grid-template-columns:minmax(150px,240px) 170px 1fr auto;gap:8px;align-items:center}',
      '.tn-g-row input{font:inherit;font-size:13px;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box}.tn-g-row input.wide{width:100%}.tn-g-row input.xs{width:46px;text-align:right}',
      '.tn-g-num{font-size:12px;color:#64748b;white-space:nowrap}',
      '.tn-g-track,.tq-g-t{position:relative;height:16px;background:#f1f5f9;border-radius:5px}.tn-g-track i,.tq-g-t i{position:absolute;top:0;bottom:0;background:#0099cc;border-radius:5px}',
      '.tn-chk{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#334155}',
      '.tn-fold>summary{cursor:pointer;list-style:none}.tn-fold>summary::-webkit-details-marker{display:none}.tn-fold>summary .tn-card-hd::after{content:"▾";margin-left:8px}',
      '.tn-fold:not([open])>summary .tn-card-hd::after{content:"▸"}',
      '.tn-next{padding:16px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13.5px;color:#1e3a8a}',
      // the document
      '.tq-wrap{background:#e2e8f0;padding:18px;border-radius:10px;overflow:hidden;box-sizing:border-box}',
      '.tq-page{background:#fff;width:906px;max-width:906px;margin:0 auto;padding:61px 56px;box-shadow:0 2px 14px rgba(15,23,42,.14);font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:12.5px;line-height:1.5;box-sizing:border-box}',
      '.tq-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #0a1628;padding-bottom:14px;margin-bottom:18px}',
      '.tq-logo{max-height:70px;max-width:230px;object-fit:contain}.tq-co{font-size:20px;font-weight:800;color:#0a1628}.tq-cod{text-align:right;font-size:11px;color:#475569;line-height:1.5}',
      '.tq-title{font-size:26px;margin:0 0 12px;color:#0a1628;font-weight:800}',
      '.tq-meta{border-collapse:collapse;margin-bottom:18px;font-size:12px}.tq-meta td{padding:3px 14px 3px 0;vertical-align:top}.tq-meta td:first-child{color:#64748b;font-weight:700;white-space:nowrap;width:90px}',
      '.tq-sec{margin-bottom:16px}.tq-sec h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:#0a1628;padding:6px 10px;margin:0 0 8px;border-radius:3px;display:flex;align-items:center;gap:8px}',
      '.tq-sec h2 i{font-weight:400;text-transform:none;opacity:.7}.tq-hidden{opacity:.55}',
      '.tq-tools{margin-left:auto;display:flex;gap:4px}.tq-tools button{font:inherit;font-size:10.5px;letter-spacing:0;text-transform:none;background:rgba(255,255,255,.14);color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer}',
      '.tq-tbl{width:100%;border-collapse:collapse}.tq-tbl th{text-align:left;font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:1.5px solid #cbd5e1;padding:4px 6px}',
      '.tq-tbl td{padding:5px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top}.tq-tbl td:first-child{white-space:nowrap;color:#475569;font-weight:600;width:110px}',
      '.tq-tbl .r{text-align:right}.tq-sub{color:#64748b;font-size:11px}',
      '.tq-ul{margin:0;padding-left:18px}.tq-ul li{margin:2px 0}',
      '.tq-price{border-collapse:collapse;margin:0 0 8px auto;min-width:320px}.tq-price td{padding:4px 8px}.tq-price td:last-child{text-align:right;white-space:nowrap}',
      '.tq-price tr.b td{font-weight:800;border-top:1.5px solid #0a1628}',
      '.tq-g{display:grid;grid-template-columns:200px 60px 1fr;gap:8px;align-items:center;margin:3px 0}.tq-g-d{color:#64748b;font-size:11px}.tq-g-t{height:12px}',
      '.tq-foot{margin-top:24px;border-top:1px solid #cbd5e1;padding-top:8px;font-size:10.5px;color:#64748b;text-align:center}',
      '.tq-ed{outline:none;border-radius:3px}.tq-ed:hover{box-shadow:0 0 0 1px #93c5fd}.tq-ed:focus{box-shadow:0 0 0 2px #0099cc;background:#f0f9ff}',
      '.tq-sec h2 .tq-ed:focus{background:transparent}.tq-ed p{margin:0 0 6px}.tq-ed ul{margin:0;padding-left:18px}',
      '@media screen and (max-width:760px){.tn-sum{grid-template-columns:1fr 1fr}.tn-g-row{grid-template-columns:1fr auto}.tn-g-track{grid-column:1/-1}.tq-page{padding:22px 18px;width:auto}.tq-g{grid-template-columns:1fr 50px}.tq-g-t{grid-column:1/-1}.tq-wrap{padding:6px}}',
      // the menu down the left
      // The page uses the screen (2026-10-28, the owner: "there's plenty of
      // screen to use, but it's only sort of in the middle").
      'body[data-tab="tender"] .content{max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:12px!important;padding-right:12px!important}',
      '#tenderRoot{max-width:none!important;margin:0!important;padding-left:6px!important;padding-right:6px!important}',
      // menu far left | the tender, full width | the A.I. chat on the right
      // (2026-10-28, the owner); the 44px on the right keeps the PLANS tab clear
      '.tn-lay{display:grid;grid-template-columns:340px minmax(0,1fr);gap:18px;align-items:start;padding-right:44px}.tn-main{padding-bottom:40vh;min-width:0}',
      '.tn-lay.tn-3{grid-template-columns:240px minmax(0,1fr) 340px;gap:16px}',
      // a narrow window on a computer (the owner's, half the screen beside the PDF):
      // the menu becomes a strip of jump links over the tender and the chat a bar
      // along the foot, as on a phone, so the sheet keeps a readable width
      '.tn-lay.tn-1{grid-template-columns:minmax(0,1fr);gap:10px;padding-right:44px}.tn-lay.tn-1 > .tn-side{z-index:5;max-height:none;height:auto!important;display:block}.tn-lay.tn-1 .tn-chatside .tn-chat{position:fixed;right:150px;bottom:8px;z-index:6;padding:8px;min-height:0;display:block;box-shadow:0 6px 24px rgba(15,23,42,.25)}.tn-lay.tn-1 .tn-side > .tn-chatside{min-height:0;display:block}.tn-lay.tn-1 .tn-chatside .tn-chat-hd{margin-bottom:4px}.tn-lay.tn-1 .tn-chatside .tn-chat-log{max-height:120px}.tn-lay.tn-1 .tn-chatside .tn-chat .tn-chat-nt{display:none}.tn-lay.tn-1 .tn-chatside .tn-chat:not(:focus-within) .tn-chat-log{display:none}.tn-lay.tn-1 .tn-chatside #tnChatIn{height:38px!important;min-height:0!important;resize:none}.tn-lay.tn-1 .tn-nav{display:flex;align-items:center;min-height:0;gap:4px;overflow-x:auto;overflow-y:hidden;max-height:none;padding:6px;border-radius:10px}.tn-lay.tn-1 .tn-nav-g{display:none}.tn-lay.tn-1 .tn-nav-i{white-space:nowrap;flex:0 0 auto}.tn-lay.tn-1 .tn-nav-i.sub{padding-left:10px}',
      '@media screen and (min-width:1900px){.tn-lay.tn-3{grid-template-columns:270px minmax(0,1fr) 380px}}',
      '.tn-lay.tn-3 > .tn-chatside .tn-chat{height:100%;box-sizing:border-box}',
      // the chat back under the menu: it takes what the menu leaves
      '.tn-side > .tn-chatside{position:static;height:auto;flex:1 1 auto;min-height:240px;display:flex;flex-direction:column}.tn-side > .tn-chatside .tn-chat{flex:1 1 auto}',
      '.tn-lay:not(.tn-3) .tn-nav{max-height:46%}',
      // Pinned from the top of the page, so it never slides before it sticks;
      // the menu takes what it needs (scrolling past about half the screen)
      // and the chat runs to the bottom of the screen.
      '.tn-side{position:sticky;top:52px;height:calc(100vh - 62px);display:flex;flex-direction:column;gap:10px}',
      '.tn-nav{flex:1 1 auto;min-height:80px;overflow-y:auto;background:#fff;border:1px solid #dbe3ec;border-radius:12px;padding:8px}',
      '.tn-chatside .tn-chat{flex:1 1 auto;min-height:240px;margin:0;padding:12px;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(49,46,129,.08)}.tn-chatside .tn-chat-log{flex:1 1 auto;max-height:none;min-height:60px;overflow-y:auto}.tn-chatside .tn-chat .tn-chat-nt{display:block}',
      '.tn-chatside #tnChatIn{display:block;flex:0 0 auto;width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;padding:8px 10px;border:1px solid #c7d2fe;border-radius:8px;resize:vertical;margin-bottom:6px;height:96px}',
      '.tn-tagout{flex:0 0 auto;align-self:center;font:inherit;font-size:11px;font-weight:700;color:#b45309;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:3px 8px;cursor:pointer;white-space:nowrap}.tn-tagout:hover{background:#ffedd5}.tn-tagout:disabled{opacity:.5;cursor:default}',
      '.tn-msg-src{display:block;margin-top:4px;font-size:11px;color:#64748b}',
      '.tn-chatside .tn-chat-in{align-items:center}.tn-chatside .tn-chat-in .tn-edit-msg{flex:1 1 auto;font-size:11.5px}.tn-side .tn-msg{max-width:92%;font-size:12.5px}',
      '.tn-nav-g{margin:8px 0 4px;padding:5px 8px;border-radius:6px;background:#0a1628;color:#fff;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.tn-nav-g:first-child{margin-top:0}',
      '.tn-nav-i{display:block;padding:6px 10px;border-radius:7px;font-size:13px;color:#334155;text-decoration:none;line-height:1.3}.tn-nav-i:hover{background:#f1f5f9;color:#0a1628}',
      '.tn-nav-i.sub{padding-left:20px;font-size:12.5px}.tn-nav-i.off{color:#94a3b8;text-decoration:line-through}',
      '.tn-nav-i.on{background:#0099cc;color:#fff;font-weight:700}',
      '.tn-anchor,.tq-sec,#tnPlanSet,#tnSheetIdx{scroll-margin-top:64px}',
      '@media screen and (max-width:900px){.tn-anchor,.tq-sec,#tnPlanSet,#tnSheetIdx{scroll-margin-top:118px}.tn-lay{grid-template-columns:minmax(0,1fr);padding-right:0}.tn-side{top:56px;z-index:5;max-height:none;height:auto;display:block}.tn-chatside .tn-chat{position:fixed;left:8px;right:76px;bottom:8px;z-index:6;padding:8px;min-height:0;display:block;box-shadow:0 6px 24px rgba(15,23,42,.25)}.tn-chatside .tn-chat-hd{margin-bottom:4px}.tn-chatside .tn-chat-log{max-height:90px}.tn-chatside .tn-chat .tn-chat-nt{display:none}.tn-chatside .tn-chat:not(:focus-within) .tn-chat-log{display:none}.tn-chatside #tnChatIn{height:38px;min-height:0}.tq-sec h2{flex-wrap:wrap}.tq-tools{flex-wrap:wrap}.tn-nav{display:flex;align-items:center;min-height:0;gap:4px;overflow-x:auto;overflow-y:hidden;max-height:none;padding:6px;border-radius:10px;-webkit-overflow-scrolling:touch}.tn-nav-g{display:none}.tn-nav-i{white-space:nowrap;flex:0 0 auto}.tn-nav-i.sub{padding-left:10px}}',
      // the section boxes: one height for all, scrolling inside; print shows everything
      '@media screen{.tn-card .tn-box.mid{height:540px}.tq-sec .tn-box.mid{height:172px}.tn-box.mid{height:540px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;box-shadow:inset 0 -10px 10px -10px rgba(15,23,42,.18);padding-right:4px}.tn-box.min{display:none}',
      '}',
      '@media screen{.tn-card-bd:has(>.tn-box.min){display:none}}',
      '.tn-bxs{display:inline-flex;gap:4px;flex:0 0 auto}.tn-bx{font:inherit;font-size:10.5px;font-weight:700;letter-spacing:0;text-transform:none;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:5px;padding:2px 7px;cursor:pointer;white-space:nowrap}.tn-bx:hover{background:rgba(255,255,255,.3)}',
      // the gap between two A4 sheets on the document
      '.tq-pb{list-style:none;display:block;margin-top:0;margin-bottom:0;box-sizing:border-box;user-select:none}.tq-pb-f,.tq-pb-t{background:#fff}',
      '.tq-pb-g{height:26px;background:#e2e8f0;margin:0 -16px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 6px 8px -6px rgba(15,23,42,.25),inset 0 -6px 8px -6px rgba(15,23,42,.25)}.tq-pb-g span{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b}',
      '#tqPages{font-weight:700;color:#fca5a5}',
      // the copy the page breaks are measured on: the PDF's own box
      '#tqMeasure .tq-page{box-shadow:none!important;border:none!important;margin:0!important;padding:0!important;max-width:none!important;width:794px!important;transform:none!important}#tqMeasure .tn-box{height:auto!important;overflow:visible!important;display:block!important;box-shadow:none!important;padding:0!important}',
      // Edit [section]
      '.tn-edit{font:inherit;font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;background:#0099cc;color:#fff;border:none;border-radius:6px;padding:4px 9px;cursor:pointer;white-space:nowrap}.tn-edit:hover{background:#0087b4}',
      '.tq-tools .tq-edit{background:#0099cc;font-weight:700}',
      '.tn-modal{position:fixed;inset:0;background:rgba(10,22,40,.45);display:none;align-items:center;justify-content:center;z-index:10060;padding:16px}.tn-modal.open{display:flex}',
      '.tn-modal-card{background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:100%;max-width:560px;padding:16px 18px;font-family:Inter,Segoe UI,Arial,sans-serif}',
      '.tn-modal-hd{display:flex;align-items:center;margin-bottom:8px}.tn-modal-hd b{font-size:16px;color:#0a1628;margin-right:auto}',
      '.tn-modal-lbl{display:block;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:4px}',
      '#tnEditIn{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:10px;border:1px solid #cbd5e1;border-radius:9px;resize:vertical;min-height:96px}#tnEditIn:focus{border-color:#0099cc;outline:none}',
      '.tn-modal-ft{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.tn-edit-msg{margin-right:auto;font-size:12.5px;color:#475569;flex:1 1 140px}',
      '.tn-mic.on{background:#fee2e2;border-color:#fca5a5;color:#991b1b}',
      '.tn-flash{animation:tnFlash 1.8s ease}@keyframes tnFlash{0%,40%{box-shadow:0 0 0 3px #0099cc;border-radius:8px}100%{box-shadow:0 0 0 0 transparent}}',
      // the organisation structure
      '.tq-orgask{margin:0 0 8px;padding:8px 10px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;font-size:12px}',
      '.tq-org{overflow-x:auto;padding:4px 0 2px}.tq-org ul{display:flex;justify-content:center;margin:0;padding:16px 0 0;position:relative}.tq-org>ul{padding-top:0}',
      '.tq-org li{list-style:none;text-align:center;position:relative;padding:16px 5px 0;flex:0 1 auto}',
      '.tq-org li::before,.tq-org li::after{content:"";position:absolute;top:0;right:50%;width:50%;height:16px;border-top:1.5px solid #94a3b8}',
      '.tq-org li::after{right:auto;left:50%;border-left:1.5px solid #94a3b8}',
      '.tq-org li:only-child::before,.tq-org li:only-child::after{display:none}.tq-org li:only-child{padding-top:0}',
      '.tq-org li:first-child::before,.tq-org li:last-child::after{border:0 none}',
      '.tq-org li:last-child::before{border-right:1.5px solid #94a3b8;border-radius:0 5px 0 0}.tq-org li:first-child::after{border-radius:5px 0 0 0}',
      '.tq-org ul ul::before{content:"";position:absolute;top:0;left:50%;height:16px;border-left:1.5px solid #94a3b8}',
      '.tq-org>ul>li::before,.tq-org>ul>li::after{display:none}.tq-org>ul>li{padding-top:0}',
      '.tq-ob{display:inline-flex;flex-direction:column;min-width:104px;max-width:150px;border:1.5px solid #0a1628;border-radius:7px;overflow:hidden;background:#fff;position:relative;vertical-align:top}',
      '.tq-ob b{display:block;background:#0a1628;color:#fff;font-size:10.5px;line-height:1.3;padding:5px 7px;letter-spacing:.02em}',
      '.tq-ob span{display:block;font-size:11.5px;font-weight:600;color:#0f172a;padding:4px 7px 0;min-height:15px}.tq-ob small{display:block;font-size:10px;color:#64748b;padding:1px 7px 5px;min-height:6px}',
      '@media screen{.tq-ob [contenteditable]:empty::before{content:attr(data-ph);color:#94a3b8;font-weight:400}}',
      '.tq-ob b.tq-ed:focus{background:#0099cc}',
      '.tq-ox{position:absolute;top:1px;right:1px;border:none;background:transparent;color:#cbd5e1;font-size:10px;cursor:pointer;padding:1px 3px;display:none}.tq-ob:hover .tq-ox{display:block}',
      '@media print{.no-print{display:none!important}}',
    ].join('\n');
  })();

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
          if (p.status === 'indexed' || p.status === 'drafted' || p.status === 'failed' || p.status === 'new') { clearInterval(T.poll); T.poll = null; await load(); render(); }
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
      if (r && r.maxMb) window.__tenderMaxMb = r.maxMb;
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
