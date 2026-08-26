// The office flashing editor has twelve tools and expects a mouse. On a roof
// you have one gloved finger and a flashing nobody has drawn before. This is
// the three-action version: tap the corners, type the millimetres, done.
//
// The thing that makes it worth having rather than a second, separate drawing
// tool is that it writes the SAME polylines the office editor reads — same
// 720x380 space, measurements keyed by leg index — so a profile sketched up a
// ladder opens in the office tool, carries its girth into the price, and
// reaches the cut list without anybody redrawing it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:820,height:1180} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_site_mode','on'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2500);

check('site mode is on', await pg.evaluate(() =>
  document.documentElement.classList.contains('site-mode')));

// Tap a point given in the pad's own 720x380 logical space.
async function tapLogical(lx, ly){
  const r = await pg.evaluate(() => {
    const c = document.getElementById('sfpCanvas'); const b = c.getBoundingClientRect();
    return { x:b.x, y:b.y, w:b.width, h:b.height };
  });
  await pg.mouse.click(r.x + lx * r.w / 720, r.y + ly * r.h / 380);
  await pg.waitForTimeout(60);
}

// ── the sheet offers a drawing, not just boxes to type in ─────────
await pg.evaluate(() => _siteFlashSheet());
await pg.waitForTimeout(300);
check('the flashing sheet has a Draw button',
  await pg.evaluate(() => !!document.getElementById('_fsDraw')));

await pg.evaluate(() => document.getElementById('_fsDraw').click());
await pg.waitForTimeout(300);
check('…which opens the pad', await pg.evaluate(() => !!document.getElementById('_sfp')));
check('…with nothing drawn and no face boxes yet',
  await pg.evaluate(() => SFP.verts.length === 0 &&
    !document.querySelectorAll('[data-sfpface]').length));

// ── tapping corners builds legs ───────────────────────────────────
await tapLogical(120, 300);
check('one corner is not yet a face',
  await pg.evaluate(() => SFP.verts.length === 1 &&
    document.querySelectorAll('[data-sfpface]').length === 0));

await tapLogical(120, 120);
await tapLogical(400, 120);
await tapLogical(400, 260);
let v = await pg.evaluate(() => ({
  n: SFP.verts.length,
  faces: document.querySelectorAll('[data-sfpface]').length,
  folds: _sfpStats().folds,
}));
check('four corners give three faces', v.n === 4 && v.faces === 3, v.n + ' corners, ' + v.faces + ' faces');
check('…and two folds — the interior corners are what you pay for',
  v.folds === 2, v.folds + ' folds');

// ── square-up ─────────────────────────────────────────────────────
check('legs snap square, so a one-finger sketch looks like the flashing',
  await pg.evaluate(() => {
    // every leg lands on a 15-degree multiple
    return SFP.verts.slice(1).every((p, i) => {
      const q = SFP.verts[i];
      const deg = Math.atan2(p[1]-q[1], p[0]-q[0]) * 180 / Math.PI;
      return Math.abs(deg - Math.round(deg/15)*15) < 0.6;
    });
  }));
await pg.evaluate(() => document.getElementById('sfpSnap').click());
check('…and it can be turned off', await pg.evaluate(() => SFP.snap === false));
await pg.evaluate(() => document.getElementById('sfpSnap').click());

// ── undo ──────────────────────────────────────────────────────────
await pg.evaluate(() => _sfpUndo());
await pg.waitForTimeout(80);
check('undo takes back the last corner, and its face with it',
  await pg.evaluate(() => SFP.verts.length === 3 &&
    document.querySelectorAll('[data-sfpface]').length === 2));
await tapLogical(400, 260);

// ── the numbers ───────────────────────────────────────────────────
await pg.evaluate(() => {
  const f = document.querySelectorAll('[data-sfpface]');
  ['100','250','75'].forEach((mm, i) => {
    f[i].value = mm; f[i].dispatchEvent(new Event('input'));
  });
});
await pg.waitForTimeout(100);
v = await pg.evaluate(() => ({ girth: _sfpStats().girth,
  line: document.getElementById('sfpStats').textContent }));
check('girth is the faces added up', v.girth === 425, '$' + v.girth + ' — ' + v.line);
check('…and it is on screen while you draw', /425/.test(v.line) && /2/.test(v.line), v.line);

