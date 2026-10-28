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
  await shown(pg, '#qkBtn_poleshed'));
check('…and can still pick it as a job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const t = document.getElementById('jtTypeToggle'), e = document.getElementById('jtBtn_poleshed');
  return !!t && getComputedStyle(t).display !== 'none' && !!e && getComputedStyle(e).display !== 'none';
}));
check('…and switching to it actually switches',
  (await pg.evaluate(() => { _setQuoteKind('poleshed'); return S.quote.quoteKind; })) === 'poleshed');
await ctx.close();

// ── everybody else does not ───────────────────────────────────────
({ ctx, pg } = await open('Kauri Roofing Ltd'));
// Since 2026-10-28 every account has a job-type choice (Gutters only), so the
// switch itself shows; what must not show is the Pole Shed button in it.
check('THE ASK: another roofing company is not offered a Pole Shed draft',
  !(await shown(pg, '#qkBtn_poleshed')));
check('…nor a Pole Shed job type', await pg.evaluate(() => {
  try { openJobDetailsModal('new'); } catch(e){}
  const e = document.getElementById('jtBtn_poleshed');
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
  styles.modern.qd > 0 && /Your shed in detail/i.test(styles.modern.txt) && /Pole shed quote/i.test(styles.modern.txt),
  styles.modern.txt.slice(0, 110));
// A DECISION PER SECTION (2026-10-20): the shed's one "Choose Your Options"
// page became six sections of its own, in the roofing quote's idiom. The plan
// option and the add-ons are conditional, so this fixture (one plan, the three
// built-in add-ons) gets psaddons and not psplan; psprofile joined them on
// 2026-10-21 and psgutter with it, and both are the SHED'S own sections -
// one gutter with its downpipes, never the re-roof's brackets page.
check('…its sections are the shed\'s own, with not one roofing section among them',
  JSON.stringify(styles.modern.keys) ===
    JSON.stringify(['cover','psplans','psdetails','psgrade','psprofile','psthickness','pscolour','psgutter','psroller','psaddons','psincluded','review']),
  JSON.stringify(styles.modern.keys));
// The REVIEW section is keyed 'review', not 'psreview': the rail's "Review
// quote" button and the narrow screen's bottom bar both scroll to #qd-review,
// so a shed with its own key had a Review button that went nowhere.
check('…and the Review button has somewhere to go',
  styles.modern.keys.indexOf('review') === styles.modern.keys.length - 1,
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
  const sw = h => (h.match(/_setPsPlan\(/g) || []).length;
  return { coverLabel: /Plan option/.test(cover), coverName: /4-Bay Deluxe|Option A/.test(cover),
           coverSwitch: sw(cover), railSwitch: sw(rail), railName: /Option A/.test(rail) };
});
check('the cover names the plan option this quote is for',
  planShown.coverLabel && planShown.coverName, JSON.stringify(planShown));
// BUTTONS, not a label — the owner, 2026-10-13: "it's missing the buttons i
// asked for on page one for the customer to switch between the two plans, and
// also missing those same buttons in the fixed price box".
check('…and page one carries a BUTTON per plan for the customer to switch with',
  planShown.coverSwitch === 2, JSON.stringify(planShown));
check('…and so does the price box on the computer layout\'s rail',
  planShown.railSwitch === 2 && planShown.railName, JSON.stringify(planShown));

// ONE plan is just "the shed": a cover or a price box that labels it reads as
// though a choice were missing.
const onePlan = await pg.evaluate(() => {
  S.quote.shedPlans = [S.quote.shedPlans[0]]; S.quote.psPlanIdx = 0;
  return { cover: /Plan option/.test(_psParts().cover || ''),
           rail: /ps-cswitch/.test(_qdRail()), bar: _psPlanBarHtml(), drawer: _psPlanSwitchHtml() };
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
              // the switch is the CUSTOMER'S control, so it is there for them
              cover: (( _psParts().cover || '').match(/_setPsPlan\(/g) || []).length === 2,
              rail: ((_qdRail().match(/_setPsPlan\(/g)) || []).length === 2 };
  window.__CUSTOMER_MODE = false;
  return r;
}, twoPlans.toString());
check('the customer is offered no rename pencil anywhere',
  custPen.bar === 0 && custPen.drawer === 0 && custPen.options === 0, JSON.stringify(custPen));
check('…but still sees which plan option the price is for, and can switch it',
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

// ── THE CUSTOMER'S TOTAL IS THE SHED'S OWN (2026-10-13) ─────────────────
// The owner, on a quote he had already SENT: "the options to switch between
// plans doesn't even change the price, neither does switch to zincalume, the
// total doesn't change, plus, the extra price to upgrade to the 4-bay shed in
// the customer quotes says an extra roughly 71k whereas the app quote shows
// the correct etra cost of about 16k".
const shedMoney = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  // A shed priced by typing its total — the office's typed figure wins over
  // the drawer, so the cents below are stable and the pins read as money.
  S.quote.gstRate = 15; S.quote.psSubtotal = 54490.78; S.quote.psSubtotalManual = true;
  S.quote.psWidth = '7.2'; S.quote.psLength = '12.6'; S.quote.psBayAmount = '3';
  S.quote.shedPlans = [
    { name:'3-Bay Shed', fields:{ psSubtotal:54490.78, psWidth:'7.2', psLength:'12.6', psBayAmount:'3' }, photos:{}, est:{} },
    { name:'4-Bay Shed', fields:{ psSubtotal:71225.11, psWidth:'7.2', psLength:'16.8', psBayAmount:'4' }, photos:{}, est:{} }
  ];
  S.quote.psPlanIdx = 0;
  refreshQuoteProposal();
  window.__CUSTOMER_MODE = true;
  const snap = () => ({ total: +_qbTotal().toFixed(2),
                        rows: _custBarRows().map(r => r.label + '|' + r.value) });
  const start = snap();
  _setPsSel('psSelGrade', 'zincalume');  const zinc = snap();
  _setPsSel('psSelGrade', 'colorsteel');
  _setPsPlan(1);                          const four = snap();
  _setPsPlan(0);
  const deltaHealthy = +_psPlanDeltaAt(1).toFixed(2);
  // the frozen copy that reached his customer had no live psSubtotal on it
  const keep = S.quote.psSubtotal; delete S.quote.psSubtotal;
  const deltaNoLive = +_psPlanDeltaAt(1).toFixed(2);
  S.quote.psSubtotal = keep;
  window.__CUSTOMER_MODE = false;
  return { start, zinc, four, deltaHealthy, deltaNoLive };
});
check('the customer\'s total on a shed starts at the shed\'s own price',
  shedMoney.start.total === 62664.40, JSON.stringify(shedMoney.start));
check('CHOOSING ZINCALUME MOVES THE CUSTOMER\'S TOTAL',
  shedMoney.zinc.total === 60536.90, JSON.stringify(shedMoney.zinc.total));
check('…and the saving is listed beside it, not just applied',
  shedMoney.zinc.rows.some(r => /Zincalume/.test(r) && /−\$2,127\.50/.test(r)),
  JSON.stringify(shedMoney.zinc.rows));
check('SWITCHING PLAN MOVES THE CUSTOMER\'S TOTAL',
  shedMoney.four.total === 81908.88, JSON.stringify(shedMoney.four.total));
check('…and the summary names the shed they are now looking at',
  shedMoney.four.rows.some(r => /4-Bay Shed/.test(r)), JSON.stringify(shedMoney.four.rows));
check('a shed\'s summary never calls itself a re-roof',
  !shedMoney.start.rows.join(' ').toLowerCase().includes('re-roof'),
  JSON.stringify(shedMoney.start.rows));
check('THE 4-BAY\'S EXTRA COST IS $16,734.33, the figure the app shows',
  shedMoney.deltaHealthy === 16734.33, String(shedMoney.deltaHealthy));
check('…and it stays right on a copy carrying no live psSubtotal (it read '
    + '+$71,225.11 — the other plan\'s whole price — on the sent quote)',
  shedMoney.deltaNoLive === 16734.33, String(shedMoney.deltaNoLive));

await ctx.close();

// ── THE SHED'S OPTIONS PAGE (2026-10-13) ────────────────────────────
// The owner, on a shed quote he had sent: "the cover photo is blurry, can you
// also allow me to move the cover photo and zoom in just like i can with the
// photo slots ... also in the options allow me to add, delete or edit the
// different add-ons. then make the sections bigger and one selection per row
// instead of jammed in next to each other like that, just like the roofing
// type shows" \u2014 and, a minute later, "also delete the pricing totals on page
// 3 & 4".
({ ctx, pg } = await open('Flood Roofing LTD'));

// ── the cover is a photo slot like the others ───────────────────────
const cover = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'classic';
  S.quote.psWidth = '7.2'; S.quote.psLength = '12.6';
  // A 2\u00d71 picture is enough: nothing here reads its pixels, only its frame.
  _qpCondPhotoSet(6, { src:'data:image/gif;base64,R0lGODlhAgABAIAAAP///wAAACH5BAEAAAAALAAAAAACAAEAAAICRAEAOw==',
                       offX:0, offY:0, zoom:1 });
  refreshQuoteProposal();
  const fig = document.querySelector('[data-cp-hero="1"]');
  const img = fig && fig.querySelector('img');
  return {
    isSlot: !!(fig && fig.classList.contains('qp-cond-photo')),
    idx: fig && fig.getAttribute('data-cp-idx'),
    // The drag and the wheel are the condition slots' own handlers, not a
    // second copy that could drift from them.
    drag: !!(fig && (fig.getAttribute('onmousedown')||'').indexOf('_qpCondPhotoDragStart') >= 0),
    wheel: !!(fig && (fig.getAttribute('onwheel')||'').indexOf('_qpCondPhotoWheel') >= 0),
    hasImg: !!img,
    transform: img ? img.style.transform : '',
    // and the controls that do it by button
    ctrls: fig ? Array.from(fig.querySelectorAll('.qp-cond-controls button'))
                      .map(b => b.getAttribute('onclick')).join(' ') : ''
  };
});
check('the shed cover is a photo slot, not a background image', cover.isSlot);
check('\u2026on the cover\u2019s own slot', cover.idx === '6', String(cover.idx));
check('\u2026it drags with the condition slots\u2019 own handler', cover.drag);
check('\u2026and zooms on the wheel with theirs', cover.wheel);
check('the picture is an <img> carrying the slot transform',
  cover.hasImg && /translate\(0px, ?0px\) scale\(1\)/.test(cover.transform), cover.transform);
