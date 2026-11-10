// THE GAUGE LOCK (2026-11-11, the owner):
//   "when I clicked on the roof profile 5 rib and selected no for locks gauge,
//    the quote still locks the gauge" — the thickness section asked "is it
//    5-Rib?" and never the setting; it asks the setting now.
//   "add an edit ... thickness button. So I could bypass my rule of locking 5
//    rib to ... 0.55 gauge" — S.quote.gaugeLockOff, Edit thickness / Lock again.
//   "when the gauge is locked, can you not show the quote summary the extra
//    cost for 0.55 gauge ... just combine it to the main scope of work price
//    ... only ... if the customer opts to select to upgrade to 0.55 gauge".
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  window.__DEFAULT_QUOTE_STYLE = 'modern'; });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);
await pg.evaluate(() => { const m = document.getElementById('_rsModal'); if (m) { try { m._rsClose(); } catch(e){ m.remove(); } } });

const read = () => pg.evaluate(() => {
  refreshQuoteProposal();
  const sec = document.getElementById('qd-thickness') || document;
  const t = sec.textContent || '';
  const rows = _custBarRows();
  const num = v => parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')) || 0;
  const base = rows.find(r => r.kind === 'base'), tot = rows.find(r => r.kind === 'total');
  return { locked: /Locked for 5-Rib/.test(t), choices: sec.querySelectorAll('.qb-opt:not(.qb-opt-static)').length,
    edit: !!sec.querySelector('.qb-gauge-edit'), btn: (sec.querySelector('.qb-gauge-edit') || {}).textContent || '',
    th: (S.quote.proposalOptions || {}).steelThickness, rows: rows.map(r => r.label + ' ' + r.value),
    base: num(base && base.value), total: num(tot && tot.value), gaugeRow: rows.some(r => /0\.55|supplied in/i.test(r.label)) };
});

// 1. 5-Rib, locked: nothing to choose, Included, and the summary has no 0.55 line
await pg.evaluate(() => { _setProposalOption_profile('corrugate'); });
const corr = await read();
await pg.evaluate(() => { _setProposalOption_profile('5rib'); });
let v = await read();
const lockDelta = await pg.evaluate(() => { const c = _qpSelectionChanges().find(x => /supplied in/.test(x.label)); return c ? c.delta : 0; });
check('5-Rib locked: the thickness section says so and offers nothing to choose', v.locked && v.choices === 0 && v.th === '55', JSON.stringify(v).slice(0, 200));
check('…the summary has NO separate 0.55 / 5-Rib-gauge line — it is in the main scope', !v.gaugeRow && lockDelta > 0, JSON.stringify(v.rows));
check('…the main line grew by exactly that money and the total is the same total',
  Math.abs((v.base - corr.base) - lockDelta * 1.15) < 0.02 && Math.abs((v.total - corr.total) - lockDelta * 1.15) < 0.02,
  JSON.stringify({ base: [corr.base, v.base], total: [corr.total, v.total], lockDelta }));
check('…and the office has an Edit thickness button on it', v.edit && /Edit thickness/.test(v.btn), v.btn);

// 2. Locks gauge set to No in Settings: the quote follows
await pg.evaluate(() => { const i = _selKindList('profiles').findIndex(p => p.id === '5rib'); _selEdit('profiles', i, 'locksGauge', ''); });
v = await read();
check('Locks gauge = No in Settings: the quote offers 0.40 and 0.55 on 5-Rib', !v.locked && v.choices >= 2, JSON.stringify(v).slice(0, 200));
await pg.evaluate(() => { const i = _selKindList('profiles').findIndex(p => p.id === '5rib'); _selEdit('profiles', i, 'locksGauge', '55'); _setProposalOption_profile('5rib'); });

// 3. Edit thickness: this quote only, back to 0.40, the customer chooses
await pg.evaluate(() => document.querySelector('#qd-thickness .qb-gauge-edit').click());
await pg.waitForTimeout(150);
v = await read();
check('Edit thickness unlocks THIS quote: 0.40 picked, both offered, a Lock-again button', !v.locked && v.choices >= 2 && v.th === '40' && /Lock 5-Rib to its gauge again/.test(v.btn), JSON.stringify(v).slice(0, 220));
check('…and Settings is untouched', await pg.evaluate(() => _selProfileLocksGaugeRaw('5rib') === '55' && S.quote.gaugeLockOff === true));
await pg.evaluate(() => _setProposalOption_thickness('55'));
v = await read();
check('…a 0.55 the customer CHOOSES shows as its own upgrade line', v.rows.some(r => /^0\.55 gauge steel \+/.test(r)), JSON.stringify(v.rows));
await pg.evaluate(() => document.querySelector('#qd-thickness .qb-gauge-edit').click());
await pg.waitForTimeout(150);
v = await read();
check('Lock again puts the rule back: 0.55, locked, no separate line', v.locked && v.th === '55' && !v.gaugeRow && !(await pg.evaluate(() => 'gaugeLockOff' in S.quote)), JSON.stringify(v).slice(0, 200));

// 4. Never for the customer, never on an accepted quote
v = await pg.evaluate(() => {
  window.__CUSTOMER_MODE = true; refreshQuoteProposal();
  const c = document.querySelectorAll('#qpRoot .qb-gauge-edit').length;
  window.__CUSTOMER_MODE = false;
  S.quote.accepted = { at: new Date().toISOString(), name: 'X' }; refreshQuoteProposal();
  const a = document.querySelectorAll('#qpRoot .qb-gauge-edit').length;
  _qGaugeUnlock(); const stillLocked = !S.quote.gaugeLockOff;
  delete S.quote.accepted; refreshQuoteProposal();
  return { c, a, stillLocked };
});
check('the customer never sees the button, nor does an accepted quote, and an accepted quote cannot be unlocked', v.c === 0 && v.a === 0 && v.stillLocked, JSON.stringify(v));
check('the switch rides with the quote’s content keys', await pg.evaluate(() => Q_CONTENT_KEYS.indexOf('gaugeLockOff') >= 0 && Q_FRESH_DROP.indexOf('gaugeLockOff') >= 0));
check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
