// Standalone, read-only Xero proxy for the Flood Roofing Financials app.
//
// Live Xero (P&L) can't be called from a phone browser directly (CORS + the
// OAuth token exchange). This function does it server-side: it gets a token via
// the Custom Connection (client_credentials), finds the tenant, and forwards a
// read-only Accounting API GET to api.xero.com.
//
// It's locked down the same way as the Fergus proxy: GET only, upstream pinned
// to api.xero.com, and every request must carry the shared X-Proxy-Secret.
//
// Required environment variables (set in the Vercel dashboard) — OPTIONAL:
//   XERO_CLIENT_ID       Xero Custom Connection client id
//   XERO_CLIENT_SECRET   Xero Custom Connection client secret
//   PROXY_SECRET         same shared secret as the Fergus proxy
// If the Xero vars are not set, this endpoint returns 501 and the app falls
// back to a P&L derived from your back-costing data.

const XERO_SCOPE = 'accounting.reports.profitandloss.read';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Proxy-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function getToken(id, secret) {
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

async function getTenant(token) {
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

  const id = process.env.XERO_CLIENT_ID;
  const secret = process.env.XERO_CLIENT_SECRET;
  const proxySecret = process.env.PROXY_SECRET;

  if (!proxySecret) return res.status(500).json({ error: 'Proxy not configured: PROXY_SECRET is not set.' });
  if ((req.headers['x-proxy-secret'] || '') !== proxySecret) return res.status(401).json({ error: 'Bad or missing X-Proxy-Secret.' });
  if (!id || !secret) return res.status(501).json({ error: 'Xero not configured: set XERO_CLIENT_ID and XERO_CLIENT_SECRET.' });

  // Everything after /api/xero is an Accounting API path, e.g.
  // /api/xero/Reports/ProfitAndLoss?fromDate=...  →  /api.xro/2.0/Reports/ProfitAndLoss?...
  const tail = req.url.replace(/^\/api\/xero/, '') || '/';
  const upstream = 'https://api.xero.com/api.xro/2.0' + tail;

  try {
    const token = await getToken(id, secret);
    const tenant = await getTenant(token);
    const r = await fetch(upstream, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Xero-tenant-id': tenant, 'Accept': 'application/json' },
    });
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ error: 'Xero request failed.', detail: String(e && e.message || e) });
  }
}
