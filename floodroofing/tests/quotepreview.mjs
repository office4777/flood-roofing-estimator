// "in the apps quote tab, i need to see a phone version on the quote too, so
//  have a switcher between computer and phone quote" — and, from the same
//  batch, "the hero photo on the phone should be the same as computer" and
//  the gutter-bracket wording in the owner's own words.
//
// The switch shows the ROOFER the customer's book without sending anything:
// same quote, same figures, framed as a phone in the Quote tab. Three things
// this suite holds above all:
//
//   1. Switching is only a way of LOOKING. The quote is not changed by it,
//      and the switch is never saved with the job.
//   2. The app around the frame keeps working — the phone book's real layer
//      takes the page's scrolling away, and that must not happen here.
//   3. A print or a PDF is always the A4 document, even while the roofer is
//      looking at the phone. The office printed the phone's layout once
//      already (the customer-side bug this file's sibling pins).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const errs = [];
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1',
    branding:{ company_name:'Flood Roofing Ltd', hero_photo:'brand/practice-aerial.jpg',
               phone:'09 430 1234', email:'office@floodroofing.co.nz' },
    quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
  finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  const c = document.getElementById('jobClient'); if (c) c.value = 'Sharon Whittaker';
});
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);

const read = () => pg.evaluate(() => {
  const root = document.getElementById('qpRoot');
  const bb = root.getBoundingClientRect();
  return { book: !!root.querySelector('.qb'),
           a4: root.querySelectorAll('.rp-page').length,
           cls: document.documentElement.classList.contains('qp-phone-preview'),
           w: Math.round(bb.width), h: Math.round(bb.height),
           bodyScrolls: getComputedStyle(document.body).overflow !== 'hidden',
           page: (document.getElementById('qbPage') || {}).getAttribute
                 ? document.getElementById('qbPage').getAttribute('data-qb-page') : null };
});

// ── the switch is there and starts on the computer ──────────────────
const t0 = await pg.evaluate(() => ({
  toggle: !!document.getElementById('qpViewToggle'),
  desk: !!document.getElementById('qpViewBtn_computer'),
  phone: !!document.getElementById('qpViewBtn_phone'),
  noDoc: !document.getElementById('qpViewBtn_doc'),
  style: !!document.getElementById('qsBtn_classic') && !!document.getElementById('qsBtn_modern'),
  deskOn: (document.getElementById('qpViewBtn_computer')||{}).style.fontWeight === '700',
  phoneOn: (document.getElementById('qpViewBtn_phone')||{}).style.fontWeight === '700',
  modernOn: (document.getElementById('qsBtn_modern')||{}).style.fontWeight === '700'
}));
check('the Quote tab carries a Computer / Phone switch and a Classic / Modern style switch — no Document view', t0.toggle && t0.desk && t0.phone && t0.noDoc && t0.style);
check('…and it opens on Computer, in the modern style', t0.deskOn && !t0.phoneOn && t0.modernOn);
const v0 = await read();
check('…showing the customer’s one-page layout, not the A4 stack', !v0.book && v0.a4 === 0 && !!(await pg.$('#qpRoot #qdRoot')), v0.a4 + ' A4 pages');

// ── switching to the phone shows the book, framed as a phone ────────
await pg.evaluate(() => _setQuotePreviewMode('phone'));
await pg.waitForTimeout(800);
const v1 = await read();
check('picking Phone shows the customer’s book', v1.book && v1.a4 === 0);
check('…in a phone-sized frame, not full screen', v1.w > 380 && v1.w < 430 && v1.h > 760 && v1.h < 860,
      v1.w + '×' + v1.h);
check('…and the app around it still scrolls', v1.bodyScrolls);
check('…with the switch now reading Phone', await pg.evaluate(() =>
  (document.getElementById('qpViewBtn_phone')||{}).style.fontWeight === '700'));

// ── the book works inside the frame ─────────────────────────────────
const nav = await pg.evaluate(async () => {
  const keys = _qbPages().map(p => p.key);
  document.getElementById('qbNext').click();
  await new Promise(r => setTimeout(r, 400));
  const after = (document.getElementById('qbPage')||{}).getAttribute('data-qb-page');
  document.getElementById('qbPrev').click();
  await new Promise(r => setTimeout(r, 400));
  const back = (document.getElementById('qbPage')||{}).getAttribute('data-qb-page');
  return { keys, after, back };
});
check('the arrows turn the pages in the frame', nav.after === nav.keys[1] && nav.back === nav.keys[0],
      nav.keys[0] + ' → ' + nav.after + ' → ' + nav.back);

// ── the hero is the SAME photo the paper uses ───────────────────────
const hero = await pg.evaluate(() => {
  const h = document.querySelector('#qpRoot .qb-hero');
  return h ? (h.style.backgroundImage || '') : '';
});
check('the phone’s cover photo is the company hero, same as the computer’s',
      /practice-aerial\.jpg/.test(hero), hero || '(none)');

// ── the gutter-bracket wording, in the owner’s words ────────────────
const br = await pg.evaluate(async () => {
  try { _setProposalOption_gutter('gutter125'); } catch(e){}
  await new Promise(r => setTimeout(r, 600));
  const keys = _qbPages().map(p => p.key);
  _qbGo(keys.indexOf('gutterkit'));
  await new Promise(r => setTimeout(r, 450));
  return [...document.querySelectorAll('#qbPage [data-qb-opt="gutterBracket"]')]
    .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
});
check('internal brackets are described as the typical bracket inside the gutter',
      br.some(t => /typical gutter bracket/i.test(t) && /inside the gutter/i.test(t)), br[0] || '');
