// A bug report used to ask a roofer for what they did, what they expected and
// what happened. That is a fair thing to ask a developer and an unfair thing
// to ask somebody standing on a roof — so the app fills it in itself.
//
// It already knows which build it is, which screen and tool they were on, what
// state the drawing is in, how the account is set up, and what has thrown this
// session. The roofer only has to say what looks wrong. Everything captured
// here rides in the PDF that reaches the team.
//
// The one rule: nothing identifying. No client, address, photo or price — a
// diagnostic that leaks a customer's details is worse than no diagnostic.
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
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);

// ── the boxes ask for the problem, not a witness statement ────────
let v = await pg.evaluate(() => ({
  title: (document.getElementById('fbTitle')||{}).placeholder || '',
  details: (document.getElementById('fbDetails')||{}).placeholder || '',
  tab: document.getElementById('tab-feedback').textContent.replace(/\s+/g,' '),
}));
check('the title box shows a real example',
  /example:/i.test(v.title) && /auto populate/i.test(v.title), v.title);
check('the details box shows a real example',
  /example:/i.test(v.details) && /ridge lines/i.test(v.details), v.details);
check('…and no longer asks for what-you-did / expected / happened',
  !/what i did/i.test(v.details) && !/what you expected/i.test(v.details) &&
  !/happened instead/i.test(v.details));
check('the description asks for the problem, specifically',
  /describe what looks wrong/i.test(v.tab) && /which lines/i.test(v.tab));
check('…and does not set the three-things homework anywhere on the page',
  !/what you were doing/i.test(v.tab) && !/what you expected/i.test(v.tab));
check('…and says the rest is captured for them',
  /captured and attached/i.test(v.tab) && /automatically/i.test(v.tab));
check('the two-hour promise is still there', /two hours/i.test(v.tab));

// ── what gets captured ────────────────────────────────────────────
// Set the tab and tool through the app first, THEN drop in the stub lines.
// Doing it the other way round asks redrawAll to paint lines that have no
// points — which crashes the fixture, not the app.
await pg.evaluate(() => { gotoTab('roof'); setTool('barge'); });
await pg.waitForTimeout(200);
v = await pg.evaluate(() => {
  // pts, because redrawAll paints these — a stub without them crashes the
  // fixture and then shows up as "something threw" at the end of the suite.
  DRAW.lines = [{type:'ridge', measM:'9', pts:[[10,10],[90,10]]},
                {type:'ridge', measM:'6', pts:[[10,40],[70,40]]},
                {type:'hip',   measM:'4', pts:[[10,70],[50,90]]}];
  DRAW.outline = [[0,0],[10,0],[10,8],[0,8]];
  DRAW.penetrations = [{kind:'box'}];
  DRAW.notes = [{pts:[[1,1]]}];
  DRAW.scaleMetresPerPx = 0.05; DRAW.calPitch = 25;
  return _fbAutoContext();
});
const has = re => new RegExp(re, 'i').test(v);
check('it records which build', has('Build: *build'), (v.match(/Build:.*/)||[''])[0]);
check('…which mode, tab and tool', has('Mode: Office') && has('Tab: roof') && has('Tool in use: barge'),
  (v.match(/Tool in use:.*/)||[''])[0]);
check('…the screen and the browser', has('Screen: 1500') && has('Browser: Mozilla'));
check('…and whether they were online', has('Online: yes'));

check('it records what is actually drawn',
  has('Outline corners: 4') && has('Penetrations: 1') && has('Free-draw notes: 1'),
  (v.match(/Outline corners:.*/)||[''])[0]);
check('…counted by type, so "missing two ridge lines" is checkable',
  /Lines drawn: 3 .*ridge×2/.test(v), (v.match(/Lines drawn:.*/)||[''])[0]);
check('…and whether it was ever calibrated',
  has(String.raw`Calibrated: yes`) && has(String.raw`Pitch: 25`));

check('it records how the account is set up',
  has('Price book: still on the shipped rates') && has('Products customised: no'),
  (v.match(/Price book:.*/)||[''])[0]);
// jms_keys ships a key per platform with every value empty; counting keys
// used to report "linked" on a brand-new account.
check('…and does not claim a JMS is linked when none is',
  /JMS linked: no/.test(v), (v.match(/JMS linked:.*/)||[''])[0]);

// ── errors the user could never have reported themselves ──────────
v = await pg.evaluate(() => {
  _fbNoteError('Cannot read properties of null (reading \'measM\')', 'Error\n  at redrawAll (index.html:123)');
  return _fbAutoContext();
});
check('a JavaScript error from this session rides along',
  /JavaScript errors this session \(most recent last\)/.test(v) &&
  /reading 'measM'/.test(v) && /redrawAll/.test(v));
v = await pg.evaluate(() => {
  for (let i = 0; i < 20; i++) _fbNoteError('boom ' + i, 'Error\n  at x (y:1)');
  return { ctx: _fbAutoContext(), n: FB_ERRS.length };
});
check('…and the ring is bounded, so a loop cannot fill the report',
  v.n <= 8 && /boom 19/.test(v.ctx) && !/boom 0\b/.test(v.ctx), v.n + ' kept');

// ── the promise to the user ───────────────────────────────────────
v = await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.branding = { company_name:'Acme Roofing Ltd', phone:'0800 111 222',
                          email:'sam@acme.co.nz', address:'12 Somewhere Rd, Whangarei' };
  S.job = { id:'j-77', client:'Mrs Henderson', address:'9 Private Lane', total: 41250 };
  return _fbAutoContext();
});
check('a job shows as selected, by id', /Job selected: yes \(id j-77\)/.test(v),
  (v.match(/Job selected:.*/)||[''])[0]);
check('…and no client name, address or price is anywhere in it',
  !/Henderson/i.test(v) && !/Private Lane/i.test(v) && !/41250/.test(v) &&
  !/Somewhere Rd/i.test(v) && !/0800 111 222/.test(v));

// ── it must never be the thing that breaks the report ─────────────
v = await pg.evaluate(() => {
  const keep = window.DRAW, keepS = window.S;
  window.DRAW = null; window.S = null;
  let out, threw = false;
  try { out = _fbAutoContext(); } catch(e){ threw = true; out = String(e); }
  window.DRAW = keep; window.S = keepS;
  return { threw, len: (out||'').length, out: (out||'').slice(0,60) };
});
check('with no drawing and no settings it still returns something, and does not throw',
  !v.threw && v.len > 40, v.out);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
