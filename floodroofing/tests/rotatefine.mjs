// Squaring the background photo up.
//
// The rotate row used to be two 90° buttons and a slider that stepped in half
// degrees. Half a degree is not close enough to land on: over a 20 m roof it
// is 175 mm out at the far corner, and you cannot see which side of square you
// are on. The buttons are now ∓0.1° nudges and the slider steps by 0.1.
//
// The thing worth guarding is not the step value — it is that the angle, the
// slider and the readout can never disagree. They used to be set by hand in
// three separate places (the slider's oninput, the Reset button, and
// drawAILines), which is exactly how a control drifts out of step with what it
// is controlling.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);
// Since 2026-09-24 rotating the image has its own "Rotate image" slider on
// the toolbar; moving it brings the fine controls up underneath it, and Done
// (or a click anywhere else) puts them away. Reaching them for real is part
// of the test: a control nobody can reach is not fixed.
await pg.evaluate(() => { try { gotoTab('roof'); } catch(e){} });
await pg.waitForTimeout(300);
check('the "Rotate background image" slider is on the toolbar, and the fine controls start put away',
  (await pg.isVisible('#fineRotateSlider')) && !(await pg.isVisible('#fineRotate')) && /Rotate background image/.test(await pg.textContent('#rotImgWrap')), '');
await pg.evaluate(() => { const sl = document.getElementById('fineRotateSlider'); sl.value = 0; sl.dispatchEvent(new Event('input', { bubbles: true })); });
await pg.waitForTimeout(150);
check('moving the slider brings the fine controls up under it', await pg.isVisible('#fineRotate'), 'fine controls not shown');
await pg.click('#rotImgFine .rotimg-done');
await pg.waitForTimeout(100);
check('…Done puts them away', !(await pg.isVisible('#fineRotate')));
await pg.evaluate(() => _rotImgOpen());
await pg.mouse.click(5, 5);
await pg.waitForTimeout(100);
check('…and so does a click anywhere else', !(await pg.isVisible('#fineRotate')));
await pg.evaluate(() => _rotImgOpen());

const state = () => pg.evaluate(() => ({
  angle: window.IMG_FINE_ROTATION,
  slider: parseFloat(document.getElementById('fineRotate').value),
  step: document.getElementById('fineRotate').step,
  readout: document.getElementById('fineRotateVal').textContent,
}));

// ── the resolution the report asked for ──
let s = await state();
check('the slider steps in tenths, not halves', s.step === '0.1', s.step);
// "make the angle input a number input, not slider" — typed degrees, not a drag.
check('the angle control is a number box the user can type into',
  await pg.evaluate(() => document.getElementById('fineRotate').type === 'number'), '');
check('it starts square', s.angle === 0 && s.slider === 0 && s.readout === '0.0°', JSON.stringify(s));

// ── the buttons ──
const down = await pg.$('#fineRotateDown'), up = await pg.$('#fineRotateUp');
check('there is a minus-a-tenth button', !!down);
check('and a plus-a-tenth button', !!up);
check('they say what they do', (await down.innerText()).indexOf('.1') >= 0 && (await up.innerText()).indexOf('.1') >= 0,
  (await down.innerText()) + ' / ' + (await up.innerText()));

await up.click();
s = await state();
check('one nudge moves exactly a tenth of a degree', s.angle === 0.1, String(s.angle));
check('…and the slider follows it', s.slider === 0.1, String(s.slider));
check('…and so does the readout', s.readout === '+0.1°', s.readout);

// Floating point: 0.1+0.1+0.1 is 0.30000000000000004 unless it is rounded at
// every step. A readout of "+0.30000000000000004°" is the visible symptom.
await up.click(); await up.click();
s = await state();
check('three nudges land on 0.3, not 0.30000000000000004', s.angle === 0.3, String(s.angle));
check('…and the readout stays one decimal', s.readout === '+0.3°', s.readout);

await down.click(); await down.click(); await down.click(); await down.click();
s = await state();
check('nudging back past zero goes negative', s.angle === -0.1, String(s.angle));
check('…and the readout shows the sign', s.readout === '-0.1°', s.readout);

// ── the slider's range is the buttons' range too ──
await pg.evaluate(() => _setFineRotate(12.34));
s = await state();
check('a value between steps is rounded to a tenth', s.angle === 12.3, String(s.angle));
await pg.evaluate(() => _setFineRotate(12.36));
s = await state();
check('…rounding to the nearer tenth, not always down', s.angle === 12.4, String(s.angle));
await pg.evaluate(() => { for (var i = 0; i < 20; i++) _nudgeFineRotate(0.1); });
s = await state();
check('twenty nudges add exactly two degrees', s.angle === 14.4, String(s.angle));
// The slider reaches 100 — a photo can come off a phone a long way round,
// and 45 was not enough to bring it back.
await pg.evaluate(() => { _setFineRotate(99.9); for (var i = 0; i < 5; i++) _nudgeFineRotate(0.1); });
s = await state();
check('nudging past the end clamps at +100', s.angle === 100 && s.slider === 100, JSON.stringify(s));
await pg.evaluate(() => { for (var i = 0; i < 2500; i++) _nudgeFineRotate(-0.1); });
s = await state();
check('…and at -100 the other way — as far as it goes positive (2026-09-24)', s.angle === -100 && s.slider === -100, JSON.stringify(s));
// `slider` above is the number box. The drag bar runs −100 to 100 now, so it
// shows the same angle rather than a stale one.
check('…with the drag bar showing the same angle, not left on the old one',
  (await pg.evaluate(() => parseFloat(document.getElementById('fineRotateSlider').value))) === -100);

// A tenth of a degree is invisible without something square to judge it
// against. The grid used to show only while the slider was held, so the
// fine buttons moved the photo with nothing to move it against.
const grid = await pg.evaluate(async () => {
  DRAW.showAlignGrid = false;
  _nudgeFineRotate(0.1);
  const during = DRAW.showAlignGrid;
  _nudgeFineRotate(0.1);          // restarts the second rather than stacking
  await new Promise(r => setTimeout(r, 600));
  const midway = DRAW.showAlignGrid;
  await new Promise(r => setTimeout(r, 700));
  return { during, midway, after: DRAW.showAlignGrid };
});
check('a fine nudge brings the alignment grid up', grid.during === true, JSON.stringify(grid));
check('…a second nudge restarts its second rather than stacking timers', grid.midway === true, JSON.stringify(grid));
check('…and it goes again a second after the last one', grid.after === false, JSON.stringify(grid));

// ── everything comes back through one function ──
await pg.evaluate(() => _setFineRotate(12.3));
s = await state();
check('setting a value updates all three at once',
  s.angle === 12.3 && s.slider === 12.3 && s.readout === '+12.3°', JSON.stringify(s));
await pg.evaluate(() => _rotImgOpen());
await pg.click('#rotImgFine button:has-text("Reset")');
s = await state();
check('Reset zeroes the angle, the slider and the readout together',
  s.angle === 0 && s.slider === 0 && s.readout === '0.0°', JSON.stringify(s));

// Rubbish in must not leave the angle NaN — a NaN reaches the canvas transform
// and the photo vanishes rather than failing loudly.
await pg.evaluate(() => _setFineRotate('not a number'));
s = await state();
check('a non-numeric value is treated as square, never NaN',
  s.angle === 0 && s.readout === '0.0°', JSON.stringify(s));

// ── the 90° buttons are gone, as asked ──
const html = await pg.content();
check('no 90° rotate control is left in the panel',
  html.indexOf('rotateImage(') < 0, 'rotateImage still referenced');

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
