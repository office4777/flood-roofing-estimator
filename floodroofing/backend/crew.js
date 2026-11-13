// THE CREW APP, the server half (2026-11-13, the owner: "a phone app ...
// offline mode ... Android and iPhone ... GPS ... a calendar ... weekly and
// daily ... links up to the schedule ... the job address ... a Google Maps
// button ... customer name ... phone number ... customer selections and the
// scope of work ... videos ... photos ... files ... checklists ... set in the
// main office app ... the roof map and the job pack ... a timesheet ... the
// time they get to site and the time they leave site ... on-site hours versus
// the travel hours"; then "start the timer from 7 a.m. until 7 p.m. just on
// those days that they're working ... Definitely not any days that aren't
// scheduled").
//
// The crew are the business's own logins (company members). Which crew a
// person is on is `crew_members.crew_id`, one of the schedule board's crews.
// A person's WORKING DAYS are the working dates of the board's crew blocks
// (`kind` 'crew', not a pencil) for their crew. Location is kept ONLY on
// those days, 07:00–19:00 NZ — refused by the server outside them however the
// phone sends it, and a clock event made outside them is kept without its
// position.
//
// Who has it: a business one of CREW_USERS (default the owner's two logins,
// the office menus' list) belongs to; CREW_ALL=true opens it for every
// business. The office side (where everyone is, the hours, who is on which
// crew, the checklists) is for those named logins only.
'use strict';
const crypto = require('crypto');

const NZ = 'Pacific/Auckland';
const GPS_FROM_H = 7, GPS_TO_H = 19;          // 7 am to 7 pm NZ
const SITE_RADIUS_M = 200;                    // a position this close to a site is "on site"
const EV_KINDS = ['on', 'off', 'travel', 'break', 'end', 'check', 'note', 'day'];
// WHAT EACH PERSON SEES (2026-11-13, the owner: "make the individual user
// permissions to show what they can see (and remove the quote from the files,
// i don't need the guys seeing the quoted totals)"). Set per person in the
// office's GPS Map tab; anything not set takes these.
// orderFlash (2026-11-13, the owner: "let office set permissions for who can
// order flashings directly or not"): off, a crew member's flashing order goes
// to the office to send on; on, it goes straight to the roofing supplier.
const PERM_DEFAULTS = { phone: true, scope: true, files: true, photos: true, upload: true, allCrews: true, hours: true, priced: false, orderFlash: false };
function permsOf(m){
  const p = (m && m.perms && typeof m.perms === 'object') ? m.perms : {};
  const o = {}; Object.keys(PERM_DEFAULTS).forEach(k => { o[k] = (k in p) ? !!p[k] : PERM_DEFAULTS[k]; }); return o;
}
// A file with money in it: a quote, an invoice, an order, the pricing.
const PRICED_RE = /quot(e|ation)|invoice|pricing|price|order|estimate|statement|\bSO\b|_SO_/i;
const PRICED_SRC = /quote|pricing|invoice|order/i;
function isPriced(f){ return PRICED_RE.test(String(f.name || '')) || PRICED_SRC.test(String(f.source || '')); }
// "HH:MM" on an NZ date -> ms.
function nzMs(date, hm){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return NaN;
  const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return NaN;
  for (const off of [13, 12]) {
    const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - off, mi);
    const p = nzParts(new Date(t)); if (p.date === date && p.hour === h && p.minute === mi) return t;
  }
  return NaN;
}
const MAX_POINTS = 400, MAX_EVENTS = 300;

