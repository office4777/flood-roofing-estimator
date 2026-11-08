// "On the quote accepted, the customers option selections and the quote
//  pricing should be automatically pushed through to Fergus, same as what the
//  current push pricing to Fergus button does."
//
// Same code path as the button, deliberately: every number on a Fergus quote
// comes out of the pricing engine, which lives in the browser. The two things
// worth pinning are that it fires exactly once per acceptance, and that it
// never fires when there is nothing to push to — a stray Fergus quote on
// somebody else's job is not recoverable by pressing undo.
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
// An automatic push must never put a dialog in front of anybody. If one
// appears the suite records it rather than quietly accepting it.
const dialogs = [];
pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
const pushes = [];
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  if (/\/fergus\//.test(u)){
    if (m === 'POST' && /\/quotes$/.test(u)) pushes.push(Object.assign({ _url: u }, r.request().postDataJSON()));
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ id:'fq1', data:{ id:'fq1' } })});
  }
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

const ACC = '2026-09-04T02:52:21.396Z';
async function accepted(opts){
  return pg.evaluate((o) => {
    S.quote = S.quote || {};
    S.quote.gstRate = 15;
    S.quote.ref = '3206';
    S.quote.client = 'Sharon Thomson';
    S.quote.lineItems = [{ desc:'Roof replacement', qty:1, price:14784.38 }];
    S.quote.proposalOptions = { steelGrade:'colorzen', colour:'Ironsand' };
    S.quote.baseGrade = 'colorzen';
    S.linkedJobId = o.linked ? 'fergus-job-1' : null;
    S.quote.accepted = o.acceptedAt ? { name:'Sharon Thomson', at:o.acceptedAt, total:17002.04 } : null;
    S.quote.fergusAutoPushedFor = o.stamp || undefined;
    window._fergusAutoPushBusy = false;
    _fergusAutoPushOnAccept();
  }, opts);
}

// ── no Fergus job linked: nothing is pushed anywhere ──
await accepted({ acceptedAt: ACC, linked: false });
await pg.waitForTimeout(1200);
check('an accepted quote with no Fergus job linked pushes nothing',
  pushes.length === 0, JSON.stringify(pushes.length));

// ── the real case ──
await accepted({ acceptedAt: ACC, linked: true });
await pg.waitForTimeout(1800);
check('an accepted quote pushes itself to Fergus', pushes.length === 1, pushes.length + ' pushes');
const sent = pushes[0] || {};
check('…as a real quote version with priced sections',
  !!(sent.sections && sent.sections.length && sent.title), JSON.stringify(Object.keys(sent)));
// What the automatic push SENDS — the customer's grade at the right money —
// is pinned in gradetruth, on a job that actually has a material take-off;
// this blank one has none. This suite is about when it fires and when it
// must not. What is worth asserting here is that it went to the linked job.
check('…against the Fergus job this quote is linked to, and no other',
  /\/jobs\/fergus-job-1\/quotes$/.test(sent._url || ''), sent._url || '');
check('…and it never puts a dialog in front of anybody',
  dialogs.length === 0, JSON.stringify(dialogs));

// ── it fires once, not on every re-render ──
await pg.evaluate(() => { window._fergusAutoPushBusy = false; _fergusAutoPushOnAccept(); _fergusAutoPushOnAccept(); });
await pg.waitForTimeout(1200);
check('re-rendering the quote does not push it again', pushes.length === 1, pushes.length + ' pushes');
const stamp = await pg.evaluate(() => S.quote.fergusAutoPushedFor);
check('…because the push is stamped against the acceptance itself',
  stamp === ACC, String(stamp));

// ── undo, re-accept at a new time: that IS a new quote ──
await accepted({ acceptedAt: '2026-09-05T09:00:00.000Z', linked: true, stamp: ACC });
await pg.waitForTimeout(1800);
check('a quote accepted again after an undo pushes the new version',
  pushes.length === 2, pushes.length + ' pushes');

