// "my aron@floodroofing.co.nz main account seems to have lost its fergus
//  connection and saved jobs"
//
// It had not. The phone was signed in as a different login, and an empty
// board looks exactly the same whether the work has gone or you are simply
// somebody else — the cached company branding still renders either way.
// Nothing on screen could answer "whose account am I in", so the only way to
// find out was to guess. That cost a morning of worrying about lost jobs.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();

async function open(user){
  const ctx = await b.newContext({ viewport:{width:1400,height:950} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/settings/.test(r.request().url())) return j({ user_id:'u1',
      branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} });
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.addInitScript((u) => { try {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
    localStorage.setItem('fr_settings','null');
    if (u) localStorage.setItem('fr_user', JSON.stringify(u));
    else localStorage.removeItem('fr_user');
  } catch(e){} }, user);
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2600);
  return { ctx, pg, errs };
}

// It lives above Sign out now, labelled "Signed in as". The first two homes
// went: a row in the info grid (removed at the owner's request) and a copy
// under the logo in white-on-white, which nobody could see.
let o = await open({ email:'aron@floodroofing.co.nz', name:'Aron Flood' });
let v = await o.pg.evaluate(() => {
  const cell = document.getElementById('navAccountWho');
  const nav = document.getElementById('navSignOutBtn');
  const r = nav && nav.getBoundingClientRect(), c = cell && cell.getBoundingClientRect();
  return { text: cell ? cell.textContent : null, title: cell ? cell.title : '',
           label: cell ? ((cell.previousElementSibling || {}).textContent || '') : '',
           color: cell ? getComputedStyle(cell).color : '',
           aboveSignOut: !!(c && r && c.bottom <= r.top + 1 && c.height > 8),
           signOutOnScreen: !!(r && r.bottom <= window.innerHeight && r.width > 0) };
});
check('the sidebar says which login this is', v.text === 'aron@floodroofing.co.nz', JSON.stringify(v));
check('…labelled, directly above Sign out', /Signed in as/i.test(v.label) && v.aboveSignOut, JSON.stringify(v));
check('…in ink you can read, not white-on-white', v.color && !/rgba?\(255, 255, 255/.test(v.color), v.color);
check('…saying so on hover too', /Signed in as/.test(v.title) && /Aron Flood/.test(v.title), v.title);
check('…without pushing Sign out off the bottom of the nav', v.signOutOnScreen, JSON.stringify(v));
await o.ctx.close();

// The case that started this: a different login, same company branding.
o = await open({ email:'test+solo@floodroofing.co.nz', name:'Test Solo' });
v = await o.pg.evaluate(() => ({
  who: (document.getElementById('navAccountWho') || {}).textContent || '',
  co: (document.getElementById('hdrCompany') || {}).textContent || '',
}));
check('a different login shows a different address, not the company name',
  v.who === 'test+solo@floodroofing.co.nz', v.who);
check('…even while the company branding is the same, which is the whole trap',
  /Flood Roofing/.test(v.co), v.co.slice(0, 60));
await o.ctx.close();

// Signed out / nothing stored: no address is invented.
o = await open(null);
v = await o.pg.evaluate(() => ({ who: (document.getElementById('navAccountWho') || {}).textContent || '' }));
check('with nobody signed in no address is shown', !/@/.test(v.who), JSON.stringify(v));
check('no page errors', o.errs.length === 0, o.errs.join(' | '));
await o.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
