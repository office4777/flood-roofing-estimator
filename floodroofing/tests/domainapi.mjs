// A subscriber connecting its own domain, end to end — against the real Express
// app, a stand-in PostgREST and a stand-in Vercel API. What this cannot prove
// is that Vercel's REAL responses match the shapes stubbed here.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const CO2 = 'dddddddd-1111-1111-1111-111111111111';
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const MEMBER = 'mmmmmmmm-0000-0000-0000-000000000002';

// ── stand-in Vercel ──
const vercel = { added: [], removed: [], verified: new Set(), misconfigured: new Set(), failAdd: null, calls: [] };
const vsrv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    vercel.calls.push({ m: req.method, p: u.pathname, team: u.searchParams.get('teamId'), auth: req.headers.authorization });
    const j = (code, x) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(x)); };
    let m;
    if (req.method === 'POST' && /\/v10\/projects\/[^/]+\/domains$/.test(u.pathname)){
      const name = JSON.parse(body || '{}').name;
      if (vercel.failAdd) return j(400, { error: { message: vercel.failAdd } });
      if (vercel.added.includes(name)) return j(409, { error: { message: 'Domain already exists' } });
      vercel.added.push(name);
      return j(200, { name, verified: false, verification: [{ type:'TXT', domain:'_vercel.'+name, value:'vc-domain-verify=abc' }] });
    }
    if (req.method === 'POST' && (m = u.pathname.match(/\/v9\/projects\/[^/]+\/domains\/([^/]+)\/verify$/)))
      return j(200, { verified: vercel.verified.has(decodeURIComponent(m[1])) });
    if (req.method === 'GET' && (m = u.pathname.match(/\/v6\/domains\/([^/]+)\/config$/)))
      return j(200, { misconfigured: vercel.misconfigured.has(decodeURIComponent(m[1])) });
    if (req.method === 'DELETE' && (m = u.pathname.match(/\/v9\/projects\/[^/]+\/domains\/([^/]+)$/))){
      vercel.removed.push(decodeURIComponent(m[1])); return j(200, { ok: true });
    }
    j(404, { error: { message: 'no stub for ' + req.method + ' ' + u.pathname } });
  });
});
await new Promise(r => vsrv.listen(0, '127.0.0.1', r));

const db = {
  __missing: [],
  companies: [{ id: CO, name:'Acme Roofing', slug:'acmeroofing' }, { id: CO2, name:'Other', slug:'other' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }, { company_id: CO, user_id: MEMBER, role:'member' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' },
             { id: MEMBER, company_id: CO, name:'Sue', email:'sue@acmeroofing.co.nz' }],
  company_domains: [], subscriptions: [], jobs: [], user_settings: [], company_invites: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34570';
process.env.PORT = PORT;
process.env.VERCEL_TOKEN = 'vercel-test-token';
process.env.VERCEL_PROJECT_ID = 'flood-roofing-estimator';
process.env.VERCEL_TEAM_ID = 'team_test';
process.env.VERCEL_API = 'http://127.0.0.1:' + vsrv.address().port;
delete process.env.DATABASE_URL;
process.env.BILLING_ENABLED = 'false';
const jwtLib = require('jsonwebtoken');
const tok = (id, email) => jwtLib.sign({ id, email, cid: CO }, 'test-secret', { expiresIn: '1h' });
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const api = async (method, path, body, who) => {
  const h = { 'Content-Type':'application/json' };
  if (who) h.Authorization = 'Bearer ' + tok(who.id, who.email);
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers:h, body: body?JSON.stringify(body):undefined });
  return { status: r.status, body: await r.json().catch(()=>null) };
};
const owner = { id: OWNER, email:'bob@acmeroofing.co.nz' };
const member = { id: MEMBER, email:'sue@acmeroofing.co.nz' };

// ── connecting ──
let r = await api('POST', '/team/domains', { domain: 'quote.acmeroofing.co.nz' }, member);
check('a member cannot connect a domain', r.status === 403, String(r.status));

r = await api('POST', '/team/domains', { domain: 'https://Quote.AcmeRoofing.co.nz/some/path' }, owner);
check('the owner can connect a domain, however it was typed',
  r.status === 200 && r.body.domain.domain === 'quote.acmeroofing.co.nz', JSON.stringify(r.body && r.body.domain && r.body.domain.domain));