check('…and external as stronger, and easier to clean the gutter out',
      br.some(t => /outside of the gutter/i.test(t) && /stronger/i.test(t) && /clean/i.test(t)), br[1] || '');
check('neither still claims it is about the fascia line or install speed',
      !br.some(t => /fascia/i.test(t) || /quicker to fit/i.test(t)), br.join(' | '));

// ── a print is the A4 document even while the phone is on screen ────
const printed = await pg.evaluate(async () => {
  window.__PRINTING_QUOTE = true;
  document.documentElement.classList.remove('qp-phone-preview');
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 500));
  const root = document.getElementById('qpRoot');
  const out = { a4: root.querySelectorAll('.rp-page').length, book: !!root.querySelector('.qb') };
  window.__PRINTING_QUOTE = false;
  document.documentElement.classList.add('qp-phone-preview');
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 500));
  out.backToBook = !!document.getElementById('qpRoot').querySelector('.qb');
  return out;
});
check('a print renders the A4 document, not the phone book', printed.a4 > 0 && !printed.book,
      printed.a4 + ' A4 pages');
check('…and the phone comes back afterwards', printed.backToBook);

// ── the Computer view: the customer's one-page layout, in the card ──
await pg.evaluate(() => _setQuotePreviewMode('computer'));
await pg.waitForTimeout(900);
const vc = await pg.evaluate(() => ({
  qd: !!document.querySelector('#qpRoot #qdRoot'), a4: document.querySelectorAll('#qpRoot .rp-page').length,
  cls: document.documentElement.classList.contains('qp-desk-preview'),
  notCustomerLayer: !document.documentElement.classList.contains('qp-desk'),
  rail: !!document.querySelector('#qpRoot .qd-rail-in'), nav: document.querySelectorAll('#qpRoot #qdNav button').length,
  bodyScrolls: getComputedStyle(document.body).overflow !== 'hidden',
  on: (document.getElementById('qpViewBtn_computer')||{}).style.fontWeight === '700'
}));
check('picking Computer shows the customer’s one-page layout with its rail and nav', vc.qd && vc.a4 === 0 && vc.rail && vc.nav >= 5, JSON.stringify(vc));
check('…as a preview inside the Quote tab, not the customer’s own layer', vc.cls && vc.notCustomerLayer && vc.bodyScrolls && vc.on);
const pc = await pg.evaluate(async () => {
  window.__PRINTING_QUOTE = true; document.documentElement.classList.remove('qp-desk-preview'); refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 400));
  const during = { a4: document.querySelectorAll('#qpRoot .rp-page').length, qd: !!document.getElementById('qdRoot') };
  window.__PRINTING_QUOTE = false; document.documentElement.classList.add('qp-desk-preview'); refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 400));
  return { during, back: !!document.getElementById('qdRoot') };
});
check('a print from the Computer view is still the A4 document', pc.during.a4 > 0 && !pc.during.qd && pc.back, JSON.stringify(pc));

// ── the Classic style: the A4 on a computer, the reflowed A4 on a phone ──
await pg.evaluate(() => _setQuoteStyle('classic'));
await pg.waitForTimeout(900);
const vk = await read();
const vkx = await pg.evaluate(() => ({ style: S.quote.style, editable: document.querySelectorAll('#qpRoot [contenteditable="true"]').length,
  hint: (document.getElementById('qeCardHint')||{}).textContent || '', classicOn: (document.getElementById('qsBtn_classic')||{}).style.fontWeight === '700' }));
check('picking Classic shows the A4 document, editable by clicking, and is saved on the quote', !vk.book && vk.a4 > 0 && !vk.cls && vkx.editable > 0 && vkx.style === 'classic' && vkx.classicOn && /click any text/.test(vkx.hint), JSON.stringify(vkx));
await pg.evaluate(() => _setQuotePreviewMode('phone'));
await pg.waitForTimeout(900);
const vkp = await read();
const vkpx = await pg.evaluate(() => document.documentElement.classList.contains('qp-classic-phone'));
check('…and Classic on the phone is the same A4 reflowed inside the phone frame, not the book', !vkp.book && vkp.a4 > 0 && vkp.cls && vkpx && vkp.w > 380 && vkp.w < 430, vkp.w + 'px');
await pg.evaluate(() => { _setQuoteStyle('modern'); _setQuotePreviewMode('desktop'); });
await pg.waitForTimeout(900);
const v2 = await read();
check('back on Modern, Computer is the one-page layout again ("desktop" still means Computer)', !v2.book && v2.a4 === 0 && !v2.cls && !!(await pg.$('#qpRoot #qdRoot')));

// ── looking is not editing ──────────────────────────────────────────
const clean = await pg.evaluate(() => {
  const before = JSON.stringify(S.quote);
  _setQuotePreviewMode('phone');
  _setQuotePreviewMode('desktop');
  return { same: JSON.stringify(S.quote) === before,
           notSaved: !('previewMode' in (S.quote||{})) && !('qpPreview' in (S.quote||{})) };
});
check('switching how you LOOK does not change the quote', clean.same);
check('…and is not saved onto the job', clean.notSaved);

check('nothing threw anywhere in the Quote tab', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
