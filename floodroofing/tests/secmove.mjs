// MOVE A QUOTE SECTION UP OR DOWN, AND THE LINE EDITOR ON THE LEFT
// (2026-11-05, the owner: "move the attached 'edit: [line name]' window to the
// left side, because it's always behind a picture. then have a up/down arrow
// in the quotes sections so i can re oragnize a section be jumping it up or
// down one section at a time").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1500, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: /\/settings/.test(r.request().url()) ? '{"branding":{"company_name":"Flood Roofing"}}' : '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_tour_done','1'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2500);

// The line editor sits on the left of the canvas
let v = await pg.evaluate(() => { const p = document.getElementById('propPanel'); return { left: p.style.left, right: p.style.right }; });
check('the "Edit: line" window sits on the LEFT of the canvas, clear of the Photos panel', v.left === '12px' && !v.right, JSON.stringify(v));

const order = () => pg.evaluate(() => Array.from(document.querySelectorAll('#qpRoot [data-qd-sec]')).map(s => s.getAttribute('data-qd-sec')));
await pg.evaluate(async () => {
  _resetQuoteForFreshJob({ client:'Ann Test', addr:'1 Test Road' });
  S.quote.style = 'modern';
  gotoTab('quote'); await new Promise(r => setTimeout(r, 400));
  try { _setQuotePreviewMode('desk'); } catch(e){}
  try { _closePricingPanel(); } catch(e){}
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 300));
});
const o1 = await order();
v = await pg.evaluate(() => {
  const has = k => !!document.querySelector('#qpRoot [data-qd-sec="' + k + '"] [data-qd-move]');
  const secs = Array.from(document.querySelectorAll('#qpRoot [data-qd-sec]')).map(s => s.getAttribute('data-qd-sec'));
  return { cover: has('cover'), proposal: has('proposal'), last: has(secs[secs.length - 1]), grade: has('grade'), profile: has('profile') };
});
check('every section between the proposal and the total carries ↑ ↓; the cover, proposal and total do not', v.grade && v.profile && !v.cover && !v.proposal && !v.last, JSON.stringify(v));
const firstMv = o1[o1.indexOf('proposal') + 1];
v = await pg.evaluate((k) => { const bs = document.querySelectorAll('#qpRoot [data-qd-move="' + k + '"] button'); return [bs[0].disabled, bs[1].disabled]; }, firstMv);
check('the first movable section cannot go up past the proposal', v[0] === true && v[1] === false, firstMv + ' ' + JSON.stringify(v));

await pg.click('#qpRoot [data-qd-move="grade"] button[aria-label="Move down"]'); await pg.waitForTimeout(250);
const o2 = await order();
const gi = o1.indexOf('grade');
check('↓ swaps the section with the one below it', o2[gi] === o1[gi + 1] && o2[gi + 1] === 'grade' && o2.length === o1.length, JSON.stringify([o1, o2]));
await pg.click('#qpRoot [data-qd-move="grade"] button[aria-label="Move up"]'); await pg.waitForTimeout(250);
const o3 = await order();
check('↑ puts it back', JSON.stringify(o3) === JSON.stringify(o1), JSON.stringify(o3));
await pg.click('#qpRoot [data-qd-move="profile"] button[aria-label="Move up"]'); await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({ order: S.quote.modernOrder, book: _qbPages().map(p => p.key) }));
check('the order is saved on the quote and the phone book follows it', v.order.indexOf('profile') < v.order.indexOf('grade') &&
  v.book.indexOf('profile') < v.book.indexOf('grade'), JSON.stringify(v));

v = await pg.evaluate(async () => { window.__CUSTOMER_MODE = true; refreshQuoteProposal(); await new Promise(r => setTimeout(r, 200));
  const n = document.querySelectorAll('#qpRoot [data-qd-move]').length; window.__CUSTOMER_MODE = false; refreshQuoteProposal(); return n; });
check('the customer never sees the arrows', v === 0, String(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
