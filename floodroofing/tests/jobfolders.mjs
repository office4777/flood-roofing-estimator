// FILES & PHOTOS FOLDERS (2026-11-13, the owner: "make subfolders in this
// window ... photos ... files, so put the customer selections, accepted
// quote, and any other PDFs into that folder ... a third folder called
// communications ... the whole email trail ... the top would be the first
// email sent, and the bottom would be the most recent. And then also in the
// history and communications job timeline, also the emails ... in the
// settings tab ... job files and photos ... the default folders and what goes
// into those default folders"; then "add a custom folder into that specific
// job, or delete a folder, or move items into a folder, or remove items from
// the folder ... back to the main ... window ... click, hold and drag into a
// folder. Or delete an item ... reorder an item").
// The real app against stubbed routes, a real mouse for every drag.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());

const files = [
  { id:'f-q', name:'Sent - Quote 3351.pdf', mime:'application/pdf', size:120400, kind:'export', source:'sent-quote', author:'office@floodroofing.co.nz', at:'2026-11-06T01:00:00Z' },
  { id:'f-c', name:'RoofMap pricing 3351.csv', mime:'text/csv', size:900, kind:'export', source:'pricing-csv', author:'office@floodroofing.co.nz', at:'2026-11-05T01:00:00Z' },
  { id:'f-p', name:'ridge.png', mime:'image/png', size:68, kind:'upload', source:'', author:'office@floodroofing.co.nz', at:'2026-11-04T01:00:00Z' },
  { id:'f-p2', name:'valley.png', mime:'image/png', size:68, kind:'upload', source:'', author:'office@floodroofing.co.nz', at:'2026-11-03T01:00:00Z' },
];
let layout = null, layoutFail = false;
const layoutPuts = [], deleted = [], settingsPuts = [];
const messages = [
  { id:'m3', who:'office', via:'roofmap', author:'Aron', body:'Yes, the ridge is included.', at:'2026-11-08T02:00:00Z', subject:'Re: Your quote 3351', mail_to:'arran@example.com', mail_from:'Flood Roofing <floodroofing@quotes.roofmap.co.nz>', mail_cc:'office@floodroofing.co.nz' },
  { id:'bf', who:'office', via:'quote-email', backfill:true, body:'The quote was emailed to the customer with its link.', at:'2026-11-06T01:00:00Z', subject:'Your quote 3351', mail_to:'arran@example.com' },
  { id:'m2', who:'customer', via:'quote-link', author:'Arran Simpson', body:'Is the ridge included?', at:'2026-11-07T22:00:00Z', subject:'Question on the quote' },
];
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('https://storage.test/**', r => r.fulfill({ status:200, contentType:'image/png', body: png1x1 }));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const req = r.request(), u = req.url(), m = req.method();
  const j = (o, st) => r.fulfill({ status: st || 200, contentType:'application/json', body: JSON.stringify(o) });
  let mm;
  if (/\/settings/.test(u)){ if (m === 'PUT'){ settingsPuts.push(req.postDataJSON()); return j({ ok:true }); } return j({ user_id:'u1', branding:{ company_name:'Flood Roofing Ltd' }, quote_defaults:{}, jms_keys:{} }); }
  if (/\/fergus-files\/list/.test(u)) return j({ ok:true, files:[
    { id:'fg1', name:'Customer selections - Quote 3351.pdf', url:'https://fergus.test/sel.pdf', contentType:'application/pdf' },
    { id:'fg2', name:'1000001223.jpg', url:'https://fergus.test/a.jpg', contentType:'image/jpeg' } ] });
  if (/\/fergus-files\/download/.test(u)) return r.fulfill({ status:200, contentType:'image/png', body: png1x1 });
  if (/\/schedule$/.test(u)) return j({ rows: [{ job_id:'j1', notify_log:[{ at:'2026-11-09T03:00:00Z', kind:'booked', to:'arran@example.com', subject:'Your roof is booked in' }] }] });
  if (/\/jobs\/[^/]+\/messages$/.test(u)) return j({ ok:true, messages, inbox:{ connected:false, emails:[] } });
  if (/\/jobs\/[^/]+\/files\/layout$/.test(u) && m === 'PUT'){ const body = req.postDataJSON(); layoutPuts.push(body.layout); layout = body.layout; return j({ ok:true, layout }); }
  if ((mm = /\/jobs\/[^/]+\/files\/([^/]+)\/url$/.exec(u))){ const f = files.find(x => x.id === mm[1]); return f ? j({ ok:true, url:'https://storage.test/get/' + f.id, name:f.name, mime:f.mime, size:f.size }) : j({ error:'nf' }, 404); }
  if ((mm = /\/jobs\/[^/]+\/files\/([^/]+)$/.exec(u)) && m === 'DELETE'){ deleted.push(mm[1]); const i = files.findIndex(x => x.id === mm[1]); if (i >= 0) files.splice(i, 1); return j({ ok:true }); }
  if (/\/jobs\/[^/]+\/files$/.test(u)) return j(layoutFail ? { ok:true, files, layout:null, layoutErr:'relation job_file_layouts is not there' } : { ok:true, files, layout });
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Aron' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing Ltd' })); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { ['setupWizard','tourWrap'].forEach(i => { const w = document.getElementById(i); if (w) w.remove(); }); });

