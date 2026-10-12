// "can you remove the pole sheds from the quote tab, i only want to keep it
//  for my flood roofing log in"
//
// The pole-shed quote is Flood Roofing's own product line — its own pricing
// model, its own consent wording, its own six pages. It is not part of what
// RoofMap sells to other roofing companies, and every one of them was being
// offered a "Pole Shed" draft on the Quote tab and a "Pole Shed" job type in
// the job modal.
//
// The gate is deliberately NOT the one that decides who may show the built-in
// photos. That answers a different question, and turning the photos off for
// an account should not quietly take a product line with it. Same shape
// though — an explicit setting wins — so it can be switched on for somebody
// by hand without a deploy.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const errs = [];

async function open(companyName, extraBranding){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (/\/settings/.test(u)) return j({ user_id:'u1',
      branding: Object.assign({ company_name: companyName, phone:'09 123 4567',
                                email:'office@example.co.nz' }, extraBranding || {}),
      quote_defaults:{ next_job_no:'00001' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript((n) => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@example.co.nz', name:'Sam Tui' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:n, role:'owner' })); }, companyName);
  await pg.goto('file://' + DIR + '/app.html');
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { ['setupWizard','_rsModal'].forEach(i => {
    const e = document.getElementById(i); if (e) e.remove(); }); });
  await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
    finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
  await pg.waitForTimeout(2200);
  return { ctx, pg };
}
const shown = (pg, sel) => pg.evaluate(s => {
  const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);

// ── the account it belongs to keeps it ────────────────────────────
let { ctx, pg } = await open('Flood Roofing LTD');
check('the account whose product it is still gets the Pole Shed draft',
  await shown(pg, '#qkDraftToggle'));
check('…and can still pick it as a job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const e = document.getElementById('jtTypeToggle');
  return !!e && getComputedStyle(e).display !== 'none';
}));
check('…and switching to it actually switches',
  (await pg.evaluate(() => { _setQuoteKind('poleshed'); return S.quote.quoteKind; })) === 'poleshed');
await ctx.close();

// ── everybody else does not ───────────────────────────────────────
({ ctx, pg } = await open('Kauri Roofing Ltd'));
check('THE ASK: another roofing company is not offered a Pole Shed draft',
  !(await shown(pg, '#qkDraftToggle')));
check('…nor a Pole Shed job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const e = document.getElementById('jtTypeToggle');
  return !e || getComputedStyle(e).display === 'none';
}));
// A job saved while it WAS offered, or a template copied from one, must not
// strand somebody on a document they cannot switch away from — the toggle
// that would switch them back is the thing that is gone.
check('…and a job carrying a shed draft is put back to a roofing one, not stranded',
  (await pg.evaluate(() => { S.quote.quoteKind = 'poleshed'; _syncQuoteKindToggle();
                             return S.quote.quoteKind; })) === 'roofing');
check('…so the proposal it renders is the roofing one',
  await pg.evaluate(async () => { refreshQuoteProposal(); await new Promise(r => setTimeout(r, 600));
    return !/Pole Shed/i.test(document.getElementById('qpRoot').textContent || ''); }));
// The rest of the Quote tab is untouched — this removes a draft type, not a tab.
check('…while the Quote tab itself still works as it did',
  await shown(pg, '#tab-quote > .q-actionbar') &&
  (await pg.evaluate(() => (document.getElementById('qpRoot').textContent || '').length)) > 400);
await ctx.close();

// ── and it can be turned on for somebody by hand ──────────────────
({ ctx, pg } = await open('Kauri Roofing Ltd', { poleshed_enabled: true }));
check('a company switched on by hand gets it, without a deploy',
  await shown(pg, '#qkDraftToggle'));
await ctx.close();

// ── THE WEBSHED IMPORT READS THE SHED (2026-10-12) ────────────────
// The owner: the imported WebShed PDF should fill the quote and "it's
// missing the width, the length, height, number of bays". It always was:
// a WebShed export's TEXT layer carries the contact block and the 3D link
// and nothing else — every dimension is drawn inside the page's JPEG — so
// the old text scrape could never find one. The size is in the PDF's own
// Title metadata, which jsPDF writes from the shed's configuration.
({ ctx, pg } = await open('Flood Roofing'));
const parsed = await pg.evaluate(() => ({
  // The attached 3-Bay.pdf's real title.
  title:   _parseWebShedTitle('7.2m (W) x 12.6m (L) x 3.48m (H)'),
  noLabel: _parseWebShedTitle('7.2m x 12.6m x 3.48m'),
  junk:    _parseWebShedTitle('Web Shed'),
  blank:   _parseWebShedTitle(''),
  bays:    ['3-Bay.pdf','3 Bay shed.pdf','12_bay.pdf','shed.pdf','0-bay.pdf'].map(_parseWebShedBays),
  link:    _parseWebShedLink('View & Edit in 3D: https://floodroofing.webshed.app/#xjNQfOCnXmi/0 Developed by https://www.webshed.app'),
  linkEnd: _parseWebShedLink('see https://floodroofing.webshed.app/#abc/0.'),
  noLink:  _parseWebShedLink('nothing here'),
}));
check('the shed\'s size is read from the PDF title, where WebShed really puts it',
  parsed.title && parsed.title.W === 7.2 && parsed.title.L === 12.6 && parsed.title.H === 3.48,
  JSON.stringify(parsed.title));
