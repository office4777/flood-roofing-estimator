// The owner (2026-09-23): "allow me to remove any of the default selections,
// also allow me to add a custom temporary profile using an 'add profile
// option' button which adds it for this particular job, also allow to upload
// a picture of this profile, add an 'add to saved profiles' option … make
// sure the profile picture carries through to both the roof colour and roof
// profile sections. also when a roof profile is selected that has no saved
// profile picture, don't default to show the corrugate profile … allow me to
// click on that colour again to unselect it … the your quote final summary
// section … make it the same width as the rest".
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
  if (/\/settings/.test(u)) return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@floodroofing.co.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => { gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]]; finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip'); });
await pg.waitForTimeout(600);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(1500);

// ── nothing in the window is locked ──
const w = await pg.evaluate(() => { _qselOpen('profile');
  const boxes = [...document.querySelectorAll('#qselList input[type=checkbox]')];
  const out = { n: boxes.length, disabled: boxes.filter(b => b.disabled).length, add: !!document.querySelector('#qselList .qsel-add'),
           picBtns: document.querySelectorAll('#qselList .qsel-picbtn').length };
  _qselClose(); return out; });
check('the Edit roof profiles window locks nothing — the standard and the picked profile can both be unticked', w.n >= 2 && w.disabled === 0, JSON.stringify(w));
check('…every profile has a picture button, and there is an Add profile option button', w.add && w.picBtns === w.n, JSON.stringify(w));

// ── untick the standard profile while it is picked: the pick moves ──
const moved = await pg.evaluate(async () => {
  S.quote.proposalOptions = S.quote.proposalOptions || {}; _setProposalOption_profile('corrugate');
  _qselOpen('profile'); _qselToggle('profiles', 'corrugate', false); _qselSave();
  await new Promise(r => setTimeout(r, 300));
  return { pick: S.quote.proposalOptions.profile, offered: _selProfiles().map(x => x.id) };
});
check('taking Corrugate off moves the pick to the next profile still offered', moved.pick === '5rib' && moved.offered.indexOf('corrugate') < 0, JSON.stringify(moved));
const last = await pg.evaluate(() => { _qselOpen('profile'); _qselToggle('profiles', '5rib', false);
  const msg = (document.querySelector('#qselModal .qsel-msg') || {}).textContent || '';
  const still = document.querySelector('#qselList input[data-qsel-id="5rib"]').checked; _qselClose(); return { msg, still }; });
check('…but the last profile cannot come off — the window says so', last.still && /Keep at least one/.test(last.msg), JSON.stringify(last));

// ── thickness: the standard 0.40 can come off too (on corrugate — 5-Rib has
// its own locked gauge page) ──
const th = await pg.evaluate(async () => { delete S.quote.selHide; _setProposalOption_profile('corrugate'); _qselOpen('thickness'); _qselToggle('thickness', '40', false); _qselSave();
  await new Promise(r => setTimeout(r, 300));
  return { pick: S.quote.proposalOptions.steelThickness, page: _qbThickness().indexOf('0.40 gauge') >= 0 }; });
check('taking 0.40 off moves the gauge to 0.55 and the page no longer offers 0.40', th.pick === '55' && !th.page, JSON.stringify(th));
await pg.evaluate(() => { delete S.quote.selHide; _setProposalOption_profile('corrugate'); _setProposalOption_thickness('40'); });

// ── + Add profile option, for this job only, with a picture ──
const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const add1 = await pg.evaluate(async (pic) => {
  const saved0 = _selKindList('profiles').length;
  _qselOpen('profile'); document.querySelector('#qselList .qsel-add').click();
  document.getElementById('qpfName').value = 'Dimond DP955';
  document.getElementById('qpfCover').value = '955';
  _qpfPicSet(null, pic);
  document.querySelector('#qpfModal .qa-btn-primary').click();
  await new Promise(r => setTimeout(r, 300));
  const cp = (S.quote.customProfiles || [])[0] || {};
  const html = document.getElementById('qselList') ? document.getElementById('qselList').innerHTML : '';
  _qselClose();
  return { cp: { id: cp.id, name: cp.name, cover: cp.coverMm, img: cp.img === pic, custom: cp.custom }, pick: S.quote.proposalOptions.profile,
           savedGrew: _selKindList('profiles').length !== saved0, inWindow: /Dimond DP955/.test(html) && /this job only|picked on this quote/.test(html),
           colourHtml: _qbColour(), profileHtml: _qbProfile() };
}, PIC);
check('Add profile option puts the profile on THIS quote, picked, with its cover and picture — not on the saved list',
  add1.cp.name === 'Dimond DP955' && add1.cp.cover === 955 && add1.cp.img && add1.cp.custom && add1.pick === add1.cp.id && !add1.savedGrew,
  JSON.stringify(add1.cp) + ' pick ' + add1.pick);
