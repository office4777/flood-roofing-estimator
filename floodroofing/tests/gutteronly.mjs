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

// ── a gutter line turns corners; Enter ends a dead end, the first point closes a boundary (2026-11-04) ──
{
  const toClient = (pts) => pg.evaluate((pts) => { const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio, t = getImgTransform();
    const k = r.width / (cv.width / dpr); return pts.map(([x, y]) => [r.left + (x * t.s + t.ix) * k, r.top + (y * t.s + t.iy) * k]); }, pts);
  const state = () => pg.evaluate(() => ({ cur: DRAW.currentPts.length, lines: DRAW.lines.filter(l => l.type === 'gutter').length,
    corners: _gutterCornersInSegments(DRAW.lines.filter(l => l.type === 'gutter').map(l => l.pts)),
    tip: (document.getElementById('enterTip') || {}).textContent || '' }));
  await pg.evaluate(() => { window.__keepGut = JSON.parse(JSON.stringify(DRAW.lines)); DRAW.lines = DRAW.lines.filter(l => l.type !== 'gutter'); DRAW.currentPts = []; localStorage.removeItem('fr_enter_tip_off');
    document.getElementById('snapGrid') && (document.getElementById('snapGrid').checked = false); setTool('gutter'); redrawAll(); });
  await pg.evaluate(() => { const c = document.getElementById('roofCanvas'); c.scrollIntoView({ block: 'center' }); });
  const L = await toClient([[150, 150], [450, 150], [450, 350]]);
  for (const [x, y] of L){ await pg.mouse.click(x, y); await pg.waitForTimeout(120); }
  let s1 = await state();
  check('on a gutters job three clicks are one gutter line still going — no line stops at a corner',
    s1.cur === 3 && s1.lines === 0, JSON.stringify(s1));
  check('…and it says to press Enter to finish the gutter line', /Press\s*Enter when you.ve finished your gutter line/.test(s1.tip), s1.tip);
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  let s2 = await state();
  check('Enter ends a dead-end L: two straights meeting at one corner', s2.cur === 0 && s2.lines === 2 && s2.corners === 1, JSON.stringify(s2));
  const B = await toClient([[150, 450], [450, 450], [450, 650], [150, 650], [150, 450]]);
  for (const [x, y] of B){ await pg.mouse.click(x, y); await pg.waitForTimeout(120); }
  let s3 = await state();
  check('a click back on the first point closes a whole boundary gutter: four straights, four corners',
    s3.cur === 0 && s3.lines === 6 && s3.corners === 5, JSON.stringify(s3));
  await pg.evaluate(() => { DRAW.lines = window.__keepGut; DRAW.currentPts = []; setTool('select'); try { syncToRoofData(); } catch(e){} redrawAll(); });
}

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
  v.title === 'Guttering Proposal' && v.incl.some(l => /^Remove existing spouting/i.test(l)) && v.incl.some(l => /Supply & install new 125mm/i.test(l)) && !v.incl.some(l => /roofing sheets|underlay|flashings/i.test(l)),
  JSON.stringify(v.incl));
check('the summary\'s first line is the Gutters, with the scaffold beside it',
  v.rows[0][0] === 'base' && /^Gutters — /.test(v.rows[0][1]) && v.rows.some(r => r[0] === 'scaffold') && !v.rows.some(r => /Re-roof/.test(r[1])), JSON.stringify(v.rows));
const money = s => parseFloat(String(s).replace(/[^0-9.]/g, ''));
const sum = v.rows.filter(r => r[0] !== 'total').reduce((a, r) => a + money(r[2]), 0);
check('…and its lines add up to the total', Math.abs(sum - money(v.rows[v.rows.length - 1][2])) < 0.02, sum + ' vs ' + v.rows[v.rows.length - 1][2]);
check('no roof labour or roof materials are priced, only the scaffold',
  v.lines.every(l => l[0] === 'scaffold' || +l[1] === 0) && v.lines.some(l => l[0] === 'scaffold' && +l[1] > 0), JSON.stringify(v.lines));
