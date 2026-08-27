// A stand-in PostgREST: just enough of the wire protocol for the queries
// server.js actually makes, so the real Express app can be exercised end to
// end without a database. Rows live in memory and can be inspected after.
import http from 'node:http';

let _genId = 0;
// The `default now()` columns, per table, exactly as the migration in
// server.js declares them. Postgres fills these on insert and the server
// therefore never sends them; without this the fake hands back rows with no
// date, which no date filter can then match.
const NOW_DEFAULTS = {
  usage_events:    ['at'],
  companies:       ['created_at'],
  company_users:   ['created_at'],
  company_invites: ['created_at'],
  company_domains: ['created_at'],
  waitlist:        ['created_at', 'updated_at'],
  invoices:        ['issued_at', 'created_at', 'updated_at'],
  job_revisions:   ['saved_at'],
  platform_state:  ['updated_at'],
  jobs:            ['created_at', 'updated_at'],
  profiles:        ['created_at'],
  subscriptions:   ['updated_at'],
};

export function startFakePostgrest(tables){
  const db = tables;
  const parseFilters = (params) => {
    const preds = [];
    for (const [k, v] of params){
      if (['select','order','limit','offset','on_conflict'].includes(k)) continue;
      if (k === 'or'){
        // or=(company_id.eq.X,and(company_id.is.null,user_id.eq.U))
        const inner = v.replace(/^\(|\)$/g, '');
        const parts = [];
        let depth = 0, cur = '';
        for (const ch of inner){
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          if (ch === ',' && depth === 0){ parts.push(cur); cur = ''; continue; }
          cur += ch;
        }
        if (cur) parts.push(cur);
        const subs = parts.map(p => {
          if (p.startsWith('and(')) {
            const andParts = p.slice(4, -1).split(',');
            const fns = andParts.map(a => oneOf(a));
            return (r) => fns.every(f => f(r));
          }
          return oneOf(p);
        });
        preds.push(r => subs.some(f => f(r)));
        continue;
      }
      preds.push(oneOf(k + '.' + v));
    }
    return (r) => preds.every(p => p(r));
  };
  // PostgREST addresses nested JSON with arrow paths — draw_state->state->quote->>ref
  // — so a filter key isn't always a plain column name.
  const readCol = (row, col) => {
    if (col.indexOf('->') < 0) return row[col];
    const parts = col.split(/->>|->/);
    let v = row[parts[0]];
    for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  };
  const oneOf = (expr) => {
    const i = expr.indexOf('.');
    const col = expr.slice(0, i);
    const rest = expr.slice(i + 1);
    const j = rest.indexOf('.');
    const op = j < 0 ? rest : rest.slice(0, j);
    const val = j < 0 ? '' : rest.slice(j + 1);
    if (op === 'eq') return (r) => String(readCol(r, col)) === val;
    if (op === 'ilike' || op === 'like'){
      const pat = '^' + val.split('%').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
      const re = new RegExp(pat, op === 'ilike' ? 'i' : '');
      return (r) => readCol(r, col) != null && re.test(String(readCol(r, col)));
    }
    if (op === 'is') return (r) => (val === 'null' ? (readCol(r, col) === null || readCol(r, col) === undefined) : true);
    // Range filters. These used to fall through to the catch-all below, which
    // returned true for every row — so any query narrowed by a date window
    // silently got the WHOLE table back, and a suite written against "the last
    // seven days" passed no matter what it was counting. Comparing dates as
    // dates and numbers as numbers, because a timestamp and a bigserial id are
    // both filtered this way and lexical order is wrong for the second.
    if (op === 'gte' || op === 'lte' || op === 'gt' || op === 'lt'){
      const cmp = (a, b) => {
        if (a == null) return null;                       // null compares false, as in SQL
        const ta = Date.parse(a), tb = Date.parse(b);
        if (isFinite(ta) && isFinite(tb) && /\d{4}-\d{2}-\d{2}/.test(String(a))) return ta - tb;
        const na = Number(a), nb = Number(b);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
      };
      return (r) => {
        const d = cmp(readCol(r, col), val);
        if (d === null) return false;
        return op === 'gte' ? d >= 0 : op === 'lte' ? d <= 0 : op === 'gt' ? d > 0 : d < 0;
      };
    }
    if (op === 'not') return () => true;
    return () => true;
  };

  let _uid = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    // Supabase Auth admin API. Without this, createUser resolves to undefined
    // and every downstream id comparison is undefined === undefined — which
    // passes for the wrong reason and hides real bugs.
    if (u.pathname.startsWith('/auth/v1/admin/users')){
      let ab = '';
      req.on('data', c => ab += c);
      req.on('end', () => {
        const body = JSON.parse(ab || '{}');
        const rest = u.pathname.slice('/auth/v1/admin/users'.length).replace(/^\//, '');
        let user;
        if (req.method === 'POST'){
          _uid++;
          user = { id: 'newuser-0000-0000-0000-00000000000' + _uid, email: body.email, created_at: new Date(0).toISOString() };
          db.__authUsers = db.__authUsers || [];
          db.__authUsers.push({ id: user.id, email: body.email, password: body.password });
        } else {
          db.__authUsers = db.__authUsers || [];
          const ex = db.__authUsers.find(x => x.id === rest) || { id: rest };
          if (body.password) ex.password = body.password;
          if (!db.__authUsers.includes(ex)) db.__authUsers.push(ex);
          user = { id: ex.id, email: ex.email };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(user));
      });
      return;
    }
    const table = u.pathname.replace('/rest/v1/', '').split('?')[0];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const send = (code, payload) => {
        const single = (req.headers.accept || '').includes('pgrst.object');
        let out = payload;
        if (single) out = Array.isArray(payload) ? (payload[0] ?? null) : payload;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      };
      db[table] = db[table] || [];
      // A column the migration hasn't added yet → PostgREST 400, which is what
      // the server's fallback branches are written against.
      const sel = u.searchParams.get('select') || '';
      const missing = (db.__missing || []).find(c => sel.split(',').map(x=>x.trim()).includes(c));
      if (missing) return send(400, { message: 'column jobs.' + missing + ' does not exist' });

      const match = parseFilters([...u.searchParams.entries()]);
      if (req.method === 'GET'){
        // Deliberate breakage, so a caller's "if the lookup fails" path can be
        // exercised for real rather than assumed.
        if (db.__fail500 === table) return send(500, { message: 'injected failure' });
        let rows = db[table].filter(match);
        const ord = u.searchParams.get('order');
        if (ord){
          const [col, dir] = ord.split('.');
          rows = rows.slice().sort((a,b) => {
            const av = String(a[col] ?? ''), bv = String(b[col] ?? '');
            const c = av < bv ? -1 : av > bv ? 1 : 0;
            return dir === 'desc' ? -c : c;
          });
        }
        const lim = parseInt(u.searchParams.get('limit'), 10);
        if (isFinite(lim)) rows = rows.slice(0, lim);
        // PostgREST returns ONLY the named columns, and several routes lean on
        // that to keep a multi-MB draw_state off the wire. Handing back whole
        // rows here made those routes look heavy when they are not — and, worse,
        // would let a genuine regression (someone dropping the column list)
        // sail through. Projected only for a plain column list: '*' and
        // embedded resources like company:companies(name) are left alone.
        // Only for a select that is a plain list of column names. PostgREST
        // also takes arrow paths (draw_state->state->quote), aliases, casts
        // and embedded resources; projecting those naively drops the column
        // the caller asked for and the route 404s on its own data. Anything
        // that is not a bare identifier falls through whole, as before.
        const plainCols = sel.split(',').map(x => x.trim()).filter(Boolean);
        if (sel && plainCols.length && plainCols.every(c => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c))){
          rows = rows.map(r => {
            const o = {};
            plainCols.forEach(c => { if (c in r) o[c] = r[c]; });
            return o;
          });
        }
        return send(200, rows);
      }
      if (req.method === 'PATCH'){
        const patch = JSON.parse(body || '{}');
        const bad = (db.__missing || []).find(c => Object.keys(patch).includes(c));
        if (bad) return send(400, { message: 'column ' + table + '.' + bad + ' does not exist' });
        const hit = db[table].filter(match);
        hit.forEach(r => Object.assign(r, patch));
        return send(200, hit);
      }
      if (req.method === 'POST'){
        const rows = JSON.parse(body || '[]');
        const arr = Array.isArray(rows) ? rows : [rows];
        const bad = (db.__missing || []).find(c => arr.some(r => Object.keys(r).includes(c)));
        if (bad) return send(400, { message: 'column ' + table + '.' + bad + ' does not exist' });
        const conflict = u.searchParams.get('on_conflict');
        const out = [];
        arr.forEach(r => {
          const ex = conflict ? db[table].find(x => String(x[conflict]) === String(r[conflict])) : null;
          if (ex){ Object.assign(ex, r); out.push(ex); }
          else {
            // Postgres fills a uuid default on insert. This used to hand the
            // row back with no id at all, which is not what the real thing
            // does — and it let an endpoint drop the new id unnoticed, which
            // is the field the app keeps as S.currentJobId.
            if (r.id == null) r.id = 'gen-' + (++_genId).toString().padStart(4, '0');
            // Same story for the timestamps, which are `not null default now()`
            // throughout the schema — so no caller sends them. recordUsage
            // inserts name/company_id/user_id/props and nothing else. Leaving
            // them undefined was invisible only while the range filters matched
            // everything; the moment gte/lt started working, every row the
            // server wrote fell outside every date window for want of a date.
            //
            // Named per table rather than guessed, because guessing put a
            // created_at on usage_events — a column it does not have — and the
            // privacy check that asserts usage_events holds nothing but the
            // milestone, the business and the time caught it.
            (NOW_DEFAULTS[table] || []).forEach(c => { if (!(c in r)) r[c] = new Date().toISOString(); });
            db[table].push(r); out.push(r);
          }
        });
        return send(201, out);
      }
      if (req.method === 'DELETE'){
        db[table] = db[table].filter(r => !match(r));
        return send(200, []);
      }
      send(200, []);
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, db })));
}