check('…the window lists it straight away', add1.inWindow);
check('…and its picture shows on the Roof profile section AND the Roof colour section',
  /qb-fig-photo/.test(add1.profileHtml) && add1.profileHtml.indexOf(PIC) >= 0 && /qb-fig-photo/.test(add1.colourHtml) && add1.colourHtml.indexOf(PIC) >= 0);
check('…with no corrugate drawing beside it', !/762mm cover/.test(add1.colourHtml) && !/762mm cover/.test(add1.profileHtml));

// A profile with no picture is not drawn as corrugate
const nopic = await pg.evaluate(async () => {
  _qpfOpen(); document.getElementById('qpfName').value = 'Plain tray'; document.getElementById('qpfCover').value = '500';
  _qpfAdd(); await new Promise(r => setTimeout(r, 300));
  return { fig: _qbProfileFigure(S.quote.proposalOptions.profile), colour: /762mm cover|qb-fig/.test(_qbColour()), corr: /762mm cover/.test(_qbProfileFigure('corrugate')) };
});
check('a picked profile with no picture shows no figure at all on the colour section — never the corrugate drawing', nopic.fig === '' && !nopic.colour, JSON.stringify(nopic));
check('…while Corrugate itself still gets its drawing', nopic.corr);

// Add to saved profiles
const add2 = await pg.evaluate(async () => {
  const n0 = (S.quote.customProfiles || []).length, s0 = _selKindList('profiles').length, pick0 = S.quote.proposalOptions.profile;
  _qpfOpen(); document.getElementById('qpfName').value = 'Trimrib 800'; document.getElementById('qpfCover').value = '800';
  document.getElementById('qpfSave').checked = true; document.getElementById('qpfPickIt').checked = false;
  _qpfAdd(); await new Promise(r => setTimeout(r, 300));
  return { savedGrew: _selKindList('profiles').length === s0 + 1, quoteSame: (S.quote.customProfiles || []).length === n0,
           offered: _selProfiles().some(x => x.name === 'Trimrib 800'), pickKept: S.quote.proposalOptions.profile === pick0 };
});
check('"Add to saved profiles" puts it on the company list instead, offered here too, and Select it unticked leaves the pick alone', add2.savedGrew && add2.quoteSame && add2.offered && add2.pickKept, JSON.stringify(add2));

// A picture added to a SAVED profile from the window
const savedPic = await pg.evaluate((pic) => { _qpfPicSet('5rib', pic);
  return { img: (_selKindList('profiles').filter(x => x.id === '5rib')[0] || {}).img === pic, fig: _qbProfileFigure('5rib').indexOf(pic) >= 0 }; }, PIC);
check('a picture added to a saved profile is kept with the saved profile and replaces its drawing', savedPic.img && savedPic.fig, JSON.stringify(savedPic));

// ── a second click on the chosen colour takes it off ──
const col = await pg.evaluate(() => { _setProposalOption_colour('Titania'); const a = S.quote.proposalOptions.colour;
  _setProposalOption_colour('Titania'); const b = S.quote.proposalOptions.colour;
  _setProposalOption_colour('Titania'); _setProposalOption_colour('Ebony'); const c = S.quote.proposalOptions.colour;
  _setProposalOption_colour('Ebony');
  return { a, b, c, picks: String(_qbPicksList()) }; });
check('clicking the chosen colour again unselects it; clicking another still switches', col.a === 'Titania' && col.b === '' && col.c === 'Ebony', JSON.stringify(col));
check('…and an unselected colour is not in the customer’s picks', !/Ebony|Titania/.test(col.picks), col.picks.slice(0, 200));

// ── the review is as wide as the other sections ──
const wide = await pg.evaluate(() => { const s = document.createElement('section'); s.className = 'qd-sec qd-sec-review';
  const b = document.createElement('div'); b.className = 'qb-body'; s.appendChild(b); document.body.appendChild(s);
  const mw = getComputedStyle(b).maxWidth; s.remove(); return mw; });
check('the Your quote summary is not held narrower than the rest', wide === 'none', wide);

