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
  S.quote.psBayAmount='3'; S.quote.psSubtotal=48000; S.quote.psSubtotalManual=true; S.quote._psLastFile='3-Bay';
  _qpCondPhotoSet(6,{src:PNG('A-hero')}); _qpCondPhotoSet(1,{src:PNG('A-floor')}); _qpCondPhotoSet(2,{src:PNG('A-elev')});
  _psPlanRecordImport();
  r.first = { n:_psPlans().length, name:_psPlans()[0].name };
  // "Add another plan option" banks A and clears the decks for B.
  _psPlanAddAnother();
  r.added = { n:_psPlans().length, idx:_psPlanIdx(), w:S.quote.psWidth,
              photoGone: !((_qpCondPhoto(1)||{}).src) };
  S.quote.psWidth='9m'; S.quote.psLength='18m'; S.quote.psHeight='4.2m';
  S.quote.psBayAmount='4'; S.quote.psSubtotal=61500; S.quote.psSubtotalManual=true; S.quote._psLastFile='4-Bay';
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
  S.quote.shedPlans = [{name:'A',fields:{psWidth:'7.2m',psSubtotal:48000,psSubtotalManual:true},photos:{},est:{}},
                       {name:'B',fields:{psWidth:'9m',psSubtotal:61500,psSubtotalManual:true},photos:{},est:{}}];
  S.quote.psPlanIdx = 0; S.quote.psWidth = '7.2m'; S.quote.psSubtotal = 48000; S.quote.psSubtotalManual = true;
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

// ── A POLE SHED IN THE MODERN STYLE IS A POLE SHED (2026-10-12) ───
// It was not. _qdSectionsRaw (the one-page computer layout) and _qbPages
// (the phone book) are written entirely around a ROOFING quote, and
// nothing asked what kind of quote this was — so a shed set to Modern
// rendered the roofing sections (steel grade, profile, guttering, old
// roof) with no shed content on them at all. Modern is also the DEFAULT
// style, so a brand-new shed quote came out as a re-roof quote, and that
// is what the customer's link would have shown them.
({ ctx, pg } = await open('Flood Roofing'));
const styles = await pg.evaluate(() => {
  gotoTab('quote');
  S.quote = S.quote || {}; S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '7.2m'; S.quote.psLength = '12.6m'; S.quote.psSubtotal = 48000; S.quote.psSubtotalManual = true;
  const out = {};
  ['classic','modern'].forEach(st => {
    S.quote.style = st; refreshQuoteProposal();
    const root = document.getElementById('qpRoot');
    out[st] = { a4: root.querySelectorAll('.rp-page').length,
                qd: root.querySelectorAll('.qd-sec').length,
                keys: _qdSectionsRaw().map(x => x.key),
                txt: (root.textContent || '').replace(/\s+/g, ' ') };
  });
  S.quote.style = 'modern'; QP_PREVIEW.mode = 'phone'; refreshQuoteProposal();
  out.phone = (document.getElementById('qpRoot').textContent || '').replace(/\s+/g, ' ');
  QP_PREVIEW.mode = 'desk';
  // A ROOFING quote must be exactly as it was.
  S.quote.quoteKind = 'roofing'; refreshQuoteProposal();
  out.roofing = (document.getElementById('qpRoot').textContent || '').replace(/\s+/g, ' ');
  return out;
});
check('a shed in CLASSIC style is still the A4 document, unchanged',
  styles.classic.a4 === 6 && styles.classic.qd === 0 && /Your Shed Details/i.test(styles.classic.txt),
  JSON.stringify({ a4: styles.classic.a4, qd: styles.classic.qd }));
check('a shed in MODERN style renders the SHED, not a roofing quote',
  styles.modern.qd > 0 && /Your Shed Details/i.test(styles.modern.txt),
  styles.modern.txt.slice(0, 110));
check('…its sections are the shed\'s own, with not one roofing section among them',
  JSON.stringify(styles.modern.keys) ===
    JSON.stringify(['cover','psplans','psdetails','psoptions','psincluded','psreview']),
  JSON.stringify(styles.modern.keys));
check('…and the phone book turns the same shed sections',
  /Your quote/i.test(styles.phone) && /Pole Shed|Project quote/i.test(styles.phone),
  styles.phone.slice(0, 110));
const roofKeys = await pg.evaluate(() => { S.quote.quoteKind='roofing'; return _qdSectionsRaw().map(x => x.key); });
check('a ROOFING quote in modern style is untouched by any of it',
  roofKeys.indexOf('grade') >= 0 && roofKeys.indexOf('disposal') >= 0 &&
  !roofKeys.some(k => /^ps/.test(k)) && !/Your Shed Details/i.test(styles.roofing),
  JSON.stringify(roofKeys));

