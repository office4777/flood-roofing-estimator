// "When a quote is sent, a 'Sent Quote' button hard-saves what was sent;
//  'Accepted Quote' hard-saves what the customer accepted with their exact
//  selections; both locked. 'Create new draft' starts a fully editable quote,
//  asking to save or overwrite an unsaved draft. 'Saved Drafts' lists them.
//  And a locked job must not let ANY change through — the aerial on the quote
//  could be dragged and a roof switched main / separate / excluded while
//  'Locked' was showing."
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const puts = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if (/\/email\/send-order/.test(u)) return j({ ok:true, queued:true });
  if (m === 'PUT' && /\/jobs\//.test(u)){ puts.push({ u, body: r.request().postDataJSON() }); return j({ id:'job1', updated_at:new Date().toISOString() }); }
  if (/\/fergus/.test(u)) return j({});
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = { list_prices:false, sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}], ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24, screws_each:0.35, rivets_each:0.15, downpipe_ea:150, underlay:{'50':150,'75':210,'100':270}, gutter:{ box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40, ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 }, extras:[] };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {};
  Object.assign(S.quote, { gstRate: 15, ref: '3231', client: 'Matawaia Marae', addr: '1 Marae Rd', email: 'marae@example.co.nz' });
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true}; S.quote.roofExcluded = {};
  S.currentJobId = 'job1'; S.jobLocked = false; S._jobLoaded = { id: 'job1', updatedAt: new Date().toISOString() };
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Matawaia Marae';
  var ja = document.getElementById('jobAddr'); if (ja) ja.value = '1 Marae Rd';
  try { redrawAll(); } catch(e){}
  gotoTab('quote');
}, GEOM);
await pg.waitForTimeout(2200);
const total = () => pg.evaluate(() => Math.round(_quoteMoney().tot * 100) / 100);
const bar = () => pg.evaluate(() => (document.getElementById('qaVersions') || {}).innerText || '');

// ── before anything is sent ──
check('the header row says the quote has not been sent yet', /Not sent yet/.test(await bar()) && /Create new draft/.test(await bar()), (await bar()).slice(0, 80));
check('…and offers no Sent or Accepted button yet', !/Sent Quote|Accepted Quote/.test(await bar()));

// ── email it: the sent quote is frozen ──
const sentTotal = await total();
await pg.evaluate(() => { openQuoteEmail(); document.getElementById('quoteEmailTo').value = 'marae@example.co.nz'; });
await pg.evaluate(() => _quoteEmailSendNow());
await pg.waitForTimeout(800);
let v = await pg.evaluate(() => ({ sent: S.quote.versions && S.quote.versions.sent, bar: document.getElementById('qaVersions').innerText }));
check('THE FEATURE: emailing the quote freezes it as the Sent Quote', !!v.sent && Math.abs(v.sent.total - sentTotal) < 0.02 && !!v.sent.quote && !v.sent.quote.versions, JSON.stringify(v.sent && { total: v.sent.total, at: v.sent.at }));
check('…and the header now has a Sent Quote button', /Sent Quote/.test(v.bar), v.bar.slice(0, 80));
check('…and the screen switches to the sent quote, locked, straight away', await pg.evaluate(() => !!S._qvViewing && S._qvViewing.kind === 'sent' && S.jobLocked));
// Reading it: the wheel over the aerial scrolls, it does not ask.
await pg.evaluate(() => { const f = document.querySelector('#qpRoot .qp-map-frame'); if (f) f.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })); });
await pg.waitForTimeout(150);
check('scrolling over the aerial while viewing it asks nothing and moves nothing', await pg.evaluate(() => !document.getElementById('jobLockModal') && _qpRoofMapView('main').zoom === 1));
await pg.evaluate(() => _qvBackToDraft());
await pg.waitForTimeout(300);