check('the cover carries zoom out / zoom in / reset buttons',
  /_qpCondPhotoZoom\(6,-0\.1\)/.test(cover.ctrls) &&
  /_qpCondPhotoZoom\(6,\+0\.1\)/.test(cover.ctrls) &&
  /_qpCondPhotoReset\(6\)/.test(cover.ctrls), cover.ctrls);

const covMove = await pg.evaluate(() => {
  _qpCondPhotoZoom(6, 0.4);
  _qpCondPhotoSet(6, { offX: -40, offY: 25 });
  _qpApplySlotTransform(6);
  const img = document.querySelector('[data-cp-hero="1"] img');
  const after = { zoom: _qpCondPhoto(6).zoom, t: img ? img.style.transform : '' };
  _qpCondPhotoReset(6);
  const cp = _qpCondPhoto(6);
  return { after, reset: { x: cp.offX, y: cp.offY, z: cp.zoom } };
});
check('moving and zooming the cover reaches the picture on screen',
  Math.abs(covMove.after.zoom - 1.4) < 1e-9 && /translate\(-40px, ?25px\) scale\(1\.4\)/.test(covMove.after.t),
  JSON.stringify(covMove.after));
check('\u2026and \u21ba puts it back to the middle',
  covMove.reset.x === 0 && covMove.reset.y === 0 && covMove.reset.z === 1,
  JSON.stringify(covMove.reset));
// A reset must not swap a 16/9 thumbnail in where the cover band was.
check('resetting the cover leaves it a cover, not a 16/9 slot',
  await pg.evaluate(() => !!document.querySelector('[data-cp-hero="1"]')));
check('the customer gets a plain picture \u2014 no drag, no buttons',
  await pg.evaluate(() => {
    window.__CUSTOMER_MODE = true; refreshQuoteProposal();
    const fig = document.querySelector('[data-cp-hero="1"]');
    const out = { drag: !!(fig && fig.getAttribute('onmousedown')),
                  btns: fig ? fig.querySelectorAll('.qp-cond-controls button').length : -1 };
    window.__CUSTOMER_MODE = false; refreshQuoteProposal();
    return !out.drag && out.btns === 0;
  }));

// ── a cover is downscaled on a cover's budget ───────────────────────
// 900px at quality 0.6 is sized for a photo a third of the page wide; across a
// full-bleed cover it is visibly soft, which is what he was looking at.
const budget = await pg.evaluate(() => {
  // A picture bigger than either budget, so the cap is what decides.
  const c = document.createElement('canvas'); c.width = 2600; c.height = 1700;
  const g = c.getContext('2d');
  for (let i = 0; i < 400; i++){                   // noise, so JPEG cannot cheat
    g.fillStyle = 'rgb('+(i%255)+','+((i*7)%255)+','+((i*13)%255)+')';
    g.fillRect((i*37)%2600, (i*53)%1700, 90, 70);
  }
  const src = c.toDataURL('image/jpeg', 0.95);
  const dim = (d) => new Promise(res => { const im = new Image();
    im.onload = () => res({ w: im.width, h: im.height, bytes: d.length }); im.src = d; });
  return new Promise(res => {
    _downscalePhoto(src, function(small){
      _downscalePhoto(src, function(bigger){
        Promise.all([dim(small), dim(bigger)]).then(function(r){
          res({ site: r[0], cover: r[1],
                isCover6: _qpCondSlotIsCover(6), isCover0: _qpCondSlotIsCover(0) });
        });
      }, true);
    });
  });
});
check('a site photo is still held to 900px', budget.site.w === 900, JSON.stringify(budget.site));
check('A COVER IS NOT: it keeps 2000px', budget.cover.w === 2000, JSON.stringify(budget.cover));
check('\u2026and more of its detail with it', budget.cover.bytes > budget.site.bytes * 2,
  budget.site.bytes + ' \u2192 ' + budget.cover.bytes);
check('slot 6 is the cover, the site slots are not',
  budget.isCover6 === true && budget.isCover0 === false);

// ── the add-ons are a list the office owns ──────────────────────────
const addons = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'classic';
  S.quote.gstRate = 15; S.quote.psSubtotal = 50000; S.quote.psSubtotalManual = true;
  // A quote from BEFORE any of this: no list, one of the three old flags on.
  S.quote.psAddSliding = true;
  const read = _psAddons().map(a => a.id + '|' + a.label + '|' + a.price + '|' + (a.on ? 1 : 0));
  const sub0 = +_poleShedMoney().sub.toFixed(2);
  const rows0 = _poleShedSelItems().map(r => r.label + '|' + r.delta);
  return { read, sub0, rows0, hasList: Array.isArray(S.quote.psAddons) };
});
check('a quote with no add-on list reads as the three built-ins',
  addons.read.length === 3 && /^wallUnderlay\|/.test(addons.read[0]), JSON.stringify(addons.read));
check('\u2026at their built-in prices', /\|3850\|/.test(addons.read[1]), addons.read[1]);
check('\u2026with the old flag deciding what is ticked',
  addons.read[1].slice(-1) === '1' && addons.read[0].slice(-1) === '0', JSON.stringify(addons.read));
check('\u2026and NOTHING is written to the quote by reading it', addons.hasList === false);
check('an old quote prices to the cent exactly as it did',
  addons.sub0 === 53850, String(addons.sub0));
check('\u2026and the sliding door is still named in the summary',
  addons.rows0.join(' ') === 'Sliding door|3850', JSON.stringify(addons.rows0));

const aoEdit = await pg.evaluate(() => {
  const out = {};
  _psAddonToggle('wallUnderlay');
  out.afterToggle = { list: Array.isArray(S.quote.psAddons),
                      legacy: !!S.quote.psSelWallUnderlay,
                      sub: +_poleShedMoney().sub.toFixed(2) };
  // Add one of the office's own — through the add-on window (2026-10-25,
  // which replaced the two prompts).
  const fill = (n, d, pr) => { document.getElementById('psAoName').value = n;
    document.getElementById('psAoDesc').value = d; document.getElementById('psAoPrice').value = pr; };
  _psAddonAdd(); fill('Concrete floor', '100mm slab under the whole shed', '1,250.50'); _psAddonSave();
  out.added = { n: _psAddons().length,
                last: _psAddons()[_psAddons().length - 1],
                sub: +_poleShedMoney().sub.toFixed(2) };     // off by default
  const newId = _psAddons()[_psAddons().length - 1].id;
  _psAddonToggle(newId);
  out.onSub = +_poleShedMoney().sub.toFixed(2);
  out.onRow = _poleShedSelItems().map(r => r.label + '|' + r.delta);
  // Re-price it. The window opens on what the add-on says now.
  _psAddonEdit(newId);
  out.prefill = { n: document.getElementById('psAoName').value, d: document.getElementById('psAoDesc').value,
                  p: document.getElementById('psAoPrice').value };
  fill('Concrete floor (150mm)', '150mm slab', '2000'); _psAddonSave();
  out.edited = { label: _psAddons().filter(a => a.id === newId)[0].label,
                 desc: _psAddons().filter(a => a.id === newId)[0].desc,
                 sub: +_poleShedMoney().sub.toFixed(2) };
  // Cancel keeps it as it is.
  _psAddonEdit(newId); fill('Something else', '', '9'); _qcoClose();
  out.cancelled = _psAddons().filter(a => a.id === newId)[0].price;
  // A name is required.
  _psAddonEdit(newId); fill('', '', '5'); _psAddonSave();
  out.noName = { open: !!document.getElementById('qcoModal'), msg: (document.getElementById('psAoMsg') || {}).textContent || '' };
  _qcoClose();
  // Delete it.
  const cf = window.confirm; window.confirm = () => true;
  _psAddonDelete(newId);
  window.confirm = cf;
  out.deleted = { n: _psAddons().length, sub: +_poleShedMoney().sub.toFixed(2) };
  return out;
});
check('ticking an add-on materialises the quote\u2019s own list',
  aoEdit.afterToggle.list === true);
check('\u2026and keeps the old flag in step, so a half-saved copy reads right',
  aoEdit.afterToggle.legacy === true);
check('\u2026and it reaches the price', aoEdit.afterToggle.sub === 55300,
  String(aoEdit.afterToggle.sub));
check('the office can ADD an add-on of their own', aoEdit.added.n === 4 &&
  aoEdit.added.last.label === 'Concrete floor', JSON.stringify(aoEdit.added.last));
check('\u2026with a price typed any way they like ($1,250.50)',
  aoEdit.added.last.price === 1250.5, String(aoEdit.added.last.price));
check('\u2026starting OFF, so adding one never moves a price by itself',
  aoEdit.added.last.on === false && aoEdit.added.sub === 55300, String(aoEdit.added.sub));
check('\u2026and ticking it charges for it', aoEdit.onSub === 56550.5, String(aoEdit.onSub));
check('\u2026under the name the office typed',
  aoEdit.onRow.join(' ').indexOf('Concrete floor|1250.5') >= 0, JSON.stringify(aoEdit.onRow));
check('the office can EDIT one — name, words and price, in one window',
  aoEdit.edited.label === 'Concrete floor (150mm)' && aoEdit.edited.desc === '150mm slab' &&
  aoEdit.edited.sub === 57300, JSON.stringify(aoEdit.edited));
check('…the window opening on what the add-on says now',
  aoEdit.prefill.n === 'Concrete floor' && aoEdit.prefill.d === '100mm slab under the whole shed' && aoEdit.prefill.p === '1250.5',
  JSON.stringify(aoEdit.prefill));
check('…and an add-on with no name is not saved', aoEdit.noName.open && /name/i.test(aoEdit.noName.msg), JSON.stringify(aoEdit.noName));
check('\u2026and Cancel keeps it exactly as it was', aoEdit.cancelled === 2000,
  String(aoEdit.cancelled));
check('the office can DELETE one', aoEdit.deleted.n === 3);
check('\u2026and its price goes with it', aoEdit.deleted.sub === 55300,
  String(aoEdit.deleted.sub));

