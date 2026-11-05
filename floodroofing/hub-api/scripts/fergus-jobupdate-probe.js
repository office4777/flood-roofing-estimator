// On demand: how does Fergus's partner API let a job's description be changed? RoofMap writes the
// customer's selections into the Fergus job on acceptance (job 3341, 2026-11-06: the description still
// read "Quote to replace guttering" after it was accepted). Reads one job by its number and prints its
// description / longDescription, then asks each update route with a body that FAILS VALIDATION on
// purpose (description as a number), so Fergus answers "route not found" or "must be string" and
// nothing is ever written. Statuses and Fergus's own error text only; never the key.
const PROXY = (process.env.PROXY_URL || '').replace(/\/+$/, '');
const SECRET = process.env.PROXY_SECRET || '';
const JOBNO = process.env.JOB_NO || '3341';
if (!PROXY || !SECRET) { console.error('PROXY_URL / PROXY_SECRET missing'); process.exit(1); }
function proxyUrl(svc, fullPath) {
  const qi = fullPath.indexOf('?');
  const p = qi >= 0 ? fullPath.slice(0, qi) : fullPath;
  let u = PROXY + '/api/proxy?svc=' + svc + '&path=' + encodeURIComponent(p);
  if (qi >= 0) fullPath.slice(qi + 1).split('&').forEach(pair => { if (!pair) return; const eq = pair.indexOf('='); const k = eq >= 0 ? pair.slice(0, eq) : pair; const v = eq >= 0 ? pair.slice(eq + 1) : ''; u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(decodeURIComponent(v)); });
  return u;
}
async function call(method, path, body) {
  const h = { Accept: 'application/json', 'X-Proxy-Secret': SECRET };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  try { const r = await fetch(proxyUrl('fergus', path), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.text() }; }
  catch (e) { return { status: 0, body: String(e.message || e) }; }
}
const arr = j => Array.isArray(j) ? j : ((j && (j.data || j.results || j.items)) || null);
async function main() {
  let job = null;
  for (const q of ['/jobs?pageSize=50&filterSearchText=' + JOBNO, '/jobs?pageSize=50&jobNo=' + JOBNO, '/jobs?pageSize=100&sortField=lastModified&sortOrder=desc']) {
    const r = await call('GET', q);
    let a = null; try { a = arr(JSON.parse(r.body)); } catch (e) {}
    console.log(r.status + '  GET ' + q + '  rows ' + (a ? a.length : '-') + (a ? '' : '  ' + r.body.slice(0, 200)));
    const hit = (a || []).find(j => String(j.jobNo) === JOBNO || String(j.jobNumber) === JOBNO || String(j.jobNo || '').startsWith(JOBNO));
    if (hit) { job = hit; break; }
  }
  if (!job) { console.log('job ' + JOBNO + ' not found'); return; }
  console.log('\njob id ' + job.id + ' · jobNo ' + job.jobNo + ' · fields ' + Object.keys(job).join(','));
  const det = await call('GET', '/jobs/' + job.id);
  let d = null; try { d = JSON.parse(det.body); d = d.data || d; } catch (e) {}
  console.log(det.status + '  GET /jobs/' + job.id);
  if (d) { console.log('  description     = ' + JSON.stringify(d.description).slice(0, 300)); console.log('  longDescription = ' + JSON.stringify(d.longDescription).slice(0, 600)); console.log('  links: ' + JSON.stringify(d.links || []).slice(0, 800)); }
  console.log('\nUpdate routes (body fails validation on purpose — nothing is written):');
  for (const m of ['PATCH', 'PUT', 'POST']) for (const p of ['/jobs/' + job.id, '/jobs/' + job.id + '/description', '/jobs/' + job.id + '/longDescription']) {
    const r = await call(m, p, { description: 12345, longDescription: 67890 });
    console.log(String(r.status).padEnd(5) + (m + ' ' + p).padEnd(46) + r.body.replace(/\s+/g, ' ').slice(0, 400));
  }
  const after = await call('GET', '/jobs/' + job.id);
  let a2 = null; try { a2 = JSON.parse(after.body); a2 = a2.data || a2; } catch (e) {}
  console.log('\nunchanged: ' + (a2 && d && a2.description === d.description && a2.longDescription === d.longDescription));
}
main().then(() => console.log('Done.'));
