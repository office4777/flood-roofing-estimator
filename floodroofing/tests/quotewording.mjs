// THE SECTION DESCRIPTIONS ARE THE OFFICE'S TO WORD, AND A QUOTE CAN CARRY
// NOTES (the owner, 2026-10-18).
//
//   "on the quote tab, make the rest of the sections descriptions editable
//    just like you have with the quote description so that I can just click
//    it to edit it ... Do this for the steel grade, roof profile, steel
//    thickness, roof colour, guttering, the old roofing"
//   "then in the quotes edit description can you add a 'notes' section which
//    should be a orange/yellow title colour with a orange/yellow caution
//    symbol on each of the notes I add in"
//
// Both halves are pinned on the office's own screen AND on the customer's,
// because the two must not disagree and the customer must never be offered
// the office's editing furniture.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

// ── the office ───────────────────────────────────────────────────
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2400);

// ── (1) every one of the six sections offers its own description ──
const secs = await pg.evaluate(() => {
  const got = {};
  [...document.querySelectorAll('#qpRoot [data-qe-sec]')].forEach(el => {
    got[el.getAttribute('data-qe-sec')] = {
      text: el.textContent.trim().slice(0, 60),
      editable: el.isContentEditable,
      marked: el.classList.contains('qe-edit'),
      hasDefault: !!(el.getAttribute('data-qe-def') || '').length,
    };
  });
  return { keys: Object.keys(got).sort(), got };
});
check('the steel grade, roof profile, steel thickness, roof colour, guttering and the old roofing each carry their own editable description',
  ['colour','disposal','grade','gutter','profile','thickness'].every(k => secs.keys.includes(k)),
  JSON.stringify(secs.keys));
check('…each one a real text box the office clicks into, marked as editable',
  Object.values(secs.got).every(x => x.editable && x.marked && x.hasDefault),
  JSON.stringify(secs.got));
check('…and until it is reworded it reads the standard wording, not a blank',
  (secs.got.grade || {}).text && /coating on the steel/i.test(secs.got.grade.text),
  JSON.stringify((secs.got.grade || {}).text));

// ── (2) rewording one keeps it, and only it ──────────────────────
const edited = await pg.evaluate(async () => {
  const el = document.querySelector('#qpRoot [data-qe-sec="grade"]');
  el.focus();
  el.textContent = 'This roof is 300 m from the tide, so the grade matters more here than it does inland.';
  el.blur();
  await new Promise(r => setTimeout(r, 500));
  const after = document.querySelector('#qpRoot [data-qe-sec="grade"]');
  return {
    stored: JSON.parse(JSON.stringify(S.quote.sectionDesc || null)),
    onPage: after ? after.textContent.trim() : '',
    others: [...document.querySelectorAll('#qpRoot [data-qe-sec]')]
      .filter(x => x.getAttribute('data-qe-sec') !== 'grade')
      .every(x => x.textContent.trim() === (x.getAttribute('data-qe-def') || '').trim()),
  };
});
check('a reworded section is kept on the quote…',
  edited.stored && edited.stored.grade && /300 m from the tide/.test(edited.stored.grade) &&
  Object.keys(edited.stored).length === 1,
  JSON.stringify(edited.stored));
check('…shown on the page in place of the standard wording', /300 m from the tide/.test(edited.onPage), edited.onPage);
check('…and every other section is left exactly as it was', edited.others, '');

// EMPTYING IT PUTS THE STANDARD WORDING BACK, and so does typing the
// standard wording in — the custDesc rule, so a later change to the built-in
// still reaches a quote nobody really reworded.
const cleared = await pg.evaluate(async () => {
  const el = document.querySelector('#qpRoot [data-qe-sec="grade"]');
  const def = el.getAttribute('data-qe-def');
  el.focus(); el.textContent = ''; el.blur();
  await new Promise(r => setTimeout(r, 500));
  const a = { stored: S.quote.sectionDesc ? JSON.parse(JSON.stringify(S.quote.sectionDesc)) : null,
              text: (document.querySelector('#qpRoot [data-qe-sec="grade"]') || {}).textContent || '' };
  const el2 = document.querySelector('#qpRoot [data-qe-sec="profile"]');
  const def2 = el2.getAttribute('data-qe-def');
  el2.focus(); el2.textContent = def2; el2.blur();
  await new Promise(r => setTimeout(r, 500));
  a.afterTypingDefault = S.quote.sectionDesc ? JSON.parse(JSON.stringify(S.quote.sectionDesc)) : null;
  a.def = def.slice(0, 40);
  return a;
});
check('emptying a section description puts the standard wording back and drops the key',
  cleared.stored == null && cleared.text.indexOf(cleared.def) === 0, JSON.stringify(cleared));
