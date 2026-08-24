// The account the built-in photos belong to must lose nothing. Everything the
// tenant-branding fix hides from other companies still has to show for them.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

async function open(branding, co){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/settings/.test(u)) return j({ user_id:'u1', branding: branding,
      quote_defaults:{ next_job_no:'06121' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript((c) => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'aron@floodroofing.co.nz', name:'Aron Flood' }));
    localStorage.setItem('fr_company', JSON.stringify(c)); }, co);
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2800);
  await pg.evaluate(() => { const w=document.getElementById('setupWizard'); if(w) w.remove(); });
  // Something to render a proposal about.
  await pg.evaluate(() => {
    gotoTab('roof'); clearAll(true); setTool('outline');
    DRAW.currentPts = [[120,140],[560,140],[560,460],[120,460]];
    finishCurrent(); DRAW.scaleMetresPerPx = 0.03; autoGenerateRoof('hip');
    const c=document.getElementById('jobClient'); if(c) c.value='A Customer';
  });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { gotoTab('quote'); try{ setMainScope('reroof'); }catch(e){} });
  await pg.waitForTimeout(2200);
  const out = await pg.evaluate(() => {
    const root = document.getElementById('qpRoot');
    return { txt: (root ? root.textContent : '').replace(/\s+/g,' '),
             imgs: Array.from((root||document).querySelectorAll('img,div'))
               .map(e => e.getAttribute('src') || ((e.getAttribute('style')||'').match(/url\(([^)]+)\)/)||[])[1] || '')
               .filter(s => /brand\//.test(s)).map(s => s.replace(/^.*brand\//,'')) };
  });
  return { ctx, pg, out };
}

// ── the owner of the photos ──
let { ctx, out } = await open({ company_name:'Flood Roofing LTD', tagline:'Northland roofing',
  phone:'0800 4 FLOOD', email:'office@floodroofing.co.nz', website:'floodroofing.co.nz',
  gst_number:'120 543 997', address:'Whangarei' }, { id:'c1', name:'Flood Roofing LTD', role:'owner' });
check('their own name is on the proposal', /Flood Roofing LTD/.test(out.txt), out.txt.slice(0,70));
check('…and their own contact details', /0800 4 FLOOD/.test(out.txt) && /floodroofing\.co\.nz/.test(out.txt));
check('…their fleet, crew and logo still render',
  ['fleet_trucks.jpg','logo_square.png','logo_wide_white.png'].some(f => out.imgs.indexOf(f) >= 0),
  JSON.stringify(Array.from(new Set(out.imgs))));
check('…and their accreditation badges still render',
  out.imgs.indexOf('ranz.png') >= 0 && out.imgs.indexOf('sitewise_gold.png') >= 0);
check('…and their salesperson is whoever is signed in', /Aron Flood/.test(out.txt), (out.txt.match(/Prepared by ?([^R]{0,30})/)||[])[0]);
await ctx.close();

// ── anybody else ──
({ ctx, out } = await open({ company_name:'Acme Roofing Ltd', phone:'09 123 4567',
  email:'office@acmeroofing.co.nz' }, { id:'c2', name:'Acme Roofing Ltd', role:'owner' }));
check('a second company sees its own name', /Acme Roofing Ltd/.test(out.txt) && !/Flood Roofing/i.test(out.txt), out.txt.slice(0,70));
check('…and none of the first company\'s photos, logos or badges',
  out.imgs.length === 0, JSON.stringify(Array.from(new Set(out.imgs))));
await ctx.close();

await b.close();
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
