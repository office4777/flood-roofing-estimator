// The aerial map was migrated to Mapbox GL, but three code paths kept their
// Leaflet bodies — and Leaflet is not loaded on the page, so an address
// search (or the LINZ/Esri imagery switch) threw "L is not defined" at
// whoever tried it first. This suite drives exactly those paths and fails on
// ANY uncaught page error, so a half-migrated map API can't ship again.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGEERROR', e.message); });
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

// The exact call Ethan's crash email came from: a search resolving to
// coordinates. Offline there is no map to fly to — the point is that it
// must WAIT for one, not call a library that isn't there.
await pg.evaluate(() => { gotoTab('roof'); showAerialMap(-35.7275, 174.3166); });
await pg.waitForTimeout(800);
check('searching an address no longer throws (the crash Ethan hit)',
  pageErrors.length === 0, pageErrors.join(' | '));

const hint = await pg.evaluate(() => (document.getElementById('aerialHint')||{}).textContent || '');
check('…and the user is told to zoom, not shown a dead panel', /Zoom in/i.test(hint), hint);

// The imagery dropdown: LINZ (with a saved key) and Esri both used Leaflet
// calls; "mapbox" used to apply Esri tiles by accident.
await pg.evaluate(() => {
  localStorage.setItem('linzApiKey', 'test-key');
  switchImagerySource('linz');
  switchImagerySource('esri');
  switchImagerySource('mapbox');
});
await pg.waitForTimeout(500);
check('switching imagery source (linz/esri/mapbox) no longer throws',
  pageErrors.length === 0, pageErrors.join(' | '));

// Nothing on the page may reference the Leaflet API at all — that is the
// half-migration this suite exists to block.
const src = await pg.evaluate(() => document.documentElement.outerHTML);
const leaflet = (src.match(/\bL\.(map|tileLayer|marker|latLng)\(/g) || []);
check('no Leaflet API calls survive anywhere in the page', leaflet.length === 0, leaflet.join(', '));

await ctx.close();
await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