const open = async () => { await pg.evaluate(async () => {
  S.currentJobId = 'j1'; S.quote = S.quote || defaultQuote(); S.quote.ref = '3351'; S.quote.client = 'Arran Simpson'; S.linkedJobId = 'F77';
  S.photos = [];
  _jobFilesOpen(); await new Promise(r => setTimeout(r, 900)); }); };
const state = () => pg.evaluate(() => { const G = _jfGroups(), out = {};
  Object.keys(G.g).forEach(k => { out[k || 'home'] = G.g[k].map(it => it.name); });
  out.folders = G.folders.map(f => f.name); out.view = _JF.view; return out; });
const box = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block:'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, h: r.height }; }, sel);
async function drag(fromSel, toSel, dy){
  const a = await box(fromSel); const t = await box(toSel);
  if (!a || !t) return false;
  const gx = a.x - 0, gy = a.y;
  // grab on the grip, the name area — never a button
  const g = await box(fromSel + ' .jf-grip');
  await pg.mouse.move(g.x, g.y); await pg.mouse.down();
  await pg.mouse.move(g.x + 20, g.y + 10, { steps: 4 });
  await pg.mouse.move(t.x, t.y + (dy || 0), { steps: 12 });
  await pg.mouse.up(); await pg.waitForTimeout(450);
  return true;
}

await open();
let s = await state();
check('the window opens on its folders — Photos, Files, Email communications', JSON.stringify(s.folders) === '["Photos","Files","Email communications"]', JSON.stringify(s.folders));
check('…photos (an upload and a Fergus photo) are in Photos', JSON.stringify(s.photos.slice().sort()) === '["1000001223.jpg","ridge.png","valley.png"]', JSON.stringify(s.photos));
check('…the sent quote, the customer selections and the other files are in Files', s.files.includes('Sent - Quote 3351.pdf') && s.files.includes('Customer selections - Quote 3351.pdf') && s.files.includes('RoofMap pricing 3351.csv') && s.home.length === 0, JSON.stringify(s));

