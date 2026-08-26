// "I need to be able to delete the entire flashing drawing, and it's missing
// the 'add flashing from saved' / 'draw custom flashing' section that used to
// be there."
//
// Two halves of the same complaint. An ADDED flashing always had a × on its
// card. An auto-derived one — barge, apron, ridge, the flashings RoofMap works
// out from the drawing — had no equivalent: you could delete its cut-list rows
// one at a time and the drawing still sat there with nothing under it.
//
// Deleting one has to mean the same thing everywhere: off the card, off the
// Materials cut lists, off the supplier order form. That is why the switch is
// read inside _matBuildCutList rather than at each render point — a surface
// that skipped the check would order a flashing the roofer had struck off.
//
// And it must be reversible, or nobody will touch it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
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
  // Edit mode — the delete is editor furniture and is meant to be off the PDF.
  localStorage.setItem('fr_jp_preview','0'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2700);

// A gable with barges down both sides, so there are auto-derived flashings
// with real cut-list rows to delete.
await pg.evaluate(() => {
  DRAW.scaleMetresPerPx = 0.03; DRAW.calPitch = 20;
  DRAW.outline = [[100,100],[900,100],[900,500],[100,500]]; DRAW.outlineDone = true;
  DRAW.lines = [
    { type:'ridge', pts:[[100,300],[900,300]], measM:12.7 },
    { type:'barge', pts:[[100,100],[100,300]], measM:6.4 },
    { type:'barge', pts:[[900,100],[900,300]], measM:6.4 },
    { type:'barge', pts:[[100,300],[100,500]], measM:6.4 },
    { type:'barge', pts:[[900,300],[900,500]], measM:6.4 },
  ];
  DRAW.roofs = null; try { redrawAll(); } catch(e){}
  gotoTab('materials');
});
await pg.waitForTimeout(1500);

// Which flashing types are actually on the job pack, and what the order says.
const jp = () => pg.evaluate(() => {
  const cards = [...document.querySelectorAll('#jpPages .mat-fl-card')];
  const names = cards.map(c => (c.querySelector('strong')||{}).textContent || '').map(s => s.trim());
  const kills = [...document.querySelectorAll('#jpPages [onclick*="_matFlashTypeDelete"]')];
  const chips = [...document.querySelectorAll('#jpPages [onclick*="_matFlashTypeSetOff"]')]
    .map(x => x.textContent.replace(/\s+/g,' ').trim());
  return { names, kills: kills.length, chips,
           // The one auto card we're going to delete.
           killArg: kills.length ? kills[0].getAttribute('onclick') : '' };
});

let v = await jp();
check('the auto-derived flashings are on the job pack', v.names.length >= 1, v.names.join(' | '));
check('…and each one now carries its own delete', v.kills >= 1, v.kills + ' delete buttons');
check('…with nothing struck off yet', v.chips.length === 0, JSON.stringify(v.chips));

// Pick a type with rows and delete it.
// slice(1) skips ridgehip, which has its own section rather than a card in
// this grid — it gets its own delete, checked further down.
const target = await pg.evaluate(() => {
  const specs = _MAT_FLASHING_SPECS.slice(1)
    .filter(s => _matBuildCutList(s.key, s.waste).pieceCount > 0);
  return specs.length ? { key: specs[0].key, label: specs[0].label,
                          pcs: _matBuildCutList(specs[0].key, specs[0].waste).pieceCount } : null;
});
check('a flashing with real pieces exists to delete', !!target && target.pcs > 0, JSON.stringify(target));

await pg.evaluate((k) => _matFlashTypeDelete(k, 'x'), target.key);
await pg.waitForTimeout(700);

const after = await pg.evaluate((k) => {
  const cl = _matBuildCutList(k, 0.4);
  return { pcs: cl.pieceCount, lm: cl.totalLm, off: _matFlashTypeOff(k) };
}, target.key);
check('deleting it empties its cut list everywhere at once',
  after.pcs === 0 && after.lm === 0, JSON.stringify(after));
check('…and the decision is recorded on the job, not just the DOM', after.off);

v = await jp();
check('…so the card is gone from the job pack',
  !v.names.some(n => n === target.label), v.names.join(' | '));
check('…and a restore chip takes its place', v.chips.some(c => c.includes(target.label)),
  v.chips.join(' | '));