// ── EACH PLAN OPTION IS PRICED ON ITS OWN (2026-10-13) ────────────
// The owner: "it won't let me price the two plans seperately, like i said it
// should act like the seperate roofs in a roofing job". The two plans shared
// one set of pricing, and the Pricing drawer had no plan switch in it at all.
const planPrice = await pg.evaluate(() => {
  S.quote = S.quote || {}; S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psBayAmount = '3';
  S.quote.psSubtotal = 64585; S.quote.psSubtotalManual = true;
  S.quote.shedPlans = []; S.quote.psPlanIdx = 0;
  _psPlanRecordImport();                       // Option A banked
  // price Option A the way the drawer does
  updateLabour('leadHrs', 40); updateLabour('appHrs', 40);
  updateScaffold('price', 3000); updateScaffold('cost', 2400);
  _qAddCustom('material', { desc:'Crane', qty:1, unit:900, uom:'', amount:900 });
  // a second plan
  _psPlanAddAnother();
  S.quote.psSubtotal = 71200; S.quote.psSubtotalManual = true; S.quote.psBayAmount = '4';
  _psPlanRecordImport();
  const bIdx = _psPlanIdx();
  const bFresh = { lead: S.quote.labour.leadHrs, scaff: (S.quote.scaffold||{}).price,
                   custom: _qCustomTotal('material') };
  updateLabour('leadHrs', 62);
  updateScaffold('price', 4200); updateScaffold('cost', 3300);
  _qAddCustom('material', { desc:'Extra bay crane', qty:1, unit:1500, uom:'', amount:1500 });
  const bPriced = { lead: S.quote.labour.leadHrs, scaff: S.quote.scaffold.price, custom: _qCustomTotal('material') };
  // back to Option A — its own figures must come back untouched
  _setPsPlan(0);
  const aBack = { lead: S.quote.labour.leadHrs, scaff: (S.quote.scaffold||{}).price,
                  custom: _qCustomTotal('material'), sub: _psPlanSubtotalAt(0) };
  _setPsPlan(bIdx);
  const bBack = { lead: S.quote.labour.leadHrs, scaff: (S.quote.scaffold||{}).price,
                  custom: _qCustomTotal('material'), sub: _psPlanSubtotalAt(bIdx) };
  _setPsPlan(0);
  // the drawer's own switch
  _renderPricingRoofSwitchBar();
  // The option buttons only — the rename pencil beside each one is a separate
  // control and is counted on its own, so neither can hide the other going wrong.
  const barAll = Array.from(document.querySelectorAll('#pricingRoofSwitchBar button'));
  const barBtns = barAll.filter(b => b.classList.contains('pr-roof-btn'))
    .map(b => (b.getAttribute('onclick')||'') + '|' + (b.textContent||'').trim());
  const barPens = barAll.filter(b => b.classList.contains('ps-plan-pen')).length;
  const barStray = barAll.length - barBtns.length - barPens;
  const tabs = _pricingRoofTabsHtml();
  const card = (document.querySelector('#pricingRoofMap .pr-price')||{}).textContent || '';
  return { bFresh, bPriced, aBack, bBack, barBtns, barPens, barStray,
           tabsHasPlan: /_setPsPlan/.test(tabs), card, plans: _psPlans().length };
});
check('a second plan option is banked beside the first', planPrice.plans === 2, JSON.stringify(planPrice.plans));
check('the Pricing drawer switches by PLAN OPTION on a shed',
  planPrice.barBtns.length === 2 && planPrice.barBtns.every(x => /_setPsPlan\(/.test(x)) && planPrice.tabsHasPlan,
  JSON.stringify(planPrice.barBtns));
check('…with a rename pencil beside each, and nothing else in that bar',
  planPrice.barPens === 2 && planPrice.barStray === 0,
  JSON.stringify({ pens: planPrice.barPens, stray: planPrice.barStray }));
check('a new plan starts from the one it was added beside, not from nothing',
  planPrice.bFresh.lead === 40 && planPrice.bFresh.scaff === 3000 && planPrice.bFresh.custom === 900,
  JSON.stringify(planPrice.bFresh));
check('OPTION A KEEPS ITS OWN LABOUR, SCAFFOLD AND TYPED LINES',
  planPrice.aBack.lead === 40 && planPrice.aBack.scaff === 3000 && planPrice.aBack.custom === 900 && planPrice.aBack.sub === 64585,
  JSON.stringify(planPrice.aBack));
check('…and the second plan keeps the ones it was priced with',
  planPrice.bBack.lead === 62 && planPrice.bBack.scaff === 4200 && planPrice.bBack.custom === 2400 && planPrice.bBack.sub === 71200,
  JSON.stringify(planPrice.bBack));
check('the band names the plan being priced and its price',
  /64,585/.test(planPrice.card), planPrice.card);

// ── A SHED IS PRICED LIKE A ROOFING JOB (2026-10-13) ──────────────
// The owner: "the pricing estimator should estimate the sheds material cost
// (and labour cost if it already does) then i should be able to edit
// everything just like i can with a roofing quote, should let me add material
// line items and labour lines, pretty much an exact copy of the roofing
// quote". A shed has no roof DRAWN, so the Pricing drawer read "No
// quantifiable items yet" and its labour, materials and scaffold fed nothing:
// the quote's price was one figure the estimator wrote.
const shedPricing = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  S.quote.psDoors = '2x Roller Door, 1x P.A. Door';
  gotoTab('scope');
  const price = () => { calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
                        return +_poleShedMoney().base.toFixed(2); };
  const out = {};
  out.base = price();
  const rows = _buildMaterialPriceRows();
  out.rowCount = rows.length;
  out.labels = rows.map(r => r.label);
  out.hasMarkupRow = rows.some(r => /markup/i.test(r.label));
  out.hasHourRow = rows.some(r => r.autoUnit === 'hr');
  out.decimalQty = rows.every(r => r.decimalQty === true);
  const L = S.quote.labour || {};
  out.leadHrs = L.leadHrs; out.appHrs = L.appHrs;
  out.est = (function(){ const e = _shedEstimate(_shedEst()); return { manHrs: e.manHrs, total: Math.round(e.total) }; })();
  out.parts = { mat: +(+S.materials).toFixed(2), lab: +(+S.labour).toFixed(2),
                scaff: +_scaffoldEff(_roofScaffold(0)).price };
  // delete a row — the price drops by that row, buffered and marked up
  const poles = rows[0];
  out.polesVal = +(poles.autoQty * poles.variants[0].price).toFixed(2);
  const pct = (1 + _roofMatQtyBufferPct(0) / 100) * (1 + _roofMatMarkupPct(0) / 100);
  out.expectDrop = +(out.polesVal * pct).toFixed(2);
  _deleteMatRow(_matOvKey(poles.key, 0));
  out.afterDelete = price();
  out.drop = +(out.base - out.afterDelete).toFixed(2);
  delete MATERIAL_DELETED[_matOvKey(poles.key, 0)];
  price();
  // type a quantity and a $/unit on a row, as on a roofing job
  _onMatOverride(_matOvKey(poles.key, 0), 'qty', 100);
  out.afterQty = price();
  _onMatOverride(_matOvKey(poles.key, 0), 'price', 30);
  out.afterRate = price();
  out.expectRate = +((out.afterRate)).toFixed(2);
  out.rateMath = +( (100 * 30) ).toFixed(2);
  // a custom material line, and a custom labour line
  _qAddCustom('material', { desc:'Site levelling', qty:1, unit:2500, uom:'', amount:2500 });
  out.afterCustomMat = price();
  _qAddCustom('labour', { desc:'Traffic management', qty:1, unit:900, uom:'', amount:900 });
  out.afterCustomLab = price();
  // typed hours stay typed
  updateLabour('leadHrs', 10);
  out.typedLead = (S.quote.labour || {}).leadHrs;
  price();
  out.typedLeadAfter = (S.quote.labour || {}).leadHrs;
  // the office types the total: that figure wins, and clearing hands it back
  S.quote.psSubtotal = 99000; S.quote.psSubtotalManual = true;
  out.typedTotal = _poleShedMoney().base;
  S.quote.psSubtotalManual = false;
  out.backToDrawer = price();
  out.stamped = S.quote.psSubtotal;
  return out;
});
check('a shed\'s material rows are the estimator\'s own take-off',
  shedPricing.rowCount > 10 && shedPricing.labels.some(l => /Building poles/.test(l)) &&
  shedPricing.labels.some(l => /Roof cladding/.test(l)) && shedPricing.labels.some(l => /Concrete/.test(l)) &&
  shedPricing.labels.some(l => /Roller doors/.test(l)), JSON.stringify(shedPricing.rowCount));
