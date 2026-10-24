// Screenshots of the Finance Hub on a phone and a computer, from the seeded
// sample data in tests/_hubseed.mjs, with the network blocked.
//   node floodroofing/tools/hub-shots.mjs [outDir]
// Writes phone-*.png and desk-*.png. Prints any page errors.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { hubSeedScript } from '../tests/_hubseed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = pathToFileURL(join(ROOT, 'hub', 'FloodRoofing_Financials.html')).href;
const OUT = process.argv[2] || join(ROOT, '..', '.hub-shots');
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
async function shoot(tag, vp, steps){
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: vp.width < 800, isMobile: vp.width < 800 });
  await ctx.route(u => !u.href.startsWith('file:'), r => r.abort());
  await ctx.addInitScript(hubSeedScript());
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(HUB); await pg.waitForTimeout(1500);
  for (const [name, fn, full] of steps){
    if (fn) await fn(pg);
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: join(OUT, tag + '-' + name + '.png'), fullPage: !!full });
  }
  console.log(tag, errs.length ? 'ERRORS ' + JSON.stringify(errs) : 'no errors');
  await ctx.close();
}
const closeAll = pg => pg.evaluate(() => { try { closeCmdDetail(); } catch (e) {} try { closeCashDetail(); } catch (e) {} });
await shoot('phone', { width: 390, height: 844 }, [
  ['dash', null, false],
  ['dash-full', null, true],
  ['detail-fw', pg => pg.evaluate(() => openCmdDetail('fw')), false],
  ['detail-enq', async pg => { await closeAll(pg); await pg.evaluate(() => openCmdDetail('enq')); }, false],
  ['work', async pg => { await closeAll(pg); await pg.evaluate(() => go('work')); }, true],
  ['bc', pg => pg.evaluate(() => go('bc')), false],
  ['pl', pg => pg.evaluate(() => go('pl')), false],
  ['dash-dark', pg => pg.evaluate(() => { go('dash'); toggleTheme(); }), false],
]);
await shoot('desk', { width: 1440, height: 900 }, [
  ['dash', null, false],
  ['dash-full', null, true],
  ['detail-gp', pg => pg.evaluate(() => openCmdDetail('gp')), false],
  ['work', async pg => { await closeAll(pg); await pg.evaluate(() => go('work')); }, false],
]);
await b.close();
console.log('shots in', OUT);
