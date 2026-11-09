// NEW BUILD — AI YOUR PLANS, THE APP (2026-11-09, the owner: "build the new
// build job type ... another big button under it called AI Your Plans ...
// only be offered in the team tier"). The real app.html in Playwright with
// the real pdf.js, served over http, and a plan set written here: page 1 a
// specification, page 2 a 12 x 8 m hip roof plan drawn at 1:100 on A3 with
// its title and scale (and a 1:60 drainage fall to be ignored). Pins: the
// button only on a New Build and only for Team; the roof drawn off page 2 as
// a hip at the plan's true size; the specs sent with the company's products
// and applied (an unmatched profile priced at the AI's figure, the gauge,
// the gutter, the pitch); the summary; the quote with no condition or old
// roof section, "New Roof Proposal", and a note on a choice the plans did
// not spec. Roofing is unchanged.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j, extname } from 'node:path';
import { mkPdf } from './_tenderpdf.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ('  — ' + d) : '')); }

// The plan set.
const k = 28.3465;                      // points per metre at 1:100 on paper
const x0 = 300, y0 = 250, W = 12 * k, H = 8 * k, g = 0.6 * k;
const L = (a, b, c, d) => `${a.toFixed(2)} ${b.toFixed(2)} m ${c.toFixed(2)} ${d.toFixed(2)} l S`;
const raw = [ '2.5 w', `${x0} ${y0} ${W.toFixed(2)} ${H.toFixed(2)} re S`,
  L(x0, y0, x0 + H/2, y0 + H/2), L(x0, y0 + H, x0 + H/2, y0 + H/2), L(x0 + W, y0, x0 + W - H/2, y0 + H/2), L(x0 + W, y0 + H, x0 + W - H/2, y0 + H/2),
  L(x0 + H/2, y0 + H/2, x0 + W - H/2, y0 + H/2),
  '0.4 w [6 4] 0 d', `${(x0+g).toFixed(2)} ${(y0+g).toFixed(2)} ${(W-2*g).toFixed(2)} ${(H-2*g).toFixed(2)} re S`, '[] 0 d' ].join('\n');
const PDF = mkPdf([
  { w: 1190.55, h: 841.89, texts: [ { x: 60, y: 780, size: 18, str: 'SPECIFICATION' }, { x: 60, y: 750, size: 11, str: 'Roofing: 0.55 BMT Maxam Trimline. Spouting: Marley Typhoon. Pitch 25 degrees.' } ] },
  { w: 1190.55, h: 841.89, raw, texts: [ { x: x0, y: y0 + H + 40, size: 20, str: 'ROOF PLAN' }, { x: x0, y: y0 + H + 20, size: 11, str: 'SCALE 1:100 @ A3' }, { x: 900, y: 120, size: 9, str: 'Stormwater 1:60 fall' } ] },
]);
const TMP = mkdtempSync(_j(tmpdir(), 'nbui-'));
const PDF_PATH = _j(TMP, 'Smith new build plans.pdf');
writeFileSync(PDF_PATH, PDF);

// app.html and pdf.js over http (a module import will not load off file://).
const MT = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.css':'text/css', '.svg':'image/svg+xml' };
const PDFJS = _j(_ROOT, 'backend', 'node_modules', 'pdfjs-dist');
const srv = createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u.startsWith('/pdfjs/') ? _j(PDFJS, u.slice(7)) : _j(_ROOT, u);
  if (!f.startsWith(_ROOT) || !existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MT[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
});
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const BASE = 'http://127.0.0.1:' + srv.address().port;

const SPECS = { roof_plan_page: 2, pitch_deg: 25, pitch_pages: [1],
  profile: { text: 'Maxam Trimline', match_id: '', pages: [1], confidence: 'high' }, profile_rate_m2: 42.5,
  thickness: { text: '0.55 BMT', value: '0.55', pages: [1], confidence: 'high' },
  grade: { text: 'Colorsteel Maxam', match_id: 'maxam', pages: [1], confidence: 'high' },
  gutter: { text: 'Marley Typhoon', match_id: 'marley_typhoon', pages: [1], confidence: 'high' },
  downpipes: null, colour: null, underlay: null,
  conflicts: [ { item: 'gutter', values: [ { text: 'Marley Typhoon', pages: [1] }, { text: '125mm box gutter', pages: [2] } ], note: '' } ], notes: [] };

