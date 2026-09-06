// Screenshots for the two-minute RoofMap demo.
//
// Serves frontend/ over HTTP (the sample job fetches demo-job.json, which
// file:// blocks), stubs the backend with invented data, opens the shipped
// sample job and walks the tabs saving PNGs to tools/demo/shots/.
//
//   node floodroofing/tools/demo-shots.mjs
//
// The shots are generated output and are gitignored; this script is the
// thing that is kept, so the deck can be rebuilt when the app changes.
//
// NOTHING here touches app.html, the backend or the tests. The only data
// used is the shipped sample job (M. & R. Whitiora, a made-up Kerikeri
// re-roof) and the fixtures below, which are equally invented. No real
// customer goes near it.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { readFile, mkdir, stat, rm } from 'node:fs/promises';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'frontend');
const OUT = join(HERE, 'demo', 'shots');
// Wipe first: the files are numbered in capture order, so a shot added or
// removed renumbers everything after it and last run's files linger under
// their old numbers, ready to be picked up by the slideshow.
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// ── a static server, same shape as tests/samplejob.mjs ──
const TYPES = { '.html':'text/html', '.json':'application/json', '.png':'image/png',
                '.jpg':'image/jpeg', '.js':'text/javascript', '.svg':'image/svg+xml',
                '.webmanifest':'application/manifest+json' };