const aoGuard = await pg.evaluate(() => {
  const out = {};
  // The CUSTOMER picks add-ons \u2014 that is what the page is for \u2014 but never
  // writes the list.
  window.__CUSTOMER_MODE = true;
  const before = _psAddons().length;
  _psAddonAdd(); _psAddonEdit('slidingDoor');
  const opened = !!document.getElementById('qcoModal');
  out.custWrote = opened || _psAddons().length !== before ||
                  _psAddons().filter(a => a.id === 'slidingDoor')[0].label === 'Sneaky';
  _psAddonToggle('doubleWindow');
  out.custPicked = !!_psAddons().filter(a => a.id === 'doubleWindow')[0].on;
  out.custEditable = _psAddonEditable();
  window.__CUSTOMER_MODE = false;
  // An ACCEPTED quote is not edited either.
  S.quote.share = { token:'t', status:'accepted' };
  S.quote.accepted = { name:'Phyllis', at:new Date().toISOString() };
  out.acceptedEditable = _psAddonEditable();
  _psAddonEdit('slidingDoor');
  if (document.getElementById('psAoName')){ document.getElementById('psAoName').value = 'Changed'; _psAddonSave(); }
  out.acceptedLabel = _psAddons().filter(a => a.id === 'slidingDoor')[0].label;
  S.quote.share = null; S.quote.accepted = null;
  return out;
});
check('the customer may TICK an add-on', aoGuard.custPicked);
check('\u2026but never add, rename or re-price one',
  !aoGuard.custWrote && aoGuard.custEditable === false);
check('an accepted quote\u2019s add-ons are not editable either',
  aoGuard.acceptedEditable === false && aoGuard.acceptedLabel === 'Add sliding door',
  aoGuard.acceptedLabel);

