require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3456;

// Supabase - uses SUPABASE_ANON_KEY (set on Railway)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3456',
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// 25mb cap so saved jobs can include a base64 roof image + photos
app.use(express.json({ limit: '25mb' }));

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

async function requireSubscription(req, res, next) {
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', req.user.id)
      .single();
    if (!data) return res.status(403).json({ error: 'No subscription found' });
    const isActive = data.status === 'active' || data.status === 'trialing';
    const inTrial = data.trial_ends_at && new Date(data.trial_ends_at) > new Date();
    if (!isActive && !inTrial) return res.status(403).json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, supabase: process.env.SUPABASE_URL ? 'OK' : 'NOT SET' });
});

app.post('/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  try {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return res.status(400).json({ error: error.message });
    const userId = data.user.id;
    await supabase.from('profiles').insert({ id: userId, email, name: name || '', company: company || '' });
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await supabase.from('subscriptions').insert({ user_id: userId, status: 'trialing', trial_ends_at: trialEnd.toISOString() });
    const token = jwt.sign({ id: userId, email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
    res.json({ token, user: { id: userId, email, name, company } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    const userId = data.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();
    const token = jwt.sign({ id: userId, email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
    res.json({ token, user: { ...profile }, subscription: sub });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', req.user.id).single();
  res.json({ user: profile, subscription: sub });
});

app.post('/billing/checkout', requireAuth, (req, res) => res.status(503).json({ error: 'Billing not configured yet' }));
app.post('/billing/portal', requireAuth, (req, res) => res.status(503).json({ error: 'Billing not configured yet' }));
app.post('/webhook', (req, res) => res.status(503).json({ error: 'Webhooks not configured yet' }));

app.get('/jobs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').select('id, client_name, site_address, created_at, updated_at, status').eq('user_id', req.user.id).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/jobs', requireAuth, requireSubscription, async (req, res) => {
  const { client_name, site_address, draw_state, settings } = req.body;
  const { data, error } = await supabase.from('jobs').insert({ user_id: req.user.id, client_name: client_name || '', site_address: site_address || '', draw_state: draw_state || {}, settings: settings || {}, status: 'draft' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/jobs/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('jobs').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Per-user settings: branding, quote defaults, JMS API keys.
app.get('/settings', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || { user_id: req.user.id, branding: {}, quote_defaults: {}, jms_keys: {} });
});

app.put('/settings', requireAuth, async (req, res) => {
  const { branding, quote_defaults, jms_keys } = req.body;
  const row = {
    user_id: req.user.id,
    branding: branding || {},
    quote_defaults: quote_defaults || {},
    jms_keys: jms_keys || {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

function httpsPost(host, path, headers, body) {
  return httpsRequest(host, path, 'POST', headers, body);
}

function httpsRequest(host, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const data = hasBody ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (hasBody) h['Content-Length'] = Buffer.byteLength(data);
    const req = https.request({ hostname: host, path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    if (hasBody) req.write(data);
    req.end();
  });
}

app.post('/claude/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' });
  const p = req.path.replace(/^\/claude/, '');
  try {
    const r = await httpsPost('api.anthropic.com', p, { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Fergus proxy. Honors the caller's HTTP method (GET/POST/PUT/DELETE) and
// only sends a JSON body when the method allows one. Host + path prefix
// are env-configurable so they can be fixed without a code change.
const FERGUS_HOST   = process.env.FERGUS_HOST        || 'api.fergus.com';
const FERGUS_PREFIX = process.env.FERGUS_PATH_PREFIX || '';
app.all('/fergus/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const tail = req.url.replace(/^\/fergus/, '');           // keep the querystring
  const upstreamPath = FERGUS_PREFIX + tail;
  try {
    const r = await httpsRequest(FERGUS_HOST, upstreamPath, req.method, {
      'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    }, req.body);
    res.status(r.status);
    if (!r.body)                       return res.json({});
    try { return res.json(JSON.parse(r.body)); }
    catch {
      // Fergus's edge can return HTML on auth/403; surface the raw text so
      // the caller can see what went wrong instead of a generic JSON-parse
      // crash on the proxy side.
      return res.type('text/plain').send(r.body.slice(0, 1000));
    }
  } catch (e) {
    res.status(502).json({ error: e.message, host: FERGUS_HOST, path: upstreamPath });
  }
});

// JMS configuration diagnostic. Returns just enough information for the
// user to verify Railway env vars are loaded WITHOUT exposing the secret
// (only the last 4 chars of the key + length, like Stripe's UI shows).
app.get('/jms/debug', requireAuth, (req, res) => {
  const k = process.env.FERGUS_API_KEY || '';
  res.json({
    fergus: {
      key_set: !!k,
      key_format_ok: k.startsWith('fergPAT_'),
      key_length: k.length,
      key_tail: k ? k.slice(-4) : null,
      host: FERGUS_HOST,
      path_prefix: FERGUS_PREFIX,
      computed_test_url: `https://${FERGUS_HOST}${FERGUS_PREFIX}/jobs?page=1&per_page=1`,
    },
    backend_uptime_seconds: Math.round(process.uptime()),
  });
});

app.get('/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith('https://api.mapbox.com')) return res.status(400).end();
  const chunks = [];
  https.get(url, (imgRes) => {
    imgRes.on('data', c => chunks.push(c));
    imgRes.on('end', () => {
      res.set('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(Buffer.concat(chunks));
    });
  }).on('error', () => res.status(502).end());
});

app.listen(PORT, () => {
  console.log('Flood Roofing backend running on port ' + PORT);
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'OK' : 'NOT SET'));
  console.log('Stripe: disabled');
});
