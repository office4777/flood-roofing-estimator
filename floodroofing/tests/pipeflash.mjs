// Pipe penetrations used to be free.
//
// A flue was drawn, a dektite was counted, it showed on the job pack — and
// it added exactly $0 to the quote, because the price book had nowhere to
// put a boot price. Back-trays were worse than free: they had a price, but
// one flat $/each, so a 7 m full-length tray and a 2 m short tray cost the
// same. Both are money going out the door on every job with a pipe on it.
//
// This suite holds the two rules that fix it: the boot size is chosen from
// the pipe's own diameter, and a back-tray is priced by its own length.
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
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */
  localStorage.setItem('fr_settings','null');
  // Two pipes, two different sizes — the case one dektite price cannot serve.
  localStorage.setItem('fr_dektites_v2', JSON.stringify([{qty:2,sizeMm:100},{qty:1,sizeMm:250}]));
});
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// ── the size is picked from the pipe, not typed once ──────────────
let v = await pg.evaluate(() => {
  const id = mm => { const s = _aquasealSizeFor(mm); return s ? s.id : null; };
  return { p20:id(20), p50:id(50), p80:id(80), p100:id(100), p150:id(150),
           p200:id(200), p250:id(250), p300:id(300), p450:id(450), p750:id(750),
           tooBig:id(900), tooSmall:id(2), none:id(0), count:AQUASEAL_SIZES.length };
});
check('every published size is in the table', v.count === 11, v.count + ' sizes');
check('a 100mm flue takes a No 3', v.p100 === 'no3', v.p100);
check('a 250mm vent on the same roof takes a No 6', v.p250 === 'no6', v.p250);
check('the smallest boot that fits wins, not the first that could',
  v.p20 === 'mini' && v.p50 === 'no1' && v.p80 === 'no2', [v.p20,v.p50,v.p80].join(', '));
check('band edges land on the band that owns them',
  v.p150 === 'no4' && v.p200 === 'no5' && v.p300 === 'no7' && v.p450 === 'no9' && v.p750 === 'no10',
  [v.p150,v.p200,v.p300,v.p450,v.p750].join(', '));
check('a pipe past the biggest boot gets no size rather than one that will not fit',
  v.tooBig === null, String(v.tooBig));
check('…and so does a pipe below the smallest, or one with no size at all',
  v.tooSmall === null && v.none === null, v.tooSmall + ', ' + v.none);

// ── the price book carries a rate per size ────────────────────────
await pg.evaluate(() => { gotoTab('settings'); });
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  inputs: document.querySelectorAll('#pbAquasealList [data-aq-id]').length,
  trays:  document.querySelectorAll('#pbBackTrayList [data-bt-name]').length,
  no3:    _aquasealPrice('no3'),
  unknown:_aquasealPrice('no99'),
}));
check('the book shows an input for every size plus the retrofit clip',
  v.inputs === 12, v.inputs + ' inputs');
check('…and one per standard back-tray', v.trays === 9, v.trays + ' trays');
check('a size with a rate reads back', v.no3 > 0, '$' + v.no3);
check('a size with no rate reads 0, not NaN', v.unknown === 0, String(v.unknown));

// ── importing the merchant's own wording ──────────────────────────
const CSV = [
  'Description,Unit,Price',
  'Aquaseal No 1 EPDM Pipe Flashing (3-60mm OPD),ea,13.36',
  'Aquaseal No 10 EPDM Pipe Flashing (400-750mm OPD),ea,335.36',
  'Aquaseal No 3 EPDM Pipe Flashing (40-110mm OPD),ea,21.69',
  'Aquaseal Mini EPDM Pipe Flashing (3-25mm OPD),ea,11.30',
  'Aluminium Steel Clip for Aquaseal Retrofit,ea,2.63',
  '270mm Corrugate back-tray,lm,16.80',
  '800mm 5-Rib back-tray,lm,35.88',
].join('\n');
await pg.setInputFiles('#pbUploadFile', {
  name:'ri.csv', mimeType:'text/csv', buffer: Buffer.from(CSV),
});
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  mapped: _PB_CSV_PENDING.mapped.length, extras: _PB_CSV_PENDING.extras.length,
  paths: _PB_CSV_PENDING.mapped.map(m => m.target.path),
}));
check('every row is recognised — none falls through to Custom items',
  v.mapped === 7 && v.extras === 0, v.mapped + ' matched, ' + v.extras + ' custom');