// ── one selection per row, and no totals on pages 3 and 4 ───────────
const pages = await pg.evaluate(() => {
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'classic';
  S.quote.gstRate = 15; S.quote.psSubtotal = 54490.78; S.quote.psSubtotalManual = true;
  refreshQuoteProposal();
  const by = (n) => Array.from(document.querySelectorAll('.rp-page'))
    .filter(p => (p.textContent || '').indexOf(n) >= 0)[0] || null;
  const opts = by('Choose Your Options'), incl = by('What\u2019s Included'), acc = by('Accept Your Quote');
  const txt = (e) => (e ? (e.textContent || '') : '');
  return {
    found: !!opts && !!incl && !!acc,
    // Each section is its own full-width row, not two columns side by side.
    twoCol: opts ? Array.from(opts.querySelectorAll('div'))
      .some(d => /1fr 1fr/.test(d.getAttribute('style') || '') &&
                 /STEEL THICKNESS/i.test(d.textContent || '')) : true,
    optsTotal: /Your selections|Base quote|Total \(incl/i.test(txt(opts)),
    // The page's own Options list legitimately says "+ GST" in the office's
    // wording, so the pin looks for the navy MONEY CARD that was on it: its
    // heading, its subtotal row and its deposit line.
    inclTotal: /Your investment/i.test(txt(incl)) ||
               /Subtotal\s*\(excl\. GST\)/i.test(txt(incl)) ||
               /deposit on acceptance/i.test(txt(incl)),
    accTotal: /Subtotal/.test(txt(acc)) && /Total/.test(txt(acc)),
    // Each option still says what IT adds \u2014 that is what page 3 is for.
    optsDeltas: /\+\$1,520\.00/.test(txt(opts)),
    // The hand-typed subtotal moved with the card rather than going with it.
    accTyped: acc ? !!acc.querySelector('[data-qfield="psSubtotal"]') : false,
    addBtn: opts ? /_psAddonAdd\(\)/.test(opts.innerHTML) : false
  };
});
check('the shed\u2019s five pages render', pages.found);
check('the options page is ONE SELECTION PER ROW, not two columns', !pages.twoCol);
check('PAGE 3 CARRIES NO TOTAL', !pages.optsTotal);
check('PAGE 4 CARRIES NO TOTAL', !pages.inclTotal);
check('\u2026but each option still shows what it adds', pages.optsDeltas);
check('the acceptance page still carries the breakdown', pages.accTotal);
check('\u2026and the office can still type the subtotal there', pages.accTyped);
check('the office gets + Add on the add-ons band', pages.addBtn);

await ctx.close();

// ── JOB 3287'S PLAN OPTION, ON THE LIVE CUSTOMER LINK (2026-10-13) ──────
// The owner, looking at floodroofing.roofmap.co.nz/q/... on his phone: the
// 4-bay still offered at "+$71,225.11" where his app quoted $54,490.78 for the
// 3-bay and $71,225.11 for the 4-bay, so the swap costs $16,734.33 — with the
// total beside it reading $62,664.40 incl / $54,490.78 excl, correctly.
//
// The chip and the total were reading DIFFERENT SOURCES for the same number.
// _poleShedMoney().base takes _shedBaseFromDrawer() over psSubtotal, and in
// customer mode that is quoteSubtotal() — the frozen line items. A shed priced
// by its take-off therefore reaches the chip with no psSubtotal at all, both
// of its reads answer 0, and the difference becomes the other plan's WHOLE
// PRICE. Three faults, all here:
//   1. the picked plan's price must come from the one engine the total uses;
//   2. a plan with nothing stored, on a frozen copy, is the shed AS SENT —
//      without that the difference vanishes the moment they take the 4-bay;
//   3. switching plan must MOVE a frozen copy's price: the line items are
//      fixed at the send, so they can only ever price one of the sheds.
({ ctx, pg } = await open('Flood Roofing LTD'));
const plan3287 = await pg.evaluate(() => {
  const res = {};
  const M = () => ({ excl: +_poleShedMoney().sub.toFixed(2),
                     incl: +_poleShedMoney().tot.toFixed(2),
                     chip: +_psPlanDeltaAt(1).toFixed(2) });
  const setup = (o) => { o = o || {};
    S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.gstRate = 15;
    // His copy: priced by its TAKE-OFF, so the line items are the price and
    // psSubtotal is not on it at all.
    S.quote.lineItems = o.noLines ? [] : [{ desc:'Pole shed', qty:1, unit:54490.78 }];
    delete S.quote.psSubtotal;
    S.quote.shedPlans = [
      // The 3-bay was banked BEFORE it was priced, so it stores no figure.
      { name:'3-Bay Shed', fields: o.price0 ? { psSubtotal:54490.78 } : {}, photos:{}, est:{} },
      { name:'4-Bay Shed', fields: o.noPrice1 ? {} : { psSubtotal:71225.11 }, photos:{}, est:{} }
    ];
    S.quote.psPlanIdx = 0; };

  setup(); window.__CUSTOMER_MODE = true;
  res.sent = M();
  _setPsPlan(1); res.onFour = M();
  _setPsPlan(0); res.back = M();
  S.quote.psSelGrade = 'zincalume'; res.zinc = M(); S.quote.psSelGrade = 'colorsteel';
  window.__CUSTOMER_MODE = false;

  // The ordinary shape, both plans priced, must read the same.
  setup({ price0:true }); window.__CUSTOMER_MODE = true;
  res.bothPriced = M();
  _setPsPlan(1); res.bothPricedFour = M(); _setPsPlan(0);
  window.__CUSTOMER_MODE = false;

  // The OFFICE on a shed with nothing priced yet: no difference invented, and
  // a blank plan is never lent the quote's own total.
  setup({ noLines:true, noPrice1:true }); res.officeNothing = +_psPlanDeltaAt(1).toFixed(2);
  setup({ noLines:true });                res.officeBlankFirst = +_psPlanDeltaAt(1).toFixed(2);
  // ...and a shed priced by typing one figure is untouched.
  setup({ noLines:true }); S.quote.psSubtotal = 54490.78; S.quote.psSubtotalManual = true;
  res.officeTyped = M();

  // A shed with ONE plan never reaches any of it.
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.gstRate = 15;
  S.quote.lineItems = [{ desc:'Shed', qty:1, unit:40000 }];
  window.__CUSTOMER_MODE = true;
  res.onePlan = +_poleShedMoney().sub.toFixed(2);
  window.__CUSTOMER_MODE = false;
  return res;
});
check('the sent quote reads $54,490.78 excl \u2014 the figure on his screen',
  plan3287.sent.excl === 54490.78, String(plan3287.sent.excl));
check('\u2026and $62,664.40 incl beside it', plan3287.sent.incl === 62664.40, String(plan3287.sent.incl));
check('THE 4-BAY COSTS +$16,734.33 TO SWAP TO, not +$71,225.11',
  plan3287.sent.chip === 16734.33, String(plan3287.sent.chip));
check('TAKING THE 4-BAY MOVES THE CUSTOMER\u2019S TOTAL to $71,225.11 excl',
  plan3287.onFour.excl === 71225.11, String(plan3287.onFour.excl));
check('\u2026$81,908.88 incl', plan3287.onFour.incl === 81908.88, String(plan3287.onFour.incl));
check('\u2026and the difference still reads, rather than vanishing once taken',
  plan3287.onFour.chip === 16734.33, String(plan3287.onFour.chip));
check('going back to the 3-bay comes back to the cent',
  plan3287.back.excl === 54490.78 && plan3287.back.incl === 62664.40, JSON.stringify(plan3287.back));
check('Zincalume still takes $1,850 off \u2014 $52,640.78 excl, $60,536.90 incl',
  plan3287.zinc.excl === 52640.78 && plan3287.zinc.incl === 60536.90, JSON.stringify(plan3287.zinc));
check('\u2026without moving what the other shed costs',
  plan3287.zinc.chip === 16734.33, String(plan3287.zinc.chip));
check('a quote with BOTH plans priced reads the same both ways',
  plan3287.bothPriced.excl === 54490.78 && plan3287.bothPriced.chip === 16734.33 &&
  plan3287.bothPricedFour.excl === 71225.11 && plan3287.bothPricedFour.chip === 16734.33,
  JSON.stringify([plan3287.bothPriced, plan3287.bothPricedFour]));
check('the office is shown NO difference rather than a wrong one',
  plan3287.officeNothing === 0 && plan3287.officeBlankFirst === 0,
  plan3287.officeNothing + ' / ' + plan3287.officeBlankFirst);
check('a shed priced by typing one total is untouched',
  plan3287.officeTyped.excl === 54490.78 && plan3287.officeTyped.chip === 16734.33,
  JSON.stringify(plan3287.officeTyped));
check('a shed with one plan prices exactly as it did', plan3287.onePlan === 40000,
  String(plan3287.onePlan));

await ctx.close();

// ── A SHED'S QUOTE TALKS ABOUT A SHED (2026-10-13) ──────────────────────
// The owner: "can you change the default wording for the Pole Shed quote in a
// Pole Shed job type, still relates to a roofing job instead of a Pole Shed,
// also the 'the old roofing we take it away' from the price box on the right
// of the quote shouldn't be there".
({ ctx, pg } = await open('Flood Roofing'));
const shedWords = await pg.evaluate(() => {
  const res = {};
  const shed = () => {
    S.quote = defaultQuote();
    S.quote.quoteKind = 'poleshed'; S.quote.gstRate = 15; S.quote.ref = '3287';
    S.quote.client = 'Phyllis Rintoul'; S.quote.addr = '350 Horeke Road, Okaihau';
    S.quote.psSelGrade = 'colorsteel'; S.quote.psSelThickness = '0.40';
    S.quote.psSelColour = 'Ironsand'; S.quote.psSelRoller = 'colorsteel';
    S.quote.psAddSliding = true;
    S.quote.shedPlans = [{ name:'3-Bay Shed', fields:{psSubtotal:54490.78}, photos:{}, est:{} },
                         { name:'4-Bay Shed', fields:{psSubtotal:71225.11}, photos:{}, est:{} }];
    S.quote.psPlanIdx = 0;
  };
  shed();
  res.picks = _qbPicks().map(r => r[0] + ' = ' + r[1]);
  res.email = _quoteEmailTemplate('https://x/q/tok');
  S.quote.psSelGrade = 'zincalume';
  res.picksZinc = _qbPicks().map(r => r[0] + ' = ' + r[1]);
  S.quote.psSelGrade = 'colorsteel';
  S.quote.psAddSliding = false;
  res.picksNoAddon = _qbPicks().map(r => r[0]);
  S.quote.psAddSliding = true;
  // The office can still re-word any of them, which needs the keys to be there.
  S.quote.summaryPicks = [{ k:'psgrade', label:'Cladding', value:'' },
                          { k:'psplan', label:'', value:'' }];
  res.reworded = _qbPicks().map(r => r[0] + ' = ' + r[1]);
  delete S.quote.summaryPicks;
  // The office's OWN email wording still wins over the shed default.
  S.settings = S.settings || {};
  S.settings.quote_defaults = { email: { quote_subject:'MY SUBJECT {ref}', quote_body:'MY BODY' } };
  res.officeWins = _quoteEmailTemplate('https://x/q/tok');
  S.settings.quote_defaults = {};
  // A ROOFING quote is untouched, wording and picks.
  S.quote = defaultQuote();
  S.quote.quoteKind = 'roofing'; S.quote.ref = '3290'; S.quote.client = 'Bob'; S.quote.addr = '1 Test Rd';
  S.quote.proposalOptions = { steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                              colour:'Ironsand', gutterType:'none', disposal:'remove' };
  res.roofPicks = _qbPicks().map(r => r[0] + ' = ' + r[1]);
  res.roofEmail = _quoteEmailTemplate('https://x/q/tok');
  // Settings \u2192 Email still shows the ROOFING wording as the standard, and the
  // server's copy is compared against it \u2014 so it must not have moved.
  res.standard = { subject: QUOTE_EMAIL_DEFAULT.subject, body: QUOTE_EMAIL_DEFAULT.body };
  res.emxQuote = _emxDefault('quote').subject;
  return res;
});
check('A SHED\u2019S PRICE BOX SAYS NOTHING ABOUT OLD ROOFING',
  !shedWords.picks.join(' ').toLowerCase().includes('old roofing'), JSON.stringify(shedWords.picks));
// The shed took a profile row and a gutter row on 2026-10-21, and its gutter
// comes complete: no brackets page, no downpipes decision, and still nothing
// at all about old roofing - a new shed has none to take away.
check('\u2026nor about gutter brackets or a downpipe choice \u2014 the gutter comes complete',
  !/downpipe choice|gutter brackets/i.test(shedWords.picks.join(' ')) &&
  /Guttering = 125mm Colorsteel box gutter \u2014 downpipes included/.test(shedWords.picks.join(' | ')),
  JSON.stringify(shedWords.picks));
check('it lists the SHED\u2019S own picks instead',
  shedWords.picks.join(' | ') ===
  'Plan option = 3-Bay Shed | Steel grade = Colorsteel\u00ae | Roof profile = Corrugate | '
  + 'Steel thickness = 0.40 gauge | '
  + 'Guttering = 125mm Colorsteel box gutter \u2014 downpipes included | '
  + 'Roof & wall colour = Ironsand | Roller door finish = Colorsteel\u00ae \u2014 matches the shed | '
  + 'Add sliding door = Included',
  JSON.stringify(shedWords.picks));
check('Zincalume says it is unpainted rather than leaving a blank colour',
  shedWords.picksZinc.some(r => /Roof & wall colour = Plain silver/.test(r)),
  JSON.stringify(shedWords.picksZinc));
check('an add-on they did NOT take is not listed as a choice',
  shedWords.picksNoAddon.indexOf('Add sliding door') < 0, JSON.stringify(shedWords.picksNoAddon));
check('the office can still re-word a shed\u2019s picks (the keys are there)',
  shedWords.reworded.some(r => /^Cladding = Colorsteel/.test(r)) &&
  shedWords.reworded.some(r => /^Plan option = 3-Bay Shed/.test(r)),
  JSON.stringify(shedWords.reworded));

check('THE SHED\u2019S QUOTE EMAIL SAYS POLE SHED, not roofing',
  shedWords.email.subject === 'Your pole shed quote 3287 \u2014 Flood Roofing',
  shedWords.email.subject);
check('\u2026and offers to quote a shed, not a roof',
  /opportunity to quote your new shed at 350 Horeke Road/.test(shedWords.email.body) &&
  !/your roof\b/.test(shedWords.email.body), JSON.stringify(shedWords.email.body.slice(0, 160)));
check('an office that wrote their own wording still wins',
  shedWords.officeWins.subject === 'MY SUBJECT 3287' && shedWords.officeWins.body === 'MY BODY',
  JSON.stringify(shedWords.officeWins));

check('A ROOFING QUOTE\u2019S EMAIL IS UNTOUCHED',
  shedWords.roofEmail.subject === 'Your roofing quote 3290 \u2014 Flood Roofing' &&
  /opportunity to quote your roof at 1 Test Rd/.test(shedWords.roofEmail.body),
  shedWords.roofEmail.subject);
check('\u2026and so are its picks, old roofing and all',
  shedWords.roofPicks.join(' ').includes('The old roofing = We take it away') &&
  shedWords.roofPicks.join(' ').includes('Roof profile = Corrugate'),
  JSON.stringify(shedWords.roofPicks));
check('the STANDARD wording Settings shows has not moved',
  shedWords.standard.subject === 'Your roofing quote {ref} \u2014 {company}' &&
  /quote your roof\{address\}/.test(shedWords.standard.body) &&
  shedWords.emxQuote === 'Your roofing quote {ref} \u2014 {company}',
  shedWords.emxQuote);

await ctx.close();

// ── THE SHED'S MEASURES FILL THEMSELVES IN (2026-10-13) ─────────────────
// The owner: "can you work on adding the measures of the shed into the empty
// info lines, which should change between the two plans". Width, Length,
// Height, Bays and Bay amount sat BLANK on Your Shed Details \u2014 those fields
// are only filled when the WebShed PDF names them, and job 3287's did not. The
// estimator knew all along: it PRICES the shed off W, L, the eave heights and
// the pole grid.
({ ctx, pg } = await open('Flood Roofing'));
const measures = await pg.evaluate(() => {
  const F = ['psWidth','psLength','psHeight','psBays','psBayAmount','psDoors'];
  const read = () => { const o = {}; F.forEach(f => o[f] = _psSpecGet(f)); return o; };
  const setup = () => {
    S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.gstRate = 15;
    S.quote.shedEst = { W:7.2, L:12.6, hiEave:3.48, loEave:2.9, poles:8, roller:3, pa:1, days:6 };
    S.quote.shedPlans = [
      { name:'3-Bay Shed', fields:{}, photos:{},
        est:{ W:7.2, L:12.6, hiEave:3.48, loEave:2.9, poles:8,  roller:3, pa:1, days:6 } },
      { name:'4-Bay Shed', fields:{}, photos:{},
        est:{ W:7.2, L:16.8, hiEave:3.48, loEave:2.9, poles:10, roller:4, pa:1, days:7 } }];
    S.quote.psPlanIdx = 0;
  };
  const res = {};
  setup();
  res.three = read();
  res.chips = [_psPlanSize(0), _psPlanSize(1)];
  _setPsPlan(1); res.four = read();
  _setPsPlan(0); res.back = read();
  // NOTHING was written to the quote by reading it \u2014 a render that writes is
  // how a frozen copy gets today's figures stamped onto it.
  res.stored = F.filter(f => S.quote[f] != null && String(S.quote[f]).trim());
  // A plan whose name says no count falls back to the pole grid, as before.
  S.quote.shedPlans[0].name = 'Option A';
  res.unnamedBays = _psSpecGet('psBayAmount');
  S.quote.shedPlans[0].name = '3-Bay Shed';
  // Anything the office TYPES wins over the shed's own measurements.
  S.quote.psWidth = '7.5m (as built)'; S.quote.psBayAmount = '5';
  res.typed = { w:_psSpecGet('psWidth'), b:_psSpecGet('psBayAmount') };
  delete S.quote.psWidth; delete S.quote.psBayAmount;
  // A shed with no estimator reads blank rather than an invented figure.
  S.quote.shedEst = { W:0, L:0, hiEave:0, loEave:0, poles:0, roller:0, pa:0 };
  res.noEst = { w:_psSpecGet('psWidth'), l:_psSpecGet('psLength'), h:_psSpecGet('psHeight') };
  return res;
});
check('THE MEASURES ARE NO LONGER BLANK: 7.2m \u00d7 12.6m',
  measures.three.psWidth === '7.2m' && measures.three.psLength === '12.6m',
  JSON.stringify(measures.three));
check('\u2026a mono-pitch names BOTH eave heights, not one',
  measures.three.psHeight === '3.48m \u2013 2.9m', measures.three.psHeight);
check('\u2026a plan called "3-Bay Shed" has THREE bays, at 4.2m centres',
  measures.three.psBayAmount === '3' && measures.three.psBays === '3 @ 4.2m',
  JSON.stringify([measures.three.psBayAmount, measures.three.psBays]));
check('\u2026and its doors come off the same estimator',
  measures.three.psDoors === '3x Roller Doors, 1x P.A. Door', measures.three.psDoors);
check('THE MEASURES CHANGE WITH THE PLAN: the 4-bay is 16.8m long',
  measures.four.psLength === '16.8m' && measures.four.psWidth === '7.2m',
  JSON.stringify(measures.four));
check('\u2026four bays, still at 4.2m centres',
  measures.four.psBayAmount === '4' && measures.four.psBays === '4 @ 4.2m',
  JSON.stringify([measures.four.psBayAmount, measures.four.psBays]));
check('\u2026and its own door count', measures.four.psDoors === '4x Roller Doors, 1x P.A. Door',
  measures.four.psDoors);
check('switching back brings the 3-bay\u2019s own measures back',
  JSON.stringify(measures.back) === JSON.stringify(measures.three), JSON.stringify(measures.back));
check('each option button names the shed it is',
  measures.chips[0] === '7.2m \u00d7 12.6m \u00b7 3 bays' && measures.chips[1] === '7.2m \u00d7 16.8m \u00b7 4 bays',
  JSON.stringify(measures.chips));
check('READING THEM WRITES NOTHING TO THE QUOTE', measures.stored.length === 0,
  JSON.stringify(measures.stored));
check('a plan whose name says no count still works it off the pole grid',
  measures.unnamedBays === '2', measures.unnamedBays);
check('anything the office types wins',
  measures.typed.w === '7.5m (as built)' && measures.typed.b === '5', JSON.stringify(measures.typed));
check('a shed with nothing measured reads blank, not an invented figure',
  measures.noEst.w === '' && measures.noEst.l === '' && measures.noEst.h === '',
  JSON.stringify(measures.noEst));

// ── THE SHED'S OWN PDF (2026-10-20, the owner on quote 3287: "tidy up the
// pole shed modern quote pdf, needs to look alot tidier"). The shed's sections
// are the A4's own blocks, so the modern print rules written for a re-roof met
// them for the first time in that file. Driven here against the real markup
// with the pdf layer on, because every one of these is a CSS rule reaching (or
// failing to reach) a class the renderer has to put there.
const pdfLook = await pg.evaluate(async () => {
  S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  S.quote.condPhotos = S.quote.condPhotos || [];
  // a floor plan in slot 1, nothing in slot 2, so both branches render
  // 4:1, and it has to LOAD — the drawing's printed height is its own shape,
  // which a broken 1px gif measures as zero whatever the rules say.
  S.quote.condPhotos[1] = { src: 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">' +
    '<rect width="400" height="100" fill="#09c"/></svg>') };
  delete S.quote.condPhotos[2];
  // job 3287's own shape: some measures typed, some blank
  S.quote.psWidth = ''; S.quote.psLength = ''; S.quote.psHeight = '';
  S.quote.psRoofType = 'Mono-pitch (flat)';
  const host = document.createElement('div');
  host.id = '__pdfProbe';
  // WRAPPED THE WAY _qdRender WRAPS THEM. The rules under test are written
  // `html.pdf-modern .qd-sec img.ps-draw-img` — deliberately, to out-specify
  // the catch-all photo rule — so a probe that drops the sections into a bare
  // <div> is testing nothing: every one of these pins passed on the build
  // that shipped the fault.
  host.innerHTML = _psModernSections().map(x =>
    '<section class="qd-sec qd-sec-' + x.key + '" data-qd-sec="' + x.key + '">' +
    x.html() + '</section>').join('');
  document.body.appendChild(host);
  await Promise.all([...host.querySelectorAll('img')].map(i => new Promise(r => {
    if (i.complete && i.naturalWidth) return r(); i.onload = r; i.onerror = r; })));
  const on = () => document.documentElement.classList.add('pdf-modern');
  const off = () => document.documentElement.classList.remove('pdf-modern');
  const vis = (sel) => { const e = host.querySelector(sel);
    return e ? getComputedStyle(e).display !== 'none' : null; };
  const out = {};
  off();
  out.screen = {
    emptySpec: vis('.ps-spec-empty'), office: vis('.ps-office'),
    aoTools: vis('.ps-ao-tools'), drawTools: vis('.ps-draw-tools'),
    accept: vis('.qb-sign'), aoHit: vis('.ps-ao-hit'),
  };
  on();
  const img = host.querySelector('.ps-draw-img');
  const col = host.querySelector('.ps-draws');
  const wrp = host.querySelector('.ps-draw-wrap');
  out.pdf = {
    emptySpec: vis('.ps-spec-empty'), office: vis('.ps-office'),
    aoTools: vis('.ps-ao-tools'), drawTools: vis('.ps-draw-tools'),
    accept: vis('.qb-sign'), aoHit: vis('.ps-ao-hit'),
    drawHole: vis('.ps-draw-hole'), planSwitch: vis('.ps-cswitch-wrap'),
    fit: img ? getComputedStyle(img).objectFit : null,
    imgCap: img ? getComputedStyle(img).maxHeight : null,
    imgW: img ? Math.round(img.getBoundingClientRect().width) : null,
    imgH: img ? Math.round(img.getBoundingClientRect().height) : null,
    imgNat: img ? (img.naturalWidth + 'x' + img.naturalHeight) : null,
    cardW: col ? Math.round(col.getBoundingClientRect().width) : null,
    wrapW: wrp ? Math.round(wrp.getBoundingClientRect().width) : null,
  };
  out.keptSpec = [...host.querySelectorAll('.ps-spec-row:not(.ps-spec-empty) .ps-spec-val')]
    .map(e => e.textContent.trim()).filter(Boolean).length;
  out.emptyCount = host.querySelectorAll('.ps-spec-empty').length;
  off(); host.remove();
  return out;
});
check('the shed’s floor plan prints WHOLE — a plan is read, not cropped',
  pdfLook.pdf.fit === 'contain' && pdfLook.pdf.imgCap === '660px',
  JSON.stringify({ fit: pdfLook.pdf.fit, cap: pdfLook.pdf.imgCap }));