// ── into a folder, out of it, back to the main screen, by dragging ──
await pg.evaluate(() => _jfGo('files'));
await drag('#jobFilesModal .jf-row[data-jf-key="s:f-c"]', '#jobFilesModal .jf-crumb');
s = await state();
check('dragging an item onto “All files & photos” takes it out of the folder, back to the main screen', s.home.includes('RoofMap pricing 3351.csv') && !s.files.includes('RoofMap pricing 3351.csv'), JSON.stringify(s));
check('…and the job’s layout is saved', layoutPuts.length >= 1 && layout && layout.place['s:f-c'] === '', JSON.stringify(layout));
await pg.evaluate(() => _jfGo(''));
await drag('#jobFilesModal .jf-row[data-jf-key="s:f-c"]', '#jobFilesModal .jf-fold[data-jf-folder="photos"]');
s = await state();
check('dragging an item from the main screen onto a folder tile puts it in that folder', s.photos.includes('RoofMap pricing 3351.csv') && !s.home.includes('RoofMap pricing 3351.csv'), JSON.stringify(s));
// the ↩ button
await pg.evaluate(() => _jfGo('photos'));
await pg.click('#jobFilesModal .jf-row[data-jf-key="s:f-c"] .jf-out');
await pg.waitForTimeout(350);
s = await state();
check('…the ↩ on an item takes it back out to the main screen', s.home.includes('RoofMap pricing 3351.csv') && !s.photos.includes('RoofMap pricing 3351.csv'), JSON.stringify(s));
// the Move to… list
await pg.evaluate(() => _jfGo(''));
await pg.selectOption('#jobFilesModal .jf-row[data-jf-key="s:f-c"] .jf-move', 'files');
await pg.waitForTimeout(350);
s = await state();
check('…and “Move to…” moves it without dragging', s.files.includes('RoofMap pricing 3351.csv') && !s.home.length, JSON.stringify(s));

// ── reorder by dragging above another item ──
await pg.evaluate(() => _jfGo('photos'));
let order = await pg.evaluate(() => [...document.querySelectorAll('#jobFilesModal .jf-list .jf-row')].map(r => r.getAttribute('data-jf-key')));
const last = order[order.length - 1], first = order[0];
const firstBox = await box('#jobFilesModal .jf-row[data-jf-key="' + first + '"]');
await drag('#jobFilesModal .jf-row[data-jf-key="' + last + '"]', '#jobFilesModal .jf-row[data-jf-key="' + first + '"]', -firstBox.h / 2 + 3);
let order2 = await pg.evaluate(() => [...document.querySelectorAll('#jobFilesModal .jf-list .jf-row')].map(r => r.getAttribute('data-jf-key')));
check('dragging the last photo above the first puts it first, and keeps the order', order2[0] === last && order2[1] === first && JSON.stringify(layout.order.photos) === JSON.stringify(order2), JSON.stringify({ order, order2, saved: layout.order }));
// and below
await drag('#jobFilesModal .jf-row[data-jf-key="' + order2[0] + '"]', '#jobFilesModal .jf-row[data-jf-key="' + order2[1] + '"]', firstBox.h / 2 - 3);
let order3 = await pg.evaluate(() => [...document.querySelectorAll('#jobFilesModal .jf-list .jf-row')].map(r => r.getAttribute('data-jf-key')));
check('…and dragging it below the next one moves it down one', order3[0] === order2[1] && order3[1] === order2[0], JSON.stringify(order3));
const noSel = await pg.evaluate(() => !document.body.classList.contains('jf-noselect') && !document.querySelector('.jf-ghost'));
check('…the drag leaves nothing behind (no ghost, no stuck no-select)', noSel);
check('…and a drag never opens the file it picked up', !(await pg.evaluate(() => !!document.getElementById('jobFileViewer'))));

