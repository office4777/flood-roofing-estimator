// OPTION NOTES AND THE RECOMMENDED WORDING (the owner, 2026-11-04):
//   "allow me to type in a custom note, just like the 'Recommended for your
//    roof' on every different option in every section / custom options /
//    custom extras ... a little 'add note' which pops up a text input box with
//    a note colour selection (green/yellow/red) to explain why an option isn't
//    the best option, also allow me to edit the wording on the default green
//    recommended wording"
// Pinned on the office's screen (the link, the window, the pill, the colour,
// the wording) and on the customer's (the note and the wording reach them,
// none of the office's links do).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

// ── the office ───────────────────────────────────────────────────
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);


await pg.evaluate(() => { const m = document.getElementById('_rsModal'); if (m) { try { m._rsClose(); } catch(e){ m.remove(); } } refreshQuoteProposal(); });
await pg.waitForTimeout(300);
// ── every option row offers "+ Add note" ──
let v = await pg.evaluate(() => {
  const rows = [...document.querySelectorAll('#qpRoot .qb-opt')];
  const groups = {};
  document.querySelectorAll('#qpRoot [data-onote-add]').forEach(e => { const g = e.getAttribute('data-onote-add').split(':')[0]; groups[g] = (groups[g] || 0) + 1; });
  return { rows: rows.length, links: document.querySelectorAll('#qpRoot [data-onote-add]').length, groups,
           rec: (document.querySelector('#qpRoot .qb-rec') || {}).textContent, recEd: document.querySelectorAll('#qpRoot .qb-rec-ed').length };
});
check('every option row in the quote offers "+ Add note"', v.links >= 8 && v.groups.steelGrade >= 2 && v.groups.profile >= 2 && v.groups.steelThickness >= 2, JSON.stringify(v));
check('…and the Recommended pill carries "✎ wording"', /Recommended for your roof/.test(v.rec) && v.recEd >= 3, JSON.stringify(v));

// ── a note is added through its window, in its colour, and the pick did not change ──
const before = await pg.evaluate(() => JSON.stringify(S.quote.proposalOptions));
const link = pg.locator('#qd-grade [data-onote-add]').nth(1);
const key = await link.getAttribute('data-onote-add');
await link.click();
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ open: !!document.getElementById('qcoModal'), txt: !!document.getElementById('onoteText'), cols: document.querySelectorAll('#qcoModal input[name="onoteCol"]').length }));
check('"+ Add note" opens a window with a text box and green / yellow / red', v.open && v.txt && v.cols === 3, JSON.stringify(v));
await pg.fill('#onoteText', "Not the best choice this close to the sea");
await pg.check('#qcoModal input[value="red"]');
await pg.click('#onoteSave');
await pg.waitForTimeout(400);
v = await pg.evaluate((key) => {
  const pill = document.querySelector('#qpRoot [data-onote="' + key + '"]');
  return { stored: S.quote.optNotes && S.quote.optNotes[key], pill: pill && pill.textContent, red: pill && pill.classList.contains('qb-onote-red'),
           opts: JSON.stringify(S.quote.proposalOptions), link: (document.querySelector('#qpRoot [data-onote-add="' + key + '"]') || {}).textContent };
}, key);
check('the note shows on that option as a red pill', v.pill === 'Not the best choice this close to the sea' && v.red, JSON.stringify(v));
check('…is kept on the quote with its colour', v.stored && v.stored.colour === 'red', JSON.stringify(v.stored));
check('…the link now reads "✎ Edit note"', /Edit note/.test(v.link || ''), v.link);
check('…and pressing the link did not pick that option', v.opts === before, v.opts);

// ── the gutter kit, a custom extra and the included extras take notes too ──
v = await pg.evaluate(() => {
  S.quote.inclExtras = [{ id:'ix1', name:"Owner's leaf diverters", desc:'', price:120 }];
  S.quote.proposalOptions.gutterType = 'box125';
  refreshQuoteProposal();
  const g = {};
  document.querySelectorAll('#qpRoot [data-onote-add]').forEach(e => { const k = e.getAttribute('data-onote-add').split(':')[0]; g[k] = (g[k] || 0) + 1; });
  return g;
});
check('the gutter, its brackets and downpipes and the included extras offer a note',
  v.gutterType >= 2 && v.gutterBracket >= 2 && v.downpipes >= 2 && v.inclx === 1, JSON.stringify(v));
