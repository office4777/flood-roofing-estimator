// THE OFFICE MENUS (2026-11-13, the owner): a bar across the top — Jobs (the
// app as it was), Supplier Invoices, Job Costing, Financials, GPS Map — with
// Schedule, Settings and Request a Fix always in the left menu. ONLY for the
// logins the server lets in (GET /supinv/enabled; SUPINV_USERS on the server).
//
// A plain global script loaded after app.html's own (like tender.js): it reads
// api(), gotoTab and esc-free strings of its own, and app.html reaches it only
// through window._officeTabOpen(t), which gotoTab calls.
(function(){
  'use strict';
  var TABS = [
    { id: 'jobs', label: 'Jobs', tab: 'select' },
    { id: 'supinv', label: 'Supplier Invoices', tab: 'supinv' },
    { id: 'costing', label: 'Job Costing', tab: 'costing' },
    { id: 'finance', label: 'Financials', tab: 'finance' },
    { id: 'gps', label: 'GPS Map', tab: 'gps' },
  ];
  var OFFICE = { supinv: 1, costing: 1, finance: 1, gps: 1 };
  var KEEP = { schedule: 1, settings: 1, feedback: 1 };
  var O = { on: false, inv: [], xero: null, jobs: null, filter: 'todo', q: '', poll: null, addr: null, pnl: null, cq: '', cAll: false };
  function esc(v){ return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id){ return document.getElementById(id); }
  function money(v, dp){ if (v == null || !isFinite(+v)) return '—'; var n = +v;
    return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }); }
  function pct(v){ return (v == null || !isFinite(v)) ? '—' : (Math.round(v * 10) / 10) + '%'; }
  function dmy(s){ if (!s) return ''; var d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? String(s) : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function toast(m){ try { if (typeof _siteToast === 'function') return _siteToast(m); } catch (e) {} }
  function who(){ try { var u = JSON.parse(localStorage.getItem('fr_user') || 'null'); return (u && (u.id || u.email)) || ''; } catch (e) { return ''; } }

  // ── css ─────────────────────────────────────────────────────────
  (function(){
    if ($('officeCss')) return;
    var st = document.createElement('style'); st.id = 'officeCss';
    st.textContent = [
      // ONE BAR (2026-11-13, the owner: "put those buttons inside the top header menu, but make them smaller and
      // combine them ... I don't want to waste screen space"): the menu lives inside the fixed #globalTopBar, which
      // turns navy; the AI / chat / bell / tasks / to-do buttons sit small at its right.
      '#topMenu{display:none;gap:2px;flex:0 0 auto;white-space:nowrap}',
      'body.office-on #topMenu{display:flex}',
      '#topMenu button{background:none;border:0;color:#cbd5e1;font:inherit;font-size:13px;font-weight:700;padding:11px 12px 8px;cursor:pointer;border-bottom:3px solid transparent}',
      '#topMenu button:hover{color:#fff}',
      '#topMenu button.on{color:#fff;border-bottom-color:#0099e0}',
      'body.office-on .global-top-bar{background:#0a1628;border-bottom:0;padding:0 10px;gap:6px;box-shadow:0 2px 10px rgba(10,22,40,.25)}',
      'body.office-on .global-top-bar .gtb-btn{padding:4px 9px;font-size:11.5px;border-radius:7px;background:rgba(255,255,255,.08);color:#e2e8f0;border:1px solid rgba(255,255,255,.18);gap:4px}',
      'body.office-on .global-top-bar .gtb-btn:hover{background:rgba(255,255,255,.18);color:#fff}',
      'body.office-on .global-top-bar .gtb-btn.gtb-ai{background:linear-gradient(135deg,#7c3aed,#0369a1);border:0;color:#fff}',
      'body.office-on .global-top-bar .gtb-tools-gap{flex:1 1 auto}',
      'body.office-on .global-top-bar #gtbTasksBtn{margin-left:0!important}',
      'body.office-tabs .sidebar .nav-btn:not(#navScheduleBtn):not(#navSettingsBtn):not(#navFeedbackBtn):not(#navSignOutBtn){display:none!important}',
      'body.office-tabs #navJobBox{display:none!important}',
      '.of-wrap{max-width:1280px;margin:0 auto;padding:2px 0 40px}',
      '.of-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px}',
      '.of-hd h2{margin:0;font-size:20px;font-weight:800;color:#0a1628;flex:1 1 auto}',
      '.of-btn{border:1px solid #cbd5e1;background:#fff;color:#0a1628;border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
      '.of-btn:hover{border-color:#0099e0}',
      '.of-btn.pri{background:#0099e0;border-color:#0099e0;color:#fff}',
      '.of-btn.sm{padding:4px 9px;font-size:12px}',
      '.of-btn[disabled]{opacity:.5;cursor:default}',
      '.of-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin:0 0 14px}',
      '.of-card h3{margin:0 0 8px;font-size:14px;font-weight:800;color:#0a1628}',
      '.of-note{font-size:12.5px;color:#64748b;line-height:1.5}',
      '.of-addr{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 10px}',
      '.of-addr code{font-size:15px;font-weight:800;color:#0a1628;background:#e0f2fe;border:1px solid #9bd5f0;border-radius:8px;padding:6px 10px}',
      '.of-opts{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '@media (max-width:900px){.of-opts{grid-template-columns:1fr}}',
      '.of-opt{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc}',
      '.of-opt b{display:block;margin-bottom:6px;color:#0a1628}',
      '.of-opt ol{margin:6px 0 0 18px;padding:0;font-size:12.5px;color:#334155;line-height:1.55}',
      '.of-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px}',
      '.of-chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer;color:#334155}',
      '.of-chip.on{background:#0a1628;border-color:#0a1628;color:#fff}',
      '.of-search{flex:1 1 220px;max-width:340px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}',
      '.of-tbl{width:100%;border-collapse:collapse;font-size:13px;background:#fff}',
      '.of-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;padding:8px;border-bottom:2px solid #e2e8f0;white-space:nowrap}',
      '.of-tbl td{padding:8px;border-bottom:1px solid #eef2f6;vertical-align:middle}',
      '.of-tbl tr.click{cursor:pointer}.of-tbl tr.click:hover td{background:#f8fafc}',
      '.of-tbl .r{text-align:right;white-space:nowrap}',
      '.of-scroll{overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}',
      '.of-pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800}',
      '.of-pill.g{background:#dcfce7;color:#166534}.of-pill.a{background:#fef3c7;color:#92400e}.of-pill.r{background:#fee2e2;color:#991b1b}.of-pill.b{background:#e0f2fe;color:#075985}.of-pill.s{background:#f1f5f9;color:#475569}',
      '.of-assign{position:relative;min-width:230px}',
      '.of-assign input{width:100%;box-sizing:border-box;border:1px dashed #f59e0b;background:#fffbeb;border-radius:7px;padding:6px 8px;font:inherit;font-size:12.5px}',
      '.of-drop{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 30px rgba(10,22,40,.18);max-height:260px;overflow:auto}',
      '.of-drop div{padding:7px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid #f1f5f9}.of-drop div:hover{background:#e0f2fe}',
      '.of-drop small{display:block;color:#64748b}',
      '.of-job{font-size:12.5px}.of-job small{display:block;color:#64748b}',
      '.of-modal{position:fixed;inset:0;background:rgba(10,22,40,.5);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.of-box{background:#fff;border-radius:14px;width:min(760px,100%);max-height:92vh;overflow:auto;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
      '.of-box.wide{width:min(1100px,100%);height:92vh;display:flex;flex-direction:column;padding:12px}',
      '.of-box h3{margin:0 0 10px;font-size:17px;color:#0a1628}',
      '.of-kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:13px;margin:0 0 12px}.of-kv dt{color:#64748b}.of-kv dd{margin:0;font-weight:600;color:#0a1628}',
      '.of-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 14px}',
      '.of-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}.of-stat span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;font-weight:700}.of-stat b{font-size:20px;color:#0a1628}.of-stat small{display:block;color:#64748b;font-size:12px}',
      '.of-neg{color:#b91c1c}.of-pos{color:#15803d}',
      '.of-drag{border:2px dashed #9bd5f0;border-radius:12px;padding:12px;text-align:center;color:#075985;font-size:13px;margin:0 0 12px;background:#f0f9ff}',
      '.of-drag.over{background:#e0f2fe;border-color:#0099e0}',
    ].join('\n');
    document.head.appendChild(st);
  })();

  // ── the bar and the panels ─────────────────────────────────────
  function build(){
    var main = document.querySelector('main.content'); if (!main) return;
    if (!$('topMenu')) {
      var bar = document.createElement('nav'); bar.id = 'topMenu'; bar.setAttribute('aria-label', 'Office');
      bar.innerHTML = TABS.map(function(t){ return '<button type="button" data-top="' + t.id + '" onclick="_officeTop(\'' + t.id + '\')">' + esc(t.label) + '</button>'; }).join('');
      var host = $('globalTopBar');
      if (host) {
        host.insertBefore(bar, host.firstChild);
        var gap = document.createElement('span'); gap.className = 'gtb-tools-gap';
        host.insertBefore(gap, bar.nextSibling);
      } else main.insertBefore(bar, main.firstChild);
    }
    compactTools(true);
    ['supinv', 'costing', 'finance', 'gps'].forEach(function(t){
      if ($('tab-' + t)) return;
      var p = document.createElement('div'); p.className = 'panel'; p.id = 'tab-' + t;
      p.innerHTML = '<div class="of-wrap" id="' + t + 'Root"></div>';
      main.appendChild(p);
    });
  }
  // The bar's own buttons, short: the label shortened in place so every id,
  // onclick and badge span stays the one the rest of the app talks to.
  var SHORT = { gtbAi: '✨ AI', gtbChatBtn: '💬 Chat', gtbTasksBtn: '📋 Tasks', gtbTodoBtn: '📝 To do' };
  function compactTools(on){
    var bar = $('globalTopBar'); if (!bar) return;
    var ai = bar.querySelector('.gtb-ai'); if (ai && !ai.id) ai.id = 'gtbAi';
    Object.keys(SHORT).forEach(function(id){
      var b = $(id); if (!b) return;
      var tn = null; for (var i = 0; i < b.childNodes.length; i++) if (b.childNodes[i].nodeType === 3 && b.childNodes[i].nodeValue.trim()) { tn = b.childNodes[i]; break; }
      if (!tn) return;
      if (b._ofLong == null) b._ofLong = tn.nodeValue;
      tn.nodeValue = on ? SHORT[id] : b._ofLong;
    });
  }
  window._officeTop = function(id){
    var t = TABS.filter(function(x){ return x.id === id; })[0]; if (!t) return;
    try { gotoTab(t.tab); } catch (e) {}
  };
  function barSync(t){
    document.body.classList.toggle('office-tabs', !!(O.on && (OFFICE[t] || (KEEP[t] && document.body.classList.contains('office-tabs')))));
    var lit = OFFICE[t] ? t : (KEEP[t] ? '' : 'jobs');
    document.querySelectorAll('#topMenu button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-top') === lit); });
  }
  window._officeTabOpen = function(t){
    if (!O.on) return;
    barSync(t);
    if (t === 'supinv') openSupinv();
    else if (t === 'costing') openCosting();
    else if (t === 'finance') openFinance();
    else if (t === 'gps') openGps();
  };
  function setOn(on){
    O.on = !!on;
    if (on) build();
    document.body.classList.toggle('office-on', O.on);
    if (!O.on) { document.body.classList.remove('office-tabs'); compactTools(false); }
    else barSync(document.body.getAttribute('data-tab') || 'select');
  }
  var tries = 0;
  window._officeEnabledCheck = async function(){
    if (!localStorage.getItem('fr_token')) { if (++tries < 60) setTimeout(window._officeEnabledCheck, 3000); return; }
    try {
      var r = await api('GET', '/supinv/enabled');
      try { localStorage.setItem('fr_office_on', JSON.stringify({ who: who(), on: !!(r && r.enabled) })); } catch (e) {}
      setOn(r && r.enabled);
      if (r && r.enabled) xeroReturn();
    } catch (e) { if (++tries < 30) setTimeout(window._officeEnabledCheck, 5000); }
  };
  try { var kept = JSON.parse(localStorage.getItem('fr_office_on') || 'null'); if (kept && kept.on && kept.who === who()) setOn(true); } catch (e) {}
  setTimeout(window._officeEnabledCheck, 1500);
  // Back from Xero's sign-in: say how it went and show Financials.
  function xeroReturn(){
    var m = /[?&]xero=([a-z]+)/.exec(location.search); if (!m) return;
    var said = { connected: 'Xero connected.', cancelled: 'Xero was not connected (cancelled).', expired: 'The Xero sign-in took too long — try again.',
      noorg: 'That Xero login has no organisation.', failed: 'Xero could not be connected — try again.' }[m[1]] || '';
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (said) toast(said);
    setTimeout(function(){ try { gotoTab('finance'); } catch (e) {} }, 600);
  }

  // ══ SUPPLIER INVOICES ═══════════════════════════════════════════
  async function loadInv(){
    var r = await api('GET', '/supinv');
    O.inv = (r && r.invoices) || []; O.xero = (r && r.xero) || null;
  }
  async function loadJobs(force){
    if (O.jobs && !force) return O.jobs;
    var r = await api('GET', '/costing/jobs'); O.jobs = (r && r.jobs) || []; return O.jobs;
  }
  async function openSupinv(){
    var root = $('supinvRoot'); if (!root) return;
    if (!O.inv.length) root.innerHTML = '<div class="of-note">Loading supplier invoices…</div>';
    try {
      await Promise.all([loadInv(), loadJobs(), O.addr ? null : api('GET', '/supinv/address').then(function(a){ O.addr = a; })]);
      renderSupinv();
      pollIfReading();
    } catch (e) { root.innerHTML = '<div class="of-card">Could not load supplier invoices: ' + esc(e.message) + '</div>'; }
  }
  function pollIfReading(){
    if (O.poll) { clearTimeout(O.poll); O.poll = null; }
    if (!O.inv.some(function(x){ return x.status === 'reading'; })) return;
    O.poll = setTimeout(async function(){
      if (document.body.getAttribute('data-tab') !== 'supinv') return;
      try { await loadInv(); renderSupinv(); } catch (e) {}
      pollIfReading();
    }, 3000);
  }
  function invFilter(x){
    if (O.filter === 'todo' && (x.job_id || x.status === 'no-file')) return false;
    if (O.filter === 'assigned' && !x.job_id) return false;
    if (O.filter === 'xero' && (x.xero && x.xero.invoiceId)) return false;
    var q = O.q.trim().toLowerCase();
    if (!q) return true;
    return [x.supplier, x.inv_number, x.job_label, x.description, x.subject, x.from_addr, (x.refs || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function statusPill(x){
    if (x.status === 'reading') return '<span class="of-pill b">Reading…</span>';
    if (x.status === 'failed') return '<span class="of-pill r" title="' + esc(x.error) + '">Could not read</span>';
    if (x.status === 'no-file') return '<span class="of-pill s" title="' + esc(x.error) + '">No PDF</span>';
    if (x.kind === 'credit_note') return '<span class="of-pill a">Credit note</span>';
    if (x.kind === 'statement') return '<span class="of-pill s">Statement</span>';
    return '';
  }
  function renderSupinv(){
    var root = $('supinvRoot'); if (!root) return;
    var list = O.inv.filter(invFilter);
    var todo = O.inv.filter(function(x){ return !x.job_id && x.status !== 'no-file'; }).length;
    var x = O.xero || {};
    var a = O.addr || {};
    var setupOpen = !O.inv.length;
    root.innerHTML =
      '<div class="of-hd"><h2>Supplier invoices</h2>' +
        '<span class="of-note">' + (x.connected ? ('Xero: <b>' + esc(x.org) + '</b>') : '<a href="#" onclick="gotoTab(\'finance\');return false">Connect Xero</a>') + '</span>' +
        '<button class="of-btn" onclick="_ofSetupToggle()">How invoices get here</button>' +
        '<label class="of-btn pri" style="display:inline-block">Upload invoices<input type="file" multiple accept="application/pdf,image/*" style="display:none" onchange="_ofUpload(this.files);this.value=\'\'"></label></div>' +
      '<div class="of-card" id="ofSetup" style="display:' + (setupOpen ? 'block' : 'none') + '">' +
        '<h3>Your RoofMap invoice address</h3>' +
        '<div class="of-addr"><code id="ofAddr">' + esc(a.address || '…') + '</code><button class="of-btn sm" onclick="_ofCopy(\'ofAddr\')">Copy</button></div>' +
        (a.receiving === false ? '<div class="of-note" style="color:#92400e;margin-bottom:10px">Receiving is not switched on yet — invoices sent here will start arriving once it is. Upload them by hand in the meantime.</div>' : '') +
        '<div class="of-note" style="margin-bottom:10px">Anything emailed here lands in this tab: RoofMap reads the invoice, finds your job number (or the site address) on it and puts it on that job. Put your job number on every order so it comes back on the invoice.</div>' +
        '<div class="of-opts">' +
          '<div class="of-opt"><b>Option 1 — forward them from your own email</b><span class="of-note">Nothing changes for your suppliers. Set a rule that forwards their emails here:</span><ol>' +
            '<li><b>Gmail:</b> Settings → See all settings → Forwarding → add the address above and confirm it, then Filters → Create a filter → From: your suppliers\' addresses (e.g. <i>accounts@roofingindustries.co.nz OR invoices@steelandtube.co.nz</i>) → Forward it to this address.</li>' +
            '<li><b>Outlook / Microsoft 365:</b> Settings → Mail → Rules → Add new rule → From: the supplier → Forward to this address.</li>' +
            '<li><b>Anything else:</b> look for "rules", "filters" or "auto-forward" and point supplier mail here.</li></ol>' +
            '<div class="of-note" style="margin-top:6px">Gmail sends a confirmation code to the address — it arrives here as a "No PDF" email; open it to read the code.</div></div>' +
          '<div class="of-opt"><b>Option 2 — give your suppliers this address</b><span class="of-note">Ask each supplier to send invoices and statements here instead. A note to send them:</span>' +
            '<div id="ofNote" style="margin-top:8px;font-size:12.5px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;white-space:pre-wrap">Hi,\n\nPlease send all our invoices, credit notes and statements to ' + esc(a.address || '') + ' from now on, and quote our job number (our "your ref" / PO) on every invoice.\n\nThanks</div>' +
            '<button class="of-btn sm" style="margin-top:6px" onclick="_ofCopy(\'ofNote\')">Copy note</button>' +
            '<div class="of-note" style="margin-top:6px">If you still want a copy in Xero\'s own bill inbox, keep it there too — RoofMap sends the bill to Xero for you once it is on a job.</div></div>' +
        '</div></div>' +
      '<div class="of-drag" id="ofDrop">Drop supplier invoice PDFs or photos here</div>' +
      '<div class="of-chips">' +
        chip('todo', 'To assign' + (todo ? ' (' + todo + ')' : '')) + chip('assigned', 'On a job') + chip('xero', 'Not in Xero yet') + chip('all', 'All') +
        '<input class="of-search" id="ofQ" placeholder="Search supplier, invoice no, job…" value="' + esc(O.q) + '" oninput="_ofSearch(this.value)">' +
      '</div>' +
      '<div class="of-scroll"><table class="of-tbl"><thead><tr><th>Received</th><th>Supplier</th><th>Invoice</th><th class="r">Ex GST</th><th class="r">Total</th><th>Job</th><th>Xero</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(rowHtml).join('') : '<tr><td colspan="8" class="of-note" style="padding:18px">' +
        (O.inv.length ? 'Nothing here.' : 'No supplier invoices yet. Upload one, or forward one to your address above.') + '</td></tr>') +
      '</tbody></table></div>';
    wireDrop();
  }
  function chip(id, label){ return '<button class="of-chip' + (O.filter === id ? ' on' : '') + '" onclick="_ofFilter(\'' + id + '\')">' + esc(label) + '</button>'; }
  function rowHtml(x){
    var jobCell;
    if (x.job_id) jobCell = '<div class="of-job">' + esc(x.job_label || 'Job') + '<small>' + (x.alloc === 'auto' ? 'Auto · ' + esc(x.alloc_why) : esc(x.alloc_why || 'Assigned')) +
      ' · <a href="#" onclick="_ofAssignOpen(\'' + x.id + '\');return false">change</a></small></div>';
    else if (x.status === 'read' || x.status === 'failed' || x.status === 'reading') jobCell = assignBox(x);
    else jobCell = '<span class="of-note">—</span>';
    var xc = (x.xero && x.xero.invoiceId) ? '<span class="of-pill g" title="' + esc('Sent ' + dmy(x.xero.at) + (x.xero.attached ? ', PDF attached' : '')) + '">In Xero ✓</span>'
      : (x.status === 'read' ? '<button class="of-btn sm" onclick="event.stopPropagation();_ofXero(\'' + x.id + '\',this)">Send to Xero</button>' : '');
    return '<tr class="click" onclick="_ofSummary(\'' + x.id + '\')">' +
      '<td>' + esc(dmy(x.received_at)) + '<div class="of-note">' + esc(x.source === 'upload' ? 'Uploaded' : 'Emailed') + '</div></td>' +
      '<td><b>' + esc(x.supplier || (x.status === 'reading' ? '…' : (x.from_addr || '—'))) + '</b> ' + statusPill(x) + '<div class="of-note">' + esc((x.description || x.subject || '').slice(0, 70)) + '</div></td>' +
      '<td>' + esc(x.inv_number || '') + '<div class="of-note">' + esc(dmy(x.inv_date)) + '</div></td>' +
      '<td class="r">' + money(x.subtotal) + '</td><td class="r">' + money(x.total) + '</td>' +
      '<td onclick="event.stopPropagation()">' + jobCell + '</td><td onclick="event.stopPropagation()">' + xc + '</td>' +
      '<td class="r" onclick="event.stopPropagation()">' + (x.storage_path ? '<button class="of-btn sm" onclick="_ofPdf(\'' + x.id + '\')">PDF</button>' : '') + '</td></tr>';
  }
  function assignBox(x){
    return '<div class="of-assign"><input placeholder="Assign to a job — search number, name, address" onfocus="_ofAssignSearch(\'' + x.id + '\',this)" oninput="_ofAssignSearch(\'' + x.id + '\',this)">' +
      '<div class="of-drop" style="display:none"></div></div>';
  }
  function jobHits(q, sug){
    var jobs = O.jobs || [];
    q = String(q || '').trim().toLowerCase();
    var out = [];
    if (!q) { (sug || []).forEach(function(s){ out.push({ id: s.id, label: s.label, why: s.why }); }); }
    var dq = q.replace(/\D/g, '').replace(/^0+/, '');
    jobs.forEach(function(j){
      if (out.length >= 12) return;
      if (out.some(function(o){ return o.id === j.id; })) return;
      var hay = [j.no, j.client, j.addr].join(' ').toLowerCase();
      var hit = !q ? (out.length < 8) : (hay.indexOf(q) >= 0 || (dq.length >= 2 && String(j.no || '').replace(/\D/g, '').replace(/^0+/, '').indexOf(dq) === 0));
      if (hit) out.push({ id: j.id, label: [j.no, j.client, j.addr].filter(Boolean).join(' — ') });
    });
    return out;
  }
  window._ofAssignSearch = function(id, inp){
    var x = O.inv.filter(function(i){ return i.id === id; })[0] || {};
    var drop = inp.nextElementSibling; if (!drop) return;
    var hits = jobHits(inp.value, x.suggest);
    drop.innerHTML = hits.length ? hits.map(function(h){ return '<div onmousedown="_ofAssign(\'' + id + '\',\'' + h.id + '\')">' + esc(h.label) + (h.why ? '<small>Suggested: ' + esc(h.why) + '</small>' : '') + '</div>'; }).join('')
      : '<div class="of-note" style="cursor:default">No job matches.</div>';
    drop.style.display = 'block';
    if (!inp._ofBlur) { inp._ofBlur = 1; inp.addEventListener('blur', function(){ setTimeout(function(){ drop.style.display = 'none'; }, 150); }); }
  };
  window._ofAssignOpen = function(id){
    var tr = Array.prototype.filter.call(document.querySelectorAll('#supinvRoot tr.click'), function(r){ return (r.getAttribute('onclick') || '').indexOf(id) >= 0; })[0];
    if (!tr) return; var cell = tr.children[5]; if (!cell) return;
    var x = O.inv.filter(function(i){ return i.id === id; })[0];
    cell.innerHTML = assignBox(x) + '<a href="#" class="of-note" onclick="_ofAssign(\'' + id + '\',null);return false">Take it off the job</a>';
    var inp = cell.querySelector('input'); if (inp) inp.focus();
  };
  window._ofAssign = async function(id, jobId){
    try {
      var r = await api('PUT', '/supinv/' + id + '/assign', { jobId: jobId || null });
      O.inv = O.inv.map(function(i){ return i.id === id ? Object.assign({}, i, r.invoice) : i; });
      renderSupinv();
      toast(jobId ? 'Invoice put on ' + (r.invoice.job_label || 'the job') : 'Invoice taken off the job');
      var ov = $('ofSumModal'); if (ov) { ov.remove(); window._ofSummary(id); }
    } catch (e) { alert('Could not assign: ' + e.message); }
  };
  window._ofFilter = function(f){ O.filter = f; renderSupinv(); };
  window._ofSearch = function(q){ O.q = q; var p = $('ofQ'), pos = p ? p.selectionStart : 0; renderSupinv(); p = $('ofQ'); if (p) { p.focus(); try { p.setSelectionRange(pos, pos); } catch (e) {} } };
  window._ofSetupToggle = function(){ var c = $('ofSetup'); if (c) c.style.display = c.style.display === 'none' ? 'block' : 'none'; };
  window._ofCopy = function(id){ var t = ($(id) || {}).textContent || ''; try { navigator.clipboard.writeText(t); toast('Copied'); } catch (e) { prompt('Copy:', t); } };
  function wireDrop(){
    var d = $('ofDrop'); if (!d || d._w) return; d._w = 1;
    d.addEventListener('dragover', function(e){ e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', function(){ d.classList.remove('over'); });
    d.addEventListener('drop', function(e){ e.preventDefault(); d.classList.remove('over'); window._ofUpload(e.dataTransfer.files); });
  }
  function b64(file){ return new Promise(function(ok, no){ var fr = new FileReader(); fr.onload = function(){ ok(String(fr.result).split(',')[1] || ''); }; fr.onerror = no; fr.readAsDataURL(file); }); }
  window._ofUpload = async function(files){
    files = Array.prototype.slice.call(files || []); if (!files.length) return;
    var n = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try { await api('POST', '/supinv/upload', { name: f.name, mime: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : ''), data: await b64(f) }); n++; }
      catch (e) { alert(f.name + ': ' + e.message); }
    }
    if (n) { toast(n + ' invoice' + (n > 1 ? 's' : '') + ' uploaded — reading them now'); O.filter = 'all'; await openSupinv(); }
  };
  window._ofXero = async function(id, btn){
    var x = O.inv.filter(function(i){ return i.id === id; })[0] || {};
    if (!x.job_id && !confirm('This invoice is not on a job yet. Send it to Xero anyway?')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      var r = await api('POST', '/supinv/' + id + '/xero');
      O.inv = O.inv.map(function(i){ return i.id === id ? Object.assign({}, i, { xero: r.xero }) : i; });
      renderSupinv(); toast('Sent to Xero as a ' + ((O.xero && O.xero.status === 'AUTHORISED') ? 'bill' : 'draft bill') + (r.xero && r.xero.attached ? ', PDF attached' : ''));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send to Xero'; }
      if (e.code === 'XERO_NOT_CONNECTED') { if (confirm('Xero is not connected. Connect it now?')) gotoTab('finance'); }
      else alert('Xero: ' + e.message);
    }
  };
  window._ofSummary = async function(id){
    var x = O.inv.filter(function(i){ return i.id === id; })[0]; if (!x) return;
    try { var r = await api('GET', '/supinv/' + id); if (r && r.invoice) x = Object.assign({}, x, r.invoice); } catch (e) {}
    var old = $('ofSumModal'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'of-modal'; m.id = 'ofSumModal';
    m.onclick = function(e){ if (e.target === m) m.remove(); };
    var lines = (x.lines || []).slice(0, 40);
    m.innerHTML = '<div class="of-box"><h3>' + esc(x.supplier || 'Supplier invoice') + (x.inv_number ? ' · ' + esc(x.inv_number) : '') + '</h3>' +
      (x.description ? '<p style="margin:0 0 12px;color:#334155">' + esc(x.description) + '</p>' : '') +
      '<dl class="of-kv">' +
        '<dt>Job</dt><dd>' + (x.job_id ? esc(x.job_label) + '<div class="of-note">' + esc(x.alloc === 'auto' ? 'Put there automatically: ' + x.alloc_why : x.alloc_why) + '</div>' : '<span style="color:#92400e">Not on a job yet</span>') + '</dd>' +
        '<dt>Invoice date</dt><dd>' + esc(dmy(x.inv_date) || '—') + (x.due_date ? ' · due ' + esc(dmy(x.due_date)) : '') + '</dd>' +
        '<dt>Excl. GST</dt><dd>' + money(x.subtotal) + '</dd><dt>GST</dt><dd>' + money(x.gst) + '</dd><dt>Total</dt><dd style="font-size:16px">' + money(x.total) + '</dd>' +
        ((x.refs || []).length ? '<dt>References</dt><dd>' + esc(x.refs.join(' · ')) + '</dd>' : '') +
        (x.site_address ? '<dt>Delivered to</dt><dd>' + esc(x.site_address) + '</dd>' : '') +
        '<dt>Came from</dt><dd>' + esc(x.source === 'upload' ? 'Uploaded by ' + (x.from_addr || 'the office') : (x.from_addr || 'email')) + ' · ' + esc(dmy(x.received_at)) + '</dd>' +
        ((x.xero && x.xero.invoiceId) ? '<dt>Xero</dt><dd>Sent ' + esc(dmy(x.xero.at)) + ' to ' + esc(x.xero.org || 'Xero') + (x.xero.attached ? ' (PDF attached)' : '') + '</dd>' : '') +
        (x.status === 'failed' ? '<dt>Reading</dt><dd style="color:#991b1b">' + esc(x.error) + '</dd>' : '') +
      '</dl>' +
      (lines.length ? '<div class="of-scroll" style="margin-bottom:12px"><table class="of-tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>' +
        lines.map(function(l){ return '<tr><td>' + esc(l.desc) + '</td><td class="r">' + esc(l.qty == null ? '' : l.qty) + '</td><td class="r">' + money(l.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="of-btn" onclick="_ofDelete(\'' + x.id + '\')" style="margin-right:auto;color:#b91c1c">Delete</button>' +
        (x.storage_path ? '<button class="of-btn" onclick="_ofReread(\'' + x.id + '\',this)">Read again</button>' : '') +
        '<button class="of-btn" onclick="document.getElementById(\'ofSumModal\').remove();_ofAssignOpen(\'' + x.id + '\')">' + (x.job_id ? 'Change job' : 'Assign to a job') + '</button>' +
        ((x.xero && x.xero.invoiceId) || x.status !== 'read' ? '' : '<button class="of-btn" onclick="_ofXero(\'' + x.id + '\',this)">Send to Xero</button>') +
        (x.storage_path ? '<button class="of-btn pri" onclick="_ofPdf(\'' + x.id + '\')">Open PDF</button>' : '') +
        '<button class="of-btn" onclick="document.getElementById(\'ofSumModal\').remove()">Close</button></div></div>';
    document.body.appendChild(m);
  };
  window._ofPdf = async function(id){
    try {
      var r = await api('GET', '/supinv/' + id + '/url');
      var blob = await (await fetch(r.url)).blob();
      var url = URL.createObjectURL(blob);
      var old = $('ofPdfModal'); if (old) old.remove();
      var m = document.createElement('div'); m.className = 'of-modal'; m.id = 'ofPdfModal'; m.style.zIndex = 10060;
      m.onclick = function(e){ if (e.target === m) { m.remove(); URL.revokeObjectURL(url); } };
      var img = /^image\//.test(r.mime || blob.type);
      m.innerHTML = '<div class="of-box wide"><div style="display:flex;align-items:center;gap:8px;margin:0 0 8px"><b style="flex:1">' + esc(r.name) + '</b>' +
        '<a class="of-btn sm" href="' + url + '" download="' + esc(r.name) + '">Download</a><button class="of-btn sm" id="ofPdfClose">Close</button></div>' +
        (img ? '<div style="flex:1;overflow:auto;text-align:center"><img src="' + url + '" style="max-width:100%"></div>' : '<iframe src="' + url + '" style="flex:1;border:0;width:100%"></iframe>') + '</div>';
      document.body.appendChild(m);
      $('ofPdfClose').onclick = function(){ m.remove(); URL.revokeObjectURL(url); };
    } catch (e) { alert('Could not open it: ' + e.message); }
  };
  window._ofReread = async function(id, btn){
    if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
    try { var r = await api('POST', '/supinv/' + id + '/reread'); O.inv = O.inv.map(function(i){ return i.id === id ? r.invoice : i; }); renderSupinv();
      var ov = $('ofSumModal'); if (ov) ov.remove(); window._ofSummary(id); }
    catch (e) { alert(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Read again'; } }
  };
  window._ofDelete = async function(id){
    if (!confirm('Delete this supplier invoice from RoofMap? (Anything already sent to Xero stays in Xero.)')) return;
    try { await api('DELETE', '/supinv/' + id); O.inv = O.inv.filter(function(i){ return i.id !== id; }); var ov = $('ofSumModal'); if (ov) ov.remove(); renderSupinv(); }
    catch (e) { alert(e.message); }
  };

  // ══ JOB COSTING ═════════════════════════════════════════════════
  async function openCosting(){
    var root = $('costingRoot'); if (!root) return;
    root.innerHTML = '<div class="of-note">Loading jobs…</div>';
    try { await loadJobs(true); renderCosting(); }
    catch (e) { root.innerHTML = '<div class="of-card">Could not load the jobs: ' + esc(e.message) + '</div>'; }
  }
  function rev(j){ return j.acceptedEx != null ? j.acceptedEx : j.quoteEx; }
  function renderCosting(){
    var root = $('costingRoot'); if (!root) return;
    var q = O.cq.trim().toLowerCase();
    var all = (O.jobs || []).filter(function(j){ return O.cAll ? (rev(j) != null || j.cost) : (j.acceptedEx != null || j.cost); });
    var list = all.filter(function(j){ return !q || [j.no, j.client, j.addr].join(' ').toLowerCase().indexOf(q) >= 0; });
    var withCost = all.filter(function(j){ return j.acceptedEx && j.cost; });
    var R = withCost.reduce(function(s, j){ return s + j.acceptedEx; }, 0), C = withCost.reduce(function(s, j){ return s + j.cost; }, 0);
    // A month a row: accepted work, its supplier costs, what is left.
    var months = {};
    all.forEach(function(j){ if (!j.acceptedAt) return; var k = String(j.acceptedAt).slice(0, 7);
      var m = months[k] || (months[k] = { n: 0, rev: 0, cost: 0 }); m.n++; m.rev += j.acceptedEx || 0; m.cost += j.cost || 0; });
    var mk = Object.keys(months).sort().reverse().slice(0, 12);
    root.innerHTML = '<div class="of-hd"><h2>Job costing</h2><span class="of-note">Quotes are excl. GST; supplier costs are the invoices put on each job.</span></div>' +
      '<div class="of-stats">' +
        stat('Accepted jobs', String(all.filter(function(j){ return j.acceptedEx != null; }).length), '') +
        stat('Jobs with supplier costs', String(withCost.length), money(C, 0) + ' of materials') +
        stat('Materials as % of price', R ? pct(C / R * 100) : '—', 'on jobs with invoices') +
        stat('Left after materials', R ? money(R - C, 0) : '—', 'before labour and overheads') +
      '</div>' +
      '<div class="of-card"><h3>By month accepted</h3><div class="of-scroll"><table class="of-tbl"><thead><tr><th>Month</th><th class="r">Jobs</th><th class="r">Accepted (ex GST)</th><th class="r">Supplier costs</th><th class="r">Left after materials</th><th class="r">%</th></tr></thead><tbody>' +
        (mk.length ? mk.map(function(k){ var m = months[k]; return '<tr><td>' + esc(new Date(k + '-01T00:00:00').toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })) + '</td><td class="r">' + m.n + '</td><td class="r">' + money(m.rev, 0) + '</td><td class="r">' + money(m.cost, 0) + '</td><td class="r">' + money(m.rev - m.cost, 0) + '</td><td class="r">' + (m.rev ? pct((m.rev - m.cost) / m.rev * 100) : '—') + '</td></tr>'; }).join('')
          : '<tr><td colspan="6" class="of-note">No accepted jobs yet.</td></tr>') +
      '</tbody></table></div><div class="of-note" style="margin-top:6px">Labour joins these figures once the crew log their hours in the phone app.</div></div>' +
      '<div class="of-chips"><input class="of-search" id="ocQ" placeholder="Search job number, customer, address…" value="' + esc(O.cq) + '" oninput="_ocSearch(this.value)">' +
        '<label class="of-note"><input type="checkbox" ' + (O.cAll ? 'checked' : '') + ' onchange="_ocAll(this.checked)"> Include quotes not accepted</label></div>' +
      '<div class="of-scroll"><table class="of-tbl"><thead><tr><th>Job</th><th>Customer</th><th>Address</th><th class="r">Price (ex GST)</th><th class="r">Supplier costs</th><th class="r">Left</th><th class="r">%</th><th>Accepted</th></tr></thead><tbody>' +
      (list.length ? list.slice(0, 400).map(function(j){
        var r = rev(j), left = r != null ? r - (j.cost || 0) : null;
        return '<tr class="click" onclick="_ocJob(\'' + j.id + '\')"><td><b>' + esc(j.no || '—') + '</b></td><td>' + esc(j.client) + '</td><td>' + esc(j.addr) + '</td>' +
          '<td class="r">' + money(r, 0) + (j.acceptedEx == null && r != null ? ' <span class="of-pill s">quoted</span>' : '') + '</td><td class="r">' + (j.cost ? money(j.cost, 0) : '—') + '</td>' +
          '<td class="r ' + (left != null && left < 0 ? 'of-neg' : '') + '">' + (j.cost && left != null ? money(left, 0) : '—') + '</td><td class="r">' + (j.cost && r ? pct(left / r * 100) : '—') + '</td>' +
          '<td>' + esc(dmy(j.acceptedAt)) + '</td></tr>'; }).join('')
        : '<tr><td colspan="8" class="of-note" style="padding:18px">No jobs match.</td></tr>') +
      '</tbody></table></div>';
  }
  function stat(t, v, s){ return '<div class="of-stat"><span>' + esc(t) + '</span><b>' + esc(v) + '</b><small>' + esc(s) + '</small></div>'; }
  window._ocSearch = function(q){ O.cq = q; renderCosting(); var p = $('ocQ'); if (p) { p.focus(); try { p.setSelectionRange(q.length, q.length); } catch (e) {} } };
  window._ocAll = function(on){ O.cAll = !!on; renderCosting(); };
  window._ocJob = function(id){
    var j = (O.jobs || []).filter(function(x){ return x.id === id; })[0]; if (!j) return;
    var r = rev(j), left = r != null ? r - (j.cost || 0) : null;
    var old = $('ofSumModal'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'of-modal'; m.id = 'ofSumModal'; m.onclick = function(e){ if (e.target === m) m.remove(); };
    m.innerHTML = '<div class="of-box"><h3>' + esc([j.no, j.client].filter(Boolean).join(' — ')) + '</h3><p class="of-note" style="margin:-4px 0 12px">' + esc(j.addr) + '</p>' +
      '<div class="of-stats">' + stat(j.acceptedEx != null ? 'Accepted (ex GST)' : 'Quoted (ex GST)', money(r, 0), j.acceptedAt ? 'accepted ' + dmy(j.acceptedAt) : (j.sentAt ? 'sent ' + dmy(j.sentAt) : '')) +
        stat('Supplier costs', money(j.cost || 0, 0), (j.invoices || []).length + ' invoice' + ((j.invoices || []).length === 1 ? '' : 's')) +
        stat('Left after materials', left != null ? money(left, 0) : '—', r && j.cost ? pct(left / r * 100) : '') + '</div>' +
      '<div class="of-scroll" style="margin-bottom:12px"><table class="of-tbl"><thead><tr><th>Supplier</th><th>Invoice</th><th>Date</th><th class="r">Ex GST</th></tr></thead><tbody>' +
      ((j.invoices || []).length ? j.invoices.map(function(i){ return '<tr class="click" onclick="_ofSummary(\'' + i.id + '\')"><td>' + esc(i.supplier) + '</td><td>' + esc(i.number) + '</td><td>' + esc(dmy(i.date)) + '</td><td class="r">' + money(i.ex) + '</td></tr>'; }).join('')
        : '<tr><td colspan="4" class="of-note">No supplier invoices on this job yet.</td></tr>') + '</tbody></table></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="of-btn" onclick="document.getElementById(\'ofSumModal\').remove()">Close</button></div></div>';
    document.body.appendChild(m);
    if ((j.invoices || []).length && !O.inv.length) loadInv().catch(function(){});
  };

  // ══ FINANCIALS (Xero) ═══════════════════════════════════════════
  async function openFinance(){
    var root = $('financeRoot'); if (!root) return;
    root.innerHTML = '<div class="of-note">Loading…</div>';
    try {
      var st = await api('GET', '/xero/status'); O.xero = st;
      if (!st.connected) { renderFinanceConnect(st); return; }
      var p = await api('GET', '/xero/pnl?months=24'); O.pnl = p;
      try { await loadJobs(); } catch (e) {}
      renderFinance();
    } catch (e) { root.innerHTML = '<div class="of-card">Could not read Xero: ' + esc(e.message) + ' <button class="of-btn sm" onclick="_ofFinance()">Try again</button></div>'; }
  }
  window._ofFinance = openFinance;
  function renderFinanceConnect(st){
    $('financeRoot').innerHTML = '<div class="of-hd"><h2>Financials</h2></div><div class="of-card"><h3>Connect Xero</h3>' +
      '<p class="of-note">Connect your Xero organisation to see your P&amp;L month by month, the rolling 3- and 6-month averages and each financial year here — and to send supplier invoices to Xero as bills, with the PDF attached and the job in the reference.</p>' +
      (st.configured ? '<button class="of-btn pri" onclick="_ofXeroConnect(this)">Connect Xero</button>'
        : '<p class="of-note" style="color:#92400e">Xero is not set up on the RoofMap server yet.</p>') + '</div>';
  }
  window._ofXeroConnect = async function(btn){
    if (btn) btn.disabled = true;
    try { var r = await api('POST', '/xero/connect'); location.href = r.url; }
    catch (e) { alert(e.message); if (btn) btn.disabled = false; }
  };
  window._ofXeroDisconnect = async function(){
    if (!confirm('Disconnect Xero from RoofMap? Nothing in Xero is changed.')) return;
    try { await api('POST', '/xero/disconnect'); openFinance(); } catch (e) { alert(e.message); }
  };
  window._ofXeroSet = async function(k, v){ try { var b = {}; b[k] = v; await api('PUT', '/xero/settings', b); toast('Saved'); } catch (e) { alert(e.message); } };
  function fyOf(month){ var y = +month.slice(0, 4), m = +month.slice(5, 7); return m >= 4 ? y + 1 : y; }   // NZ: April – March, named for the year it ends in
  function avg(list, k){ return list.length ? list.reduce(function(s, x){ return s + (x[k] || 0); }, 0) / list.length : null; }
  function renderFinance(){
    var p = O.pnl || {}, x = O.xero || {};
    var cur = new Date().toISOString().slice(0, 7);
    var months = (p.months || []).filter(function(m){ return m.month < cur; });   // complete months
    var last3 = months.slice(-3), last6 = months.slice(-6);
    var yrs = {}; months.forEach(function(m){ var f = fyOf(m.month); (yrs[f] = yrs[f] || []).push(m); });
    var fyNow = fyOf(cur);
    function rollCard(t, list){ return '<div class="of-stat"><span>' + t + '</span><b>' + money(avg(list, 'income'), 0) + '</b><small>revenue a month · net ' + money(avg(list, 'net'), 0) +
      ' · GP ' + (avg(list, 'income') ? pct(avg(list, 'gross') / avg(list, 'income') * 100) : '—') + '</small></div>'; }
    var maxI = Math.max.apply(null, months.map(function(m){ return Math.max(m.income, Math.abs(m.net)); }).concat([1]));
    var W = 900, H = 200, bw = months.length ? W / months.length : W;
    var bars = months.map(function(m, i){ var h = m.income / maxI * (H - 30), nh = Math.abs(m.net) / maxI * (H - 30);
      return '<rect x="' + (i * bw + 3) + '" y="' + (H - 18 - h) + '" width="' + Math.max(2, bw * .45) + '" height="' + h + '" fill="#0099e0" rx="2"><title>' + m.month + ' revenue ' + money(m.income, 0) + '</title></rect>' +
        '<rect x="' + (i * bw + 3 + bw * .47) + '" y="' + (H - 18 - nh) + '" width="' + Math.max(2, bw * .38) + '" height="' + nh + '" fill="' + (m.net < 0 ? '#dc2626' : '#16a34a') + '" rx="2"><title>' + m.month + ' net ' + money(m.net, 0) + '</title></rect>' +
        (i % 2 === 0 ? '<text x="' + (i * bw + bw / 2) + '" y="' + (H - 4) + '" font-size="10" text-anchor="middle" fill="#64748b">' + m.month.slice(5) + '/' + m.month.slice(2, 4) + '</text>' : ''); }).join('');
    var jobs = (O.jobs || []).filter(function(j){ return j.acceptedEx && j.cost; });
    $('financeRoot').innerHTML = '<div class="of-hd"><h2>Financials</h2><span class="of-note">From Xero: <b>' + esc(p.org || x.org) + '</b> · excl. GST</span>' +
        '<button class="of-btn sm" onclick="_ofFinance()">Refresh</button></div>' +
      '<div class="of-stats">' + rollCard('Last month', months.slice(-1)) + rollCard('Rolling 3-month average', last3) + rollCard('Rolling 6-month average', last6) + '</div>' +
      '<div class="of-card"><h3>Revenue and net profit by month</h3><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + bars + '</svg>' +
        '<div class="of-note"><span style="color:#0099e0">■</span> Revenue <span style="color:#16a34a;margin-left:10px">■</span> Net profit <span style="color:#dc2626;margin-left:10px">■</span> Loss</div></div>' +
      '<div class="of-card"><h3>P&amp;L by financial year (April – March)</h3><div class="of-scroll"><table class="of-tbl"><thead><tr><th>Year</th><th class="r">Months</th><th class="r">Revenue</th><th class="r">Gross profit</th><th class="r">GP %</th><th class="r">Expenses</th><th class="r">Net profit</th><th class="r">Revenue a month</th><th class="r">Run-rate</th></tr></thead><tbody>' +
        Object.keys(yrs).sort().reverse().map(function(f){ var l = yrs[f], s = function(k){ return l.reduce(function(a, m){ return a + (m[k] || 0); }, 0); };
          var I = s('income'), rr = (+f === fyNow && l.length < 12) ? I + (I / l.length) * (12 - l.length) : null;
          return '<tr><td><b>FY' + String(f).slice(2) + '</b>' + (+f === fyNow ? ' <span class="of-pill b">running</span>' : '') + '</td><td class="r">' + l.length + '</td><td class="r">' + money(I, 0) + '</td><td class="r">' + money(s('gross'), 0) + '</td>' +
            '<td class="r">' + (I ? pct(s('gross') / I * 100) : '—') + '</td><td class="r">' + money(s('expenses'), 0) + '</td><td class="r ' + (s('net') < 0 ? 'of-neg' : '') + '">' + money(s('net'), 0) + '</td>' +
            '<td class="r">' + money(I / l.length, 0) + '</td><td class="r">' + (rr != null ? money(rr, 0) : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="of-note" style="margin-top:6px">Run-rate: the year\'s complete months plus their average for each month left.</div></div>' +
      '<div class="of-card"><h3>P&amp;L by month</h3><div class="of-scroll"><table class="of-tbl"><thead><tr><th>Month</th><th class="r">Revenue</th><th class="r">Cost of sales</th><th class="r">Gross profit</th><th class="r">GP %</th><th class="r">Expenses</th><th class="r">Net profit</th><th class="r">3-mo avg net</th><th class="r">6-mo avg net</th></tr></thead><tbody>' +
        months.slice().reverse().map(function(m){ var i = months.indexOf(m), a3 = avg(months.slice(Math.max(0, i - 2), i + 1), 'net'), a6 = avg(months.slice(Math.max(0, i - 5), i + 1), 'net');
          return '<tr><td>' + esc(new Date(m.month + '-01T00:00:00').toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })) + '</td><td class="r">' + money(m.income, 0) + '</td><td class="r">' + money(m.cos, 0) + '</td><td class="r">' + money(m.gross, 0) + '</td>' +
            '<td class="r">' + (m.income ? pct(m.gross / m.income * 100) : '—') + '</td><td class="r">' + money(m.expenses, 0) + '</td><td class="r ' + (m.net < 0 ? 'of-neg' : '') + '">' + money(m.net, 0) + '</td>' +
            '<td class="r">' + (i >= 2 ? money(a3, 0) : '—') + '</td><td class="r">' + (i >= 5 ? money(a6, 0) : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>' +
      '<div class="of-card"><h3>Back costing — supplier costs against the accepted price</h3>' +
        (jobs.length ? '<div class="of-note" style="margin-bottom:8px">' + jobs.length + ' jobs with supplier invoices on them: materials ' +
          pct(jobs.reduce(function(s, j){ return s + j.cost; }, 0) / jobs.reduce(function(s, j){ return s + j.acceptedEx; }, 0) * 100) + ' of the price. Open Job Costing for each job.</div>'
          : '<div class="of-note">Once supplier invoices are on jobs, each job\'s materials against its price shows here and in Job Costing.</div>') +
        '<button class="of-btn sm" onclick="gotoTab(\'costing\')">Open Job Costing</button></div>' +
      '<div class="of-card"><h3>Xero settings</h3><div class="of-kv"><dt>Organisation</dt><dd>' + esc(x.org) + '</dd>' +
        '<dt>Bills go to account</dt><dd><input style="width:90px" value="' + esc(x.account || '300') + '" onchange="_ofXeroSet(\'account\',this.value)"> <span class="of-note">(the account code in Xero\'s chart of accounts)</span></dd>' +
        '<dt>Bills are sent as</dt><dd><select onchange="_ofXeroSet(\'status\',this.value)"><option value="DRAFT"' + (x.status !== 'AUTHORISED' ? ' selected' : '') + '>Draft — approve them in Xero</option><option value="AUTHORISED"' + (x.status === 'AUTHORISED' ? ' selected' : '') + '>Approved</option></select></dd></div>' +
        '<button class="of-btn sm" onclick="_ofXeroDisconnect()">Disconnect Xero</button></div>';
  }

  // ══ GPS MAP & THE CREW ═══════════════════════════════════════════
  // (2026-11-13, the owner: "a GPS map tab ... GPS can be seen at all times ...
  // checklists set in the office ... timesheets ... on-site hours versus the
  // travel hours"; "from 7 a.m. until 7 p.m. just on those days that they're
  // working"). The crew app is /crew; this tab reads what it sends.
  var G = { map: null, marks: [], hrsFrom: null, timer: null, now: null, members: null, lists: null };
  function nzToday(){ var p = {}; new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
  function addD(iso, n){ var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function monOf(iso){ var d = new Date(iso + 'T00:00:00Z'); return addD(iso, -((d.getUTCDay() + 6) % 7)); }
  function hh(h){ h = +h || 0; if (!h) return '—'; var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function ago(t){ if (!t) return ''; var m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? 'just now' : (m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago'); }
  function tm(t){ return t ? new Date(t).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }) : ''; }
  var STATUS = { on: 'On site', off: 'Clocked off', travel: 'Travelling', 'break': 'On a break', end: 'Finished for the day' };
  async function openGps(){
    var root = $('gpsRoot'); if (!root) return;
    if (!G.hrsFrom) G.hrsFrom = monOf(nzToday());
    var link = location.origin.replace(/^file:.*$/, 'https://roofmap.co.nz') + '/crew';
    root.innerHTML = '<div class="of-hd"><h2>GPS map &amp; crew</h2><span class="of-note">Crew app: <b>' + esc(link) + '</b></span>' +
      '<button class="of-btn sm" onclick="_ofCopy(\'' + esc(link) + '\')">Copy link</button><button class="of-btn sm" onclick="_ofGpsLoad()">↻ Refresh</button></div>' +
      '<div class="of-chips" id="ofGpsJump" style="margin:0 0 12px">' + [['ofGpsCardMap', 'Map'], ['ofGpsCardHours', 'Hours'], ['ofGpsCardFlash', 'Flashing orders'], ['ofGpsCardMembers', 'Crew &amp; what they see'], ['ofGpsCardLists', 'Checklists'], ['ofGpsCardSet', 'Crew app settings']]
        .map(function(x){ return '<button class="of-btn sm' + (x[0] === 'ofGpsCardLists' ? ' pri' : '') + '" data-jump="' + x[0] + '" onclick="_ofGpsJump(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="of-card" id="ofGpsCardMap"><h3>Where the crew are today</h3><div class="of-note" style="margin-bottom:8px">Location is only recorded 7 am – 7 pm on days a person\'s crew is booked on the schedule, and only while the crew app is open on their phone.</div>' +
      '<div id="ofGpsMap" style="height:420px;border-radius:10px;overflow:hidden;background:#e2e8f0;margin-bottom:10px"></div><div id="ofGpsPeople"></div></div>' +
      '<div class="of-card" id="ofGpsCardHours"><h3>Hours</h3><div id="ofGpsHours"><div class="of-note">Loading…</div></div></div>' +
      '<div class="of-card" id="ofGpsCardFlash"><h3>Flashing orders from the crew app</h3><div class="of-note" style="margin-bottom:8px">Flashings drawn up on site. Someone not ticked for “Order flashings straight from the supplier” below sends them here — send each on to the supplier with its drawings.</div><div id="ofGpsFlash"><div class="of-note">Loading…</div></div></div>' +
      '<div class="of-card" id="ofGpsCardMembers"><h3>Who is on which crew, and what they see</h3><div id="ofGpsMembers"><div class="of-note">Loading…</div></div></div>' +
      '<div class="of-card" id="ofGpsCardSet"><h3>Crew app settings</h3><div id="ofGpsSet"><div class="of-note">Loading…</div></div></div>' +
      '<div class="of-card" id="ofGpsCardLists"><h3>Checklists for the crew app</h3><div class="of-note" style="margin-bottom:8px">Every job in the crew app shows these. “Before we start” and “When we finish” are ticked once a job; “Every day” is ticked each day on site.</div><div id="ofGpsLists"><div class="of-note">Loading…</div></div></div>';
    G.map = null; G.marks = [];
    clearInterval(G.timer); G.timer = setInterval(function(){ if ($('ofGpsMap') && document.body.getAttribute('data-tab') === 'gps') loadNow(); else clearInterval(G.timer); }, 60000);
    await Promise.all([loadNow(), loadHours(), loadFlash(), loadMembers(), loadSet(), loadLists()]);
  }
  window._ofGpsLoad = function(){ loadNow(); loadHours(); };
  window._ofGpsJump = function(id){ var el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  window._ofCopy = function(t){ try { navigator.clipboard.writeText(t); toast('Link copied'); } catch (e) { prompt('Copy this link', t); } };
  async function loadNow(){
    var box = $('ofGpsPeople'); if (!box) return;
    try { G.now = await api('GET', '/crew/office/now'); } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    var people = (G.now.people || []).filter(function(p){ return p.crew_id || p.status || p.last; });
    box.innerHTML = people.length ? '<div class="of-scroll"><table class="of-tbl"><thead><tr><th>Person</th><th>Crew</th><th>Today</th><th>Right now</th><th>Last position</th></tr></thead><tbody>' +
      people.map(function(p){
        return '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(p.colour) + ';margin-right:6px"></span><b>' + esc(p.name) + '</b></td>' +
          '<td>' + esc(p.crew || '—') + '</td><td>' + (p.booked ? '<span class="of-pill b">Booked</span>' : '<span class="of-pill s">Not booked</span>') + '</td>' +
          '<td>' + (p.status ? esc(STATUS[p.status] || p.status) + (p.status_row ? ' — ' + esc(p.status_row.client || p.status_row.site) : '') + ' <span class="of-note">since ' + esc(tm(p.status_at)) + '</span>' : '<span class="of-note">Not started</span>') + '</td>' +
          '<td>' + (p.last ? esc(ago(p.last.at)) + ' <a href="https://www.google.com/maps?q=' + p.last.lat + ',' + p.last.lng + '" target="_blank" rel="noopener">map</a>' : '<span class="of-note">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="of-note">Nobody has used the crew app yet. Send your crew the link above, and set who is on which crew below.</div>';
    drawMap();
  }
  function drawMap(){
    var el = $('ofGpsMap'); if (!el || !G.now) return;
    var pts = (G.now.people || []).filter(function(p){ return p.last; });
    if (typeof mapboxgl === 'undefined') { el.innerHTML = '<div class="of-note" style="padding:20px;text-align:center">The map needs an internet connection.</div>'; return; }
    try {
      if (!G.map) {
        mapboxgl.accessToken = window.MAPBOX_TOKEN || mapboxgl.accessToken;
        G.map = new mapboxgl.Map({ container: el, style: 'mapbox://styles/mapbox/streets-v12', center: [174.32, -35.73], zoom: 9 });
        G.map.addControl(new mapboxgl.NavigationControl(), 'top-left');
      }
      G.marks.forEach(function(m){ m.remove(); }); G.marks = [];
      var b = new mapboxgl.LngLatBounds();
      (G.now.sites || []).forEach(function(s){
        var d = document.createElement('div'); d.title = (s.client || '') + ' — ' + (s.site || '');
        d.style.cssText = 'width:14px;height:14px;border-radius:3px;background:#fff;border:3px solid #0a1628';
        G.marks.push(new mapboxgl.Marker(d).setLngLat([s.lng, s.lat]).setPopup(new mapboxgl.Popup({ offset: 10 }).setText((s.client || 'Job') + ' · ' + (s.site || ''))).addTo(G.map));
      });
      pts.forEach(function(p){
        var d = document.createElement('div');
        d.style.cssText = 'background:' + p.colour + ';color:#fff;font:700 12px system-ui;padding:3px 8px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap';
        d.textContent = p.name.split(' ')[0];
        G.marks.push(new mapboxgl.Marker(d).setLngLat([p.last.lng, p.last.lat]).setPopup(new mapboxgl.Popup({ offset: 14 }).setText(p.name + ' — ' + (STATUS[p.status] || 'seen') + ', ' + ago(p.last.at))).addTo(G.map));
        b.extend([p.last.lng, p.last.lat]);
      });
      if (pts.length) G.map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    } catch (e) { el.innerHTML = '<div class="of-note" style="padding:20px">Map unavailable: ' + esc(e.message) + '</div>'; }
  }
  async function loadHours(){
    var box = $('ofGpsHours'); if (!box) return;
    var from = G.hrsFrom, to = addD(from, 6), h;
    try { h = await api('GET', '/crew/office/hours?from=' + from + '&to=' + to); } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    G.hours = h;
    var days = []; for (var i = 0; i < 7; i++) days.push(addD(from, i));
    var lbl = function(d){ return new Date(d + 'T12:00:00Z').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }); };
    var people = h.people || [];
    box.innerHTML = '<div class="of-chips"><button class="of-btn sm" onclick="_ofGpsWeek(-7)">‹</button><b>' + esc(lbl(from)) + ' – ' + esc(lbl(to)) + '</b><button class="of-btn sm" onclick="_ofGpsWeek(7)">›</button>' +
      '<span class="of-note" style="flex:1">Each day: on site + travel. Hours come from the crew pressing clock on / off; the time between leaving one job and arriving at the next is travel.</span>' +
      (people.length ? '<button class="of-btn sm" onclick="_ofGpsCsv()">Download CSV</button>' : '') + '</div>' +
      (people.length ? '<div class="of-scroll"><table class="of-tbl"><thead><tr><th>Person</th>' + days.map(function(d){ return '<th class="r">' + esc(lbl(d)) + '</th>'; }).join('') +
        '<th class="r">On site</th><th class="r">Travel</th><th class="r">Total</th></tr></thead><tbody>' +
        people.map(function(p){
          var on = 0, tr = 0;
          var cells = days.map(function(d){ var x = (p.days || []).find(function(y){ return y.date === d; }); if (!x) return '<td class="r of-note">—</td>';
            on += x.onsiteTotal; tr += x.travel;
            var jobs = Object.keys(x.onsite).map(function(k){ var r = (h.rows || {})[k] || {}; return (r.client || r.site || 'Job') + ' ' + hh(x.onsite[k]); }).join('\n');
            return '<td class="r" title="' + esc(jobs + '\nTravel ' + hh(x.travel) + '\n' + tm(x.first) + ' – ' + tm(x.last)) + '">' + hh(x.onsiteTotal) + ' + ' + hh(x.travel) + (x.open ? ' <span class="of-pill a">open</span>' : '') + '</td>'; }).join('');
          return '<tr><td><b>' + esc(p.name) + '</b></td>' + cells + '<td class="r">' + hh(on) + '</td><td class="r">' + hh(tr) + '</td><td class="r"><b>' + hh(on + tr) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="of-note">No hours this week yet.</div>');
  }
  window._ofGpsWeek = function(n){ G.hrsFrom = addD(G.hrsFrom, n); loadHours(); };
  window._ofGpsCsv = function(){
    var h = G.hours; if (!h) return;
    var q = function(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [['Person', 'Date', 'Job', 'Site', 'On site (h)', 'Travel (h)', 'Day total (h)', 'Started', 'Finished', 'Left clocked on']];
    (h.people || []).forEach(function(p){ (p.days || []).forEach(function(x){
      var ks = Object.keys(x.onsite);
      if (!ks.length) out.push([p.name, x.date, '', '', 0, x.travel, x.total, tm(x.first), tm(x.last), x.open ? 'yes' : '']);
      ks.forEach(function(k, i){ var r = (h.rows || {})[k] || {}; out.push([p.name, x.date, r.client || '', r.site || '', x.onsite[k], i ? '' : x.travel, i ? '' : x.total, i ? '' : tm(x.first), i ? '' : tm(x.last), (!i && x.open) ? 'yes' : '']); });
    }); });
    var blob = new Blob([out.map(function(r){ return r.map(q).join(','); }).join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Crew hours ' + h.from + ' to ' + h.to + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  };
  // WHAT EACH PERSON SEES IN THE CREW APP (2026-11-13, the owner: "make the
  // individual user permissions to show what they can see (and remove the
  // quote from the files, i don't need the guys seeing the quoted totals)").
  var PERM_LABELS = [['phone', 'Customer phone'], ['scope', 'Scope of work & choices'], ['files', 'Files'], ['photos', 'View photos'],
    ['upload', 'Upload photos'], ['hours', 'Allocated vs used hours'], ['allCrews', 'Every crew\'s week'], ['priced', 'Quotes, orders & invoices (prices)'],
    ['orderFlash', 'Order flashings straight from the supplier']];
  // ORDER FLASHING: what the crew drew up on site (2026-11-13).
  async function loadFlash(){
    var box = $('ofGpsFlash'); if (!box) return;
    try { G.flash = await api('GET', '/crew/office/flash-orders'); } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    var os = (G.flash.orders || []).filter(function(o){ return o.status !== 'done'; }), sups = G.flash.suppliers || [];
    var ST = { office: '<span class="of-pill s">Waiting for the office</span>', sent: '<span class="of-pill b">Sent</span>' };
    box.innerHTML = os.length ? '<div class="of-scroll"><table class="of-tbl"><thead><tr><th>When</th><th>Job</th><th>By</th><th>Flashings</th><th>Status</th><th></th></tr></thead><tbody>' +
      os.map(function(o){
        var lm = (o.items || []).reduce(function(a, x){ return a + (+x.qty || 0) * (+x.lengthM || 0); }, 0);
        return '<tr data-flo="' + esc(o.id) + '"><td>' + esc(new Date(o.created_at).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' })) + '</td>' +
          '<td>' + esc(o.job ? (o.job.client || o.job.site) : '—') + (o.job && o.job.site ? '<div class="of-note">' + esc(o.job.site) + '</div>' : '') + '</td><td>' + esc(o.by || '—') + '</td>' +
          '<td>' + (o.items || []).map(function(x){ return esc(x.qty + ' × ' + (+x.lengthM).toFixed(2) + ' m ' + x.name + (x.colour ? ' (' + x.colour + ')' : '')); }).join('<br>') + '<div class="of-note">' + lm.toFixed(2) + ' lineal m' + (o.note ? ' · ' + esc(o.note) : '') + '</div></td>' +
          '<td>' + (ST[o.status] || esc(o.status)) + (o.status === 'sent' && o.supplier_name ? '<div class="of-note">' + esc(o.supplier_name) + (o.sent_at ? ' · ' + esc(tm(o.sent_at)) : '') + '</div>' : '') + '</td>' +
          '<td style="white-space:nowrap"><button class="of-btn sm" onclick="_ofFlashPdf(\'' + esc(o.id) + '\')">PDF</button> ' +
          (o.status === 'office' ? (sups.length ? '<select data-flsup="' + esc(o.id) + '">' + sups.map(function(s, i){ return '<option value="' + i + '">' + esc(s.name) + '</option>'; }).join('') + '</select> <button class="of-btn sm pri" onclick="_ofFlashSend(\'' + esc(o.id) + '\')">Send to supplier</button> ' : '<span class="of-note">Add a roofing supplier with an email in Settings → Suppliers &amp; trades.</span> ') : '') +
          '<button class="of-btn sm" onclick="_ofFlashDone(\'' + esc(o.id) + '\')">Done</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="of-note">No flashing orders yet. In the crew app, a job’s menu has Order flashing.</div>';
  }
  window._ofFlashSend = async function(id){
    var sel = document.querySelector('[data-flsup="' + id + '"]'), s = (G.flash.suppliers || [])[sel ? +sel.value : 0]; if (!s) return;
    if (!confirm('Email this flashing order to ' + s.name + ' (' + s.email + ')?')) return;
    try { await api('POST', '/crew/office/flash-orders/' + encodeURIComponent(id) + '/send', { email: s.email, name: s.name }); toast('Sent to ' + s.name); loadFlash(); }
    catch (e) { alert(e.message); }
  };
  window._ofFlashDone = async function(id){ try { await api('POST', '/crew/office/flash-orders/' + encodeURIComponent(id) + '/done', {}); loadFlash(); } catch (e) { alert(e.message); } };
  window._ofFlashPdf = async function(id){
    try { var r = await api('GET', '/crew/office/flash-orders/' + encodeURIComponent(id) + '/pdf');
      var bin = atob(r.base64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u], { type: 'application/pdf' })); window.open(url, '_blank'); setTimeout(function(){ URL.revokeObjectURL(url); }, 60000); }
    catch (e) { alert(e.message); }
  };
  async function loadMembers(){
    var box = $('ofGpsMembers'); if (!box) return;
    try { G.members = await api('GET', '/crew/office/members'); } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    var crews = G.members.crews || [];
    box.innerHTML = '<div class="of-note" style="margin-bottom:8px">The crews are the schedule board\'s crews. A person\'s jobs in the crew app — and the days their location may be recorded — are the days their crew is booked. Tick what each person can see in the crew app; quotes, supplier orders and invoices (anything with a price) are hidden unless ticked. Invite someone in Settings → Team first.</div>' +
      '<div class="of-scroll"><table class="of-tbl" id="ofPermTbl"><thead><tr><th>Person</th><th>Crew</th>' + PERM_LABELS.map(function(p){ return '<th style="text-align:center;font-size:11px;max-width:90px;white-space:normal">' + p[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (G.members.members || []).map(function(m){
        var pm = m.perms || {};
        return '<tr><td><b>' + esc(m.crew_name || m.name || '—') + '</b><div class="of-note">' + esc(m.email) + '</div></td><td><select data-crew-uid="' + esc(m.id) + '" onchange="_ofCrewSet(\'' + esc(m.id) + '\',this.value)"><option value="">— no crew (office) —</option>' +
          crews.map(function(c){ return '<option value="' + esc(c.id) + '"' + (c.id === m.crew_id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></td>' +
          PERM_LABELS.map(function(p){ return '<td style="text-align:center"><input type="checkbox" data-perm="' + p[0] + '" data-perm-uid="' + esc(m.id) + '"' + (pm[p[0]] ? ' checked' : '') +
            ' onchange="_ofPermSet(\'' + esc(m.id) + '\',\'' + p[0] + '\',this.checked)" style="width:18px;height:18px"></td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  window._ofPermSet = async function(uid, key, on){
    var o = {}; o[key] = !!on;
    try { await api('PUT', '/crew/office/members/' + encodeURIComponent(uid), { perms: o }); toast('Saved — the crew app picks it up next time it opens'); }
    catch (e) { alert(e.message); loadMembers(); }
  };
  // HOW THE CREW PUT IN THEIR HOURS (the same message: "change whether the
  // roofers clock on and off with a button, or simply enter their start and end
  // time for the day").
  async function loadSet(){
    var box = $('ofGpsSet'); if (!box) return;
    var st; try { st = await api('GET', '/crew/office/settings'); } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    G.clockMode = st.clockMode === 'times' ? 'times' : 'button';
    var opt = function(v, t, d){ return '<label class="of-opt" style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;cursor:pointer"><input type="radio" name="ofClockMode" value="' + v + '"' + (G.clockMode === v ? ' checked' : '') +
      ' onchange="_ofClockMode(\'' + v + '\')" style="width:18px;height:18px;margin-top:2px"><span><b>' + t + '</b><div class="of-note">' + d + '</div></span></label>'; };
    box.innerHTML = '<div style="font-weight:700;margin-bottom:8px">How the crew put in their hours</div>' +
      opt('times', 'Type in their start and finish time (standard)', 'Each day they put in when they started, when they finished, their breaks and which job — no buttons to remember.') +
      opt('button', 'Clock on and off with a button', 'They press Clock on when they reach a job and Clock off when they leave; travel between jobs is worked out for them.');
  }
  window._ofClockMode = async function(v){
    try { await api('PUT', '/crew/office/settings', { clockMode: v }); G.clockMode = v; toast('Saved — the crew app switches next time it opens'); }
    catch (e) { alert(e.message); loadSet(); }
  };
  window._ofCrewSet = async function(uid, crew){ try { await api('PUT', '/crew/office/members/' + encodeURIComponent(uid), { crew_id: crew }); toast('Crew saved'); loadNow(); } catch (e) { alert(e.message); } };
  async function loadLists(){
    var box = $('ofGpsLists'); if (!box) return;
    try { G.lists = (await api('GET', '/crew/office/settings')).checklists || []; } catch (e) { box.innerHTML = '<div class="of-note">' + esc(e.message) + '</div>'; return; }
    renderLists();
  }
  function renderLists(){
    var box = $('ofGpsLists'); if (!box) return;
    var whenSel = function(w, i){ return '<select onchange="_ofListEdit(' + i + ',\'when\',this.value)">' + [['start', 'Before we start'], ['daily', 'Every day'], ['end', 'When we finish']].map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === w ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    box.innerHTML = (G.lists.length ? G.lists.map(function(l, i){
      return '<div class="of-opt" style="margin-bottom:10px"><div class="of-chips"><input class="of-search" style="max-width:none" data-list-name="' + i + '" value="' + esc(l.name) + '" onchange="_ofListEdit(' + i + ',\'name\',this.value)" placeholder="Checklist name">' +
        whenSel(l.when, i) + '<button class="of-btn sm" onclick="_ofListDel(' + i + ')">Delete</button></div>' +
        '<textarea data-list-items="' + i + '" style="width:100%;box-sizing:border-box;min-height:110px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:inherit;font-size:13px" placeholder="One item a line" onchange="_ofListEdit(' + i + ',\'items\',this.value)">' + esc((l.items || []).join('\n')) + '</textarea></div>';
    }).join('') : '<div class="of-note" style="margin-bottom:8px">No checklists yet.</div>') +
      '<div class="of-chips"><button class="of-btn sm" onclick="_ofListAdd()">+ Add a checklist</button><button class="of-btn pri sm" id="ofListSave" onclick="_ofListSave()">Save checklists</button></div>';
  }
  window._ofListEdit = function(i, k, v){ var l = G.lists[i]; if (!l) return; l[k] = (k === 'items') ? String(v).split('\n').map(function(x){ return x.trim(); }).filter(Boolean) : v; };
  window._ofListAdd = function(){
    if (!G.lists.length) G.lists.push({ id: 'start', name: 'Before we start', when: 'start', items: ['Scaffold / edge protection checked and tagged', 'Site hazards talked through with the crew', 'Customer told we are starting'] });
    else G.lists.push({ id: 'l' + Date.now().toString(36), name: 'New checklist', when: 'start', items: [] });
    renderLists();
  };
  window._ofListDel = function(i){ G.lists.splice(i, 1); renderLists(); };
  window._ofListSave = async function(){
    try { var r = await api('PUT', '/crew/office/settings', { checklists: G.lists }); G.lists = r.checklists || []; renderLists(); toast('Checklists saved — the crew app picks them up next time it opens'); }
    catch (e) { alert(e.message); }
  };
})();
