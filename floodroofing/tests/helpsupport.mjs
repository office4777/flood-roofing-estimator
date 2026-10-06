// The Help bubble's way to a real person (the owner, 2026-09-30). A question
// the assistant cannot answer is offered to the support team; "Talk to a real
// person" opens the same conversation from the start; a reply written on the
// support desk shows as a red count on Help and lands in the chat, marked
// read once seen, with the bubble left ready for them to answer it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const posts = [], reads = [];
let convo = { messages: [], unread: 0 };
await ctx.route('**/api.mapbox.com/**', r => r.abort());
await ctx.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (/\/support\/messages\/read/.test(u)){ reads.push(1); convo.unread = 0; convo.messages.forEach(x => { if (x.sender === 'support') x.read_at = 'now'; }); return j({ ok: true }); }
  if (/\/support\/messages/.test(u) && m === 'POST'){
    const body = JSON.parse(r.request().postData() || '{}'); posts.push(body);
    const msg = { id: 'u' + posts.length, sender: 'user', author: '', body: body.body, created_at: new Date().toISOString(), read_at: null };
    convo.messages.push(msg); return j({ ok: true, message: msg, emailed: true });
  }
  if (/\/support\/messages/.test(u)) return j(convo);
  if (/\/settings/.test(u) && m === 'GET') return j({ branding: { company_name: 'Acme' }, quote_defaults: {}, jms_keys: {}, ui_flags: { first_roof: 'done' } });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token', 't'); localStorage.setItem('fr_settings', 'null'); localStorage.setItem('fr_first_roof', 'done'); });
await pg.goto('file://' + DIR + '/app.html');
await sleep(2500);

// ── a question it cannot answer ───────────────────────────────────
let v = await pg.evaluate(() => Array.from(document.querySelectorAll('#frHelpChips .fr-help-chip')).map(x => x.textContent));
check('"Talk to a real person" is the first suggestion', v[0] === 'Talk to a real person', v.slice(0, 3).join(' | '));
await pg.click('#frHelpLauncher');
await pg.fill('#frHelpInput', 'zorbulate the quimby flange overnight');
await pg.press('#frHelpInput', 'Enter');
await sleep(700);
v = await pg.evaluate(() => { const all = document.querySelectorAll('#frHelpMsgs > div'); const last = all[all.length - 1]; return { text: last.textContent, yes: !!last.querySelector('.fr-help-sup-yes'), no: !!last.querySelector('.fr-help-sup-no') }; });
check('an unanswerable question is offered to a real person, yes or no', /real person/.test(v.text) && v.yes && v.no, JSON.stringify(v));
await pg.click('.fr-help-sup-yes');
await sleep(600);
check('"Yes" sends the question itself to the support team, with where they were', posts.length === 1 && posts[0].body === 'zorbulate the quimby flange overnight' && posts[0].context === 'roof', JSON.stringify(posts));
v = await pg.evaluate(() => ({ last: Array.from(document.querySelectorAll('#frHelpMsgs > div')).pop().textContent, bar: getComputedStyle(document.getElementById('frHelpSupBar')).display, ph: document.getElementById('frHelpInput').placeholder }));
check('…says it went to a real person who will reply here, and the bubble is now talking to support',
  /Sent to our support team/.test(v.last) && /reply here/.test(v.last) && v.bar === 'flex' && /support team/.test(v.ph), JSON.stringify(v));
await pg.fill('#frHelpInput', 'It is on job 3245 if that helps');
await pg.press('#frHelpInput', 'Enter');
await sleep(500);
check('…so the next message goes to support too, not the assistant', posts.length === 2 && /job 3245/.test(posts[1].body), JSON.stringify(posts.map(p => p.body)));
await pg.click('#frHelpSupBack');
await pg.fill('#frHelpInput', 'How do I start a new job?');
await pg.press('#frHelpInput', 'Enter');
await sleep(600);
check('"Back to the assistant" answers from the help again', posts.length === 2 && await pg.evaluate(() => getComputedStyle(document.getElementById('frHelpSupBar')).display === 'none'));
// An answer is followed by "Did this help?" (2026-10-01, the owner's).
v = await pg.evaluate(() => { const last = Array.from(document.querySelectorAll('#frHelpMsgs > div')).pop(); return { text: last.textContent, ok: !!last.querySelector('.fr-help-ok'), person: !!last.querySelector('.fr-help-person') }; });
check('an answer is followed by "Did this help?" — yes, or connect me with a real person', /Did this help\?/.test(v.text) && v.ok && v.person && /real person/.test(v.text), JSON.stringify(v));
await pg.evaluate(() => Array.from(document.querySelectorAll('.fr-help-person')).pop().click());
await sleep(600);
check('…"connect me" sends their question to the team, with the chat so far for context',
  posts.length === 3 && posts[2].body === 'How do I start a new job?' && /They asked: How do I start a new job\?/.test(posts[2].transcript || '') && /Assistant: /.test(posts[2].transcript || ''),
  JSON.stringify(posts[2]).slice(0, 300));