await pg.locator('#qpRoot [data-onote-add="inclx:ix1"]').click();
await pg.waitForTimeout(200);
await pg.fill('#onoteText', 'Worth it under the big trees');
await pg.check('#qcoModal input[value="green"]');
await pg.click('#onoteSave');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => { const p = document.querySelector('#qpRoot [data-onote="inclx:ix1"]'); return p && p.className; });
check('…an item with an apostrophe in its name takes one, green', /qb-onote-green/.test(v || ''), v);

// ── removing a note ──
await pg.locator('#qpRoot [data-onote-add="inclx:ix1"]').click();
await pg.waitForTimeout(200);
await pg.click('#onoteDel');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ pill: !!document.querySelector('#qpRoot [data-onote="inclx:ix1"]'), stored: !!(S.quote.optNotes || {})['inclx:ix1'] }));
check('Remove note takes it off', !v.pill && !v.stored, JSON.stringify(v));

// ── the Recommended wording ──
await pg.evaluate(() => document.querySelector('#qpRoot .qb-rec-ed').click());
await pg.waitForTimeout(200);
await pg.fill('#recLblText', 'Our pick for this house');
await pg.evaluate(() => document.getElementById('recLblSave').click());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ label: S.quote.recLabel, pills: [...document.querySelectorAll('#qpRoot .qb-rec')].map(e => e.textContent) }));
check('the green Recommended wording is the office\'s to change, on every recommended pick',
  v.label === 'Our pick for this house' && v.pills.length >= 3 && v.pills.every(t => t === 'Our pick for this house'), JSON.stringify(v));
v = await pg.evaluate(() => ({ keys: Q_CONTENT_KEYS.includes('optNotes') && Q_CONTENT_KEYS.includes('recLabel'), drop: Q_FRESH_DROP.includes('optNotes') }));
check('…both ride with the quote\'s content', v.keys && v.drop, JSON.stringify(v));

const tap = sel => pg.evaluate(s => document.querySelector(s).click(), sel);
// ── a CUSTOM OPTION reads from the pick (Leaf Diverters, 2026-11-04) ──
const tot = () => pg.evaluate(() => _custBarTotalValue());
await pg.evaluate(() => {
  S.quote.customExtras = [{ id:'leafdiv', title:'Leaf Diverters', desc:'Marley Curve leaf diverters',
    rows:[ { id:'excl', name:'Exclude', desc:"No, don't add Leaf Diverters", price:0 }, { id:'incl', name:'Include', desc:'Yes, add them', price:600 } ] }];
  _setProposalOption_extra('leafdiv', 'incl'); refreshQuoteProposal();
});
await pg.waitForTimeout(300);
const tagOf = () => pg.evaluate(() => {
  const o = {}; document.querySelectorAll('#qpRoot [data-qb-opt="extra:leafdiv"]').forEach(b => { o[b.getAttribute('data-qb-val')] = b.querySelector('.qb-opt-price').textContent.trim(); });
  return o; });
const totIncl = await tot();
v = await tagOf();
check('Include picked: Include reads Included, Exclude reads the saving', /included/i.test(v.incl || '') && /^−\$690\.00$/.test(v.excl || ''), JSON.stringify(v));
await tap('#qpRoot [data-qb-opt="extra:leafdiv"][data-qb-val="excl"]');
await pg.waitForTimeout(400);
v = await tagOf();
const totExcl = await tot();
check('…click Exclude: it reads Included and Include reads +$690.00', /included/i.test(v.excl || '') && /^\+\$690\.00$/.test(v.incl || ''), JSON.stringify(v));
check('…and the total still moves by the option\'s price', Math.abs((totIncl - totExcl) - 690) < 0.02, totIncl + ' / ' + totExcl);

