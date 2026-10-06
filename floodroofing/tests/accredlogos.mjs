// ACCREDITATION LOGOS (the owner, 2026-10-07): "add into the quote on the
// cover page (over top of the hero photo) and on the last page, small
// photo/logo slots (max of four empty slots) to allow the user to set their
// logos, like I'd like to be able to add my RANZ logo, site wise gold logo and
// lbp logo. If the logo spots are not filled it, don't show the slots on the
// customer quote, also add the photo/logo slots to save as default in the
// branding settings tab".
//
// What this suite holds:
//   • a company that has set none shows the customer NOTHING — no empty slots,
//     no gap, on the cover or the last page. A quote must never show a frame
//     where a credential would go;
//   • the office gets the slots, up to four and no further;
//   • they are COMPANY-WIDE (`branding.accred_logos`), like the cover hero, so
//     setting them on one quote's cover sets them in Settings → Branding and
//     on every quote after it;
//   • the phone's book and the computer's one-page layout agree;
//   • and the A4's old hard-coded "Member of Roofing Association NZ · …" line
//     — printed on EVERY company's cover, whether or not the logos above it
//     were shown — now follows the logos it describes.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1440, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
let settingsPut = null;
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (/\/settings/.test(u)){
    if (m === 'PUT'){ try { settingsPut = JSON.parse(r.request().postData() || '{}'); } catch(e){ settingsPut = null; }
      return j(Object.assign({ user_id:'u1' }, settingsPut || {})); }
    return j({ user_id:'u1', branding:{ company_name:'Kauri Roofing Ltd', phone:'09 430 1234',
      email:'office@kauri.nz' }, quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
  }
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@kauri.nz', name:'Sam Blake' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Kauri Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); });
await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
  finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
  const c = document.getElementById('jobClient'); if (c) c.value = 'Sharon Whittaker';
});
await pg.waitForTimeout(500);
await pg.evaluate(() => { gotoTab('quote'); try { setMainScope('reroof'); } catch(e){} });
await pg.waitForTimeout(2000);

// A stand-in logo, drawn here so the suite needs no image files.
const seed = (n) => pg.evaluate((count) => {
  const logo = (txt) => { const c = document.createElement('canvas'); c.width = 240; c.height = 100;
    const x = c.getContext('2d'); x.fillStyle = '#17407a'; x.fillRect(0, 0, 240, 100);
    x.fillStyle = '#fff'; x.font = 'bold 36px sans-serif'; x.textAlign = 'center';
    x.fillText(txt, 120, 62); return c.toDataURL('image/png'); };
  const names = ['RANZ', 'LBP', 'Sitewise', 'Site Safe', 'Colorsteel'];
  S.settings.branding.accred_logos = [];
  for (let i = 0; i < count; i++) S.settings.branding.accred_logos.push({ src: logo(names[i]), alt: names[i] });
  try { refreshQuoteProposal(); } catch(e){}
  try { _accredSettingsRender(); } catch(e){}
}, n);
// Count what each side of the quote would carry, from the renderers the pages
// are built out of — the cover of the book and of the one-page layout, and the
// last page (the book's "Your total" is the computer's "Review").
const read = () => pg.evaluate(() => {
  const count = (h) => ({ imgs: (String(h).match(/<img/g) || []).length,
                          add: /qb-accred-add/.test(h), x: /qb-accred-x/.test(h), raw: String(h) });
  const grab = () => ({
    cover: count(_qbCover()), deskCover: count(_qdCover()), last: count(_qbSummary()),
  });
  const office = grab();
  window.__CUSTOMER_MODE = true;
  const cust = grab();
  delete window.__CUSTOMER_MODE;
  return { office, cust };
});

// ── nothing set: the customer sees nothing at all ─────────────────
let v = await read();
check('a company that has set no logos shows the customer nothing — no empty slots on the cover',
  v.cust.cover.imgs === 0 && !/qb-accred/.test(v.cust.cover.raw), String(v.cust.cover.imgs));
check('…and nothing on the last page either',
  v.cust.last.imgs === 0 && !/qb-accred/.test(v.cust.last.raw));
check('…while the office is offered one empty slot to fill, on the cover and the last page',
  v.office.cover.add && v.office.last.add && v.office.cover.imgs === 0, JSON.stringify({ c: v.office.cover.add, l: v.office.last.add }));

// ── three set ─────────────────────────────────────────────────────
await seed(3);
v = await read();
check('three logos show on the customer’s cover, over the hero photo',
  v.cust.cover.imgs === 3 && /qb-accred-cover/.test(v.cust.cover.raw), String(v.cust.cover.imgs));
