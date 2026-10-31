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


// A Fergus read for the toolbox sheet (2026-10-31): who was on which job last week, the hours logged so far this
// week, the forecast filled — seeded from the Workload rows so the picture shows the crew tables as they fill in.
const TBX_SEED = `window.__tbxSeedFergus = () => {
  const ws = tbxMonday(new Date()), lm = tbxAddDays(ws, -7), jobs = S.get('fwJobs', []);
  const A = jobs[0].id, B = jobs[1].id, C = jobs[2].id;
  const last = { 'Lead roofer': { h: 38, jobs: { [A]: { h: 30, days: [0,1,2,3].map(i => tbxAddDays(lm, i)) }, [B]: { h: 8, days: [tbxAddDays(lm, 4)] } } },
                 'Apprentice': { h: 36.5, jobs: { [A]: { h: 30, days: [0,1,2,3].map(i => tbxAddDays(lm, i)) }, '_none': { h: 0.5, days: [tbxAddDays(lm, 0)] }, [B]: { h: 6, days: [tbxAddDays(lm, 4)] } } },
                 'Second lead': { h: 40, jobs: { [C]: { h: 40, days: [0,1,2,3,4].map(i => tbxAddDays(lm, i)) } } } };
  const week = { 'Lead roofer': { h: 8, jobs: { [B]: { h: 8, days: [ws] } } }, 'Second lead': { h: 7.5, jobs: { [C]: { h: 7.5, days: [ws] } } } };
  const jm = {}; jobs.slice(0, 3).forEach(j => { jm[j.id] = { no: j.jobNo, name: j.client || j.job, site: j.site || '' }; });
  const all = tbxAll(); const f = Object.assign({}, TBX_BLANK, all[ws] || {});
  const cal = []; let cid = 1;
  const book = (user, jobId, title, dayIdx, s, e, type) => cal.push({ id: cid++, day: tbxAddDays(ws, dayIdx), user, type: type || (jobId ? 'JOB_PHASE' : 'OTHER'), jobId: jobId ? String(jobId) : '', title, s, e, mins: 600 });
  [0, 1, 2, 3].forEach(i => { book('Lead roofer', B, '#' + jobs[1].jobNo + ' ' + jobs[1].client, i, '7:00am', '5:00pm'); book('Apprentice', B, '#' + jobs[1].jobNo + ' ' + jobs[1].client, i, '7:00am', '5:00pm'); });
  book('Lead roofer', '', 'day off', 4, '7:00am', '5:00pm'); book('Apprentice', '', 'Yard work', 4, '7:00am', '5:00pm');
  [0, 1, 2, 3, 4].forEach(i => book('Second lead', C, '#' + jobs[2].jobNo + ' ' + jobs[2].client, i, '7:00am', '5:00pm'));
  book('Second lead', A, '#' + jobs[0].jobNo + ' ' + jobs[0].client, 1, '9:00am', '10:00am', 'QUOTE');
  f.fergus = { at: '27 Oct, 6:58 am', from: lm, to: tbxAddDays(ws, 6), last, week, jobs: jm, entries: 61, sorted: true, cal, calErr: '' };
  f.crew = { [B]: 'Lead roofer, Apprentice', [C]: 'Second lead' };
  f.forecastMon = 'Mainly clear'; f.forecastTue = 'Slight rain, 70% chance of rain'; f.forecastWed = 'Partly cloudy'; f.forecastThu = 'Overcast'; f.forecastFri = 'Clear sky';
  all[ws] = f; S.set('tbx', all);
};`;
const b = await chromium.launch();
async function shoot(tag, vp, steps){
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: vp.width < 800, isMobile: vp.width < 800 });
  await ctx.route(u => !u.href.startsWith('file:'), r => r.abort());
  await ctx.addInitScript(hubSeedScript());
  await ctx.addInitScript(TBX_SEED);
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(HUB); await pg.waitForTimeout(1500);
  for (const [name, fn, full] of steps){
    if (fn) await fn(pg);
    await pg.waitForTimeout(800);
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
  ...['work', 'bc', 'pl', 'growth', 'marketing', 'cash', 'reports'].map(t => ['tab-' + t, pg => pg.evaluate(t => { go(t); document.querySelectorAll('details.acc').forEach(d => d.open = true); }, t), true]),
  ['toolbox', pg => pg.evaluate(() => { go('reports'); S.set('tbxStaff', [{ n: 'Lead roofer', p: 'Lead Roofer' }, { n: 'Apprentice', p: 'Apprentice' }]); __tbxSeedFergus(); openToolbox(); }), true],
  ['detail-deposit', pg => pg.evaluate(() => { closeToolbox(); go('cash'); openCashDetail('deposit'); }), false],
  ['dash-dark', pg => pg.evaluate(() => { closeCashDetail(); go('dash'); toggleTheme(); }), false],
]);
await shoot('desk', { width: 1440, height: 900 }, [
  ['dash', null, false],
  ['dash-full', null, true],
  ['detail-gp', pg => pg.evaluate(() => openCmdDetail('gp')), false],
  ['work', async pg => { await closeAll(pg); await pg.evaluate(() => go('work')); }, false],
  ...['bc', 'pl', 'growth', 'marketing', 'cash', 'reports'].map(t => ['tab-' + t, pg => pg.evaluate(t => { go(t); document.querySelectorAll('details.acc').forEach(d => d.open = true); }, t), true]),
  ['toolbox', pg => pg.evaluate(() => { go('reports'); S.set('tbxStaff', [{ n: 'Lead roofer', p: 'Lead Roofer' }, { n: 'Apprentice', p: 'Apprentice' }]); __tbxSeedFergus(); openToolbox(); }), true],
]);
await b.close();
console.log('shots in', OUT);
