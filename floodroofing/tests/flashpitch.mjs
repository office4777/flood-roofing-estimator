// "the angle pitch on the flashings need to match roof pitch, at the moment
//  the flashings default say 15deg but the actual roof pitch is 45 deg, i want
//  the angle on the flashings to default to the roof pitch, but then have a
//  editable pitch somewhere in the flashings on the job pack where the user
//  can edit the default flashing angle, do this for all flashings with angle,
//  some flashings have two angles, so both of them should be separately
//  editable"
//
// The library drawing says 15° because that is how it was drawn — a saved
// flashing is drawn once and used on every job after. On the JOB PACK the
// roof's pitch wins: every ∠ chip defaults to the pitch of the roof in scope,
// each marker edits on its own, the override persists with the job, and the
// shared library drawing is never touched — the same flashing serves a
// 20-degree job tomorrow. Runs against the exact 45° roof from the report.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report32.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_jp_preview','0');
  localStorage.setItem('fr_mat_flash_pick_barge|side', 'Side Barge Corro'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2700);

// His library: drawn at 15°, the way the report shows it. The side apron
// carries TWO markers — the "some flashings have two angles" case — and the
// side barge is the auto-derived card the barge cut list resolves to.
await pg.evaluate((g) => {
  const pl = (marks) => [{ vertices:[[100,300],[160,120],[420,190],[430,240]],
    measurements:{0:100,1:300,2:75}, measurementOffsets:{}, measurementFontPx:{},
    crushFolds:{}, angleMarkers: marks, kind:null }];
  const cat = _ensureCatalog();
  cat.savedFlashings = [
    { name:'Boxed Penetration Side Apron Corro', profile:'corro', flashingType:'custom',
      polylines: pl({ '1': {x:170,y:60,deg:15}, '2': {x:430,y:120,deg:15} }) },
    { name:'Boxed Penetration Bottom Apron Corro', profile:'corro', flashingType:'custom',
      polylines: pl({ '1': {x:170,y:60,deg:15} }) },
    { name:'Boxed Penetration Top Apron Corro', profile:'corro', flashingType:'custom',
      polylines: pl({ '1': {x:170,y:60,deg:15} }) },
    { name:'Boxed Penetration Top Back-Tray Corro', profile:'corro', flashingType:'custom',
      polylines: pl({ '1': {x:170,y:60,deg:15} }) },
    { name:'Boxed Penetration Chase Flashing', profile:'any', flashingType:'custom',
      polylines: pl({}) },
    { name:'Side Barge Corro', profile:'Corrugate', flashingType:'barge|side',
      polylines: pl({ '1': {x:170,y:60,deg:15} }) },
  ];
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.penetrations = (g.penetrations||[]).map(p => Object.assign({}, p,
    { type:'penetration', sizeLabel:p.size }));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx;
  S.jpFlashAngles = {};
  try { _getAllFlashings().forEach(e => { try { _ensureBuiltinSketch(e); } catch(_){} }); } catch(e){}
  try { redrawAll(); } catch(e){}
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(1800);

const readCards = () => pg.evaluate(() => {
  const out = [];
  [...document.querySelectorAll('#jpPages .mat-fl-card, #jpPages [style*="position:relative"]')].forEach(c => {
    const name = ((c.querySelector('strong') || c.querySelector('[style*="font-weight:700"]') || {}).textContent || '').trim();
    const chips = [...c.querySelectorAll('.mat-fl-angle')].map(x => x.textContent.trim());
    if (name && chips.length) out.push({ name, chips });
  });
  return out;
});

// ── the report itself: 45° roof, 15° drawings ─────────────────────
let cards = await readCards();
const barge = cards.find(c => /barge/i.test(c.name));
check('the auto barge card\'s ∠ chip says the roof\'s 45°, not the drawing\'s 15°',
  barge && barge.chips.every(t => /45°/.test(t)), JSON.stringify(barge || cards.map(c=>c.name)));
const sideAp = cards.find(c => /side apron/i.test(c.name));
check('the boxed-pen side apron card has TWO ∠ chips, both defaulting to 45°',
  sideAp && sideAp.chips.length === 2 && sideAp.chips.every(t => /45°/.test(t)),
  JSON.stringify(sideAp || '(no side apron card with chips)'));
const bfChipped = cards.filter(c => /boxed penetration/i.test(c.name) || /apron|back-tray/i.test(c.name));
check('every boxed-pen flashing with a marker got a chip', bfChipped.length >= 4,
  cards.map(c => c.name + '×' + c.chips.length).join(', '));

// ── the drawing on the card says it too ───────────────────────────
const imgs = await pg.evaluate(() => {
  const lib = _getAllFlashings();
  const entry = lib.find(e => e.name === 'Side Barge Corro');
  const card = [...document.querySelectorAll('#jpPages .mat-fl-card')]
    .find(c => /barge/i.test((c.querySelector('strong')||{}).textContent || ''));
  const img = card && card.querySelector('img');
  return { baked: (entry && entry.sketch || '').slice(0, 64), lenBaked: (entry && entry.sketch || '').length,
           shown: (img && img.src || '').slice(0, 64), lenShown: (img && img.src || '').length,
           differ: !!(entry && entry.sketch && img && img.src && entry.sketch !== img.src) };
});
check('the card\'s sketch is re-rendered with the job\'s angle, not the baked 15° PNG',
  imgs.differ, 'baked ' + imgs.lenBaked + 'B vs shown ' + imgs.lenShown + 'B');

// ── each angle edits on its own, and it sticks to the JOB ─────────
await pg.evaluate(() => {
  window.prompt = () => '30';
  const pc = _boxFlashPenList().find(x => /side apron/i.test(x.name));
  const k = 'bf:' + _bfKey(pc);
  const chips = [...document.querySelectorAll('#jpPages .mat-fl-angle')]
    .filter(b => (b.getAttribute('onclick') || '').indexOf("'" + k + "'") >= 0);
  chips[0].click();
});
await pg.waitForTimeout(700);
cards = await readCards();
const sideAp2 = cards.find(c => /side apron/i.test(c.name));
check('editing the FIRST angle to 30° leaves the second at 45°',
  sideAp2 && /30°/.test(sideAp2.chips[0]) && /45°/.test(sideAp2.chips[1]),
  JSON.stringify(sideAp2 && sideAp2.chips));
const jobSide = await pg.evaluate(() => ({
  stored: JSON.stringify(S.jpFlashAngles),
  snap: JSON.stringify((snapshotCurrentJob().state || {}).jpFlashAngles || {}),
}));
check('…the override persists with the job (snapshot carries it)',
  /30/.test(jobSide.snap), jobSide.snap.slice(0, 120));
const lib15 = await pg.evaluate(() => {
  const e = _getAllFlashings().find(x => x.name === 'Boxed Penetration Side Apron Corro');
  const am = e.polylines[0].angleMarkers;
  return { a: am['1'].deg, b: am['2'].deg };
});
check('…and the shared library drawing still says 15° — tomorrow\'s job is not corrupted',
  lib15.a === 15 && lib15.b === 15, JSON.stringify(lib15));

// ── the default follows the pitch, live ───────────────────────────
await pg.evaluate(() => {
  DRAW.calPitch = 25; DRAW.roofs[0].calPitch = 25;
  renderJobPack();
});
await pg.waitForTimeout(900);
cards = await readCards();
const barge25 = cards.find(c => /barge/i.test(c.name));
const sideAp3 = cards.find(c => /side apron/i.test(c.name));
check('re-pitch the roof to 25° and the un-edited chips follow',
  barge25 && barge25.chips.every(t => /25°/.test(t)), JSON.stringify(barge25 && barge25.chips));
check('…while the hand-set 30° stays exactly where the user put it',
  sideAp3 && /30°/.test(sideAp3.chips[0]) && /25°/.test(sideAp3.chips[1]),
  JSON.stringify(sideAp3 && sideAp3.chips));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
