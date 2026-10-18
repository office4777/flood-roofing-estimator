// THE GUTTER IS A PRODUCT THE CUSTOMER CAN SEE, AND ITS BRACKETS ARE NOT A
// MARGIN NOTE (the owner, 2026-10-18):
//
//   "can you allow me to add a picture of the gutter profiles just like i can
//    for the sheet profiles, allow me to do this both in the settings and in
//    the gutter edit button on the quote. make sure the profile is displayed
//    for the gutter in the gutter section like the profile picture in the
//    profile section in the quote, only show the gutter profile selected,
//    then when gutter is selected, don't squeeze the brackets/downpipes
//    selection in next to it, instead add this in underneath in new section
//    boxes so it feels natural and doesn't get squeezed in"
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const PIC = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2b6ea8"/></svg>');

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

// SETTINGS: the gutter rows offer a picture, the way the roof profiles do.
const set = await pg.evaluate(async () => {
  gotoTab('settings'); switchSettingsSub('set-products'); renderSelectablesUI();
  await new Promise(r => setTimeout(r, 400));
  const out = { heads: [], gutterPic: 0, profilePic: 0 };
  document.querySelectorAll('.settings-sub .set-sec').forEach(sec => {
    const hd = (sec.querySelector('.set-sec-hd') || {}).textContent || '';
    const pic = /picture/i.test((sec.querySelector('thead') || {}).textContent || '');
    out.heads.push(hd.trim().split('\n')[0] + (pic ? ' [pic]' : ''));
  });
  out.gutterBtns = [...document.querySelectorAll('button')]
    .filter(x => /_qpfPicPick\([^)]*'gutters'/.test(x.getAttribute('onclick') || '')).length;
  out.profileBtns = [...document.querySelectorAll('button')]
    .filter(x => /_qpfPicPick\('[^']+'\)/.test(x.getAttribute('onclick') || '')).length;
  return out;
});
check('Settings → Gutter profiles has a Picture column, like Roof profiles',
  set.heads.some(h => /gutter profile/i.test(h) && /\[pic\]/.test(h)) &&
  set.heads.some(h => /roof profile/i.test(h) && /\[pic\]/.test(h)),
  JSON.stringify(set.heads));
check('…with an add-a-picture button on every gutter row',
  set.gutterBtns >= 3, JSON.stringify({ gutters: set.gutterBtns, profiles: set.profileBtns }));

// A picture put on a gutter sticks, and is not mistaken for a profile's.
const put = await pg.evaluate(async (pic) => {
  gotoTab('quote');
  await new Promise(r => setTimeout(r, 600));
  const g = _selGutters()[0];
  _qpfPicSet(g.id, pic, 'gutters');
  await new Promise(r => setTimeout(r, 300));
  return {
    id: g.id,
    onGutter: !!(_selGutters().filter(x => x.id === g.id)[0] || {}).img,
    onProfile: _selProfiles().some(p => p.img === pic),
  };
}, PIC);
check('a picture set on a gutter lands on the gutter, and on no profile',
  put.onGutter && !put.onProfile, JSON.stringify(put));

// The quote's own "Edit gutter selections" window offers it too.
const win = await pg.evaluate(async () => {
  _qselOpen('gutter'); await new Promise(r => setTimeout(r, 350));
  const btns = [...document.querySelectorAll('#qselModal .qsel-picbtn')];
  const out = { n: btns.length, kinds: btns.map(x => (/_qpfPicPick\('[^']*','([^']*)'\)/.exec(x.getAttribute('onclick') || '') || [])[1]) };
  _qselClose();
  return out;
});
check('"Edit gutter selections" offers a picture on every gutter',
  win.n >= 3 && win.kinds.every(k => k === 'gutters'), JSON.stringify(win));

// THE SECTION: the picked gutter's picture, and brackets underneath.
const sec = await pg.evaluate(async (pic) => {
  const g = _selGutters()[0];
  _qpfPicSet(g.id, pic, 'gutters');
  S.quote.proposalOptions = S.quote.proposalOptions || {};
  S.quote.proposalOptions.gutterType = 'none';
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 500));
  const none = {
    keys: _qdSections().map(s => s.key),
    fig: document.querySelectorAll('#qd-gutter .qb-fig-photo').length,
  };
  S.quote.proposalOptions.gutterType = g.id;
  refreshQuoteProposal(); await new Promise(r => setTimeout(r, 500));
  const kitSec = document.getElementById('qd-gutterkit');
  const gutSec = document.getElementById('qd-gutter');
  const picked = {
    keys: _qdSections().map(s => s.key),
    fig: document.querySelectorAll('#qd-gutter .qb-fig-photo img').length,
    figSrcIsGutter: (document.querySelector('#qd-gutter .qb-fig-photo img') || {}).src === pic,
    allFigs: document.querySelectorAll('#qd-gutter .qb-fig-photo').length,
    grid2: document.querySelectorAll('#qd-gutter .qd-grid2').length,
    subBoxes: kitSec ? kitSec.querySelectorAll('.qb-sub').length : 0,
    kitBelow: !!(kitSec && gutSec && (gutSec.compareDocumentPosition(kitSec) & Node.DOCUMENT_POSITION_FOLLOWING)),
    gutW: gutSec ? Math.round(gutSec.getBoundingClientRect().width) : 0,
    kitW: kitSec ? Math.round(kitSec.getBoundingClientRect().width) : 0,
  };
  return { none, picked };
}, PIC);
check('with no gutter picked there is no picture and no brackets section',
  sec.none.fig === 0 && !sec.none.keys.includes('gutterkit'), JSON.stringify(sec.none.keys));
check('picking a gutter shows THAT gutter’s picture, and only one picture',
  sec.picked.fig === 1 && sec.picked.allFigs === 1 && sec.picked.figSrcIsGutter,
  JSON.stringify(sec.picked));
check('Brackets & downpipes is a section of its OWN, underneath the guttering',
  sec.picked.keys.includes('gutterkit') && sec.picked.kitBelow && sec.picked.grid2 === 0,
  JSON.stringify({ keys: sec.picked.keys, below: sec.picked.kitBelow, grid: sec.picked.grid2 }));
check('…full width, not half of the gutter’s row',
  sec.picked.kitW > 0 && Math.abs(sec.picked.kitW - sec.picked.gutW) < 40,
  JSON.stringify({ gutter: sec.picked.gutW, kit: sec.picked.kitW }));
check('…with the brackets and the downpipes each in their own box',
  sec.picked.subBoxes === 2, JSON.stringify({ boxes: sec.picked.subBoxes }));
check('nothing on the office screen threw', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