function nzParts(d){
  const p = {};
  new Intl.DateTimeFormat('en-NZ', { timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour, minute: +p.minute };
}
const nzDate = (d) => nzParts(d instanceof Date ? d : new Date(d)).date;
function inWindow(d){ const p = nzParts(d); return p.hour >= GPS_FROM_H && p.hour < GPS_TO_H; }
function distM(a, b){
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const okLatLng = (lat, lng) => lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n || 200);

// ── hours, worked out from the clock events ──────────────────────────
// A status runs from its event to the next: 'on' = on site at that job,
// 'travel' = travelling, 'break' and 'off' and 'end' = not counted — except
// that the time from an 'off' at one job to an 'on' at the next the same day
// is travel. A day still running counts to now; a past day left open counts
// to its last event or position and says so (open).
function computeDays(events, points, nowMs){
  const byDay = {};
  // A day typed in (start / finish / break, the office's "enter times" setting)
  // is that day's hours, whatever was pressed: the latest entry for a date wins.
  const typed = {};
  (events || []).filter(e => e.kind === 'day' && e.data && e.data.date).forEach(e => {
    const d = e.data.date; if (!typed[d] || Date.parse(e.at) >= Date.parse(typed[d].at)) typed[d] = e;
  });
  (events || []).filter(e => e.kind !== 'check' && e.kind !== 'note' && e.kind !== 'day').forEach(e => {
    const d = nzDate(e.at); (byDay[d] = byDay[d] || { ev: [], pts: [] }).ev.push(e);
  });
  (points || []).forEach(p => { const d = nzDate(p.at); if (byDay[d]) byDay[d].pts.push(p); });
  const today = nzDate(new Date(nowMs));
  const out = [];
  Object.keys(byDay).sort().forEach(date => {
    const ev = byDay[date].ev.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const lastSeen = Math.max(Date.parse(ev[ev.length - 1].at),
      ...byDay[date].pts.map(p => Date.parse(p.at)).filter(Number.isFinite));
    const onsite = {}; let travel = 0, open = false;
    const add = (st, from, to) => {
      const h = Math.max(0, to - from) / 3600000; if (!h) return;
      if (st.kind === 'on') onsite[st.row] = (onsite[st.row] || 0) + h;
      else if (st.kind === 'travel' || st.kind === 'gap') travel += h;
    };
    let st = null, stAt = 0;
    ev.forEach((e, i) => {
      const t = Date.parse(e.at);
      if (st) add(st, stAt, t);
      if (e.kind === 'on') st = { kind: 'on', row: String(e.row_id || '') };
      else if (e.kind === 'travel') st = { kind: 'travel' };
      else if (e.kind === 'off') {
        const nxt = ev.slice(i + 1).find(x => x.kind !== 'off');
        st = (nxt && nxt.kind === 'on') ? { kind: 'gap' } : null;
      } else st = null;   // break, end
      stAt = t;
    });
    if (st && st.kind !== 'gap') {
      const end = (date === today) ? nowMs : lastSeen;
      add(st, stAt, Math.max(stAt, end)); open = date !== today ? true : open;
    }
    const round = (h) => Math.round(h * 100) / 100;
    const on = Object.keys(onsite).reduce((s, k) => s + onsite[k], 0);
    Object.keys(onsite).forEach(k => { onsite[k] = round(onsite[k]); });
    out.push({ date, onsite, onsiteTotal: round(on), travel: round(travel), total: round(on + travel), open,
      first: ev[0].at, last: ev[ev.length - 1].at, status: (ev[ev.length - 1] || {}).kind });
  });
  Object.keys(typed).forEach(date => {
    const e = typed[date], d = e.data || {};
    const a = nzMs(date, d.start), b = nzMs(date, d.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
    const h = Math.max(0, (b - a) / 3600000 - (Math.max(0, +d.breakMin || 0) / 60));
    const round = (x) => Math.round(x * 100) / 100;
    const row = String(e.row_id || d.row_id || '');
    const day = { date, onsite: row ? { [row]: round(h) } : {}, onsiteTotal: round(h), travel: 0, total: round(h), open: false,
      first: new Date(a).toISOString(), last: new Date(b).toISOString(), status: 'end', typed: { start: d.start, end: d.end, breakMin: +d.breakMin || 0 } };
    const i = out.findIndex(x => x.date === date);
    if (i >= 0) out[i] = day; else out.push(day);
  });
  out.sort((x, y) => x.date < y.date ? -1 : 1);
  return out;
}

function mount(app, deps){
  const { supabase, requireAuth, scopeCompany, recordError, rateLimit,
          schedCfg, schedNonWork, schedBlockDates, schedISO, schedShift, quoteChoiceLines } = deps;
  const noPrice = deps.noPrice || ((a) => a);
  const fileUrl = deps.fileUrl || null;
  const USERS = () => String(process.env.CREW_USERS || process.env.SUPINV_USERS || 'aron@floodroofing.co.nz, aaron@floodroofing.co.nz')
    .split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const rows = (r) => { if (r && r.error) throw new Error(r.error.message); return (r && r.data) || []; };

  // ── who has it ──────────────────────────────────────────────────
  let _coCache = { at: 0, ids: null };
  async function enabledCompanies(){
    if (_coCache.ids && Date.now() - _coCache.at < 5 * 60000) return _coCache.ids;
    const ids = new Set();
    for (const em of USERS()) {
      // ilike, not eq: a profile keeps the address as typed ("Aron@…"), and
      // an exact match missed the owner's own business (2026-11-13).
      const ps = rows(await supabase.from('profiles').select('id, email').ilike('email', em).limit(5))
        .filter(p => String(p.email || '').toLowerCase() === em);
      for (const p of ps) {
        rows(await supabase.from('company_users').select('company_id, user_id').eq('user_id', p.id).limit(10))
          .filter(c => String(c.user_id) === String(p.id)).forEach(c => ids.add(String(c.company_id)));
      }
    }
    _coCache = { at: Date.now(), ids };
    return ids;
  }
  async function companyOn(req){
    if (process.env.CREW_ALL === 'true') return true;
    if (!req.companyId) return false;
    // One of the named logins is always in their own business.
    const own = String((req.user && req.user.email) || '').trim().toLowerCase();
    if (own && USERS().indexOf(own) >= 0) return true;
    try { return (await enabledCompanies()).has(String(req.companyId)); } catch (e) { return false; }
  }
  async function officeOn(req){
    if (process.env.CREW_ALL === 'true') return true;
    let em = String((req.user && req.user.email) || '').trim().toLowerCase();
    if (!em && req.user && req.user.id) {
      try { const p = await supabase.from('profiles').select('email').eq('id', req.user.id).maybeSingle();
        em = String((p && p.data && p.data.email) || '').trim().toLowerCase(); } catch (e) {}
    }
    return !!em && USERS().indexOf(em) >= 0 && await companyOn(req);
  }
  const crewGate = async (req, res, next) => (await companyOn(req)) ? next()
    : res.status(403).json({ error: 'The crew app is not switched on for your business yet.', code: 'CREW_OFF' });
  const officeGate = async (req, res, next) => (await officeOn(req)) ? next()
    : res.status(403).json({ error: 'Only the office can see this.', code: 'CREW_OFFICE_ONLY' });
  const G = [requireAuth, crewGate];
  const O = [requireAuth, officeGate];

  // ── the person ──────────────────────────────────────────────────
  async function memberOf(req, uid){
    const r = rows(await scopeCompany(supabase.from('crew_members').select('*'), req).eq('user_id', uid || req.user.id).limit(1));
    return r[0] || null;
  }
  async function settingsOf(req){
    const r = rows(await scopeCompany(supabase.from('crew_settings').select('*'), req).order('updated_at', { ascending: false }).limit(1));
    const d = (r[0] && r[0].data) || {};
    return { row: r[0] || null, data: { checklists: cleanLists(d.checklists), clockMode: d.clockMode === 'times' ? 'times' : 'button' } };
  }
  function cleanLists(v){
    return (Array.isArray(v) ? v : []).slice(0, 30).map(l => ({
      id: clean(l && l.id, 40).replace(/[^\w-]/g, '') || crypto.randomUUID().slice(0, 8),
      name: clean(l && l.name, 80) || 'Checklist',
      when: ['start', 'daily', 'end'].includes(l && l.when) ? l.when : 'start',
      items: (Array.isArray(l && l.items) ? l.items : []).slice(0, 60).map(x => clean(x, 160)).filter(Boolean),
    })).filter(l => l.items.length);
  }
  async function companyMembers(req){
    const cu = rows(await supabase.from('company_users').select('company_id, user_id, role').eq('company_id', req.companyId).limit(200))
      .filter(c => String(c.company_id) === String(req.companyId));
    const out = [];
    for (const c of cu) {
      let p = null;
      try { p = (await supabase.from('profiles').select('id, email, name').eq('id', c.user_id).maybeSingle()).data; } catch (e) {}
      out.push({ id: String(c.user_id), role: c.role || 'member', email: (p && p.email) || '', name: (p && p.name) || '' });
    }
    return out;
  }

  // ── the board: which days and jobs ──────────────────────────────
  async function board(req){
    const cfg = await schedCfg(req);
    const srs = rows(await scopeCompany(supabase.from('schedule_rows').select('*'), req).eq('archived', false).limit(400));
    const blocks = rows(await scopeCompany(supabase.from('schedule_blocks').select('*'), req).limit(4000))
      .filter(b => b.kind === 'crew' && srs.some(r => r.id === b.row_id));
    let from = schedISO(schedShift(new Date(), -60)), to = schedISO(schedShift(new Date(), 200));
    blocks.forEach(b => { if (b.start_date < from) from = b.start_date; });
    const nonwork = schedNonWork(cfg, from, to);
    const byDate = {};
    blocks.forEach(b => {
      const r = srs.find(x => x.id === b.row_id);
      schedBlockDates(b, nonwork).forEach(d => { (byDate[d] = byDate[d] || []).push({ b, r }); });
    });
    return { cfg, srs, blocks, byDate };
  }
  function bookedFor(bd, crewId, date){
    if (!crewId) return false;
    return (bd.byDate[date] || []).some(x => x.b.crew_id === crewId);
  }
  function jobCard(x, cfg){
    const crew = cfg.crews.find(c => c.id === x.b.crew_id) || {};
    return { row_id: x.r.id, block_id: x.b.id, job_id: x.r.job_id || '', client: x.r.client_name || '', site: x.r.site_address || '',
      job_ref: x.r.job_ref || '', crew_id: x.b.crew_id, crew: crew.name || '', colour: crew.colour || '#94a3b8',
      notes: clean(x.r.notes, 400), progress: x.r.progress_pct == null ? null : x.r.progress_pct };
  }

  // THE HOURS ALLOCATED ON THE QUOTE: what the office stamped (the schedule
  // board's own sum, `crewHours`), else the main roof's crew, the roofs the
  // customer took, the own-crew scaffold and the gutter's typed crew.
  function allocHours(q){
    if (!q || typeof q !== 'object') return null;
    const f = (v) => parseFloat(v) || 0;
    if (q.crewHours && Array.isArray(q.crewHours.items)) {
      const items = q.crewHours.items.map(x => ({ label: clean(x.label, 80), guys: parseInt(x.guys, 10) || 0, total: f(x.total) })).filter(x => x.total > 0);
      return { total: Math.round(items.reduce((a, x) => a + x.total, 0) * 100) / 100, items };
    }
    const items = [];
    const crew = (l) => { l = l || {}; return f(l.leadHrs) + f(l.appHrs) + (Array.isArray(l.extras) ? l.extras.reduce((a, x) => a + f(x && x.hrs), 0) : 0); };
    const add = (label, h) => { if (h > 0) items.push({ label, total: Math.round(h * 100) / 100 }); };
    const sc = q.scaffold || {};
    if (!sc.excluded && sc.mode === 'diy' && sc.diy) add('Scaffolding (own crew)', f(sc.diy.leadHrs) + f(sc.diy.appHrs));
    add('Main roof', crew(q.labour));
    const geom = (q.roofMapGeom && Array.isArray(q.roofMapGeom.roofs)) ? q.roofMapGeom.roofs : [];
    const sel = (q.proposalOptions && q.proposalOptions.extraRoofsSel) || {};
    const rl = (q.roofLabour && typeof q.roofLabour === 'object') ? q.roofLabour : {};
    geom.forEach(r => {
      if (!r || !(r.idx >= 1) || r.mode === 'folded' || r.mode === 'excluded') return;
      if (r.mode === 'separate' && !(r.extraPos != null && sel[r.extraPos] === true)) return;
      add(r.name || ('Roof ' + (r.idx + 1)), crew(rl[r.idx]));
    });
    const gl = q.gutterLabour || {};
    if (f(gl.leadHrs) + f(gl.appHrs) > 0) add('Guttering', f(gl.leadHrs) + f(gl.appHrs));
    if (!items.length) return null;
    return { total: Math.round(items.reduce((a, x) => a + x.total, 0) * 100) / 100, items };
  }

  // ── what the crew sees ──────────────────────────────────────────
  app.get('/crew/enabled', requireAuth, async (req, res) => {
    res.json({ enabled: await companyOn(req), office: await officeOn(req) });
  });
  app.get('/crew/me', ...G, async (req, res) => {
    try {
      const [m, cfg, st, co] = await Promise.all([memberOf(req), schedCfg(req), settingsOf(req),
        supabase.from('companies').select('name').eq('id', req.companyId).maybeSingle()]);
      let prof = null; try { prof = (await supabase.from('profiles').select('name, email').eq('id', req.user.id).maybeSingle()).data; } catch (e) {}
      res.json({ ok: true, user: { id: req.user.id, email: (prof && prof.email) || req.user.email || '', name: (m && m.name) || (prof && prof.name) || '' },
        crew_id: (m && m.crew_id) || '', phone: (m && m.phone) || '', company: (co && co.data && co.data.name) || '',
        crews: cfg.crews.filter(c => c.id !== 'scaffold' || true).map(c => ({ id: c.id, name: c.name, colour: c.colour })),
        checklists: st.data.checklists, clockMode: st.data.clockMode, perms: permsOf(m), office: await officeOn(req),
        gps: { from: GPS_FROM_H, to: GPS_TO_H, rule: 'Location is only recorded 7 am – 7 pm on days your crew is booked on the schedule.' },
        today: nzDate(new Date()) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  async function saveMember(req, uid, patch){
    const cur = await memberOf(req, uid);
    const now = new Date().toISOString();
    if (cur) {
      const { error } = await supabase.from('crew_members').update(Object.assign({ updated_at: now }, patch)).eq('id', cur.id).eq('company_id', req.companyId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('crew_members').insert(Object.assign({ id: crypto.randomUUID(), company_id: req.companyId,
        user_id: uid, crew_id: '', name: '', phone: '', updated_at: now }, patch));
      if (error) throw new Error(error.message);
    }
  }
  app.put('/crew/me', ...G, async (req, res) => {
    try {
      const b = req.body || {}, cfg = await schedCfg(req), patch = {};
      if ('crew_id' in b) {
        const id = clean(b.crew_id, 40);
        if (id && !cfg.crews.some(c => c.id === id)) return res.status(400).json({ error: 'That crew is not on the schedule.' });
        patch.crew_id = id;
      }
      if ('name' in b) patch.name = clean(b.name, 80);
      if ('phone' in b) patch.phone = clean(b.phone, 40);
      await saveMember(req, req.user.id, patch);
      res.json({ ok: true });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // The calendar: ?from=YYYY-MM-DD&days=N (default this week's Monday, 14).
  // ?all=1 shows every crew's jobs (the person's own crew is still marked).
  app.get('/crew/week', ...G, async (req, res) => {
    try {
      const m = await memberOf(req); const crewId = (m && m.crew_id) || '';
      const bd = await board(req);
      const today = nzDate(new Date());
      let from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : null;
      if (!from) { const t = new Date(today + 'T00:00:00Z'); const dow = (t.getUTCDay() + 6) % 7; from = schedISO(schedShift(t, -dow)); }
      const n = Math.max(1, Math.min(42, parseInt(req.query.days, 10) || 14));
      const all = req.query.all === '1' && permsOf(m).allCrews;
      const nonwork = schedNonWork(bd.cfg, from, schedISO(schedShift(new Date(from + 'T00:00:00Z'), n)));
      const days = [];
      for (let i = 0; i < n; i++) {
        const date = schedISO(schedShift(new Date(from + 'T00:00:00Z'), i));
        const list = (bd.byDate[date] || []).filter(x => all || x.b.crew_id === crewId).map(x => jobCard(x, bd.cfg));
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        days.push({ date, dow, weekend: dow === 0 || dow === 6, nonwork: nonwork.has(date),
          booked: bookedFor(bd, crewId, date), jobs: list });
      }
      res.json({ ok: true, crew_id: crewId, today, from, days });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // One job, everything a roofer needs on site.
  app.get('/crew/row/:id', ...G, async (req, res) => {
    try {
      const r = rows(await scopeCompany(supabase.from('schedule_rows').select('*'), req).eq('id', req.params.id).limit(1))[0];
      if (!r) return res.status(404).json({ error: 'That job is not on the schedule.' });
      const bd = await board(req);
      const days = Object.keys(bd.byDate).filter(d => bd.byDate[d].some(x => x.r.id === r.id)).sort();
      const perms = permsOf(await memberOf(req));
      const out = { row_id: r.id, job_id: r.job_id || '', client: r.client_name || '', site: r.site_address || '', email: r.email || '',
        job_ref: r.job_ref || '', notes: clean(r.notes, 2000), days, phone: '', choices: [], scope: [], exclusions: [], quoteNotes: [],
        description: '', files: [], checks: {}, site_point: null, perms, fergus_id: clean(r.fergus_job_id, 40), map_file: null,
        alloc: null, used: null };
      if (r.job_id) {
        const j = rows(await scopeCompany(supabase.from('jobs').select('id, version_of, client_name, site_address, ' +
          'quote:draw_state->state->quote, form:draw_state->form, linked:draw_state->state->linkedJobId'), req).eq('id', r.job_id).limit(1))[0];
        if (j) {
          const q = j.quote || {};
          const acc = (q.versions && q.versions.accepted && q.versions.accepted.quote) || null;
          const useQ = acc ? Object.assign({}, q, acc, { accepted: q.accepted || acc.accepted }) : q;
          out.client = out.client || j.client_name || ''; out.site = out.site || j.site_address || '';
          out.phone = clean((j.form && j.form.jobPhone) || q.phone || (q.client && q.client.phone) || '', 40);
          out.email = out.email || clean((q.client && q.client.email) || q.email || '', 120);
          out.job_ref = out.job_ref || clean(q.ref, 40);
          if (!out.fergus_id && j.linked) out.fergus_id = clean(j.linked, 40);
          // The crew never see money: every choice line goes without its price.
          try { out.choices = noPrice((quoteChoiceLines(useQ) || []).map(x => clean(x, 300))).slice(0, 60); } catch (e) {}
          const gradeLine = out.choices.find(x => /^steel grade:/i.test(x));
          const grade = gradeLine ? gradeLine.replace(/^steel grade:\s*/i, '') : '';
          const lines = (v) => (Array.isArray(v) ? v : []).map(x => clean(typeof x === 'string' ? x : (x && (x.text || x.t)), 300))
            .filter(Boolean).map(x => x.replace(/\{grade\}/gi, grade || 'roofing')).slice(0, 40);
          out.scope = lines(useQ.custDesc); out.exclusions = lines(useQ.custExcl); out.quoteNotes = lines(useQ.custNotes);
          out.description = clean(useQ.scope, 2000);
          out.alloc = allocHours(useQ);
          const root = String(j.version_of || j.id);
          const fs = rows(await scopeCompany(supabase.from('job_files').select('id, name, mime, size, kind, source, author, status, created_at'), req)
            .eq('job_id', root).order('created_at', { ascending: false }).limit(300));
          out.files = fs.filter(f => f.status === 'ready' && (perms.priced || !isPriced(f))).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind,
            source: f.source || '', author: f.author || '', at: f.created_at }));
          const mf = out.files.find(f => f.source === 'roof-map-auto' && /^image\//.test(f.mime || ''));
          if (mf) out.map_file = mf.id;
        }
      }
      // Checklist state: the latest tick per list + item on this job.
      const ev = rows(await scopeCompany(supabase.from('crew_events').select('*'), req).eq('row_id', r.id).limit(2000));
      ev.filter(e => e.kind === 'check').sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach(e => {
        const d = e.data || {}; const k = clean(d.list, 40) + ':' + (parseInt(d.item, 10) || 0) + (d.day ? ':' + d.day : '');
        out.checks[k] = { done: !!d.done, at: e.at, by: e.user_id };
      });
      out.notesFromCrew = ev.filter(e => e.kind === 'note').sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30)
        .map(e => ({ at: e.at, by: e.user_id, text: clean(e.data && e.data.text, 1000) }));
      const site = rows(await scopeCompany(supabase.from('crew_sites').select('*'), req).eq('row_id', r.id).limit(1))[0];
      if (site) out.site_point = { lat: site.lat, lng: site.lng };
      // Hours used so far: everyone's time on site at this job.
      try {
        const who = [...new Set(ev.map(e => String(e.user_id)))];
        let used = 0;
        for (const uid of who) {
          const all = rows(await scopeCompany(supabase.from('crew_events').select('*'), req).eq('user_id', uid).limit(5000))
            .filter(e => String(e.user_id) === uid);
          computeDays(all, [], Date.now()).forEach(d => { used += (d.onsite[r.id] || 0); });
        }
        out.used = Math.round(used * 100) / 100;
      } catch (e) {}
      if (!perms.phone) out.phone = '';
      if (!perms.scope) { out.choices = []; out.scope = []; out.exclusions = []; out.quoteNotes = []; out.description = ''; }
      if (!perms.files) out.files = out.files.filter(f => /^(image|video)\//.test(f.mime || '') || /job ?pack|roof ?map/i.test(f.name) || /auto$/.test(f.source || ''));
      if (!perms.photos) out.files = out.files.filter(f => !/^(image|video)\//.test(f.mime || '') || f.source === 'roof-map-auto');
      if (!perms.hours) { out.alloc = null; out.used = null; }
      res.json(Object.assign({ ok: true }, out));
    } catch (e) { recordError('crew', e, { route: 'GET /crew/row/:id' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // The job's pictures with links that open them (one read, not one per photo).
  app.get('/crew/row/:id/media', ...G, async (req, res) => {
    try {
      const perms = permsOf(await memberOf(req));
      const r = rows(await scopeCompany(supabase.from('schedule_rows').select('id, job_id'), req).eq('id', req.params.id).limit(1))[0];
      if (!r || !r.job_id) return res.json({ ok: true, items: [] });
      const j = rows(await scopeCompany(supabase.from('jobs').select('id, version_of'), req).eq('id', r.job_id).limit(1))[0];
      if (!j || !fileUrl) return res.json({ ok: true, items: [] });
      const root = String(j.version_of || j.id);
      const fs = rows(await scopeCompany(supabase.from('job_files').select('id, name, mime, source, status, storage_path, created_at'), req)
        .eq('job_id', root).order('created_at', { ascending: false }).limit(300))
        .filter(f => f.status === 'ready' && /^(image|video)\//.test(f.mime || '') && (perms.priced || !isPriced(f)))
        .filter(f => req.query.map === '1' ? f.source === 'roof-map-auto' : (perms.photos && f.source !== 'roof-map-auto'))
        .slice(0, req.query.map === '1' ? 1 : 120);
      const items = [];
      for (const f of fs) { try { items.push({ id: f.id, name: f.name, mime: f.mime, at: f.created_at, url: await fileUrl(f.storage_path, 3600) }); } catch (e) {} }
      res.json({ ok: true, items });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // The phone's queue: clock events, checklist ticks, notes and positions.
  // Each event carries the phone's own id so a resend is kept once.
  app.post('/crew/sync', ...G, rateLimit(240, 60000), async (req, res) => {
    try {
      const b = req.body || {};
      const m = await memberOf(req); const crewId = (m && m.crew_id) || '';
      const bd = await board(req);
      const now = Date.now();
      const okTime = (t) => Number.isFinite(t) && t <= now + 5 * 60000 && t >= now - 21 * 86400000;
      const mayLocate = (t) => inWindow(new Date(t)) && bookedFor(bd, crewId, nzDate(new Date(t)));
      const kept = [], dup = [], bad = [];
      for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, MAX_EVENTS)) {
        const cid = clean(e && e.client_id, 80); const t = Date.parse(e && e.at);
        if (!cid || !EV_KINDS.includes(e.kind) || !okTime(t)) { bad.push(cid); continue; }
        const have = rows(await scopeCompany(supabase.from('crew_events').select('id, client_id, user_id'), req).eq('client_id', cid).limit(1))
          .filter(x => x.client_id === cid && String(x.user_id) === String(req.user.id));
        if (have.length) { dup.push(cid); continue; }
        let lat = num(e.lat), lng = num(e.lng);
        if (!okLatLng(lat, lng) || !mayLocate(t)) { lat = null; lng = null; }
        const tm = (v) => /^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : '';
        const data = (e.data && typeof e.data === 'object') ? (e.kind === 'day' ? {
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date || '')) ? String(e.data.date) : nzDate(new Date(t)),
          start: tm(e.data.start), end: tm(e.data.end), breakMin: Math.max(0, Math.min(600, parseInt(e.data.breakMin, 10) || 0)) } : {
          list: clean(e.data.list, 40), item: parseInt(e.data.item, 10) || 0, done: !!e.data.done, day: clean(e.data.day, 10),
          text: clean(e.data.text, 1000) }) : null;
        if (e.kind === 'day' && (!data || !data.start || !data.end)) { bad.push(cid); continue; }
        const row = { id: crypto.randomUUID(), company_id: req.companyId, user_id: req.user.id, client_id: cid, kind: e.kind,
          row_id: clean(e.row_id, 60), job_id: clean(e.job_id, 60), at: new Date(t).toISOString(), lat, lng,
          acc: lat == null ? null : num(e.acc), data, created_at: new Date().toISOString() };
        const { error } = await supabase.from('crew_events').insert(row);
        if (error) throw new Error(error.message);
        kept.push(cid);
        // The first clock-on with a position teaches the job where its site is.
        if (e.kind === 'on' && row.row_id && lat != null) {
          const s = rows(await scopeCompany(supabase.from('crew_sites').select('id, row_id'), req).eq('row_id', row.row_id).limit(1))
            .filter(x => x.row_id === row.row_id);
          if (!s.length) await supabase.from('crew_sites').insert({ id: crypto.randomUUID(), company_id: req.companyId,
            user_id: req.user.id, row_id: row.row_id, lat, lng, at: row.at });
        }
      }
      let points = 0, refused = 0;
      const pts = [];
      for (const p of (Array.isArray(b.points) ? b.points : []).slice(0, MAX_POINTS)) {
        const t = Date.parse(p && p.at), lat = num(p && p.lat), lng = num(p && p.lng);
        if (!okTime(t) || !okLatLng(lat, lng) || !mayLocate(t)) { refused++; continue; }
        pts.push({ id: crypto.randomUUID(), company_id: req.companyId, user_id: req.user.id, at: new Date(t).toISOString(),
          lat, lng, acc: num(p.acc), speed: num(p.speed), row_id: clean(p.row_id, 60), created_at: new Date().toISOString() });
      }
      if (pts.length) { const { error } = await supabase.from('crew_points').insert(pts); if (error) throw new Error(error.message); points = pts.length; }
      res.json({ ok: true, kept, dup, bad, points, refused });
    } catch (e) { recordError('crew', e, { route: 'POST /crew/sync' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // Today's status for the phone: booked? may it locate now? what is it on?
  app.get('/crew/status', ...G, async (req, res) => {
    try {
      const m = await memberOf(req); const crewId = (m && m.crew_id) || '';
      const bd = await board(req); const now = new Date(); const today = nzDate(now);
      res.json({ ok: true, today, booked: bookedFor(bd, crewId, today), window: inWindow(now),
        may_locate: inWindow(now) && bookedFor(bd, crewId, today), crew_id: crewId });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  async function hoursFor(req, uid, from, to){
    const ev = rows(await scopeCompany(supabase.from('crew_events').select('*'), req).eq('user_id', uid).limit(5000))
      .filter(e => { if (String(e.user_id) !== String(uid)) return false;
        // a typed day belongs to the date it is for, not the day it was typed
        const d = (e.kind === 'day' && e.data && e.data.date) ? e.data.date : nzDate(e.at);
        return d >= from && d <= to; });
    const pts = rows(await scopeCompany(supabase.from('crew_points').select('at, user_id'), req).eq('user_id', uid).limit(20000))
      .filter(p => String(p.user_id) === String(uid) && nzDate(p.at) >= from && nzDate(p.at) <= to);
    return computeDays(ev, pts, Date.now());
  }
  function range(q){
    const today = nzDate(new Date());
    const t = new Date(today + 'T00:00:00Z'); const dow = (t.getUTCDay() + 6) % 7;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : schedISO(schedShift(t, -dow));
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? String(q.to) : schedISO(schedShift(new Date(from + 'T00:00:00Z'), 6));
    return { from, to };
  }
  async function rowNames(req){
    const srs = rows(await scopeCompany(supabase.from('schedule_rows').select('id, client_name, site_address, job_ref'), req).limit(800));
    const o = {}; srs.forEach(r => { o[r.id] = { client: r.client_name || '', site: r.site_address || '', job_ref: r.job_ref || '' }; }); return o;
  }
  app.get('/crew/hours', ...G, async (req, res) => {
    try {
      const { from, to } = range(req.query);
      res.json({ ok: true, from, to, days: await hoursFor(req, req.user.id, from, to), rows: await rowNames(req) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // ── the office ──────────────────────────────────────────────────
  app.get('/crew/office/now', ...O, async (req, res) => {
    try {
      const [mem, crewRows, bd] = await Promise.all([companyMembers(req),
        scopeCompany(supabase.from('crew_members').select('*'), req).limit(200).then(rows), board(req)]);
      const today = nzDate(new Date());
      const names = await rowNames(req);
      const out = [];
      for (const p of mem) {
        const cm = crewRows.find(c => String(c.user_id) === p.id) || {};
        const ev = rows(await scopeCompany(supabase.from('crew_events').select('*'), req).eq('user_id', p.id).limit(3000))
          .filter(e => String(e.user_id) === p.id && nzDate(e.at) === today && e.kind !== 'check' && e.kind !== 'note' && e.kind !== 'day')
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const pts = rows(await scopeCompany(supabase.from('crew_points').select('*'), req).eq('user_id', p.id).limit(20000))
          .filter(x => String(x.user_id) === p.id && nzDate(x.at) === today).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const last = pts[pts.length - 1] || null, le = ev[ev.length - 1] || null;
        const crew = bd.cfg.crews.find(c => c.id === cm.crew_id) || {};
        out.push({ id: p.id, name: cm.name || p.name || p.email, email: p.email, role: p.role, crew_id: cm.crew_id || '',
          crew: crew.name || '', colour: crew.colour || '#94a3b8', booked: bookedFor(bd, cm.crew_id, today),
          status: le ? le.kind : '', status_at: le ? le.at : null, status_row: le ? (names[le.row_id] || null) : null,
          last: last ? { lat: last.lat, lng: last.lng, at: last.at, acc: last.acc } : null,
          track: pts.slice(-300).map(x => [x.lat, x.lng]) });
      }
      const sites = rows(await scopeCompany(supabase.from('crew_sites').select('*'), req).limit(500))
        .map(s => Object.assign({ lat: s.lat, lng: s.lng, row_id: s.row_id }, names[s.row_id] || {}));
      res.json({ ok: true, today, people: out, sites });
    } catch (e) { recordError('crew', e, { route: 'GET /crew/office/now' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/crew/office/hours', ...O, async (req, res) => {
    try {
      const { from, to } = range(req.query);
      const mem = await companyMembers(req);
      const crewRows = rows(await scopeCompany(supabase.from('crew_members').select('*'), req).limit(200));
      const people = [];
      for (const p of mem) {
        const days = await hoursFor(req, p.id, from, to);
        const cm = crewRows.find(c => String(c.user_id) === p.id) || {};
        if (days.length || cm.crew_id) people.push({ id: p.id, name: cm.name || p.name || p.email, crew_id: cm.crew_id || '', days });
      }
      res.json({ ok: true, from, to, people, rows: await rowNames(req) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/crew/office/members', ...O, async (req, res) => {
    try {
      const [mem, cfg] = await Promise.all([companyMembers(req), schedCfg(req)]);
      const crewRows = rows(await scopeCompany(supabase.from('crew_members').select('*'), req).limit(200));
      res.json({ ok: true, crews: cfg.crews.map(c => ({ id: c.id, name: c.name, colour: c.colour })),
        members: mem.map(p => { const cm = crewRows.find(c => String(c.user_id) === p.id) || {};
          return Object.assign({}, p, { crew_id: cm.crew_id || '', crew_name: cm.name || '', perms: permsOf(cm) }); }),
        permKeys: Object.keys(PERM_DEFAULTS) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.put('/crew/office/members/:uid', ...O, async (req, res) => {
    try {
      const mem = await companyMembers(req);
      if (!mem.some(p => p.id === String(req.params.uid))) return res.status(404).json({ error: 'Not in this business.' });
      const cfg = await schedCfg(req); const b = req.body || {}; const patch = {};
      if ('crew_id' in b) {
        const id = clean(b.crew_id, 40);
        if (id && !cfg.crews.some(c => c.id === id)) return res.status(400).json({ error: 'That crew is not on the schedule.' });
        patch.crew_id = id;
      }
      if ('name' in b) patch.name = clean(b.name, 80);
      if (b.perms && typeof b.perms === 'object') {
        const cur = permsOf(await memberOf(req, String(req.params.uid)));
        Object.keys(PERM_DEFAULTS).forEach(k => { if (k in b.perms) cur[k] = !!b.perms[k]; });
        patch.perms = cur;
      }
      await saveMember(req, String(req.params.uid), patch);
      res.json({ ok: true });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/crew/office/settings', ...O, async (req, res) => {
    try { res.json(Object.assign({ ok: true }, (await settingsOf(req)).data)); }
    catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.put('/crew/office/settings', ...O, async (req, res) => {
    try {
      const b = req.body || {};
      const { row, data: cur } = await settingsOf(req); const now = new Date().toISOString();
      const data = { checklists: ('checklists' in b) ? cleanLists(b.checklists) : cur.checklists,
        clockMode: ('clockMode' in b) ? (b.clockMode === 'times' ? 'times' : 'button') : cur.clockMode };
      let error;
      if (row) ({ error } = await supabase.from('crew_settings').update({ data, updated_at: now }).eq('id', row.id).eq('company_id', req.companyId));
      else ({ error } = await supabase.from('crew_settings').insert({ id: crypto.randomUUID(), company_id: req.companyId, user_id: req.user.id, data, updated_at: now }));
      if (error) throw new Error(error.message);
      res.json(Object.assign({ ok: true }, data));
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  // ── ORDER FLASHING (2026-11-13, the owner: "add a order flashing menu button
  // in the job ... edit a saved flashing (opens the list of saved flashings
  // from the office app or draw in custom flashing) ... asks for the quantity
  // and length and allow to edit the saved measures ... finish flashing then
  // goes to a summary to either order the flashing or add another flashing").
  // The library is the business's own saved flashings, then the app's shipped
  // presets, then the platform's back-trays. The order is drawn as a PDF here
  // (lines and Helvetica, nothing to upload from a phone on a roof).
  const flashLib = deps.flashLib || (async () => ({ saved: [], suppliers: [], officeEmail: '', company: '' }));
  const crewMail = deps.crewMail || null;
  async function libraryOf(req){
    const lib = await flashLib(req.companyId);
    const out = [], seen = {};
    const low = (n) => String(n || '').trim().toLowerCase();
    const add = (e, src) => {
      const f = cleanFlash(e); if (!f || !f.polylines.length) return;
      const k = low(f.name) + '|' + low(f.profile);
      if (seen[k] || (src !== 'saved' && seen[low(f.name) + '|*'])) return;
      seen[k] = 1; if (src === 'saved') seen[low(f.name) + '|*'] = 1;
      out.push(Object.assign(f, { id: src + ':' + out.length, src }));
    };
    (lib.saved || []).forEach(e => add(e, 'saved'));
    FLASH_PRESETS.forEach(e => add(e, 'builtin'));
    try {
      const r = await supabase.from('platform_state').select('value').eq('key', 'builtin_flashings').maybeSingle();
      const v = r && r.data && r.data.value; ((v && v.items) || []).forEach(e => add(e, 'builtin'));
    } catch (e) {}
    const suppliers = (lib.suppliers || []).filter(s => s && s.email && /@/.test(String(s.email)) && ['roofing', '', undefined, null].includes(s.category))
      .map((s, i) => ({ i, name: clean(s.name, 80) || clean(s.email, 120), email: clean(s.email, 160) }));
    return { items: out, suppliers, officeEmail: clean(lib.officeEmail, 160), company: clean(lib.company, 120) };
  }
  app.get('/crew/flashings', ...G, async (req, res) => {
    try {
      const perms = permsOf(await memberOf(req));
      const lib = await libraryOf(req);
      res.json({ ok: true, items: lib.items, direct: perms.orderFlash,
        suppliers: perms.orderFlash ? lib.suppliers.map(s => ({ i: s.i, name: s.name })) : [], office: !!lib.officeEmail });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  async function rowInfo(req, rowId){
    const r = rows(await scopeCompany(supabase.from('schedule_rows').select('id, job_id, client_name, site_address, job_ref'), req).eq('id', rowId).limit(1))[0];
    return r || null;
  }
  async function personName(req){
    const m = await memberOf(req);
    let p = null; try { p = (await supabase.from('profiles').select('name, email').eq('id', req.user.id).maybeSingle()).data; } catch (e) {}
    return clean((m && m.name) || (p && p.name) || (p && p.email) || req.user.email || 'The crew', 80);
  }
  async function sendOrder(req, order, job, to, toName, lib){
    if (!crewMail) throw new Error('Email is not set up on this server.');
    const pdf = flashOrderPdf(order, job, lib.company);
    const where = [job.client_name, job.site_address].filter(Boolean).join(', ');
    const items = order.items || [];
    const lm = items.reduce((a, x) => a + x.qty * x.lengthM, 0);
    const lines = items.map((x, i) => (i + 1) + '. ' + x.name + (x.profile ? ' (' + x.profile + ')' : '') + ' — ' + x.qty + ' × ' + fmtM(x.lengthM) +
      ', girth ' + Math.round(x.girthMm) + ' mm, ' + x.folds + ' bends' + (x.hems ? ', ' + x.hems + ' hems' : '') + (x.colour ? ', ' + x.colour : ''));
    const toOffice = order.status !== 'sent';
    const subject = (toOffice ? 'Flashing order to send on — ' : 'Flashing order — ') + (where || 'job') + (job.job_ref ? ' (Job ' + job.job_ref + ')' : '');
    const head = toOffice
      ? order.by + ' has drawn up a flashing order on the crew app. It has NOT gone to a supplier — send it on from RoofMap (GPS Map → Flashing orders), or forward this email.'
      : 'Hi ' + (toName || 'there') + ',\n\nPlease supply the flashings below. The drawings, with every measurement and the colour side, are in the attached PDF.';
    const text = head + '\n\nJob: ' + (where || '—') + (job.job_ref ? '\nJob number: ' + job.job_ref : '') + '\nDeliver to: ' + (job.site_address || '—') +
      '\nOrdered by: ' + order.by + '\n\n' + lines.join('\n') + '\n\nTotal: ' + items.reduce((a, x) => a + x.qty, 0) + ' lengths, ' + fmtM(lm) + ' lineal' +
      (order.note ? '\n\nNote: ' + order.note : '') + '\n\n' + (lib.company || '');
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a"><p>' + esc(head).replace(/\n/g, '<br>') + '</p>' +
      '<p><b>Job:</b> ' + esc(where || '—') + (job.job_ref ? '<br><b>Job number:</b> ' + esc(job.job_ref) : '') + '<br><b>Deliver to:</b> ' + esc(job.site_address || '—') +
      '<br><b>Ordered by:</b> ' + esc(order.by) + '</p><table cellpadding="6" style="border-collapse:collapse;font-size:13px"><tr style="background:#0a1628;color:#fff">' +
      '<th align="left">#</th><th align="left">Flashing</th><th align="left">Colour</th><th align="right">Girth</th><th align="right">Bends</th><th align="right">Qty</th><th align="right">Length</th></tr>' +
      items.map((x, i) => '<tr style="border-bottom:1px solid #dde4ee"><td>' + (i + 1) + '</td><td>' + esc(x.name) + (x.profile ? ' <span style="color:#5b6b80">(' + esc(x.profile) + ')</span>' : '') +
        '</td><td>' + esc(x.colour || '—') + '</td><td align="right">' + Math.round(x.girthMm) + ' mm</td><td align="right">' + x.folds + (x.hems ? ' + ' + x.hems + ' hem' + (x.hems > 1 ? 's' : '') : '') + '</td><td align="right">' + x.qty + '</td><td align="right">' + fmtM(x.lengthM) + '</td></tr>').join('') +
      '</table>' + (order.note ? '<p><b>Note:</b> ' + esc(order.note).replace(/\n/g, '<br>') + '</p>' : '') + '<p>' + esc(lib.company || '') + '</p></div>';
    const fname = 'Flashing order - ' + (job.job_ref || job.client_name || 'job') + '.pdf';
    return crewMail(req, { to, subject, text, html, toOffice, officeEmail: lib.officeEmail,
      attachments: [{ filename: fname, base64: pdf.toString('base64') }] });
  }
  app.post('/crew/flash-order', ...G, rateLimit(20, 60000), async (req, res) => {
    try {
      const b = req.body || {};
      const job = await rowInfo(req, clean(b.row_id, 60));
      if (!job) return res.status(404).json({ error: 'That job is not on the schedule.' });
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30).map(orderItem).filter(Boolean);
      if (!items.length) return res.status(400).json({ error: 'Add a flashing first.' });
      const perms = permsOf(await memberOf(req));
      const lib = await libraryOf(req);
      const by = await personName(req);
      let supplier = null;
      if (perms.orderFlash && b.direct !== false) supplier = lib.suppliers.find(s => s.i === parseInt(b.supplier, 10)) || (lib.suppliers.length === 1 ? lib.suppliers[0] : null);
      const order = { id: crypto.randomUUID(), company_id: req.companyId, user_id: req.user.id, row_id: job.id, job_id: job.job_id || '',
        items, note: clean(b.note, 1000), by, status: supplier ? 'sent' : 'office', supplier_name: supplier ? supplier.name : '',
        supplier_email: supplier ? supplier.email : '', sent_at: null, created_at: new Date().toISOString() };
      const dbRow = Object.assign({}, order, { by_name: order.by }); delete dbRow.by;
      const { error } = await supabase.from('crew_flash_orders').insert(dbRow);
      if (error) throw new Error(error.message);
      let mailed = false, mailErr = '';
      try {
        const to = supplier ? supplier.email : lib.officeEmail;
        if (to) { await sendOrder(req, order, job, to, supplier && supplier.name, lib); mailed = true; }
        else mailErr = 'The office has no email address in Settings → Branding.';
      } catch (e) { mailErr = e.message; recordError('crew', e, { route: 'POST /crew/flash-order' }); }
      const now = new Date().toISOString();
      if (supplier && mailed) await supabase.from('crew_flash_orders').update({ sent_at: now }).eq('id', order.id).eq('company_id', req.companyId);
      if (supplier && !mailed) await supabase.from('crew_flash_orders').update({ status: 'office' }).eq('id', order.id).eq('company_id', req.companyId);
      res.json({ ok: true, id: order.id, status: supplier && mailed ? 'sent' : 'office', supplier: supplier && mailed ? supplier.name : '', mailed, mailErr });
    } catch (e) { recordError('crew', e, { route: 'POST /crew/flash-order' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/crew/office/flash-orders', ...O, async (req, res) => {
    try {
      const os = rows(await scopeCompany(supabase.from('crew_flash_orders').select('*'), req).order('created_at', { ascending: false }).limit(60));
      const names = await rowNames(req);
      const lib = await libraryOf(req);
      res.json({ ok: true, suppliers: lib.suppliers, orders: os.map(o => Object.assign({ id: o.id, row_id: o.row_id, by: o.by_name || '', status: o.status, note: o.note,
        supplier_name: o.supplier_name, sent_at: o.sent_at, created_at: o.created_at, items: o.items || [] }, { job: names[o.row_id] || null })) });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.get('/crew/office/flash-orders/:id/pdf', ...O, async (req, res) => {
    try {
      const o = rows(await scopeCompany(supabase.from('crew_flash_orders').select('*'), req).eq('id', req.params.id).limit(1))[0];
      if (!o) return res.status(404).json({ error: 'Not found.' });
      const job = (await rowInfo(req, o.row_id)) || {};
      const lib = await libraryOf(req);
      res.json({ ok: true, filename: 'Flashing order - ' + (job.job_ref || job.client_name || 'job') + '.pdf', base64: flashOrderPdf(Object.assign({ by: o.by_name || '' }, o), job, lib.company).toString('base64') });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });
  app.post('/crew/office/flash-orders/:id/send', ...O, async (req, res) => {
    try {
      const o = rows(await scopeCompany(supabase.from('crew_flash_orders').select('*'), req).eq('id', req.params.id).limit(1))[0];
      if (!o) return res.status(404).json({ error: 'Not found.' });
      const b = req.body || {}; const email = clean(b.email, 160), name = clean(b.name, 80);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Pick a supplier with an email address.' });
      const job = (await rowInfo(req, o.row_id)) || {};
      const lib = await libraryOf(req);
      const order = Object.assign({}, o, { status: 'sent', by: o.by_name || '' });
      await sendOrder(req, order, job, email, name, lib);
      const now = new Date().toISOString();
      await supabase.from('crew_flash_orders').update({ status: 'sent', supplier_name: name || email, supplier_email: email, sent_at: now }).eq('id', o.id).eq('company_id', req.companyId);
      res.json({ ok: true, sent_at: now });
    } catch (e) { recordError('crew', e, { route: 'POST /crew/office/flash-orders/:id/send' }); res.status(502).json({ error: e.message }); }
  });
  app.post('/crew/office/flash-orders/:id/done', ...O, async (req, res) => {
    try {
      const { error } = await supabase.from('crew_flash_orders').update({ status: 'done' }).eq('id', req.params.id).eq('company_id', req.companyId);
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  return { computeDays, enabledFor: companyOn, inWindow, nzParts, distM };
}

// ── the flashing data: the office's own shape, cleaned ─────────────
let FLASH_PRESETS = [];
try { FLASH_PRESETS = require('./flash-presets.json'); } catch (e) { FLASH_PRESETS = []; }
function fnum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function cleanPoly(p){
  if (!p || !Array.isArray(p.vertices)) return null;
  const vs = p.vertices.slice(0, 80).map(v => Array.isArray(v) ? [fnum(v[0]), fnum(v[1])] : null).filter(v => v && v[0] != null && v[1] != null);
  if (vs.length < 2) return null;
  const meas = {};
  const m = (p.measurements && typeof p.measurements === 'object') ? p.measurements : {};
  // key i is the side from vertex i to i + 1 (the office's own numbering)
  Object.keys(m).forEach(k => { const i = parseInt(k, 10), n = fnum(m[k]); if (i >= 0 && i < vs.length - 1 && n != null && n > 0 && n < 100000) meas[i] = Math.round(n * 10) / 10; });
  const cf = {};
  if (p.crushFolds && typeof p.crushFolds === 'object') Object.keys(p.crushFolds).forEach(k => { const v = p.crushFolds[k]; if (!v) return;
    cf[parseInt(k, 10) || 0] = (typeof v === 'object' && fnum(v.dirX) != null) ? { dirX: fnum(v.dirX), dirY: fnum(v.dirY) || 0 } : true; });
  const o = { vertices: vs, measurements: meas };
  if (Object.keys(cf).length) o.crushFolds = cf;
  if (p.kind === 'squiggle') o.kind = 'squiggle';
  return o;
}
function cleanFlash(e){
  if (!e || typeof e !== 'object') return null;
  const polylines = (Array.isArray(e.polylines) ? e.polylines : []).slice(0, 8).map(cleanPoly).filter(Boolean);
  const ps = e.paintedSide && typeof e.paintedSide === 'object' && fnum(e.paintedSide.x) != null
    ? { x: fnum(e.paintedSide.x), y: fnum(e.paintedSide.y) || 0, dirX: fnum(e.paintedSide.dirX) || 0, dirY: fnum(e.paintedSide.dirY) || 0 } : null;
  return { name: clean(e.name, 80) || 'Flashing', profile: clean(e.profile, 40), flashingType: clean(e.flashingType, 40), polylines, paintedSide: ps };
}
function flashStats(f){
  // bends (a corner at every inner point) and hems (a crush fold) — the office's own two counts
  let girth = 0, folds = 0, hems = 0;
  f.polylines.forEach(p => { if (p.kind === 'squiggle') return; Object.keys(p.measurements).forEach(k => { girth += +p.measurements[k] || 0; });
    if (p.vertices.length >= 3) folds += p.vertices.length - 2;
    if (p.crushFolds) hems += Object.keys(p.crushFolds).length; });
  return { girth: Math.round(girth * 10) / 10, folds, hems };
}
function orderItem(x){
  const f = cleanFlash(x); if (!f || !f.polylines.length) return null;
  const st = flashStats(f);
  if (!(st.girth > 0)) return null;
  const qty = Math.max(1, Math.min(500, parseInt(x.qty, 10) || 1));
  const len = Math.max(0.1, Math.min(12, Math.round((parseFloat(x.lengthM) || 0) * 100) / 100));
  return Object.assign(f, { colour: clean(x.colour, 60), qty, lengthM: len, girthMm: st.girth, folds: st.folds, hems: st.hems });
}
function fmtM(m){ return (Math.round((+m || 0) * 100) / 100).toFixed(2) + ' m'; }

// ── the PDF: page 1 the order, then two flashings a page, drawn ─────
function pdfText(t){ return String(t == null ? '' : t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/×/g, 'x').replace(/[^\x20-\x7e -ÿ]/g, '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function flashOrderPdf(order, job, company){
  const W = 595, H = 842, M = 40;
  const pages = [];
  const items = order.items || [];
  let ops = [];
  const T = (x, y, s, t, bold, rgb) => ops.push((rgb || '0.06 0.09 0.16') + ' rg BT /' + (bold ? 'F2' : 'F1') + ' ' + s + ' Tf ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + pdfText(t) + ') Tj ET');
  const tw = (t, s) => String(t).length * s * 0.5;
  // page 1
  ops.push('0.039 0.086 0.157 rg 0 ' + (H - 70) + ' ' + W + ' 70 re f');
  T(M, H - 42, 20, 'Flashing order', true, '1 1 1');
  if (company) T(W - M - tw(company, 11), H - 40, 11, company, false, '0.73 0.84 0.92');
  let y = H - 100;
  const kv = (k, v) => { T(M, y, 11, k, true); T(M + 110, y, 11, v || '-'); y -= 17; };
  kv('Customer', job.client_name); kv('Site / deliver to', job.site_address); if (job.job_ref) kv('Job number', job.job_ref);
  kv('Ordered by', order.by); kv('Date', new Date(order.created_at || Date.now()).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' }));
  if (order.supplier_name && order.status === 'sent') kv('Supplier', order.supplier_name);
  y -= 10;
  const cols = [M, M + 22, M + 212, M + 312, M + 372, M + 436, M + 474];
  ops.push('0.039 0.086 0.157 rg ' + M + ' ' + (y - 6) + ' ' + (W - 2 * M) + ' 20 re f');
  ['#', 'Flashing', 'Colour', 'Girth', 'Bends', 'Qty', 'Length'].forEach((h, i) => T(cols[i] + 4, y, 10, h, true, '1 1 1'));
  y -= 24;
  items.forEach((x, i) => {
    if (y < 80) { pages.push(ops); ops = []; y = H - 60; }
    T(cols[0] + 4, y, 10, String(i + 1)); T(cols[1] + 4, y, 10, (x.name + (x.profile ? ' (' + x.profile + ')' : '')).slice(0, 40));
    T(cols[2] + 4, y, 10, (x.colour || '-').slice(0, 18)); T(cols[3] + 4, y, 10, Math.round(x.girthMm) + ' mm'); T(cols[4] + 4, y, 10, String(x.folds) + (x.hems ? ' + ' + x.hems + 'h' : ''));
    T(cols[5] + 4, y, 10, String(x.qty)); T(cols[6] + 4, y, 10, fmtM(x.lengthM));
    ops.push('0.87 0.89 0.93 RG 0.6 w ' + M + ' ' + (y - 6) + ' m ' + (W - M) + ' ' + (y - 6) + ' l S');
    y -= 20;
  });
  const lm = items.reduce((a, x) => a + x.qty * x.lengthM, 0);
  y -= 6; T(M, y, 11, 'Total: ' + items.reduce((a, x) => a + x.qty, 0) + ' lengths, ' + fmtM(lm) + ' lineal', true); y -= 22;
  if (order.note) { T(M, y, 11, 'Note', true); y -= 16;
    String(order.note).split(/\n/).forEach(ln => { for (let i = 0; i < ln.length || i === 0; i += 95) { if (y < 50) break; T(M, y, 10, ln.slice(i, i + 95)); y -= 14; } }); }
  pages.push(ops);
  // the drawings, two a page
  for (let i = 0; i < items.length; i += 2) {
    ops = [];
    [items[i], items[i + 1]].forEach((x, k) => { if (x) drawFlash(ops, T, x, i + k + 1, M, k === 0 ? H / 2 + 6 : 30, W - 2 * M, H / 2 - 46); });
    pages.push(ops);
  }
  // serialise
  const objs = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((pl, i) => {
    const id = pageIds[i];
    objs[id] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>';
    const body = pl.join('\n');
    objs[id + 1] = '<< /Length ' + Buffer.byteLength(body, 'latin1') + ' >>\nstream\n' + body + '\nendstream';
  });
  const chunks = []; let len = 0; const offs = [];
  const push = (s) => { const b = Buffer.from(s, 'latin1'); chunks.push(b); len += b.length; };
  push('%PDF-1.4\n');
  for (let i = 1; i < objs.length; i++) { if (!objs[i]) continue; offs[i] = len; push(i + ' 0 obj\n' + objs[i] + '\nendobj\n'); }
  const xref = len;
  let table = 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) table += String(offs[i] || 0).padStart(10, '0') + ' 00000 n \n';
  push(table); push('trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return Buffer.concat(chunks);
}
// One flashing in a box: its lines scaled to fit, each length at its middle,
// a fold a dot, the colour side an arrow; the facts under it.
function drawFlash(ops, T, x, n, bx, by, bw, bh){
  ops.push('0.87 0.89 0.93 RG 1 w ' + bx + ' ' + by + ' ' + bw + ' ' + bh + ' re S');
  ops.push('0.039 0.086 0.157 rg ' + bx + ' ' + (by + bh - 26) + ' ' + bw + ' 26 re f');
  T(bx + 10, by + bh - 18, 12, n + '. ' + x.name + (x.profile ? ' (' + x.profile + ')' : ''), true, '1 1 1');
  T(bx + 10, by + 10, 11, 'Qty ' + x.qty + ' x ' + fmtM(x.lengthM) + '   Girth ' + Math.round(x.girthMm) + ' mm   Bends ' + x.folds + (x.hems ? '   Hems ' + x.hems : '') + (x.colour ? '   Colour: ' + x.colour : ''), true);
  const all = []; x.polylines.forEach(p => p.vertices.forEach(v => all.push(v)));
  if (x.paintedSide) all.push([x.paintedSide.x, x.paintedSide.y]);
  if (!all.length) return;
  const minX = Math.min(...all.map(v => v[0])), maxX = Math.max(...all.map(v => v[0]));
  const minY = Math.min(...all.map(v => v[1])), maxY = Math.max(...all.map(v => v[1]));
  const ax = bx + 30, ay = by + 40, aw = bw - 60, ah = bh - 26 - 40 - 30;
  const s = Math.min(aw / Math.max(1, maxX - minX), ah / Math.max(1, maxY - minY));
  const ox = ax + (aw - (maxX - minX) * s) / 2, oy = ay + (ah - (maxY - minY) * s) / 2;
  const P = (v) => [ox + (v[0] - minX) * s, oy + (maxY - v[1]) * s];   // y flipped
  x.polylines.forEach(p => {
    const pts = p.vertices.map(P);
    ops.push((p.kind === 'squiggle' ? '0.5 0.5 0.5 RG 1 w ' : '0.06 0.09 0.16 RG 2.2 w 1 J 1 j ') + pts.map((q, i) => q[0].toFixed(1) + ' ' + q[1].toFixed(1) + (i ? ' l' : ' m')).join(' ') + ' S');
    if (p.kind === 'squiggle') return;
    pts.forEach((q, i) => { if (i && i < pts.length - 1) ops.push('0.06 0.09 0.16 rg ' + (q[0] - 2).toFixed(1) + ' ' + (q[1] - 2).toFixed(1) + ' 4 4 re f'); });
    Object.keys(p.crushFolds || {}).forEach(k => { const q = pts[+k]; if (q) ops.push('0 0.47 0.7 RG 1.2 w ' + (q[0] - 4).toFixed(1) + ' ' + (q[1] - 4).toFixed(1) + ' 8 8 re S'); });
    for (let i = 0; i < pts.length - 1; i++) {
      const mm = p.measurements[i]; if (mm == null) continue;
      const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const lab = String(Math.round(mm * 10) / 10), w = tw(lab, 10);
      const lx = mx + nx * 12 - w / 2, ly = my + ny * 12 - 3.5;
      ops.push('1 1 1 rg ' + (lx - 2).toFixed(1) + ' ' + (ly - 3).toFixed(1) + ' ' + (w + 4).toFixed(1) + ' 13 re f');
      T(lx, ly, 10, lab, true, '0 0.47 0.7');
    }
  });
  if (x.paintedSide) {
    const q = P([x.paintedSide.x, x.paintedSide.y]); const dx = x.paintedSide.dirX, dy = -x.paintedSide.dirY;
    const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, tx = q[0] + ux * 22, ty = q[1] + uy * 22;
    ops.push('0.86 0.15 0.15 RG 1.6 w ' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' m ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ' l S');
    ops.push('0.86 0.15 0.15 rg ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ' m ' + (tx - ux * 7 - uy * 4).toFixed(1) + ' ' + (ty - uy * 7 + ux * 4).toFixed(1) + ' l ' +
      (tx - ux * 7 + uy * 4).toFixed(1) + ' ' + (ty - uy * 7 - ux * 4).toFixed(1) + ' l f');
    T(tx + ux * 4 + 2, ty + uy * 4, 9, 'Colour side', true, '0.86 0.15 0.15');
  }
}
function tw(t, s){ return String(t).length * s * 0.5; }

module.exports = { mount, computeDays, nzParts, inWindow, distM, SITE_RADIUS_M, permsOf, isPriced, nzMs, cleanFlash, orderItem, flashOrderPdf, FLASH_PRESETS };