// ── a quote nobody has accepted is never pushed ──
await accepted({ acceptedAt: null, linked: true });
await pg.waitForTimeout(1200);
check('an unaccepted quote is left alone', pushes.length === 2, pushes.length + ' pushes');

// ── LOOKING AT THE ACCEPTED VERSION IS NOT A NEW ACCEPTANCE (2026-11-06) ──
// "when i switch between a draft and then click on the accepted version, it
// pushed a new quote to fergus everytime which it shouldn't do"
const ACC3 = '2026-11-05T20:09:22.012Z';
const n0 = pushes.length;
await pg.evaluate((at) => {
  S.linkedJobId = 'fergus-job-41'; S.currentJobId = 'job-3341';
  var acc = { name: 'Doug Rodgers', at: at, total: 8964.62 };
  var frozen = { ref: '3341', client: 'Doug Rodgers', gstRate: 15, lineItems: [{ desc: 'Gutters', qty: 1, price: 7795.32 }], accepted: acc,
                 proposalOptions: { gutterType: 'box125' } };
  // the working draft made off the acceptance carries no acceptance of its own
  S.quote = { ref: '3341', client: 'Doug Rodgers', gstRate: 15, lineItems: [{ desc: 'Gutters', qty: 1, price: 7795.32 }],
              share: { token: 't41', status: 'sent' }, proposalOptions: { gutterType: 'box125' },
              versions: { accepted: { id: 'vA', at: at, label: 'Accepted quote', total: 8964.62, quote: frozen } } };
  window._fergusAutoPushBusy = false;
  for (var i = 0; i < 3; i++){ _qvView('accepted'); _qvBackToDraft({ relock: true }); }
  _qvView('accepted');
}, ACC3);
await pg.waitForTimeout(1500);
check('switching between the draft and the Accepted version (four looks) pushes nothing to Fergus',
  pushes.length === n0, (pushes.length - n0) + ' pushes');
await pg.evaluate(() => { try { _qvBackToDraft({ relock: true }); } catch(e){} });

// the server has already made this acceptance's version in Fergus
await pg.evaluate((at) => {
  S.linkedJobId = 'fergus-job-42'; S.currentJobId = 'job-3342'; S._qvViewing = null;
  S.quote = { ref: '3342', gstRate: 15, lineItems: [{ desc: 'Roof', qty: 1, price: 1000 }],
              accepted: { name: 'X', at: at, total: 1150 },
              share: { token: 't42', status: 'accepted', fergus: { jobId: 'fergus-job-42', auto: { acceptedAt: at, quoteId: 'FQ-9', total: 1150 } } } };
  window._fergusAutoPushBusy = false; _fergusAutoPushOnAccept();
}, ACC3);
await pg.waitForTimeout(1200);
check('an acceptance the server already put in Fergus is not pushed a second time from the office',
  pushes.length === n0, (pushes.length - n0) + ' pushes');

// pushed once, then the job reopened (the locked job never saved the stamp)
await pg.evaluate((at) => {
  S.linkedJobId = 'fergus-job-43'; S.currentJobId = 'job-3343'; S._qvViewing = null;
  S.quote = { ref: '3343', gstRate: 15, lineItems: [{ desc: 'Roof', qty: 1, price: 1000 }], accepted: { name: 'Y', at: at, total: 1150 }, share: { token: 't43', status: 'accepted' } };
  window._fergusAutoPushBusy = false; _fergusAutoPushOnAccept();
}, ACC3);
await pg.waitForTimeout(1800);
const n1 = pushes.length;
await pg.evaluate((at) => {
  S.quote = { ref: '3343', gstRate: 15, lineItems: [{ desc: 'Roof', qty: 1, price: 1000 }], accepted: { name: 'Y', at: at, total: 1150 }, share: { token: 't43', status: 'accepted' } };
  window._fergusAutoPushBusy = false; _fergusAutoPushOnAccept();
}, ACC3);
await pg.waitForTimeout(1500);
check('an acceptance pushed once is not pushed again when the job is opened again',
  n1 === n0 + 1 && pushes.length === n1, (n1 - n0) + ' then ' + (pushes.length - n1));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