// A BOX IS NOT A SHAPE (2026-10-20, the owner on the first attempt at this:
// "ratio is all distorted"). `contain` alone letterboxes a drawing inside
// whatever box it is given, and the box was a fixed band — so the plan printed
// small, with white down both sides and a white strip beneath it. The height
// has to follow the drawing's own shape, and the 80mm catch-all photo cap must
// not be what decides it.
check('…and it takes the height ITS OWN SHAPE asks for, not a band’s',
  pdfLook.pdf.imgNat === '400x100' && pdfLook.pdf.imgH > 0 &&
  Math.abs((pdfLook.pdf.imgW / pdfLook.pdf.imgH) - 4) < 0.08 &&
  pdfLook.pdf.imgCap !== '80mm',
  JSON.stringify(pdfLook.pdf));
check('…and it is not shrunk into a corner of the card either',
  pdfLook.pdf.cardW > 100 && pdfLook.pdf.imgW >= Math.min(400, pdfLook.pdf.cardW) - 2,
  JSON.stringify({ img: pdfLook.pdf.imgW, card: pdfLook.pdf.cardW }));
check('…and the frame hugs the drawing rather than standing a box around it',
  pdfLook.pdf.wrapW > 0 && Math.abs(pdfLook.pdf.wrapW - pdfLook.pdf.imgW) <= 4 &&
  pdfLook.pdf.wrapW < pdfLook.pdf.cardW,
  JSON.stringify({ wrap: pdfLook.pdf.wrapW, img: pdfLook.pdf.imgW, card: pdfLook.pdf.cardW }));
check('a spec row nobody filled in is not printed, and the filled ones are',
  pdfLook.pdf.emptySpec === false && pdfLook.emptyCount >= 1 && pdfLook.keptSpec >= 1,
  JSON.stringify({ hidden: pdfLook.pdf.emptySpec, blank: pdfLook.emptyCount, kept: pdfLook.keptSpec }));
check('…but the office still sees it on screen, to type into',
  pdfLook.screen.emptySpec === true, String(pdfLook.screen.emptySpec));
// THE OFFICE'S OWN FURNITURE STAYS OFF PAPER (2026-10-20, the rebuild). The
// modern shed carries controls the A4 never had — "office only" wording boxes,
// a pencil per add-on, drawing tools — and .no-print only fires under @media
// print, which an html2canvas capture is NOT. They are named in the pdf layer.
check('the acceptance form, the office\'s own boxes and every tool stay off paper',
  pdfLook.pdf.accept === false && pdfLook.pdf.office === false &&
  pdfLook.pdf.aoTools === false && pdfLook.pdf.drawTools === false &&
  pdfLook.pdf.drawHole !== true,
  JSON.stringify(pdfLook.pdf));
// …but the add-on row's hit area IS a button, and it carries the add-on's name
// and its price. The blanket "hide every button" rule would print it empty.
check('…while the add-on rows still print what they say',
  pdfLook.pdf.aoHit === true, String(pdfLook.pdf.aoHit));
check('…and the orphan "Choose your plan" heading goes with its buttons',
  pdfLook.pdf.planSwitch !== true, String(pdfLook.pdf.planSwitch));
check('on screen the office keeps every one of them — all of this is print-only',
  pdfLook.screen.emptySpec === true && pdfLook.screen.office === true &&
  pdfLook.screen.aoTools === true && pdfLook.screen.drawTools === true &&
  pdfLook.screen.accept === true && pdfLook.screen.aoHit === true,
  JSON.stringify(pdfLook.screen));