check('…without the estimator\'s own markup line (the table marks up once) or its hours',
  !shedPricing.hasMarkupRow && !shedPricing.hasHourRow);
check('…and they keep their decimals — concrete in m³ is measured, not counted', shedPricing.decimalQty);
check('the labour card\'s hours come off the estimate, split between the crew',
  shedPricing.leadHrs > 0 && shedPricing.leadHrs === shedPricing.appHrs &&
  Math.abs((shedPricing.leadHrs + shedPricing.appHrs) - shedPricing.est.manHrs) < 0.3,
  JSON.stringify({ lead: shedPricing.leadHrs, manHrs: shedPricing.est.manHrs }));
check('THE SHED\'S PRICE IS WHAT THE DRAWER ADDS UP TO — labour + materials + scaffold',
  Math.abs(shedPricing.base - (shedPricing.parts.mat + shedPricing.parts.lab + shedPricing.parts.scaff)) < 0.02,
  JSON.stringify({ base: shedPricing.base, parts: shedPricing.parts }));
check('…and it is in the same country as the estimate it was taken from',
  Math.abs(shedPricing.base - shedPricing.est.total) / shedPricing.est.total < 0.15,
  JSON.stringify({ base: shedPricing.base, est: shedPricing.est.total }));
check('DELETING A ROW takes exactly that row, buffered and marked up, off the shed',
  Math.abs(shedPricing.drop - shedPricing.expectDrop) < 0.02,
  JSON.stringify({ drop: shedPricing.drop, expect: shedPricing.expectDrop }));
check('typing a quantity moves the price', shedPricing.afterQty !== shedPricing.base, JSON.stringify(shedPricing.afterQty));
check('…and so does typing a $/unit', shedPricing.afterRate !== shedPricing.afterQty, JSON.stringify(shedPricing.afterRate));
check('A CUSTOM MATERIAL LINE adds to the shed', Math.abs((shedPricing.afterCustomMat - shedPricing.afterRate) - 2500) < 0.02,
  JSON.stringify({ a: shedPricing.afterRate, b: shedPricing.afterCustomMat }));
check('…and a custom LABOUR line does too', Math.abs((shedPricing.afterCustomLab - shedPricing.afterCustomMat) - 900) < 0.02,
  JSON.stringify({ a: shedPricing.afterCustomMat, b: shedPricing.afterCustomLab }));