const srv = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const buf = await readFile(DIR + (path === '/' ? '/app.html' : path));
    res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end(''); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const JOBS = [
  { id:'j1', job_no:'00181', client_name:'M. & R. Whitiora', site_address:'24 Kauri Road, Kerikeri',
    status:'quoted', updated_at:iso(-1), created_at:iso(-6), created_by:'Sam Tui' },
  { id:'j2', job_no:'00180', client_name:'H. Paniora', site_address:'8 Rimu Street, Kerikeri',
    status:'accepted', updated_at:iso(-3), created_at:iso(-14), created_by:'Sam Tui' },
  { id:'j3', job_no:'00179', client_name:'Northland Storage Ltd', site_address:'19 Wiroa Road, Kerikeri',
    status:'sent', updated_at:iso(-5), created_at:iso(-11), created_by:'Ana Reweti' },
  { id:'j4', job_no:'00178', client_name:'D. & J. Kingi', site_address:'112 Landing Road, Kerikeri',
    status:'draft', updated_at:iso(-7), created_at:iso(-8), created_by:'Sam Tui' },
  { id:'j9', job_no:'00175', client_name:'A. & L. Waitai', site_address:'7 Cobham Road, Kerikeri',
    status:'ordered', updated_at:iso(-4), created_at:iso(-20), created_by:'Sam Tui',
    order_sent:{ at:iso(-4), to:'orders@steelandtube.co.nz', by_name:'Ethan',
                 delivery_date:new Date(Date.now()+6*864e5).toISOString().slice(0,10) } },
];
// The five columns other than Recent Drafts are painted from the
// quote-activity feed, not from the jobs list — without this the board is
// four drafts and five zeroes, which shows nothing.
const FEED = [
  { jobId:'j3', client:'Northland Storage Ltd', ref:'19 Wiroa Road', status:'opened',
    openCount:3, lastEventAt:iso(-0.4) },
  { jobId:'j5', client:'W. Tahere', ref:'6 Puriri Lane', status:'sent', lastEventAt:iso(-1.2) },
  { jobId:'j6', client:'S. McKendry', ref:'88 Inlet Road', status:'queried',
    query:{ message:'Can you do the spouting in the same colour, and what would that add?' },
    lastEventAt:iso(-0.8) },
  { jobId:'j2', client:'H. Paniora', ref:'8 Rimu Street', status:'accepted',
    accepted:{ name:'H. Paniora', total:24180.50 }, lastEventAt:iso(-3) },
  { jobId:'j7', client:'Bay Panel & Paint', ref:'2 Klinac Lane', status:'accepted',
    accepted:{ name:'G. Klinac', total:41905.00 }, fergusPending:true, lastEventAt:iso(-4) },
  { jobId:'j8', client:'R. Ngawaka', ref:'55 Skudders Beach Road', status:'declined',
    lastEventAt:iso(-6) },
];
const SCHED = [
  { id:'s1', company_id:'c1', user_id:'u1', folder:'', pos:0, job_no:'00180', client_name:'H. Paniora',
    site_address:'8 Rimu Street, Kerikeri', start_date:iso(2), blocks:2, crew:'Blue',
    colour:'Ironsand', deposit_paid:true, handover_done:true, material_ordered:false,
    accepted_at:iso(-3), fergus_no:'J2201' },
  { id:'s2', company_id:'c1', user_id:'u1', folder:'', pos:1, job_no:'00176', client_name:'T. Rewi',
    site_address:'3 Hone Heke Road, Kerikeri', start_date:iso(5), blocks:3, crew:'Green',
    colour:'Grey Friars', deposit_paid:true, handover_done:false, material_ordered:true,
    accepted_at:iso(-9), fergus_no:'J2194' },
  { id:'s3', company_id:'c1', user_id:'u1', folder:'', pos:2, job_no:'00173', client_name:'Kerikeri Motors',
    site_address:'41 Mission Road, Kerikeri', start_date:iso(9), blocks:4, crew:'Blue',
    colour:'Sandstone Grey', deposit_paid:false, handover_done:false, material_ordered:false,
    accepted_at:iso(-12), fergus_no:'J2188' },
  { id:'s4', company_id:'c1', user_id:'u1', folder:'', pos:3, job_no:'00171', client_name:'W. Tahere',
    site_address:'6 Puriri Lane, Kerikeri', start_date:iso(12), blocks:2, crew:'Subbies',
    colour:'Karaka', deposit_paid:true, handover_done:true, material_ordered:true,
    accepted_at:iso(-16), fergus_no:'J2180' },
  { id:'s5', company_id:'c1', user_id:'u1', folder:'', pos:4, job_no:'00168', client_name:'Waipapa Joinery',
    site_address:'12 Klinac Lane, Kerikeri', start_date:iso(16), blocks:5, crew:'Blue',
    colour:'Ironsand', deposit_paid:true, handover_done:false, material_ordered:true,
    accepted_at:iso(-21), fergus_no:'J2172' },
  { id:'s6', company_id:'c1', user_id:'u1', folder:'', pos:5, job_no:'00166', client_name:'B. & T. Hemara',
    site_address:'204 Kerikeri Inlet Road, Kerikeri', start_date:iso(23), blocks:3, crew:'',
    colour:'Grey Friars', deposit_paid:false, handover_done:false, material_ordered:false,
    accepted_at:iso(-24), fergus_no:'J2165' },
];
// /schedule answers with the whole board — cfg, rows, blocks and the range
// the calendar is painted over. Returning bare rows leaves _schedLoad()
// reading .nonwork off undefined and the board is a red error line.
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const CREWS = [
  { id:'blue',  name:'Matt\u2019s crew',  colour:'#2563eb' },
  { id:'green', name:'Ethan\u2019s crew', colour:'#16a34a' },
  { id:'amber', name:'Subbies',       colour:'#f59e0b' },
];
// kind 'crew' is a solid booking that takes the crew's colour; 'pencil' is
// the red provisional block. A board of nothing but red says the wrong thing.
const BLOCKS = [
  { id:'b1', row_id:'s1', kind:'crew',   crew_id:'blue',  start_date:day(2),  work_days:2 },
  { id:'b2', row_id:'s2', kind:'crew',   crew_id:'green', start_date:day(5),  work_days:3 },
  { id:'b3', row_id:'s3', kind:'pencil', crew_id:'',      start_date:day(9),  work_days:4 },
  { id:'b4', row_id:'s4', kind:'crew',   crew_id:'amber', start_date:day(12), work_days:2 },
  { id:'b5', row_id:'s5', kind:'crew',   crew_id:'blue',  start_date:day(16), work_days:5 },
  { id:'b6', row_id:'s6', kind:'pencil', crew_id:'',      start_date:day(23), work_days:3 },
];
const INVOICES = [
  { id:'i1', job_id:'j1', company_id:'c1', user_id:'u1', kind:'deposit', number:'INV-1041',
    total:8501.02, status:'paid',  issued_at:iso(-12), due_at:iso(-5) },
  { id:'i2', job_id:'j1', company_id:'c1', user_id:'u1', kind:'progress', number:'INV-1052',
    total:5100.61, status:'sent',  issued_at:iso(-2), due_at:iso(12) },
  { id:'i3', job_id:'j1', company_id:'c1', user_id:'u1', kind:'final', number:'INV-1058',
    total:3400.41, status:'draft', issued_at:null, due_at:null },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{ width:1600, height:1000 }, deviceScaleFactor:2 });
