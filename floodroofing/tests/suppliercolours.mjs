// "Color choices update when selecting different suppliers, armorsteel has a
//  different colour set to colorsteel"
//
// One palette used to serve every steel grade: pick Armorsteel ColorZen and
// the customer still chose off NZ Steel's Colorsteel card — colours
// Armorsteel doesn't make. The palette now follows the supplier: the swatch
// picker, the Selections colour panel, the proposal's colour-range page and
// the order form's colour suggestions all read the grade first. Unknown or
// custom grades keep the Colorsteel palette so nothing is ever left without
// colours to pick.
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
await pg.waitForTimeout(2500);

// ── the resolver itself ───────────────────────────────────────────
let v = await pg.evaluate(() => ({
  maxam: _paletteForGradeId('maxam').map(c => c.name),
  zen: _paletteForGradeId('colorzen').map(c => c.name),
  custom: _paletteForGradeId('my-own-grade').map(c => c.name),
  zenTitle: _paletteBrandForGradeId('colorzen').title,
  csTitle: _paletteBrandForGradeId('maxam').title,
}));
check('Colorsteel grades read the Colorsteel palette',
  v.maxam.length === 12 && v.maxam.some(n => /New Denim Blue/.test(n)), v.maxam.length + ' colours');
check('Armorsteel ColorZen reads its own, smaller range',
  v.zen.length === 8 && v.zen.includes('Thunder Grey') && v.zen.includes('FlaxPod') &&
  !v.zen.some(n => /New Denim|Permanent Green|Mist Green|Lignite|Windsor/.test(n)),
  v.zen.join(', '));
check('an unknown grade falls back to Colorsteel rather than an empty picker',
  v.custom.length === 12, '');
check('the brand labels follow too',
  /Armorsteel ColorZen/.test(v.zenTitle) && /Colorsteel/.test(v.csTitle),
  v.zenTitle + ' / ' + v.csTitle);

// ── the swatch picker follows the quote's grade ───────────────────
v = await pg.evaluate(() => {
  S.quote = S.quote || {};
  S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { steelGrade: 'colorzen' });
  _openColourPicker();
  const names = [...document.querySelectorAll('#quotePreviewModal [onclick^="_pickProposalColour"], [onclick^="_pickProposalColour"]')]
    .map(x => x.textContent.trim());
  const modal = document.getElementById('colourPickerModal');
  const html = ((modal && modal.innerHTML || '').match(/final selection is made from[^<]*/) || [''])[0];
  try { _closeColourPicker(); } catch(e){}
  return { names, note: html };
});
check('with ColorZen picked, the colour picker offers the Armorsteel range',
  v.names.length === 8 && v.names.some(n => /Thunder Grey/.test(n)) && !v.names.some(n => /Denim/.test(n)),
  v.names.slice(0, 4).join(', ') + '…');
check('…and the chip-card note names Armorsteel, not NZ Steel',
  /Armorsteel/.test(v.note) && !/NZ Steel/.test(v.note), v.note.slice(0, 90));

v = await pg.evaluate(() => {
  S.quote.proposalOptions.steelGrade = 'maxam';
  _openColourPicker();
  const names = [...document.querySelectorAll('[onclick^="_pickProposalColour"]')].map(x => x.textContent.trim());
  try { _closeColourPicker(); } catch(e){}
  return names;
});
check('switch back to MAXAM and the Colorsteel range returns',
  v.length === 12 && v.some(n => /New Denim Blue/.test(n)), v.length + ' colours');

// ── picking writes the right name through ─────────────────────────
v = await pg.evaluate(() => {
  S.quote.proposalOptions.steelGrade = 'colorzen';
  _openColourPicker();
  _pickProposalColour(6);   // Thunder Grey in the Armorsteel order
  return S.quote.proposalOptions.colour;
});
check('picking a tile stores the Armorsteel colour name', v === 'Thunder Grey', String(v));

// ── the order form's colour suggestions follow the grade ──────────
v = await pg.evaluate(() => {
  const sel = document.getElementById('matGrade');
  sel.value = 'Armorsteel ColorZen';
  _openOrderChecklist();
  const opts = [...document.querySelectorAll('#ocColours option')].map(o => o.value);
  const ov = document.getElementById('orderChecklistOverlay'); if (ov) ov.style.display = 'none';
  const modal = document.getElementById('orderChecklistModal'); if (modal) modal.style.display = 'none';
  return opts;
});
check('the printed-order colour list is the Armorsteel range when that grade is picked',
  v.includes('Thunder Grey') && !v.some(n => /Denim|Scoria|Pioneer/.test(n)) && v.some(n => /Zincalume/.test(n)),
  v.join(', '));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