check('hours typed on the labour card are never recomputed away', shedPricing.typedLeadAfter === 10,
  JSON.stringify(shedPricing));
check('typing the total on the quote overrides the drawer', shedPricing.typedTotal === 99000);
check('…and clearing that hands the shed back to the drawer', shedPricing.backToDrawer !== 99000 && shedPricing.backToDrawer > 0);
check('psSubtotal is STAMPED with what the drawer came to, so the plan chips follow',
  Math.abs(shedPricing.stamped - shedPricing.backToDrawer) < 0.02,
  JSON.stringify({ stamped: shedPricing.stamped, base: shedPricing.backToDrawer }));

// THE TAKE-OFF IS TAKEN ONCE and is then the office's, like the Job Pack cut
// list: a list re-derived on every render is a list that shifts under them.
const frozen = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  renderMaterialPriceTable();
  const first = _buildMaterialPriceRows().length;
  const poles = _buildMaterialPriceRows()[0];
  _onMatOverride(_matOvKey(poles.key, 0), 'qty', 123);
  // the shed grows — the office's rows do NOT move under them
  _shedEstInput('L', 30);
  renderMaterialPriceTable();
  const stillTyped = (MATERIAL_OVERRIDES[_matOvKey(poles.key, 0)] || {}).qty;
  const sameRows = _buildMaterialPriceRows().length === first;
  const sameQty = _buildMaterialPriceRows()[0].autoQty === poles.autoQty;
  // …until it is taken again
  _shedTakeoffReset(false);
  const afterReset = { rows: _buildMaterialPriceRows().length,
                       ov: Object.keys(MATERIAL_OVERRIDES).filter(k => /^shed_/.test(k)).length };
  return { first, stillTyped, sameRows, sameQty, afterReset };
});
check('the take-off is taken ONCE and then belongs to the office',
  frozen.first > 10 && frozen.sameRows && frozen.sameQty && String(frozen.stillTyped) === '123', JSON.stringify(frozen));
check('…and "take it again" rebuilds it and drops the edits that hung off the old rows',
  frozen.afterReset.rows > 10 && frozen.afterReset.ov === 0, JSON.stringify(frozen.afterReset));

// The two BLOCKING paths a shed now walks into, because its rows are roofing
// rows: "No price, no send" must let a priced shed out and still catch a row
// with no price, and the pricing CSV must write the shed rather than throw.
const shedGates = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  S.quote.psDoors = '2x Roller Door';
  gotoTab('scope'); calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
  const out = { err: null, csvErr: null };
  try { out.unpriced = (_unpricedItems() || []).length; } catch(e){ out.err = e.message; }
  try { out.csvRows = (_scopePricingRows() || []).length; } catch(e){ out.csvErr = e.message; }
  const rows = _buildMaterialPriceRows();
  _onMatOverride(_matOvKey(rows[0].key, 0), 'price', 0);
  renderMaterialPriceTable();
  try { const u = _unpricedItems() || []; out.zeroed = u.length; out.zeroedLabel = (u[0] || {}).label || ''; } catch(e){}
  return out;
});
check('a priced shed is not held up by "No price, no send"',
  shedGates.unpriced === 0 && !shedGates.err, JSON.stringify(shedGates));
check('…but a shed row left with NO price still holds the send, and is named',
  shedGates.zeroed === 1 && /Building poles/.test(shedGates.zeroedLabel || ''), JSON.stringify(shedGates));
check('the pricing CSV writes the shed rather than throwing',
  shedGates.csvRows > 25 && !shedGates.csvErr, JSON.stringify({ rows: shedGates.csvRows, err: shedGates.csvErr }));

// GUTTERING IS PART OF THE SHED'S PRICE (2026-10-13, the owner: "also
// guttering should be apart of the main price"). It always was — the take-off
// carries a Box gutter + downpipes line — but the ROOFING gutter card sat
// beside it reading "not on the quote", which says the opposite of the truth.
const shedGutter = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  gotoTab('scope'); calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
  const base = +_poleShedMoney().base.toFixed(2);
  const row = _buildMaterialPriceRows().filter(r => /gutter/i.test(r.label))[0] || null;
  const amt = row ? +(row.autoQty * row.variants[0].price).toFixed(2) : 0;
  renderGutterDownpipePricing();
  const txt = (document.getElementById('gutterDownpipeWrap') || {}).textContent || '';
  const cardShown = (document.getElementById('gutterDownpipeCard') || {}).style.display !== 'none';
  const offered = _gutterOnQuote();
  const excluded = _gutterExcluded();
  _pxHeadTotals();
  const head = (document.getElementById('pxTot_gutterDownpipeCard') || {}).textContent || '';
  // and it really is inside the price: delete it and the shed gets cheaper
  _deleteMatRow(_matOvKey(row.key, 0));
  calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
  const without = +_poleShedMoney().base.toFixed(2);
  return { amt, txt, head, cardShown, offered, excluded, base, without, drop: +(base - without).toFixed(2),
           pct: (1 + _roofMatQtyBufferPct(0) / 100) * (1 + _roofMatMarkupPct(0) / 100) };
});
check('a shed carries its guttering as a priced line in the take-off', shedGutter.amt > 0, JSON.stringify(shedGutter.amt));
check('…and it IS in the shed\'s price — taking the line off makes the shed cheaper by it',
  Math.abs(shedGutter.drop - shedGutter.amt * shedGutter.pct) < 0.02,
  JSON.stringify({ drop: shedGutter.drop, amt: shedGutter.amt, pct: shedGutter.pct }));
