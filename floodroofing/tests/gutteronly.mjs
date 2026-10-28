// GUTTERS ONLY (2026-10-28, the owner: "add an job type called 'Gutters only'
// and the canvas is very basic, only allows to draw the gutter line, the quote
// gets changed to suit gutter (what we will do only refers to the gutter, no
// steel grade, no profile, no thickness, no 'the old roofing', re-roof in the
// summary changes to 'Gutters', the roofmap & aerial image just shows the
// aerial image and the gutter lines, no basic map. if colorsteel box gutter is
// selected, then show the normal colorsteel colour chart and selector, if
// marley typhoon is selected, show the ... marley typhoon colour chart ... if
// marley classic is selected, just show the compulsory white choice").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1500, height:1000 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? JSON.stringify({ branding:{ company_name:'Flood Roofing' } }) : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// ── the job type ──
let v = await pg.evaluate(() => {
  _resetQuoteForFreshJob({ client:'Irene Mears', addr:'263 Puketotara Road' });
  const btn = document.getElementById('jtBtn_gutters');
  _setJobType('gutters');
  return { btn: !!btn, label: btn && btn.textContent, kind: S.quote.quoteKind, body: document.body.classList.contains('gutter-job'),
           gutter: S.quote.proposalOptions.gutterType };
});
check('the job details window offers Gutters only', v.btn && /Gutters only/.test(v.label), JSON.stringify(v));
check('…and choosing it makes a gutters quote with a gutter already picked', v.kind === 'gutters' && v.body && v.gutter === 'box125', JSON.stringify(v));

// ── the canvas draws gutter lines and nothing else ──
v = await pg.evaluate(async () => {
  gotoTab('roof'); await new Promise(r => setTimeout(r, 300));
  const vis = id => { const e = document.getElementById(id); return !!(e && e.offsetParent); };
  const tools = { outline: vis('btn-outline'), menu: vis('rlDropWrap'), gutter: vis('btn-gjgutter'), move: vis('btn-move'), tape: vis('btn-tape'), custom: vis('btn-customscale') };
  setTool('outline'); const t1 = DRAW.tool;
  setTool('ridge'); const t2 = DRAW.tool;
  DRAW.scaleMetresPerPx = 0.02;
  setTool('gutter');
  DRAW.currentPts = [[100,100],[600,100]]; finishCurrent();
  DRAW.currentPts = [[100,400],[600,400]]; finishCurrent();
  return { tools, t1, t2, lm: _selGutterLm(), runs: _selGutterLineCount() };
});
check('the canvas offers Move, Gutter line, the tape and Custom Scale — no outline, no roof lines',
  !v.tools.outline && !v.tools.menu && v.tools.gutter && v.tools.move && v.tools.tape && v.tools.custom, JSON.stringify(v.tools));
check('…and a roof tool asked for anyway becomes the gutter line', v.t1 === 'gutter' && v.t2 === 'gutter', JSON.stringify([v.t1, v.t2]));
check('gutter lines drawn with no outline are the gutter run', Math.abs(v.lm - 20) < 0.01 && v.runs === 2, JSON.stringify(v));

// ── the quote suits a gutter ──
v = await pg.evaluate(async () => {
  S.quote.scaffold = Object.assign({}, S.quote.scaffold || {}, { type:'edge', price:2000 });
  try { calcLabour(); } catch(e){}
  gotoTab('quote'); await new Promise(r => setTimeout(r, 500));
  try { refreshQuoteProposal(); } catch(e){}
  return {
    desk: _qdSections().map(s => s.key), book: _qbPages().map(s => s.key),
    style: _quoteStyle(), title: _qbProposalTitle(), incl: _qbInclusionLines(),
    rows: _custBarRows().map(r => [r.kind, r.label, r.value]), total: _custBarTotalValue(),
    picks: _qbPicksAuto().map(r => r[0] + ': ' + r[1]),
    base: _qpBaseSub(), lines: S.quote.lineItems.filter(l => l && l._base).map(l => [l._base, l.unit]),
  };
});
check('the computer layout is cover, proposal, guttering, gutter colour, brackets & downpipes, review',
  v.desk.join() === 'cover,proposal,gutter,gcolour,gutterkit,review', v.desk.join());
