// "The roof option buttons are now missing, the customer can't include or
//  exclude a roof."
//
// S.quote.extraRoofs — the priced list behind the customer's "Include
// <roof>" buttons — was recomputed on every office refresh, and the recompute
// treated "no drawing loaded at this moment" as "this job has one roof":
// one render firing while a job was still opening wrote extraRoofs = [],
// the autosave published it, and the buttons vanished on the office AND the
// customer link — while the map, which stashes its geometry separately,
// still labelled the roofs "Optional — tap to add".
//
// The rule is the same as the aerial carry in _qpStashRoofGeom: an empty
// moment never overwrites published data with nothing. Only a real drawing
// with genuinely one roof clears the list.
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
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// A three-roof job — main + two separate optional extras, like the reported
// quote (Main Roof, Garage, Clearlite Roof).
await pg.evaluate(() => {
  gotoTab('roof');
  const mk = (name, x0) => {
    const r = _newEmptyRoof(name);
    r.outline = [[x0,100],[x0+300,100],[x0+300,300],[x0,300]];
    r.outlineDone = true; r.calPitch = 15;
    r.lines = [{type:'gutter',pts:[[x0,300],[x0+300,300]],measM:9,label:'',lengthM:''},
               {type:'ridge',pts:[[x0,100],[x0+300,100]],measM:9,label:'',lengthM:''}];
    return r;
  };
  DRAW.scaleMetresPerPx = 0.03;
  DRAW.roofs = [mk('Main Roof',100), mk('Garage',500), mk('Clearlite Roof',900)];
  DRAW.activeRoofIdx = 0;
  _loadRoofToCurrent(0);
  S.quote = S.quote || {};
  S.quote.roofSeparate = {1:true, 2:true};
  S.quote.roofExcluded = {};
  refreshQuoteProposal();
});
let s = await pg.evaluate(() => ({
  extras: (S.quote.extraRoofs || []).map(r => r.name),
  btns: !!document.querySelector('.qp-incl-btns'),
}));
check('a live three-roof job prices its two optional extras',
  s.extras.length === 2, s.extras.join(', '));
check('…and the customer\'s Include buttons render', s.btns);

// ── the fault: a refresh in a moment with no drawing loaded ────────
s = await pg.evaluate(() => {
  const saved = { roofs: DRAW.roofs, outline: DRAW.outline, scale: DRAW.scaleMetresPerPx };
  DRAW.roofs = []; DRAW.outline = []; DRAW.scaleMetresPerPx = 0;
  refreshQuoteProposal();
  const out = {
    extras: (S.quote.extraRoofs || []).map(r => r.name),
    btns: !!document.querySelector('.qp-incl-btns'),
    legend: /Not included/.test((document.getElementById('qpRoot')||{}).innerHTML || ''),
  };
  DRAW.roofs = saved.roofs; DRAW.outline = saved.outline; DRAW.scaleMetresPerPx = saved.scale;
  refreshQuoteProposal();
  return out;
});
check('a refresh while no drawing is loaded keeps the priced extras',
  s.extras.length === 2, s.extras.join(', ') + ' — this wipe is what took the buttons away');
check('…so the Include buttons stay on the page', s.btns);
check('…legend too', s.legend);

// An uncalibrated moment is the same kind of nothing.
s = await pg.evaluate(() => {
  const sc = DRAW.scaleMetresPerPx;
  DRAW.scaleMetresPerPx = 0;
  refreshQuoteProposal();
  const out = (S.quote.extraRoofs || []).length;
  DRAW.scaleMetresPerPx = sc;
  refreshQuoteProposal();
  return out;
});
check('…and an uncalibrated moment keeps them too', s === 2, s + '');

// ── the clear that is real still works ─────────────────────────────
s = await pg.evaluate(() => {
  DRAW.roofs = [DRAW.roofs[0]];
  DRAW.activeRoofIdx = 0;
  _loadRoofToCurrent(0);
  refreshQuoteProposal();
  return { extras: (S.quote.extraRoofs || []).length, btns: !!document.querySelector('.qp-incl-btns') };
});
check('a job genuinely reduced to one roof clears its stale extras',
  s.extras === 0 && !s.btns, JSON.stringify(s));

check('no page errors', errs.length === 0, errs.join(' | '));
const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
