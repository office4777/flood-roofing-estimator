// "It will no longer let me exclude the gutter from the job pack."
//
// The Job Pack defaulted the gutter type to 125mm Box the moment the gutter
// section was considered included — and "included" was inferred from gutter
// lines being drawn, which is true of most roofs. So a roofer who picked
// "None, no gutter required" had it silently undone on the next render: the
// select flipped back to Colorsteel 125mm Box Gutter and the gutter went back
// onto the order. On a roof with gutters drawn there was no way to leave the
// gutter off the job.
//
// The type select and the "Include in PDF" tick are one decision seen two
// ways; this suite holds them to that.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(){
  const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
    localStorage.removeItem('fr_jp_gutter_include'); });
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2700);
  // A gable with gutter drawn on it — the state the bug needed.
  await pg.evaluate(() => {
    DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 20;
    DRAW.outline = [[100,100],[900,100],[900,500],[100,500]]; DRAW.outlineDone = true;
    DRAW.lines = [
      { type:'ridge',  pts:[[100,300],[900,300]], measM:12.7 },
      { type:'gutter', pts:[[100,100],[900,100]], measM:12.7 },
      { type:'gutter', pts:[[100,500],[900,500]], measM:12.7 },
    ];
    DRAW.roofs = null; try { redrawAll(); } catch(e){}
    gotoTab('jobpack');
  });
  await pg.waitForTimeout(400);
  return { ctx, pg, errs };
}
const state = pg => pg.evaluate(() => ({
  sel: (document.getElementById('matGutter')||{}).value,
  stored: localStorage.getItem('fr_jp_gutter_include'),
  // NOT the heading: that is emitted either way, because it carries the tick
  // you use to turn the section back on. The in-section gutter type picker is
  // only built when the gutter is actually included, so that is the honest
  // signal for "is the gutter on this job".
  sectionShown: !!document.querySelector('[onchange*="_matGutterTypeSet"]'),
}));

let { ctx, pg, errs } = await open();

// ── the fix ───────────────────────────────────────────────────────
await pg.evaluate(() => _matGutterTypeSet('none'));
await pg.waitForTimeout(350);
let v = await state(pg);
check('picking "None" excludes the gutter', v.sel === 'none' && v.stored === '0',
  'sel=' + v.sel + ' stored=' + v.stored);
check('…and the section comes off the job pack', !v.sectionShown);

// The render is what used to undo it.
await pg.evaluate(() => { renderJobPack(); renderJobPack(); });
await pg.waitForTimeout(350);
v = await state(pg);
check('…and it STAYS off when the job pack re-renders', v.sel === 'none' && !v.sectionShown,
  'sel=' + v.sel);

// ── picking a gutter still works, and still defaults sensibly ─────
await pg.evaluate(() => _matGutterTypeSet('marley-classic'));
await pg.waitForTimeout(350);
v = await state(pg);
check('picking a gutter puts it back on', v.sel === 'marley-classic' &&
  v.stored === '1' && v.sectionShown, 'sel=' + v.sel);
await pg.evaluate(() => { renderJobPack(); });
await pg.waitForTimeout(300);
v = await state(pg);
check('…and the chosen type is not overwritten by the box-gutter default',
  v.sel === 'marley-classic', v.sel);

// ── the tick and the select say the same thing ────────────────────
await pg.evaluate(() => _jpToggleGutterInclude(false));
await pg.waitForTimeout(350);
v = await state(pg);
check('unticking Include also clears the type, so the two agree',
  v.stored === '0' && v.sel === 'none' && !v.sectionShown, 'sel=' + v.sel);
await pg.evaluate(() => _jpToggleGutterInclude(true));
await pg.waitForTimeout(350);
v = await state(pg);
check('…and ticking it back picks a real gutter rather than leaving None',
  v.stored === '1' && v.sel !== 'none' && v.sectionShown, 'sel=' + v.sel);
await ctx.close();

// ── gutter is OFF until asked for ─────────────────────────────────
// Gutter is its own trade and its own decision — plenty of jobs are a re-roof
// with the existing spouting staying put. Arriving on the order by default
// meant noticing and removing it every time.
({ ctx, pg, errs } = await open());
await pg.evaluate(() => { renderJobPack(); });
await pg.waitForTimeout(400);
v = await state(pg);
check('a roof with gutters drawn does NOT put gutter on the order by default',
  !v.sectionShown, 'sel=' + v.sel + ' shown=' + v.sectionShown);
check('…without silently recording a choice the roofer never made',
  v.stored === null, 'stored=' + v.stored);
// …and one tick is all it takes to put it on.
await pg.evaluate(() => _jpToggleGutterInclude(true));
await pg.waitForTimeout(350);
v = await state(pg);
check('…and one tick puts it on, with a real gutter selected',
  v.sectionShown && v.sel !== 'none' && v.stored === '1', 'sel=' + v.sel);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