check('…and the phone book the same, ending on the total', v.book.join() === 'cover,proposal,gutter,gcolour,gutterkit,summary', v.book.join());
check('no steel grade, profile, thickness, roof colour or old roofing anywhere', !/grade|profile|thickness|^colour|disposal/.test(v.desk.concat(v.book).join(',')), v.desk.join());
check('it is always the modern layout', v.style === 'modern', v.style);
check('the proposal is a Guttering Proposal and says what is done to the gutters',
  v.title === 'Guttering Proposal' && v.incl.some(l => /spouting and downpipes/i.test(l)) && v.incl.some(l => /Supply & install new 125mm/i.test(l)) && !v.incl.some(l => /roofing sheets|underlay|flashings/i.test(l)),
  JSON.stringify(v.incl));
check('the summary\'s first line is the Gutters, with the scaffold beside it',
  v.rows[0][0] === 'base' && /^Gutters — /.test(v.rows[0][1]) && v.rows.some(r => r[0] === 'scaffold') && !v.rows.some(r => /Re-roof/.test(r[1])), JSON.stringify(v.rows));
const money = s => parseFloat(String(s).replace(/[^0-9.]/g, ''));
const sum = v.rows.filter(r => r[0] !== 'total').reduce((a, r) => a + money(r[2]), 0);
check('…and its lines add up to the total', Math.abs(sum - money(v.rows[v.rows.length - 1][2])) < 0.02, sum + ' vs ' + v.rows[v.rows.length - 1][2]);
check('no roof labour or roof materials are priced, only the scaffold',
  v.lines.every(l => l[0] === 'scaffold' || +l[1] === 0) && v.lines.some(l => l[0] === 'scaffold' && +l[1] > 0), JSON.stringify(v.lines));
check('What you chose lists the gutter, brackets and downpipes only', v.picks[0] === 'Guttering: 125mm Colorsteel Box Gutter' && !v.picks.some(p => /Steel grade|profile|thickness|old roofing/i.test(p)), JSON.stringify(v.picks));

