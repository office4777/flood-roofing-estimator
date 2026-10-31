// On demand: does Fergus's partner API offer the SCHEDULE — site visits, calendar, who is booked on which
// job — anywhere? The hub's toolbox talk wants "the jobs the guys are on this week"; the old toolbox app's
// own history (v7 → v15) probed for it and gave up, and the docs cannot be read from a cloud session. This
// asks Fergus itself through the fergus-proxy (PROXY_URL, PROXY_SECRET): every plausible shape, top level and
// per job, plus the `links` a job detail carries (Fergus names its sub-resources there). Status, top-level
// keys and a short sample of each answer go to the log — never the key, never a customer's details beyond
// the first row's field NAMES.
// FOUND (2026-10-31, runs 1–3): GET /calendarEvents is the calendar — userName, eventType JOB_PHASE/QUOTE/OTHER, jobId,
// title '#3228a Deb Allen - 52 Kerikeri Road', startTime/endTime in UTC; no paging; the week now running by default,
// and ONLY `filterDateFrom` / `filterDateTo` as full ISO date-times move the window (a plain date is a 400). GET /users
// lists the staff. No site-visit, schedule, booking or roster route exists; /jobs/{id}/phases is the job's phases.
const PROXY = (process.env.PROXY_URL || '').replace(/\/+$/, '');
const SECRET = process.env.PROXY_SECRET || '';
if (!PROXY || !SECRET) { console.error('PROXY_URL / PROXY_SECRET missing'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function proxyUrl(svc, fullPath) {
  const qi = fullPath.indexOf('?');
  const p = qi >= 0 ? fullPath.slice(0, qi) : fullPath;
  let u = PROXY + '/api/proxy?svc=' + svc + '&path=' + encodeURIComponent(p);
  if (qi >= 0) fullPath.slice(qi + 1).split('&').forEach(pair => { if (!pair) return; const eq = pair.indexOf('='); const k = eq >= 0 ? pair.slice(0, eq) : pair; const v = eq >= 0 ? pair.slice(eq + 1) : ''; u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(decodeURIComponent(v)); });
  return u;
}
async function probe(path) {
  for (let tries = 0; ; tries++) {
    let res;
    try { res = await fetch(proxyUrl('fergus', path), { headers: { Accept: 'application/json', 'X-Proxy-Secret': SECRET } }); }
    catch (e) { if (tries < 3) { await sleep(800 * (tries + 1)); continue; } return { status: 0, body: String(e.message || e) }; }
    if ((res.status === 429 || res.status === 503) && tries < 6) { await sleep(Math.min(20000, 700 * Math.pow(2, tries))); continue; }
    return { status: res.status, body: await res.text() };
  }
}
const arr = j => Array.isArray(j) ? j : ((j && (j.data || j.results || j.items || j.value || j.events || j.visits)) || null);
function describe(r) {
  let j = null; try { j = JSON.parse(r.body); } catch (e) {}
  if (!j) return 'body: ' + r.body.slice(0, 160).replace(/\s+/g, ' ');
  const a = arr(j);
  const top = Array.isArray(j) ? '[array]' : Object.keys(j).slice(0, 10).join(',');
  if (Array.isArray(a)) {
    const first = a[0];
    const keys = first && typeof first === 'object' ? Object.keys(first).join(',') : (first === undefined ? '' : typeof first);
    return 'rows ' + a.length + ' · top ' + top + (keys ? ' · fields ' + keys : '') + (first && typeof first === 'object' ? ' · sample ' + JSON.stringify(first).slice(0, 320) : '');
  }
  return 'top ' + top + ' · ' + JSON.stringify(j).slice(0, 320);
}
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
const tbxEnd = ds => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); };
async function main() {
  const today = new Date(); const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mon = d.toISOString().slice(0, 10); const e = new Date(d); e.setDate(e.getDate() + 13); const end = e.toISOString().slice(0, 10);
  const lm = new Date(d); lm.setDate(lm.getDate() - 7); const lastMon = lm.toISOString().slice(0, 10);
  console.log('Window ' + lastMon + ' → ' + end + ' (last week, this week, next week)\n');

  // 1. an active job to probe against, and the links its detail carries
  let job = null;
  const jl = await probe('/jobs?pageSize=5&sortField=lastModified&sortOrder=desc&filterJobStatus=Active');
  console.log(pad(jl.status, 5) + '/jobs (active, 5)  ' + describe(jl).slice(0, 200));
  try { const a = arr(JSON.parse(jl.body)); job = a && a[0]; } catch (e) {}
  const id = job && (job.id != null ? job.id : job.jobId);
  if (job) {
    console.log('\nActive job fields: ' + Object.keys(job).join(','));
    const det = await probe('/jobs/' + encodeURIComponent(id));
    let dj = null; try { dj = JSON.parse(det.body); dj = dj.data || dj; } catch (e) {}
    console.log(pad(det.status, 5) + '/jobs/' + id + '  fields: ' + (dj ? Object.keys(dj).join(',') : det.body.slice(0, 120)));
    if (dj && dj.links) console.log('  links: ' + JSON.stringify(dj.links).slice(0, 1500));
    ['schedule', 'scheduling', 'siteVisits', 'site_visits', 'visits', 'bookings', 'calendar', 'assignedUsers', 'assignees', 'team', 'phases', 'startDate', 'endDate', 'scheduledStart', 'scheduledEnd', 'dueDate'].forEach(k => { if (dj && dj[k] != null) console.log('  job.' + k + ' = ' + JSON.stringify(dj[k]).slice(0, 400)); });
  }

  // 2. top-level shapes
  const q = 'from=' + lastMon + '&to=' + end;
  const top = ['/users?pageSize=50', '/users/me', '/staff', '/employees', '/teams',
    '/siteVisits?pageSize=50', '/site_visits?pageSize=50', '/site-visits?pageSize=50', '/visits?pageSize=50',
    '/siteVisits?' + q, '/siteVisits?startDate=' + lastMon + '&endDate=' + end, '/siteVisits?dateFrom=' + lastMon + '&dateTo=' + end,
    '/schedule?' + q, '/schedules?' + q, '/scheduling?' + q, '/jobs/schedule?' + q, '/jobs/scheduled?' + q,
    '/calendar?' + q, '/calendar/events?' + q, '/calendarEvents?' + q, '/calendar_events?' + q, '/events?' + q, '/bookings?' + q, '/roster?' + q, '/shifts?' + q,
    '/jobs?pageSize=20&filterJobStatus=Scheduled', '/jobs?pageSize=20&filterScheduledFrom=' + mon + '&filterScheduledTo=' + end,
    '/timeEntries?pageSize=5&sortField=timeEntryDate&sortOrder=desc', '/timeEntries?pageSize=5&timeEntryDateFrom=' + lastMon + '&timeEntryDateTo=' + end];
  console.log('\nTop-level shapes:');
  for (const p of top) { const r = await probe(p); console.log(pad(r.status, 5) + pad(p, 62) + ' ' + describe(r).slice(0, 420)); }

  // 3. per-job shapes
  if (id != null) {
    const per = ['/jobs/{id}/siteVisits', '/jobs/{id}/site_visits', '/jobs/{id}/site-visits', '/jobs/{id}/visits', '/jobs/{id}/schedule', '/jobs/{id}/scheduling', '/jobs/{id}/bookings', '/jobs/{id}/calendar', '/jobs/{id}/events', '/jobs/{id}/phases', '/jobs/{id}/timeEntries', '/jobs/{id}/users', '/jobs/{id}/assignees', '/jobs/{id}/team',
      '/jobs/{id}/siteVisits?' + q, '/jobs/{id}/site_visits?' + q, '/jobs/{id}/site_visits?start_date=' + lastMon + '&end_date=' + end + '&per_page=50', '/jobs/{id}/siteVisits?startDate=' + lastMon + '&endDate=' + end,
      '/jobs/siteVisits?jobId={id}', '/jobs/site_visits?jobId={id}', '/siteVisits?jobId={id}', '/site_visits?jobId={id}', '/timeEntries?jobId={id}&pageSize=5'];
    console.log('\nPer-job shapes (job ' + id + '):');
    for (const c of per) { const p = c.replace('{id}', encodeURIComponent(id)); const r = await probe(p); console.log(pad(r.status, 5) + pad(c, 62) + ' ' + describe(r).slice(0, 420)); }
  }
  // 3b. THE CALENDAR (found 2026-10-31): /calendarEvents?from&to answers. Its shape, window and clock.
  for (const p of ['/calendarEvents?from=' + mon + '&to=' + end, '/calendarEvents?from=' + mon + '&to=' + end + '&pageSize=500', '/calendarEvents?from=' + mon + '&to=' + end + '&page=2', '/calendarEvents?startDate=' + mon + '&endDate=' + end, '/calendarEvents?from=' + lastMon + '&to=' + lastMon, '/calendarEvents']) {
    const r = await probe(p); let j = null; try { j = JSON.parse(r.body); } catch (e) {}
    const a = arr(j) || [];
    const days = {}; let lo = null, hi = null, withJob = 0, allDay = 0; const types = {}, users = new Set();
    a.forEach(ev => { const t = String(ev.startTime || ''); const d = t.slice(0, 10); days[d] = (days[d] || 0) + 1; if (!lo || t < lo) lo = t; if (!hi || t > hi) hi = t; if (ev.jobId != null) withJob++; if (ev.isAllDay) allDay++; types[ev.eventType] = (types[ev.eventType] || 0) + 1; if (ev.userName) users.add(ev.userName); });
    console.log('\n' + pad(r.status, 5) + p + '  rows ' + a.length + ' · paging ' + JSON.stringify(j && j.paging || null) + ' · span ' + lo + ' → ' + hi + ' · withJob ' + withJob + ' · allDay ' + allDay + ' · types ' + JSON.stringify(types) + ' · people ' + users.size);
    console.log('  by day: ' + JSON.stringify(days));
  }
  // 3c. does ANY parameter move the calendar's window off the current week? (last week's Monday, one day)
  { const base = {}; const r0 = await probe('/calendarEvents'); try { (arr(JSON.parse(r0.body)) || []).forEach(ev => { base[ev.id + '|' + ev.startTime] = 1; }); } catch (e) {}
    const names = [['from', 'to'], ['start', 'end'], ['fromDate', 'toDate'], ['dateFrom', 'dateTo'], ['startTime', 'endTime'], ['filterFrom', 'filterTo'], ['filterStartDate', 'filterEndDate'], ['filterDateFrom', 'filterDateTo'], ['minDate', 'maxDate'], ['since', 'until'], ['weekStart', 'weekEnd'], ['date', null], ['week', null], ['weekOf', null], ['startDate', null]];
    console.log('\nCalendar window parameters (last week ' + lastMon + ' → ' + tbxEnd(lastMon) + '):');
    for (const [a, b] of names) {
      for (const fmt of ['date', 'iso']) {
        const v1 = fmt === 'date' ? lastMon : lastMon + 'T00:00:00Z', v2 = fmt === 'date' ? tbxEnd(lastMon) : tbxEnd(lastMon) + 'T23:59:59Z';
        const p = '/calendarEvents?' + a + '=' + encodeURIComponent(v1) + (b ? '&' + b + '=' + encodeURIComponent(v2) : '');
        const r = await probe(p); let n = 0, moved = 0, lo = null, hi = null; try { (arr(JSON.parse(r.body)) || []).forEach(ev => { n++; if (!base[ev.id + '|' + ev.startTime]) moved++; const t = String(ev.startTime); if (!lo || t < lo) lo = t; if (!hi || t > hi) hi = t; }); } catch (e) {}
        console.log('  ' + pad(r.status, 5) + pad(p, 80) + ' rows ' + n + ' · not in the default set ' + moved + ' · ' + lo + ' → ' + hi + (r.status >= 400 ? ' · ' + r.body.slice(0, 120) : ''));
      }
    }
    for (const p of ['/calendarEvents?pageSize=10', '/calendarEvents?page=2&pageSize=50', '/calendarEvents?pageCursor=x', '/calendarEvents?userId=135003', '/calendarEvents?jobId=22393288', '/calendarEvents/45385188', '/calendarEvents?eventType=JOB_PHASE', '/calendarEvents?includePast=true', '/calendarEvents?weeks=2']) {
      const r = await probe(p); let n = 0; try { const j = JSON.parse(r.body); n = (arr(j) || (j && j.data ? [j.data] : [])).length; } catch (e) {}
      console.log('  ' + pad(r.status, 5) + pad(p, 80) + ' rows ' + n + (r.status >= 400 ? ' · ' + r.body.slice(0, 120) : ''));
    }
  }
  // every event this week, one line each (title, who, job, start, end, allDay, type) — this is the toolbox's own sheet
  { const r = await probe('/calendarEvents?from=' + mon + '&to=' + end); let j = null; try { j = JSON.parse(r.body); } catch (e) {}
    const a = (arr(j) || []).slice().sort((x, y) => String(x.startTime).localeCompare(String(y.startTime)));
    console.log('\nThis week + next, every event (' + a.length + '):');
    a.slice(0, 120).forEach(ev => console.log('  ' + pad(ev.startTime, 20) + pad(ev.endTime, 20) + pad(ev.isAllDay ? 'allday' : '', 7) + pad(ev.eventType, 12) + pad(ev.userName || '', 18) + pad(ev.jobId == null ? '' : 'job ' + ev.jobId, 14) + pad(ev.jobPhaseId == null ? '' : 'ph ' + ev.jobPhaseId, 12) + String(ev.title || '').slice(0, 40) + (ev.isRecurring ? '  ↻' + JSON.stringify(ev.recurringEventDetails).slice(0, 80) : '') + '  links:' + JSON.stringify(ev.links || []).slice(0, 120)));
  }
  // 4. a time entry's own fields (the fallback the hub already uses) — field names only
  const te = await probe('/timeEntries?pageSize=1');
  console.log('\n' + pad(te.status, 5) + '/timeEntries?pageSize=1  ' + describe(te).slice(0, 600));
  console.log('\nDone.');
}
main().catch(e => { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); });
