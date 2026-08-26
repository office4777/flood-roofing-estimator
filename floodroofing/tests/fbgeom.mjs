// Three rounds of "the sheet measures are missing" were each diagnosed by
// measuring pixels off a screenshot, because the geometry could not be handed
// over. Feedback now carries it: the outline, every line with its type and
// endpoints, the scale and pitch — the numbers that make a report
// reproducible instead of a guess.
//
// Two things this suite holds. It has to actually be in the email, and it has
// to carry NOTHING else: no client, no address, no photos, no prices. That
// is what makes it safe to send without a second thought, and it is what the
// note on the form promises.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:950} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let sent = null, sentUrl = '';
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', async r => {
  const u = r.request().url();
  if (/\/feedback|\/email\/send-order/.test(u)){
    sentUrl = u;
    try { sent = JSON.parse(r.request().postData() || '{}'); } catch(e){ sent = {}; }
    return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  }
  r.fulfill({status:200,contentType:'application/json',body:'[]'});
});
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'roofer@example.co.nz' }));
});
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2400);

// A job with a roof AND the things that must not travel with it.
await pg.evaluate(() => {
  gotoTab('roof');
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]]; DRAW.outlineDone = true;
  DRAW.lines = [['gutter',[0,0],[2000,0]],['ridge',[500,500],[1500,500]]]
    .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:9.87, sheetLengthM:null}));
  DRAW.scaleMetresPerPx = 0.0125; DRAW.calPitch = 25;
  S.photos = [{ src:'data:image/png;base64,AAAA', caption:'north face' }];
  S.materials = 12345.67;
  const set = (id,v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('jobClient','Mrs Henderson'); set('jobAddr','14 Kauri Street, Whangarei');
  set('jobEmail','henderson@example.co.nz'); set('jobPhone','021 555 0100');
  redrawAll();
});

let v = await pg.evaluate(() => {
  const n = document.getElementById('fbGeomNote');
  return n ? n.textContent.trim() : '';
});
check('the form says the measurements are going with it', /measurements/i.test(v) && /No client|no client/.test(v),
  v.slice(0, 60) + '…');

await pg.evaluate(() => {
  gotoTab('feedback');
  document.getElementById('fbTitle').value = 'Sheet measures missing';
  document.getElementById('fbDetails').value = 'Two ridges have no run on them.';
});
await pg.evaluate(() => _sendFeedback(document.getElementById('fbSubmitBtn')));
await pg.waitForTimeout(900);

check('the feedback email went', !!sent, sent ? sent.title : '(nothing sent)');
// It rides the support route, not the send-as-the-tenant one — that route
// stamps the roofer's business name on the message and points replies at
// their branding address, which is the wrong direction for a bug report.
check('…on the support route, not the send-as-the-roofer one',
  /\/feedback/.test(sentUrl) && !/send-order/.test(sentUrl), sentUrl.split('/').pop());
check('…without naming a recipient — the server decides where support mail goes',
  sent.to === undefined, JSON.stringify(sent.to));
check('…with the title and details', /Sheet measures missing/.test(sent.title || '') &&
  /no run on them/.test(sent.text || ''), sent && sent.title);

const geomLine = (sent.text || '').split('Roof geometry')[1] || '';
check('…and the roof geometry attached', /"outline"/.test(geomLine) && /"lines"/.test(geomLine),
  geomLine.slice(0, 70).replace(/\n/g,' '));
check('…carrying the scale and pitch, which is what makes it reproducible',
  /0\.0125/.test(geomLine) && /"calPitch":25/.test(geomLine));
check('…and the line types and endpoints', /"type":"ridge"/.test(geomLine) && /\[500,500\]/.test(geomLine));

// The half that matters more.
const body = (sent.text || '') + (sent.html || '');
check('the client name never leaves the device', !/Henderson/i.test(body));
check('…nor the site address', !/Kauri Street/i.test(body));
check('…nor their email or phone', !/henderson@example/i.test(body) && !/021 555 0100/.test(body));
check('…nor any photo', !/data:image/.test(geomLine));
check('…nor the job total', !/12345/.test(body));

// It must not fall over on a job with nothing drawn.
sent = null;
await pg.evaluate(() => {
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];
  document.getElementById('fbTitle').value = 'Idea';
  document.getElementById('fbDetails').value = 'A thought.';
  _sendFeedback(document.getElementById('fbSubmitBtn'));
});
await pg.waitForTimeout(900);
check('feedback still sends from a job with nothing drawn yet',
  !!sent && /"outline":\[\]/.test(sent.text || ''), sent ? 'sent' : '(nothing sent)');