const b = await chromium.launch();
async function open(tender){
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const sent = [];
  await pg.route('**/api.mapbox.com/**', r => r.abort());
  await pg.route('**/basemaps.linz.govt.nz/**', r => r.abort());
  await pg.route('**/cdnjs.cloudflare.com/**', r => r.abort());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    if (/\/newbuild\/specs/.test(r.request().url())) { sent.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ specs: SPECS, model: 'test', prompt: 'newbuild-specs.v1' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await pg.addInitScript((t) => {
    localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_setup_done', '1'); sessionStorage.setItem('fr_coach_seen', '1');
    localStorage.setItem('fr_company', JSON.stringify({ limits: { tender: t } }));
    window.__DEFAULT_QUOTE_STYLE = 'modern';
  }, tender);
  await pg.goto(BASE + '/frontend/app.html');
  await pg.waitForFunction(() => typeof _setJobType === 'function' && typeof _nbAiStart === 'function', null, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  await pg.evaluate(async (base) => {
    const m = await import(base + '/pdfjs/legacy/build/pdf.mjs');
    m.GlobalWorkerOptions.workerSrc = base + '/pdfjs/legacy/build/pdf.worker.mjs';
    window.pdfjsLib = m;
    ['setupWizard', 'tourWrap'].forEach(i => { const e = document.getElementById(i); if (e) e.remove(); });
    gotoTab('roof');
  }, BASE);
  return { ctx, pg, errs, sent };
}
const shown = (pg) => pg.evaluate(() => { const e = document.getElementById('nbAiWrap'); return !!e && getComputedStyle(e).display !== 'none'; });

// Trade: the button never shows, on any job type.
{
  const { ctx, pg, errs } = await open(false);
  check('a roofing job has no AI button', !(await shown(pg)));
  await pg.evaluate(() => _setJobType('newbuild'));
  check('a New Build on a plan without Team has no AI button', !(await shown(pg)));
  check('… and the plan check says no', (await pg.evaluate(() => _nbAiAllowed())) === false);
  check('no page errors (not Team)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// Team.
const { ctx, pg, errs, sent } = await open(true);
check('Team: a roofing job has no AI button', !(await shown(pg)));
await pg.evaluate(() => _setJobType('newbuild'));
check('Team: a New Build shows "AI your plans"', await shown(pg));
check('… under the upload buttons, a big button', await pg.evaluate(() => {
  const btn = document.getElementById('nbAiBtn'), uz = document.getElementById('roofUZ');
  return !!btn && !!uz && uz.contains(btn) && /AI your plans/i.test(btn.textContent) && btn.getBoundingClientRect().height >= 40;
}));
await pg.evaluate(() => _setJobType('roofing'));
check('… and goes again when the job is roofing', !(await shown(pg)));
await pg.evaluate(() => _setJobType('newbuild'));

await pg.setInputFiles('#nbAiFile', PDF_PATH);
await pg.waitForFunction(() => { const m = document.getElementById('nbAiModal'); return m && /Your plans are in/.test(m.textContent); }, null, { timeout: 120000 });
const summary = await pg.evaluate(() => document.getElementById('nbAiModal').innerText);
check('the summary says the roof came off page 2 as a hip', /page 2/i.test(summary) && /hip/i.test(summary), summary.split('\n').slice(0, 4).join(' / '));
check('the summary names the plan\'s scale, not the 1:60 fall', /1:100/.test(summary) && !/1:60/.test(summary));
check('the summary flags the profile as the AI\'s price', /not in your price book/i.test(summary) && /42\.50/.test(summary));
check('the summary lists where the plans disagree', /disagree/i.test(summary) && /125mm box gutter/.test(summary));

const st = await pg.evaluate(() => {
  const ol = DRAW.outline || [];
  const xs = ol.map(p => p[0]), ys = ol.map(p => p[1]);
  const m = DRAW.scaleMetresPerPx || 0;
  const lines = DRAW.lines || [];
  return { n: ol.length, wM: (Math.max(...xs) - Math.min(...xs)) * m, hM: (Math.max(...ys) - Math.min(...ys)) * m,
    type: DRAW.roofType, hips: lines.filter(l => l.type === 'hip').length, ridges: lines.filter(l => l.type === 'ridge').length,
    bg: !!DRAW.bgImg, pitch: DRAW.calPitch, popup: !!document.getElementById('_rsModal') };
});
check('the outline is drawn: four corners', st.n === 4, st.n);
check('… at the plan\'s true size, 12 x 8 m', Math.abs(st.wM - 12) < 0.25 && Math.abs(st.hM - 8) < 0.25, st.wM.toFixed(2) + ' x ' + st.hM.toFixed(2));
check('… built as a hip roof with its hips and ridge', st.type === 'hip' && st.hips === 4 && st.ridges >= 1, JSON.stringify(st));
check('… on the plan page as its picture', st.bg);
check('… at the spec\'d pitch', Number(st.pitch) === 25, st.pitch);
check('the roof-type window does not open over it', !st.popup);

const req = sent[0] || {};
check('the plans were read and sent page by page', Array.isArray(req.pages) && req.pages.length === 2 && /Maxam Trimline/.test(req.pages[0].text || ''), JSON.stringify((req.pages || []).map(p => p.page)));
check('… with the company\'s own products', req.products && (req.products.profiles || []).some(p => p.id === 'corrugate') && (req.products.gutters || []).some(g => g.id === 'marley_typhoon'));

const q = await pg.evaluate(() => {
  const po = S.quote.proposalOptions || {};
  const prof = (S.quote.customProfiles || []).find(p => p.id === po.profile) || null;
  return { po, prof, spec: S.quote.nbSpec || null };
});
check('an unmatched profile is added to the job at the AI\'s rate', !!q.prof && /Trimline/.test(q.prof.name) && Number(q.prof.rate) === 42.5 && q.prof.rateUnit === 'm2', JSON.stringify(q.prof));
check('the gauge is the spec\'d 0.55', q.po.steelThickness === '55', q.po.steelThickness);
check('the gutter is the spec\'d one', q.po.gutterType === 'marley_typhoon', q.po.gutterType);
check('the grade the plans name is picked', q.po.steelGrade === 'maxam', q.po.steelGrade);
check('what the plans spec is kept on the quote', q.spec && q.spec.profile === q.po.profile && q.spec.steelThickness === '55' && q.spec.gutterType === 'marley_typhoon');

await pg.evaluate(() => _nbAiClose());
const quote = await pg.evaluate(() => {
  const keys = _qdSectionsRaw().map(s => s.key);
  return { keys, title: _qbProposalTitle(), note5: _nbNotSpecNote('profile', '5rib'), noteSpec: _nbNotSpecNote('profile', S.quote.proposalOptions.profile), note40: _nbNotSpecNote('steelThickness', '40') };
});
check('the quote has no existing roof condition section', !quote.keys.includes('condition'), quote.keys.join(','));
check('… and no old roofing section', !quote.keys.includes('disposal') && !quote.keys.includes('oldroof'), quote.keys.join(','));
check('… keeps steel grade, profile, thickness and the gutter', ['grade', 'profile', 'thickness', 'gutter'].every(k => quote.keys.includes(k)));
check('the proposal reads "New Roof Proposal"', quote.title === 'New Roof Proposal', quote.title);
check('a profile the plans do not spec carries the note', quote.note5 && /not spec/.test(quote.note5.text), JSON.stringify(quote.note5));
check('… the spec\'d one does not', quote.noteSpec == null);
check('… nor does a gauge the plans do not spec go without one', quote.note40 && /thickness is not spec/.test(quote.note40.text));
const gut = await pg.evaluate(() => { const h = _qbGutter(); const d = document.createElement('div'); d.innerHTML = h; return { text: d.textContent, none: /No new guttering/.test(d.textContent), existing: /existing spouting/i.test(d.textContent) }; });
check('the gutter section offers no "No new guttering" on a new build', !gut.none && !gut.existing);
check('… and reads the spec\'d gutter as the one it is built on', /your plans call for/i.test(gut.text));
const fresh = await pg.evaluate(() => { S.quote.proposalOptions.gutterType = 'none'; _setJobType('newbuild'); return S.quote.proposalOptions.gutterType; });
check('a New Build with no gutter picked takes one', fresh && fresh !== 'none', fresh);
const roof = await pg.evaluate(() => { _setJobType('roofing'); S.quote.proposalOptions.gutterType = 'none'; const d = document.createElement('div'); d.innerHTML = _qbGutter(); const t = d.textContent; _setJobType('roofing'); return { none: /No new guttering/.test(t), po: S.quote.proposalOptions.gutterType, title: _qbProposalTitle(), cond: _qdSectionsRaw().map(s => s.key).includes('proposal') }; });
check('a roofing quote is unchanged: "No new guttering" stays, nothing picked for it', roof.none && roof.po === 'none', JSON.stringify(roof));
check('… and it is still the Re-Roof Proposal', roof.title === 'Re-Roof Proposal', roof.title);
check('no page errors (Team)', errs.length === 0, errs.slice(0, 3).join(' | '));
await ctx.close();

await b.close(); srv.close();
const ok = results.filter(Boolean).length;
console.log('\n' + ok + '/' + results.length + ' passed');
process.exit(ok === results.length ? 0 : 1);
