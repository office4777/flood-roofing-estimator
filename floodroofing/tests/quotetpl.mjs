// "the quote is too much information … i'd like a huge pop-up window to
//  overlay everything else, i would like whole pages to be exited out from
//  the quote, then on the side of the quote show the exited pages that can be
//  dragged back in with a similar look to microsoft power point, show all the
//  pages in the side and let user duplicate, delete, move pages"
//
// The proposal used to be seven pages in a fixed order with a tickbox each,
// buried in a collapsed settings card nowhere near the document they changed.
// A roofer's customer said the quote was too long and there was no good way
// to answer that.
//
// So the quote carries its pages the way the Job Pack already does —
// S.jobPack.pages = [{type, opts}] has worked there for a long time, and this
// is deliberately the same shape rather than a second idea about the same
// problem. The safety property this whole design rests on, and the first
// thing checked below: a quote nobody has edited renders EXACTLY the document
// it rendered before, because the page list is migrated from the old
// tickboxes the first time it is needed.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept('Short quote'));
let savedSettings = null;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/settings/.test(u) && m !== 'GET'){ savedSettings = r.request().postDataJSON(); return j({ ok:true }); }
  if (/\/settings/.test(u)) return j({ user_id:'u1',
    branding:{ company_name:'Flood Roofing LTD', phone:'0800 4 FLOOD', email:'office@floodroofing.co.nz' },
    quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing LTD', role:'owner' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','_rsModal'].forEach(i => {
  const e = document.getElementById(i); if (e) e.remove(); }); });
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
  finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  const c = document.getElementById('jobClient'); if (c) c.value = 'A Customer';
});
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2500);

const st = () => pg.evaluate(() => ({
  open:    document.getElementById('qtEditWrap').classList.contains('on'),
  slides:  document.querySelectorAll('#qtRail .qt-slide:not(.parked)').length,
  parked:  document.querySelectorAll('#qtRail .qt-slide.parked').length,
  thumbs:  document.querySelectorAll('#qtRail .qt-thumb .qt-scale').length,
  docPages:document.querySelectorAll('#qpRoot > .rp-page').length,
  order:   (S.quote.pages   || []).map(p => p.type).join(','),
  parkedT: (S.quote.parked  || []).map(p => p.type).join(',') || '-',
  inStage: !!document.querySelector('#qtStage > #qpRoot'),
  total:   (document.getElementById('qpRoot').textContent.match(/\$[\d,]+\.\d\d/g) || []).slice(-1)[0] || '',
}));

// ── an untouched quote is the quote it always was ─────────────────
let v = await st();
const total0 = v.total;
check('THE SAFETY LINE: a quote nobody has edited still has all seven pages, in order',
  v.order === 'cover,condition,inclusions,options,colorsteel,terms,signature', v.order);
check('…nothing sitting in the tray', v.parkedT === '-', v.parkedT);
check('…and the editor is nowhere to be seen until it is asked for', v.open === false);
check('…and the document still prices the job', /\$/.test(total0), total0);

// ── the window ────────────────────────────────────────────────────
await pg.evaluate(() => _qtOpen());
await pg.waitForTimeout(700);
v = await st();
check('THE ASK: "Edit quote template" opens a window over everything',
  v.open === true && (await pg.evaluate(() => {
    const w = document.getElementById('qtEditWrap'), cs = getComputedStyle(w);
    return cs.position === 'fixed' && parseInt(cs.zIndex, 10) >= 1000;
  })));
check('…with the real proposal inside it, not a copy that could drift',
  v.inStage === true && v.docPages > 0, JSON.stringify({ inStage: v.inStage, docPages: v.docPages }));
check('…and every page down the side, PowerPoint style, as real thumbnails',
  v.slides === 7 && v.thumbs === v.docPages, v.slides + ' slides, ' + v.thumbs + ' thumbnails for ' + v.docPages + ' pages');

// ── take a page out ───────────────────────────────────────────────
await pg.evaluate(() => _qtPark(4));            // Colorsteel
await pg.waitForTimeout(700);
v = await st();
check('THE ASK: a whole page can be taken out of the quote',
  !/colorsteel/.test(v.order), v.order);
check('…and it waits in the tray beside it rather than being lost',
  v.parkedT === 'colorsteel' && v.parked === 1, v.parkedT);
check('…and the customer\'s document is genuinely one page shorter',
  v.docPages === 5, v.docPages + ' pages rendered');
check('…while the price is untouched', v.total === total0, v.total + ' vs ' + total0);

// ── duplicate and reorder ─────────────────────────────────────────
await pg.evaluate(() => _qtDup(0));
await pg.waitForTimeout(700);
v = await st();
check('THE ASK: a page can be duplicated',
  v.order.split(',').filter(t => t === 'cover').length === 2, v.order);
await pg.evaluate(() => _qtMove({ from:'pages', i:0 }, 'pages', 3));
await pg.waitForTimeout(700);
v = await st();
check('THE ASK: a page can be moved',
  v.order.indexOf('condition') < v.order.lastIndexOf('cover'), v.order);
{
  // The cover was moved to third, so the document must now open on the
  // condition page and carry the second cover after it. Read off the pages
  // that actually rendered, which is what a customer would see.
  const rendered = await pg.evaluate(() => [...document.querySelectorAll('#qpRoot > .rp-page')]
    .map(e => e.getAttribute('data-qp-type')));
  check('…and the rendered document follows the list, not a fixed order',
    rendered[0] === 'cover' && rendered[1] === 'condition' && rendered[2] === 'cover',
    rendered.join(','));
}