// ── change the draft, then look at the sent quote ──
await pg.evaluate(() => { S.quote.lineItems = (S.quote.lineItems || []).concat([{ desc: 'Extra work after sending', qty: 1, unit: 1000 }]); refreshQuoteProposal(); recalcQuoteTotals(); });
await pg.waitForTimeout(300);
const draftTotal = await total();
check('the draft moved on', draftTotal > sentTotal, sentTotal + ' → ' + draftTotal);
await pg.evaluate(() => _qvView('sent'));
await pg.waitForTimeout(600);
v = await pg.evaluate(() => ({ viewing: S._qvViewing, locked: S.jobLocked, tot: Math.round(_quoteMoney().tot * 100) / 100, bar: document.getElementById('qaVersions').innerText, ref: (document.getElementById('qaTotal') || {}).textContent }));
check('Sent Quote shows exactly the quote that was sent', v.viewing && v.viewing.kind === 'sent' && Math.abs(v.tot - sentTotal) < 0.02, JSON.stringify({ tot: v.tot, sentTotal }));
check('…locked, and saying so in the header', v.locked && /Viewing the sent quote/.test(v.bar) && /cannot be changed/.test(v.bar), v.bar.slice(-120));
const putsBefore = puts.length;
const savedWhileViewing = await pg.evaluate(async () => { const r = await saveCurrentJob({ force: true }); _scheduleAutosave(); return r; });
await pg.waitForTimeout(1500);
check('…and nothing on screen can be saved over the job while it is showing', savedWhileViewing === false && puts.length === putsBefore, puts.length - putsBefore + ' saves');
// a physical attempt while viewing: the question offers a new draft, never unlock
await pg.evaluate(() => { const btn = document.querySelector('#qpRoot button[onclick^="_setRoofMode"]'); if (btn) btn.click(); });
await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); return { asked: !!m, text: m ? m.innerText : '', newDraft: !!(m && m.querySelector('#jobLockNewDraft')), unlock: !!(m && m.querySelector('#jobLockUnlock')) }; });
check('trying to change the sent quote asks for a new draft, and offers no unlock', v.asked && /sent quote/.test(v.text) && v.newDraft && !v.unlock, v.text.slice(0, 80));
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.querySelector('#jobLockKeep').click(); });
await pg.evaluate(() => _qvBackToDraft());
await pg.waitForTimeout(500);
check('Back to draft brings the working draft back as it was', Math.abs((await total()) - draftTotal) < 0.02 && await pg.evaluate(() => !S._qvViewing && !S.jobLocked), String(await total()));

// ── the customer accepts: the accepted quote is frozen too ──
await pg.evaluate(() => { S.quote.proposalOptions = Object.assign({}, S.quote.proposalOptions, { gutterType: 'box125' }); S.quote.accepted = { name: 'Matawaia Marae', at: new Date().toISOString(), total: _quoteMoney().tot }; refreshQuoteProposal(); });
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({ acc: S.quote.versions.accepted, bar: document.getElementById('qaVersions').innerText }));
check('an acceptance freezes the Accepted Quote with the customer\'s selections', !!v.acc && v.acc.quote.proposalOptions.gutterType === 'box125' && v.acc.acceptedBy === 'Matawaia Marae', JSON.stringify(v.acc && { by: v.acc.acceptedBy, gutter: v.acc.quote.proposalOptions.gutterType }));
check('…and the header has an Accepted Quote button', /Accepted Quote/.test(v.bar));
await pg.evaluate(() => { S.quote.proposalOptions.gutterType = 'none'; refreshQuoteProposal(); });
await pg.evaluate(() => _qvView('accepted'));
await pg.waitForTimeout(500);
check('Accepted Quote shows the selections as accepted, not as since changed', await pg.evaluate(() => S._qvViewing.kind === 'accepted' && S.quote.proposalOptions.gutterType === 'box125' && S.jobLocked));
await pg.evaluate(() => _qvBackToDraft());
await pg.waitForTimeout(300);