v = await pg.evaluate(() => ({ chips: Array.from(document.querySelectorAll('#frHelpChips .fr-help-chip')).filter(b => b.style.display !== 'none').length, tog: (document.getElementById('frHelpChipsToggle') || {}).textContent || '' }));
check('the suggestions fold away once the chat starts, so the answers have room (one click brings them back)', v.chips === 0 && /Show suggestions/.test(v.tog), JSON.stringify(v));
await pg.click('#frHelpSupBack');
await pg.click('#frHelpClose');
await pg.click('#frHelpLauncher');
v = await pg.evaluate(() => { const b = document.getElementById('frHelpPerson'); return b ? b.textContent : ''; });
check('the header always carries "Message a real person"', /Message a real person/.test(v), v);
await pg.click('#frHelpPerson');
await sleep(200);
check('…which puts the bubble straight into a message to the team', await pg.evaluate(() => getComputedStyle(document.getElementById('frHelpSupBar')).display === 'flex' && /support team/.test(document.getElementById('frHelpInput').placeholder)));
await pg.click('#frHelpSupBack');
await pg.click('#frHelpClose');

// ── "No thanks" ───────────────────────────────────────────────────
await pg.click('#frHelpLauncher');
await pg.fill('#frHelpInput', 'qwxz vbnmp plokij');
await pg.press('#frHelpInput', 'Enter');
await sleep(700);
await pg.evaluate(() => Array.from(document.querySelectorAll('.fr-help-sup-no')).pop().click());
await sleep(300);
check('"No thanks" sends nothing and points at rephrasing and the email address',
  posts.length === 3 && /support@roofmap\.co\.nz/.test(await pg.evaluate(() => Array.from(document.querySelectorAll('#frHelpMsgs > div')).pop().textContent)));
await pg.click('#frHelpClose');

// ── a reply from the desk ─────────────────────────────────────────
convo.messages.push({ id: 's1', sender: 'support', author: 'Aron — RoofMap support', body: 'Thanks — the flange is on the Job Pack, second page.', created_at: new Date().toISOString(), read_at: null });
convo.unread = 1;
await pg.evaluate(() => window._helpSupport.poll());
await sleep(500);
// A reply POPS UP (2026-10-01, the owner's: "when they log back in my
// message pops up for them"): the bubble opens on it by itself.
v = await pg.evaluate(() => getComputedStyle(document.getElementById('frHelpPanel')).display);
check('a reply from the team pops the Help bubble open by itself', v === 'flex', v);
v = await pg.evaluate(() => ({ text: document.getElementById('frHelpMsgs').textContent, badge: !!document.getElementById('frHelpBadge'), bar: getComputedStyle(document.getElementById('frHelpSupBar')).display }));
check('opening Help shows the reply, from the person who wrote it', /flange is on the Job Pack/.test(v.text) && /Aron — RoofMap support/.test(v.text), v.text.slice(-200));
check('…clears the count and marks it read on the server', !v.badge && reads.length === 1, JSON.stringify({ badge: v.badge, reads: reads.length }));
check('…and leaves the bubble ready to answer them', v.bar === 'flex');
await pg.evaluate(() => window._helpSupport.poll());
await sleep(300);
check('the same reply is never shown twice', await pg.evaluate(() => (document.getElementById('frHelpMsgs').textContent.match(/flange is on the Job Pack/g) || []).length === 1));
const pg2 = await ctx.newPage();
convo.messages.push({ id: 's2', sender: 'support', author: 'Aron', body: 'One more thing — reload after the update.', created_at: new Date().toISOString(), read_at: null });
convo.unread = 1;
await pg2.goto('file://' + DIR + '/app.html');
// WAIT FOR THE POP, do not guess how long a boot takes. This was a flat
// 6.5 s sleep and it was enough on a laptop and not on CI, where four suites
// share a runner — it failed the whole Tests run on 6 October 2026 and with
// it the promote, so a shipped fix sat on main unshipped. The bubble's first
// poll is what is being waited for; 30 s is long enough for the slowest boot
// and still fails in reasonable time if the pop never comes.
try {
  await pg2.waitForFunction(() => {
    const p = document.getElementById('frHelpPanel');
    return !!p && getComputedStyle(p).display === 'flex';
  }, null, { timeout: 30000 });
} catch(e){}
v = await pg2.evaluate(() => { const p = document.getElementById('frHelpPanel'), m = document.getElementById('frHelpMsgs');
  return { open: p ? getComputedStyle(p).display : 'missing', text: m ? m.textContent : '' }; });
check('signing back in with an unread reply: it pops up on its own, showing the reply', v.open === 'flex' && /reload after the update/.test(v.text), JSON.stringify(v).slice(0, 200));
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