// ── the map: the aerial and the gutter lines ──
v = await pg.evaluate(() => {
  const g = S.quote.roofMapGeom || {};
  const svg = _qpRoofMapSvg({ showBg:true });
  return { only: !!g.gutterOnly, roofs: (g.roofs || []).length, gutters: ((g.roofs || [])[0] || {}).gutters, poly: /<polygon/.test(svg), purple: (svg.match(/#7c3aed/g) || []).length,
           showBg: _qpRoofMapShowBg(), sw: /Background picture/.test(_qpInteractiveRoofBlock({}) || '') };
});
check('the quote\'s map is the gutter lines alone — no roof shapes, no basic-map switch',
  v.only && v.roofs === 1 && v.gutters && v.gutters.length === 2 && !v.poly && v.purple === 2 && v.showBg && !v.sw, JSON.stringify(v));

// ── the gutter's own colours ──
v = await pg.evaluate(() => {
  const P = id => { const x = _gjPalette(id); return { kind: x.kind, names: x.list.map(c => c.name) }; };
  const box = P('box125'), ty = P('marley_typhoon'), cl = P('marley_classic');
  _setProposalOption_gutter('box125'); _setProposalOption_gutterColour('Ironsand®');
  const kept = S.quote.proposalOptions.gutterColour;
  const boxHtml = _qbGutterColour();
  _setProposalOption_gutter('marley_classic');
  const classic = S.quote.proposalOptions.gutterColour, classicHtml = _qbGutterColour();
  // a Colorsteel colour Typhoon does not come in, then over to Typhoon
  _setProposalOption_gutter('box125');
  const only = MAXAM_COLOURS.map(c => c.name).filter(n => !MARLEY_TYPHOON_COLOURS.some(t => t.name === n))[0];
  _setProposalOption_gutterColour(only);
  _setProposalOption_gutter('marley_typhoon');
  const afterTy = S.quote.proposalOptions.gutterColour;
  return { box, ty, cl, kept, boxSw: (boxHtml.match(/class="qb-sw( on)?"/g) || []).length, classic, classicSw: (classicHtml.match(/class="qb-sw( on)?"/g) || []).length,
           classicUndecided: /qb-undecided/.test(classicHtml), afterTy, maxam: MAXAM_COLOURS.map(c => c.name), typhoon: MARLEY_TYPHOON_COLOURS.map(c => c.name) };
});
check('a Colorsteel box gutter shows the Colorsteel chart', v.box.kind === 'colorsteel' && v.box.names.join() === v.maxam.join() && v.boxSw === v.maxam.length, JSON.stringify(v.box));
check('…Marley Typhoon shows the Typhoon chart', v.ty.kind === 'typhoon' && v.ty.names.join() === v.typhoon.join() && v.typhoon.length > 1, JSON.stringify(v.ty));
check('…and Marley Classic is white, compulsory, with nothing else to pick', v.cl.kind === 'classic' && v.classic === 'White' && v.classicSw === 1 && !v.classicUndecided, JSON.stringify(v));
check('a colour the new gutter does not come in is cleared when the gutter changes', v.kept === 'Ironsand®' && v.afterTy === '', JSON.stringify([v.kept, v.afterTy]));

// ── Typhoon's own chart, the owner's (marley.co.nz) ──
v = await pg.evaluate(() => {
  _setProposalOption_gutter('box125'); _setProposalOption_gutterColour('Ironsand®');
  _setProposalOption_gutter('marley_typhoon');
  const keptAcross = S.quote.proposalOptions.gutterColour;
  const html = _qbGutterColour();
  return { names: MARLEY_TYPHOON_COLOURS.map(c => c.name), keptAcross, sw: (html.match(/class="qb-sw( on)?"/g) || []).length,
           copper: /Copper/.test(html), white: /White/.test(html) };
});
check('Typhoon offers its own eight: White and the Stratus range',
  v.names.join() === 'White,Black,Grey Friars®,Ironsand®,Gull Grey,FlaxBlack®,Titanium,Copper' && v.sw === 8 && v.copper && v.white, JSON.stringify(v));
check('…and a colour both gutters come in is kept when the gutter changes', v.keptAcross === 'Ironsand®', JSON.stringify(v));

// ── it stays a gutters job across a save and reopen ──
v = await pg.evaluate(() => {
  const snap = snapshotCurrentJob();
  restoreFromJob({ id: 'g1', client_name:'Irene Mears', site_address:'263 Puketotara Road', draw_state: JSON.parse(JSON.stringify(snap)) });
  return { kind: S.quote.quoteKind, body: document.body.classList.contains('gutter-job'), lines: (DRAW.lines || []).filter(l => l.type === 'gutter').length };
});
check('a saved gutters job reopens as one, its gutter lines with it', v.kind === 'gutters' && v.body && v.lines === 2, JSON.stringify(v));
v = await pg.evaluate(() => { _resetQuoteForFreshJob({}); return { kind: S.quote.quoteKind, body: document.body.classList.contains('gutter-job') }; });
check('…and the next new job is a roofing job again', v.kind === 'roofing' && !v.body, JSON.stringify(v));

// ── the server's half ──
const SRV = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('the server keeps the customer\'s gutter colour', /po\.gutterColour != null[\s\S]{0,200}quote\.proposalOptions\.gutterColour = gc/.test(SRV));
check('…and a gutters-only acceptance lists the gutter, not the roofing picks', /const gj = quote && quote\.quoteKind === 'gutters'/.test(SRV) && /Gutter colour: /.test(SRV));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
