// Two things that were quietly telling a new user this was somebody else's
// software, and one that was leaving money on the table.
//
// The sidebar masthead used to be overwritten with whatever company logo was
// uploaded, so the moment a roofer branded their account the product's own
// name vanished — nothing to recognise, nothing to search for when something
// broke. RoofMap keeps the top; the roofer's logo sits below it, labelled.
//
// And the JMS list can only ever be a guess at what roofers run on. Asking is
// cheaper than guessing, so there is now a request button on the same pipe as
// Send Feedback.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const LOGO = 'data:image/svg+xml;base64,' + Buffer.from(
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='80'><rect width='300' height='80' fill='#123'/></svg>"
).toString('base64');

const b = await chromium.launch();
const sent = [];
async function open(branding){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const u = r.request().url(), m = r.request().method();
    if (/\/feedback|\/email\/send-order/.test(u) && m === 'POST'){
      sent.push(r.request().postDataJSON());
      return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    }
    if (/\/settings/.test(u))
      return r.fulfill({status:200,contentType:'application/json',
        body: JSON.stringify({ branding: branding||{}, quote_defaults:{}, jms_keys:{} })});
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
    localStorage.setItem('fr_setup_done','1');
    localStorage.removeItem('fr_settings');
    localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz' }));
    localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd' })); });
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs };
}

// ── the masthead is the product's ─────────────────────────────────
let { ctx, pg, errs } = await open({ company_name:'Acme Roofing Ltd', logo_data_url: LOGO });
let v = await pg.evaluate(() => {
  const mark = document.querySelector('.hdr-logo img.hdr-logo-mark');
  const co   = document.getElementById('hdrCompany');
  const coImg = co && co.querySelector('img');
  return {
    markSrc: mark ? mark.getAttribute('src') : null,
    markH: mark ? Math.round(mark.getBoundingClientRect().height) : 0,
    wordmark: (document.querySelector('.hdr-logo .hdr-logo-text')||{}).textContent || '',
    coHasLogo: !!coImg,
    coLabel: co ? (co.textContent||'').trim() : '',
    // the company block sits BELOW the RoofMap block
    below: !!(mark && coImg &&
      coImg.getBoundingClientRect().top > mark.getBoundingClientRect().top),
  };
});
check('the RoofMap logo is still at the top once a company has branded',
  /roofmap/i.test(v.markSrc || '') && /RoofMap/.test(v.wordmark), v.markSrc);
check('…and it is big', v.markH >= 40, v.markH + 'px');
check('the company logo moved below it', v.coHasLogo && v.below);
check('…labelled, so it is clear whose account this is', /your company/i.test(v.coLabel), v.coLabel.slice(0,40));
await ctx.close();

// A company with a NAME but no logo still gets its name down there.
({ ctx, pg, errs } = await open({ company_name:'Acme Roofing Ltd' }));
v = await pg.evaluate(() => ({
  name: (document.querySelector('#hdrCompany .hdr-co-name')||{}).textContent || '',
  mark: !!document.querySelector('.hdr-logo img.hdr-logo-mark'),
}));
check('a company with no logo shows its name below instead',
  v.name === 'Acme Roofing Ltd' && v.mark, v.name);
await ctx.close();

// An unbranded account gets no empty band.
({ ctx, pg, errs } = await open({}));
v = await pg.evaluate(() => {
  const co = document.getElementById('hdrCompany');
  return { empty: !co.innerHTML.trim(), h: Math.round(co.getBoundingClientRect().height),
           sub: (document.getElementById('hdrLogoSub')||{}).textContent || '' };
});
check('an unbranded account gets no blank band, not even a labelled one',
  v.empty && v.h < 4, 'height ' + v.h);
check('…and is told where to set it up', /Settings/.test(v.sub), v.sub);
await ctx.close();

// ── the JMS section ───────────────────────────────────────────────
({ ctx, pg, errs } = await open({ company_name:'Acme Roofing Ltd' }));
check('the settings tab is called Job Management Software',
  await pg.evaluate(() => (document.getElementById('jmsSubTabBtn')||{}).textContent.trim() === 'Job Management Software'),
  await pg.evaluate(() => (document.getElementById('jmsSubTabBtn')||{}).textContent));

v = await pg.evaluate(() => ({
  input: !!document.getElementById('jmsReqName'),
  notes: !!document.getElementById('jmsReqNotes'),
  btn: (document.getElementById('jmsReqBtn')||{}).textContent || '',
  inPanel: !!document.querySelector('#set-jms #jmsReqBtn'),
}));
check('…and it carries a request button', v.input && v.notes && /request/i.test(v.btn), v.btn);
check('…inside that section, not floating somewhere else', v.inPanel);

// Nothing is sent without a name.
sent.length = 0;
v = await pg.evaluate(async () => {
  document.getElementById('jmsReqName').value = '   ';
  await _sendJmsRequest(document.getElementById('jmsReqBtn'));
  return (document.getElementById('jmsReqMsg')||{}).textContent || '';
});
check('an empty request is refused, and says why', sent.length === 0 && /name/i.test(v), v);

// A real one goes, with who asked attached.
v = await pg.evaluate(async () => {
  document.getElementById('jmsReqName').value = 'Tradify';
  document.getElementById('jmsReqNotes').value = 'About 12 jobs a week go through it.';
  await _sendJmsRequest(document.getElementById('jmsReqBtn'));
  return { msg: (document.getElementById('jmsReqMsg')||{}).textContent || '',
           name: document.getElementById('jmsReqName').value,
           notes: document.getElementById('jmsReqNotes').value };
});
check('a named request is sent', sent.length === 1, sent.length + ' email(s)');
const m = sent[0] || {};
// No recipient in the body: the server routes support mail to the support
// desk, so a request cannot be aimed anywhere else from the page.
check('…without the page naming a recipient', m.to === undefined, JSON.stringify(m.to));
check('…flagged as an integration request, with the software named',
  m.kind === 'jms' && m.title === 'Tradify', m.kind + ' / ' + m.title);
check('…and who asked, and from what company',
  /sam@acmeroofing\.co\.nz/.test(m.text || '') && /Acme Roofing Ltd/.test(m.text || ''));
check('…carrying their notes', /12 jobs a week/.test(m.text || ''));
check('…as an HTML email too, escaped', /<div/.test(m.html || '') && !/<script/i.test(m.html || ''));
check('the form empties and confirms, ready for the next one',
  /Tradify/.test(v.msg) && !v.name && !v.notes, v.msg);

// The button comes back when the send fails, or it is dead forever.
v = await pg.evaluate(async () => {
  window.api = function(){ return Promise.reject(new Error('offline')); };
  document.getElementById('jmsReqName').value = 'ServiceM8';
  await _sendJmsRequest(document.getElementById('jmsReqBtn'));
  const btn = document.getElementById('jmsReqBtn');
  return { msg: (document.getElementById('jmsReqMsg')||{}).textContent || '',
           disabled: btn.disabled, label: btn.textContent,
           kept: document.getElementById('jmsReqName').value };
});
check('a failed send says so, gives the button back and keeps what they typed',
  /offline/i.test(v.msg) && !v.disabled && /request/i.test(v.label) && v.kept === 'ServiceM8',
  v.msg + ' / ' + v.label);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
