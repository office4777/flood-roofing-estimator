require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3456;

// ── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3456',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Raw body for Stripe webhooks ──────────────────────────────────────────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Auth middleware ───────────────────────────────────────────────────────────
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

// Check subscription is active
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

    if (!isActive && !inTrial) {
      return res.status(403).json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    fergus: !!process.env.FERGUS_API_KEY,
    supabase: !!process.env.SUPABASE_URL,
    stripe: !!process.env.STRIPE_SECRET_KEY,
  });
});

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// Register
app.post('/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    // Create user in Supabase Auth
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email, password,
      user_metadata: { name, company },
      email_confirm: true, // skip email confirmation for now
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    const userId = authData.user.id;

    // Create profile
    await supabase.from('profiles').insert({
      id: userId, email, name: name || '', company: company || '',
    });

    // Give 14-day free trial
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await supabase.from('subscriptions').insert({
      user_id: userId,
      status: 'trialing',
      trial_ends_at: trialEnd.toISOString(),
    });

    const token = jwt.sign(
      { id: userId, email },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '30d' }
    );

    res.json({ token, user: { id: userId, email, name, company }, trial_ends_at: trialEnd });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });

    const userId = data.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();

    const token = jwt.sign(
      { id: userId, email },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '30d' }
    );

    res.json({ token, user: { ...profile }, subscription: sub });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get current user
app.get('/auth/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', req.user.id).single();
  res.json({ user: profile, subscription: sub });
});

// ── JOBS (saved estimates) ────────────────────────────────────────────────────

app.get('/jobs', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, client_name, site_address, created_at, updated_at, status')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/jobs', requireAuth, requireSubscription, async (req, res) => {
  const { client_name, site_address, draw_state, settings } = req.body;
  const { data, error } = await supabase.from('jobs').insert({
    user_id: req.user.id,
    client_name: client_name || '',
    site_address: site_address || '',
    draw_state: draw_state || {},
    settings: settings || {},
    status: 'draft',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (error) return res.status(404).json({ error: 'Job not found' });
  res.json(data);
});

app.delete('/jobs/:id', requireAuth, async (req, res) => {
  await supabase.from('jobs').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ ok: true });
});

// ── STRIPE BILLING ────────────────────────────────────────────────────────────
let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  console.log('Stripe not initialised:', e.message);
}

// Create checkout session
app.post('/billing/checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { plan } = req.body; // 'monthly' or 'yearly'
  const priceId = plan === 'yearly'
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  const { data: profile } = await supabase.from('profiles').select('email').eq('id', req.user.id).single();

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: profile?.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/billing/success?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/billing`,
    metadata: { user_id: req.user.id },
  });

  res.json({ url: session.url });
});

// Customer portal (manage subscription)
app.post('/billing/portal', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { data: sub } = await supabase.from('subscriptions').select('stripe_customer_id').eq('user_id', req.user.id).single();
  if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/settings`,
  });
  res.json({ url: session.url });
});

// Stripe webhook
app.post('/webhook', async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  const session = event.data.object;
  const userId = session.metadata?.user_id;

  if (event.type === 'checkout.session.completed' && userId) {
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    await supabase.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      status: sub.status,
      plan: sub.items.data[0]?.price?.recurring?.interval || 'month',
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      trial_ends_at: null,
    }, { onConflict: 'user_id' });
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const { data: profile } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', session.id)
      .single();

    if (profile) {
      await supabase.from('subscriptions').update({
        status: session.status,
        current_period_end: new Date(session.current_period_end * 1000).toISOString(),
      }).eq('stripe_subscription_id', session.id);
    }
  }

  res.json({ received: true });
});

// ── CLAUDE AI PROXY ───────────────────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname, port: 443, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

app.post('/claude/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' });
  const path = req.path.replace(/^\/claude/, '');
  try {
    const r = await httpsPost('api.anthropic.com', path, {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    }, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── FERGUS PROXY ──────────────────────────────────────────────────────────────
app.all('/fergus/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const path = req.path.replace(/^\/fergus/, '');
  try {
    const r = await httpsPost('api.fergus.com', path, {
      'Authorization': `Bearer ${process.env.FERGUS_API_KEY}`,
    }, req.body);
    res.status(r.status).set('Content-Type', 'application/json').send(r.body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── TILE PROXY (satellite imagery) ───────────────────────────────────────────
app.get('/tiles/*', async (req, res) => {
  // proxy satellite tiles (no auth needed, just rate-limiting by IP in future)
  const parts = req.path.replace('/tiles/', '').split('/');
  const [z, y, x] = parts;
  const tileUrl = `/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  const chunks = [];
  const tileReq = https.request({
    hostname: 'server.arcgisonline.com', port: 443, path: tileUrl, method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' }
  }, (tileRes) => {
    tileRes.on('data', c => chunks.push(c));
    tileRes.on('end', () => {
      res.set('Content-Type', tileRes.headers['content-type'] || 'image/jpeg');
      res.set('Cache-Control', 'max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(Buffer.concat(chunks));
    });
  });
  tileReq.on('error', () => res.status(502).end());
  tileReq.end();
});

// ── NOMINATIM PROXY ───────────────────────────────────────────────────────────
app.get('/nominatim/*', async (req, res) => {
  const path = req.path.replace(/^\/nominatim/, '');
  const qs = new URLSearchParams(req.query).toString();
  const fullPath = `${path}${qs ? '?' + qs : ''}`;
  try {
    const r = await new Promise((resolve, reject) => {
      const r2 = https.request({
        hostname: 'nominatim.openstreetmap.org', port: 443,
        path: fullPath, method: 'GET',
        headers: { 'User-Agent': 'FloodRoofingEstimator/1.0', 'Accept-Language': 'en' }
      }, (res2) => {
        let d = ''; res2.on('data', c => d += c); res2.on('end', () => resolve({ status: res2.statusCode, body: d }));
      });
      r2.on('error', reject); r2.end();
    });
    res.status(r.status).set('Content-Type', 'application/json').set('Access-Control-Allow-Origin', '*').send(r.body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Mapbox image proxy ────────────────────────────────────────────────────────
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  Flood Roofing Estimator - Backend');
  console.log(`  http://localhost:${PORT}`);
  console.log('========================================');
  console.log(`  Claude AI:  ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'NOT SET'}`);
  console.log(`  Fergus:     ${process.env.FERGUS_API_KEY ? 'OK' : 'NOT SET'}`);
  console.log(`  Supabase:   ${process.env.SUPABASE_URL ? 'OK' : 'NOT SET'}`);
  console.log(`  Stripe:     ${process.env.STRIPE_SECRET_KEY ? 'OK' : 'NOT SET'}`);
  console.log('========================================\n');
});
