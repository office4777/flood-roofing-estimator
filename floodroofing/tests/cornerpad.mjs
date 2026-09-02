// The Move corner pad, and what closes it.
//
// Reported with a photograph: the pad sits over the drawing and "only
// disappears when I click somewhere else in the canvas, but not anywhere in
// the whole page". That is exactly what it did — dismissing it was the
// canvas's own job, so a press that landed on a toolbar button, the zoom
// control, another tab or the page behind left it open with nothing but its
// own ✕ to shift it.
//
// A press anywhere outside the pad closes it now. Anywhere except the pad
// itself: its arrows have to keep nudging, and its header has to keep
// dragging.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
  gotoTab('roof');
  DRAW.outline = [[200,200],[600,200],[600,500],[200,500]];
  DRAW.outlineDone = true;
  DRAW.scaleMetresPerPx = 0.03;
  setTool('select');
  redrawAll();
});
await pg.waitForTimeout(300);

const open  = () => pg.evaluate(() => { _cornerRepoOpen(0); });
const shown = () => pg.evaluate(() => {
  const p = document.getElementById('cornerRepoPopup');
  return !!p && getComputedStyle(p).display !== 'none';
});

await open();
check('clicking a corner opens the pad', await shown());

// The corner of the roof this pad is moving.
const at = await pg.evaluate(() => window._cornerRepo.idx);
check('…and it knows which corner it is moving', at === 0, 'corner ' + at);

// Its own arrows must not close it — they are what it is for.
await pg.click('#cornerRepoPopup .crn-btn');
await pg.waitForTimeout(150);
check('its own arrows nudge without closing it', await shown());
check('…and the corner actually moved',
  (await pg.evaluate(() => DRAW.outline[0][1])) < 200, await pg.evaluate(() => JSON.stringify(DRAW.outline[0])));

// Its header must not close it either — that is the drag handle.
await pg.click('#cornerRepoHdr .crn-title');
await pg.waitForTimeout(150);
check('…and taking hold of its header does not close it', await shown());

// THE REPORT: a press anywhere off the pad closes it. Somewhere that is not
// the canvas — a toolbar button on the same screen.
const outside = [
  ['the roof toolbar', '#btn-calibrate'],
  ['the page behind the app', 'body'],
];
for (const [what, sel] of outside){
  await open();
  if (!(await shown())) { check('reopened for ' + what, false); continue; }
  const hit = await pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const pop = document.getElementById('cornerRepoPopup').getBoundingClientRect();
    let x = Math.round(r.left + Math.min(20, r.width/2)), y = Math.round(r.top + Math.min(10, r.height/2));
    // never land on the pad itself — that is the one place that must not close it
    if (x > pop.left - 4 && x < pop.right + 4 && y > pop.top - 4 && y < pop.bottom + 4)
      { x = Math.round(pop.right + 60); y = Math.round(pop.bottom + 60); }
    return [x, y];
  }, sel);
  if (!hit){ check('found ' + what + ' to press', false); continue; }
  await pg.mouse.click(hit[0], hit[1]);
  await pg.waitForTimeout(200);
  check('THE REPORT: a press on ' + what + ' closes the pad', !(await shown()),
    'pressed ' + hit.join(','));
}

// And the canvas still closes it, which is what it always did.
await open();
const mid = await pg.evaluate(() => {
  const cv = document.getElementById('roofCanvas');
  cv.scrollIntoView({ block: 'center' });
  const r = cv.getBoundingClientRect();
  return [Math.round(r.left + r.width/2),
          Math.round(Math.max(r.top + 20, Math.min(r.bottom - 20, r.top + r.height/2)))];
});
await pg.mouse.click(mid[0], mid[1]);        // a real press, on empty drawing
await pg.waitForTimeout(200);
check('…and pressing the drawing closes it', !(await shown()),
  'pressed ' + mid.join(','));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