check('THE ROOFING GUTTER SECTION IS GONE from a shed\'s Pricing tab',
  shedGutter.cardShown === false && shedGutter.txt.trim() === '' && shedGutter.head.trim() === '',
  JSON.stringify({ shown: shedGutter.cardShown, txt: shedGutter.txt.slice(0, 80), head: shedGutter.head }));
check('…and the gutter is not offered on a shed\'s quote as an optional extra',
  shedGutter.offered === false && shedGutter.excluded === true,
  JSON.stringify({ offered: shedGutter.offered, excluded: shedGutter.excluded }));

// …and the shed's OWN selections page offers no guttering either — a
// different path from _gutterOnQuote, and the half of the ask that reaches
// the customer.
const shedSel = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  let sel = '', err = null, keys = [];
  try { sel = _buildPoleShedSelections() || ''; } catch(e){ err = e.message; }
  try { keys = _qdSectionsRaw().map(x => x.key); } catch(e){ err = (err || '') + ' ' + e.message; }
  return { gutterOffered: /gutter|spouting|downpipe/i.test(sel), err, keys, len: sel.length };
});
check('the shed\'s selections page does not offer guttering as an extra',
  shedSel.gutterOffered === false && !shedSel.err && shedSel.len > 200, JSON.stringify(shedSel).slice(0, 160));

// NO OFFCUT BUFFER ON A SHED, so reopening one quoted before this does not
// reprice it: the estimator's quantities already carry their allowances and
// its own 5% on materials, and charging the roofing buffer on top read 3%
// dearer on the owner's job 3287.
const shedBuffer = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '7.2m'; S.quote.psLength = '16.8m'; S.quote.psHeight = '3.48m - 2.58m';
  const seeded = { roofField: S.quote.roofMatQtyBuffer };
  gotoTab('scope'); calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
  seeded.bufAfter = _roofMatQtyBufferPct(0);
  seeded.mkAfter = _roofMatMarkupPct(0);
  seeded.roofFieldAfter = S.quote.roofMatQtyBuffer;
  // and a buffer the office sets afterwards is kept
  _setRoofMatQtyBuffer(7, 0);
  renderMaterialPriceTable();
  seeded.bufTyped = _roofMatQtyBufferPct(0);
  return seeded;
});
check('a shed reads NO offcut buffer and the estimator\'s own mark-up, from its own fields',
  shedBuffer.bufAfter === 0 && shedBuffer.mkAfter === 5 &&
  shedBuffer.roofField === 5 && shedBuffer.roofFieldAfter === 5, JSON.stringify(shedBuffer));
check('…and a buffer the office sets afterwards is kept', shedBuffer.bufTyped === 7, JSON.stringify(shedBuffer));

// THE FERGUS PUSH carries the shed, because its rows are roofing rows: the
// take-off goes over as itemised material lines and the builder's own
// reconcile backstop lands on the quote. A live integration, so it gets a
// tripwire.
const shedFergus = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  S.quote.psDoors = '2x Roller Door';
  gotoTab('scope'); calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems();
  const out = { base: +_poleShedMoney().base.toFixed(2), err: null };
  try {
    const secs = _buildFergusItemisedSections({});
    out.secNames = (secs.sections || []).map(x => x.name);
    out.matCount = secs.matCount; out.labourCount = secs.labourCount;
    out.reconciled = secs.reconciled;
  } catch(e){ out.err = e.message; }
  return out;
});
check('the Fergus push builds the shed — itemised materials and its labour',
  !shedFergus.err && shedFergus.matCount > 10 && shedFergus.labourCount >= 2 &&
  (shedFergus.secNames || []).indexOf('Materials') >= 0, JSON.stringify(shedFergus));
check('…and the pushed lines add up to the quote (the reconcile is rounding, not a gap)',
  Math.abs(+shedFergus.reconciled || 0) < 1, JSON.stringify({ reconciled: shedFergus.reconciled }));

// A SHED'S PERCENTAGES ARE ITS OWN FIELDS, so switching a job back to Roofing
// gets the roofing job back whole — the gutter, its own buffer, no shed rows,
// and no exclusion flag written onto it.
const flip = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  gotoTab('scope'); calcLabour(); renderMaterialPriceTable();
  _setRoofMatQtyBuffer(3, 0);                       // the office sets one on the shed
  const shed = { buf: _roofMatQtyBufferPct(0), shedField: S.quote.shedMatQtyBuffer,
                 roofField: S.quote.roofMatQtyBuffer, excluded: _gutterExcluded(),
                 card: (document.getElementById('gutterDownpipeCard') || {}).style.display };
  _setQuoteKind('roofing');
  calcLabour(); renderMaterialPriceTable(); renderGutterDownpipePricing();
  const roof = { buf: _roofMatQtyBufferPct(0), excluded: _gutterExcluded(),
                 card: (document.getElementById('gutterDownpipeCard') || {}).style.display,
                 shedRows: _shedMaterialRows().length, storedFlag: !!S.quote.gutterExcluded };
  return { shed, roof };
});
check('a buffer typed on a shed is the SHED\'s, and never written over the roofing job\'s',
  flip.shed.buf === 3 && flip.shed.shedField === 3 && flip.shed.roofField === 5, JSON.stringify(flip.shed));