// ── a folder of the job's own ──
await pg.evaluate(() => _jfGo(''));
await pg.click('#jobFilesModal .jf-fold-new');
await pg.fill('#_spInput', 'Council consent');
await pg.click('#_spOk'); await pg.waitForTimeout(350);
s = await state();
check('“New folder” adds a folder to this job', s.folders.includes('Council consent') && layout.folders.some(f => f.name === 'Council consent'), JSON.stringify(s.folders));
const cid = await pg.evaluate(() => _jfFolders().filter(f => f.name === 'Council consent')[0].id);
await pg.evaluate(() => _jfGo('files'));
await drag('#jobFilesModal .jf-row[data-jf-key="s:f-q"]', '#jobFilesModal .jf-chip[data-jf-drop="' + cid + '"]');
s = await state();
check('…an item drags from one folder onto another folder’s chip', (s[cid] || []).includes('Sent - Quote 3351.pdf') && !s.files.includes('Sent - Quote 3351.pdf'), JSON.stringify(s));
await pg.evaluate(() => _jfGo(''));
await pg.evaluate((id) => _jfDeleteFolder(id), cid); await pg.waitForTimeout(300);
s = await state();
check('deleting a folder puts what was in it back on the main screen — nothing deleted', !s.folders.includes('Council consent') && s.home.includes('Sent - Quote 3351.pdf') && deleted.length === 0, JSON.stringify(s));
// a default folder off this job, and back
await pg.evaluate(() => _jfDeleteFolder('photos')); await pg.waitForTimeout(300);
s = await state();
check('…a default folder can come off this job; its photos land on the main screen', !s.folders.includes('Photos') && s.home.includes('ridge.png') && s.home.includes('1000001223.jpg'), JSON.stringify(s));
await pg.evaluate(() => _jfRestoreFolders()); await pg.waitForTimeout(300);
s = await state();
check('…and “Put back the default folders” brings it back', s.folders.includes('Photos'), JSON.stringify(s.folders));

check('…its photos stay where the office put them — on the main screen — until moved again', s.home.includes('ridge.png'), JSON.stringify(s));
// ── delete an item ──
await pg.evaluate(() => _jfGo(''));
await pg.click('#jobFilesModal .jf-row[data-jf-key="s:f-p2"] .jf-del'); await pg.waitForTimeout(400);
check('✕ on a stored file deletes it', deleted.includes('f-p2'), JSON.stringify(deleted));
await pg.click('#jobFilesModal .jf-row[data-jf-key="f:fg2"] .jf-del'); await pg.waitForTimeout(400);
s = await state();
check('…✕ on a Fergus photo takes it out of this window (it stays on Fergus)', !s.home.includes('1000001223.jpg') && !s.photos.includes('1000001223.jpg') && layout.hiddenItems.includes('f:fg2'), JSON.stringify(layout.hiddenItems));

// ── the layout is the job's: kept across a reopen ──
await pg.evaluate(() => _jobFilesClose());
await open();
s = await state();
check('closing and opening again keeps every move (read back from the server)', s.home.includes('Sent - Quote 3351.pdf') && !s.photos.includes('1000001223.jpg'), JSON.stringify(s));

// ── a layout that could not be read is never written over ──
layoutFail = true; const nPuts = layoutPuts.length;
await pg.evaluate(() => { _jobFilesClose(); _JF.jobId = null; });
await open();
await pg.evaluate(() => _jfMoveTo('s:f-q', 'files')); await pg.waitForTimeout(500);
const errShown = await pg.evaluate(() => /could not be read/.test(document.getElementById('jobFilesModal').textContent));
check('a folder layout that could not be read says so and is never saved over', layoutPuts.length === nPuts && errShown, layoutPuts.length + ' / ' + nPuts);
layoutFail = false;
await pg.evaluate(() => { _jobFilesClose(); _JF.jobId = null; });
await open();

// ── Email communications: the whole trail, oldest first ──
await pg.click('#jobFilesModal .jf-fold[data-jf-folder="mail"]'); await pg.waitForTimeout(700);
const mail = await pg.evaluate(() => [...document.querySelectorAll('#jobFilesModal .jfm-card')].map(c => ({ via: c.getAttribute('data-jfm-via'), kind: c.querySelector('.jfm-kind').textContent, subj: (c.querySelector('.jfm-subj') || {}).textContent || '', hdr: c.querySelector('.jfm-hdrs').textContent, body: (c.querySelector('.jfm-body') || {}).textContent || '' })));
check('Email communications lists every email, the first sent at the top and the latest at the bottom',
  JSON.stringify(mail.map(m => m.via)) === '["quote-email","quote-link","roofmap","schedule"]', JSON.stringify(mail.map(m => m.via)));
check('…each with what it was, its subject and who it went to', /Quote emailed/.test(mail[0].kind) && mail[0].subj === 'Your quote 3351' && /To: arran@example.com/.test(mail[0].hdr) &&
  /question/i.test(mail[1].kind) && /Is the ridge included/.test(mail[1].body) && /Reply sent/.test(mail[2].kind) && /Cc: office@floodroofing/.test(mail[2].hdr) && /booked/.test(mail[3].subj), JSON.stringify(mail));
