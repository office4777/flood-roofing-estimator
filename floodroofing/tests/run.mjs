// Run every suite and fail the build if any of them does.
//
//   node floodroofing/tests/run.mjs           # everything
//   node floodroofing/tests/run.mjs api       # just the backend suites
//   node floodroofing/tests/run.mjs ui        # just the browser suites
//   node floodroofing/tests/run.mjs plans     # one suite by name
//
//   JOBS=1 node floodroofing/tests/run.mjs   # one at a time, for a clean read
//
// These suites existed before this runner did — they were run by hand, which
// meant they were run when somebody remembered. That is not a gate.
//
// Each suite is a standalone script that prints PASS/FAIL lines and exits
// non-zero if anything failed, so there is no framework here and none needed.
//
// They used to run strictly one at a time, because the backend suites each
// booted Express on a FIXED port and would have collided. That stopped being
// true when this runner started handing every suite its own TEST_PORT below —
// the reason outlived the problem, and the whole run cost 28 minutes when the
// browser suites are independent processes that could have shared the machine.
// A pool of four takes it to about eight.
//
// Output stays readable because each suite's output is buffered and printed as
// one line when it finishes, so the lines interleave by completion time rather
// than turning into four streams of noise. Only a failing suite prints more.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// The real Express app against an in-memory stand-in for PostgREST. Fast,
// no browser, and the place a multi-tenancy bug shows up first.
const API = [
  'orgapi', 'teamapi', 'domainapi', 'dupjob', 'jobsave', 'gutterexclude', 'sheetbarge', 'jpmaps', 'plans', 'cors', 'errmon', 'usage', 'trial', 'invoiceapi', 'stripeapi', 'security', 'sharetoken', 'crosstenant', 'bodylimit', 'markupleak', 'revisionapi', 'mailidentity', 'platformmail', 'waitlist', 'metrics',
];
// The real app.html, driven by Playwright.
const UI = [
  'tenantbrand', 'ownbrand', 'pricebook', 'samplejob', 'crashui', 'landing', 'signup', 'quotedomain',
  'gutterprice', 'officebar', 'roofrename', 'acceptcarry', 'orgui', 'teamui', 'dupjobui',
  'trialui', 'legal', 'photospanel', 'aerialmap', 'invoiceui', 'jobfiles', 'nojms', 'billingui', 'disclaimers', 'matbuffer', 'pbcsv', 'selectables', 'pricegold', 'pipeflash', 'sheetruns', 'siteflash', 'siteflashpad', 'boxpentrace', 'flashwaste', 'sitebars', 'jmsrequest', 'fbcontext', 'roofimg', 'freedraw', 'roofnotes', 'rapidcam', 'roofsafe', 'fbgeom', 'pbextras', 'setupguide', 'flashdelete', 'clearlite', 'monocount', 'jpedit', 'pricingmap', 'foldedpricing', 'pbextraqty', 'boxpenflash', 'roofnamemap', 'chainwalk', 'canvassetup', 'roofmenu', 'sheetrun1024', 'bgmatch', 'tutorial', 'seo', 'sitebrand', 'quotelink', 'quotebar', 'roofhistory', 'lkgguard', 'rotatefine', 'snapreach', 'roofpitch',
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

// How many at once. Four on a four-core box: the browser suites are the bulk
// of the run and each drives one headless Chromium, so this saturates the
// machine without oversubscribing it into swap. JOBS=1 restores the old
// strictly-serial behaviour, which is what to reach for when a failure needs
// reading rather than counting.
const JOBS = Math.max(1, parseInt(process.env.JOBS, 10) || Math.min(4, cpus().length || 4));

// The long ones, started first. With a pool, total time is set by whatever is
// still running at the end — and trialui alone is over three minutes, so
// picking it up last would leave three idle workers waiting on it. Longest-first
// is the standard fix and it is worth the dozen lines.
const SLOW = new Set(['trialui', 'setupguide', 'sitebars', 'tutorial', 'gutterprice',
                      'pbextraqty', 'billingui', 'photospanel', 'jmsrequest', 'teamui',
                      'plans', 'gutterexclude', 'jpmaps']);

// Each backend suite boots the real Express app on a port. Handing out a
// distinct one per suite means a leftover process from an earlier run can't
// make an unrelated suite look broken — and it is what makes running them
// side by side safe at all.
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
    // timeout kills it with no output at all. Ten minutes, not the four this
    // used to be: trialui takes over three on an idle machine, and sharing four
    // cores with three other suites can push a healthy run past the old ceiling
    // — which would have killed it and reported a passing suite as hung.
    const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch(e){} }, 600000);
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

console.log('RoofMap — ' + suites.length + ' suite' + (suites.length === 1 ? '' : 's')
  + (JOBS > 1 ? ', ' + JOBS + ' at a time' : '') + '\n');

// Longest-first, but only as a scheduling hint — the reported failures below
// still come back in the order the suites are declared, so a run is comparable
// with the one before it however the workers happened to interleave.
const queue = suites.slice().sort((a, b) => (SLOW.has(b) ? 1 : 0) - (SLOW.has(a) ? 1 : 0));
const started = Date.now();
const bad = new Set();
let next = 0;
async function worker(){
  while (next < queue.length){
    const name = queue[next++];
    const r = await run(name);
    if (r.code !== 0) bad.add(name);
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, worker));

const failed = suites.filter(s => bad.has(s));
console.log('\n' + ((Date.now() - started) / 1000).toFixed(0) + 's total');
if (failed.length){
  console.log(failed.length + ' of ' + suites.length + ' suites failed: ' + failed.join(', '));
  process.exit(1);
}
console.log('all ' + suites.length + ' suites passed');
