// Standalone, read-only proxy for the Flood Roofing Operations Hub / Financials app.
//
// Plain, statically-routed CommonJS function (no dynamic routes, no ESM) so it
// resolves reliably on Vercel zero-config. The app calls:
//
//   /api/proxy?svc=fergus&path=<urlencoded "/jobs?pageSize=100&...">
//   /api/proxy?svc=xero&path=<urlencoded "/Reports/ProfitAndLoss?fromDate=...">
//
// and this forwards to:
//   fergus → https://api.fergus.com<path>            (Bearer FERGUS_API_KEY)
//   xero   → https://api.xero.com/api.xro/2.0<path>  (Xero custom connection)
//
// Locked down: GET only, upstreams hard-pinned, every request needs X-Proxy-Secret.
//
// Env vars (Vercel → Settings → Environment Variables):
//   FERGUS_API_KEY      required  — Fergus Personal Access Token (fergPAT_...)
//   PROXY_SECRET        required  — shared secret; same value goes in the app
//   XERO_CLIENT_ID      optional  — Xero custom connection client id (live P&L)
//   XERO_CLIENT_SECRET  optional  — Xero custom connection client secret
//   XERO_SCOPE          optional  — defaults to accounting.reports.read
//   AKAHU_APP_TOKEN     optional  — Akahu app id token (app_token_...) for live bank feed
//   AKAHU_USER_TOKEN    optional  — Akahu user access token (user_token_...) for the linked bank

const FERGUS_HOST = 'api.fergus.com';
const XERO_SCOPE = process.env.XERO_SCOPE || 'accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.invoices.read accounting.settings.read accounting.banktransactions.read accounting.payments.read';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Proxy-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function passthrough(res, upstream, headers) {
  const r = await fetch(upstream, { method: 'GET', headers: headers });
  const body = await r.text();
  res.status(r.status);
  res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
  return res.send(body);
}

async function xeroToken(id, secret) {
  const r = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent(XERO_SCOPE),
  });
  const txt = await r.text();
  if (!r.ok) {
    let code = ''; try { code = (JSON.parse(txt).error || '') + ''; } catch (_) {}
    const e = new Error('token HTTP ' + r.status + ': ' + txt.slice(0, 200));
    e.short = 'XEROTOKEN_' + r.status + '_' + (code || 'unknown');
    throw e;
  }
  return JSON.parse(txt).access_token;
}

async function xeroTenant(token) {
  const r = await fetch('https://api.xero.com/connections', {
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
  });
  const txt = await r.text();
  if (!r.ok) {
    const e = new Error('connections HTTP ' + r.status + ': ' + txt.slice(0, 200));
    e.short = 'XEROCONN_' + r.status;
    throw e;
  }
  const arr = JSON.parse(txt);
  if (!arr.length) { const e = new Error('No Xero organisation connected to this app yet.'); e.short = 'XEROCONN_noorg'; throw e; }
  return arr[0].tenantId;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Only GET is allowed.' });

  const q = req.query || {};
  const svc = q.svc;
  let path = q.path || '/';
  if (Array.isArray(path)) path = path[0];
  if (!path.startsWith('/')) path = '/' + path;
  // Forward any extra query params (the upstream Fergus/Xero query string) as REAL params so
  // nothing is lost when the path itself is URL-encoded. (svc/path/debug are proxy-only.)
  const extra = Object.keys(q).filter(k => k !== 'svc' && k !== 'path' && k !== 'debug' && k !== '_vercel_share').map(k => {
    const v = q[k];
    return Array.isArray(v) ? v.map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x)).join('&') : (encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }).join('&');
  if (extra) path += (path.indexOf('?') >= 0 ? '&' : '?') + extra;

  // Harmless debug (no secret): shows the exact upstream URL the proxy will call.
  if (q.debug === 'echo') {
    const host = svc === 'xero' ? 'api.xero.com/api.xro/2.0' : FERGUS_HOST;
    return res.status(200).json({ query: q, builtPath: path, upstream: 'https://' + host + path });
  }

  const proxySecret = process.env.PROXY_SECRET;
  if (!proxySecret) return res.status(500).json({ error: 'Proxy not configured: PROXY_SECRET is not set.' });
  if ((req.headers['x-proxy-secret'] || '') !== proxySecret) {
    return res.status(401).json({ error: 'Bad or missing X-Proxy-Secret.' });
  }

  if (svc === 'fergus') {
    const key = process.env.FERGUS_API_KEY;
    if (!key) return res.status(500).json({ error: 'FERGUS_API_KEY is not set.' });
    try {
      return await passthrough(res, 'https://' + FERGUS_HOST + path, {
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
      });
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach Fergus.', detail: String(e && e.message || e) });
    }
  }

  if (svc === 'xero') {
    const id = process.env.XERO_CLIENT_ID, secret = process.env.XERO_CLIENT_SECRET;
    if (!id || !secret) return res.status(501).json({ error: 'Xero not configured: set XERO_CLIENT_ID and XERO_CLIENT_SECRET.' });
    try {
      const token = await xeroToken(id, secret);
      const tenant = await xeroTenant(token);
      return await passthrough(res, 'https://api.xero.com/api.xro/2.0' + path, {
        'Authorization': 'Bearer ' + token, 'Xero-tenant-id': tenant, 'Accept': 'application/json',
      });
    } catch (e) {
      console.error((e && e.short) || ('[xero] ' + String((e && e.stack) || e)));
      return res.status(502).json({ error: 'Xero request failed.', detail: String(e && e.message || e) });
    }
  }

  if (svc === 'akahu') {
    const appTok = process.env.AKAHU_APP_TOKEN, userTok = process.env.AKAHU_USER_TOKEN;
    if (!appTok || !userTok) return res.status(501).json({ error: 'Akahu not configured: set AKAHU_APP_TOKEN and AKAHU_USER_TOKEN.' });
    try {
      return await passthrough(res, 'https://api.akahu.io' + path, {
        'X-Akahu-Id': appTok, 'Authorization': 'Bearer ' + userTok, 'Accept': 'application/json',
      });
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach Akahu.', detail: String(e && e.message || e) });
    }
  }

  return res.status(400).json({ error: 'Missing or unknown svc — use ?svc=fergus, ?svc=xero or ?svc=akahu.' });
};