check('…and so does typing the standard wording back word for word',
  cleared.afterTypingDefault == null, JSON.stringify(cleared.afterTypingDefault));

// ── (3) NOTES ────────────────────────────────────────────────────
const noted = await pg.evaluate(async () => {
  _qdescOpen(); await new Promise(r => setTimeout(r, 250));
  const m = document.getElementById('qdescModal');
  const out = {
    hasNoteList: !!document.getElementById('qdescNoteList'),
    addBtn: [...m.querySelectorAll('.qdesc-ft button')].map(x => x.textContent.trim()),
    headings: [...m.querySelectorAll('.qdesc-sub')].map(x => x.textContent.trim().split(' ')[0]),
    noteHdOrange: (function(){
      const h = m.querySelector('.qdesc-sub-note');
      return h ? getComputedStyle(h).color : '';
    })(),
  };
  _qdescAdd('n');
  _qdescSet(0, 'Access is over the neighbour’s lawn — we will lay boards', 'n');
  _qdescAdd('n');
  _qdescSet(1, 'The scaffold stays up for about a fortnight after the roof is on', 'n');
  out.marker = (m.querySelector('.qdesc-row-n .qdesc-n') || {}).textContent || '';
  _qdescSave();
  await new Promise(r => setTimeout(r, 600));
  out.stored = JSON.parse(JSON.stringify(S.quote.custNotes || null));
  const rows = [...document.querySelectorAll('#qpRoot .qb-note-row')];
  out.rows = rows.map(r => r.textContent.trim());
  out.hd = (document.querySelector('#qpRoot .qb-note-hd') || {}).textContent || '';
  out.hdColour = rows.length ? getComputedStyle(document.querySelector('#qpRoot .qb-note-hd')).color : '';
  out.iconColour = rows.length ? getComputedStyle(rows[0].querySelector('svg')).color : '';
  out.hasIcon = rows.length ? !!rows[0].querySelector('svg path') : false;
  return out;
});
const amber = (c) => { const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c || ''); if (!m) return false;
  const [r, g, bl] = [ +m[1], +m[2], +m[3] ]; return r > 150 && g > 50 && g < 190 && bl < 110 && (r - bl) > 90; };
check('Edit description has a Notes list of its own, with its own Add button',
  noted.hasNoteList && noted.addBtn.some(t => /Add note/i.test(t)) && noted.headings.includes('Notes'),
  JSON.stringify({ btns: noted.addBtn, heads: noted.headings }));
check('…its heading is amber, and each row is marked with a caution sign',
  amber(noted.noteHdOrange) && noted.marker === '⚠',
  JSON.stringify({ colour: noted.noteHdOrange, marker: noted.marker }));
check('the notes are kept on the quote', (noted.stored || []).length === 2, JSON.stringify(noted.stored));
check('…and shown on the proposal under their own "Please note" heading',
  /Please note/i.test(noted.hd) && noted.rows.length === 2 && /neighbour/.test(noted.rows[0]),
  JSON.stringify({ hd: noted.hd, rows: noted.rows }));
check('…in amber, each with a caution symbol',
  amber(noted.hdColour) && amber(noted.iconColour) && noted.hasIcon,
  JSON.stringify({ hd: noted.hdColour, icon: noted.iconColour }));

