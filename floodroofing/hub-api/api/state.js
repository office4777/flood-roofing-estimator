// GET  /api/state           -> { data:{fr3_*:...}, meta:{updatedAt,updatedBy} }
// POST /api/state { data }   -> { ok:true, meta }
// The shared dashboard state for the ONE company. Requires a valid bearer token
// (from /api/auth) OR the cron secret header (for the nightly headless sync).
const { cors, requireUser, kv, readBody } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = requireUser(req);
  const cronOk = process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  if (!user && !cronOk) return res.status(401).json({ error: 'Not authorised.' });

  try {
    if (req.method === 'GET') {
      const raw = await kv(['GET', 'hub:state']);
      const meta = await kv(['GET', 'hub:state:meta']);
      return res.status(200).json({ data: raw ? JSON.parse(raw) : {}, meta: meta ? JSON.parse(meta) : null });
    }
    if (req.method === 'POST') {
      const body = readBody(req);
      const data = body.data && typeof body.data === 'object' ? body.data : {};
      await kv(['SET', 'hub:state', JSON.stringify(data)]);
      const meta = { updatedAt: Date.now(), updatedBy: (user && user.u) || 'nightly sync', keys: Object.keys(data).length };
      await kv(['SET', 'hub:state:meta', JSON.stringify(meta)]);
      return res.status(200).json({ ok: true, meta });
    }
    return res.status(405).json({ error: 'GET or POST.' });
  } catch (e) {
    if (e && e.code === 'NOKV') return res.status(501).json({ error: e.message });
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
