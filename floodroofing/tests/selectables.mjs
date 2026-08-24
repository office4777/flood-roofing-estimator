// The products a roofing business sells — steel grades, roof profiles, gutters
// — used to be three hard-coded constants, so every subscriber sold exactly
// what Flood Roofing sells. They are a per-company list now.
//
// Two things this suite exists to hold:
//
//   Some picks carry RULES, not just a price. A profile can lock a steel gauge
//   (5-Rib is 0.55 only). A gutter lifts the site to platform scaffolding,
//   +25%, and sets the external-bracket rate. A product added without those
//   answers would quote without the upgrade — a real under-quote — so they are
//   fields on the product, and they have to actually drive the pricing.
//
//   A quote already SENT names its products by id. Removing or repricing one
//   afterwards must not change what the customer holding that link sees.
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
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

// ── an untouched account still sells what it always did ───────────
let v = await pg.evaluate(() => ({
  grades: _selGrades().map(g => g.id),
  profiles: _selProfiles().map(p => p.id),
  gutters: _selGutters().map(g => g.id),
  base: _selBaseGradeId(),
}));
check('an account that has never opened this still has the shipped products',
  v.grades.join() === 'maxam,colorzen,colourcote,zincalume' &&
  v.profiles.join() === 'corrugate,5rib' &&
  v.gutters.join() === 'box125,marley_typhoon,marley_classic', JSON.stringify(v.gutters));
check('…with MAXAM as the grade everything else is measured against', v.base === 'maxam');
check('…and the shipped percentages intact',
  await pg.evaluate(() => _selGradePctOf('zincalume') === -0.327 && _selGradePctOf('maxam') === 0));

// ── the rules actually drive the pricing ──────────────────────────
v = await pg.evaluate(() => {
  S.quote = S.quote || {}; S.quote.scaffoldBase = 4000;
  S.quote.proposalOptions = { gutterType: 'box125', gutterBracket: 'external' };
  const withUplift = _qpSelectionChanges().find(c => /Platform scaffolding/.test(c.label));
  // now say this particular gutter does NOT need the platform
  _selWorking().gutters.find(g => g.id === 'box125').scaffoldUplift = false;
  const without = _qpSelectionChanges().find(c => /Platform scaffolding/.test(c.label));
  _selWorking().gutters.find(g => g.id === 'box125').scaffoldUplift = true;
  return { with: withUplift ? withUplift.delta : null, without: without ? without.delta : null };
});
check('a gutter that needs platform scaffolding charges the 25% uplift',
  v.with === 1000, '$' + v.with + ' on a $4000 scaffold');
check('…and one marked as not needing it charges nothing',
  v.without == null, String(v.without));

v = await pg.evaluate(() => {
  const before = _selProfileLocksGauge('5rib');
  S.quote.proposalOptions = { profile: '5rib' };
  const locked = _qpSelectionChanges().some(c => /supplied in 0\.55 gauge/.test(c.label));
  return { before, locked };
});
check('a profile that locks a gauge says so and carries the upgrade',
  v.before === '55' && v.locked, 'locksGauge=' + v.before);

// ── a product the roofer adds prices with its own rules ───────────
v = await pg.evaluate(() => {
  _selWorking().gutters.push({ id:'g_custom', name:'Continuous spouting', scaffoldUplift:true, extBracketLm:4.5, desc:'x' });
  _selWorking().grades.push({ id:'gr_custom', name:'House brand steel', pct:-0.2 });
  S.quote.proposalOptions = { gutterType:'g_custom', gutterBracket:'external' };
  return {
    inList: _selGutters().map(g => g.id).includes('g_custom'),
    bracket: _bracketExtPerLm('g_custom'),
    uplift: _qpSelectionChanges().some(c => /Platform scaffolding/.test(c.label)),
    named: _qpSelectionChanges().some(c => c.label === 'Continuous spouting'),
    gradePct: _selGradePctOf('gr_custom'),
    gradeLabel: _gradeLabel('gr_custom'),
  };
});
check('a gutter the roofer adds appears in the list', v.inList);
check('…charges ITS bracket rate, not a shipped one', v.bracket === 4.5, '$' + v.bracket + '/lm');
check('…and still triggers the scaffolding uplift when ticked', v.uplift);
check('…and is named on the quote by the name they gave it', v.named);
check('a grade they add prices off its own percentage',
  v.gradePct === -0.2 && v.gradeLabel === 'House brand steel', v.gradeLabel + ' ' + v.gradePct);

// ── removing hides from NEW quotes but still resolves ─────────────
v = await pg.evaluate(() => {
  const i = _selWorking().gutters.findIndex(g => g.id === 'marley_classic');
  _selRemove('gutters', i);
  return { live: _selGutters().map(g => g.id).includes('marley_classic'),
           resolves: !!_selGutterOf('marley_classic'),
           stillNamed: (_selGutterOf('marley_classic') || {}).name };
});
check('a removed gutter drops out of what a new quote offers', !v.live);
check('…but a quote that already names it can still resolve it',
  v.resolves && /Marley Classic/.test(v.stillNamed || ''), v.stillNamed);

v = await pg.evaluate(() => {
  const i = _selWorking().grades.findIndex(g => g.id === 'maxam');
  _selRemove('grades', i);          // the base grade — must be refused
  return _selGrades().map(g => g.id).includes('maxam');
});
check('the base grade cannot be removed out from under the others', v);

// ── a SENT quote keeps the products it was sent with ──────────────
v = await pg.evaluate(() => {
  // stamp a snapshot the way sending does, then change the settings underneath
  S.quote.selectablesSnapshot = JSON.parse(JSON.stringify(S.settings.selectables));
  const sentPct = _selGradePctOf('zincalume');
  S.settings.selectables.grades.find(g => g.id === 'zincalume').pct = -0.9;
  S.settings.selectables.gutters.find(g => g.id === 'box125').removed = true;
  return { sentPct, afterRepricing: _selGradePctOf('zincalume'),
           boxStillOffered: _selGutters().map(g => g.id).includes('box125') };
});
check('repricing a grade does not move a quote already sent',
  v.sentPct === -0.327 && v.afterRepricing === -0.327, 'sent ' + v.sentPct + ', now reads ' + v.afterRepricing);
check('…and removing a gutter does not pull it out of that quote', v.boxStillOffered);

v = await pg.evaluate(() => {
  delete S.quote.selectablesSnapshot;      // a fresh quote sees the new settings
  return { pct: _selGradePctOf('zincalume'), box: _selGutters().map(g => g.id).includes('box125') };
});
check('a NEW quote does see the change', v.pct === -0.9 && !v.box, 'pct ' + v.pct + ', box offered=' + v.box);

// ── the settings screen renders and edits ─────────────────────────
await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-products'); renderSelectablesUI(); });
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const t = (document.getElementById('selectablesUI') || {}).textContent || '';
  return { drew: t.length, grades: /Steel grades/.test(t), profiles: /Roof profiles/.test(t),
           gutters: /Gutter profiles/.test(t), rules: /Locks gauge/.test(t) && /Scaffold/.test(t) };
});
check('the Products screen draws all three lists', v.grades && v.profiles && v.gutters, v.drew + ' chars');
check('…and exposes the rules as fields, not just names and prices', v.rules);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
