// Run every suite and fail the build if any of them does.
//
//   node floodroofing/tests/run.mjs           # everything
//   node floodroofing/tests/run.mjs api       # just the backend suites
//   node floodroofing/tests/run.mjs ui        # just the browser suites
//   node floodroofing/tests/run.mjs plans     # one suite by name
//
// These suites existed before this runner did — they were run by hand, which
// meant they were run when somebody remembered. That is not a gate.
//
// Each suite is a standalone script that prints PASS/FAIL lines and exits
// non-zero if anything failed, so there is no framework here and none needed.
// They run one at a time on purpose: the backend suites each boot the real
// Express app on a fixed port, and the browser suites each drive a 2.5 MB
// page. Parallelising them would buy a minute and cost the ability to read
// the output.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// The real Express app against an in-memory stand-in for PostgREST. Fast,
// no browser, and the place a multi-tenancy bug shows up first.
const API = [
  'orgapi', 'teamapi', 'domainapi', 'dupjob', 'plans', 'cors', 'errmon', 'usage', 'trial', 'invoiceapi', 'stripeapi', 'security', 'sharetoken', 'crosstenant', 'bodylimit',
];
// The real index.html, driven by Playwright.
const UI = [
  'tenantbrand', 'ownbrand', 'pricebook', 'samplejob', 'crashui', 'landing', 'signup', 'quotedomain',
  'gutterprice', 'officebar', 'roofrename', 'acceptcarry', 'orgui', 'teamui', 'dupjobui',
  'trialui', 'legal', 'photospanel', 'aerialmap', 'invoiceui', 'jobfiles', 'nojms', 'billingui', 'disclaimers',
];

const arg = (process.argv[2] || '').toLowerCase();
let suites;
if (arg === 'api') suites = API;
else if (arg === 'ui') suites = UI;
else if (arg) suites = [...API, ...UI].filter(s => s === arg);
else suites = [...API, ...UI];

if (!suites.length){
  console.error('No suite matches "' + arg + '". Known: ' + [...API, ...UI].join(', '));
  process.exit(2);
}

// Each backend suite boots the real Express app on a port. Handing out a
// distinct one per suite means a leftover process from an earlier run can't
// make an unrelated suite look broken.
let _nextPort = 35100;
function run(name){
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [join(HERE, name + '.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { TEST_PORT: String(_nextPort++) }),
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    // A hung browser must not hold the build open until the runner's own
    // timeout kills it with no output at all.
    const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch(e){} }, 240000);
    p.on('close', (code) => {
      clearTimeout(killer);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const tally = (out.match(/^(\d+)\/(\d+) passed$/m) || [])[0] || (code === 0 ? 'passed' : 'FAILED');
      console.log((code === 0 ? '  ok  ' : '  FAIL') + '  ' + name.padEnd(14) + tally.padEnd(14) + secs + 's');
      // Only the failing suite's output is worth printing — a green run that
      // dumps 300 PASS lines is a run nobody reads.
      if (code !== 0){
        console.log(out.split('\n').filter(l => /FAIL|PAGEERROR|Error|passed$/.test(l)).map(l => '        ' + l).join('\n'));
      }
      resolve({ name, code, out });
    });
  });
}

console.log('RoofMap — ' + suites.length + ' suite' + (suites.length === 1 ? '' : 's') + '\n');
const failed = [];
for (const s of suites){
  const r = await run(s);
  if (r.code !== 0) failed.push(s);
}
console.log('');
if (failed.length){
  console.log(failed.length + ' of ' + suites.length + ' suites failed: ' + failed.join(', '));
  process.exit(1);
}
console.log('all ' + suites.length + ' suites passed');
