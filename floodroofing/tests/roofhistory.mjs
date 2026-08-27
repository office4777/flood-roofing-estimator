// The door onto the backups.
//
// job_revisions has held the eight newest snapshots of every job since the
// multi-tenant migration, and nothing in the app ever called the endpoints
// that read them — so a roofer whose roof map went blank had a good copy in
// the database and no way to reach it. That is what made job 3173 feel final.
//
// The property that matters most here is NOT that restore works. It is that
// you cannot restore blind: a snapshot has to be fetched and drawn, with its
// roof count, before the button that overwrites the job appears — and a blank
// snapshot has to announce itself, or the history becomes a second way to
// lose the drawing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const GOOD = {
  outline: [[0,0],[100,0],[100,80],[0,80]],
  lines: [{ type:'ridge' }, { type:'gutter' }],
  roofs: [{ name:'MainRoof', outline:[[0,0],[100,0],[100,80],[0,80]], lines:[{type:'ridge'}] },
          { name:'Roof2', outline:[[110,0],[160,0],[160,50],[110,50]], lines:[] }],
  penetrations: [{ kind:'pipe' }],
};
const BLANK = { outline: [], lines: [], roofs: [], penetrations: [] };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let restored = null;
pg.on('dialog', d => d.accept());

await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
  if (/\/revisions\/rev-good\/geometry/.test(u))
    return j({ id:'rev-good', saved_at:'2026-08-27T00:40:00Z', draw: GOOD,
               summary:{ roofs:2, outline:4, lines:2, penetrations:1, blank:false } });
  if (/\/revisions\/rev-blank\/geometry/.test(u))
    return j({ id:'rev-blank', saved_at:'2026-08-27T01:14:00Z', draw: BLANK,
               summary:{ roofs:0, outline:0, lines:0, penetrations:0, blank:true } });
  if (/\/revisions\/rev-good\/restore/.test(u)){ restored = 'rev-good'; return j({ ok:true, id:'job-1' }); }
  if (/\/revisions$/.test(u)) return j([
    { id:'rev-blank', job_id:'job-1', reason:'update', saved_at:'2026-08-27T01:14:00Z' },
    { id:'rev-good',  job_id:'job-1', reason:'update', saved_at:'2026-08-27T00:40:00Z' },
  ]);
  return j([]);
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

// ── it is there, and it is out of the way until wanted ────────────
let v = await pg.evaluate(() => {
  const c = document.getElementById('roofHistoryCard');
  return { exists: !!c, open: c ? c.open : null, tab: c ? !!c.closest('#tab-roof') : false };
});
check('the job carries a roof map history panel', v.exists);
check('…collapsed until it is wanted', v.open === false, String(v.open));
check('…on the Map Roof tab, where you notice a map has gone', v.tab, String(v.tab));

// ── with no job open it says so rather than erroring ──────────────
await pg.evaluate(() => { S.currentJobId = null; S.linkedJobId = null; return _roofHistoryLoad(true); });
await pg.waitForTimeout(300);
v = await pg.evaluate(() => (document.getElementById('roofHistoryBody')||{}).innerText || '');
check('with no job open it explains itself instead of failing', /open a saved job/i.test(v), v.slice(0,80));

// ── the list ──────────────────────────────────────────────────────
await pg.evaluate(() => { S.currentJobId = 'job-1'; return _roofHistoryLoad(true); });
await pg.waitForTimeout(600);
v = await pg.evaluate(() => {
  const body = document.getElementById('roofHistoryBody');
  return { txt: body.innerText, peeks: body.querySelectorAll('[onclick*="_roofHistPeek"]').length,
           restores: body.querySelectorAll('[onclick*="_roofHistRestore"]').length,
           svgs: body.querySelectorAll('svg').length };
});
check('the earlier versions are listed', v.peeks === 2, v.peeks + ' versions');
check('…newest first, marked as such', /MOST RECENT/.test(v.txt));
// This is the safety property: nothing offers to overwrite the job until the
// user has actually looked at what they would be overwriting.
check('…and NOTHING offers to restore before it has been looked at',
  v.restores === 0 && v.svgs === 0,
  v.restores + ' restore buttons, ' + v.svgs + ' maps');

// ── looking at a good one ─────────────────────────────────────────
await pg.evaluate(() => _roofHistPeek('rev-good'));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const body = document.getElementById('roofHistoryBody');
  return { txt: body.innerText, svgs: body.querySelectorAll('svg').length,
           polys: body.querySelectorAll('svg polygon').length,
           restores: body.querySelectorAll('[onclick*="_roofHistRestore"]').length };
});
check('looking at a version draws its roof map', v.svgs === 1 && v.polys === 2,
  v.svgs + ' maps, ' + v.polys + ' roofs drawn');
// innerText runs the counts straight into the button label ("1 penetrationPut
// this version back"), so no word boundary to anchor on.
check('…and says what is in it', /2 roofs/.test(v.txt) && /1 penetration/.test(v.txt),
  v.txt.replace(/\s+/g,' ').slice(0,110));
check('…and only NOW offers to put it back', v.restores === 1, v.restores + '');

// ── looking at the blank one ──────────────────────────────────────
await pg.evaluate(() => _roofHistPeek('rev-blank'));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const body = document.getElementById('roofHistoryBody');
  const cards = [...body.querySelectorAll('div')].map(d => d.innerText);
  return { txt: body.innerText,
           restores: body.querySelectorAll('[onclick*="_roofHistRestore"]').length };
});
check('a version with no roof map in it says so plainly',
  /no roof map in it/i.test(v.txt), (v.txt.match(/.{0,60}no roof map.{0,40}/i)||[])[0] || 'not said');
check('…and is never offered as something to restore',
  v.restores === 1, v.restores + ' restore buttons (the good one only)');

// ── restoring ─────────────────────────────────────────────────────
await pg.evaluate(() => { window.openJob = async function(){ window.__reopened = true; }; });
await pg.evaluate(() => _roofHistRestore('rev-good'));
await pg.waitForTimeout(500);
v = await pg.evaluate(() => ({ reopened: !!window.__reopened,
  lkg: localStorage.getItem('fr_lkg_job-1') }));
check('putting a version back calls the restore', restored === 'rev-good', String(restored));
check('…then re-opens the job so the canvas shows it', v.reopened);
// The blank that was on screen must not be re-applied over the restored map
// by the next autosave.
check('…and the guard is re-based, not still holding the blank',
  v.lkg === null, String(v.lkg));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