// ── it refuses to hand back a shape that is not one ───────────────
await pg.evaluate(() => { SFP.verts = [[10,10]]; });
await pg.evaluate(() => document.getElementById('sfpSave').click());
await pg.waitForTimeout(120);
check('one corner is not a profile, and it says so',
  await pg.evaluate(() => !!document.getElementById('_sfp') &&
    /two corners/i.test(document.getElementById('sfpMsg').textContent)),
  await pg.evaluate(() => (document.getElementById('sfpMsg')||{}).textContent));

// redraw it properly
await pg.evaluate(() => { _sfpClear(); });
await tapLogical(120, 300); await tapLogical(120, 120);
await tapLogical(400, 120); await tapLogical(400, 260);
await pg.evaluate(() => {
  const f = document.querySelectorAll('[data-sfpface]');
  ['100','250','75'].forEach((mm, i) => { f[i].value = mm; f[i].dispatchEvent(new Event('input')); });
});

// ── handing the shape back to the add form ────────────────────────
await pg.evaluate(() => document.getElementById('sfpSave').click());
await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({
  padGone: !document.getElementById('_sfp'),
  faces: Array.prototype.map.call(document.querySelectorAll('[data-face]'), i => i.value),
  note: (document.getElementById('_fsDrawNote')||{}).textContent || '',
}));
check('the pad closes and the sheet keeps the sizes', v.padGone &&
  v.faces.join(',') === '100,250,75', v.faces.join(','));
check('…and says a profile is attached', /3 faces/.test(v.note) && /2 folds/.test(v.note), v.note);

// ── onto the order, in the shape the office editor reads ──────────
await pg.evaluate(() => document.getElementById('_fsAdd').click());
await pg.waitForTimeout(250);
v = await pg.evaluate(() => {
  const f = (S.order.flashings || [])[0] || {};
  const p = (f.polylines || [])[0] || {};
  return { n: (S.order.flashings||[]).length, verts: (p.vertices||[]).length,
           meas: p.measurements || {}, faces: (f.faces||[]).map(x => x.length),
           keys: Object.keys(p), inSpace: (p.vertices||[]).every(q =>
             q[0] >= 0 && q[0] <= 720 && q[1] >= 0 && q[1] <= 380) };
});
check('the flashing lands on the order with its drawing', v.n === 1 && v.verts === 4,
  v.n + ' flashing(s), ' + v.verts + ' corners');
check('…measurements keyed by leg, which is what _computeFlashStats reads',
  v.meas['0'] === 100 && v.meas['1'] === 250 && v.meas['2'] === 75, JSON.stringify(v.meas));
check('…in the office editor\'s own 720x380 space, so it opens there unchanged',
  v.inSpace && ['vertices','measurements','crushFolds','angleMarkers','kind']
    .every(k => v.keys.indexOf(k) >= 0), v.keys.join(','));
check('…and the girth the price will use matches what was drawn',
  await pg.evaluate(() => {
    const p = S.order.flashings[0].polylines[0];
    let g = 0; Object.keys(p.measurements).forEach(k => g += +p.measurements[k]);
    return g === 425 && (p.vertices.length - 2) === 2;
  }));

// ── a face corrected after drawing wins ───────────────────────────
await pg.evaluate(() => { S.order.flashings.length = 0; });
await pg.evaluate(() => document.getElementById('_fsDraw').click());
await pg.waitForTimeout(250);
await tapLogical(140, 300); await tapLogical(140, 140); await tapLogical(380, 140);
await pg.evaluate(() => {
  const f = document.querySelectorAll('[data-sfpface]');
  f[0].value = '90'; f[0].dispatchEvent(new Event('input'));
  f[1].value = '200'; f[1].dispatchEvent(new Event('input'));
});
await pg.evaluate(() => document.getElementById('sfpSave').click());
await pg.waitForTimeout(200);
// correct one of them on the sheet, AFTER drawing
await pg.evaluate(() => {
  const f = document.querySelectorAll('[data-face]');
  f[1].value = '260';
});
await pg.evaluate(() => document.getElementById('_fsAdd').click());
await pg.waitForTimeout(200);
check('a face corrected after drawing is the one that reaches the price',
  await pg.evaluate(() => {
    const p = S.order.flashings[0].polylines[0];
    return p.measurements['1'] === 260 && S.order.flashings[0].faces[1].length === '260';
  }), await pg.evaluate(() => JSON.stringify(S.order.flashings[0].polylines[0].measurements)));