// ── the colours, Undecided and the locked gauge take notes too ──
v = await pg.evaluate(() => {
  S.quote.proposalOptions.colour = 'Ironsand®'; refreshQuoteProposal();
  const k = e => e ? e.getAttribute('data-onote-add') : null;
  return { col: k(document.querySelector('#qpRoot [data-colnote="colour"] [data-onote-add]')),
           und: k(document.querySelector('#qpRoot .qb-undecided [data-onote-add]')) };
});
check('the picked roof colour and the Undecided row offer a note', v.col === 'colour:Ironsand®' && v.und === 'colour:Undecided', JSON.stringify(v));
await tap('#qpRoot [data-colnote="colour"] [data-onote-add]');
await pg.waitForTimeout(200);
await pg.fill('#onoteText', 'Shows dust in summer');
await pg.check('#qcoModal input[value="yellow"]');
await tap('#onoteSave');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ pill: (document.querySelector('#qpRoot [data-colnote="colour"] .qb-onote') || {}).textContent,
  dot: !!document.querySelector('#qpRoot [data-qb-colour="Ironsand®"] .qb-sw-note.qb-onote-yellow') }));
check('…the colour note shows under Chosen, and its swatch carries a yellow dot', v.pill === 'Shows dust in summer' && v.dot, JSON.stringify(v));
v = await pg.evaluate(() => { S.quote.proposalOptions.profile = '5rib'; refreshQuoteProposal();
  const r = !!document.querySelector('#qpRoot .qb-opt-static [data-onote-add="steelThickness:0.55"]');
  S.quote.proposalOptions.profile = 'corrugate'; refreshQuoteProposal(); return r; });
check('…and the "Locked for 5-Rib" gauge card offers one', v, String(v));

// ── the Recommended pill: its colour, and taking it off ──
await tap('#qd-grade .qb-rec-ed');
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ cols: document.querySelectorAll('#qcoModal input[name="recCol"]').length,
  one: !!document.getElementById('recOffOne'), all: !!document.getElementById('recOffAll') }));
check('the Recommended window offers green / yellow / red and both Removes', v.cols === 3 && v.one && v.all, JSON.stringify(v));
await pg.check('#qcoModal input[name="recCol"][value="yellow"]');
await tap('#recLblSave');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ c: S.quote.recColour, all: [...document.querySelectorAll('#qpRoot .qb-rec')].every(e => e.classList.contains('qb-rec-c-yellow')) }));
check('…a yellow pill on every section', v.c === 'yellow' && v.all, JSON.stringify(v));
await tap('#qd-grade .qb-rec-ed');
await pg.waitForTimeout(200);
await tap('#recOffOne');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ grade: !!document.querySelector('#qd-grade .qb-rec'), back: !!document.querySelector('#qd-grade .qb-rec-add'),
  others: document.querySelectorAll('#qpRoot .qb-rec').length, off: S.quote.recOff }));
check('Remove from this section takes it off that section only', !v.grade && v.back && v.others >= 2 && v.off && v.off.steelGrade, JSON.stringify(v));
await tap('#qd-grade .qb-rec-add');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ grade: !!document.querySelector('#qd-grade .qb-rec'), off: S.quote.recOff || null }));
check('…"+ Recommended" puts it back', v.grade && !v.off, JSON.stringify(v));
await tap('#qd-grade .qb-rec-ed');
await pg.waitForTimeout(200);
await tap('#recOffAll');
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({ n: document.querySelectorAll('#qpRoot .qb-rec').length, keys: Q_CONTENT_KEYS.includes('recColour') && Q_CONTENT_KEYS.includes('recOff') }));
check('Remove from every section takes them all off', v.n === 0 && v.keys, JSON.stringify(v));
await pg.evaluate(() => { delete S.quote.recOff; delete S.quote.recColour; delete S.quote.customExtras; refreshQuoteProposal(); });