check('…a title with no (W)/(L)/(H) labels still reads in WebShed\'s own order',
  parsed.noLabel && parsed.noLabel.W === 7.2 && parsed.noLabel.L === 12.6, JSON.stringify(parsed.noLabel));
check('…and a title with no size in it reads as nothing, rather than inventing one',
  parsed.junk === null && parsed.blank === null, JSON.stringify([parsed.junk, parsed.blank]));
check('the bay count comes off the filename — the only place it is written down',
  JSON.stringify(parsed.bays) === JSON.stringify([3, 3, 12, 0, 0]), JSON.stringify(parsed.bays));
check('the 3D link is read out of the text layer, trailing punctuation trimmed',
  parsed.link === 'https://floodroofing.webshed.app/#xjNQfOCnXmi/0' &&
  parsed.linkEnd === 'https://floodroofing.webshed.app/#abc/0' && parsed.noLink === '',
  JSON.stringify([parsed.link, parsed.linkEnd, parsed.noLink]));
await ctx.close();

// ── THE PAGES, IN THE ORDER HE ASKED FOR ──────────────────────────
// "remove floor plan from the 1 page and onto the 2 page, then move that
// page with the photos up one page so they are on the 2nd physical page
// and the 'your shed' page is below it", and "rename 'your shed' to
// 'your shed details'".
({ ctx, pg } = await open('Flood Roofing'));
const doc = await pg.evaluate(() => {
  gotoTab('quote');
  S.quote = S.quote || {};
  S.quote.quoteKind = 'poleshed'; S.quote.style = 'classic';
  S.quote.psWidth = '7.2m'; S.quote.psLength = '12.6m'; S.quote.psHeight = '3.48m';
  S.quote.psBayAmount = '3'; S.quote.psBays = '3 @ 4.2m';
  S.quote.psDesignLink = 'https://floodroofing.webshed.app/#xjNQfOCnXmi/0';
  refreshQuoteProposal();
  const pages = Array.from(document.querySelectorAll('#qpRoot .rp-page'));
  const txt = i => (pages[i] ? pages[i].textContent : '').replace(/\s+/g, ' ');
  return { n: pages.length, p1: txt(0), p2: txt(1), p3: txt(2),
           link: !!document.querySelector('#qpRoot a[href*="webshed"]') };
});
check('the drawings are the SECOND physical page, straight after the cover',
  /Design & Elevations/i.test(doc.p2), doc.p2.slice(0, 80));
check('…with BOTH the floor plan and the elevations on it',
  /Floor plan/i.test(doc.p2) && /Elevations/i.test(doc.p2), doc.p2.slice(0, 120));
check('…the shed details page sits below them, renamed "Your Shed Details"',
  /Your Shed Details/i.test(doc.p3), doc.p3.slice(0, 80));
check('…and the floor plan is no longer on the details page',
  !/Floor plan/i.test(doc.p3), doc.p3.slice(0, 120));
check('the 3D link renders as a button the customer can click',
  doc.link === true);
await ctx.close();