check('switching the job back to Roofing gets the roofing job back whole',
  flip.roof.buf === 5 && flip.roof.excluded === false && flip.roof.card !== 'none' &&
  flip.roof.shedRows === 0 && flip.roof.storedFlag === false, JSON.stringify(flip.roof));

// A ROOFING job is untouched by all of it.
const roofUntouched = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'roofing';
  return { shedRows: _shedMaterialRows().length, isShed: _psIsShed(),
           drawerBase: _shedBaseFromDrawer() };
});
check('a ROOFING quote has no shed rows, no shed base and is priced as it always was',
  roofUntouched.shedRows === 0 && roofUntouched.isShed === false && roofUntouched.drawerBase === null,
  JSON.stringify(roofUntouched));

// ── A QUOTE THAT SAYS IT IS A POLE SHED IS ONE (2026-10-13) ───────
// The owner: "wheres the switcher from roofing to pole shed job type gone?
// the phyllis job is now missing the pole shed specific quote".
// _poleShedsAvailable() reads S.settings.branding, so a job opened BEFORE the
// settings read lands sees branding {} and the company-name fallback answers
// FALSE. The toggle was hidden — and far worse, _syncQuoteKindToggle REWROTE
// the saved quote to 'roofing'. A read that has not happened yet is not a
// "no"; that is this repo's own rule, and it cost a live job its shed quote.
const notLanded = await pg.evaluate(() => {
  const real = S.settings;
  S.settings = {};                                  // the read has not come back
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
  S.quote.psWidth = '7.2m'; S.quote.psLength = '16.8m'; S.quote.psSubtotal = 64585;
  const out = { avail: _poleShedsAvailable() };
  try { _syncQuoteKindToggle(); } catch(e){}
  try { _syncJobTypeToggle(); } catch(e){}
  out.kind = S.quote.quoteKind;
  out.toggle = (document.getElementById('jtTypeToggle') || {}).style.display;
  try { out.secs = _qdSectionsRaw().map(x => x.key); } catch(e){ out.secs = []; }
  S.settings = real;
  return out;
});
check('a saved pole-shed job opened before the settings read lands STAYS a pole shed',
  notLanded.kind === 'poleshed', JSON.stringify(notLanded));
check('…its customer quote is still the shed\'s, not a re-roof',
  (notLanded.secs || []).indexOf('psdetails') >= 0 && (notLanded.secs || []).indexOf('grade') < 0,
  JSON.stringify(notLanded.secs));
check('…and the Roofing / Pole Shed switcher is THERE, so it can be put back',
  notLanded.avail === true && notLanded.toggle !== 'none', JSON.stringify(notLanded));

// THE WHOLE OPEN, in the order it really happens: a saved shed job is restored
// while the settings read is still in flight, then the read lands. Its type,
// its dimensions and its PRICE all have to come through — the price because
// the drawer stamps psSubtotal on every recalc, including ones that land
// before the material table has been rendered, and a zero there is "not
// worked out yet", never an answer. It wrote $0 over job 3287's $64,585.
const openSeq = await pg.evaluate(() => {
  const real = S.settings;
  S.settings = {}; try { localStorage.removeItem('fr_settings'); } catch(e){}
  restoreFromJob({ draw_state: { state: { quote: { ref:'3287', client:'Phyllis Rintoul',
    quoteKind:'poleshed', psWidth:'7.2m', psLength:'16.8m', psSubtotal:64585 } } } });
  try { _syncQuoteKindToggle(); _syncJobTypeToggle(); } catch(e){}
  const mid = { kind: S.quote.quoteKind, sub: S.quote.psSubtotal };
  S.settings = real;
  try { _syncQuoteKindToggle(); _syncJobTypeToggle(); refreshQuoteProposal(); } catch(e){}
  try { calcLabour(); renderMaterialPriceTable(); _syncQuoteBaseLineItems(); } catch(e){}
  let secs = []; try { secs = _qdSectionsRaw().map(x => x.key); } catch(e){}
  return { mid, kind: S.quote.quoteKind, width: S.quote.psWidth, sub: S.quote.psSubtotal,
           ref: S.quote.ref, secs };
});
check('a saved shed job restored mid-settings-read keeps its type AND its price',
  openSeq.mid.kind === 'poleshed' && openSeq.mid.sub === 64585, JSON.stringify(openSeq.mid));
check('…and once the read lands it is still the shed, with its figures intact',
  openSeq.kind === 'poleshed' && openSeq.width === '7.2m' && openSeq.ref === '3287' &&
  openSeq.sub > 0, JSON.stringify(openSeq).slice(0, 170));
check('…showing the shed\'s own quote, not a re-roof',
  (openSeq.secs || []).indexOf('psdetails') >= 0 && (openSeq.secs || []).indexOf('grade') < 0,
  JSON.stringify(openSeq.secs));