check('What you chose lists the gutter, brackets and downpipes only', v.picks[0] === 'Guttering: 125mm Colorsteel Box Gutter' && !v.picks.some(p => /Steel grade|profile|thickness|old roofing/i.test(p)), JSON.stringify(v.picks));

// ── the job profitability is the gutter quote, and GP/hr moves it (2026-11-04) ──
v = await pg.evaluate(() => {
  const pf = _profitFigures('total'), sub = _quoteMoney().sub;
  const gphr = () => { const g = _profitFigures('total'); return (g.revenue - g.cost) / g.hrsAll; };
  const g0 = gphr();
  _profitNudge('gphr', 1); const up = { sub: _quoteMoney().sub, rev: _profitFigures('total').revenue, g: gphr() };
  _profitNudge('gphr', -1); const back = { sub: _quoteMoney().sub, g: gphr() };
  return { rev: pf.revenue, sub, keys: pf.items.map(i => i.key + ':' + i.label), g0, up, back };
});
check('a gutters job\'s profitability is the quote: no roof labour, revenue = the quote\'s total ex GST',
  Math.abs(v.rev - v.sub) < 0.02 && !v.keys.some(k => /^roofing/.test(k)), JSON.stringify(v));
check('…and GP/hr + moves the gutter labour, so the quote moves with it',
  v.up.sub > v.sub + 0.5 && Math.abs(v.up.rev - v.up.sub) < 0.02 && Math.round(v.up.g) === Math.round(v.g0) + 1, JSON.stringify(v.up));
check('…and − takes it back down', v.back.sub < v.up.sub - 0.5, JSON.stringify(v.back));

// ── the gutter cards read against the recommended gutter (2026-11-04, quote 3346) ──
v = await pg.evaluate(() => {
  const cards = () => { const d = document.createElement('div'); d.innerHTML = _qbGutter();
    return [...d.querySelectorAll('.qb-opt')].map(o => ({ txt: o.textContent.replace(/\s+/g, ' '),
      tag: (o.querySelector('.qb-inc,.qb-up,.qb-down') || {}).textContent || '' })); };
  const CD = _qpCardDeltas(), full = {};
  _selGutters().forEach(g => { full[g.id] = _qbIncl(CD.gutter[g.id] || 0); });
  const ids = _selGutters().map(g => g.id);
  const rows = _custBarRows().map(r => [r.kind, r.value]);
  const out = { ids, full, a: cards(), rows };
  // a different gutter recommended: the cards move with it
  const keep = S.quote.proposalOptions.gutterType;
  _setProposalOption_gutter(ids[1]);
  out.b = cards(); out.recB = ids[1];
  _setProposalOption_gutter(keep);
  // a roofing quote's gutter cards keep their whole "+"
  S.quote.quoteKind = 'roofing';
  const d = document.createElement('div'); d.innerHTML = _qbGutter();
  out.roof = [...d.querySelectorAll('.qb-opt')].map(o => (o.querySelector('.qb-inc,.qb-up,.qb-down') || {}).textContent || '');
  S.quote.quoteKind = 'gutters';
  return out;
});
{
  const m = s => parseFloat(String(s).replace(/[^0-9.]/g, '')) * (/−/.test(s) ? -1 : 1);
  const rec = v.ids[0], diff = id => v.full[id] - v.full[rec];
  check('on a gutters job the recommended gutter reads Included', v.a[0] && v.a[0].tag === 'Included', JSON.stringify(v.a.map(c => c.tag)));
  check('…and every other gutter its difference from it, not its whole price',
    v.a.slice(1).every((c, i) => Math.abs(m(c.tag) - diff(v.ids[i + 1])) < 0.02 && m(c.tag) < v.full[v.ids[i + 1]] - 1),
    JSON.stringify(v.a.map(c => c.tag)) + ' full ' + JSON.stringify(v.full));
  const recB = v.recB, iB = v.ids.indexOf(recB);
  check('…a different gutter recommended reads Included and the rest move with it, cheaper ones as a −',
    v.b[iB].tag === 'Included' && v.b.every((c, i) => i === iB || Math.abs(m(c.tag) - (v.full[v.ids[i]] - v.full[recB])) < 0.02)
      && v.b.some(c => /−/.test(c.tag)) === v.ids.some(id => v.full[id] < v.full[recB] - 0.01),
    JSON.stringify(v.b.map(c => c.tag)));
  check('…the price box still carries the gutter at its whole price',
    v.rows.some(r => r[0] === 'base' && Math.abs(money(r[1]) - v.full[rec]) < 0.02), JSON.stringify(v.rows));
  check('a roofing quote\'s gutter cards still read their whole "+"',
    v.roof[0] === 'Included' && v.roof.slice(1).every(t => /^\+/.test(t)), JSON.stringify(v.roof));
}

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