// ── paper: the notes print, the links do not ──
v = await pg.evaluate(() => {
  document.documentElement.classList.add('pdf-modern');
  const vis = s => [...document.querySelectorAll(s)].some(e => getComputedStyle(e).display !== 'none');
  const out = { links: vis('#qpRoot .qb-onote-add'), recEd: vis('#qpRoot .qb-rec-ed'), notes: vis('#qpRoot .qb-onote') };
  document.documentElement.classList.remove('pdf-modern');
  return out;
});
check('on the PDF the notes stay and the office links go', !v.links && !v.recEd && v.notes, JSON.stringify(v));
check('nothing on the office screen threw', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();

// ── the customer ──
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#5d6970"/></svg>');
const q = {
  ref:'FR-30130', client:'Sharon Whittaker', addr:'14 Kamo Road, Whangarei',
  date:'19/09/2026', validUntil:'30 days', gstRate:15, coverTitle:'Whittaker Residence',
  condMaterial:'Corrugate Colorsteel', condAge:'34 years', condPhotos:[{ src:PHOTO, caption:'North face' }],
  baseGrade:'maxam', materialBase:9200, gutterLm:48, gutterLines:4, scaffoldBase:4200,
  optNotes:{ 'colour:Ironsand':{ text:'Shows dust in summer', colour:'yellow' }, 'steelGrade:zincalume':{ text:'Not suited this close to the sea', colour:'red' }, 'profile:5rib':{ text:'Costs more but sheds water faster', colour:'yellow' } },
  recLabel:'Our pick for this house', recColour:'red', recOff:{ profile:true },
  sectionDesc:{ grade:'This roof is 300 m from the tide, so the grade matters more here.' },
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                    colour:'Ironsand', gutterType:'none', gutterBracket:'internal', downpipes:'no', disposal:'dispose' },
  lineItems:[{ desc:'Strip and re-roof', qty:1, unit:31200 }], total:31200,
};
const cctx = await b.newContext({ viewport:{ width:1366, height:850 } });
const cpg = await cctx.newPage();
const cerrs = []; cpg.on('pageerror', e => cerrs.push(e.message));
cpg.on('dialog', d => d.accept());
await cpg.route('**/api.mapbox.com/**', r => r.abort());
await cpg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234', email:'office@floodroofing.co.nz' } }) });
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await cpg.goto('file://' + DIR + '/app.html?q=tok&j=' + q.ref);
await cpg.waitForTimeout(3200);
const cust = await cpg.evaluate(() => ({
  customer: !!window.__CUSTOMER_MODE,
  notes: [...document.querySelectorAll('#qpRoot .qb-onote')].map(e => [e.getAttribute('data-onote'), e.className.replace('qb-onote ', ''), e.textContent]),
  recs: [...document.querySelectorAll('#qpRoot .qb-rec')].map(e => e.textContent),
  red: [...document.querySelectorAll('#qpRoot .qb-rec')].every(e => e.classList.contains('qb-rec-c-red')),
  profRec: !!document.querySelector('#qd-profile .qb-rec'),
  colNote: (document.querySelector('#qpRoot [data-colnote="colour"] .qb-onote') || {}).textContent,
  links: document.querySelectorAll('#qpRoot .qb-onote-add, #qpRoot .qb-rec-ed').length,
}));
check('the customer reads the office\'s notes in their colours', cust.customer &&
  cust.notes.some(n => n[0] === 'steelGrade:zincalume' && n[1] === 'qb-onote-red' && /sea/.test(n[2])) &&
  cust.notes.some(n => n[0] === 'profile:5rib' && n[1] === 'qb-onote-yellow'), JSON.stringify(cust.notes));
check('…and the office\'s Recommended wording', cust.recs.length >= 2 && cust.recs.every(t => t === 'Our pick for this house'), JSON.stringify(cust.recs));
check('…in red, and not on the section the office took it off', cust.red && !cust.profRec, JSON.stringify([cust.red, cust.profRec]));
check('…and the colour\'s note under Chosen', cust.colNote === 'Shows dust in summer', String(cust.colNote));
check('…with no "+ Add note" or "✎ wording" for them', cust.links === 0, String(cust.links));
check('nothing on the customer screen threw', cerrs.length === 0, cerrs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
