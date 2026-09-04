// "i would also like to be able to delete saved drafts, or accepted quotes
//  ect, some of them are tests i want deleted"
//
// Recent Drafts has always had a ✕. The other five home-board lists did not,
// so a test quote sent or accepted while learning the app sat there for good.
// The one that needs care is Quotes Accepted: an accepted quote is real work,
// so the delete has to say what it is deleting rather than ask the same
// throwaway question a draft gets.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let asked = [];
let answer = true;
// Record the message in Node, never by evaluating in the page: a page
// evaluate while a dialog is open deadlocks, and the suite simply hangs.
pg.on('dialog', d => { asked.push(d.message());
  if (d.type() === 'confirm' && !answer) return d.dismiss(); return d.accept(); });

const deleted = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  if (m === 'DELETE' && /\/jobs\//.test(u)){ deleted.push(u.split('/jobs/')[1]); 
    return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}); }
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

await pg.evaluate(() => {
  window._quoteActivityFeed = [
    { jobId:'j-acc', client:'Sharon Thomson', ref:'3206', status:'accepted',
      lastEventAt:'2026-09-04T02:52:21Z', accepted:{ name:'Sharon Thomson', total:17002.04 } },
    { jobId:'j-sent', client:'Test (Aron)', ref:'3045', status:'sent',
      lastEventAt:'2026-08-28T11:30:00Z' },
  ];
  window._ordersSentRows = [{ id:'j-ord', client:'Modspace', addr:'Christie Waipapa', at:'2026-08-30T00:00:00Z' }];
  window._recentDraftsRows = [];
  // Deliberately NOT via gotoTab: switching to Home refetches the activity
  // feed, and the stub answers with an empty one.
  _hbSelect('accepted');
});
await pg.waitForTimeout(400);
let btns = await pg.evaluate(() => Array.from(document.querySelectorAll('#homeBoard .hb-row button'))
  .map(b => b.getAttribute('onclick') || ''));
check('an accepted quote can be deleted from the board',
  btns.some(o => /_hbDeleteJob\(event,'j-acc'/.test(o)), JSON.stringify(btns));

asked = [];
await pg.evaluate(() => {
  const b = Array.from(document.querySelectorAll('#homeBoard .hb-row button'))
    .find(x => /j-acc/.test(x.getAttribute('onclick') || ''));
  b.click();
});
await pg.waitForTimeout(600);
check('…and it says this one is real work, not a draft',
  asked.some(m => /accepted/i.test(m) && /Delete it anyway/i.test(m)), JSON.stringify(asked));
check('…and the delete actually reaches the server',
  deleted.indexOf('j-acc') >= 0, JSON.stringify(deleted));

// ── the same on a sent quote, with the plainer question ──
asked = []; deleted.length = 0;
await pg.evaluate(() => {
  // The delete refreshes the activity feed, and the stub answers empty —
  // put the remaining job back the way a real refresh would.
  window._quoteActivityFeed = [{ jobId:'j-sent', client:'Test (Aron)', ref:'3045',
    status:'sent', lastEventAt:'2026-08-28T11:30:00Z' }];
  _hbSelect('sent');
  const b = Array.from(document.querySelectorAll('#homeBoard .hb-row button'))
    .find(x => /j-sent/.test(x.getAttribute('onclick') || ''));
  if (b) b.click();
});
await pg.waitForTimeout(600);
check('a sent quote deletes with the ordinary question',
  asked.length === 1 && !/Delete it anyway/i.test(asked[0]), JSON.stringify(asked));
check('…and it too reaches the server', deleted.indexOf('j-sent') >= 0, JSON.stringify(deleted));

// ── saying no deletes nothing ──
answer = false; asked = []; deleted.length = 0;
await pg.evaluate(() => {
  window._quoteActivityFeed = [{ jobId:'j-keep', client:'Keep me', ref:'1', status:'accepted',
    lastEventAt:'2026-09-01T00:00:00Z', accepted:{ name:'x', total:1 } }];
  _hbSelect('accepted');
  const b = Array.from(document.querySelectorAll('#homeBoard .hb-row button'))
    .find(x => /j-keep/.test(x.getAttribute('onclick') || ''));
  if (b) b.click();
});
await pg.waitForTimeout(600);
check('answering no to the confirmation deletes nothing',
  deleted.length === 0 && asked.length === 1, JSON.stringify({ deleted, asked }));

// ── the delete must never also open the job ──
answer = true;
const opened = await pg.evaluate(() => window.__openedJob || null);
check('clicking ✕ does not also open the job it deleted', opened == null, String(opened));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