// ── the next flashing starts blank ────────────────────────────────
v = await pg.evaluate(() => (document.getElementById('_fsDrawNote')||{}).style.display);
check('the drawing does not quietly carry over to the next flashing', v === 'none', 'note display=' + v);

// ── editing one already on the order ──────────────────────────────
await pg.evaluate(() => {
  const btn = document.querySelector('[data-skflash="0"]'); if (btn) btn.click();
});
await pg.waitForTimeout(300);
v = await pg.evaluate(() => ({
  open: !!document.getElementById('_sfp'),
  verts: SFP.verts.length,
  faces: Array.prototype.map.call(document.querySelectorAll('[data-sfpface]'), i => i.value),
}));
check('the pencil on an existing flashing reopens its shape',
  v.open && v.verts === 3, v.verts + ' corners');
check('…with its sizes still on it', v.faces.join(',') === '90,260', v.faces.join(','));
await pg.evaluate(() => document.getElementById('sfpCancel').click());

// ── the library ───────────────────────────────────────────────────
await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.materials_catalog = S.settings.materials_catalog || {};
  S.settings.materials_catalog.savedFlashings = [{
    name: 'Parapet cap 300',
    faces: [{label:'Face A',length:'60'},{label:'Face B',length:'300'},{label:'Face C',length:'60'}],
    polylines: [{ vertices:[[100,300],[100,240],[400,240],[400,300]],
                  measurements:{0:60,1:300,2:60}, crushFolds:{}, angleMarkers:{},
                  measurementOffsets:{}, measurementFontPx:{}, kind:null }]
  }];
});
await pg.evaluate(() => document.getElementById('_fsDraw').click());
await pg.waitForTimeout(250);
await pg.evaluate(() => document.getElementById('sfpLib').click());
await pg.waitForTimeout(250);
check('the pad can reach the saved library',
  await pg.evaluate(() => !!document.getElementById('_sfpLib') &&
    /Parapet cap 300/.test(document.getElementById('_sfpLib').textContent)));
await pg.evaluate(() => document.querySelector('[data-sfplib="0"]').click());
await pg.waitForTimeout(250);
v = await pg.evaluate(() => ({
  verts: SFP.verts.length,
  faces: Array.prototype.map.call(document.querySelectorAll('[data-sfpface]'), i => i.value),
  girth: _sfpStats().girth,
}));
check('…and loading one brings back its shape and its sizes',
  v.verts === 4 && v.faces.join(',') === '60,300,60' && v.girth === 420,
  v.verts + ' corners, ' + v.faces.join(',') + ', girth ' + v.girth);
await pg.evaluate(() => document.getElementById('sfpCancel').click());
await pg.evaluate(() => { const s = document.getElementById('_flashSheet'); if (s) s.remove(); });

// ── Save to library used to throw the drawing away ────────────────
// entry.polylines is what openFlashEditModal reads back, and
// saveFlashingToLibrary was only copying the legacy raster `sketch` field —
// so a saved flashing reopened with a blank canvas.
v = await pg.evaluate(() => {
  S.settings.materials_catalog.savedFlashings = [];
  S.order = S.order || {}; S.order.flashings = [{
    type: 'Custom', qty: 1,
    faces: [{label:'Face A',length:'120'},{label:'Face B',length:'80'}],
    polylines: [{ vertices:[[10,10],[10,90],[150,90]], measurements:{0:120,1:80},
                  crushFolds:{2:true}, angleMarkers:{}, measurementOffsets:{},
                  measurementFontPx:{}, kind:null }],
    flashGuards: true
  }];
  window.prompt = () => 'Odd head barge';
  saveFlashingToLibrary(0);
  const e = (_getSavedFlashings() || [])[0] || {};
  return { name: e.name, verts: ((e.polylines||[])[0]||{}).vertices || null,
           meas: ((e.polylines||[])[0]||{}).measurements || null,
           crush: ((e.polylines||[])[0]||{}).crushFolds || null,
           guards: !!e.flashGuards };
});
check('saving to the library keeps the drawing', v.verts && v.verts.length === 3,
  v.name + ' — ' + (v.verts ? v.verts.length + ' corners' : 'NO POLYLINES'));
check('…with its measurements and crush folds intact',
  v.meas && v.meas['0'] === 120 && v.crush && v.crush['2'] === true,
  JSON.stringify(v.meas) + ' / ' + JSON.stringify(v.crush));
check('…and its flash guards', v.guards === true);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
