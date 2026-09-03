// "Can you add a photo hero empty picture spot for new businesses to put in
// their hero photos."
//
// A brand-new company owns no photos and is not entitled to ours, so the two
// photo bands — the hero across the cover and the crew band under the
// signature — rendered as nothing at all. Correct, but silent: the cover had
// a gap in it and no indication that a photo was meant to go there, which is
// exactly what the screenshots of a fresh account showed.
//
// So the gap now says what it is and takes a photo when clicked. Two things
// this suite holds above all:
//
//   1. It is for the ROOFER's screen. A dashed "Add your photo" box on a
//      quote a customer opens would be worse than the blank space it
//      replaces, so it is struck out of the customer link, the print sheet
//      and the PDF.
//   2. The hero is set ONCE, against the company. A business setting up
//      should not have to choose a hero shot again on every job it prices.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const errs = [];

async function open(branding, co){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/settings/.test(u)) return j({ user_id:'u1', branding: branding,
      quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript((c) => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam Blake' }));
    localStorage.setItem('fr_company', JSON.stringify(c)); }, co);
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
  await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
    finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
    const c=document.getElementById('jobClient'); if(c) c.value='A Customer';
  });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { gotoTab('quote'); try{ setMainScope('reroof'); }catch(e){} });
  await pg.waitForTimeout(2200);
  return { ctx, pg };
}

// How many of the empty frames are on the page, and are they actually visible?
const slots = (pg) => pg.evaluate(() => {
  const els = Array.from(document.querySelectorAll('#qpRoot .qp-photoslot'));
  return { n: els.length,
           visible: els.filter(e => getComputedStyle(e).display !== 'none').length,
           text: els.map(e => e.textContent.replace(/\s+/g,' ').trim()).join(' | ') };
});

// ── a brand-new company ───────────────────────────────────────────
let { ctx, pg } = await open({ company_name:'Acme Roofing Ltd', phone:'09 123 4567',
  email:'office@acmeroofing.co.nz' }, { id:'c2', name:'Acme Roofing Ltd', role:'owner' });
let s = await slots(pg);
check('THE ASK: a new company sees an invitation where the cover photo goes, not a silent gap',
  s.visible >= 1, s.n + ' frames, ' + s.visible + ' visible — ' + s.text.slice(0, 120));
check('…in words that say what to put there', /hero photo/i.test(s.text), s.text.slice(0, 160));
check('…and the closing band offers the same, marked optional',
  /closing photo/i.test(s.text) && /optional/i.test(s.text), s.text.slice(0, 220));

// ── it must never reach the customer ──────────────────────────────
// The three ways a proposal leaves this app, plus the browser's own print.
for (const cls of ['customer-view', 'print-quote', 'pdf-rendering']){
  const hidden = await pg.evaluate((c) => {
    document.documentElement.classList.add(c);
    const els = Array.from(document.querySelectorAll('#qpRoot .qp-photoslot'));
    const vis = els.filter(e => getComputedStyle(e).display !== 'none').length;
    document.documentElement.classList.remove(c);
    return vis;
  }, cls);
  check('THE RULE: the empty frame is gone in ' + cls + ' — a customer never sees "Add your photo"',
    hidden === 0, hidden + ' still showing');
}

// ── setting it once is enough ─────────────────────────────────────
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await pg.evaluate((src) => { S.settings.branding.hero_photo = src; refreshQuoteProposal(); }, PNG);
await pg.waitForTimeout(900);
s = await slots(pg);
const heroShown = await pg.evaluate((src) => {
  const el = document.querySelector('#qpRoot img[src="' + src + '"]');
  return !!el;
}, PNG);
check('THE FIX: a hero photo set against the company shows on the cover', heroShown);
check('…and the invitation for it steps aside once it is filled',
  !/hero photo/i.test(s.text), s.text.slice(0, 120));

// Set once means set once: it is on the company's settings, not this quote's
// slot map, so the next job priced starts with the photo already there.
const scoped = await pg.evaluate(() => ({
  onCompany: !!(S.settings.branding && S.settings.branding.hero_photo),
  onThisQuoteOnly: !!(S.quote && S.quote.imageSlots && S.quote.imageSlots.cover_hero),
}));
check('…and it is stored against the company, so the next quote already has it',
  scoped.onCompany && !scoped.onThisQuoteOnly, JSON.stringify(scoped));

// The empty frame has to have somewhere to go when clicked.
const wired = await pg.evaluate(() => ({
  fn: typeof pickCompanyHero === 'function' && typeof onCompanyHeroFile === 'function',
  input: !!document.getElementById('brHeroFile'),
}));
check('…and clicking the empty frame has a file picker behind it',
  wired.fn && wired.input, JSON.stringify(wired));
await ctx.close();

// ── the account the built-in photos belong to loses nothing ───────
({ ctx, pg } = await open({ company_name:'Flood Roofing LTD', phone:'0800 4 FLOOD',
  email:'office@floodroofing.co.nz' }, { id:'c1', name:'Flood Roofing LTD', role:'owner' }));
s = await slots(pg);
const ownHero = await pg.evaluate(() =>
  !!document.querySelector('#qpRoot img[src*="brand/fleet_trucks.jpg"]'));
check('the company that owns the built-in photos still gets its fleet shot', ownHero);
check('…and is not asked to add one it already has',
  !/hero photo/i.test(s.text), s.text.slice(0, 120));
await ctx.close();

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
