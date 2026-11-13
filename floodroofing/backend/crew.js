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
const EV_KINDS = ['on', 'off', 'travel', 'break', 'end', 'check', 'note'];
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
  (events || []).filter(e => e.kind !== 'check' && e.kind !== 'note').forEach(e => {
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
  return out;
}

function mount(app, deps){
  const { supabase, requireAuth, scopeCompany, recordError, rateLimit,
          schedCfg, schedNonWork, schedBlockDates, schedISO, schedShift, quoteChoiceLines } = deps;
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
    return { row: r[0] || null, data: { checklists: cleanLists(d.checklists) } };
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
        checklists: st.data.checklists, office: await officeOn(req),
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
      const all = req.query.all === '1';
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
      const out = { row_id: r.id, job_id: r.job_id || '', client: r.client_name || '', site: r.site_address || '', email: r.email || '',
        job_ref: r.job_ref || '', notes: clean(r.notes, 2000), days, phone: '', choices: [], scope: [], exclusions: [], quoteNotes: [],
        description: '', files: [], checks: {}, site_point: null };
      if (r.job_id) {
        const j = rows(await scopeCompany(supabase.from('jobs').select('id, version_of, client_name, site_address, ' +
          'quote:draw_state->state->quote, form:draw_state->form'), req).eq('id', r.job_id).limit(1))[0];
        if (j) {
          const q = j.quote || {};
          const acc = (q.versions && q.versions.accepted && q.versions.accepted.quote) || null;
          const useQ = acc ? Object.assign({}, q, acc, { accepted: q.accepted || acc.accepted }) : q;
          out.client = out.client || j.client_name || ''; out.site = out.site || j.site_address || '';
          out.phone = clean((j.form && j.form.jobPhone) || q.phone || (q.client && q.client.phone) || '', 40);
          out.email = out.email || clean((q.client && q.client.email) || q.email || '', 120);
          out.job_ref = out.job_ref || clean(q.ref, 40);
          try { out.choices = (quoteChoiceLines(useQ) || []).map(x => clean(x, 300)).slice(0, 60); } catch (e) {}
          const lines = (v) => (Array.isArray(v) ? v : []).map(x => clean(typeof x === 'string' ? x : (x && (x.text || x.t)), 300)).filter(Boolean).slice(0, 40);
          out.scope = lines(useQ.custDesc); out.exclusions = lines(useQ.custExcl); out.quoteNotes = lines(useQ.custNotes);
          out.description = clean(useQ.scope, 2000);
          const root = String(j.version_of || j.id);
          const fs = rows(await scopeCompany(supabase.from('job_files').select('id, name, mime, size, kind, source, author, status, created_at'), req)
            .eq('job_id', root).order('created_at', { ascending: false }).limit(300));
          out.files = fs.filter(f => f.status === 'ready').map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind,
            source: f.source || '', author: f.author || '', at: f.created_at }));
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
      res.json(Object.assign({ ok: true }, out));
    } catch (e) { recordError('crew', e, { route: 'GET /crew/row/:id' }); res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
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
        const data = (e.data && typeof e.data === 'object') ? {
          list: clean(e.data.list, 40), item: parseInt(e.data.item, 10) || 0, done: !!e.data.done, day: clean(e.data.day, 10),
          text: clean(e.data.text, 1000) } : null;
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
      .filter(e => String(e.user_id) === String(uid) && nzDate(e.at) >= from && nzDate(e.at) <= to);
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
          .filter(e => String(e.user_id) === p.id && nzDate(e.at) === today && e.kind !== 'check' && e.kind !== 'note')
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
          return Object.assign({}, p, { crew_id: cm.crew_id || '', crew_name: cm.name || '' }); }) });
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
      const data = { checklists: cleanLists((req.body || {}).checklists) };
      const { row } = await settingsOf(req); const now = new Date().toISOString();
      let error;
      if (row) ({ error } = await supabase.from('crew_settings').update({ data, updated_at: now }).eq('id', row.id).eq('company_id', req.companyId));
      else ({ error } = await supabase.from('crew_settings').insert({ id: crypto.randomUUID(), company_id: req.companyId, user_id: req.user.id, data, updated_at: now }));
      if (error) throw new Error(error.message);
      res.json(Object.assign({ ok: true }, data));
    } catch (e) { res.status(503).json({ error: e.message, code: 'UPSTREAM_UNAVAILABLE' }); }
  });

  return { computeDays, enabledFor: companyOn, inWindow, nzParts, distM };
}

module.exports = { mount, computeDays, nzParts, inWindow, distM, SITE_RADIUS_M };