// ── the one-file report ───────────────────────────────────────────
// jsPDF comes off a CDN, so the suite stands one in for it and reads back
// what the report actually wrote. The point is not that jsPDF works — it is
// that everything needed to fix the bug reaches the page.
sent = null;
await pg.evaluate(() => {
  window.__pdf = { pages: 1, text: [], images: 0 };
  function Fake(){ }
  Fake.prototype.setFont = function(){}; Fake.prototype.setFontSize = function(){};
  Fake.prototype.setTextColor = function(){};
  Fake.prototype.addPage = function(){ window.__pdf.pages++; };
  Fake.prototype.text = function(t){ window.__pdf.text.push(String(t)); };
  Fake.prototype.addImage = function(){ window.__pdf.images++; };
  Fake.prototype.splitTextToSize = function(t){ return String(t).split('\n'); };
  Fake.prototype.output = function(){ return new Blob(['%PDF-1.4 stub'], {type:'application/pdf'}); };
  window.jspdf = { jsPDF: Fake };
  window._loadPdfLibs = function(){ return Promise.resolve(); };
  // Two screenshots on the report.
  _feedbackShots = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]];
  DRAW.lines = [['gutter',[0,0],[2000,0]],['ridge',[500,500],[1500,500]]]
    .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:null, sheetLengthM:null}));
  DRAW.scaleMetresPerPx = 0.0125; DRAW.calPitch = 25;
  gotoTab('feedback');
  document.getElementById('fbTitle').value = 'Sheet measures missing';
  document.getElementById('fbDetails').value = 'Two ridges have no run on them.';
  return _sendFeedback(document.getElementById('fbSubmitBtn'));
});
await pg.waitForTimeout(900);
v = await pg.evaluate(() => ({ pdf: window.__pdf }));
const pdfTxt = (v.pdf.text || []).join('\n');

check('a report PDF is attached', !!(sent && sent.attachment && sent.attachment.base64),
  sent && sent.attachment ? sent.attachment.filename : '(none)');
check('…named so it is obvious what it is',
  sent.attachment.filename === 'roofmap-feedback.pdf', sent.attachment.filename);
check('the report carries the title and what they reported',
  /Sheet measures missing/.test(pdfTxt) && /no run on them/.test(pdfTxt));
check('…who sent it and what they were using',
  /roofer@example\.co\.nz/.test(pdfTxt) && /Browser:/.test(pdfTxt) && /Mode: (Office|Site)/.test(pdfTxt));
// The roofer is asked only to describe what looks wrong; the rest is captured
// for them. If that block ever silently stops being written, this is what
// notices — the report would still look fine and be half as useful.
check('…and the state the app was actually in',
  /Build:/.test(pdfTxt) && /Tab:/.test(pdfTxt) && /Tool in use:/.test(pdfTxt) &&
  /Lines drawn:/.test(pdfTxt) && /Calibrated:/.test(pdfTxt),
  (pdfTxt.match(/Lines drawn:.*/)||['(no drawing state)'])[0]);
check('…and whether anything threw on them',
  /JavaScript errors this session/.test(pdfTxt));
check('…a brief telling Claude Code what to do with the file',
  /For Claude Code/.test(pdfTxt) && /reproduce/.test(pdfTxt) && /run\.mjs/.test(pdfTxt));
check('…and the screenshots, one page each',
  v.pdf.images === 2 && v.pdf.pages === 3, v.pdf.images + ' image(s) over ' + v.pdf.pages + ' pages');

// The one that would quietly ruin the whole idea.
const geomLines = pdfTxt.split('\n').filter(l => /^[\[{]|^"|,$|^\}/.test(l.trim()) && /[:{\[]/.test(l));
const rejoined = geomLines.join('');
let parsed = null; try { parsed = JSON.parse(rejoined.slice(rejoined.indexOf('{"v"'))); } catch(e){}
check('the printed geometry is still valid JSON after being wrapped to the page',
  !!(parsed && Array.isArray(parsed.outline) && Array.isArray(parsed.lines)),
  parsed ? (parsed.lines.length + ' lines parsed back') : 'did NOT parse');
check('…with the numbers intact', !!(parsed && parsed.calPitch === 25 && parsed.scaleMetresPerPx === 0.0125),
  parsed ? ('pitch ' + parsed.calPitch + ', scale ' + parsed.scaleMetresPerPx) : 'n/a');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
