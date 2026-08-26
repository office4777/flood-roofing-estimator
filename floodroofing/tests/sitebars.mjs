// Two things a roofer reaches for constantly were both buried in the Lines
// menu: scribbling a note on the map, and putting a flashing on the order.
// Free-draw is now a pencil in the top bar — a toggle you flick on and off
// while looking at the roof — and Flashings is a button in the bottom bar
// beside Photos and Save.
//
// The bottom bar is the fragile part: nine buttons on a 360px phone gives
// each about 37px, and a label wider than its box used to spill straight over
// its neighbour ("Calibrate Undo" ran together as one word). So the width
// checks below are the point of this suite, not padding for it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function open(w){
  const ctx = await b.newContext({ viewport:{width:w, height:820} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1');
    localStorage.setItem('fr_settings','null');
    localStorage.setItem('fr_site_mode','on'); });
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2500);
  return { ctx, pg, errs };
}

let { ctx, pg, errs } = await open(390);

// ── the pencil, up top ────────────────────────────────────────────
let v = await pg.evaluate(() => {
  const p = document.getElementById('phoneNotesBtn'), bar = document.getElementById('phoneTopBar');
  return { there: !!p, inBar: !!(p && bar && bar.contains(p)),
           visible: !!(p && p.getBoundingClientRect().width > 20),
           hasIcon: !!(p && p.querySelector('svg')),
           label: p ? (p.getAttribute('aria-label')||'') : '' };
});
check('free-draw is a symbol in the top bar', v.there && v.inBar && v.visible, JSON.stringify(v));
check('…drawn, not an emoji or a word', v.hasIcon && /free-draw/i.test(v.label), v.label);

// It toggles, and toggling off returns you to what you were drawing with.
v = await pg.evaluate(() => {
  setTool('barge');
  _siteNotesToggle();
  const on = { tool: DRAW.tool, lit: document.getElementById('phoneNotesBtn').classList.contains('on') };
  _siteNotesToggle();
  const off = { tool: DRAW.tool, lit: document.getElementById('phoneNotesBtn').classList.contains('on') };
  return { on, off };
});
check('tapping it turns free-draw on', v.on.tool === 'notes' && v.on.lit, JSON.stringify(v.on));
check('…and tapping again puts you back on the tool you were using, not Move',
  v.off.tool === 'barge' && !v.off.lit, JSON.stringify(v.off));

// Reached any other way, the pencil still tells the truth about the mode.
v = await pg.evaluate(() => {
  setTool('notes'); _syncTabletBar();
  const a = document.getElementById('phoneNotesBtn').classList.contains('on');
  toggleNotesErase(); _syncTabletBar();
  const bmode = document.getElementById('phoneNotesBtn').classList.contains('on');
  setTool('select'); _syncTabletBar();
  const c = document.getElementById('phoneNotesBtn').classList.contains('on');
  return { a, bmode, c };
});
check('it lights up however free-draw was entered', v.a && v.bmode, JSON.stringify(v));
check('…and goes out when the tool moves on', !v.c);

// ── and it has left the Lines menu ────────────────────────────────
// Hidden on site, not deleted: Office has no top bar to move it to, so
// removing it outright would leave free-draw with no way in at all there.
v = await pg.evaluate(() => {
  const b = document.getElementById('btn-notes');
  return { exists: !!b, shown: !!(b && b.offsetParent !== null) };
});
check('free-draw is no longer in the Lines menu on site', v.exists && !v.shown,
  'exists=' + v.exists + ' shown=' + v.shown);

// ── flashings, down the bottom ────────────────────────────────────
v = await pg.evaluate(() => {
  const f = document.getElementById('ttbFlash'), bar = document.getElementById('tabletToolbar');
  return { there: !!f, inBar: !!(f && bar && bar.contains(f)),
           label: f ? f.textContent.trim() : '',
           ico: f ? (f.querySelector('.ttb-ico')||{}).getAttribute?.('data-ico') : null,
           beforePhotos: !!(f && f.nextElementSibling &&
                            /Photos/.test(f.nextElementSibling.textContent)) };
});
check('there is a Flashings button in the bottom bar', v.there && v.inBar, v.label);
check('…sitting with the other job buttons, before Photos', v.beforePhotos);
check('…with its own icon, not a borrowed one', v.ico === 'flashing', String(v.ico));
check('…and the icon actually has a mask to draw',
  await pg.evaluate(() => !!getComputedStyle(document.documentElement)
    .getPropertyValue('--ico-flashing').trim()));

v = await pg.evaluate(() => {
  document.getElementById('ttbFlash').click();
  return !!document.getElementById('_flashSheet');
});
check('tapping it opens the flashing sheet', v);
await pg.evaluate(() => { const s = document.getElementById('_flashSheet'); if (s) s.remove(); });
check('nothing threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();

// ── the bar still fits, which is the bit that broke ───────────────
for (const w of [360, 390, 412, 768, 1024]){
  const o = await open(w);
  const r = await o.pg.evaluate(() => {
    const bar = document.getElementById('tabletToolbar');
    const btns = [...bar.querySelectorAll('.ttb-btn')];
    // Does any label physically overlap the next button's label?
    let collide = null;
    for (let i = 0; i + 1 < btns.length; i++){
      const a = btns[i].getBoundingClientRect(), c = btns[i+1].getBoundingClientRect();
      if (a.right > c.left + 0.5){ collide = btns[i].textContent.trim(); break; }
    }
    return { n: btns.length, over: bar.scrollWidth > bar.clientWidth + 1, collide,
             rows: new Set(btns.map(x => Math.round(x.getBoundingClientRect().top))).size };
  });
  check('at ' + w + 'px: nine buttons, one row, no overlap and no sideways scroll',
    r.n === 9 && !r.over && !r.collide && r.rows === 1,
    'n=' + r.n + ' overflow=' + r.over + ' rows=' + r.rows + ' collide=' + (r.collide || 'none'));
  await o.ctx.close();
}

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
