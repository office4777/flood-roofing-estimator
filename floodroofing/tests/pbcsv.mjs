// Uploading a supplier price list used to drop every row into Custom items,
// which left the rates that actually drive the material table untouched. A
// roofer imported their pricing and nothing they quoted changed — worse than
// no import, because it looked like it worked.
//
// Rows we recognise now update the real rate. Two rules make that safe and
// this suite exists to hold them: nothing is written until a preview is
// applied, and a row whose unit disagrees with the field is flagged rather
// than quietly accepted.
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
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// Seed our own "before" values rather than leaning on whatever the shipped
// defaults happen to be. This suite is about what an import does to a rate,
// not about what that rate started at — and when the shipped book changed
// underneath it, two checks failed for a reason that had nothing to do with
// importing. Sentinels no CSV row and no default can collide with.
const BEFORE_RIDGE = 11.11, BEFORE_BOX = 99.99;
await pg.evaluate((b) => {
  S.settings = S.settings || {};
  S.settings.price_book = S.settings.price_book || {};
  S.settings.price_book.ridge_lm = b.r;
  S.settings.price_book.gutter = S.settings.price_book.gutter || {};
  S.settings.price_book.gutter.box125_lm = b.b;
  try { refreshSettingsUI(); } catch(e){}
}, { r: BEFORE_RIDGE, b: BEFORE_BOX });

// A merchant export: recognisable rates, one wrong-unit row, one it can't know.
const CSV = [
  'Description,Unit,Price',
  'Ridge/Hip Flashing 0.55 Colorsteel,lm,26.84',
  'Valley Flashing 0.55,lm,31.20',
  'Barge Flashing,lm,24.10',
  '65mm Unitite Roofing Screws,ea,0.42',
  'Marley Typhoon Spouting,lm,21.90',
  'Marley Typhoon Expansion Joiner,ea,23.50',
  '125mm Colorsteel Box Gutter,ea,33.00',      // wrong unit for a $/lm rate
  'Cherry picker hire day rate,ea,450.00',     // nothing to map onto
].join('\n');

await pg.evaluate(() => { gotoTab('settings'); });
await pg.waitForTimeout(400);
await pg.setInputFiles('#pbUploadFile', {
  name: 'supplier.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV),
});
await pg.waitForTimeout(700);

// ── nothing is written on upload ──────────────────────────────────
let v = await pg.evaluate(() => ({
  ridge: (S.settings && S.settings.price_book || {}).ridge_lm,
  mapped: _PB_CSV_PENDING.mapped.length,
  extras: _PB_CSV_PENDING.extras.length,
  previewShown: getComputedStyle(document.getElementById('pbCsvPreview')).display !== 'none',
}));
check('reading the file changes no rate on its own', v.ridge === BEFORE_RIDGE,
  'ridge $' + v.ridge + ' (was $' + BEFORE_RIDGE + ')');
check('…it puts a preview up instead', v.previewShown);
check('…with the rows it recognised', v.mapped === 7, v.mapped + ' matched');
check('…and the one it could not place kept aside for Custom items',
  v.extras === 1, v.extras + ' unmatched');

// ── the longest match wins, so "joiner" does not eat "expansion joiner" ──
v = await pg.evaluate(() => _PB_CSV_PENDING.mapped.map(r => r.target.path));
check('an expansion joiner is not swallowed by the plain joiner rule',
  v.includes('gutter.typhoon_expjoiner_ea') && !v.includes('gutter.typhoon_joiner_ea'),
  v.join(', '));

// ── a wrong unit is flagged and left unticked ─────────────────────
v = await pg.evaluate(() => {
  const r = _PB_CSV_PENDING.mapped.find(x => x.target.path === 'gutter.box125_lm');
  const cb = document.querySelector('[data-pbcsv="' + _PB_CSV_PENDING.mapped.indexOf(r) + '"]');
  return { flagged: !!(r && r.unitMismatch), ticked: !!(cb && cb.checked),
           saysSo: /check before ticking/.test(document.getElementById('pbCsvPreview').textContent) };
});
check('a $/ea row against a $/lm rate is flagged', v.flagged);
check('…left unticked rather than quietly accepted', !v.ticked);
check('…and the reason is on screen', v.saysSo);

// ── applying writes only the ticked rows ──────────────────────────
await pg.evaluate(() => _pbApplyCsv());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const pb = S.settings.price_book;
  return { ridge: pb.ridge_lm, valley: pb.valley_lm, barge: pb.barge_lm, screws: pb.screws_each,
           spout: pb.gutter.typhoon_spouting_lm, expj: pb.gutter.typhoon_expjoiner_ea,
           box: pb.gutter.box125_lm, listFlag: pb.list_prices,
           extras: document.querySelectorAll('#pbExtrasList > *').length };
});
check('the recognised rates are updated', v.ridge === 26.84 && v.valley === 31.2 && v.barge === 24.1,
  'ridge ' + v.ridge + ', valley ' + v.valley + ', barge ' + v.barge);
check('…including the itemised gutter fittings',
  v.spout === 21.9 && v.expj === 23.5, 'spouting ' + v.spout + ', exp joiner ' + v.expj);
check('the unticked wrong-unit row is NOT written', v.box === BEFORE_BOX,
  'box gutter $' + v.box + ' (was $' + BEFORE_BOX + ')');
check('the unrecognised row lands in Custom items', v.extras >= 1, v.extras + ' custom row(s)');
check('…and the book stops calling itself indicative once real rates land',
  v.listFlag === false, 'list_prices=' + v.listFlag);

// ── discard leaves everything alone ───────────────────────────────
await pg.setInputFiles('#pbUploadFile', {
  name: 's2.csv', mimeType: 'text/csv', buffer: Buffer.from('Ridge Flashing,lm,99.99'),
});
await pg.waitForTimeout(600);
await pg.evaluate(() => _pbCancelCsv());
v = await pg.evaluate(() => ({ ridge: S.settings.price_book.ridge_lm,
  gone: getComputedStyle(document.getElementById('pbCsvPreview')).display === 'none' }));
check('discarding a second file changes nothing', v.ridge === 26.84 && v.gone, 'ridge $' + v.ridge);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
