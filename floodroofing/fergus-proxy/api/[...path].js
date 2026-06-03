// Standalone, read-only proxy for the Flood Roofing Operations Hub / Financials app.
//
// One top-level catch-all that forwards:
//   /api/fergus/...  → https://api.fergus.com/...        (Bearer FERGUS_API_KEY)
//   /api/xero/...    → https://api.xero.com/api.xro/2.0/...  (Xero custom connection)
//
// Locked down: GET only, upstreams hard-pinned, every request needs X-Proxy-Secret.
//
// Env vars (Vercel → Settings → Environment Variables):
//   FERGUS_API_KEY      required  — Fergus Personal Access Token (fergPAT_...)
//   PROXY_SECRET        required  — shared secret; same value goes in the app
//   XERO_CLIENT_ID      optional  — Xero custom connection client id (live P&L)
//   XERO_CLIENT_SECRET  optional  — Xero custom connection client secret
//   XERO_SCOPE          optional  — defaults to accounting.reports.read

const FERGUS_HOST = 'api.fergus.com';
const XERO_SCOPE = process.env.XERO_SCOPE || 'accounting.reports.read';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Proxy-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function passthrough(res, upstream, headers) {
  const r = await fetch(upstream, { method: 'GET', headers });
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
  if (!r.ok) throw new Error('token HTTP ' + r.status + ': ' + txt.slice(0, 200));
  return JSON.parse(txt).access_token;
}

async function xeroTenant(token) {
  const r = await fetch('https://api.xero.com/connections', {
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('connections HTTP ' + r.status + ': ' + txt.slice(0, 200));
  const arr = JSON.parse(txt);
  if (!arr.length) throw new Error('No Xero organisation connected to this app yet.');
  return arr[0].tenantId;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Only GET is allowed.' });

  const proxySecret = process.env.PROXY_SECRET;
  if (!proxySecret) return res.status(500).json({ error: 'Proxy not configured: PROXY_SECRET is not set.' });
  if ((req.headers['x-proxy-secret'] || '') !== proxySecret) {
    return res.status(401).json({ error: 'Bad or missing X-Proxy-Secret.' });
  }

  const url = req.url || '';   // e.g. /api/fergus/users/me?x=1

  // ── Fergus ──
  if (url.startsWith('/api/fergus')) {
    const key = process.env.FERGUS_API_KEY;
    if (!key) return res.status(500).json({ error: 'FERGUS_API_KEY is not set.' });
    const tail = url.replace(/^\/api\/fergus/, '') || '/';
    try {
      return await passthrough(res, 'https://' + FERGUS_HOST + tail, {
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
      });
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach Fergus.', detail: String(e && e.message || e) });
    }
  }

  // ── Xero ──
  if (url.startsWith('/api/xero')) {
    const id = process.env.XERO_CLIENT_ID, secret = process.env.XERO_CLIENT_SECRET;
    if (!id || !secret) return res.status(501).json({ error: 'Xero not configured: set XERO_CLIENT_ID and XERO_CLIENT_SECRET.' });
    const tail = url.replace(/^\/api\/xero/, '') || '/';
    try {
      const token = await xeroToken(id, secret);
      const tenant = await xeroTenant(token);
      return await passthrough(res, 'https://api.xero.com/api.xro/2.0' + tail, {
        'Authorization': 'Bearer ' + token, 'Xero-tenant-id': tenant, 'Accept': 'application/json',
      });
    } catch (e) {
      return res.status(502).json({ error: 'Xero request failed.', detail: String(e && e.message || e) });
    }
  }

  return res.status(404).json({ error: 'Unknown path. Use /api/fergus/... or /api/xero/...' });
}