// ── the last page cannot be dragged away ──────────────────────────
{
  const before = (await st()).order;
  await pg.evaluate(() => { const q = _qpState(); q.pages = [q.pages[0]]; _qtPark(0); });
  await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => (S.quote.pages || []).length);
  check('a quote is never left with no pages at all', after === 1, after + ' pages');
  await pg.evaluate((o) => { const q = _qpState();
    q.pages = o.split(',').map(t => _qpNewPage(t)); q.parked = []; refreshQuoteProposal(); }, before);
  await pg.waitForTimeout(700);
}

// ── saving, and picking it back up ────────────────────────────────
await pg.evaluate(() => _qtSaveAsNamed());      // the dialog answers "Short quote"
await pg.waitForTimeout(900);
check('THE ASK: the layout saves as a named template',
  (await pg.evaluate(() => _qtTemplates().map(t => t.name).join(','))) === 'Short quote',
  await pg.evaluate(() => _qtTemplates().map(t => t.name).join(',')));
check('…and the template carries the page arrangement, not just the wording',
  (await pg.evaluate(() => (_qtTemplates()[0].tpl.pages || []).length)) > 0,
  await pg.evaluate(() => JSON.stringify((_qtTemplates()[0].tpl.pages || []).map(p => p.type))));
check('…and it reaches the server, so it is there tomorrow',
  !!savedSettings && Array.isArray(savedSettings.branding.quote_templates) &&
  savedSettings.branding.quote_templates.length === 1,
  savedSettings ? String((savedSettings.branding.quote_templates || []).length) : 'no save');

await pg.evaluate(() => _qtSaveAsDefault());
await pg.waitForTimeout(700);
check('…and "save as default quote" saves the arrangement as the starting point',
  !!savedSettings && !!savedSettings.branding.proposal_template &&
  Array.isArray(savedSettings.branding.proposal_template.pages),
  savedSettings ? JSON.stringify(Object.keys(savedSettings.branding.proposal_template || {})).slice(0, 90) : '');

await pg.evaluate(() => _qtClose());
await pg.waitForTimeout(600);
v = await st();
check('closing the window puts the proposal back on the Quote tab',
  v.open === false && v.inStage === false && v.docPages > 0, JSON.stringify(v).slice(0, 90));
check('THE ASK: the Quote tab then offers the saved quotes to pick from',
  (await pg.evaluate(() => [...document.querySelectorAll('#qaTplSelect option')].map(o => o.textContent).join('|')))
    .indexOf('Short quote') >= 0,
  await pg.evaluate(() => [...document.querySelectorAll('#qaTplSelect option')].map(o => o.textContent).join('|')));

// ── picking one applies it to this job ────────────────────────────
await pg.evaluate(() => { const q = _qpState();
  q.pages = QUOTE_PAGE_TYPES.map(s => _qpNewPage(s.type)); q.parked = []; refreshQuoteProposal(); });
await pg.waitForTimeout(700);
check('(a job put back to the full seven pages first)',
  (await st()).order.split(',').length === 7);
const tplId = await pg.evaluate(() => _qtTemplates()[0].id);
await pg.evaluate((id) => _qtApplySaved(id), tplId);
await pg.waitForTimeout(900);
v = await st();
{
  // The template was saved with Colorsteel taken out and the cover moved, so
  // applying it must reproduce exactly that arrangement — not merely a
  // different one.
  const want = await pg.evaluate(() => _qtTemplates()[0].tpl.pages.map(p => p.type).join(','));
  check('THE ASK: picking a saved quote rearranges this job to match it',
    v.order === want, 'got ' + v.order + ' / want ' + want);
  check('…including the page it had taken out', !/colorsteel/.test(v.order), v.order);
}
check('…and the job still prices the same — a layout is not a price',
  v.total === total0, v.total + ' vs ' + total0);

// ── the old tickboxes and the editor are one control, not two ─────
await pg.evaluate(() => { const q = _qpState();
  q.pages = QUOTE_PAGE_TYPES.map(s => _qpNewPage(s.type)); q.parked = [];
  renderProposalSectionToggles(); refreshQuoteProposal(); });
await pg.waitForTimeout(700);
await pg.evaluate(() => toggleProposalSection('terms'));
await pg.waitForTimeout(700);
v = await st();
check('the old "Proposal sections" tickboxes move pages too, rather than disagreeing',
  !/terms/.test(v.order) && /terms/.test(v.parkedT), v.order + ' | tray ' + v.parkedT);
check('…and tick it back on and the page returns',
  await pg.evaluate(async () => { toggleProposalSection('terms');
    await new Promise(r => setTimeout(r, 500));
    return (S.quote.pages || []).some(p => p.type === 'terms'); }));

// ── never any part of what the customer gets ──────────────────────
for (const cls of ['customer-view', 'print-quote', 'pdf-rendering']){
  const hidden = await pg.evaluate((c) => {
    document.documentElement.classList.add(c);
    const w = document.getElementById('qtEditWrap');
    const vis = getComputedStyle(w).display !== 'none';
    document.documentElement.classList.remove(c);
    return vis;
  }, cls);
  check('the editor is gone in ' + cls + ' — it is the roofer\'s tool, not the customer\'s',
    hidden === false);
}

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
