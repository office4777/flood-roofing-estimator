// Flashings used to carry a flat 1.2x. That is wrong in both directions: it
// under-covers a roof cut into lots of short runs, because each run needs its
// own offcut whatever its length, and it badly over-covers a long clean one —
// 20% of a 60m gutter is 12m of gutter nobody buys. On a real commercial job
// that one factor put $898 of guttering into the quote.
//
// The rule now is what actually gets allowed on the order: half a metre on
// every run, plus a lap for every JOIN, 8m being the longest stick off the
// truck. Both per RUN — joins happen along a length, not across a job.
//
// Joins, not eighths. An 8m run is one stick and needs no join, so it carries
// nothing; 8.1m is two sticks and one join. The exact multiples are where this
// differs from counting eighths, and they are exactly the lengths a roofer
// draws, so they get their own checks below.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2600);

const W = (lens, fb) => pg.evaluate(([l, f]) => _flashWaste(l, f), [lens, fb]);

// ── the rule itself ───────────────────────────────────────────────
let v = await W([6]);
check('a short run gets half a metre and no lap', v.total === 6.5 && v.waste === 0.5,
  v.net + ' + ' + v.waste + ' = ' + v.total);

// The boundary. 8m is one stick off the truck, so there is nothing to join.
v = await W([8]);
check('eight metres is one stick and needs no join',
  Math.abs(v.total - 8.5) < 1e-9 && v.joins === 0, '8 → ' + v.total.toFixed(2));

v = await W([8.1]);
check('…a hair over is two sticks and one join',
  Math.abs(v.total - 8.7) < 1e-9 && v.joins === 1, '8.1 → ' + v.total.toFixed(2));

v = await W([7.9]);
check('…and just under is still one stick', v.joins === 0 && Math.abs(v.total - 8.4) < 1e-9,
  '7.9 → ' + v.total.toFixed(2));

v = await W([16]);
check('sixteen metres is two sticks, so one join',
  Math.abs(v.total - 16.6) < 1e-9 && v.joins === 1, '16 → ' + v.total.toFixed(2));

v = await W([20]);
check('twenty metres is three sticks, so two joins',
  Math.abs(v.total - 20.7) < 1e-9 && v.joins === 2, '20 → ' + v.total.toFixed(2));

v = await W([24]);
check('twenty-four is three sticks exactly, still two joins',
  Math.abs(v.total - 24.7) < 1e-9 && v.joins === 2, '24 → ' + v.total.toFixed(2));

// A length that is 8m in every practical sense but not in floating point
// must not buy a join it does not need.
v = await W([8 + 1e-12]);
check('floating-point dust at a stick boundary buys nothing', v.joins === 0,
  'joins=' + v.joins);

// ── per run, not per total ────────────────────────────────────────
const many = await W([5,5,5,5,5,5]);      // 30m as six runs
const one  = await W([30]);               // 30m as one
check('thirty metres as six runs wants six offcuts',
  Math.abs(many.total - 33) < 1e-9 && many.runs === 6, '30m/6 → ' + many.total.toFixed(2));
check('…and as a single run wants one, plus its joins',
  Math.abs(one.total - 30.8) < 1e-9 && one.runs === 1 && one.joins === 3,
  '30m/1 → ' + one.total.toFixed(2));
check('…so how the roof is cut up changes the order, which a flat factor never did',
  many.total > one.total, many.total.toFixed(2) + ' vs ' + one.total.toFixed(2));

// ── what it replaces ──────────────────────────────────────────────
// The commercial job that started this: a long clean gutter run.
v = await W([60]);
// Eight sticks, so seven joins: 0.5 + 0.7.
check('a 60m gutter carries 1.2m of waste, not 12m',
  Math.abs(v.total - 61.2) < 1e-9 && v.joins === 7,
  'was 72.0 (×1.2), now ' + v.total.toFixed(1));
check('…which is most of the $898 that went out on a real quote',
  (72 - v.total) > 10, (72 - v.total).toFixed(1) + 'm less gutter');

// A chopped-up roof is the case the flat factor UNDER-covered.
v = await W([1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2]);   // 9.6m over eight stubs
check('eight short stubs now carry more than 20%, because each needs an offcut',
  v.total > 9.6 * 1.2, v.total.toFixed(1) + ' vs ' + (9.6*1.2).toFixed(1) + ' under the old factor');

// ── the edges ─────────────────────────────────────────────────────
v = await W([]);
check('nothing drawn is nothing ordered', v.total === 0 && v.runs === 0);
v = await W([0, 5, -2]);
check('zero and nonsense lengths are not runs', v.runs === 1 && v.total === 5.5,
  v.runs + ' run(s), ' + v.total);
v = await W(null, 12);
check('older saved roofs with no per-run data fall back to one run',
  Math.abs(v.total - 12.6) < 1e-9 && v.runs === 1 && v.joins === 1,
  '12 → ' + v.total.toFixed(1));

// ── the note a roofer reads ───────────────────────────────────────
v = await pg.evaluate(() => _flashWasteNote(_flashWaste([5,5,5,5,5,5])));
check('the row says where the waste came from', /3\.0m waste/.test(v) && /0\.5m × 6 runs/.test(v), v);
v = await pg.evaluate(() => _flashWasteNote(_flashWaste([20])));
check('…and counts the joins it is paying laps on',
  /1 run\b/.test(v) && /0\.2m over 2 joins/.test(v), v);
v = await pg.evaluate(() => _flashWasteNote(_flashWaste([8])));
check('…and says nothing about joins on a single stick', !/join/.test(v), v);

// ── it reaches the actual price rows ──────────────────────────────
v = await pg.evaluate(() => {
  DRAW.roofs = null;
  DRAW.lines = [
    { type:'barge', measM:'5' }, { type:'barge', measM:'5' },
    { type:'gutter', measM:'12' },
    { type:'ridge', measM:'9' }, { type:'hip', measM:'4' },
  ];
  DRAW.outline = null; DRAW.scaleMetresPerPx = null;
  const rows = _buildMaterialPriceRows();
  const by = {}; rows.forEach(r => by[r.key] = r);
  return {
    barge:  by.barge  ? { q: by.barge.autoQty,  n: by.barge.note }  : null,
    gutter: by.gutter ? { q: by.gutter.autoQty, n: by.gutter.note } : null,
    ridge:  by.ridge  ? { q: by.ridge.autoQty,  n: by.ridge.note }  : null,
  };
});
check('two 5m barges price at 11m, not 12m',
  Math.abs(v.barge.q - 11) < 1e-9, v.barge.q + ' — ' + v.barge.n);
check('a 12m gutter prices at 12.6m, not 14.4m',
  Math.abs(v.gutter.q - 12.6) < 1e-9, v.gutter.q.toFixed(2) + ' — ' + v.gutter.n);
// 9m ridge (2 sticks, 1 join) + 4m hip (1 stick, none) = 13 + 0.5 + 0.5 + 0.1
check('ridge and hip share a row but stay two runs',
  Math.abs(v.ridge.q - 14.1) < 1e-9 && /× 2 runs/.test(v.ridge.n),
  v.ridge.q.toFixed(2) + ' — ' + v.ridge.n);
check('no row still claims a 1.2× factor',
  ![v.barge.n, v.gutter.n, v.ridge.n].some(n => /1\.2/.test(n)),
  [v.barge.n, v.gutter.n, v.ridge.n].join(' | '));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