// ── create a new draft: the unsaved draft is asked about ──
await pg.evaluate(() => _qvNewDraft());
await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const m = document.getElementById('qvAskModal'); return { asked: !!m, btns: m ? Array.from(m.querySelectorAll('button')).map(b => b.textContent) : [] }; });
check('Create new draft with unsaved changes asks: save it, overwrite it, or cancel', v.asked && /Save existing draft/.test(v.btns[0]) && /Overwrite existing draft/.test(v.btns[1]) && /Cancel/.test(v.btns[2]), v.btns.join(' | '));
const oldDraftTotal = await total();
await pg.evaluate(() => document.querySelector('#qvAskModal button[data-i="0"]').click());
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ drafts: S.quote.versions.drafts.length, draftId: S.quote.draftId, viewing: S._qvViewing, locked: S.jobLocked, bar: document.getElementById('qaVersions').innerText, sentKept: !!S.quote.versions.sent, accKept: !!S.quote.versions.accepted }));
check('"Save existing draft" keeps it in Saved Drafts and opens a fresh editable draft', v.drafts === 1 && !!v.draftId && !v.viewing && !v.locked, JSON.stringify(v));
check('…with the sent and accepted quotes untouched', v.sentKept && v.accKept);
check('…and a Saved Drafts drop-down with the date and price', /Saved Drafts \(1\)/.test(v.bar), v.bar.slice(0, 120));
await pg.evaluate(() => { S.quote.lineItems.push({ desc: 'Only on the new draft', qty: 1, unit: 500 }); refreshQuoteProposal(); recalcQuoteTotals(); });
const newDraftTotal = await total();
const savedId = await pg.evaluate(() => S.quote.versions.drafts[0].id);
await pg.evaluate((id) => _qvOpenDraft(id), savedId);
await pg.waitForTimeout(200);
await pg.evaluate(() => { const m = document.getElementById('qvAskModal'); if (m) m.querySelector('button[data-i="1"]').click(); });   // overwrite the new one
await pg.waitForTimeout(500);
check('opening a saved draft brings it back as the working draft', Math.abs((await total()) - oldDraftTotal) < 0.02 && await pg.evaluate((id) => S.quote.draftId === id, savedId), (await total()) + ' vs ' + oldDraftTotal + ' (new draft was ' + newDraftTotal + ')');

// ── the lock stops every change ──
await pg.evaluate(() => { S.jobLocked = true; _jobLockRender(); refreshQuoteProposal(); });
await pg.waitForTimeout(400);
const modeBefore = await pg.evaluate(() => JSON.stringify([S.quote.roofSeparate, S.quote.roofExcluded]));
await pg.evaluate(() => { const btn = Array.from(document.querySelectorAll('#qpRoot button[onclick^="_setRoofMode"]')).find(b => /Exclude|Part of main/i.test(b.textContent)); if (btn) btn.click(); });
await pg.waitForTimeout(200);
v = await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); return { asked: !!m, text: m ? m.innerText : '', unlock: !!(m && m.querySelector('#jobLockUnlock')), modes: JSON.stringify([S.quote.roofSeparate, S.quote.roofExcluded]) }; });
check('THE FIX: switching a roof main / separate / excluded on a locked job asks to unlock', v.asked && /This job is locked — click here to unlock it/.test(v.text) && v.unlock, v.text.slice(0, 80));
check('…and changes nothing', v.modes === modeBefore);
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.querySelector('#jobLockKeep').click(); });
const placeBefore = await pg.evaluate(() => JSON.stringify(_qpRoofMapView('main')));
await pg.evaluate(() => { const f = document.querySelector('#qpRoot .qp-map-frame'); if (f){ f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 })); window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 460, clientY: 420 })); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } });
await pg.waitForTimeout(200);
v = await pg.evaluate(() => ({ asked: !!document.getElementById('jobLockModal'), place: JSON.stringify(_qpRoofMapView('main')) }));
check('dragging the aerial on a locked job asks to unlock and does not move it', v.asked && v.place === placeBefore, v.place + ' vs ' + placeBefore);
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.querySelector('#jobLockKeep').click(); });
// looking is still allowed
await pg.evaluate(() => { gotoTab('pricing'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { const b = document.querySelector('#pricingRoofSwitchBar button, #materialPriceRoofPicker button'); if (b) b.click(); });
await pg.waitForTimeout(200);
check('…while switching which roof the pricing shows is not a change, and asks nothing', await pg.evaluate(() => !document.getElementById('jobLockModal')));
await pg.evaluate(() => { const b = document.querySelector('#profitWrap button[onclick*="_setProfitView"]'); if (b) b.click(); });
check('…nor is switching the profitability view', await pg.evaluate(() => !document.getElementById('jobLockModal')));
await pg.evaluate(() => { const b = document.querySelector('#profitWrap button[onclick*="_profitNudge"]'); if (b) b.click(); });
await pg.waitForTimeout(150);
check('…but nudging GP/hr is, and asks', await pg.evaluate(() => !!document.getElementById('jobLockModal')));
await pg.evaluate(() => { const m = document.getElementById('jobLockModal'); if (m) m.querySelector('#jobLockUnlock').click(); });
check('"Unlock" on the question unlocks', await pg.evaluate(() => !S.jobLocked));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