const pg = await ctx.newPage();
const problems = [];
pg.on('pageerror', e => console.log('  pageerror:', e.message));
pg.on('dialog', d => d.accept().catch(()=>{}));

await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const q = r.request(), u = q.url(), m = q.method();
  const j = (x) => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return j({ ok:true, id:'new1' });
  if (/\/schedule\/rows/.test(u)) return j(SCHED);
  if (/\/schedule(\?|$)/.test(u)) return j({
    cfg:{ crews:CREWS, cap:4, shutdowns:[], region:'auckland',
          tpl_pencil:'', tpl_week:'', tpl_confirm:'' },
    rows: SCHED, blocks: BLOCKS, nonwork: [],
    range:{ from: day(-7), to: day(56), today: day(0) }, feed_url:'' });
  if (/\/quote-activity/.test(u)) return j(FEED);
  if (/\/invoices/.test(u)) return j(INVOICES);
  if (/\/jobs(\?|$)/.test(u)) return j(JOBS);
  if (/\/settings/.test(u)) return j({ user_id:'u1', company_id:'c1',
    // Flood Roofing on purpose: it is Aron's own demo, and _stockSet() only
    // returns the built-in photo set for this name — under any other the
    // cover renders the empty "Add your hero photo" frame instead.
    branding:{ company_name:'Flood Roofing LTD', phone:'09 430 0123',
               email:'office@floodroofing.co.nz', website:'roofmap.co.nz' },
    quote_defaults:{ next_job_no:'00182' }, jms_keys:{} });
  return j([]);
});