// A CHAPTER BAND BLEEDS ABOVE ITS OWN SECTION, and a cut measured from the
// section's top edge therefore lands INSIDE the band — a navy sliver with its
// cyan rule stranded at the foot of three sheets out of four. Driven, not
// grepped: the pin this replaced asserted the literal `push(out.sec, el, 8)`
// and failed on the refactor that fixed the bug it was guarding.
const brk = await pg.evaluate(() => {
  const t = document.createElement('div');
  t.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:600px');
  t.innerHTML =
    '<div style="height:200px"></div>' +
    '<section data-qd-sec="x" style="height:300px;border:1px solid #ccc">' +
      '<div class="ed-heading-band" style="margin-top:-23px;height:40px"></div>' +
    '</section>';
  document.body.appendChild(t);
  const sec = t.querySelector('[data-qd-sec]'), band = t.querySelector('.ed-heading-band');
  const tr = t.getBoundingClientRect();
  const out = _pdfBreakRows(t, 1);
  const r = { sec: out.sec.slice(), row: out.row.slice(),
              secTop: Math.round(sec.getBoundingClientRect().top - tr.top),
              bandTop: Math.round(band.getBoundingClientRect().top - tr.top) };
  t.remove();
  return r;
});
check('a chapter band that bleeds above its section does not get sliced',
  brk.bandTop < brk.secTop && brk.sec.length === 1 && brk.sec[0] <= brk.bandTop,
  JSON.stringify(brk));
check('…and the cut does not climb into the card above it either',
  brk.sec[0] >= brk.bandTop - 4, JSON.stringify(brk));
check('a spec row is a place a sheet may end',
  await pg.evaluate(() => /\.ps-spec-row/.test(String(_pdfBreakRows))), 'row selectors');

// HTML2CANVAS DOES NOT HONOUR object-fit (2026-10-20, the owner: "ratio is all
// distorted" — and a circle on a test render came out an ellipse). That is why
// _inlineCoverImagesForPdf bakes the crop in. But it SKIPPED a data: src as
// "already inline", and every picture that matters is a data URL: the WebShed
// plans, the cover render, every condition photo. So the one class of image it
// was written to rescue was the one class it never touched.
const bake = await pg.evaluate(async () => {
  const src = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">' +
    '<rect width="400" height="100" fill="#09c"/></svg>');
  const host = document.createElement('div');
  host.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:300px;background:#0a1628');
  host.innerHTML = '<img id="__bk" src="' + src + '" ' +
    'style="width:300px;height:300px;object-fit:cover;display:block">';
  document.body.appendChild(host);
  const img = host.querySelector('#__bk');
  await new Promise(r => { if (img.complete && img.naturalWidth) return r();
    img.onload = r; img.onerror = r; });
  const before = img.getAttribute('src');
  const undo = _inlineCoverImagesForPdf(host, 2);
  const after = img.getAttribute('src');
  const fit = img.style.getPropertyValue('object-fit');
  const prio = img.style.getPropertyPriority('object-fit');
  undo();
  const back = img.getAttribute('src') === before;
  host.remove();
  return { changed: after !== before, jpeg: /^data:image\/jpe?g/.test(after || ''),
           fit: fit, prio: prio, restored: back };
});
check('a data-URL picture has its crop baked in for the capture',
  bake.changed && bake.jpeg, JSON.stringify(bake));
check('…marked !important, or the print rules fit it a second time',
  bake.fit === 'fill' && bake.prio === 'important', JSON.stringify(bake));
check('…and it is put back exactly as it was afterwards',
  bake.restored, JSON.stringify(bake));

// A COVER IS A PAGE, NOT A PARAGRAPH (the same message: "cover page is nearly
// all empty"). The band grows until the next chapter starts at the foot of
// sheet one — and a sheet millimetre here is 5.24 CSS px, not the 3.78 a CSS
// `mm` means, which is what made the first attempt's "104mm" band 75mm of paper.
const cov = await pg.evaluate(() => {
  const was = S.quote.quoteKind;
  S.quote.quoteKind = 'poleshed';
  const host = document.createElement('div');
  host.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:1100px');
  host.innerHTML =
    '<section data-qd-sec="cover" style="border:1px solid #ccc">' +
      '<figure data-cp-hero="1" style="margin:0;height:330px"></figure>' +
      '<div style="height:400px"></div>' +
    '</section>' +
    '<section data-qd-sec="psplans" style="height:900px;border:1px solid #ccc"></section>';
  document.body.appendChild(host);
  const root = host;
  const hero = host.querySelector('figure[data-cp-hero]');
  const next = host.querySelector('[data-qd-sec="psplans"]');
  const top = () => Math.round(next.getBoundingClientRect().top - host.getBoundingClientRect().top);
  const before = top();
  const undo = _psPdfFitCover(root);
  const after = top(), grown = Math.round(hero.getBoundingClientRect().height);
  undo();
  const backTo = Math.round(hero.getBoundingClientRect().height);
  S.quote.quoteKind = 'roofing';
  const onRoof = _psPdfFitCover(root);
  const roofTop = top();
  onRoof();
  host.remove(); S.quote.quoteKind = was;
  return { before, after, grown, backTo, roofTop, sheet: QP_PDF_SHEET_PX,
           perMm: +QP_PDF_PX_PER_MM.toFixed(3) };
});
check('a sheet millimetre is worked out from the capture, not from a CSS mm',
  cov.sheet === 1508 && Math.abs(cov.perMm - 5.238) < 0.01, JSON.stringify(cov));
check('THE ASK: the shed’s cover band grows until the cover fills its sheet',
  cov.before < cov.sheet * 0.65 && cov.after > cov.sheet * 0.85 && cov.after <= cov.sheet,
  JSON.stringify(cov));
check('…the band is put back the moment the capture is over',
  cov.backTo === 330, JSON.stringify(cov));
check('…and a roofing quote’s cover is not touched at all',
  cov.roofTop === cov.before, JSON.stringify(cov));

// ── THE SHED'S PROFILE AND ITS GUTTER (2026-10-21, the owner: "add the
// profile selection and gutter selection for the pole shed like the roofing
// quote has, however the pole shed only option should be 125mm box gutter
// with downpipe compulsory with gutter selected").
//
// THE COMPATIBILITY STORY IS PINNED FIRST, because it is the whole of the
// risk: a company that has not priced its profiles must read exactly as it
// did, and the gutter is already IN the shed's price, so only declining it
// is money.
({ ctx, pg } = await open('Flood Roofing'));
const pgut = await pg.evaluate(async () => {
  const R = {};
  const setup = () => {
    S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.gstRate = 15;
    S.quote.style = 'modern'; S.quote.psSubtotal = 64585;
    S.quote.shedEst = { W:7.2, L:12.6, hiEave:3.48, loEave:2.9, poles:8, roller:3, pa:1, days:6 };
  };
  setup();
  R.keys = _psModernSections().map(x => x.key);
  // Nothing priced: every profile reads the same, so no shed quoted before
  // today moves by a cent.
  R.unpricedDeltas = (_selProfiles() || []).map(p => _psProfileDelta(p.id));
  R.unpricedSnap = _psProfileDeltasSnapshot();
  R.unpricedItems = _poleShedSelItems().map(i => i.label);
  const total0 = _custBarTotalValue();
  // Now the office prices two profiles.
  const sel = _selectables();
  (sel.profiles || []).forEach((p, i) => { p.rate = (i === 0 ? 18 : 24); p.rateUnit = 'm2'; });
  S.quote.psBaseProfile = (sel.profiles[0] || {}).id;
  R.area = Math.round((_psCladArea() || {}).m2 || 0);
  R.baseDelta = _psProfileDelta(sel.profiles[0].id);
  R.otherDelta = Math.round(_psProfileDelta(sel.profiles[1].id) * 100) / 100;
  R.costGap = Math.round((_psProfileCost(sel.profiles[1].id) - _psProfileCost(sel.profiles[0].id)) * 100) / 100;
  // The gutter: in the price, so it reads Included and declining it credits
  // what the take-off actually charged for that line.
  R.gutterDefault = _psGutterPicked();
  R.allow = _psGutterAllowance();
  // Settle the base FIRST: _setPsSel re-renders and the render re-derives the
  // shed's price from the drawer, so a baseline read before any render is a
  // different base and the comparison would span the change, not the gutter.
  _setPsGutter('box125');
  const totalGut = _custBarTotalValue();
  _setPsGutter('none');
  R.noGutItems = _poleShedSelItems().map(i => i.label + ' ' + i.delta.toFixed(2));
  R.dropped = Math.round((totalGut - _custBarTotalValue()) * 100) / 100;
  R.inclAllow = Math.round(_qbIncl(R.allow) * 100) / 100;
  _setPsGutter('box125');
  R.backToGut = Math.round((_custBarTotalValue() - totalGut) * 100) / 100;
  // A gauge the profile forces is the profile's decision, counted once.
  R.lock = _psProfileLock('5rib');
  _setPsProfile('5rib');
  R.thickAfter = S.quote.psSelThickness;
  R.thickTxt = _psmThickness().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  R.lockItems = _poleShedSelItems().map(i => i.label + ' ' + i.delta.toFixed(2));
  // Frozen for the customer, who has no price book and no estimator.
  const snap = _psProfileDeltasSnapshot();
  S.quote.psProfileDeltas = snap; S.quote.psGutterAllow = R.allow;
  window.__CUSTOMER_MODE = true;
  (sel.profiles || []).forEach(p => { delete p.rate; });
  R.frozenProfile = Math.round(_psProfileDelta(sel.profiles[1].id) * 100) / 100;
  S.quote.shedEst = null;
  R.frozenAllow = _psGutterAllowance();
  window.__CUSTOMER_MODE = false;
  R.total0 = total0;
  return R;
});
check('THE ASK: the shed quote carries its own profile and gutter sections',
  pgut.keys.indexOf('psprofile') > pgut.keys.indexOf('psgrade') &&
  pgut.keys.indexOf('psgutter') > pgut.keys.indexOf('psprofile') &&
  pgut.keys.indexOf('psgutter') < pgut.keys.indexOf('psroller'),
  pgut.keys.join(','));
check('…a company that has not priced its profiles reads exactly as it did',
  pgut.unpricedDeltas.every(d => d === 0) && pgut.unpricedSnap === null &&
  pgut.unpricedItems.length === 0,
  JSON.stringify({ d: pgut.unpricedDeltas, s: pgut.unpricedSnap, i: pgut.unpricedItems }));