check('…and it was actually registered with Vercel', vercel.added.includes('quote.acmeroofing.co.nz'), JSON.stringify(vercel.added));
check('…with our token and team', (vercel.calls[0]||{}).auth === 'Bearer vercel-test-token' && vercel.calls[0].team === 'team_test');
check('…it starts as pending, not connected', r.body.domain.status === 'pending', r.body.domain.status);
check('…and we tell them the ONE record to add',
  r.body.domain.dns.type === 'CNAME' && r.body.domain.dns.name === 'quote' && /vercel-dns/.test(r.body.domain.dns.value),
  JSON.stringify(r.body.domain.dns));
const domId = db.company_domains[0].id = db.company_domains[0].id || 'dom-1';

r = await api('POST', '/team/domains', { domain: 'acmeroofing.co.nz' }, owner);
check('an apex domain is told to add an A record instead',
  r.body.domain.dns.type === 'A' && r.body.domain.dns.name === '@', JSON.stringify(r.body.domain.dns));
db.company_domains[1].id = db.company_domains[1].id || 'dom-2';

// ── things that must be refused ──
for (const bad of ['not a domain', 'localhost', 'roofmap.co.nz', 'quote.roofmap.co.nz', 'floodroofing.co.nz'])
  check('"' + bad + '" is refused', (await api('POST', '/team/domains', { domain: bad }, owner)).status === 400);
r = await api('POST', '/team/domains', { domain: 'quote.acmeroofing.co.nz' }, owner);
check('adding the same domain twice is refused', r.status === 400, JSON.stringify(r.body));
db.company_domains.push({ id:'dom-x', company_id: CO2, domain:'taken.example.com', status:'verified' });
r = await api('POST', '/team/domains', { domain: 'taken.example.com' }, owner);
check('a domain another business already has is refused', r.status === 409, JSON.stringify(r.body));

// ── verifying ──
vercel.misconfigured.add('quote.acmeroofing.co.nz');
r = await api('POST', '/team/domains/' + domId + '/verify', null, owner);
check('checking before the DNS exists reports it is not ready',
  r.body.domain.status === 'pending' && /isn.t visible yet|few minutes/i.test(r.body.domain.error || ''), JSON.stringify(r.body.domain.error));
vercel.verified.add('quote.acmeroofing.co.nz');
vercel.misconfigured.delete('quote.acmeroofing.co.nz');
r = await api('POST', '/team/domains/' + domId + '/verify', null, owner);
check('once the record is in place it verifies', r.body.domain.status === 'verified', JSON.stringify(r.body.domain.status));
check('…and the verified time is recorded', !!r.body.domain.verified_at, String(r.body.domain.verified_at));
r = await api('POST', '/team/domains/' + domId + '/verify', null, member);
check('a member cannot trigger verification', r.status === 403, String(r.status));

// ── it becomes the quote domain, and the office app works there ──
r = await api('GET', '/auth/me', null, owner);
check('the app is told which domain the business is verified on',
  r.body.company && r.body.company.domain === 'quote.acmeroofing.co.nz', JSON.stringify(r.body.company));
await new Promise(res => setTimeout(res, 400));   // let the CORS cache refresh
const corsFor = async (o) => (await fetch('http://127.0.0.1:' + PORT + '/health', { headers:{ Origin:o } })).headers.get('access-control-allow-origin') === o;
check('their verified domain can reach the authenticated API', await corsFor('https://quote.acmeroofing.co.nz'));
check('…but an unverified one they merely typed cannot', !(await corsFor('https://notyet.acmeroofing.co.nz')));

// ── disconnecting ──
r = await api('DELETE', '/team/domains/' + domId, null, member);
check('a member cannot disconnect a domain', r.status === 403, String(r.status));
r = await api('DELETE', '/team/domains/' + domId, null, owner);
check('the owner can disconnect it', r.status === 200, JSON.stringify(r.body));
check('…and it is removed from Vercel too, not just from us',
  vercel.removed.includes('quote.acmeroofing.co.nz'), JSON.stringify(vercel.removed));
check('…and gone from the list', !db.company_domains.some(d => d.domain === 'quote.acmeroofing.co.nz'));

// ── Vercel refusing ──
vercel.failAdd = 'Domain is already in use by another Vercel account';
r = await api('POST', '/team/domains', { domain: 'busy.acmeroofing.co.nz' }, owner);
check('when Vercel refuses, the owner is told why rather than getting a 500',
  r.status === 400 && /already in use/.test(r.body.error || ''), JSON.stringify(r.body));
vercel.failAdd = null;

// ── with no Vercel token, the feature is simply off ──
r = await api('GET', '/team/domains', null, owner);
check('the app is told the feature is available here', r.body.enabled === true, JSON.stringify(r.body.enabled));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