await pg.addInitScript(() => {
  localStorage.setItem('fr_token', 't');
  localStorage.setItem('fr_setup_done', '1');
  localStorage.removeItem('fr_settings');
  localStorage.setItem('fr_user', JSON.stringify({ email:'office@floodroofing.co.nz', name:'Sam Tui' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Flood Roofing LTD', role:'owner' }));
  // Both of these auto-open and shove the layout sideways.
  localStorage.setItem('fr_qp_pricing_open', '0');
  try { sessionStorage.setItem('fr_fergus_panel_open', '0'); } catch {}
});

await pg.goto(`http://127.0.0.1:${PORT}/app.html`);
await pg.waitForTimeout(3000);

// Suppress chrome by stylesheet rather than by deleting nodes — removing
// #quotePricingPanel breaks gotoTab('quote').
await pg.addStyleTag({ content: `
  [data-sample-strip], #sampleJobBanner, #trialBar, #updateBar, #tourOverlay,
  #navUpdateChip, .page-tools, .qp-edit-hint, .rp-edit-hint,
  #ichatLaunch, #ichatPanel, #iaiLaunch, #iaiPanel, #frHelpLauncher,
  /* "these are default prices, put your own in" — true, and the right thing
     to say in the app; on a demo slide it reads as a disclaimer on the
     numbers rather than as the setup step it is. */
  .pb-listnote,
  /* sticky, so it lands across the top of an element screenshot */
  .q-actionbar { display:none !important; }
` });

let n = 0;
async function shot(name, sel, note) {
  const file = join(OUT, String(++n).padStart(2, '0') + '-' + name + '.png');
  try {
    if (sel) {
      const el = pg.locator(sel).first();
      const box = await el.boundingBox();
      if (!box || box.width < 40 || box.height < 40) {
        problems.push(name + ': ' + sel + ' is ' + (box ? box.width+'×'+box.height : 'not on the page'));
        return;
      }
      await el.screenshot({ path: file });
    } else {
      await pg.screenshot({ path: file });
    }
    const sz = (await stat(file)).size;
    if (sz < 6000) problems.push(name + ': the PNG is only ' + sz + ' bytes — probably blank');
    console.log('  ' + String(n).padStart(2,'0') + '  ' + name + '  ' + Math.round(sz/1024) + ' KB' + (note ? '  — '+note : ''));
  } catch (e) {
    problems.push(name + ': ' + e.message.split('\n')[0]);
  }
}

// ── 1. the board ──
// The board lives on the 'select' tab — there is no 'home' tab id.
await pg.evaluate(() => gotoTab('select'));
await pg.waitForTimeout(1500);
await shot('home-board', '#tab-select');

// ── 2. open the sample job — the roof tab first, everything mirrors it ──
await pg.evaluate(() => openSampleJob());
await pg.waitForTimeout(3500);
await pg.evaluate(() => { const b = document.getElementById('sampleJobBanner'); if (b) b.remove(); });
await shot('roof-measured', '#canvasWrap');

// ── 3. materials — gotoTab runs the whole render chain itself ──
await pg.evaluate(() => gotoTab('materials'));
await pg.waitForTimeout(3000);
// The legacy cards are display:none with one escape hatch. Unhide them and
// re-render: their canvases size off client width and are 0-wide while hidden.
await pg.evaluate(() => {
  ['matRoofMapCard','roofSheetPlanCard','materialsCutListCard'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.add('mp-capturing');
  });
});
await pg.waitForTimeout(400);
await pg.evaluate(() => {
  try { renderRoofSheetPlan(); } catch(e){}
  try { renderMatRoofMap(); } catch(e){}
});
await pg.waitForTimeout(1800);
await shot('sheet-plan', '#roofSheetPlanCard');
await shot('cut-list', '#materialsCutListCard');
await shot('roof-map', '#matRoofMapCard');
await shot('job-pack', '#jpPages');
await pg.evaluate(() => {
  ['matRoofMapCard','roofSheetPlanCard','materialsCutListCard'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove('mp-capturing');
  });
});

// ── 4. the pricing panel, deliberately opened ──
// Set the prepared-by fields BEFORE the first render. They read as faded
// italic placeholders in the app on purpose; on a slide they read as an
// unfinished quote. Re-rendering afterwards loses the cover's hero photo,
// so it has to happen on the way in.
await pg.evaluate(() => {
  S.quote.preparedByName = 'Sam Tui';
  S.quote.preparedByRole = 'Estimator';
  S.quote.ref = 'FR-0181';
});
await pg.evaluate(() => gotoTab('quote'));
await pg.waitForTimeout(3000);
await pg.evaluate(() => _openPricingPanel());
await pg.waitForTimeout(1800);
await shot('pricing-panel', '#quotePricingPanel');

// …and again on the labour table, which is the half a roofer argues about.
const scrolled = await pg.evaluate(() => {
  const p = document.getElementById('quotePricingPanel');
  if (!p) return 0;
  // Find whatever actually scrolls inside the panel and drive it directly —
  // scrollIntoView on a child of a fixed panel silently does nothing here.
  const box = [p, ...p.querySelectorAll('*')]
    .find(e => e.scrollHeight > e.clientHeight + 60);
  if (!box) return 0;
  const lab = Array.from(box.querySelectorAll('*'))
    .find(e => /^ROOF LABOUR$/.test((e.textContent || '').trim()));
  box.scrollTop = lab ? (lab.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 20)
                      : box.scrollHeight * 0.35;
  return Math.round(box.scrollTop);
});
if (!scrolled) problems.push('pricing-labour: the pricing panel did not scroll — it would repeat the shot above');
await pg.waitForTimeout(900);
await shot('pricing-labour', '#quotePricingPanel');

// ── 4b. invoices — the card sits on the quote tab, and _invLoad() hard-
// returns for the sample job, so it needs a job id to load against. ──
await pg.evaluate(() => { S.isSampleJob = false; S.currentJobId = 'j1'; });
await pg.evaluate(() => _invLoad());
await pg.waitForTimeout(1800);
await shot('invoices', '#jobInvoicesCard');

await pg.evaluate(() => _closePricingPanel());
await pg.waitForTimeout(900);

// ── 5. the proposal pages, matched by TEXT — a section toggled off emits
// nothing and shifts every index after it. ──
await pg.evaluate(() => {
  document.documentElement.classList.add('pdf-rendering');
  const r = document.getElementById('qpRoot'); if (r) r.style.zoom = '1';
  // An element screenshot captures the viewport RECTANGLE the element sits
  // in, so anything position:fixed lands on top of it. Park them all rather
  // than hunting the ids one banner at a time.
  window.__demoParked = Array.from(document.body.querySelectorAll('*'))
    .filter(e => /^(fixed|sticky)$/.test(getComputedStyle(e).position) && !e.closest('#qpRoot'));
  window.__demoParked.forEach(e => { e.dataset.demoVis = e.style.visibility; e.style.visibility = 'hidden'; });
});
// The cover's hero photo has to decode before the shutter, or the slide is a
// navy gradient where the fleet shot should be.
await pg.waitForFunction(() => Array.from(document.querySelectorAll('#qpRoot img'))
  .every(i => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
await pg.waitForTimeout(1500);
await pg.waitForTimeout(900);
async function listPages() {
  return pg.evaluate(() => Array.from(document.querySelectorAll('#qpRoot .rp-page'))
    .map((p, i) => (i+1) + ': ' + (p.textContent||'').replace(/\s+/g,' ').trim().slice(0, 90)));
}
async function page_with(text, name) {
  const i = await pg.evaluate((t) => {
    const pages = Array.from(document.querySelectorAll('#qpRoot .rp-page'));
    return pages.findIndex(p => new RegExp(t, 'i').test(p.textContent || ''));
  }, text);
  if (i < 0) {
    problems.push(name + ': no proposal page matched /' + text + '/\n      pages are:\n        ' +
      (await listPages()).join('\n        '));
    return;
  }
  await shot(name, '#qpRoot .rp-page >> nth=' + i, 'page ' + (i + 1));
}
await page_with('Roofing proposal|Prepared for', 'quote-cover');
// The customer picking their own options is the distinctive half of this.
await page_with('Choose Your Options', 'quote-options');
// The acceptance page by its own heading — 'accept' on its own also matches
// the terms page, which is five pages earlier.
await page_with('Accept Your Quote', 'quote-accept');
await pg.evaluate(() => {
  document.documentElement.classList.remove('pdf-rendering');
  (window.__demoParked || []).forEach(e => { e.style.visibility = e.dataset.demoVis || ''; });
});

// ── 6. the schedule board ──
await pg.evaluate(() => gotoTab('schedule'));
await pg.waitForTimeout(2500);
await shot('schedule', '#schedWrap');

await ctx.close();
await browser.close();
srv.close();

if (problems.length) {
  console.log('\n' + problems.length + ' shot(s) went wrong — a blank slide is the whole risk here:');
  problems.forEach(p => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('\n' + n + ' shots written to ' + OUT);