// A FROZEN COPY IS NOT OURS TO WRITE INTO. _shedTakeoff() writes on a read,
// and it is read from a render — so viewing the sent or accepted copy, or the
// customer viewing theirs, would have stamped a take-off onto what went out.
const frozen2 = await pg.evaluate(() => {
  const mk = () => { S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed';
    S.quote.psWidth = '8'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48'; };
  mk(); S._qvViewing = { kind: 'sent' };
  const sent = { rows: _shedMaterialRows().length, wrote: Array.isArray(S.quote.shedTakeoff) };
  S._qvViewing = null;
  mk(); window.__CUSTOMER_MODE = true;
  const cust = { rows: _shedMaterialRows().length, wrote: Array.isArray(S.quote.shedTakeoff) };
  window.__CUSTOMER_MODE = false;
  mk();
  const draft = { rows: _shedMaterialRows().length, wrote: Array.isArray(S.quote.shedTakeoff) };
  return { sent, cust, draft };
});
check('viewing the SENT copy prices it without writing a take-off into it',
  frozen2.sent.rows > 10 && frozen2.sent.wrote === false, JSON.stringify(frozen2.sent));
check('…nor into the customer\'s own copy', frozen2.cust.rows > 10 && frozen2.cust.wrote === false, JSON.stringify(frozen2.cust));
check('…while the office\'s working draft still keeps its take-off',
  frozen2.draft.rows > 10 && frozen2.draft.wrote === true, JSON.stringify(frozen2.draft));

// An account that genuinely does not sell pole sheds is still not offered one.
const notSold = await pg.evaluate(() => {
  const real = S.settings;
  S.settings = { branding: { company_name: 'Someone Else Roofing', poleshed_enabled: false } };
  S.quote = defaultQuote(); S.quote.quoteKind = 'roofing';
  const avail = _poleShedsAvailable();
  S.settings = real;
  return { avail };
});
check('an account that does not sell pole sheds is still not offered one', notSold.avail === false, JSON.stringify(notSold));

// ── THE JOB TYPE IS NOT A SETTING (2026-10-12) ────────────────────
// The owner opened a pole-shed job, switched to another job, and that one
// came up as a pole shed too. window._pendingJobType is the New/Edit Job
// modal's one-shot answer and nothing put it back, so defaultQuote() went on
// reading it for every quote built afterwards.
const sticky = await pg.evaluate(() => {
  S.quote = S.quote || {}; S.quote.quoteKind = 'poleshed';
  openJobDetailsModal('edit');                 // the modal stashes the pick
  const stashed = window._pendingJobType;
  closeJobDetailsModal();
  // now start a fresh job the way the New Job button does
  _resetQuoteForFreshJob();
  const fresh = S.quote.quoteKind;
  // …and open a saved job whose stored quote predates quoteKind
  const after = (function(){
    try {
      window._pendingJobType = 'poleshed';
      restoreFromJob({ draw_state: { state: { quote: { ref: '4001', client: 'Beth Williamson' } } } });
    } catch(e){ return 'threw: ' + e.message; }
    return S.quote.quoteKind;
  })();
  return { stashed, fresh, after, ref: S.quote && S.quote.ref };
});
check('the Edit job modal still reads a pole shed as a pole shed', sticky.stashed === 'poleshed', JSON.stringify(sticky));
check('A BRAND-NEW JOB IS A ROOFING JOB', sticky.fresh === 'roofing', JSON.stringify(sticky));
check('…and so is a saved job whose quote never said (it no longer inherits the last job\'s type)',
  sticky.after === 'roofing' && sticky.ref === '4001', JSON.stringify(sticky));

// ── NAMING THE PLAN OPTIONS (2026-10-13) ────────────────────────────────
// The owner: "let me rename the two options, put a little edit pencil symbol
// button which lets me change the name of either option, put it everywhere it
// has the two option buttons aswell as in the pricing tab, also add plan
// option to the first page aswell as the inside the price box on the right
// hand side of the quote".
const twoPlans = () => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  S.quote.client = 'Phyllis Rintoul'; S.quote.ref = '3287';
  S.quote.psWidth = '7.2'; S.quote.psLength = '16.8'; S.quote.psHeight = '3.48';
  S.quote.psBayAmount = '4'; S.quote.psSubtotal = 35184.68;
  S.quote.shedPlans = [
    { name:'Option A',  fields:{ psWidth:'7.2', psLength:'16.8', psBayAmount:'4', psSubtotal:35184.68 }, photos:{}, est:{} },
    { name:'4-bay (1)', fields:{ psWidth:'7.2', psLength:'16.8', psBayAmount:'4', psSubtotal:37684.68 }, photos:{}, est:{} }
  ];
  S.quote.psPlanIdx = 0;
};

