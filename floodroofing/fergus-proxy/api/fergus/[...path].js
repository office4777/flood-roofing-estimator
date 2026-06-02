// Standalone, read-only Fergus proxy for the Flood Roofing Operations Hub.
//
// Why this exists: the Hub is a single HTML file that people open on their
// phone. A phone browser can't call the Fergus API directly (CORS) and can't
// run the desktop PowerShell proxy. This tiny serverless function sits in the
// middle: the Hub calls it, it adds the Fergus key (kept server-side) and
// forwards the request to Fergus, then hands the answer back with CORS headers
// so any device — phone included — can read it.
//
// It is deliberately locked down:
//   • GET only (the Hub only ever reads from Fergus)
//   • upstream host is hard-pinned to api.fergus.com
//   • every request must carry the shared X-Proxy-Secret header
//
// Required environment variables (set these in the Vercel dashboard):
//   FERGUS_API_KEY   your Fergus Personal Access Token (fergPAT_...)
//   PROXY_SECRET     any long random string; paste the same value into the Hub

const FERGUS_HOST = 'api.fergus.com';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Proxy-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Read-only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET is allowed through this proxy.' });
  }

  const fergusKey = process.env.FERGUS_API_KEY;
  const proxySecret = process.env.PROXY_SECRET;

  if (!fergusKey) {
    return res.status(500).json({ error: 'Proxy not configured: FERGUS_API_KEY is not set.' });
  }
  // Fail closed: without a configured secret the proxy refuses to talk, so it
  // can never become an open faucet for Flood Roofing's Fergus data.
  if (!proxySecret) {
    return res.status(500).json({ error: 'Proxy not configured: PROXY_SECRET is not set.' });
  }
  if ((req.headers['x-proxy-secret'] || '') !== proxySecret) {
    return res.status(401).json({ error: 'Bad or missing X-Proxy-Secret.' });
  }

  // Everything after /api/fergus (path + querystring) is passed straight
  // through to Fergus, so /api/fergus/jobs?pageSize=100 → /jobs?pageSize=100
  const tail = req.url.replace(/^\/api\/fergus/, '') || '/';
  const upstream = 'https://' + FERGUS_HOST + tail;

  try {
    const r = await fetch(upstream, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + fergusKey, 'Accept': 'application/json' },
    });
    const body = await r.text();
    // Pass Fergus's status + body through verbatim so the Hub can surface real
    // API errors (401/403/etc.) instead of masking them as a network failure.
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Fergus.', detail: String(e && e.message || e), upstream });
  }
}
