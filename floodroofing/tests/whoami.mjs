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

let o = await open({ email:'aron@floodroofing.co.nz', name:'Aron Flood' });
let v = await o.pg.evaluate(() => {
  const row = document.getElementById('hdrSignedInRow');
  const cell = document.getElementById('hdrSignedIn');
  return { shown: getComputedStyle(row).display !== 'none', text: cell.textContent,
           title: cell.title, label: row.textContent };
});
check('the sidebar says which login this is', v.shown && v.text === 'aron@floodroofing.co.nz', JSON.stringify(v));
check('…labelled so it reads as an answer, not a stray address',
  /Signed in/i.test(v.label), v.label);
check('…with the person\'s name on hover', /Aron Flood/.test(v.title), v.title);
await o.ctx.close();

// The case that started this: a different login, same company branding.
o = await open({ email:'test+solo@floodroofing.co.nz', name:'Test Solo' });
v = await o.pg.evaluate(() => ({
  who: document.getElementById('hdrSignedIn').textContent,
  co: (document.getElementById('hdrCompany') || {}).textContent || '',
}));
check('a different login shows a different address, not the company name',
  v.who === 'test+solo@floodroofing.co.nz', v.who);
check('…even while the company branding is the same, which is the whole trap',
  /Flood Roofing/.test(v.co), v.co.slice(0, 60));
await o.ctx.close();

// Signed out / nothing stored: no labelled blank taking up room.
o = await open(null);
v = await o.pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('hdrSignedInRow')).display !== 'none',
  text: document.getElementById('hdrSignedIn').textContent,
}));
check('with nobody signed in the row takes up no room at all', !v.shown && !v.text, JSON.stringify(v));
check('no page errors', o.errs.length === 0, o.errs.join(' | '));
await o.ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
