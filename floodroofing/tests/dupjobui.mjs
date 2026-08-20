// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const posts = [];
let refuse = true;
const ctx = await b.newContext({ viewport:{width:1400,height:950} });
const pg = await ctx.newPage();
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const q = r.request(), u = q.url(), m = q.method();
  const j = (code, x) => r.fulfill({status:code,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/jobs$/.test(u) && m === 'POST'){
    const body = q.postDataJSON(); posts.push(body);
    if (refuse && !body.allowDuplicateRef)
      return j(409, { error:'Job 3099 already exists.', code:'DUPLICATE_JOB_NO', jobNo:'3099',
        existing:{ id:'0f695ede', client_name:'Nikki Barrett', site_address:'11 Morcom Lane, Kerikeri', updated_at:'2026-08-18T19:50:26Z' } });
    return j(200, { id:'new-job-1', client_name: body.client_name, site_address: body.site_address });
  }
  if (/\/jobs\/0f695ede/.test(u) && m === 'GET')
    return j(200, { id:'0f695ede', client_name:'Nikki Barrett', site_address:'11 Morcom Lane, Kerikeri', draw_state:{ state:{ quote:{ ref:'3099' } } } });
  if (/__failtest/.test(u)) return j(500, { error:'The price book could not be reached.' });
  if (/\/jobs(\?|$)/.test(u) && m === 'GET') return j(200, []);
  if (/\/settings/.test(u) && m === 'GET') return j(200, { user_id:'u1', quote_defaults:{}, branding:{ company_name:'Flood Roofing LTD' }, jms_keys:{} });
  return j(200, []);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

async function attemptSave(){
  await pg.evaluate(() => {
    S.currentJobId = null;
    document.getElementById('jobClient').value = 'Nikki Barrett';
    document.getElementById('jobAddr').value = '11 Morcom Lane, Kerikeri';
    S.quote = S.quote || {}; S.quote.ref = '3099';
    return saveCurrentJob();
  });
  await pg.waitForTimeout(700);
}
await attemptSave();

let v = await pg.evaluate(() => {
  const m = document.getElementById('dupJobModal');
  return { shown: !!m, txt: m ? (m.textContent||'').replace(/\s+/g,' ') : '' };
});
check('a save that would duplicate a job number stops and asks', v.shown, v.txt.slice(0,80));
check('…naming the job number and the record that already has it',
  /Job 3099 already exists/.test(v.txt) && /Nikki Barrett/.test(v.txt) && /11 Morcom Lane/.test(v.txt), v.txt.slice(0,190));
check('…and showing when that one was last saved', /last saved 18 Aug/.test(v.txt), v.txt);
check('…offering all three ways out',
  /Open that job instead/.test(v.txt) && /Save as a separate record/.test(v.txt) && /Cancel/.test(v.txt));
check('nothing was created yet — only the refused attempt was sent', posts.length === 1, posts.length + ' POSTs');
await pg.locator('#dupJobModal').screenshot({ path: S+'/dupjob.png' });

// Cancel leaves the work alone
await pg.click('#dupJobModal button[onclick^="_dupJobClose"]');
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  gone: !document.getElementById('dupJobModal'),
  msg: (document.getElementById('globalJobBarSaveMsg')||{}).textContent || (document.getElementById('saveJobMsg')||{}).textContent || '',
  jobId: S.currentJobId }));
check('Cancel closes it and says plainly that nothing was saved',
  v.gone && /already in use/.test(v.msg) && !v.jobId, JSON.stringify(v));
check('…and still no second record', posts.length === 1, posts.length + ' POSTs');

// Save anyway → explicit override
await attemptSave();
await pg.click('#dupJobModal button[onclick^="_dupJobSaveAnyway"]');
await pg.waitForTimeout(800);
v = await pg.evaluate(() => ({ jobId: S.currentJobId,
  msg: (document.getElementById('globalJobBarSaveMsg')||{}).textContent || (document.getElementById('saveJobMsg')||{}).textContent || '' }));
check('"Save as a separate record" retries with the override',
  posts.length === 3 && posts[2].allowDuplicateRef === true, JSON.stringify(posts.map(p=>!!p.allowDuplicateRef)));
check('…and the job is saved and adopted', v.jobId === 'new-job-1' && /separate record/.test(v.msg), JSON.stringify(v));

// Open the existing job instead
await pg.evaluate(() => { S.currentJobId = null; });
await attemptSave();
const drafted = await pg.evaluate(async () => {
  window.__wroteDraft = false;
  const real = window._writeLocalDraftNow;
  window._writeLocalDraftNow = function(){ window.__wroteDraft = true; return real.apply(this, arguments); };
  document.querySelector('#dupJobModal button[onclick^="_dupJobOpen"]').click();
  await new Promise(r => setTimeout(r, 1200));
  return { wrote: window.__wroteDraft, gone: !document.getElementById('dupJobModal'), jobId: S.currentJobId };
});
check('"Open that job instead" keeps the on-screen work as a local draft first',
  drafted.wrote === true, JSON.stringify(drafted));
check('…then opens the existing job', drafted.gone && drafted.jobId === '0f695ede', JSON.stringify(drafted));

// a job number nobody has saves without a word
refuse = false;
await pg.evaluate(() => { S.currentJobId = null; S.quote.ref = '3100'; return saveCurrentJob(); });
await pg.waitForTimeout(800);
check('an unused job number saves with no interruption',
  !(await pg.evaluate(() => !!document.getElementById('dupJobModal'))) &&
  (await pg.evaluate(() => S.currentJobId)) === 'new-job-1');

// the server's own wording reaches the office on any failure
const msg = await pg.evaluate(async () => {
  try { await api('GET', '/__failtest'); return { m:'(no error thrown)' }; }
  catch(e){ return { m: e.message, s: e.status }; }
});
check('api() surfaces the server\'s own wording, not "HTTP 500 {json}"',
  msg.m === 'The price book could not be reached.' && msg.s === 500, JSON.stringify(msg));

await ctx.close();
await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