// ── Fergus: a gutters job pushes no roof (2026-11-06, job 3341: an accepted
// gutter quote went to Fergus with Roof Labour 13 + 13 hrs and a Roof Material
// "Adjustment to quoted total" cancelling it, so the crew saw roof hours) ──
v = await pg.evaluate(async () => {
  const W = ms => new Promise(r => setTimeout(r, ms));
  _resetQuoteForFreshJob({ client:'Gutter Fergus', addr:'1 Test Road' });
  _setJobType('gutters');
  gotoTab('roof'); await W(200);
  DRAW.scaleMetresPerPx = 0.02; DRAW.lines = [];
  setTool('gutter');
  DRAW.currentPts = [[100,100],[1500,100]]; finishCurrent();
  DRAW.currentPts = [[100,400],[1500,400]]; finishCurrent();
  // the leftover roof labour table the job never prices
  S.quote.labour = Object.assign(S.quote.labour || {}, { leadHrs: 13, appHrs: 13, leadPrice: 142.51, appPrice: 52.51, leadCost: 45, appCost: 25 });
  gotoTab('quote'); await W(400);
  try { calcLabour(); renderProfitability(); _syncQuoteBaseLineItems(); recalcQuoteTotals(); } catch(e){}
  const sum = secs => secs.reduce((t, s) => t + s.lineItems.reduce((a, li) => a + (li.itemQuantity || 0) * (li.itemPrice || 0), 0), 0);
  const full = _buildFergusItemisedSections(), base = _buildFergusItemisedSections({ base: true });
  const fs = full.sections || full, bs = base.sections || base;
  const names = secs => secs.map(s => s.name + ':' + s.lineItems.map(li => li.itemName + (li.isLabour ? '[' + li.itemQuantity + 'h]' : '')).join('|'));
  return { full: names(fs), base: names(bs), fullSum: Math.round(sum(fs) * 100) / 100, baseSum: Math.round(sum(bs) * 100) / 100,
           quote: Math.round(_quoteMoney().sub * 100) / 100, subLines: Math.round(quoteSubtotal() * 100) / 100 };
});
const _fg = JSON.stringify(v);
check('a gutters job pushed to Fergus has no roof labour and no roof material — only the gutter and the scaffold',
  !v.full.some(x => /^(Roof |Labour:|Materials:)/.test(x)) && v.full.some(x => /^Gutter Labour:/.test(x)) && v.full.some(x => /^Gutter Material:/.test(x)), _fg);
check('…no "Adjustment to quoted total" line, and its lines add up to the quote', !/Adjustment to quoted total/.test(_fg) && Math.abs(v.fullSum - v.quote) < 0.02, _fg);
check('…and the plan kept for the versions made on acceptance is the gutter too, adding up to the quote', !v.base.some(x => /^(Roof |Labour:|Materials:)/.test(x)) && v.base.some(x => /^Gutter Labour:/.test(x)) && Math.abs(v.baseSum - v.quote) < 0.02, _fg);

// ── the server's half ──
const SRV = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('the server keeps the customer\'s gutter colour', /po\.gutterColour != null[\s\S]{0,200}quote\.proposalOptions\.gutterColour = gc/.test(SRV));
check('…and a gutters-only acceptance lists the gutter, not the roofing picks', /const gj = quote && quote\.quoteKind === 'gutters'/.test(SRV) && /Gutter colour: /.test(SRV));

check('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
