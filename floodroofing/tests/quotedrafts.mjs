// The owner, 2026-09-25:
//  - "Saving anything in the app takes a while, can it save in the
//    background so I can carry on? But make sure it gives a tick and says
//    saved."
//  - "The edit quote template won't let me edit it, it's saying 'This is the
//    sent quote…'; the edit quote template shouldn't edit the open quote, it
//    should edit only saved quotes; when I clicked 'save as' it changed the
//    current open quote."
//  - "Remove the 'new draft' from the 'viewing' button, I only want saved
//    quotes (sent quotes or any drafts that have been worked on) in this list,
//    and when I select one of those don't ask me … just automatically save it
//    as a draft before I switch over, but only if that draft has been worked
//    on. Change 'Select from saved templates' to 'Change quote template' —
//    same rule. Move the 'viewing' button to the left of it."
//  - "I just accidentally clicked push pricing to Fergus — put a cancel
//    button where it says pushing to Fergus."
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
const pg = await (await b.newContext({ viewport:{ width:1500, height:1100 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
const puts = [], voids = [], creates = [];
let putDelay = 0, job2 = null;
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const u = r.request().url(), m = r.request().method();
  const j = (o) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(o) });
  if (/\/fergus\/jobs\/quotes\/[^/]+\/void/.test(u)){ voids.push(u.split('/quotes/')[1].split('/')[0]); return j({ ok: true }); }
  if (/\/fergus\/jobs\/[^/]+\/quotes$/.test(u) && m === 'POST'){ creates.push(1); await new Promise(res => setTimeout(res, 1500)); return j({ data: { id: 'fq77' } }); }
  if (/\/fergus\/jobs\/[^/]+\/quotes$/.test(u)) return j({ data: [] });
  if (/\/fergus/.test(u)) return j({});
  if (m === 'PUT' && /\/settings/.test(u)) return j(r.request().postDataJSON());
  if (m === 'PUT' && /\/jobs\//.test(u)){ const body = r.request().postDataJSON(); puts.push({ u, body, at: Date.now() }); if (putDelay) await new Promise(res => setTimeout(res, putDelay)); return j({ id: u.split('/jobs/')[1].split('/')[0].split('?')[0], updated_at: new Date().toISOString() }); }
  if (m === 'GET' && /\/jobs\/job2(\?|$)/.test(u)) return j(job2);
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {}; S.settings.branding = S.settings.branding || {};
  S.settings.branding.quote_templates = [{ id: 'tplShort', name: 'Short quote', tpl: { style: 'modern', modernOrder: [], modernParked: ['profile', 'thickness'], coverTitle: 'Short one' } }];
  window.__settingsLive = true;
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx;
  S.quote = defaultQuote();
  Object.assign(S.quote, { gstRate: 15, ref: '3265', client: 'Megan Smith', addr: '27A Mission Road', email: 'megan@example.co.nz' });
  S.currentJobId = 'job1'; S.jobLocked = false; S._jobLoaded = { id: 'job1', updatedAt: new Date().toISOString() };
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Megan Smith';
  var ja = document.getElementById('jobAddr'); if (ja) ja.value = '27A Mission Road';
  gotoTab('quote');
}, GEOM);
await pg.waitForTimeout(2000);

// ── the header ──
const hd = await pg.evaluate(() => {
  const v = document.querySelector('#qaViewingHost #qvViewingMenu'), t = document.getElementById('qaTplMenu');
  const vr = v && v.querySelector('summary').getBoundingClientRect(), tr = t && t.querySelector('summary').getBoundingClientRect();
  const items = v ? [...v.querySelectorAll('.qv-menu-list button')].map(x => x.textContent) : [];
  return { viewing: !!v, leftOf: !!(vr && tr && vr.right <= tr.left + 1), sameRow: !!(vr && tr && Math.abs((vr.top + vr.bottom) / 2 - (tr.top + tr.bottom) / 2) < 6),
           tplLabel: t ? t.querySelector('summary').textContent.trim() : '', items: items.join(' | '),
           row2: (document.getElementById('qaVersions') || {}).innerText || '' };
});
check('the Viewing button sits in the header, on the template button’s row, to its left', hd.viewing && hd.leftOf && hd.sameRow, JSON.stringify(hd));
check('the template button reads "Change quote template"', /^Change quote template/.test(hd.tplLabel), hd.tplLabel);
check('the Viewing list has no "New draft" or "Save this draft" — saved quotes only', !/New draft|Save this draft/.test(hd.items), hd.items);

// ── change template on an untouched default quote: nothing kept ──
const ct1 = await pg.evaluate(async () => {
  S.quote.condPhotos = [{ src: 'data:image/png;base64,AAAA', offX: 0, offY: 0, zoom: 1 }];   // a photo on the default draft …
  S.quote.tplFp = _qContentFp(S.quote);                                                       // … that came with it (untouched)
  const totalBefore = Math.round(_quoteMoney().tot);
  _qChangeTemplate('tplShort');
  await new Promise(r => setTimeout(r, 400));
  return { asked: !!document.getElementById('qvAskModal'), drafts: S.quote.versions.drafts.length, name: S.quote.templateName, parked: S.quote.modernParked,
           photos: (S.quote.condPhotos || []).length, client: S.quote.client, total: Math.round(_quoteMoney().tot), totalBefore,
           viewing: (document.getElementById('qvViewingMenu') || { textContent: '' }).querySelector('summary').textContent };
});
check('Change quote template on an untouched draft: no question, and nothing saved as a draft', !ct1.asked && ct1.drafts === 0, JSON.stringify(ct1));
check('…the new draft wears the template and says so on Viewing', ct1.name === 'Short quote' && JSON.stringify(ct1.parked) === '["profile","thickness"]' && /Short quote/.test(ct1.viewing), JSON.stringify(ct1));
check('…with the job’s client and pricing, not the old draft’s photos', ct1.client === 'Megan Smith' && ct1.photos === 0 && ct1.total === ct1.totalBefore, JSON.stringify(ct1));

// ── worked on → kept, silently ──
const ct2 = await pg.evaluate(async () => {
  S.quote.custDesc = ['Our own wording for this roof'];
  _qChangeTemplate('__default');
  await new Promise(r => setTimeout(r, 400));
  const v = S.quote.versions;
  return { asked: !!document.getElementById('qvAskModal'), drafts: v.drafts.length, keptDesc: v.drafts[0] && _qvQuoteOf(v.drafts[0]).custDesc, now: S.quote.custDesc || null,
           msg: (document.getElementById('qaMsg') || {}).textContent || '', list: [...document.querySelectorAll('#qvViewingMenu .qv-menu-list button')].map(x => x.textContent).join(' | ') };
});
check('a worked-on draft is saved as a draft by itself before the template changes — no question', !ct2.asked && ct2.drafts === 1 && JSON.stringify(ct2.keptDesc) === '["Our own wording for this roof"]' && !ct2.now, JSON.stringify(ct2));
check('…it says where it went, and the Viewing list offers it', /kept as Draft 1/.test(ct2.msg) && /Draft 1/.test(ct2.list), ct2.msg + ' || ' + ct2.list);

// ── open a saved draft from Viewing: the worked-on one on screen is kept ──
const od = await pg.evaluate(async () => {
  S.quote.custExcl = ['Downpipes'];                          // work on the current draft
  const id = S.quote.versions.drafts[0].id;
  _qvOpenDraft(id);
  await new Promise(r => setTimeout(r, 300));
  return { asked: !!document.getElementById('qvAskModal'), drafts: S.quote.versions.drafts.length, open: S.quote.draftId === id, desc: S.quote.custDesc,
           kept: S.quote.versions.drafts.some(d => JSON.stringify(_qvQuoteOf(d).custExcl) === '["Downpipes"]') };
});
check('opening a saved draft asks nothing, keeps the worked-on one and opens the chosen', !od.asked && od.drafts === 2 && od.open && od.kept && JSON.stringify(od.desc) === '["Our own wording for this roof"]', JSON.stringify(od));

// ── the template editor edits a copy — on a SENT quote too ──
const ed = await pg.evaluate(async () => {
  S.quote.versions.sent = _qvSnapshot('Sent quote'); _qvPackAll();
  _qvView('sent');
  await new Promise(r => setTimeout(r, 300));
  const before = JSON.stringify({ parked: S.quote.modernParked, order: S.quote.modernOrder, style: S.quote.style });
  const job = S.quote;
  document.getElementById('qaEditTplBtn').click();
  await new Promise(r => setTimeout(r, 500));
  const lockAsked = !!document.getElementById('jobLockModal');
  const open = !!_QT.open, copy = S.quote !== job;
  _qtModernPark && _qtModernPark('grade');
  S.quote.modernParked = (S.quote.modernParked || []).concat(['grade']);
  const putsBefore = window.__putCount || 0;
  _qtClose();
  await new Promise(r => setTimeout(r, 400));
  return { lockAsked, open, copy, back: S.quote === job, viewing: !!S._qvViewing, unchanged: JSON.stringify({ parked: S.quote.modernParked, order: S.quote.modernOrder, style: S.quote.style }) === before };
});
check('Edit quote template opens on a sent quote — no "This is the sent quote" question', !ed.lockAsked && ed.open, JSON.stringify(ed));
check('…it works on a copy, and Done hands back the quote on screen unchanged', ed.copy && ed.back && ed.unchanged && ed.viewing, JSON.stringify(ed));
const nPuts = puts.length;
const ed2 = await pg.evaluate(async () => {
  _qvBackToDraft();
  const job = JSON.stringify({ parked: S.quote.modernParked, name: S.quote.templateName });
  _qtOpen();
  await new Promise(r => setTimeout(r, 400));
  S.quote.modernParked = ['grade', 'colour'];
  window.prompt = () => 'Very short quote';
  await _qtSaveAsNamed();
  await new Promise(r => setTimeout(r, 300));
  _scheduleAutosave();
  _qtClose();
  await new Promise(r => setTimeout(r, 400));
  const t = (S.settings.branding.quote_templates || []).find(x => x.name === 'Very short quote');
  return { saved: !!t && JSON.stringify(t.tpl.modernParked) === '["grade","colour"]', jobSame: JSON.stringify({ parked: S.quote.modernParked, name: S.quote.templateName }) === job };
});
await pg.waitForTimeout(2600);
check('"Save as" in the editor saves a TEMPLATE and leaves the quote on screen as it was', ed2.saved && ed2.jobSame, JSON.stringify(ed2));
check('…and nothing the editor did was written to the job', puts.slice(nPuts).every(p => !p.body.draw_state || JSON.stringify((p.body.draw_state.state.quote || {}).modernParked) !== '["grade","colour"]'), (puts.length - nPuts) + ' saves');

// ── a slow save ends on a tick ──
putDelay = 900;
const tick = await pg.evaluate(async () => {
  S.quote.custDesc = ['A change to save'];
  const p = saveCurrentJob();
  await new Promise(r => setTimeout(r, 600));
  const pill = document.getElementById('workingPill'), during = pill && pill.classList.contains('on') ? pill.textContent : '';
  await p; await new Promise(r => setTimeout(r, 60));
  const after = pill && pill.classList.contains('on') ? pill.textContent : '', ok = pill && pill.classList.contains('ok');
  await new Promise(r => setTimeout(r, 2000));
  return { during, after, ok, gone: !pill.classList.contains('on') };
});
check('a save that takes a moment shows Saving…, then a green tick with "Saved" and the time, then goes', /Saving/.test(tick.during) && /✓\s*Saved \d/.test(tick.after) && tick.ok && tick.gone, JSON.stringify(tick));

// ── switching jobs does not wait for the save ──
putDelay = 2500;
job2 = await pg.evaluate(() => { const s = snapshotCurrentJob(); const c = JSON.parse(JSON.stringify(s)); c.form = Object.assign({}, c.form, { jobClient: 'Somebody Else', jobNo: '3300' }); return { id: 'job2', client_name: 'Somebody Else', site_address: '1 Other St', draw_state: c, updated_at: new Date().toISOString() }; });
const sw = await pg.evaluate(async () => {
  S.quote.custDesc = ['Typed just before switching'];
  DRAFTS._lastSnapJson = null;
  const t0 = performance.now();
  await openJob('job2');
  const ms = Math.round(performance.now() - t0);
  return { ms, now: S.currentJobId, pill: (document.getElementById('workingPill') || {}).textContent || '' };
});
check('opening another job goes ahead at once — the last one saves in the background', sw.now === 'job2' && sw.ms < 2300 && /Saving/.test(sw.pill), JSON.stringify(sw));
await pg.waitForTimeout(3200);
const bg = puts.filter(p => /\/jobs\/job1/.test(p.u)).pop();
const pillAfter = await pg.evaluate(() => (document.getElementById('workingPill') || {}).textContent || '');
check('…the save lands with THAT job’s work, and the pill says it was saved', !!bg && JSON.stringify(bg.body.draw_state.state.quote.custDesc) === '["Typed just before switching"]' && /Saved/.test(pillAfter), pillAfter);
putDelay = 0;

// ── push to Fergus: Cancel ──
const fc = await pg.evaluate(async () => {
  S.linkedJobId = 'fj1'; S.jobLocked = false; S.settings.jms_keys = { fergus: 'k'.repeat(40) };
  S.quote.lineItems = [{ desc: 'Labour', qty: 1, unit: 5000 }];
  const rev0 = S.quote.fergusQuoteRev || 0;
  const p = pushQuotePricingToFergus(null, {});
  await new Promise(r => setTimeout(r, 700));
  const btn = document.getElementById('workingCancel');
  const had = !!btn && getComputedStyle(document.getElementById('workingPill')).pointerEvents !== 'none';
  if (btn) btn.click();
  await p;
  return { had, msg: (document.getElementById('qaMsg') || {}).textContent || '', rev: S.quote.fergusQuoteRev || 0, rev0, sentMark: !!(S.fergusSent && S.fergusSent.quote) };
});
check('pushing to Fergus shows a Cancel on the pill', fc.had, JSON.stringify(fc));
check('…Cancel stops it: the version Fergus had just made is voided again, and it says so', voids.includes('fq77') && /cancelled/i.test(fc.msg) && /voided again/.test(fc.msg) && fc.rev === fc.rev0 && !fc.sentMark, JSON.stringify({ fc, voids }));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