check('…the profile difference is the real cost of cladding THIS shed',
  pgut.area > 0 && pgut.baseDelta === 0 &&
  Math.abs(pgut.otherDelta - pgut.costGap) < 0.01 && pgut.otherDelta > 0,
  JSON.stringify({ a: pgut.area, b: pgut.baseDelta, o: pgut.otherDelta, g: pgut.costGap }));
check('THE ASK: 125mm box gutter is the pick, and the downpipes come with it',
  pgut.gutterDefault === 'box125' && !/downpipe/i.test(pgut.keys.join(',')),
  pgut.gutterDefault);
check('…guttering is IN the price, so only declining it is money',
  pgut.allow > 0 && pgut.noGutItems.length === 1 &&
  /No guttering/.test(pgut.noGutItems[0]) &&
  Math.abs(pgut.dropped - pgut.inclAllow) < 0.02,
  JSON.stringify({ a: pgut.allow, i: pgut.noGutItems, d: pgut.dropped, x: pgut.inclAllow }));
check('…and taking it back puts the same figure back',
  Math.abs(pgut.backToGut) < 0.01, String(pgut.backToGut));
check('a profile rolled in one gauge DECIDES the gauge, and says so',
  pgut.lock === '0.55' && pgut.thickAfter === '0.55' &&
  /Locked for/.test(pgut.thickTxt) && /nothing to choose/.test(pgut.thickTxt),
  JSON.stringify({ l: pgut.lock, t: pgut.thickAfter }));
check('…and that gauge is charged once, on the thickness row',
  pgut.lockItems.filter(x => /gauge/.test(x)).length === 1,
  pgut.lockItems.join(' | '));
check('the customer reads the FROZEN figures — no price book, no estimator',
  pgut.frozenProfile === pgut.otherDelta && pgut.frozenAllow === pgut.allow,
  JSON.stringify({ p: pgut.frozenProfile, o: pgut.otherDelta, a: pgut.frozenAllow }));

await ctx.close();

// ── THE MODERN SHED IS EDITABLE LIKE THE MODERN ROOFING QUOTE (2026-10-25,
// the owner: "make the pole shed modern quote fully editable like the roofing
// modern quote ... edit the profiles and gutter ... edit the name and price of
// the add-on ... delete section and add a custom section ... every section
// description is editable. Also fix the first page, the info and Cover photo
// don't stretch the full width").
({ ctx, pg } = await open('Flood Roofing LTD'));
await pg.setViewportSize({ width: 2400, height: 1000 });
const ed = await pg.evaluate(() => {
  const out = {};
  S.quote = defaultQuote(); S.quote.quoteKind = 'poleshed'; S.quote.style = 'modern';
  S.quote.gstRate = 15; S.quote.psSubtotal = 50000; S.quote.psSubtotalManual = true;
  S.quote.client = 'Phyllis Smith'; S.quote.psWidth = '7.2m'; S.quote.psLength = '12.6m';
  const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
  c.getContext('2d').fillRect(0, 0, 1600, 900);
  _qpCondPhotoSet(PS_HERO_SLOT, { src: c.toDataURL('image/jpeg', 0.6) });
  try { _closePricingPanel(); } catch(e){}
  _setQuotePreviewMode('desk'); refreshQuoteProposal();
  const w = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : -1; };
  out.cover = { sec: w('#qd-cover'), hero: w('#qd-cover .qb-hero'), body: w('#qd-cover .qd-cover-body'),
                intro: w('#qd-cover .ps-intro'), meta: w('#qd-cover .qb-meta') };
  const intro = document.querySelector('#qd-cover .ps-intro');
  out.introEditable = !!intro && intro.getAttribute('contenteditable') === 'true' && intro.dataset.qfield === 'psIntro';
  out.introDupBox = /opening words/i.test(document.getElementById('qd-cover').textContent);
  // The heading writes the shed's own field, and a click in and out writes nothing.
  const h1 = document.querySelector('#qd-cover .qb-hero-txt h1');
  h1.dispatchEvent(new Event('focus')); h1.dispatchEvent(new Event('blur'));
  out.untouched = S.quote.psSubtitle;
  const h1b = document.querySelector('#qd-cover .qb-hero-txt h1');
  h1b.dispatchEvent(new Event('focus')); h1b.innerText = 'Smith Hay Barn'; h1b.dispatchEvent(new Event('blur'));
  out.heading = { ps: S.quote.psSubtitle, cover: S.quote.coverTitle || null,
                  shown: document.querySelector('#qd-cover .qb-hero-txt h1').textContent };
  // Every section but the cover and the custom options carries a description
  // the office can click into.
  const secs = Array.from(document.querySelectorAll('#qpRoot .qd-sec[data-qd-sec]'));
  out.noDesc = secs.filter(e => !/^(cover|extra\d+)$/.test(e.dataset.qdSec) && !e.querySelector('[data-qe-sec]')).map(e => e.dataset.qdSec);
  out.descBound = secs.filter(e => e.querySelector('[data-qe-sec].qe-edit')).length;
  // Edit / Delete on every section the office can change.
  const has = (k, sel) => !!document.querySelector('#qd-' + k + ' ' + sel);
  out.editBtns = ['psgrade','psthickness','psgutter','psroller'].filter(k => has(k, '[data-ps-sec-edit]'));
  out.profileBtn = has('psprofile', '[data-qe-btn="profile"]');
  out.delBtns = ['psplans','psdetails','psgrade','psprofile','psthickness','pscolour','psgutter','psroller','psaddons','psincluded'].filter(k => has(k, '.qb-sec-del'));
  out.planDel = has('cover', '.qb-sec-del') || has('review', '.qb-sec-del');
  out.aoEditWord = (document.querySelector('#qd-psaddons .ps-ao-tool-ed') || {}).textContent || '';
  return out;
});
check('THE ASK: the cover photo runs the full width of its section on a wide screen',
  ed.cover.sec > 800 && Math.abs(ed.cover.hero - ed.cover.sec) <= 2, JSON.stringify(ed.cover));
check('…and so does the information under it — one column, the facts a grid below',
  ed.cover.intro >= ed.cover.body - 70 && ed.cover.meta >= ed.cover.body - 70, JSON.stringify(ed.cover));
check('the opening letter is edited where it is read, with no second copy in an office box',
  ed.introEditable && !ed.introDupBox, JSON.stringify({ e: ed.introEditable, dup: ed.introDupBox }));
check('the cover heading writes the shed’s own heading, and a click in and out writes nothing',
  ed.untouched === undefined && ed.heading.ps === 'Smith Hay Barn' && !ed.heading.cover && /Smith Hay Barn/.test(ed.heading.shown),
  JSON.stringify({ u: ed.untouched, h: ed.heading }));
check('THE ASK: every section’s description is editable', ed.noDesc.length === 0 && ed.descBound >= 10,
  JSON.stringify({ missing: ed.noDesc, bound: ed.descBound }));
check('every option section has Edit this section; the profiles use the roofing quote’s own editor',
  ed.editBtns.length === 4 && ed.profileBtn, JSON.stringify(ed.editBtns));
check('THE ASK: every section but the cover and the total can be deleted from the quote',
  ed.delBtns.length === 10 && !ed.planDel, JSON.stringify(ed.delBtns));
check('an add-on says Edit on its button', /Edit/.test(ed.aoEditWord), ed.aoEditWord);