// It has to survive a re-render — the old row-at-a-time deletes did not.
await pg.evaluate(() => { renderJobPack(); renderJobPack(); });
await pg.waitForTimeout(500);
v = await jp();
check('…and it stays deleted when the job pack re-renders',
  !v.names.some(n => n === target.label), v.names.join(' | '));

// Reversible, or nobody will use it.
await pg.evaluate((k) => _matFlashTypeSetOff(k, false), target.key);
await pg.waitForTimeout(700);
const back = await pg.evaluate((k) => _matBuildCutList(k, 0.4).pieceCount, target.key);
v = await jp();
check('restoring puts every piece back on the order', back === target.pcs,
  back + ' vs ' + target.pcs);
check('…and the card comes back with it', v.names.some(n => n === target.label),
  v.names.join(' | '));
check('…and the restore chip clears', v.chips.length === 0, v.chips.join(' | '));

// ── the other half: the way to ADD a flashing is reachable again ───
const adders = await pg.evaluate(() => {
  const q = s => [...document.querySelectorAll('#jpPages ' + s)]
    .filter(e => e.offsetParent !== null);
  const saved  = q('[onclick*="_matFlashingsAddAndPick"]');
  const custom = q('[onclick*="_matFlashingsAddAndCustom"]');
  return { saved: saved.length, custom: custom.length,
           savedText: (saved[0]||{}).textContent, customText: (custom[0]||{}).textContent };
});
check('the "add a saved flashing" button is on screen and clickable',
  adders.saved >= 1, JSON.stringify(adders));
check('…and so is the "draw a custom flashing" one', adders.custom >= 1, JSON.stringify(adders));

// ── Ridging is the same decision, in its own section ──────────────
// It doesn't sit in the flashings grid — it has its own band with its own
// cut list — so it carries its own × rather than sharing the grid's.
const ridgeBefore = await pg.evaluate(() => _matBuildCutList('ridgehip', 0.5).pieceCount);
check('the ridging section starts with pieces on the order', ridgeBefore > 0, ridgeBefore + ' pcs');
const ridgeKill = await pg.evaluate(() =>
  !!document.querySelector('#jpPages [onclick*="_matFlashTypeDelete(\'ridgehip\'"]'));
check('…and its own delete alongside the heading', ridgeKill);
await pg.evaluate(() => _matFlashTypeDelete('ridgehip', 'Ridging'));
await pg.waitForTimeout(600);
const ridgeAfter = await pg.evaluate(() => ({
  pcs: _matBuildCutList('ridgehip', 0.5).pieceCount,
  // The restore has to survive Preview — a struck-off section is empty, and
  // Preview collapses empty sections. That is how the gutter toggle vanished.
  restoreKeepsInPreview: !!document.querySelector('#jpPages .jp-keep-ctl[onclick*="ridgehip"]'),
}));
check('deleting ridging takes its capping off the order', ridgeAfter.pcs === 0, ridgeAfter.pcs + ' pcs');
check('…and its restore is marked to survive Preview', ridgeAfter.restoreKeepsInPreview);
await pg.evaluate(() => _matFlashTypeSetOff('ridgehip', false));
await pg.waitForTimeout(600);
check('…and restoring brings the capping back',
  (await pg.evaluate(() => _matBuildCutList('ridgehip', 0.5).pieceCount)) === ridgeBefore);

// The delete is editor furniture. An order form does not offer to delete
// things, and a removed flashing has nothing to say on it either.
await pg.emulateMedia({ media: 'print' });
const paper = await pg.evaluate(() => {
  document.documentElement.classList.add('print-jobpack');
  const vis = s => [...document.querySelectorAll('#jpPages ' + s)]
    .filter(e => e.getClientRects().length > 0).length;
  const out = { kills: vis('[onclick*="_matFlashTypeDelete"]'),
                chips: vis('[onclick*="_matFlashTypeSetOff"]'),
                adders: vis('[onclick*="_matFlashingsAddAndPick"]') };
  document.documentElement.classList.remove('print-jobpack');
  return out;
});
await pg.emulateMedia({ media: 'screen' });
check('none of it prints on the supplier order form',
  paper.kills === 0 && paper.chips === 0 && paper.adders === 0, JSON.stringify(paper));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