// ── the cover's Swap photo (2026-09-23): "a swap photo button which then
// opens the upload from pc … zoom and move the picture inside the slot" ──
const cov = await pg.evaluate(async (pic) => {
  const before = { tools: /qb-hero-tools/.test(_qdCover()) && /Swap photo/.test(_qdCover()), own: /qb-hero-img/.test(_qdCover()) };
  _qbCoverSet(pic);
  const after = { desk: _qdCover().indexOf(pic) >= 0 && /qb-hero-img/.test(_qdCover()), book: _qbCover().indexOf(pic) >= 0 && /qb-hero-img/.test(_qbCover()),
                  src: _qbHeroSrc() === pic, zoomBtns: /Zoom in/.test(_qdCover()) };
  _qbCoverZoom(0.5); const z = S.quote.coverPhoto.zoom;
  // drag on the rendered computer preview
  try { _setQuotePreviewMode('desk'); } catch(e){}
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 700));
  const hero = document.querySelector('#qpRoot .qb-hero-own');
  let dragged = null;
  if (hero){
    const r = hero.getBoundingClientRect();
    hero.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + 40, clientY: r.top + 40 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 40 + r.width / 10, clientY: r.top + 40 }));
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    dragged = { x: S.quote.coverPhoto.offX, img: (hero.querySelector('img[data-cover-img]') || {}).style.transform || '' };
  }
  window.__CUSTOMER_MODE = true;
  const cust = { img: _qdCover().indexOf(pic) >= 0, tools: /qb-hero-tools|onmousedown/.test(_qdCover()) };
  window.__CUSTOMER_MODE = false;
  _qbCoverReset(); const reset = JSON.stringify([S.quote.coverPhoto.offX, S.quote.coverPhoto.offY, S.quote.coverPhoto.zoom]);
  _qbCoverRemove();
  return { before, after, z, dragged, cust, reset, gone: !S.quote.coverPhoto && !/qb-hero-img/.test(_qdCover()) };
}, PIC);
check('the cover carries a Swap photo button in the office', cov.before.tools && !cov.before.own, JSON.stringify(cov.before));
check('…a swapped photo shows on the computer AND the phone cover, and is the quote’s hero', cov.after.desk && cov.after.book && cov.after.src && cov.after.zoomBtns, JSON.stringify(cov.after));
check('…it zooms', Math.abs(cov.z - 1.5) < 1e-9, String(cov.z));
check('…and moves when dragged inside the frame (a tenth of the width = 10%)', !!cov.dragged && Math.abs(cov.dragged.x - 10) < 0.6 && /translate\((9\.[5-9]|10)/.test(cov.dragged.img), JSON.stringify(cov.dragged));
check('…the customer sees the photo where the office put it, with no tools and no dragging', cov.cust.img && !cov.cust.tools, JSON.stringify(cov.cust));
check('…Reset puts it back square, and × goes back to the standard cover photo', cov.reset === '[0,0,1]' && cov.gone, cov.reset);

// ── Delete this page on the guttering and the old roofing (2026-09-23) ──
const del = await pg.evaluate(async () => {
  S.quote.modernParked = [];
  const links = { gutter: /qb-sec-del/.test(_qbGutter()) && /qb-sec-del/.test(_qdGutter()), disposal: /qb-sec-del/.test(_qbDisposal()) };
  _setProposalOption_gutter('box125'); await new Promise(r => setTimeout(r, 300));
  const priced = _qpSelectionChanges().some(c => /Box Gutter/i.test(c.label));
  _qbSectionRemove('gutter'); _qbSectionRemove('disposal'); await new Promise(r => setTimeout(r, 300));
  const out = { links, priced,
    gutterPick: S.quote.proposalOptions.gutterType, stillPriced: _qpSelectionChanges().some(c => /Box Gutter/i.test(c.label)),
    deskKeys: _qdSections().map(x => x.key), bookKeys: _qbPages().map(x => x.key),
    picks: String(_qbPicksList()), placeholders: _qdWithPlaceholders(_qdSections()).filter(x => x.parked).map(x => x.key) };
  _qbSectionInsert('gutter'); _qbSectionInsert('disposal'); await new Promise(r => setTimeout(r, 200));
  out.back = _qdSections().map(x => x.key).filter(k => k === 'gutter' || k === 'disposal');
  return out;
});
check('the Guttering (phone and computer) and Old roof sections carry "Delete this page from this quote"', del.links.gutter && del.links.disposal, JSON.stringify(del.links));
check('…deleting them takes them off the computer and the phone, with Insert placeholders where they were',
  del.deskKeys.indexOf('gutter') < 0 && del.deskKeys.indexOf('disposal') < 0 && del.bookKeys.indexOf('gutter') < 0 && del.bookKeys.indexOf('gutterkit') < 0 && del.bookKeys.indexOf('disposal') < 0 &&
  del.placeholders.indexOf('gutter') >= 0 && del.placeholders.indexOf('disposal') >= 0, JSON.stringify(del));
check('…a gutter that was picked comes out of the price with its page, and neither shows in the customer’s choices',
  del.priced && del.gutterPick === 'none' && !del.stillPriced && !/Guttering|old roofing/.test(del.picks), JSON.stringify({ p: del.gutterPick, s: del.stillPriced }));
check('…and Insert puts both back', del.back.length === 2, JSON.stringify(del.back));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
