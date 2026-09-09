// "When I email a quote, automatically push the pricing to Fergus and publish
//  the quote" — and "anything that takes time, put a loading circle so the
//  user knows the app hasn't frozen."
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
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const calls = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if (/\/fergus\//.test(u)){
    if (m === 'POST' && /\/quotes$/.test(u)) { calls.push({ kind:'create', body: r.request().postDataJSON() }); return j({ id:'fq9', data:{ id:'fq9' } }); }
    if (m === 'GET' && /\/quotes$/.test(u)) return j({ data: [{ id:'fq9' }] });
    return j({});
  }
  if (/\/fergus-quote\/publish/.test(u)){ calls.push({ kind:'publish', body: r.request().postDataJSON() }); return j({ ok:true, path:'/jobs/quotes/{id}/publish' }); }
  if (/\/email\/send-order/.test(u)){ calls.push({ kind:'email', body: r.request().postDataJSON() }); await new Promise(res => setTimeout(res, 900)); return j({ ok:true, queued:true }); }
  if (m === 'PUT' && /\/jobs\/[^/]+\/quote$/.test(u)){ calls.push({ kind:'publishQuote', body: r.request().postDataJSON() }); return j({ ok:true, updated_at:new Date().toISOString() }); }
  if (m === 'PUT' && /\/jobs\//.test(u)) return j({ id:'job1', updated_at:new Date().toISOString() });
  if (m === 'POST' && /\/jobs$/.test(u)) return j({ id:'job1', updated_at:new Date().toISOString() });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

await pg.evaluate(() => {
  S.quote = S.quote || {};
  Object.assign(S.quote, { gstRate: 15, ref: '3231', client: 'Matawaia Marae', addr: '1 Marae Rd', email: 'marae@example.co.nz',
    lineItems: [{ desc:'Labour', qty:1, unit:5000 }, { desc:'Materials', qty:1, unit:7000 }],
    proposalOptions: { steelGrade:'maxam', gutterType:'box125' }, baseGrade: 'maxam', labour: { leadHrs: 20, appHrs: 20, leadPrice: 120, appPrice: 60, leadCost: 45, appCost: 25 } });
  S.currentJobId = 'job1'; S.linkedJobId = 'fergus-job-1'; S.jobLocked = false;
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Matawaia Marae';
  var ja = document.getElementById('jobAddr'); if (ja) ja.value = '1 Marae Rd';
  S.settings = S.settings || {}; S.settings.jms_keys = { fergus: 'k'.repeat(40) };
});

// ── the base plan has no selection lines, and carries the line shape ──
const base = await pg.evaluate(() => {
  const full = _buildFergusItemisedSections();
  const b = _buildFergusItemisedSections({ base: true });
  const names = (secs) => secs.map(s => s.name);
  const hasSel = (secs) => secs.some(s => s.lineItems.some(li => /^Selection —|Gutter —|Box Gutter/i.test(li.itemName)));
  return { full: names(full.sections), base: names(b.sections), fullSel: hasSel(full.sections), baseSel: hasSel(b.sections),
           tmpl: b.template, matShape: Object.keys(b.template.mat).sort().join(',') };
});
check('the full push lays the job out for a gutter job (roof sections apart from the gutter’s)', base.full.indexOf('Roof Labour') >= 0, JSON.stringify(base.full));
check('the BASE plan carries no selection or gutter lines — those are the server’s to add', !base.baseSel && base.base.indexOf('Gutter Material') < 0, JSON.stringify(base.base));
check('…and the exact line shape Fergus accepted', /isLabour/.test(base.matShape) && /itemName/.test(base.matShape) && /sortOrder/.test(base.matShape), base.matShape);

// ── emailing the quote pushes + publishes ──
await pg.evaluate(() => { openQuoteEmail(); document.getElementById('quoteEmailTo').value = 'marae@example.co.nz'; });
const pillSeen = { during: false };
const watcher = (async () => { for (let i = 0; i < 40; i++){ await pg.waitForTimeout(100); if (await pg.evaluate(() => { const p = document.getElementById('workingPill'); return !!(p && p.classList.contains('on') && /Sending|Pushing|Publishing/.test(p.textContent)); })) pillSeen.during = true; } })();
const sendP = pg.evaluate(() => _quoteEmailSendNow());
await sendP;
const status = await pg.evaluate(() => (document.getElementById('quoteEmailStatus') || {}).textContent || '');
await watcher;
await pg.waitForTimeout(300);
const kinds = calls.map(c => c.kind);
check('the email goes out', kinds.indexOf('email') >= 0, kinds.join(', '));
check('THE FEATURE: emailing the quote pushes the pricing to the linked Fergus job', kinds.indexOf('create') > kinds.indexOf('email'), kinds.join(', '));
check('…and publishes it', kinds.indexOf('publish') > kinds.indexOf('create') && calls.find(c => c.kind === 'publish').body.quoteId === 'fq9', kinds.join(', '));
const plan = await pg.evaluate(() => S.quote.share && S.quote.share.fergus);
check('…and stamps the plan the server follows for the customer’s selections',
  !!plan && plan.jobId === 'fergus-job-1' && Array.isArray(plan.baseSections) && plan.baseSections.length > 0 && plan.publish === true && plan.published === true && !!plan.template,
  JSON.stringify(plan && { jobId: plan.jobId, sections: (plan.baseSections || []).length, publish: plan.publish, published: plan.published }));
const stamped = calls.filter(c => c.kind === 'publishQuote').some(c => c.body && c.body.quote && c.body.quote.share && c.body.quote.share.fergus);
check('…published to the customer link, so the server can read it', stamped);
check('the send dialog says so', /Fergus quote published/.test(status), status);
check('the "working" spinner showed while it ran', pillSeen.during);
check('…and is gone once it settled', await pg.evaluate(() => { const p = document.getElementById('workingPill'); return !p || !p.classList.contains('on'); }));

// ── the spinner is a general thing: any slow wrapped call shows it, a fast one never flickers ──
const slow = await pg.evaluate(async () => {
  window.__slowOp = function(){ return new Promise(r => setTimeout(r, 900)); };
  window.__fastOp = function(){ return 1; };
  _workingWrap('__slowOp', 'Testing…'); _workingWrap('__fastOp', 'Never…');
  const p = () => document.getElementById('workingPill');
  __fastOp(); await new Promise(r => setTimeout(r, 600));
  const fastShown = !!(p() && p().classList.contains('on'));
  const run = __slowOp(); await new Promise(r => setTimeout(r, 650));
  const shownMid = !!(p() && p().classList.contains('on') && /Testing/.test(p().textContent));
  await run; await new Promise(r => setTimeout(r, 50));
  return { fastShown, shownMid, after: !!(p() && p().classList.contains('on')) };
});
check('a fast call never shows the spinner', !slow.fastShown);
check('a slow one shows it after half a second and clears it when done', slow.shownMid && !slow.after, JSON.stringify(slow));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
