// Two things the office could not see.
//
// 1. A sent quote is LIVE. /q/:token serves the job's CURRENT quote, so an
//    edit made after the email went out is what the customer sees and what
//    they can accept. Put a job up two thousand dollars and a customer
//    sitting on last week's email accepts the new number having never been
//    shown it; correct a price down and the old one is gone before they saw
//    the fix. The quote already recorded what it was worth when the link was
//    made — nothing compared it to what the quote says now.
//
// 2. The automatic Fergus push runs in the office browser, because the
//    pricing engine lives there. So it waits for somebody to open the job.
//    Waiting is fine; waiting SILENTLY is not.
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
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// ── the live-quote bar ──
async function bar(share, total){
  return pg.evaluate((o) => {
    S.quote = S.quote || {};
    S.quote.client = 'Sharon Thomson';
    S.quote.share = o.share;
    // The bar reads the quote's own current total through the same helper the
    // customer bar does; stub it so the suite controls the money.
    window._custBarTotalValue = function(){ return o.total; };
    _qaLiveBarSync();
    const el = document.getElementById('qaLiveBar');
    return { shown: getComputedStyle(el).display !== 'none', text: el.textContent,
             red: /rgb\(220, 38, 38\)|#dc2626/.test(el.style.borderColor) };
  }, { share, total });
}

let v = await bar({}, 17002.04);
check('a quote that has never been sent says nothing', !v.shown, v.text);

v = await bar({ token:'t1', status:'sent', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 17002.04);
check('a quote out with a customer says so', v.shown && /live with Sharon Thomson/i.test(v.text), v.text);
check('…and says that changes reach them', /they see, and can accept/i.test(v.text), v.text);
check('…calmly, while the price has not moved', !v.red, 'red=' + v.red);

v = await bar({ token:'t1', status:'sent', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 19002.04);
check('a price that has gone UP since sending is called out', v.shown && v.red, v.text);
check('…naming both figures', /17,002\.04/.test(v.text) && /19,002\.04/.test(v.text), v.text);
check('…and saying that is what they would accept',
  /without ever having been shown it/i.test(v.text), v.text);

v = await bar({ token:'t1', status:'opened', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 15000 );
check('a price that has gone DOWN is called out too — they have not been told',
  v.shown && v.red && /have not been told/i.test(v.text), v.text);

v = await bar({ token:'t1', status:'accepted', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 19002.04);
check('once accepted the bar goes away — that quote is settled', !v.shown, v.text);
v = await bar({ token:'t1', status:'declined', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 19002.04);
check('…and on a declined one too', !v.shown, v.text);
v = await bar({ token:'t1', status:'queried', sentAt:'2026-09-01T00:00:00Z', sentTotal:17002.04 }, 17002.04);
check('a quote with a question outstanding is still live', v.shown, v.text);

// ── the Fergus-pending chip ──
v = await pg.evaluate(() => {
  window._quoteActivityFeed = [
    { jobId:'j1', client:'Sharon Thomson', ref:'3206', status:'accepted', lastEventAt:'2026-09-04T02:52:21Z',
      accepted:{ name:'Sharon Thomson', total:17002.04 }, fergusPending:true },
    { jobId:'j2', client:'Greg Thomas', ref:'3125', status:'accepted', lastEventAt:'2026-09-01T00:00:00Z',
      accepted:{ name:'Greg Thomas', total:9000 }, fergusPending:false },
  ];
  window._recentDraftsRows = []; window._ordersSentRows = [];
  _hbSelect('accepted');
  const p = document.getElementById('hbFergusPending');
  return { shown: getComputedStyle(p).display !== 'none', text: p.textContent,
           buttons: Array.from(p.querySelectorAll('button')).map(x => x.getAttribute('onclick')),
           rows: document.getElementById('homeBoard').textContent };
});
check('the board says how many accepted quotes have not reached Fergus',
  v.shown && /1 accepted quote not yet in Fergus/.test(v.text), v.text);
check('…with a button for the one that is waiting',
  v.buttons.length === 1 && /_hbPushToFergus\('j1'\)/.test(v.buttons[0]), JSON.stringify(v.buttons));
check('…and the waiting job says so in the list itself',
  /Not yet in Fergus/.test(v.rows), v.rows.slice(0, 200));
check('…while the one already pushed says nothing',
  (v.rows.match(/Not yet in Fergus/g) || []).length === 1, String((v.rows.match(/Not yet in Fergus/g) || []).length));

v = await pg.evaluate(() => {
  window._quoteActivityFeed = [{ jobId:'j2', client:'Greg Thomas', ref:'3125', status:'accepted',
    lastEventAt:'2026-09-01T00:00:00Z', accepted:{ name:'Greg', total:9000 }, fergusPending:false }];
  _hbSelect('accepted');
  return getComputedStyle(document.getElementById('hbFergusPending')).display === 'none';
});
check('nothing waiting, nothing said', v);

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