check('…and on the customer’s last page', v.cust.last.imgs === 3 && /qb-accred-foot/.test(v.cust.last.raw), String(v.cust.last.imgs));
check('…with no buttons anywhere in the customer’s copy',
  !v.cust.cover.x && !v.cust.cover.add && !v.cust.last.x && !v.cust.last.add);
check('the phone’s book and the computer’s one page carry exactly the same logos',
  v.cust.cover.imgs === v.cust.deskCover.imgs, JSON.stringify({ book: v.cust.cover.imgs, desk: v.cust.deskCover.imgs }));
check('the office sees the same three with a ✕ each and room for one more',
  v.office.cover.imgs === 3 && v.office.cover.x && v.office.cover.add);

// ── four is the ceiling ───────────────────────────────────────────
await seed(5);
v = await read();
check('four is the most a quote carries, however many are stored, and the office is offered no fifth slot',
  v.cust.cover.imgs === 4 && v.office.cover.imgs === 4 && !v.office.cover.add,
  JSON.stringify({ cust: v.cust.cover.imgs, add: v.office.cover.add }));

// ── one place, not two: the quote's cover and Settings → Branding ─
const inSettings = await pg.evaluate(() => {
  gotoTab('settings');
  try { showSettingsSub('set-branding'); } catch(e){}
  try { refreshSettingsUI(); } catch(e){}
  const host = document.getElementById('brAccredSlots');
  return { imgs: host ? host.querySelectorAll('img').length : -1,
           empty: host ? host.querySelectorAll('button[onclick*="_accredPick"]').length : -1 };
});
check('Settings → Branding shows the same logos the quote does — one store, not two',
  inSettings.imgs === 4 && inSettings.empty === 0, JSON.stringify(inSettings));
const withTwo = await pg.evaluate(() => {
  S.settings.branding.accred_logos = S.settings.branding.accred_logos.slice(0, 2);
  _accredSettingsRender();
  const host = document.getElementById('brAccredSlots');
  return { imgs: host.querySelectorAll('img').length, empty: host.querySelectorAll('button[onclick*="_accredPick"]').length };
});
check('…and fills the rest of the four with empty slots, so it is plain how many there is room for',
  withTwo.imgs === 2 && withTwo.empty === 2, JSON.stringify(withTwo));

// Removing one on the quote removes it for the company — that is the point of
// keeping them in branding rather than on the quote.
const removed = await pg.evaluate(async () => {
  _accredRemove(0);
  await new Promise(r => setTimeout(r, 300));
  const host = document.getElementById('brAccredSlots');
  return { stored: (S.settings.branding.accred_logos || []).length, shown: host.querySelectorAll('img').length };
});
check('removing one from the quote removes it for the company, and Settings follows at once',
  removed.stored === 1 && removed.shown === 1, JSON.stringify(removed));
await pg.waitForTimeout(900);
check('…and it is saved against the company, so the next quote carries them without being told again',
  settingsPut && settingsPut.branding && Array.isArray(settingsPut.branding.accred_logos) &&
  settingsPut.branding.accred_logos.length === 1,
  JSON.stringify({ sent: settingsPut && settingsPut.branding && (settingsPut.branding.accred_logos || []).length }));

// ── the A4's hard-coded claim ─────────────────────────────────────
// It named RANZ, LBP, Site Safe, Sitewise Gold and Colorsteel on every
// company's cover page, gated on nothing, while the logos above it were gated
// to the account that supplied them.
const a4 = await pg.evaluate(async () => {
  const CLAIM = /Member of Roofing Association NZ/;
  // The A4 renders into #qpRoot like everything else; a classic quote while
  // printing is the document itself, not the one-page layout.
  gotoTab('quote');
  S.quote.style = 'classic';
  window.__PRINTING_QUOTE = true;
  const build = async () => { refreshQuoteProposal(); await new Promise(r => setTimeout(r, 250));
    return String(document.getElementById('qpRoot').innerHTML || ''); };
  const own = await build();
  S.settings.branding.accred_logos = [];
  const none = await build();
  delete window.__PRINTING_QUOTE;
  S.quote.style = 'modern';
  refreshQuoteProposal();
  return { withOwn: CLAIM.test(own), withOwnLogos: (own.match(/qb-accred/g) || []).length > 0,
    withNone: CLAIM.test(none), len: own.length };
});
check('a company with its own logos does not also print the built-in five as a line of text',
  a4.withOwn === false && a4.withOwnLogos === true, JSON.stringify(a4));
check('…and a company with none does not assert them either', a4.withNone === false, JSON.stringify(a4));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