// ── TWO SHEDS ON ONE QUOTE (2026-10-12) ───────────────────────────
// "a 2nd import webshed pdf button called 'Add another plan option' ...
// switch between the two options should change the photos imported in the
// quote so the customer can see the different plans as they click between
// them, this should work in the quote and in the pricing just how the
// separate roofs work."
({ ctx, pg } = await open('Flood Roofing'));
const plan = await pg.evaluate(() => {
  const r = {}, PNG = n => 'data:image/png;base64,PLAN' + n;
  gotoTab('quote');
  S.quote = S.quote || {}; S.quote.quoteKind = 'poleshed'; S.quote.style = 'classic';
  // Shed A, as an import leaves it.
  S.quote.psWidth='7.2m'; S.quote.psLength='12.6m'; S.quote.psHeight='3.48m';
  S.quote.psBayAmount='3'; S.quote.psSubtotal=48000; S.quote._psLastFile='3-Bay';
  _qpCondPhotoSet(6,{src:PNG('A-hero')}); _qpCondPhotoSet(1,{src:PNG('A-floor')}); _qpCondPhotoSet(2,{src:PNG('A-elev')});
  _psPlanRecordImport();
  r.first = { n:_psPlans().length, name:_psPlans()[0].name };
  // "Add another plan option" banks A and clears the decks for B.
  _psPlanAddAnother();
  r.added = { n:_psPlans().length, idx:_psPlanIdx(), w:S.quote.psWidth,
              photoGone: !((_qpCondPhoto(1)||{}).src) };
  S.quote.psWidth='9m'; S.quote.psLength='18m'; S.quote.psHeight='4.2m';
  S.quote.psBayAmount='4'; S.quote.psSubtotal=61500; S.quote._psLastFile='4-Bay';
  _qpCondPhotoSet(6,{src:PNG('B-hero')}); _qpCondPhotoSet(1,{src:PNG('B-floor')}); _qpCondPhotoSet(2,{src:PNG('B-elev')});
  _psPlanRecordImport();
  r.second = { names:_psPlans().map(p=>p.name), total:_poleShedMoney().sub, delta:_psPlanDeltaAt(1) };
  // Back to A — dimensions, price AND every drawing.
  _setPsPlan(0);
  r.backToA = { w:S.quote.psWidth, bays:S.quote.psBayAmount, sub:_poleShedMoney().sub,
                hero:(_qpCondPhoto(6)||{}).src, floor:(_qpCondPhoto(1)||{}).src, elev:(_qpCondPhoto(2)||{}).src };
  _setPsPlan(1);
  r.toB = { w:S.quote.psWidth, sub:_poleShedMoney().sub, floor:(_qpCondPhoto(1)||{}).src };
  refreshQuoteProposal();
  const txt = document.getElementById('qpRoot').textContent.replace(/\s+/g,' ');
  r.customerPanel = txt;
  r.officeStrip = !!document.querySelector('#qpRoot button[onclick^="_setPsPlan"]');
  return r;
});
check('the first import becomes plan 1, named after the file it came from',
  plan.first.n === 1 && plan.first.name === '3-Bay', JSON.stringify(plan.first));
check('"Add another plan option" banks it and clears the decks for the next shed',
  plan.added.n === 2 && plan.added.idx === 1 && plan.added.w === '' && plan.added.photoGone,
  JSON.stringify(plan.added));
check('…so the second import does not land on top of the first',
  JSON.stringify(plan.second.names) === JSON.stringify(['3-Bay','4-Bay']), JSON.stringify(plan.second.names));
check('switching back brings the whole shed — its size, its bays and its PRICE',
  plan.backToA.w === '7.2m' && plan.backToA.bays === '3' && plan.backToA.sub === 48000,
  JSON.stringify(plan.backToA).slice(0, 120));
check('…and every drawing with it, which is the point of the option',
  /PLANA-hero/.test(plan.backToA.hero) && /PLANA-floor/.test(plan.backToA.floor) && /PLANA-elev/.test(plan.backToA.elev),
  JSON.stringify([plan.backToA.hero, plan.backToA.floor, plan.backToA.elev]));
check('…and forward again shows the other shed, not a mix of the two',
  plan.toB.w === '9m' && plan.toB.sub === 61500 && /PLANB-floor/.test(plan.toB.floor),
  JSON.stringify(plan.toB));
check('the customer is offered the choice, priced against the first plan',
  /Your shed/i.test(plan.customerPanel) && /3-Bay/.test(plan.customerPanel) &&
  /4-Bay/.test(plan.customerPanel) && /\$13,500/.test(plan.customerPanel),
  plan.customerPanel.slice(plan.customerPanel.indexOf('Your shed'), plan.customerPanel.indexOf('Your shed') + 110));
check('…the delta is the difference between the two sheds, not a second charge',
  plan.second.delta === 13500 && plan.second.total === 61500, JSON.stringify(plan.second));
check('the office gets its own strip to switch, rename and remove', plan.officeStrip);

// One shed = no choice to make: the panel and the strip stay out of the way.
const single = await pg.evaluate(() => {
  S.quote.shedPlans = [S.quote.shedPlans[0]]; S.quote.psPlanIdx = 0;
  refreshQuoteProposal();
  return { txt: document.getElementById('qpRoot').textContent.replace(/\s+/g,' '),
           strip: !!document.querySelector('#qpRoot button[onclick^="_setPsPlan"]') };
});
check('a one-shed quote shows no plan chooser at all', !single.strip && !/3-Bay/.test(single.txt));

// An accepted quote is the shed they signed off.
const locked = await pg.evaluate(() => {
  S.quote.shedPlans = [{name:'A',fields:{psWidth:'7.2m',psSubtotal:48000},photos:{},est:{}},
                       {name:'B',fields:{psWidth:'9m',psSubtotal:61500},photos:{},est:{}}];
  S.quote.psPlanIdx = 0; S.quote.psWidth = '7.2m'; S.quote.psSubtotal = 48000;
  S.quote.accepted = { name:'Phyllis', at: new Date().toISOString() };
  window.__CUSTOMER_MODE = true;
  _setPsPlan(1);
  const after = { idx:_psPlanIdx(), w:S.quote.psWidth };
  window.__CUSTOMER_MODE = false; delete S.quote.accepted;
  return after;
});
check('a customer cannot switch the shed after accepting it',
  locked.idx === 0 && locked.w === '7.2m', JSON.stringify(locked));
await ctx.close();

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