const pens = await pg.evaluate((src) => {
  eval('(' + src + ')')();
  // A pencil per option on each of the three surfaces that offer the options.
  const n = h => (h.match(/_psPlanRenamePrompt\(/g) || []).length;
  return { bar: n(_psPlanBarHtml()), drawer: n(_psPlanSwitchHtml()),
           options: n(_buildPoleShedSelections()) };
}, twoPlans.toString());
check('a rename pencil sits on BOTH options in the office strip above the drawings',
  pens.bar === 2, JSON.stringify(pens));
check('…on both chips in the Pricing drawer', pens.drawer === 2, JSON.stringify(pens));
check('…and on both rows of the options page', pens.options === 2, JSON.stringify(pens));

// A button inside a button is not valid markup — the browser breaks the inner
// one out of its parent, which would put the pencil somewhere else entirely.
const nested = await pg.evaluate(() => {
  const bad = h => /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(h);
  return { bar: bad(_psPlanBarHtml()), drawer: bad(_psPlanSwitchHtml()) };
});
check('the pencil is never nested inside the option\'s own button',
  nested.bar === false && nested.drawer === false, JSON.stringify(nested));

// The pencil renames, and the new name reaches every surface that names a plan.
const renamed = await pg.evaluate(() => {
  window.prompt = () => '4-Bay Deluxe';
  _psPlanRenamePrompt(1);
  const has = h => /4-Bay Deluxe/.test(h);
  return { stored: (_psPlans()[1] || {}).name, label: _psPlanLabel(1),
           bar: has(_psPlanBarHtml()), drawer: has(_psPlanSwitchHtml()),
           options: has(_buildPoleShedSelections()) };
});
check('the pencil renames that option', renamed.stored === '4-Bay Deluxe' && renamed.label === '4-Bay Deluxe',
  JSON.stringify(renamed));
check('…and the new name reaches the strip, the Pricing drawer and the options page',
  renamed.bar && renamed.drawer && renamed.options, JSON.stringify(renamed));

// Cancel and an empty box both keep the name — a rename dialog dismissed must
// never blank what is on the cover and on the customer's page.
const kept = await pg.evaluate(() => {
  const was = _psPlanLabel(1);
  window.prompt = () => null; _psPlanRenamePrompt(1);
  const afterCancel = _psPlanLabel(1);
  window.prompt = () => '   '; _psPlanRenamePrompt(1);
  return { was, afterCancel, afterBlank: _psPlanLabel(1) };
});
check('Cancel, and an empty box, both keep the name',
  kept.afterCancel === kept.was && kept.afterBlank === kept.was, JSON.stringify(kept));

// THE COVER AND THE PRICE BOX say which shed this quote is.
const planShown = await pg.evaluate(() => {
  const cover = _psParts().cover || '';
  const rail = _qdRail();
  return { coverLabel: /Plan option/.test(cover), coverName: /4-Bay Deluxe|Option A/.test(cover),
           railLabel: /Plan option/.test(rail), railName: /Option A/.test(rail) };
});
check('the cover names the plan option this quote is for',
  planShown.coverLabel && planShown.coverName, JSON.stringify(planShown));
check('…and so does the price box on the computer layout\'s rail',
  planShown.railLabel && planShown.railName, JSON.stringify(planShown));

// ONE plan is just "the shed": a cover or a price box that labels it reads as
// though a choice were missing.
const onePlan = await pg.evaluate(() => {
  S.quote.shedPlans = [S.quote.shedPlans[0]]; S.quote.psPlanIdx = 0;
  return { cover: /Plan option/.test(_psParts().cover || ''), rail: /Plan option/.test(_qdRail()),
           bar: _psPlanBarHtml(), drawer: _psPlanSwitchHtml() };
});
check('a shed with ONE plan says nothing about plan options anywhere',
  onePlan.cover === false && onePlan.rail === false && onePlan.bar === '' && onePlan.drawer === '',
  JSON.stringify({ cover: onePlan.cover, rail: onePlan.rail, bar: onePlan.bar.length, drawer: onePlan.drawer.length }));

// A roofing quote's rail is untouched.
const roofRail = await pg.evaluate(() => {
  S.quote = defaultQuote();
  return { plan: /Plan option/.test(_qdRail()) };
});
check('a ROOFING quote\'s price box gains nothing', roofRail.plan === false, JSON.stringify(roofRail));

// THE CUSTOMER PICKS A SHED, THEY DO NOT NAME ONE.
const custPen = await pg.evaluate((src) => {
  eval('(' + src + ')')();
  window.__CUSTOMER_MODE = true;
  const n = h => (h.match(/_psPlanRenamePrompt\(/g) || []).length;
  const r = { bar: n(_psPlanBarHtml()), drawer: n(_psPlanSwitchHtml()),
              options: n(_buildPoleShedSelections()),
              // they still SEE which shed the price is for
              cover: /Plan option/.test(_psParts().cover || ''), rail: /Plan option/.test(_qdRail()) };
  window.__CUSTOMER_MODE = false;
  return r;
}, twoPlans.toString());
check('the customer is offered no rename pencil anywhere',
  custPen.bar === 0 && custPen.drawer === 0 && custPen.options === 0, JSON.stringify(custPen));
check('…but still sees which plan option the price is for',
  custPen.cover && custPen.rail, JSON.stringify(custPen));

// AN ACCEPTED QUOTE NEVER CHANGES — the shed they signed off keeps its name,
// which is on the cover and in the price box they accepted.
const acc = await pg.evaluate(() => {
  window.__CUSTOMER_MODE = true; S.quote.accepted = { name: 'Phyllis' };
  const was = _psPlanLabel(1);
  window.prompt = () => 'Renamed after acceptance';
  _psPlanRenamePrompt(1);
  const after = _psPlanLabel(1);
  window.__CUSTOMER_MODE = false; delete S.quote.accepted;
  return { was, after };
});
check('an accepted quote keeps its plan names', acc.after === acc.was, JSON.stringify(acc));

await ctx.close();

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
