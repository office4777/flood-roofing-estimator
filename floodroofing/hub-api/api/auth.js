// POST /api/auth  { user, pass }  ->  { token, user }
// Users come from the HUB_USERS env var: "office:secret1,manager:secret2"
// A valid login returns a 30-day signed bearer token the Hub stores locally.
const { cors, sign, readBody } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  if (!process.env.SESSION_SECRET) return res.status(500).json({ error: 'Server not configured: SESSION_SECRET missing.' });

  const users = {};
  (process.env.HUB_USERS || '').split(',').forEach(pair => {
    const i = pair.indexOf(':');
    if (i > 0) users[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
  });
  if (!Object.keys(users).length) return res.status(500).json({ error: 'Server not configured: HUB_USERS missing.' });

  // Restricted "project manager" accounts: usernames listed in HUB_PM_USERS (comma-separated) get
  // role 'pm' — the Hub hides the cash/bank/P&L/growth areas for them. Everyone else is 'full'.
  // Kept separate from HUB_USERS so the first-colon password parsing above is untouched.
  const pmUsers = new Set((process.env.HUB_PM_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

  const body = readBody(req);
  const u = String(body.user || '').trim().toLowerCase();
  const pw = String(body.pass || '');
  if (!u || !users[u] || users[u] !== pw) return res.status(401).json({ error: 'Wrong username or password.' });

  const role = pmUsers.has(u) ? 'pm' : 'full';
  const token = sign({ u, role, exp: Date.now() + 30 * 86400000 });
  return res.status(200).json({ token, user: u, role });
};
