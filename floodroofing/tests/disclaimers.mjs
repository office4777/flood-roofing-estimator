// The warning that stops a wrong order reaching a merchant.
//
// legal.mjs greps the source for these strings; this suite drives the real
// page and checks they actually reach the screen — a note built by a function
// that throws, or mounted into a div that no longer exists, greps fine and
// shows nothing. Clause 5 of the Terms promises this warning is printed on the
// order form, the cut list and the job pack cover, so all three are checked.
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
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// ── one constant, so the wording cannot drift between documents ──
let v = await pg.evaluate(() => ({
  long:  typeof ORDER_DISCLAIMER === 'string' ? ORDER_DISCLAIMER : null,
  short: typeof ORDER_DISCLAIMER_SHORT === 'string' ? ORDER_DISCLAIMER_SHORT : null,
  fn:    typeof _disclaimerHtml === 'function',
}));
check('the disclaimer is one constant the whole app reads',
  !!v.long && !!v.short && v.fn, (v.long||'').slice(0, 60) + '…');
check('…and it says the two things that matter: estimated, and check it',
  /estimated from a drawing/i.test(v.long) && /before cutting or ordering/i.test(v.long));

// ── the Order Material tab, which is also the printed order form ──
await pg.evaluate(() => gotoTab('order'));
await pg.waitForTimeout(500);
v = await pg.evaluate(() => {
  const n = document.querySelector('#tab-order .est-note');
  if (!n) return { found: false };
  const r = n.getBoundingClientRect();
  return { found: true, visible: r.width > 0 && r.height > 0, text: n.textContent.replace(/\s+/g,' ').trim() };
});
check('the Order Material tab carries the warning on screen',
  v.found && v.visible, v.text ? v.text.slice(0, 70) + '…' : 'not found');
check('…worded for the person about to send it to a supplier',
  /check this order against the building/i.test(v.text || ''));

// print-order shows #tab-order and hides only its buttons, so the note prints
v = await pg.evaluate(() => {
  document.documentElement.classList.add('print-order');
  const n = document.querySelector('#tab-order .est-note');
  const hidden = !n || getComputedStyle(n).display === 'none';
  document.documentElement.classList.remove('print-order');
  return { hidden };
});
check('…and is not one of the things the print stylesheet strips out', !v.hidden);

// ── the job pack: cut list, order and cover ──
await pg.evaluate(() => {
  // A cut list has to exist before a note about it means anything.
  _renderCutList([{ desc: 'Longrun sheet', qty: '12', length: '4200' }]);
  gotoTab('jobpack');
  _formatJobPackCover();
  _renderJobPackCutList();
  _renderJobPackOrder();
});
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const t = id => { const e = document.getElementById(id); const n = e && e.querySelector('.est-note');
                    return n ? n.textContent.replace(/\s+/g,' ').trim() : ''; };
  return { cover: t('jpCoverNote'), cut: t('jpCutList'), order: t('jpOrder') };
});
check('the job pack cover carries it — the first page the crew sees',
  /check on site|before cutting or ordering/i.test(v.cover), v.cover.slice(0, 60));
check('…the cut list carries it, next to the lengths being cut',
  /check on site|before cutting or ordering/i.test(v.cut), v.cut.slice(0, 60));
check('…and the material order section carries it',
  /before cutting or ordering/i.test(v.order), v.order.slice(0, 60));

// an empty cut list has nothing to warn about, and should not cry wolf
v = await pg.evaluate(() => {
  _renderCutList([]);
  _renderJobPackCutList();
  const e = document.getElementById('jpCutList');
  return { note: !!e.querySelector('.est-note'), text: e.textContent.trim().slice(0, 40) };
});
check('an empty cut list does not carry a warning about nothing',
  !v.note, v.text);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
