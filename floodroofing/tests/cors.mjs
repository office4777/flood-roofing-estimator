// Does the backend actually accept the new domain? A domain missing from the
// allowlist loads the page and then fails every API call, which is the most
// confusing possible failure — so this is worth pinning down.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const { port } = await startFakePostgrest({ profiles: [], jobs: [], user_settings: [], company_users: [] });
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34568';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.FRONTEND_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

async function allowed(origin){
  const r = await fetch('http://127.0.0.1:' + PORT + '/health', { headers: { Origin: origin } });
  return r.headers.get('access-control-allow-origin') === origin;
}
for (const o of [
  'https://roofmap.co.nz',
  'https://www.roofmap.co.nz',
  'https://quote.roofmap.co.nz',
  'https://roofmap.com',
  'https://www.roofmap.com',
]) check('the backend accepts ' + o, await allowed(o));

check('the existing Flood Roofing domain still works', await allowed('https://quote.floodroofing.co.nz'));
check('…and so does the Vercel production alias', await allowed('https://flood-roofing-estimator.vercel.app'));

check('…and this project\'s own branch previews',
  await allowed('https://flood-roofing-estimator-git-main-office4777s-projects.vercel.app'));

// and it is still not an open door
for (const o of ['https://roofmap.co.nz.attacker.com', 'https://notroofmap.co.nz', 'https://evil.com', 'https://someone-else.vercel.app',
  // an attacker's own Vercel project named to share our prefix — its prod
  // alias and its preview host both start with the prefix but carry the
  // attacker's team slug, not ours
  'https://flood-roofing-estimator-evil.vercel.app',
  'https://flood-roofing-estimator-git-main-attackers-projects.vercel.app'])
  check('still refuses ' + o, !(await allowed(o)));

// A business that points its OWN domain at the app serves the customer quote
// from there, and that page calls the public /q/ routes cross-origin. Those
// are token-guarded and cookieless, so they reflect any origin — but that must
// NOT leak into the authenticated office routes.
async function quoteRouteAllows(origin){
  const r = await fetch('http://127.0.0.1:' + PORT + '/q/sometoken', { headers: { Origin: origin } });
  return r.headers.get('access-control-allow-origin') === origin;
}
check('a business\'s own quote domain can load the customer quote',
  await quoteRouteAllows('https://quote.acmeroofing.co.nz'));
check('…and so can any other business\'s', await quoteRouteAllows('https://quotes.bobtheroofer.nz'));
check('…but the public route never hands out credentials', await (async () => {
  const r = await fetch('http://127.0.0.1:' + PORT + '/q/sometoken', { headers: { Origin: 'https://quote.acmeroofing.co.nz' } });
  return r.headers.get('access-control-allow-credentials') !== 'true';
})());
check('an unknown origin still cannot reach the OFFICE routes',
  !(await allowed('https://quote.acmeroofing.co.nz')), 'authenticated routes stayed locked');

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