// A quote with NO notes reads exactly as it did — no heading, no empty box.
const none = await pg.evaluate(async () => {
  delete S.quote.custNotes;
  refreshQuoteProposal();
  await new Promise(r => setTimeout(r, 400));
  return { hd: !!document.querySelector('#qpRoot .qb-note-hd'), rows: document.querySelectorAll('#qpRoot .qb-note-row').length };
});
check('a quote with no notes shows no heading and no empty box', !none.hd && none.rows === 0, JSON.stringify(none));

// What the customer is sent carries both, and none of the office's furniture.
const sendable = await pg.evaluate(() => {
  S.quote.custNotes = ['Access is over the neighbour’s lawn'];
  S.quote.sectionDesc = { grade: 'Three hundred metres from the tide.' };
  return JSON.parse(JSON.stringify({ custNotes: S.quote.custNotes, sectionDesc: S.quote.sectionDesc,
    inContentKeys: Q_CONTENT_KEYS.includes('custNotes') && Q_CONTENT_KEYS.includes('sectionDesc'),
    inFreshDrop: Q_FRESH_DROP.includes('custNotes') && Q_FRESH_DROP.includes('sectionDesc') }));
});
check('both ride with the quote’s own content (kept by a draft, dropped by a fresh one)',
  sendable.inContentKeys && sendable.inFreshDrop, JSON.stringify(sendable));
check('nothing on the office screen threw', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();

// ── the customer ─────────────────────────────────────────────────
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#5d6970"/></svg>');
const q = {
  ref:'FR-30130', client:'Sharon Whittaker', addr:'14 Kamo Road, Whangarei',
  date:'19/09/2026', validUntil:'30 days', gstRate:15, coverTitle:'Whittaker Residence',
  condMaterial:'Corrugate Colorsteel', condAge:'34 years', condPhotos:[{ src:PHOTO, caption:'North face' }],
  baseGrade:'maxam', materialBase:9200, gutterLm:48, gutterLines:4, scaffoldBase:4200,
  custNotes:['Access is over the neighbour’s lawn — we will lay boards'],
  sectionDesc:{ grade:'This roof is 300 m from the tide, so the grade matters more here.' },
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate', steelThickness:'40',
                    colour:'', gutterType:'none', gutterBracket:'internal', downpipes:'no', disposal:'dispose' },
  lineItems:[{ desc:'Strip and re-roof', qty:1, unit:31200 }], total:31200,
};
const cctx = await b.newContext({ viewport:{ width:1366, height:850 } });
const cpg = await cctx.newPage();
const cerrs = []; cpg.on('pageerror', e => cerrs.push(e.message));
cpg.on('dialog', d => d.accept());
await cpg.route('**/api.mapbox.com/**', r => r.abort());
await cpg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ quote:q, branding:{ company_name:'Flood Roofing Ltd', phone:'09 430 1234', email:'office@floodroofing.co.nz' } }) });
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await cpg.goto('file://' + DIR + '/app.html?q=tok&j=' + q.ref);
await cpg.waitForTimeout(3200);
const cust = await cpg.evaluate(() => ({
  customer: !!window.__CUSTOMER_MODE,
  notes: [...document.querySelectorAll('#qpRoot .qb-note-row')].map(r => r.textContent.trim()),
  grade: (document.querySelector('#qd-grade .qb-para') || {}).textContent || '',
  editable: document.querySelectorAll('#qpRoot [data-qe-sec]').length,
  prompts: document.querySelectorAll('#qpRoot .qb-para-empty').length,
  anyPromptText: /Click to write/.test(document.getElementById('qpRoot').textContent),
}));
check('the customer reads the office’s own section wording',
  cust.customer && /300 m from the tide/.test(cust.grade), JSON.stringify(cust.grade));
check('…and the notes, under their own heading',
  cust.notes.length === 1 && /neighbour/.test(cust.notes[0]), JSON.stringify(cust.notes));
check('…with none of the office’s editing furniture: nothing to click into, no empty prompts',
  cust.editable === 0 && cust.prompts === 0 && !cust.anyPromptText, JSON.stringify(cust));
check('nothing on the customer screen threw', cerrs.length === 0, cerrs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