const ch = await pg.evaluate(() => {
  const out = {};
  const sub = () => +_poleShedMoney().sub.toFixed(2);
  out.base = sub();
  // Opening and saving without a change keeps nothing.
  _psChoiceOpen('psgrade');
  out.prefill = Array.from(document.querySelectorAll('#qcoModal .ps-ch-l')).map(e => e.value);
  _psChoiceApply('psgrade');
  out.noEdit = S.quote.psChoiceEdit === undefined;
  // Rename, reword and re-price Zincalume, and retitle the section.
  _psChoiceOpen('psgrade');
  const row = document.querySelector('#qcoModal .ps-ch-row[data-ps-ch="zincalume"]');
  row.querySelector('.ps-ch-l').value = 'Zincalume (plain)';
  row.querySelector('.ps-ch-d').value = 'Bare steel.';
  row.querySelector('.ps-ch-p').value = '-2000';
  document.getElementById('psChTitle').value = 'Steel finish';
  _psChoiceApply('psgrade');
  out.stored = JSON.stringify(S.quote.psChoiceEdit);
  _setPsGrade('zincalume');
  out.sub = sub();
  out.items = _poleShedSelItems().map(r => r.label + '|' + r.delta);
  out.card = (document.querySelector('#qd-psgrade [data-qb-val="zincalume"]') || {}).textContent || '';
  out.title = (document.querySelector('#qd-psgrade .qb-h2') || {}).textContent || '';
  out.picks = _psPicksAuto().map(r => r[0] + '=' + r[1]).join('; ');
  // The classic A4 prices it the same.
  S.quote.style = 'classic'; refreshQuoteProposal();
  const _ct = document.getElementById('qpRoot').textContent.replace(/\s+/g, ' ');
  out.classic = /Zincalume\u00ae Unpainted Al\/Zn \u2014 lowest cost\u2212\$2,000\.00/.test(_ct) && !/\u2212\$1,850\.00/.test(_ct);
  out.classicTxt = (_ct.match(/.{0,60}(2,000|1,850).{0,40}/g) || []).join(' || ') || _ct.slice(_ct.indexOf('Zinc') - 40, _ct.indexOf('Zinc') + 120);
  S.quote.style = 'modern'; refreshQuoteProposal();
  // The "Available as options" line follows the edited price, on both layouts (2026-10-25).
  out.optClassic = /Zincalume to save \$2,000 \+ GST/.test(_ct) && !/save \$1,850/.test(_ct);
  const _mt = document.getElementById('qpRoot').textContent.replace(/\s+/g, ' ');
  out.optModern = /Zincalume to save \$2,000 \+ GST/.test(_mt) && !/save \$1,850/.test(_mt);
  out.optTxt = (_mt.match(/.{0,30}Zincalume to save.{0,20}/) || [''])[0];
  // A line the office wrote with two figures in it is theirs and is left alone.
  S.quote.psOptions = 'Zincalume saves $1,850 on the roof and $400 on the walls.\nExtra concrete at $100 + GST per m\u00b2.';
  out.optOwn = _psGet('psOptions');
  delete S.quote.psOptions;
  // Every layout reads it: the computer preview, the phone book's own page, and the customer.
  const _zin = () => /Zincalume to save \$2,000 \+ GST/.test(document.getElementById('qpRoot').textContent.replace(/\s+/g, ' '));
  _setQuotePreviewMode('desk'); refreshQuoteProposal(); out.optDesk = _zin();
  _setQuotePreviewMode('phone'); QB.i = _qbPages().findIndex(p => p.key === 'psincluded'); refreshQuoteProposal();
  out.optPhone = QB.i >= 0 && _zin();
  window.__CUSTOMER_MODE = true; refreshQuoteProposal(); out.optCust = _zin(); window.__CUSTOMER_MODE = false;
  QB.i = 0; _setQuotePreviewMode('desk'); refreshQuoteProposal();
  // Stop offering it while it is the pick: back to the standard.
  _psChoiceOpen('psgrade');
  document.querySelector('#qcoModal .ps-ch-row[data-ps-ch="zincalume"] .ps-ch-on').checked = false;
  _psChoiceApply('psgrade');
  out.afterHide = { pick: S.quote.psSelGrade, sub: sub(),
    rows: Array.from(document.querySelectorAll('#qd-psgrade [data-qb-val]')).map(e => e.dataset.qbVal) };
  // Back to the standard.
  _psChoiceOpen('psgrade'); _psChoiceReset('psgrade');
  out.reset = S.quote.psChoiceEdit === undefined;
  out.optReset = /Zincalume to save \$1,850 \+ GST/.test(_psGet('psOptions'));
  // The thickness price reaches the total, and the gutter credit can be set.
  _psChoiceOpen('psthickness');
  document.querySelector('#qcoModal .ps-ch-row[data-ps-ch="0.55"] .ps-ch-p').value = '999';
  _psChoiceApply('psthickness'); _setPsThickness('0.55');
  out.thick = sub() - out.base;
  out.opt055 = (_psGet('psOptions').match(/.*0\.55g.*/) || [''])[0];
  _setPsThickness('0.40');
  _psChoiceOpen('psgutter');
  document.querySelector('#qcoModal .ps-ch-row[data-ps-ch="none"] .ps-ch-p').value = '-750';
  _psChoiceApply('psgutter'); _setPsGutter('none');
  out.gut = sub() - out.base;
  _setPsGutter('box125');
  // An accepted quote cannot be edited.
  S.quote.accepted = { name:'P', at:new Date().toISOString() };
  _psChoiceOpen('psroller');
  out.acceptedOpened = !!document.getElementById('qcoModal');
  try { _qcoClose(); } catch(e){}
  delete S.quote.accepted;
  return out;
});
check('THE ASK: the "Available as options" Zincalume line follows the edited price, modern and classic',
  ch.optModern && ch.optClassic, ch.optTxt);
check('…on the computer preview, the phone book\'s page and the customer\'s own view alike',
  ch.optDesk && ch.optPhone && ch.optCust, JSON.stringify({ desk: ch.optDesk, phone: ch.optPhone, cust: ch.optCust }));
check('…the 0.55 gauge line follows its price too', /add \$999 \+ GST/.test(ch.opt055), ch.opt055);
check('…back to the standard price, the line reads $1,850 again', ch.optReset);
check('…and a line the office wrote with two figures in it is left as written',
  /\$1,850 on the roof and \$400/.test(ch.optOwn) && /Extra concrete at \$100/.test(ch.optOwn), ch.optOwn);
check('the section editor opens on what the quote says now, and a save with no change keeps nothing',
  ch.prefill[0] === 'Colorsteel®' && ch.noEdit, JSON.stringify(ch.prefill));
check('THE ASK: a choice can be renamed, reworded and re-priced for this quote',
  ch.sub === ch.base - 2000 && ch.items.join(' ').indexOf('Zincalume (plain)|-2000') >= 0, JSON.stringify({ s: ch.sub, i: ch.items, st: ch.stored }));
check('…the card reads it (GST-inclusive, like every card) and the heading is the office’s',
  /Zincalume \(plain\)/.test(ch.card) && /Bare steel/.test(ch.card) && /2,300\.00/.test(ch.card) && /Steel finish/.test(ch.title),
  ch.card.replace(/\s+/g, ' ').slice(0, 120) + ' / ' + ch.title);
check('…the summary’s choices name it', /Steel grade=Zincalume \(plain\)/.test(ch.picks), ch.picks);
check('…and the classic A4 prices it the same, from the same helper', ch.classic, ch.classicTxt);
check('a choice no longer offered stops being the pick, and its price goes with it',
  ch.afterHide.pick === 'colorsteel' && ch.afterHide.sub === ch.base && ch.afterHide.rows.join() === 'colorsteel',
  JSON.stringify(ch.afterHide));
check('Back to the standard puts the section back as it was', ch.reset);
check('the thickness and the gutter take their own prices', Math.abs(ch.thick - 999) < 0.01 && Math.abs(ch.gut + 750) < 0.01,
  JSON.stringify({ t: ch.thick, g: ch.gut }));
check('an accepted quote’s sections are not editable', ch.acceptedOpened === false);

const del = await pg.evaluate(() => {
  const out = {};
  const sub = () => +_poleShedMoney().sub.toFixed(2);
  const base = sub();
  _setPsGrade('zincalume');
  _qbSectionRemove('psgrade');
  out.grade = { pick: S.quote.psSelGrade, sub: sub() - base, keys: _qdSections().map(x => x.key).join(),
                insert: !!Array.from(document.querySelectorAll('#qpRoot .qe-insert')).find(b => /Steel grade/.test(b.textContent)),
                book: _qbPages().map(x => x.key).join() };
  _qbSectionInsert('psgrade');
  out.back = _qdSections().map(x => x.key).indexOf('psgrade') >= 0;
  // The add-ons: one ticked, the page taken out, the price follows the page.
  _psAddonToggle('slidingDoor');
  const withDoor = sub();
  _qbSectionRemove('psaddons');
  out.addons = { gone: withDoor - sub(), picks: _psPicksAuto().some(r => /sliding/i.test(r[0])) };
  _qbSectionInsert('psaddons');
  out.addonsBack = sub() === withDoor;
  _psAddonToggle('slidingDoor');
  return out;
});
check('THE ASK: a section can be deleted, and the shed goes back to its standard choice',
  del.grade.pick === 'colorsteel' && del.grade.sub === 0 && del.grade.keys.indexOf('psgrade') < 0 && del.grade.insert,
  JSON.stringify(del.grade));
check('…the phone takes the same arrangement', del.grade.book.indexOf('psgrade') < 0, del.grade.book);
check('…and Insert puts it back', del.back);
check('an add-on on a page that was taken out is not charged, and comes back with the page',
  Math.abs(del.addons.gone - 3850) < 0.01 && !del.addons.picks && del.addonsBack, JSON.stringify(del.addons));

const cx = await pg.evaluate(() => {
  const out = {};
  const sub = () => +_poleShedMoney().sub.toFixed(2);
  const base = sub();
  // A re-roof product from Settings is not offered on a shed.
  S.settings.selectables = S.settings.selectables || {};
  S.settings.selectables.extras = [{ id:'paint', title:'Paint Roof', rows:[{ id:'no', name:'No', price:0 }, { id:'yes', name:'Yes', price:900 }] }];
  refreshQuoteProposal();
  out.paint = /Paint Roof/.test(document.getElementById('qpRoot').textContent);
  out.insertBtn = !!document.querySelector('#qpRoot .qco-insert');
  // A custom section of the office's own.
  _qcoEdit(null);
  document.getElementById('qcoTitle').value = 'Concrete pad';
  _qcoReadRows();
  const host = document.getElementById('qcoModal');
  host._rows = [{ id:'r1', name:'No pad', desc:'', price:0 }, { id:'r2', name:'Concrete pad', desc:'Laid before the build', price:3200 }];
  host._rec = 'r1'; _qcoPaintRows();
  _qcoApply();
  const keys = _qdSections().map(x => x.key);
  out.key = keys.filter(k => /^extra\d+$/.test(k))[0] || '';
  out.at = keys.indexOf(out.key) < keys.indexOf('psaddons');
  out.shown = /Concrete pad/.test((document.getElementById('qd-' + out.key) || {}).textContent || '');
  const g = _selExtras().filter(x => x.title === 'Concrete pad')[0];
  _setProposalOption_extra(g.id, 'r2');
  out.sub = sub() - base;
  out.picks = _psPicksAuto().map(r => r[0] + '=' + r[1]).join('; ');
  out.rows = _custBarRows().map(r => r.label).join(' | ');
  // Taken off again.
  window.confirm = () => true; _qcoDelete(g.id);
  out.after = sub() - base;
  return out;
});
check('a Settings option made for re-roofs (Paint Roof) is not offered on a shed', !cx.paint);
check('THE ASK: + Insert custom option is on the shed', cx.insertBtn);
check('…the custom section lands above the add-ons and shows its choices', !!cx.key && cx.at && cx.shown, JSON.stringify(cx));
check('…its price reaches the shed’s total, the summary and the choices',
  Math.abs(cx.sub - 3200) < 0.01 && /Concrete pad=Concrete pad/.test(cx.picks) && /Concrete pad/.test(cx.rows),
  JSON.stringify({ s: cx.sub, p: cx.picks, r: cx.rows }));
check('…and deleting it takes the price with it', Math.abs(cx.after) < 0.01, String(cx.after));

const cust = await pg.evaluate(() => {
  window.__CUSTOMER_MODE = true; refreshQuoteProposal();
  const r = document.getElementById('qpRoot');
  const out = { edit: !!r.querySelector('[data-ps-sec-edit], .qb-sec-del, .ps-ao-tools, .qco-insert, .qe-inline'),
                introEditable: !!r.querySelector('.ps-intro[contenteditable]') };
  window.__CUSTOMER_MODE = false; refreshQuoteProposal();
  return out;
});
check('the customer sees none of it — no Edit, no Delete, nothing to type into',
  !cust.edit && !cust.introEditable, JSON.stringify(cust));
await ctx.close();

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
