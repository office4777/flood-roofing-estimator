// The permanent line above the drawing canvas.
//
// It used to explain the drawing order — upload, outline, corners clockwise,
// Enter. Anybody works that out once and then reads past it forever. What is
// worth a permanent line is the thing a roofer CANNOT see by looking: the
// scale came off a satellite picture. An aerial is close, but it is not a
// tape measure, and a quote priced off it without calibrating is priced off a
// guess. So the bar now says so, and the words "Calibrate Scale" in it are
// the button that fixes it.
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
const alerts = []; pg.on('dialog', d => { alerts.push(d.message()); d.accept(); });
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1');
  localStorage.setItem('fr_user', JSON.stringify({ email: 'b@k.nz' }));
  localStorage.setItem('fr_company', JSON.stringify({ id: 'c1', name: 'K' }));
});
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
  gotoTab('roof');
});
await pg.waitForTimeout(400);

const bar = await pg.evaluate(() => {
  const el = document.getElementById('workflowTipBar');
  return { there: !!el && getComputedStyle(el).display !== 'none',
    text: (el ? el.textContent : '').replace(/\s+/g, ' ').trim() };
});
check('the bar above the canvas is there', bar.there, bar.text.slice(0, 60));
check('…and it warns that the scale came off the satellite',
  /roughly to satellite scale/i.test(bar.text), bar.text);
check('…and says what to do about it', /calibrate scale/i.test(bar.text) && /override/i.test(bar.text), bar.text);
check('…and the drawing-order lecture is gone',
  !/best workflow/i.test(bar.text) && !/clockwise/i.test(bar.text), bar.text);

// The words are the button. Calibrate needs an outline to measure against —
// without one the app says so, which is the behaviour the toolbar button has
// always had, so the bar must not be a second, weaker way in.
await pg.click('#workflowTipBar button');
await pg.waitForTimeout(300);
check('pressing it with nothing drawn asks for the outline first, same as the toolbar',
  alerts.some(a => /outline first/i.test(a)), alerts.join(' | ') || '(no message)');

// With an outline down it arms the calibrate tool for real.
await pg.evaluate(() => {
  DRAW.outline = [[100,100],[400,100],[400,300],[100,300]];
  DRAW.outlineDone = true;
  setTool('select');
});
await pg.click('#workflowTipBar button');
await pg.waitForTimeout(300);
check('…and with an outline drawn it arms the calibrate tool',
  (await pg.evaluate(() => DRAW.tool)) === 'calibrate', await pg.evaluate(() => DRAW.tool));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
