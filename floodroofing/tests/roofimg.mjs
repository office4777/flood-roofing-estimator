// Setting a roof image threw, on every device, every time.
//
// onRoofImg reached straight through getElementById to an AI-analyse button
// that had been removed from the markup. Because the code runs inside a
// FileReader callback, the throw was silent: no error surfaced, the handler
// simply abandoned the rest of its work, so the preview never appeared and
// the background card never collapsed. clearRoofImg had the same fault, and
// there it threw AFTER clearing S.img64 but BEFORE resetting the file input
// — so picking the same photo again fired no change event and looked dead.
//
// Anything that runs off a file the user picked gets checked here, in both
// modes, for two things: it must not throw, and it must not touch the
// drawing. A photo is not an edit to the roof.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAJUlEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAwLcBQAABsvHUKgAAAABJRU5ErkJggg==';

const b = await chromium.launch();
for (const mode of ['on', 'off']){
  const label = mode === 'on' ? 'site mode' : 'office mode';
  const ctx = await b.newContext({ viewport: mode === 'on' ? {width:820,height:1180} : {width:1400,height:950} });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
    r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await pg.addInitScript((m) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */
    localStorage.setItem('fr_settings','null');
    localStorage.setItem('fr_site_mode', m);
  }, mode);
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2300);

  // A job with a roof already drawn on it — the thing that must survive.
  const drawn = await pg.evaluate(() => {
    gotoTab('roof');
    DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]];
    DRAW.outlineDone = true;
    DRAW.lines = [['gutter',[0,0],[2000,0]],['gutter',[2000,1000],[0,1000]],['ridge',[500,500],[1500,500]]]
      .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:null, sheetLengthM:null}));
    DRAW.scaleMetresPerPx = 0.01; DRAW.calPitch = 20;
    S.currentJobId = 'job-1';
    redrawAll();
    return { outline: DRAW.outline.length, lines: DRAW.lines.length };
  });
  const snap = () => pg.evaluate(() => ({
    outline:(DRAW.outline||[]).length, lines:(DRAW.lines||[]).length,
    scale: DRAW.scaleMetresPerPx, pitch: DRAW.calPitch,
    photos:(S.photos||[]).length, img: !!S.img64,
  }));

  // 1. a job photo
  await pg.setInputFiles('#jobPhotoGal', { name:'p.png', mimeType:'image/png', buffer: Buffer.from(PNG1,'base64') });
  await pg.waitForTimeout(1200);
  let v = await snap();
  check(label + ': adding a job photo leaves the drawing alone',
    v.outline === drawn.outline && v.lines === drawn.lines && v.scale === 0.01 && v.pitch === 20,
    v.outline + ' outline pts, ' + v.lines + ' lines, scale ' + v.scale);
  check(label + ': …and the photo is on the job', v.photos === 1, v.photos + ' photo(s)');

  // 2. setting the roof background image — the path the site-mode menu uses
  await pg.setInputFiles('#roofFile', { name:'a.png', mimeType:'image/png', buffer: Buffer.from(PNG2,'base64') });
  await pg.waitForTimeout(1500);
  v = await snap();
  check(label + ': setting a roof image does not throw', errs.length === 0,
    errs.join(' | ') || 'no page errors');
  check(label + ': …and leaves the drawing alone',
    v.outline === drawn.outline && v.lines === drawn.lines && v.scale === 0.01,
    v.outline + ' outline pts, ' + v.lines + ' lines');
  check(label + ': …and the image is stored', v.img === true, 'img64=' + v.img);

  // 3. clearing it — must finish, so the file input is reset and the SAME
  //    photo can be picked again.
  await pg.evaluate(() => { try { clearRoofImg(); } catch(e){ window.__clearThrew = e.message; } });
  await pg.waitForTimeout(300);
  v = await pg.evaluate(() => ({
    threw: window.__clearThrew || null, img: !!S.img64,
    fileVal: (document.getElementById('roofFile')||{}).value,
    outline:(DRAW.outline||[]).length, lines:(DRAW.lines||[]).length,
  }));
  check(label + ': clearing the roof image runs to the end', !v.threw, v.threw || 'no throw');
  check(label + ': …resets the file input, so the same photo can be re-picked',
    v.img === false && v.fileVal === '', 'img64=' + v.img + ' fileVal="' + v.fileVal + '"');
  check(label + ': …and still leaves the drawing alone',
    v.outline === drawn.outline && v.lines === drawn.lines,
    v.outline + ' outline pts, ' + v.lines + ' lines');

  // 4. what a save would persist — the drawing has to be IN it
  v = await pg.evaluate(() => {
    const s = snapshotCurrentJob();
    return { outline:(s.draw.outline||[]).length, lines:(s.draw.lines||[]).length,
             photos:(s.state.photos||[]).length };
  });
  check(label + ': a save after all that still carries the roof',
    v.outline === drawn.outline && v.lines === drawn.lines && v.photos === 1,
    v.outline + ' outline pts, ' + v.lines + ' lines, ' + v.photos + ' photo(s)');

  check(label + ': nothing threw anywhere in the run', errs.length === 0,
    errs.join(' | ') || 'no page errors');
  await ctx.close();
}
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