check('"No 1" does not swallow "No 10"',
  v.paths.includes('aquaseal.no1') && v.paths.includes('aquaseal.no10'), v.paths.join(' '));

await pg.evaluate(() => _pbApplyCsv());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  no3: (S.settings.price_book.aquaseal||{}).no3,
  no10:(S.settings.price_book.aquaseal||{}).no10,
  clip:(S.settings.price_book.aquaseal||{}).retro_clip,
  tray:_backTrayLmPrice('270mm Corrugate back-tray'),
  rib: _backTrayLmPrice('800mm 5-Rib back-tray'),
}));
check('applying writes the boot rates', v.no3 === 21.69 && v.no10 === 335.36,
  'No 3 $' + v.no3 + ', No 10 $' + v.no10);
check('…the retrofit clip too', v.clip === 2.63, '$' + v.clip);
check('…and the back-tray rates', v.tray === 16.8 && v.rib === 35.88,
  '$' + v.tray + '/lm, $' + v.rib + '/lm');

// ── a back-tray costs what its own length costs ───────────────────
v = await pg.evaluate(() => ({
  full:  _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 7.2 }),
  short: _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 2.4 }),
  nolen: _backTrayEachPrice({ name:'270mm Corrugate back-tray', lengthM: 0 }),
  // A profile the book has never heard of. Every tray the app offers now
  // carries a shipped rate, so an unpriced one has to be genuinely unknown —
  // the point of the check is that we return 0 rather than guess a rate.
  unpriced: _backTrayEachPrice({ name:'1200mm Sawtooth back-tray', lengthM: 5 }),
}));
check('a 7.2m tray is 3× a 2.4m tray, not the same price',
  Math.abs(v.full - 120.96) < 0.005 && Math.abs(v.short - 40.32) < 0.005,
  '$' + v.full.toFixed(2) + ' vs $' + v.short.toFixed(2));
check('a tray with no length yet prices at 0, not at a length nobody chose',
  v.nolen === 0, '$' + v.nolen);
check('a tray the book has no rate for prices at 0, never a guess',
  v.unpriced === 0, '$' + v.unpriced);

// ── and it all reaches the material table ─────────────────────────
v = await pg.evaluate(() => {
  const rows = _buildMaterialPriceRows().filter(r => String(r.key).indexOf('aquaseal:') === 0);
  return rows.map(r => {
    const picked = r.variants.find(x => x.value === r.defaultVariant) || {};
    return { key:r.key, qty:r.autoQty, variant:r.defaultVariant, price:picked.price, note:r.note };
  });
});
check('each pipe size on the job becomes its own priced row', v.length === 2,
  v.map(r => r.key).join(', '));
const r100 = v.find(r => r.key === 'aquaseal:100') || {};
const r250 = v.find(r => r.key === 'aquaseal:250') || {};
check('the 100mm pipes arrive as 2 × No 3 at the imported rate',
  r100.qty === 2 && r100.variant === 'no3' && r100.price === 21.69,
  r100.qty + ' × ' + r100.variant + ' @ $' + r100.price);
check('the 250mm pipe picks a different, unpriced-so-far size',
  r250.qty === 1 && r250.variant === 'no6', r250.qty + ' × ' + r250.variant);
check('…and says which pipe drove the choice', /100mm/.test(r100.note || ''), r100.note);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