check('…and a reply can be written there', await pg.evaluate(() => !!document.getElementById('jfmReply') && !!document.getElementById('jfmSendBtn')));
check('…the email folder is not a drop target', await pg.evaluate(() => !document.querySelector('.jf-fold-mail[data-jf-drop]')));

// ── the job timeline carries the emails, in date order ──
await pg.evaluate(() => _jobFilesClose());
const tl = await pg.evaluate(async () => { _jobHistoryOpen(); await new Promise(r => setTimeout(r, 900));
  return [...document.querySelectorAll('#jobHistTimeline > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()); });
const iQ = tl.findIndex(t => /Quote emailed/.test(t)), iAsk = tl.findIndex(t => /asked a question/.test(t)), iRe = tl.findIndex(t => /Reply sent/.test(t));
check('History & Communications’ job timeline lists the emails among the milestones, in date order', iQ >= 0 && iAsk > iQ && iRe > iAsk, JSON.stringify(tl));
check('…without saying the quote was sent twice', tl.filter(t => /^📤/.test(t)).length === 1, JSON.stringify(tl));
await pg.evaluate(() => _jobHistoryClose());

// ── Settings → Job files & photos ──
await pg.evaluate(async () => { gotoTab('settings'); await new Promise(r => setTimeout(r, 300)); switchSettingsSub('set-jobfiles'); await new Promise(r => setTimeout(r, 200)); });
let st = await pg.evaluate(() => ({ title: document.getElementById('setPaneTitle').textContent, rows: [...document.querySelectorAll('#jfsList .jfs-name')].map(i => i.value),
  btn: [...document.querySelectorAll('.set-subs[data-dest="business"] .tab-sm')].map(b => b.textContent) }));
check('Settings has “Job files & photos” listing the default folders', st.btn.includes('Job files & photos') && JSON.stringify(st.rows) === '["Photos","Files","Email communications"]', JSON.stringify(st));
const nSet = settingsPuts.length;
await pg.click('#set-jobfiles button:has-text("+ Add a default folder")');
await pg.fill('#jfsList .jfs-row:last-child .jfs-name', 'Plans');
await pg.press('#jfsList .jfs-row:last-child .jfs-name', 'Tab');
await pg.check('#jfsList .jfs-row:last-child input[onchange*="\'types\',\'pdf\'"]');
await pg.check('#jfsList .jfs-row:last-child input[onchange*="\'from\',\'fergus\'"]');
// up above Files so it is asked first
await pg.click('#jfsList .jfs-row:last-child button[title="Move up"]');
await pg.click('#jfsList .jfs-row:nth-child(3) button[title="Move up"]');
await pg.waitForTimeout(900);
st = await pg.evaluate(() => S.settings.quote_defaults.job_folders.map(f => f.name + ':' + (f.types || []).join('+') + ':' + (f.from || []).join('+')));
check('…a default folder can be added, named, given a rule and moved up the list', JSON.stringify(st) === '["Photos:image:","Plans:pdf:fergus","Files:pdf+doc+sheet+other:","Email communications::"]', JSON.stringify(st));
check('…and it is saved with Settings', settingsPuts.length > nSet && JSON.stringify((settingsPuts[settingsPuts.length - 1].quote_defaults || {}).job_folders.map(f => f.name)) === '["Photos","Plans","Files","Email communications"]', settingsPuts.length + '');
await pg.evaluate(() => { gotoTab('roof'); });
await open();
s = await state();
check('…so on a job a PDF from Fergus now goes into Plans, the RoofMap PDFs still into Files', JSON.stringify(s.Plans || s[await pg.evaluate(() => _jfFolders().filter(f => f.name === 'Plans')[0].id)]) === '["Customer selections - Quote 3351.pdf"]', JSON.stringify(s));

check('nothing threw', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
